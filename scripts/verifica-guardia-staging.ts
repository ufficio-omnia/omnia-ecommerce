// Verifica della guardia anti-produzione delle anteprime di Tender Intelligence (scripts/lib/guardia-ambiente-staging.mjs) e del suo avvio
// (scripts/avvia-anteprima-staging.mjs). Solo ambienti SINTETICI: nessun file d'ambiente vero, nessuna chiave vera, nessuna rete.
import fs from "fs";
import path from "path";
import { FILE_AMMESSI, PROGETTO_PRODUZIONE, PROGETTO_STAGING, VARIABILI_SUPABASE, controllaAmbiente, verificaChiaviSulloStaging } from "./lib/guardia-ambiente-staging.mjs";

const fallimenti: string[] = [];
function atteso(nome: string, ok: boolean, dettaglio = "") {
  console.log(`${ok ? "ok    " : "FALLITO"} ${nome}${ok || !dettaglio ? "" : ` — ${dettaglio}`}`);
  if (!ok) fallimenti.push(nome);
}

const jwt = (payload: object) => `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.firma-sintetica`;
const STAGING_OK = {
  NEXT_PUBLIC_SUPABASE_URL: `https://${PROGETTO_STAGING}.supabase.co`,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_publishable_SINTETICA",
  SUPABASE_SERVICE_ROLE_KEY: "sb_secret_SINTETICA",
  RESEND_API_KEY: "",
};
const FILE_OK = [".env.development.local"];

async function main() {
  atteso("ammesso un solo file d'ambiente: .env.development.local", JSON.stringify(FILE_AMMESSI) === JSON.stringify([".env.development.local"]));
  atteso("le tre variabili Supabase usate dal codice sono quelle controllate", JSON.stringify(VARIABILI_SUPABASE) === JSON.stringify(["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"]));
  const usate = new Set<string>();
  const leggiCartella = (d: string) => {
    for (const f of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, f.name);
      if (f.isDirectory()) leggiCartella(p);
      else if (/\.(ts|tsx)$/.test(f.name)) for (const m of fs.readFileSync(p, "utf8").matchAll(/process\.env\.([A-Z0-9_]*SUPABASE[A-Z0-9_]*)/g)) usate.add(m[1]);
    }
  };
  leggiCartella(path.join(__dirname, "../src"));
  atteso("nel codice dell'applicazione non ci sono altre variabili Supabase oltre alle tre controllate", [...usate].every((v) => VARIABILI_SUPABASE.includes(v)), [...usate].join(", "));

  atteso("ambiente dello staging: avvio consentito", controllaAmbiente({ env: STAGING_OK, fileCaricati: FILE_OK }).ok);
  const conEnvLocal = controllaAmbiente({ env: STAGING_OK, fileCaricati: [".env.development.local", ".env.local"] });
  atteso("caso dell'incidente: .env.local caricato → bloccato", !conEnvLocal.ok && conEnvLocal.problemi.some((p) => p.includes(".env.local")));
  for (const f of [".env", ".env.development", ".env.production", ".env.production.local"]) {
    atteso(`${f} caricato → bloccato`, !controllaAmbiente({ env: STAGING_OK, fileCaricati: [...FILE_OK, f] }).ok);
  }
  const urlProd = controllaAmbiente({ env: { ...STAGING_OK, NEXT_PUBLIC_SUPABASE_URL: `https://${PROGETTO_PRODUZIONE}.supabase.co` }, fileCaricati: FILE_OK });
  atteso("indirizzo di produzione (anche da una variabile del processo) → bloccato", !urlProd.ok && urlProd.problemi.some((p) => p.includes("PRODUZIONE")));
  atteso("indirizzo di un altro progetto → bloccato", !controllaAmbiente({ env: { ...STAGING_OK, NEXT_PUBLIC_SUPABASE_URL: "https://altroprogetto.supabase.co" }, fileCaricati: FILE_OK }).ok);
  atteso("connessione al database di produzione in qualunque variabile → bloccato", !controllaAmbiente({ env: { ...STAGING_OK, DATABASE_URL: `postgresql://postgres.${PROGETTO_PRODUZIONE}:x@aws-0-eu-west-1.pooler.supabase.com:5432/postgres` }, fileCaricati: FILE_OK }).ok);
  atteso("chiave JWT di produzione → bloccato", !controllaAmbiente({ env: { ...STAGING_OK, SUPABASE_SERVICE_ROLE_KEY: jwt({ ref: PROGETTO_PRODUZIONE, role: "service_role" }) }, fileCaricati: FILE_OK }).ok);
  atteso("chiave JWT di un altro progetto → bloccato", !controllaAmbiente({ env: { ...STAGING_OK, NEXT_PUBLIC_SUPABASE_ANON_KEY: jwt({ ref: "altroprogetto", role: "anon" }) }, fileCaricati: FILE_OK }).ok);
  atteso("chiave JWT dello staging → consentita", controllaAmbiente({ env: { ...STAGING_OK, NEXT_PUBLIC_SUPABASE_ANON_KEY: jwt({ ref: PROGETTO_STAGING, role: "anon" }) }, fileCaricati: FILE_OK }).ok);
  atteso("chiave mancante → bloccato", !controllaAmbiente({ env: { ...STAGING_OK, SUPABASE_SERVICE_ROLE_KEY: "" }, fileCaricati: FILE_OK }).ok);
  atteso("chiave Stripe reale → bloccato", !controllaAmbiente({ env: { ...STAGING_OK, STRIPE_SECRET_KEY: "sk_live_SINTETICA" }, fileCaricati: FILE_OK }).ok);
  atteso("chiave Resend valorizzata → bloccato (nessuna email vera)", !controllaAmbiente({ env: { ...STAGING_OK, RESEND_API_KEY: "re_SINTETICA" }, fileCaricati: FILE_OK }).ok);
  const segreto = "sb_secret_DA_NON_STAMPARE";
  const esitoSegreto = controllaAmbiente({ env: { ...STAGING_OK, NEXT_PUBLIC_SUPABASE_URL: `https://${PROGETTO_PRODUZIONE}.supabase.co`, SUPABASE_SERVICE_ROLE_KEY: segreto, ALTRA: `https://${PROGETTO_PRODUZIONE}.supabase.co/x` }, fileCaricati: FILE_OK });
  atteso("i messaggi nominano le variabili, mai i valori", esitoSegreto.problemi.every((p) => !p.includes(segreto) && !p.includes("https://")));

  const finta = (stato: number) => (async () => new Response("{}", { status: stato })) as unknown as typeof fetch;
  atteso("chiavi accettate dallo staging → nessun problema", (await verificaChiaviSulloStaging(STAGING_OK, finta(200))).length === 0);
  atteso("chiave rifiutata dallo staging (per esempio di produzione) → bloccato", (await verificaChiaviSulloStaging(STAGING_OK, finta(401))).length === 2);
  const rotta = (async () => {
    throw new Error("rete assente");
  }) as unknown as typeof fetch;
  atteso("staging non raggiungibile → bloccato (nel dubbio non si parte)", (await verificaChiaviSulloStaging(STAGING_OK, rotta)).length === 2);

  const avvio = fs.readFileSync(path.join(__dirname, "avvia-anteprima-staging.mjs"), "utf8");
  atteso("avvio: l'ambiente si calcola come fa `next dev` (file + variabili del processo)", avvio.includes('loadEnvConfig(cartella, true'));
  atteso("avvio: guardia e controllo delle chiavi PRIMA di far partire il server, uscita con errore se bloccato", avvio.indexOf("controllaAmbiente(") < avvio.indexOf("spawn(") && avvio.indexOf("verificaChiaviSulloStaging(") < avvio.indexOf("spawn(") && avvio.includes("process.exit(1);"));
  atteso("avvio: il server parte dalla cartella dello script, qualunque sia la radice del pannello", avvio.includes('path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")') && avvio.includes("{ cwd: cartella,"));
  atteso("avvio: nessun valore stampato", !/console\.(log|error)\([^)]*(combinedEnv|process\.env)/.test(avvio));

  if (fallimenti.length) {
    console.error(`\n${fallimenti.length} controlli falliti:\n- ${fallimenti.join("\n- ")}`);
    process.exit(1);
  }
  console.log("\nTutti i controlli della guardia anti-produzione sono superati.");
}

main();
