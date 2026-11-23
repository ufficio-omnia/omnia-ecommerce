// Correzione dei dati del C8 (difetto del giro A1 del 23/11/2026): sullo STAGING 5 gare TED o PVL unite per CIG con Sintel hanno perso l'ora
// della scadenza sul LOTTO (LOT-0001), sostituita dal valore «solo giorno» di Sintel; la gara è rimasta giusta. Il codice è corretto dal commit
// 7cb68a8 (unisciLotti); questo script riporta sul lotto la scadenza della GARA, che è dello stesso giorno e ha l'ora.
//   prova   → solo letture: per ogni gara stampa il valore di adesso e quello che scriverebbe; si ferma se qualcosa non è come atteso;
//   applica → per ogni gara UNA scrittura condizionata su radar_lotti: where procedura_id = X and numero_lotto = 'LOT-0001' and
//             scadenza_offerte is null and scadenza_giorno = <giorno della gara>; al più una riga per gara; idempotente (un lotto già con l'ora
//             della gara non cambia). Solo con esegui-autorizzato.mjs e un'autorizzazione «correzione_dati».
// Controlli per ogni gara, prima di scrivere: la gara ha un solo lotto; il lotto è LOT-0001, dello stesso giorno della gara, senza ora e con la
// scadenza «(Sintel indica solo il giorno)»; la gara ha l'ora. Se uno manca: FERMO, nessuna scrittura per nessuna gara.
import { createClient } from "@supabase/supabase-js";
import type { ClientDb } from "../../src/lib/radar/notifiche/motore";
import { FermoCollaudo, PRODUZIONE_REF, STAGING_REF, installaOsservatore } from "../collaudo-z8/collaudo-motore-z8";

// le 5 gare trovate dal coordinamento e lette il 23/11 (sola lettura): una per riga
export const GARE_C8 = [
  "2f2ef67c-fc08-418a-9c8c-c0ea7ac2d67f",
  "5f6adcdd-79f8-4385-8269-62dd56918cfc",
  "865c1977-0207-4459-b26d-019844b5041a",
  "a1e9b53f-04e2-400e-a6b1-11b8d03e03bf",
  "b6aedc70-911d-498f-8f6c-517cd68835b6",
] as const;

type Gara = { id: string; n_lotti: number | null; scadenza_giorno: string | null; scadenza_offerte: string | null; scadenza_ora_indicata: boolean; scadenza_fonte: string | null };
type Lotto = { procedura_id: string; numero_lotto: string; scadenza_giorno: string | null; scadenza_offerte: string | null; scadenza_ora_indicata: boolean; scadenza_fonte: string | null };
export type Piano = { gara: string; giorno: string; prima: { offerte: string | null; ora: boolean; fonte: string | null }; dopo: { offerte: string; ora: true; fonte: string | null }; giaAPosto: boolean };
export type EsitoRipristino = { piani: Piano[]; cambiate: number; giaAPosto: number };

const stessoIstante = (a: string | null, b: string | null) => !!a && !!b && Date.parse(a) === Date.parse(b);

/** Le letture e i controlli: il piano per ogni gara, oppure FERMO senza scrivere nulla. */
export async function pianoRipristino(admin: ClientDb, gare: readonly string[] = GARE_C8): Promise<Piano[]> {
  const piani: Piano[] = [];
  for (const id of gare) {
    const g = await admin.from("radar_procedure").select("id, n_lotti, scadenza_giorno, scadenza_offerte, scadenza_ora_indicata, scadenza_fonte").eq("id", id);
    if (g.error) throw new FermoCollaudo(`lettura della gara ${id}: ${g.error.message ?? ""}`);
    const gara = ((g.data ?? []) as Gara[])[0];
    if (!gara) throw new FermoCollaudo(`gara ${id} non trovata`);
    if (!gara.scadenza_ora_indicata || !gara.scadenza_offerte || !gara.scadenza_giorno) throw new FermoCollaudo(`gara ${id}: la gara non ha una scadenza con l'ora`);
    if (gara.n_lotti !== 1) throw new FermoCollaudo(`gara ${id}: ${gara.n_lotti} lotti invece di 1`);
    const l = await admin.from("radar_lotti").select("procedura_id, numero_lotto, scadenza_giorno, scadenza_offerte, scadenza_ora_indicata, scadenza_fonte").eq("procedura_id", id);
    if (l.error) throw new FermoCollaudo(`lettura dei lotti di ${id}: ${l.error.message ?? ""}`);
    const lotti = (l.data ?? []) as Lotto[];
    if (lotti.length !== 1 || lotti[0].numero_lotto !== "LOT-0001") throw new FermoCollaudo(`gara ${id}: attesi un solo lotto LOT-0001, trovati ${lotti.map((x) => x.numero_lotto).join(", ") || "nessuno"}`);
    const lotto = lotti[0];
    if (lotto.scadenza_giorno !== gara.scadenza_giorno) throw new FermoCollaudo(`gara ${id}: il lotto è del ${lotto.scadenza_giorno}, la gara del ${gara.scadenza_giorno}`);
    const giaAPosto = lotto.scadenza_ora_indicata && stessoIstante(lotto.scadenza_offerte, gara.scadenza_offerte);
    if (!giaAPosto && (lotto.scadenza_offerte !== null || lotto.scadenza_ora_indicata || lotto.scadenza_fonte !== `${gara.scadenza_giorno} (Sintel indica solo il giorno)`)) {
      throw new FermoCollaudo(`gara ${id}: il lotto non ha il valore atteso del giro A1 (${JSON.stringify({ offerte: lotto.scadenza_offerte, ora: lotto.scadenza_ora_indicata, fonte: lotto.scadenza_fonte })})`);
    }
    piani.push({ gara: id, giorno: gara.scadenza_giorno, prima: { offerte: lotto.scadenza_offerte, ora: lotto.scadenza_ora_indicata, fonte: lotto.scadenza_fonte }, dopo: { offerte: gara.scadenza_offerte, ora: true, fonte: gara.scadenza_fonte }, giaAPosto });
  }
  return piani;
}

/** Le scritture: solo dopo che il piano è passato per TUTTE le gare. */
export async function ripristinaOraLotti(admin: ClientDb, adesso: Date, gare: readonly string[] = GARE_C8): Promise<EsitoRipristino> {
  const piani = await pianoRipristino(admin, gare);
  let cambiate = 0;
  for (const p of piani) {
    if (p.giaAPosto) continue;
    const r = await admin
      .from("radar_lotti")
      .update({ scadenza_offerte: p.dopo.offerte, scadenza_ora_indicata: true, scadenza_fonte: p.dopo.fonte, aggiornato_il: adesso.toISOString() })
      .eq("procedura_id", p.gara)
      .eq("numero_lotto", "LOT-0001")
      .is("scadenza_offerte", null)
      .eq("scadenza_giorno", p.giorno)
      .select("procedura_id");
    if (r.error) throw new FermoCollaudo(`scrittura del lotto di ${p.gara}: ${r.error.message ?? ""}`);
    const n = ((r.data ?? []) as unknown[]).length;
    if (n !== 1) throw new FermoCollaudo(`lotto di ${p.gara}: cambiate ${n} righe invece di una (stato cambiato nel frattempo?)`);
    cambiate++;
  }
  const dopo = await pianoRipristino(admin, gare);
  if (dopo.some((p) => !p.giaAPosto)) throw new FermoCollaudo("dopo la scrittura qualche lotto non ha ancora l'ora della gara");
  return { piani, cambiate, giaAPosto: piani.filter((p) => p.giaAPosto).length };
}

export async function lancia(modo: "prova" | "applica", ambiente: Record<string, string | undefined>, registro: { controllaPorta: (x: { script: string }) => unknown } | null): Promise<EsitoRipristino> {
  if (modo === "applica") {
    if (!registro) throw new FermoCollaudo("applica: solo con esegui-autorizzato.mjs e un'autorizzazione registrata");
    registro.controllaPorta({ script: "ripristina-ora-lotti-staging.ts" });
  }
  const url = String(ambiente.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/, "");
  if (url !== `https://${STAGING_REF}.supabase.co` || Object.values(ambiente).some((v) => typeof v === "string" && v.includes(PRODUZIONE_REF))) throw new FermoCollaudo("non è lo staging");
  if (ambiente.VERCEL_ENV) throw new FermoCollaudo("VERCEL_ENV presente: lo script non gira su Vercel");
  const fermo = { motivo: null as string | null };
  const osservatore = installaOsservatore(url, fermo);
  try {
    const client = createClient(url, String(ambiente.SUPABASE_SERVICE_ROLE_KEY ?? ""), { auth: { autoRefreshToken: false, persistSession: false } }) as unknown as ClientDb;
    const esito = modo === "applica" ? await ripristinaOraLotti(client, new Date()) : { piani: await pianoRipristino(client), cambiate: 0, giaAPosto: 0 };
    if (fermo.motivo) throw new FermoCollaudo(fermo.motivo);
    return esito;
  } finally {
    osservatore.ripristina();
  }
}

async function principale(): Promise<number> {
  const modo = process.argv[2];
  if (modo !== "prova" && modo !== "applica") {
    console.error("uso: npx tsx scripts/c8/ripristina-ora-lotti-staging.ts prova   (solo letture)\n     (solo con esegui-autorizzato.mjs) npx tsx scripts/c8/ripristina-ora-lotti-staging.ts applica");
    return 2;
  }
  let registro: { controllaPorta: (x: { script: string }) => unknown } | null = null;
  if (modo === "applica") {
    const cartellaRegistro = process.env.TI_REGISTRO;
    if (!cartellaRegistro) {
      console.error("STOP: scrive sullo staging: solo con esegui-autorizzato.mjs e un'autorizzazione registrata");
      return 2;
    }
    registro = (await import(new URL(`file:///${cartellaRegistro.replace(/\\/g, "/").replace(/^\/+/, "")}/registro.mjs`).href)) as { controllaPorta: (x: { script: string }) => unknown };
  }
  const GUARDIA = "file:///C:/Users/Dell/AppData/Local/Temp/claude/abcfdf0028fd8393/e334def8-d832-4558-942a-9241c500a45d/scratchpad/staging/guardia-staging.mjs";
  const { caricaStaging } = (await import(GUARDIA)) as { caricaStaging: () => Record<string, string> };
  const v = caricaStaging();
  if (v.STAGING_PROJECT_REF !== STAGING_REF) throw new FermoCollaudo("guardia: non è lo staging");
  const e = await lancia(modo, { NEXT_PUBLIC_SUPABASE_URL: v.STAGING_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: v.STAGING_SECRET_KEY, VERCEL_ENV: process.env.VERCEL_ENV }, registro);
  for (const p of e.piani) console.log(`${p.gara.slice(0, 8)} ${p.giorno}: ${p.giaAPosto ? "già a posto" : `${p.prima.fonte} → ${p.dopo.offerte} (${p.dopo.fonte})`}`);
  console.log(modo === "applica" ? `C8, ripristino dell'ora sui lotti: righe cambiate ${e.cambiate}, già a posto ${e.giaAPosto}` : "PROVA: nessuna scrittura");
  return 0;
}

if (process.argv[1] && /ripristina-ora-lotti-staging\.ts$/.test(process.argv[1].replace(/\\/g, "/"))) {
  principale()
    .then((c) => process.exit(c))
    .catch((e) => {
      console.error(`FERMATO: ${e instanceof Error ? e.message : String(e)}`);
      process.exit(e instanceof FermoCollaudo ? 3 : 1);
    });
}
