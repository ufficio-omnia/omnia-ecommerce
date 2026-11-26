// C8 (documento 52, parte A, passo A0; B2, 23/11/2026): ACCENDE una fonte regionale (Sintel o SardegnaCAT) sullo STAGING, perché i giri
// reali del C8 non escano subito con «fonte_spenta». Stessa forma degli script del 48B e di K11; cambia UNA riga:
//   update public.radar_fonti_stato set attiva = true, aggiornata_il = now() where fonte = '<fonte>' and attiva = false;
// Con il client di servizio (una sola richiesta PATCH di PostgREST, atomica), solo con esegui-autorizzato.mjs e un'autorizzazione
// registrata («correzione_dati»). Idempotente: se la fonte è già accesa non cambia nulla. Si ferma se la riga manca o se cambierebbe più di
// una riga. NON tocca il blocco (il semaforo resta chiuso: i giri li apre solo il lanciatore), né la visibilità, né il cursore. Una fonte
// SOSPESA dal connettore (nota di sospensione in conteggi) NON si riaccende da qui: si ferma e chiede la console.
// Uso: node …/esegui-autorizzato.mjs AUT-… local_… -- npx tsx scripts/c8/accendi-regionale-staging.ts applica <sintel|sardegnacat|sater>
import { createClient } from "@supabase/supabase-js";
import type { ClientDb } from "../../src/lib/radar/notifiche/motore";
import { FermoCollaudo, PRODUZIONE_REF, STAGING_REF, installaOsservatore } from "../collaudo-z8/collaudo-motore-z8";

// Fase 2: anche SATER, per il collaudo sullo staging (la sua riga nasce spenta con la 0134); stessa regola: solo da spenta ad accesa
export const FONTI_ACCENDIBILI = ["sintel", "sardegnacat", "sater"] as const;
export type FonteAccendibile = (typeof FONTI_ACCENDIBILI)[number];
export type EsitoAccensione = { fonte: FonteAccendibile; cambiate: number; primaAttiva: boolean; dopoAttiva: boolean };

/** Il cambio: una riga sola, solo da «spenta» ad «accesa». Mai il contrario, mai un'altra fonte, mai altri campi. */
export async function accendiFonteRegionale(admin: ClientDb, fonte: FonteAccendibile, adesso: Date): Promise<EsitoAccensione> {
  if (!(FONTI_ACCENDIBILI as readonly string[]).includes(fonte)) throw new FermoCollaudo(`fonte non ammessa: ${String(fonte)}`);
  const leggi = async () => {
    const r = await admin.from("radar_fonti_stato").select("fonte, attiva, conteggi").eq("fonte", fonte);
    if (r.error) throw new FermoCollaudo(`lettura della riga ${fonte}: ${r.error.code ?? ""} ${r.error.message ?? ""}`.trim());
    const righe = (r.data ?? []) as { attiva: boolean; conteggi: Record<string, unknown> | null }[];
    if (righe.length !== 1) throw new FermoCollaudo(`la riga «${fonte}» di radar_fonti_stato deve essere una, sono ${righe.length}`);
    return righe[0];
  };
  const prima = await leggi();
  if (!prima.attiva && prima.conteggi && typeof prima.conteggi === "object" && "sospensione" in prima.conteggi) {
    throw new FermoCollaudo(`${fonte} è SOSPESA dal connettore: si riaccende solo dalla console, dopo averne letto il motivo`);
  }
  const r = await admin.from("radar_fonti_stato").update({ attiva: true, aggiornata_il: adesso.toISOString() }).eq("fonte", fonte).eq("attiva", false).select("fonte");
  if (r.error) throw new FermoCollaudo(`scrittura: ${r.error.code ?? ""} ${r.error.message ?? ""}`.trim());
  const cambiate = ((r.data ?? []) as unknown[]).length;
  if (cambiate > 1) throw new FermoCollaudo(`cambiate ${cambiate} righe invece di al più una`);
  const dopo = await leggi();
  if (!dopo.attiva) throw new FermoCollaudo(`dopo la scrittura ${fonte} risulta ancora spenta`);
  return { fonte, cambiate, primaAttiva: prima.attiva, dopoAttiva: dopo.attiva };
}

/** Il lancio vero: autorizzazione, staging soltanto, rete solo verso lo staging. */
export async function applica(ambiente: Record<string, string | undefined>, fonte: FonteAccendibile, registro: { controllaPorta: (x: { script: string }) => unknown }): Promise<EsitoAccensione> {
  registro.controllaPorta({ script: "accendi-regionale-staging.ts" });
  const url = String(ambiente.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/, "");
  if (url !== `https://${STAGING_REF}.supabase.co` || Object.values(ambiente).some((v) => typeof v === "string" && v.includes(PRODUZIONE_REF))) throw new FermoCollaudo("non è lo staging");
  if (ambiente.VERCEL_ENV) throw new FermoCollaudo("VERCEL_ENV presente: lo script non gira su Vercel");
  const fermo = { motivo: null as string | null };
  const osservatore = installaOsservatore(url, fermo);
  try {
    const client = createClient(url, String(ambiente.SUPABASE_SERVICE_ROLE_KEY ?? ""), { auth: { autoRefreshToken: false, persistSession: false } });
    const esito = await accendiFonteRegionale(client as unknown as ClientDb, fonte, new Date());
    if (fermo.motivo) throw new FermoCollaudo(fermo.motivo);
    return esito;
  } finally {
    osservatore.ripristina();
  }
}

async function principale(): Promise<number> {
  const [comando, fonte] = process.argv.slice(2);
  if (comando !== "applica" || !(FONTI_ACCENDIBILI as readonly string[]).includes(fonte ?? "")) {
    console.error("uso: (solo con esegui-autorizzato.mjs) npx tsx scripts/c8/accendi-regionale-staging.ts applica <sintel|sardegnacat|sater>");
    return 2;
  }
  const cartellaRegistro = process.env.TI_REGISTRO;
  if (!cartellaRegistro) {
    console.error("STOP: scrive sullo staging: solo con esegui-autorizzato.mjs e un'autorizzazione registrata");
    return 2;
  }
  const { controllaPorta } = (await import(new URL(`file:///${cartellaRegistro.replace(/\\/g, "/").replace(/^\/+/, "")}/registro.mjs`).href)) as { controllaPorta: (x: { script: string }) => unknown };
  // la guardia anti-produzione condivisa da tutti gli script dello staging (fuori dal repository: percorso calcolato, non risolto da tsc)
  const GUARDIA = "file:///C:/Users/Dell/AppData/Local/Temp/claude/abcfdf0028fd8393/e334def8-d832-4558-942a-9241c500a45d/scratchpad/staging/guardia-staging.mjs";
  const { caricaStaging } = (await import(GUARDIA)) as { caricaStaging: () => Record<string, string> };
  const v = caricaStaging();
  if (v.STAGING_PROJECT_REF !== STAGING_REF) throw new FermoCollaudo("guardia: non è lo staging");
  const e = await applica({ NEXT_PUBLIC_SUPABASE_URL: v.STAGING_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: v.STAGING_SECRET_KEY, VERCEL_ENV: process.env.VERCEL_ENV }, fonte as FonteAccendibile, { controllaPorta });
  console.log(`C8: ${e.fonte} ${e.primaAttiva ? "già accesa" : "spenta"} → ${e.dopoAttiva ? "accesa" : "spenta"}; righe cambiate: ${e.cambiate}`);
  return 0;
}

if (process.argv[1] && /accendi-regionale-staging\.ts$/.test(process.argv[1].replace(/\\/g, "/"))) {
  principale()
    .then((c) => process.exit(c))
    .catch((e) => {
      console.error(`FERMATO: ${e instanceof Error ? e.message : String(e)}`);
      process.exit(e instanceof FermoCollaudo ? 3 : 1);
    });
}
