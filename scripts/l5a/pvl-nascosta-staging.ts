// L5a del piano 36 (decisione 7.14), documento 47, B2, 23/11/2026: la PVL NASCOSTA ai clienti sullo STAGING. Cambia UNA riga:
//   update public.radar_fonti_stato set nascosta_ai_clienti = true, aggiornata_il = now() where fonte = 'pvl' and nascosta_ai_clienti = false;
// Lo fa con il client di servizio (una sola richiesta PATCH di PostgREST, atomica), solo con esegui-autorizzato.mjs e un'autorizzazione
// registrata. Idempotente: se la PVL è già nascosta non cambia nulla. Si ferma se la riga «pvl» manca o se cambierebbe più di una riga.
// Uso: node …/esegui-autorizzato.mjs AUT-… local_… -- npx tsx scripts/l5a/pvl-nascosta-staging.ts applica
import { createClient } from "@supabase/supabase-js";
import type { ClientDb } from "../../src/lib/radar/notifiche/motore";
import { FermoCollaudo, PRODUZIONE_REF, STAGING_REF, installaOsservatore } from "../collaudo-z8/collaudo-motore-z8";

export type EsitoL5a = { cambiate: number; prima: boolean | null; dopo: boolean | null };

/** Il cambio: una riga sola, solo da «visibile» a «nascosta». Mai il contrario, mai un'altra fonte. */
export async function nascondiPvl(admin: ClientDb, adesso: Date): Promise<EsitoL5a> {
  const leggi = async () => {
    const r = await admin.from("radar_fonti_stato").select("fonte, nascosta_ai_clienti").eq("fonte", "pvl");
    if (r.error) throw new FermoCollaudo(`lettura della riga pvl: ${r.error.code ?? ""} ${r.error.message ?? ""}`.trim());
    const righe = (r.data ?? []) as { nascosta_ai_clienti: boolean }[];
    if (righe.length !== 1) throw new FermoCollaudo(`la riga «pvl» di radar_fonti_stato deve essere una, sono ${righe.length}`);
    return righe[0].nascosta_ai_clienti === true;
  };
  const prima = await leggi();
  const r = await admin
    .from("radar_fonti_stato")
    .update({ nascosta_ai_clienti: true, aggiornata_il: adesso.toISOString() })
    .eq("fonte", "pvl")
    .eq("nascosta_ai_clienti", false)
    .select("fonte");
  if (r.error) throw new FermoCollaudo(`scrittura: ${r.error.code ?? ""} ${r.error.message ?? ""}`.trim());
  const cambiate = ((r.data ?? []) as unknown[]).length;
  if (cambiate > 1) throw new FermoCollaudo(`cambiate ${cambiate} righe invece di al più una`);
  const dopo = await leggi();
  if (!dopo) throw new FermoCollaudo("dopo la scrittura la PVL non risulta nascosta");
  return { cambiate, prima, dopo };
}

/** Il lancio vero: autorizzazione, staging soltanto, rete solo verso lo staging. */
export async function applica(ambiente: Record<string, string | undefined>, registro: { controllaPorta: (x: { script: string }) => unknown }): Promise<EsitoL5a> {
  registro.controllaPorta({ script: "pvl-nascosta-staging.ts" });
  const url = String(ambiente.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/, "");
  if (url !== `https://${STAGING_REF}.supabase.co` || Object.values(ambiente).some((v) => typeof v === "string" && v.includes(PRODUZIONE_REF))) throw new FermoCollaudo("non è lo staging");
  if (ambiente.VERCEL_ENV) throw new FermoCollaudo("VERCEL_ENV presente: lo script non gira su Vercel");
  const fermo = { motivo: null as string | null };
  const osservatore = installaOsservatore(url, fermo);
  try {
    const client = createClient(url, String(ambiente.SUPABASE_SERVICE_ROLE_KEY ?? ""), { auth: { autoRefreshToken: false, persistSession: false } });
    const esito = await nascondiPvl(client as unknown as ClientDb, new Date());
    if (fermo.motivo) throw new FermoCollaudo(fermo.motivo);
    return esito;
  } finally {
    osservatore.ripristina();
  }
}

async function principale(): Promise<number> {
  if (process.argv[2] !== "applica") {
    console.error("uso: (solo con esegui-autorizzato.mjs) npx tsx scripts/l5a/pvl-nascosta-staging.ts applica");
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
  const e = await applica({ NEXT_PUBLIC_SUPABASE_URL: v.STAGING_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: v.STAGING_SECRET_KEY, VERCEL_ENV: process.env.VERCEL_ENV }, { controllaPorta });
  console.log(`L5a: PVL ${e.prima ? "già nascosta" : "visibile"} → ${e.dopo ? "nascosta" : "visibile"}; righe cambiate: ${e.cambiate}`);
  return 0;
}

if (process.argv[1] && /pvl-nascosta-staging\.ts$/.test(process.argv[1].replace(/\\/g, "/"))) {
  principale()
    .then((c) => process.exit(c))
    .catch((e) => {
      console.error(`FERMATO: ${e instanceof Error ? e.message : String(e)}`);
      process.exit(e instanceof FermoCollaudo ? 3 : 1);
    });
}
