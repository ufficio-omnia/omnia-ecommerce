// 48E (decisione dell'utente del 23/11/2026, D4-bis, revoca della regola della 0120 «nascosta finché manca il parere legale»): SardegnaCAT
// VISIBILE ai clienti sullo STAGING. Stessa forma del 48B della PVL (scripts/pvl-visibile/pvl-visibile-staging.ts); cambia UNA riga:
//   update public.radar_fonti_stato set nascosta_ai_clienti = false, aggiornata_il = now() where fonte = 'sardegnacat' and nascosta_ai_clienti = true;
// Lo fa con il client di servizio (una sola richiesta PATCH di PostgREST, atomica), solo con esegui-autorizzato.mjs e un'autorizzazione
// registrata. Idempotente: se SardegnaCAT è già visibile non cambia nulla. Si ferma se la riga «sardegnacat» manca o se cambierebbe più di
// una riga. In produzione SERVE la stessa riga dopo la 0120, che crea la riga nascosta (0120:76): passo del piano di rilascio, con la sua
// autorizzazione (il file 0120 non si cambia).
// Uso: node …/esegui-autorizzato.mjs AUT-… local_… -- npx tsx scripts/sardegnacat-visibile/sardegnacat-visibile-staging.ts applica
import { createClient } from "@supabase/supabase-js";
import type { ClientDb } from "../../src/lib/radar/notifiche/motore";
import { FermoCollaudo, PRODUZIONE_REF, STAGING_REF, installaOsservatore } from "../collaudo-z8/collaudo-motore-z8";

export type EsitoSardegnacatVisibile = { cambiate: number; primaNascosta: boolean; dopoNascosta: boolean };

/** Il cambio: una riga sola, solo da «nascosta» a «visibile». Mai il contrario, mai un'altra fonte, mai altri campi. */
export async function rendiSardegnacatVisibile(admin: ClientDb, adesso: Date): Promise<EsitoSardegnacatVisibile> {
  const leggi = async () => {
    const r = await admin.from("radar_fonti_stato").select("fonte, nascosta_ai_clienti").eq("fonte", "sardegnacat");
    if (r.error) throw new FermoCollaudo(`lettura della riga sardegnacat: ${r.error.code ?? ""} ${r.error.message ?? ""}`.trim());
    const righe = (r.data ?? []) as { nascosta_ai_clienti: boolean }[];
    if (righe.length !== 1) throw new FermoCollaudo(`la riga «sardegnacat» di radar_fonti_stato deve essere una, sono ${righe.length}`);
    return righe[0].nascosta_ai_clienti === true;
  };
  const primaNascosta = await leggi();
  const r = await admin
    .from("radar_fonti_stato")
    .update({ nascosta_ai_clienti: false, aggiornata_il: adesso.toISOString() })
    .eq("fonte", "sardegnacat")
    .eq("nascosta_ai_clienti", true)
    .select("fonte");
  if (r.error) throw new FermoCollaudo(`scrittura: ${r.error.code ?? ""} ${r.error.message ?? ""}`.trim());
  const cambiate = ((r.data ?? []) as unknown[]).length;
  if (cambiate > 1) throw new FermoCollaudo(`cambiate ${cambiate} righe invece di al più una`);
  const dopoNascosta = await leggi();
  if (dopoNascosta) throw new FermoCollaudo("dopo la scrittura SardegnaCAT risulta ancora nascosta");
  return { cambiate, primaNascosta, dopoNascosta };
}

/** Il lancio vero: autorizzazione, staging soltanto, rete solo verso lo staging. */
export async function applica(ambiente: Record<string, string | undefined>, registro: { controllaPorta: (x: { script: string }) => unknown }): Promise<EsitoSardegnacatVisibile> {
  registro.controllaPorta({ script: "sardegnacat-visibile-staging.ts" });
  const url = String(ambiente.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/, "");
  if (url !== `https://${STAGING_REF}.supabase.co` || Object.values(ambiente).some((v) => typeof v === "string" && v.includes(PRODUZIONE_REF))) throw new FermoCollaudo("non è lo staging");
  if (ambiente.VERCEL_ENV) throw new FermoCollaudo("VERCEL_ENV presente: lo script non gira su Vercel");
  const fermo = { motivo: null as string | null };
  const osservatore = installaOsservatore(url, fermo);
  try {
    const client = createClient(url, String(ambiente.SUPABASE_SERVICE_ROLE_KEY ?? ""), { auth: { autoRefreshToken: false, persistSession: false } });
    const esito = await rendiSardegnacatVisibile(client as unknown as ClientDb, new Date());
    if (fermo.motivo) throw new FermoCollaudo(fermo.motivo);
    return esito;
  } finally {
    osservatore.ripristina();
  }
}

async function principale(): Promise<number> {
  if (process.argv[2] !== "applica") {
    console.error("uso: (solo con esegui-autorizzato.mjs) npx tsx scripts/sardegnacat-visibile/sardegnacat-visibile-staging.ts applica");
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
  console.log(`48E: SardegnaCAT ${e.primaNascosta ? "nascosta" : "già visibile"} → ${e.dopoNascosta ? "nascosta" : "visibile"}; righe cambiate: ${e.cambiate}`);
  return 0;
}

if (process.argv[1] && /sardegnacat-visibile-staging\.ts$/.test(process.argv[1].replace(/\\/g, "/"))) {
  principale()
    .then((c) => process.exit(c))
    .catch((e) => {
      console.error(`FERMATO: ${e instanceof Error ? e.message : String(e)}`);
      process.exit(e instanceof FermoCollaudo ? 3 : 1);
    });
}
