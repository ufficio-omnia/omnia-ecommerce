// Giro di importazione da TED lanciato a mano, SOLO contro lo staging (stessa funzione del cron). Per il recupero dello storico e le prove.
//
// Uso (variabili dello staging nell'ambiente, mai quelle di produzione):
//   RADAR_STAGING_REF=<identificativo del progetto di staging> npx tsx scripts/radar-importa-ted.ts [pagine massime] [minuti massimi]
// Si ferma se l'indirizzo del database non è quello dello staging dichiarato, o se è quello di produzione.
import { createClient } from "@supabase/supabase-js";
import { eseguiImportazioneTed } from "../src/lib/radar/importa-ted";

const PRODUZIONE = "bihfrzspqxsrzlbqqvqa";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const chiave = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const staging = process.env.RADAR_STAGING_REF ?? "";

if (!url || !chiave) {
  console.error("Mancano le variabili del database.");
  process.exit(2);
}
if (url.includes(PRODUZIONE) || !staging || !url.includes(`${staging}.supabase.co`)) {
  console.error("STOP: questo script gira solo contro lo staging dichiarato in RADAR_STAGING_REF.");
  process.exit(2);
}

async function main() {
  // Regola del 17/11/2026: scritture sullo staging solo con un'autorizzazione registrata del coordinatore.
  const registro = process.env.TI_REGISTRO;
  if (!registro) { console.error("STOP: lanciare con esegui-autorizzato.mjs (autorizzazione registrata del coordinatore)."); process.exit(2); }
  const { controllaPorta } = await import(new URL(`file:///${registro.replace(/\\/g, "/").replace(/^\/+/, "")}/registro.mjs`).href);
  try { controllaPorta({ script: "radar-importa-ted.ts" }); } catch (e) { console.error(e instanceof Error ? e.message : e); process.exit(2); }

  const pagine = Number(process.argv[2] ?? 40);
  const minuti = Number(process.argv[3] ?? 10);
  const admin = createClient(url, chiave, { auth: { persistSession: false, autoRefreshToken: false } });
  const esito = await eseguiImportazioneTed(admin, { tempoMassimoMs: minuti * 60_000, pagineMassime: pagine, origine: "script" });
  console.log(JSON.stringify(esito, null, 1));
  process.exit(esito.eseguita && !esito.errore ? 0 : 1);
}

main();
