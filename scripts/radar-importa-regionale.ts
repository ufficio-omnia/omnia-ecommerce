// Giro di importazione di una fonte regionale (Sintel, SardegnaCAT) lanciato a mano, SOLO contro lo staging (stessa funzione del futuro
// cron e della console). Per le prove della fase B2b, con un'autorizzazione registrata del coordinatore.
//
// Uso (variabili dello staging nell'ambiente, mai quelle di produzione), SOLO tramite il lanciatore autorizzato:
//   RADAR_STAGING_REF=<identificativo del progetto di staging> npx tsx scripts/radar-importa-regionale.ts <sintel|sardegnacat> [richieste massime]
// Si ferma se l'indirizzo del database non è quello dello staging dichiarato, se è quello di produzione, se la guardia del codice
// (src/lib/radar/ambiente.ts) non riconosce lo staging, o se non c'è una ricevuta aperta del lanciatore. Stampa solo numeri e motivi.
import { createClient } from "@supabase/supabase-js";
import { eseguiImportazioneRegionale } from "../src/lib/radar/importa-regionali";
import { PROGETTO_PRODUZIONE } from "../src/lib/radar/ambiente";
import { FONTI_REGIONALI, type FonteRegionale } from "../src/lib/radar/importa-regionali-calcoli";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const chiave = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const staging = process.env.RADAR_STAGING_REF ?? "";

if (!url || !chiave) {
  console.error("Mancano le variabili del database.");
  process.exit(2);
}
if (url.includes(PROGETTO_PRODUZIONE) || chiave.includes(PROGETTO_PRODUZIONE) || !staging || !url.includes(`${staging}.supabase.co`)) {
  console.error("STOP: questo script gira solo contro lo staging dichiarato in RADAR_STAGING_REF.");
  process.exit(2);
}

async function main() {
  // Regola del 17/11/2026: scritture sullo staging solo con un'autorizzazione registrata del coordinatore.
  const registro = process.env.TI_REGISTRO;
  if (!registro) { console.error("STOP: lanciare con esegui-autorizzato.mjs (autorizzazione registrata del coordinatore)."); process.exit(2); }
  const { controllaPorta } = await import(new URL(`file:///${registro.replace(/\\/g, "/").replace(/^\/+/, "")}/registro.mjs`).href);
  try { controllaPorta({ script: "radar-importa-regionale.ts" }); } catch (e) { console.error(e instanceof Error ? e.message : e); process.exit(2); }

  const [fonte, a1] = process.argv.slice(2);
  if (!(FONTI_REGIONALI as readonly string[]).includes(fonte ?? "")) {
    console.error(`Uso: <${FONTI_REGIONALI.join("|")}> [richieste massime]`);
    process.exit(2);
  }
  const richieste = Number(a1);
  const admin = createClient(url, chiave, { auth: { persistSession: false, autoRefreshToken: false } });
  const esito = await eseguiImportazioneRegionale(admin, fonte as FonteRegionale, {
    tempoMassimoMs: 10 * 60_000,
    limiti: Number.isInteger(richieste) && richieste > 0 ? { richiesteMassime: richieste } : undefined,
  });
  console.log(JSON.stringify(esito, null, 1));
  process.exit(esito.eseguita && !esito.errore ? 0 : 1);
}

main();
