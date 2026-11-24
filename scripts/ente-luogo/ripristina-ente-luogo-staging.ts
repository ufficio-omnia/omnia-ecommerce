// Correzione dei dati del giro di prova PVL del 24/11/2026 sullo STAGING (AUT-20261124-04, USO-3a3518880a5a): l'unione copiava il gruppo
// «luogo» della PVL per intero, così la sede dell'ente (sa_comune, sa_provincia, sa_regione) ha preso il luogo di esecuzione del primo lotto
// e in 3 gare regione e regioni sono state svuotate. Il codice è corretto dal commit 1d94297 (unione-calcoli.ts); questo script riporta le
// gare al valore che il motore CORRETTO avrebbe scritto in quel giro (piano-ripristino-ente-luogo.json, calcolato con unisciVersione dalla
// fotografia del coordinamento di prima del giro e dai valori del giro), e la provenienza della sede alla fonte che la indica.
//   prova   → solo letture: per ogni gara il valore di adesso e quello che scriverebbe; si ferma se qualcosa non è come atteso;
//   applica → per ogni gara UNA scrittura condizionata su radar_procedure (where id = X and aggiornata_il = <letto>), poi una traccia
//             «correzione_dati» non notificabile in radar_aggiornamenti (una per gara, mai doppia); idempotente. Solo con
//             esegui-autorizzato.mjs e un'autorizzazione «correzione_dati».
// Controlli per ogni gara, prima di scrivere: la gara esiste; sede, regioni e provenienza della sede sono ESATTAMENTE quelli lasciati dal giro
// (o già quelli corretti). Se una gara non torna: FERMO, nessuna scrittura per nessuna gara. Non tocca aggiornata_il (correzione, non novità).
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import type { ClientDb } from "../../src/lib/radar/notifiche/motore";
import { FermoCollaudo, PRODUZIONE_REF, STAGING_REF, installaOsservatore } from "../collaudo-z8/collaudo-motore-z8";

type Sede = { sa_comune: string | null; sa_provincia: string | null; sa_regione: string | null; luogo_regioni: string[] };
type Provenienza = { f: string; id: string; g: string; t: string | null; ted: string | null };
// prima = valori della fotografia di prima del giro (solo per la prova che ricalcola il piano); giro = valori e provenienza della sede lasciati
// dal giro (quelli che lo script si aspetta di trovare); atteso = valori da scrivere; provenienza = sede e regioni da scrivere
export type GaraDelPiano = { id: string; parte: "A" | "B"; valori: boolean; prima: Sede; giro: Sede & { luogo: Provenienza }; atteso: Sede; provenienza: { luogo: Provenienza; luogo_regioni: Provenienza } };
export type PianoFile = { conteggi: { gare: number; con_valori: number; solo_provenienza: number }; gare: GaraDelPiano[] };
type Letta = Sede & { id: string; provenienza_campi: Record<string, Provenienza> | null; aggiornata_il: string };
export type Piano = { gara: string; prima: Sede; dopo: Sede; provenienza: Record<string, Provenienza>; aggiornataIl: string; giaAPosto: boolean };
export type EsitoRipristino = { piani: Piano[]; cambiate: number; giaAPosto: number; tracce: number };

export const ID_TRACCIA = "ripristino-ente-luogo-20261124";
const COLONNE = ["sa_comune", "sa_provincia", "sa_regione", "luogo_regioni"] as const;

// il piano si legge dalla cartella del progetto (da lì si lanciano lo script e le prove)
export function leggiPiano(file = path.join(process.cwd(), "scripts/ente-luogo/piano-ripristino-ente-luogo.json")): PianoFile {
  const p = JSON.parse(fs.readFileSync(file, "utf8")) as PianoFile;
  if (!Array.isArray(p.gare) || p.gare.length !== p.conteggi.gare || new Set(p.gare.map((g) => g.id)).size !== p.gare.length) throw new FermoCollaudo("piano: elenco delle gare non coerente");
  return p;
}

const sede = (r: Partial<Sede>): Sede => ({ sa_comune: r.sa_comune ?? null, sa_provincia: r.sa_provincia ?? null, sa_regione: r.sa_regione ?? null, luogo_regioni: [...(r.luogo_regioni ?? [])] });
const uguali = (a: Sede, b: Sede) => JSON.stringify(sede(a)) === JSON.stringify(sede(b));
const stessaProvenienza = (a: Provenienza | undefined, b: { f: string; id: string } | null | undefined) => !!a && !!b && a.f === b.f && a.id === b.id;

/** Le letture e i controlli: il piano per ogni gara, oppure FERMO senza scrivere nulla. */
export async function pianoRipristino(admin: ClientDb, gare: readonly GaraDelPiano[]): Promise<Piano[]> {
  const piani: Piano[] = [];
  for (const g of gare) {
    const r = await admin.from("radar_procedure").select("id, sa_comune, sa_provincia, sa_regione, luogo_regioni, provenienza_campi, aggiornata_il").eq("id", g.id);
    if (r.error) throw new FermoCollaudo(`lettura della gara ${g.id}: ${r.error.message ?? ""}`);
    const letta = ((r.data ?? []) as Letta[])[0];
    if (!letta) throw new FermoCollaudo(`gara ${g.id} non trovata`);
    const prov = { ...(letta.provenienza_campi ?? {}) };
    const giaAPosto = uguali(letta, g.atteso) && stessaProvenienza(prov.luogo, g.provenienza.luogo) && stessaProvenienza(prov.luogo_regioni, g.provenienza.luogo_regioni);
    if (!giaAPosto && !(uguali(letta, g.giro) && stessaProvenienza(prov.luogo, g.giro.luogo))) {
      throw new FermoCollaudo(`gara ${g.id}: sede, regioni o provenienza non sono quelle lasciate dal giro PVL (${JSON.stringify({ ...sede(letta), luogo: prov.luogo ? { f: prov.luogo.f, id: prov.luogo.id } : null })})`);
    }
    piani.push({ gara: g.id, prima: sede(letta), dopo: sede(g.atteso), provenienza: { ...prov, luogo: g.provenienza.luogo, luogo_regioni: g.provenienza.luogo_regioni }, aggiornataIl: letta.aggiornata_il, giaAPosto });
  }
  return piani;
}

/** Le scritture: solo dopo che il piano è passato per TUTTE le gare. */
export async function ripristinaEnteLuogo(admin: ClientDb, adesso: Date, gare: readonly GaraDelPiano[]): Promise<EsitoRipristino> {
  const piani = await pianoRipristino(admin, gare);
  let cambiate = 0;
  let tracce = 0;
  for (const p of piani) {
    if (!p.giaAPosto) {
      const valori: Record<string, unknown> = Object.fromEntries(COLONNE.map((c) => [c, p.dopo[c]]));
      const r = await admin.from("radar_procedure").update({ ...valori, provenienza_campi: p.provenienza }).eq("id", p.gara).eq("aggiornata_il", p.aggiornataIl).select("id");
      if (r.error) throw new FermoCollaudo(`scrittura della gara ${p.gara}: ${r.error.message ?? ""}`);
      const n = ((r.data ?? []) as unknown[]).length;
      if (n !== 1) throw new FermoCollaudo(`gara ${p.gara}: cambiate ${n} righe invece di una (gara riscritta nel frattempo?)`);
      cambiate++;
    }
    // la traccia: una per gara, mai notificabile, mai doppia (indice unico procedura_id, tipo, campo, id_fonte)
    const t = await admin
      .from("radar_aggiornamenti")
      .upsert(
        [{ procedura_id: p.gara, tipo: "correzione_dati", campo: "ente_luogo", valore_precedente: JSON.stringify(p.prima), valore_nuovo: JSON.stringify(p.dopo), fonte: "manuale", id_fonte: ID_TRACCIA, nota: "Ripristino della sede dell'ente e delle regioni dopo il giro di prova PVL del 24/11/2026 (luogo di esecuzione preso come sede)", notificabile: false, rilevato_il: adesso.toISOString() }],
        { onConflict: "procedura_id,tipo,campo,id_fonte", ignoreDuplicates: true },
      )
      .select("procedura_id");
    if (t.error) throw new FermoCollaudo(`traccia della gara ${p.gara}: ${t.error.message ?? ""}`);
    tracce += ((t.data ?? []) as unknown[]).length;
  }
  const dopo = await pianoRipristino(admin, gare);
  if (dopo.some((p) => !p.giaAPosto)) throw new FermoCollaudo("dopo la scrittura qualche gara non ha ancora il valore corretto");
  return { piani, cambiate, giaAPosto: piani.filter((p) => p.giaAPosto).length, tracce };
}

export async function lancia(modo: "prova" | "applica", ambiente: Record<string, string | undefined>, registro: { controllaPorta: (x: { script: string }) => unknown } | null, gare: readonly GaraDelPiano[]): Promise<EsitoRipristino> {
  if (modo === "applica") {
    if (!registro) throw new FermoCollaudo("applica: solo con esegui-autorizzato.mjs e un'autorizzazione registrata");
    registro.controllaPorta({ script: "ripristina-ente-luogo-staging.ts" });
  }
  const url = String(ambiente.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/, "");
  if (url !== `https://${STAGING_REF}.supabase.co` || Object.values(ambiente).some((v) => typeof v === "string" && v.includes(PRODUZIONE_REF))) throw new FermoCollaudo("non è lo staging");
  if (ambiente.VERCEL_ENV) throw new FermoCollaudo("VERCEL_ENV presente: lo script non gira su Vercel");
  const fermo = { motivo: null as string | null };
  const osservatore = installaOsservatore(url, fermo);
  try {
    const client = createClient(url, String(ambiente.SUPABASE_SERVICE_ROLE_KEY ?? ""), { auth: { autoRefreshToken: false, persistSession: false } }) as unknown as ClientDb;
    const esito = modo === "applica" ? await ripristinaEnteLuogo(client, new Date(), gare) : { piani: await pianoRipristino(client, gare), cambiate: 0, giaAPosto: 0, tracce: 0 };
    if (fermo.motivo) throw new FermoCollaudo(fermo.motivo);
    return esito;
  } finally {
    osservatore.ripristina();
  }
}

async function principale(): Promise<number> {
  const modo = process.argv[2];
  if (modo !== "prova" && modo !== "applica") {
    console.error("uso: npx tsx scripts/ente-luogo/ripristina-ente-luogo-staging.ts prova   (solo letture)\n     (solo con esegui-autorizzato.mjs) npx tsx scripts/ente-luogo/ripristina-ente-luogo-staging.ts applica");
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
  const piano = leggiPiano();
  const GUARDIA = "file:///C:/Users/Dell/Desktop/OMNIA-PROGETTO1/TENDER_INTELLIGENCE_FASE0/autorizzazioni/guardia-staging.mjs";
  const { caricaStaging } = (await import(GUARDIA)) as { caricaStaging: () => Record<string, string> };
  const v = caricaStaging();
  if (v.STAGING_PROJECT_REF !== STAGING_REF) throw new FermoCollaudo("guardia: non è lo staging");
  const e = await lancia(modo, { NEXT_PUBLIC_SUPABASE_URL: v.STAGING_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: v.STAGING_SECRET_KEY, VERCEL_ENV: process.env.VERCEL_ENV }, registro, piano.gare);
  const testo = (s: Sede) => `${s.sa_comune ?? "–"} (${s.sa_provincia ?? "–"}) ${s.sa_regione ?? "–"} [${s.luogo_regioni.join(",")}]`;
  for (const p of e.piani) console.log(`${p.gara.slice(0, 8)}: ${p.giaAPosto ? "già a posto" : uguali(p.prima, p.dopo) ? `solo la provenienza della sede → ${p.provenienza.luogo.f}` : `${testo(p.prima)} → ${testo(p.dopo)} (sede: ${p.provenienza.luogo.f})`}`);
  console.log(modo === "applica" ? `Ripristino ente/luogo: gare cambiate ${e.cambiate}, già a posto ${e.giaAPosto}, tracce nuove ${e.tracce}` : `PROVA: nessuna scrittura (${piano.conteggi.gare} gare: ${piano.conteggi.con_valori} con valori, ${piano.conteggi.solo_provenienza} solo provenienza)`);
  return 0;
}

if (process.argv[1] && /ripristina-ente-luogo-staging\.ts$/.test(process.argv[1].replace(/\\/g, "/"))) {
  principale()
    .then((c) => process.exit(c))
    .catch((e) => {
      console.error(`FERMATO: ${e instanceof Error ? e.message : String(e)}`);
      process.exit(e instanceof FermoCollaudo ? 3 : 1);
    });
}
