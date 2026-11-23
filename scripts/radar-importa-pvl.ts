// Giro di importazione dalla PVL di ANAC lanciato a mano, SOLO contro lo staging (stessa funzione della console e del futuro cron).
// Per la prima importazione controllata (finestra di giorni concordata) e per le prove.
//
// Uso (variabili dello staging nell'ambiente, mai quelle di produzione):
//   RADAR_STAGING_REF=<identificativo del progetto di staging> npx tsx scripts/radar-importa-pvl.ts finestra <da AAAA-MM-GG> <a AAAA-MM-GG> [richieste massime]
//   RADAR_STAGING_REF=<...> npx tsx scripts/radar-importa-pvl.ts incrementale [richieste massime]
// Si ferma se l'indirizzo del database non è quello dello staging dichiarato, se è quello di produzione, o se la guardia del codice
// (src/lib/radar/ambiente.ts) non riconosce lo staging. Stampa le statistiche del giro (nessun valore segreto).
import { createClient } from "@supabase/supabase-js";
import { eseguiImportazionePvl } from "../src/lib/radar/importa-pvl";
import { PROGETTO_PRODUZIONE } from "../src/lib/radar/ambiente";

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
  try { controllaPorta({ script: "radar-importa-pvl.ts" }); } catch (e) { console.error(e instanceof Error ? e.message : e); process.exit(2); }

  const [modo, a1, a2, a3] = process.argv.slice(2);
  if (modo !== "finestra" && modo !== "incrementale") {
    console.error("Uso: finestra <da> <a> [richieste] | incrementale [richieste]");
    process.exit(2);
  }
  const richieste = Number(modo === "finestra" ? a3 : a1);
  const admin = createClient(url, chiave, { auth: { persistSession: false, autoRefreshToken: false } });
  const esito = await eseguiImportazionePvl(admin, {
    modo,
    da: modo === "finestra" ? a1 : undefined,
    a: modo === "finestra" ? a2 : undefined,
    tempoMassimoMs: 10 * 60_000,
    origine: "script",
    limiti: Number.isInteger(richieste) && richieste > 0 ? { richiesteMassime: richieste } : undefined,
  });
  console.log(JSON.stringify(esito, null, 1));
  process.exit(esito.eseguita && !esito.errore ? 0 : 1);
}

main();
