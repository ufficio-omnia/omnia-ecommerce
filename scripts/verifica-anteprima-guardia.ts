// SOLO SUL RAMO anteprima/tender-intelligence-b3. Verifica della guardia della Vercel Preview di Tender Intelligence:
// src/lib/anteprima-guardia-ambiente.ts, scripts/guardia-anteprima.ts, scripts/verifica-bundle-anteprima.ts, e dei punti in
// cui sono agganciate (next.config.ts, src/proxy.ts, package.json). Solo ambienti SINTETICI: nessun file d'ambiente vero,
// nessuna chiave vera, nessuna rete (la rete è simulata).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  CONFIGURAZIONI_LIBERE,
  INTERRUTTORI_SPENTI,
  RAMO_ANTEPRIMA,
  SERVIZI_FINTI,
  STAGING_REF,
  STAGING_URL,
  VARIABILI_SUPABASE,
  erroriAmbienteAnteprima,
  variabiliCatalogate,
} from "../src/lib/anteprima-guardia-ambiente";
import { erroriChiaviSulloStaging, fileAmbienteNelProgetto } from "./guardia-anteprima";
import { erroriCodiceCompilato } from "./verifica-bundle-anteprima";

const fallimenti: string[] = [];
function atteso(nome: string, ok: boolean, dettaglio = "") {
  console.log(`${ok ? "ok    " : "FALLITO"} ${nome}${ok || !dettaglio ? "" : ` — ${dettaglio}`}`);
  if (!ok) fallimenti.push(nome);
}

const RADICE = path.resolve(__dirname, "..");
const PRODUZIONE = "bihfrzspqxsrzlbqqvqa";
const jwt = (payload: object) => `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.firma-sintetica`;
const SEGRETO_SINTETICO = "segreto-sintetico-dell-anteprima-0123456789abcdef";
const VALIDO: Record<string, string> = {
  NODE_ENV: "production",
  VERCEL: "1",
  VERCEL_ENV: "preview",
  VERCEL_GIT_COMMIT_REF: RAMO_ANTEPRIMA,
  NEXT_PUBLIC_VERCEL_ENV: "preview",
  VERCEL_PROJECT_PRODUCTION_URL: "app.omniaitalia.com",
  NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL: "app.omniaitalia.com",
  NEXT_PUBLIC_VERCEL_URL: "omnia-ecommerce-abc123-ufficio-omnia.vercel.app",
  NEXT_PUBLIC_SUPABASE_URL: STAGING_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_publishable_SINTETICA",
  SUPABASE_SERVICE_ROLE_KEY: "sb_secret_SINTETICA",
  NEXT_PUBLIC_SITE_URL: "https://anteprima-ti-staging.invalid",
  CRON_SECRET: SEGRETO_SINTETICO,
  DEMO_CONSENT_SIGNING_SECRET: SEGRETO_SINTETICO + "-consenso",
  DEMO_LEADS_HASH_SECRET: SEGRETO_SINTETICO + "-ip",
  ...SERVIZI_FINTI,
  DEMO_LEADS_ATTIVO: "0",
  DEMO_ADS_VALIDATE_ONLY: "1",
};
const blocca = (nome: string, modifiche: Record<string, string | undefined>, frammento?: string) => {
  const errori = erroriAmbienteAnteprima({ ...VALIDO, ...modifiche });
  atteso(nome, errori.length > 0 && (!frammento || errori.some((x) => x.includes(frammento))), errori.join(" | ") || "nessun errore");
};

async function principale() {
  // 1. Il catalogo copre OGNI variabile che il codice dell'applicazione legge.
  const lette = new Set<string>();
  const leggi = (p: string) => {
    const testo = fs.readFileSync(p, "utf8");
    // L'ultima espressione prende i nomi passati come testo a una funzione che legge l'ambiente (es. il refresh token di
    // Google in credenzialiDaAmbiente): solo nomi che finiscono per _TOKEN, _SECRET o _API_KEY, preceduti da una virgola o
    // da una parentesi (argomento di funzione), per non confondere codici di errore come «RISPOSTA_SENZA_TOKEN».
    for (const re of [/process\.env\.([A-Z][A-Z0-9_]+)/g, /\benv\??\.([A-Z][A-Z0-9_]{3,})\b/g, /process\.env\["([A-Z][A-Z0-9_]+)"\]/g, /[(,]\s*"([A-Z][A-Z0-9]*_[A-Z0-9_]*(?:_TOKEN|_SECRET|_API_KEY))"/g]) {
      for (const m of testo.matchAll(re)) lette.add(m[1]);
    }
  };
  const cartella = (d: string) => {
    for (const f of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, f.name);
      if (f.isDirectory()) cartella(p);
      else if (/\.(ts|tsx|mjs|js)$/.test(f.name)) leggi(p);
    }
  };
  cartella(path.join(RADICE, "src"));
  leggi(path.join(RADICE, "next.config.ts"));
  const catalogo = variabiliCatalogate();
  const fuori = [...lette].filter((v) => !catalogo.has(v) && !v.startsWith("NEXT_PUBLIC_VERCEL_") && v !== "VERCEL_GIT_COMMIT_REF");
  atteso(`ogni variabile letta dal codice (${lette.size}) è nel catalogo della guardia`, fuori.length === 0, fuori.join(", "));
  atteso("le variabili Supabase sono le tre attese", JSON.stringify(VARIABILI_SUPABASE) === JSON.stringify(["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"]));
  atteso("nessuna variabile Supabase nel codice oltre alle tre", [...lette].filter((v) => v.includes("SUPABASE")).every((v) => VARIABILI_SUPABASE.includes(v)));

  // 2. Ambienti ammessi.
  atteso("anteprima sullo staging con servizi finti: ammessa", erroriAmbienteAnteprima(VALIDO).length === 0, erroriAmbienteAnteprima(VALIDO).join(" | "));
  const senzaServizi = { ...VALIDO };
  for (const k of Object.keys(SERVIZI_FINTI)) delete senzaServizi[k];
  atteso("servizi esterni vuoti: ammessa", erroriAmbienteAnteprima(senzaServizi).length === 0, erroriAmbienteAnteprima(senzaServizi).join(" | "));
  const locale = { ...VALIDO, VERCEL: "", VERCEL_ENV: "", VERCEL_GIT_COMMIT_REF: "" };
  atteso("fuori da Vercel (prova locale) con lo stesso ambiente: ammessa", erroriAmbienteAnteprima(locale).length === 0);
  atteso("indirizzo *.vercel.app come NEXT_PUBLIC_SITE_URL: ammesso", erroriAmbienteAnteprima({ ...VALIDO, NEXT_PUBLIC_SITE_URL: "https://omnia-ecommerce-git-anteprima-ufficio-omnia.vercel.app" }).length === 0);

  // 3. Supabase.
  blocca("URL Supabase di produzione → bloccato", { NEXT_PUBLIC_SUPABASE_URL: `https://${PRODUZIONE}.supabase.co` }, "NEXT_PUBLIC_SUPABASE_URL");
  blocca("URL di un altro progetto Supabase → bloccato", { NEXT_PUBLIC_SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co" }, "NEXT_PUBLIC_SUPABASE_URL");
  blocca("URL Supabase mancante → bloccato", { NEXT_PUBLIC_SUPABASE_URL: undefined }, "NEXT_PUBLIC_SUPABASE_URL");
  blocca("chiave pubblica JWT del progetto di produzione → bloccato", { NEXT_PUBLIC_SUPABASE_ANON_KEY: jwt({ iss: "supabase", ref: PRODUZIONE, role: "anon" }) }, "NEXT_PUBLIC_SUPABASE_ANON_KEY");
  blocca("chiave di servizio JWT del progetto di produzione → bloccato", { SUPABASE_SERVICE_ROLE_KEY: jwt({ iss: "supabase", ref: PRODUZIONE, role: "service_role" }) }, "SUPABASE_SERVICE_ROLE_KEY");
  blocca("chiave JWT Supabase senza progetto, in una variabile qualunque → bloccato", { ALTRA_CHIAVE: jwt({ iss: "supabase", role: "service_role" }) }, "ALTRA_CHIAVE");
  blocca("chiave di servizio mancante → bloccato", { SUPABASE_SERVICE_ROLE_KEY: undefined }, "SUPABASE_SERVICE_ROLE_KEY");

  // 4. Controllo generale su tutte le variabili.
  blocca("identificativo di produzione in una variabile qualunque → bloccato", { QUALSIASI: `x-${PRODUZIONE}-y` }, "QUALSIASI");
  blocca("stringa di connessione al database → bloccato", { DATABASE_URL: "postgresql://utente:segreto@host-sintetico:5432/postgres" }, "DATABASE_URL");
  blocca("indirizzo di un altro progetto Supabase in una variabile qualunque → bloccato", { ALTRO: "https://abcdefghijklmnopqrst.supabase.co/rest/v1" }, "ALTRO");
  blocca("chiave Stripe live → bloccato", { STRIPE_SECRET_KEY: "sk_live_SINTETICA" }, "live");
  blocca("chiave Stripe live limitata in una variabile qualunque → bloccato", { CHIAVE_X: "rk_live_SINTETICA" }, "CHIAVE_X");
  blocca("dominio omnia-ai.it in una variabile qualunque → bloccato", { DEMO_CALENDAR_INTERNAL_DOMAINS: "omnia-ai.it" }, "DEMO_CALENDAR_INTERNAL_DOMAINS");
  blocca("dominio omniaitalia.com come indirizzo del sito → bloccato", { NEXT_PUBLIC_SITE_URL: "https://app.omniaitalia.com" }, "NEXT_PUBLIC_SITE_URL");
  blocca("variabile di framework *_URL con un percorso → bloccato", { NEXT_PUBLIC_VERCEL_URL: "https://host/percorso" }, "NEXT_PUBLIC_VERCEL_URL");
  atteso("variabili di sistema di Vercel con il dominio di produzione: ammesse", erroriAmbienteAnteprima({ ...VALIDO, VERCEL_PROJECT_PRODUCTION_URL: "app.omniaitalia.com", VERCEL_GIT_COMMIT_MESSAGE: "omnia-ai.it" }).length === 0);

  // 5. Servizi esterni, interruttori, segreti.
  for (const k of Object.keys(SERVIZI_FINTI)) blocca(`${k} con un valore vero (non finto) → bloccato`, { [k]: `valore-non-finto-${k.toLowerCase()}` }, k);
  const accesi: Record<string, string> = { DEMO_ADS_VALIDATE_ONLY: "0", OMNIA_AI_MODELLO_PROVA: "leggero", DEMO_GA4_MP_DEBUG: "acceso", RADAR_PVL_CRON: "attivo" };
  for (const k of Object.keys(INTERRUTTORI_SPENTI)) blocca(`${k} acceso → bloccato`, { [k]: accesi[k] ?? "1" }, k);
  blocca("CRON_SECRET mancante → bloccato", { CRON_SECRET: undefined }, "CRON_SECRET");
  blocca("CRON_SECRET corto → bloccato", { CRON_SECRET: "corto" }, "CRON_SECRET");
  blocca("segreto facoltativo corto → bloccato", { DEMO_CONSENT_SIGNING_SECRET: "corto" }, "DEMO_CONSENT_SIGNING_SECRET");
  atteso("configurazioni libere senza credenziali: elenco noto", CONFIGURAZIONI_LIBERE.includes("NEXT_PUBLIC_SITE_URL") && CONFIGURAZIONI_LIBERE.length === 11);

  // 6. Piattaforma.
  blocca("su Vercel in produzione → bloccato", { VERCEL_ENV: "production" }, "VERCEL_ENV");
  blocca("su Vercel in sviluppo → bloccato", { VERCEL_ENV: "development" }, "VERCEL_ENV");
  blocca("su Vercel senza NEXT_PUBLIC_VERCEL_ENV=preview (i tag Google non si spegnerebbero nel browser) → bloccato", { NEXT_PUBLIC_VERCEL_ENV: undefined }, "NEXT_PUBLIC_VERCEL_ENV");
  blocca("ramo master → bloccato", { VERCEL_GIT_COMMIT_REF: "master" }, "VERCEL_GIT_COMMIT_REF");
  blocca("ramo feature/tender-intelligence → bloccato", { VERCEL_GIT_COMMIT_REF: "feature/tender-intelligence" }, "VERCEL_GIT_COMMIT_REF");

  // 7. I messaggi non contengono mai valori.
  const conSegreti = erroriAmbienteAnteprima({ ...VALIDO, NEXT_PUBLIC_SUPABASE_URL: `https://${PRODUZIONE}.supabase.co`, RESEND_API_KEY: "re_VALORE_DA_NON_STAMPARE", DATABASE_URL: "postgresql://u:PASSWORD_DA_NON_STAMPARE@h/db", CRON_SECRET: "CORTO_DA_NON_STAMPARE" }).join("\n");
  atteso("i messaggi nominano le variabili ma non ne stampano i valori", !/DA_NON_STAMPARE|bihfrzspqxsrzlbqqvqa\.supabase/.test(conSegreti) && conSegreti.includes("RESEND_API_KEY"));

  // 8. File d'ambiente nella cartella del progetto.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "anteprima-guardia-"));
  try {
    fs.writeFileSync(path.join(tmp, ".env.example"), "X=1\n");
    atteso("solo .env.example: nessun file d'ambiente segnalato", fileAmbienteNelProgetto(tmp).length === 0);
    fs.writeFileSync(path.join(tmp, ".env.local"), "X=1\n");
    fs.writeFileSync(path.join(tmp, ".env"), "X=1\n");
    const trovati = fileAmbienteNelProgetto(tmp).sort();
    atteso("caso dell'incidente: .env.local (e .env) nella cartella → segnalati", JSON.stringify(trovati) === JSON.stringify([".env", ".env.local"]), trovati.join(", "));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  // 9. Prova di rete delle chiavi: solo verso lo staging, simulata.
  const chiamate: string[] = [];
  const finta = (stato: number | "errore") => (async (url: string | URL | Request) => {
    chiamate.push(String(url));
    if (stato === "errore") throw new Error("rete assente");
    return new Response("{}", { status: stato });
  }) as typeof fetch;
  atteso("chiavi accettate dallo staging (200): nessun errore", (await erroriChiaviSulloStaging(VALIDO, finta(200))).length === 0);
  atteso("chiavi rifiutate (401, chiave di un altro progetto): bloccato", (await erroriChiaviSulloStaging(VALIDO, finta(401))).length === 2);
  atteso("staging irraggiungibile: bloccato (mai «passa per assenza di rete»)", (await erroriChiaviSulloStaging(VALIDO, finta("errore"))).length === 2);
  atteso("la prova di rete chiama SOLO lo staging", chiamate.length === 6 && chiamate.every((u) => u.startsWith(`${STAGING_URL}/`)));
  atteso("la prova della chiave di servizio non legge righe (limit=0)", chiamate.some((u) => u.includes("/rest/v1/") && u.endsWith("limit=0")));

  // 10. Controllo del codice compilato (cartelle .next sintetiche).
  const prova = (nome: string, file: Record<string, string>, chiave: string, attesoOk: boolean, frammento?: string) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "anteprima-bundle-"));
    try {
      for (const [p, testo] of Object.entries(file)) {
        fs.mkdirSync(path.dirname(path.join(dir, p)), { recursive: true });
        fs.writeFileSync(path.join(dir, p), testo);
      }
      const { errori } = erroriCodiceCompilato(dir, chiave);
      atteso(nome, attesoOk ? errori.length === 0 : errori.some((x) => !frammento || x.includes(frammento)), errori.join(" | ") || "nessun errore");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };
  const server = { "server/app/pagina.js": `const u="https://${STAGING_REF}.supabase.co";` };
  prova("compilato solo staging: ammesso", { ...server, "static/chunks/a.js": "console.log(1)" }, "sb_secret_SINTETICA", true);
  prova("identificativo di produzione nel codice per il browser → bloccato", { ...server, "static/chunks/a.js": `"${PRODUZIONE}"` }, "", false, "produzione");
  prova("indirizzo Supabase diverso nel server → bloccato", { "server/app/pagina.js": `"https://${STAGING_REF}.supabase.co";"https://abcdefghijklmnopqrst.supabase.co"` }, "", false, "diversi dallo staging");
  prova("valore della chiave di servizio nel codice per il browser → bloccato", { ...server, "static/chunks/a.js": `"sb_secret_SINTETICA"` }, "sb_secret_SINTETICA", false, "SUPABASE_SERVICE_ROLE_KEY");
  prova("solo il prefisso «sb_secret_» della libreria Supabase nel codice per il browser: ammesso", { ...server, "static/chunks/a.js": `let ss=e=>e.startsWith("sb_publishable_")||e.startsWith("sb_secret_")` }, "sb_secret_CHIAVE_CONFIGURATA_SINTETICA", true);
  prova("una chiave secret qualunque (non quella configurata) nel codice per il browser → bloccato", { ...server, "static/chunks/a.js": `"sb_secret_ABCDEFGHIJKLMNOPQRSTUV"` }, "sb_secret_ALTRA", false, "chiave secret");
  prova("chiave Stripe live nel codice per il browser → bloccato", { ...server, "static/chunks/a.js": `"sk_live_x"` }, "", false, "live");
  prova("indirizzo dello staging assente → bloccato", { "server/app/pagina.js": "nulla", "static/chunks/a.js": "nulla" }, "", false, "non contiene l'indirizzo dello staging");
  prova("build assente → bloccato", {}, "", false, "la build non c'è");

  // 11. Agganci: config di Next, proxy, script npm.
  const config = fs.readFileSync(path.join(RADICE, "next.config.ts"), "utf8");
  atteso("next.config.ts: la guardia lancia un errore prima della configurazione", config.indexOf("erroriAmbienteAnteprima(process.env)") > 0 && config.indexOf("throw new Error") < config.indexOf("const nextConfig"));
  const proxy = fs.readFileSync(path.join(RADICE, "src/proxy.ts"), "utf8");
  const corpo = proxy.slice(proxy.indexOf("export async function proxy("));
  atteso("proxy: 503 come PRIMA cosa, prima della zona e di Supabase Auth", corpo.indexOf("if (!anteprimaAutorizzata())") > 0 && corpo.indexOf("if (!anteprimaAutorizzata())") < corpo.indexOf("resolveZone(") && corpo.indexOf("status: 503") < corpo.indexOf("updateSession("));
  atteso("proxy: scelta della zona su anteprima SOLO con la guardia superata", /const IS_DEV = process\.env\.NODE_ENV !== "production" \|\| \(process\.env\.VERCEL_ENV === "preview" && anteprimaAutorizzata\(\)\);/.test(proxy));
  const pacchetto = JSON.parse(fs.readFileSync(path.join(RADICE, "package.json"), "utf8")) as { scripts: Record<string, string> };
  atteso("prebuild: la guardia è il primo comando", pacchetto.scripts.prebuild.startsWith("tsx scripts/guardia-anteprima.ts && "));
  atteso("build: la guardia è il primo comando, poi next build", pacchetto.scripts.build === "tsx scripts/guardia-anteprima.ts && next build");
  atteso("postbuild: controllo del codice compilato", pacchetto.scripts.postbuild === "tsx scripts/verifica-bundle-anteprima.ts");
  const layoutOmniaAi = fs.readFileSync(path.join(RADICE, "src/app/site-omnia-ai/layout.tsx"), "utf8");
  atteso("tag Google di OMNIA AI: sulle anteprime la libreria non si carica", /const TAG_GOOGLE_SPENTO = process\.env\.VERCEL_ENV === "preview" \|\| process\.env\.NEXT_PUBLIC_VERCEL_ENV === "preview";/.test(layoutOmniaAi) && layoutOmniaAi.includes("{!TAG_GOOGLE_SPENTO && <script defer src={URL_GTAG_JS} />}"));
  const bannerEcommerce = fs.readFileSync(path.join(RADICE, "src/components/cookie-consent.tsx"), "utf8");
  atteso("banner dell'e-commerce: sulle anteprime non compare (nessun tag Google nemmeno dopo «Accetta»)", bannerEcommerce.includes('if (process.env.NEXT_PUBLIC_VERCEL_ENV === "preview") return null;') && bannerEcommerce.indexOf('if (process.env.NEXT_PUBLIC_VERCEL_ENV === "preview") return null;') < bannerEcommerce.indexOf('status === "accepted"'));
  atteso("lanciatore locale: simula NEXT_PUBLIC_VERCEL_ENV=preview come Vercel", fs.readFileSync(path.join(RADICE, "scripts/avvia-anteprima-locale.mjs"), "utf8").includes('NEXT_PUBLIC_VERCEL_ENV: "preview"'));
  // condizione 7 dell'utente (18/11): il server locale non deve essere raggiungibile dalla rete
  const lanciatore = fs.readFileSync(path.join(RADICE, "scripts/avvia-anteprima-locale.mjs"), "utf8");
  const avvii = [...lanciatore.matchAll(/"start",[^\]]*\]/g)].map((m) => m[0]);
  atteso("lanciatore locale: next start SOLO su 127.0.0.1 (-H 127.0.0.1), mai su tutte le interfacce", avvii.length === 1 && avvii[0].includes('"-H", "127.0.0.1"') && !/0\.0\.0\.0|"--hostname"|"-H", "(?!127\.0\.0\.1)/.test(lanciatore));
  atteso("lanciatore locale: il messaggio d'avvio indica http://127.0.0.1:<porta>", lanciatore.includes("su http://127.0.0.1:${porta}") && !lanciatore.includes("http://localhost:${porta}"));
  const vercel = JSON.parse(fs.readFileSync(path.join(RADICE, "vercel.json"), "utf8")) as { crons: { path: string }[] };
  atteso("vercel.json invariato: 5 cron (Vercel li esegue solo in produzione, mai sulle anteprime)", vercel.crons.length === 5);

  // 12. Cron (compreso quello della PVL, non programmato): tutti passano dal proxy (503 se l'ambiente non è valido) e chiedono CRON_SECRET.
  const matcher = (proxy.match(/matcher:\s*\[\s*"([^"]+)"/) ?? [])[1] ?? "";
  atteso("il proxy copre anche le rotte /api (il matcher esclude solo i file statici)", matcher.startsWith("/((?!_next/static|_next/image|favicon.ico") && !matcher.includes("api"));
  atteso("vercel.json non programma il cron della PVL", !vercel.crons.some((c) => c.path.includes("radar-pvl")));
  const cartellaCron = path.join(RADICE, "src/app/api/cron");
  const rotteCron = fs.readdirSync(cartellaCron).filter((d) => fs.existsSync(path.join(cartellaCron, d, "route.ts")));
  const senzaSegreto = rotteCron.filter((d) => {
    const codice = fs.readFileSync(path.join(cartellaCron, d, "route.ts"), "utf8");
    const inizio = codice.indexOf("export async function GET(");
    const corpo = codice.slice(inizio, inizio + 400);
    return inizio < 0 || !/CRON_SECRET/.test(corpo);
  });
  atteso(`ogni rotta dei cron (${rotteCron.length}, compresa radar-pvl) controlla CRON_SECRET come prima cosa`, rotteCron.includes("radar-pvl") && senzaSegreto.length === 0, senzaSegreto.join(", "));
  const pvl = fs.readFileSync(path.join(cartellaCron, "radar-pvl/route.ts"), "utf8");
  atteso("cron della PVL: senza RADAR_PVL_CRON=attivo non fa nulla (e sull'anteprima la guardia lo vuole spento)", pvl.indexOf("cronAutorizzato(") < pvl.indexOf('process.env.RADAR_PVL_CRON !== "attivo"') && pvl.indexOf('process.env.RADAR_PVL_CRON !== "attivo"') < pvl.indexOf("eseguiImportazionePvl("));

  if (fallimenti.length) {
    console.error(`\n${fallimenti.length} controlli della guardia dell'anteprima NON superati.`);
    process.exit(1);
  }
  console.log("\nTutti i controlli della guardia dell'anteprima sono superati.");
}

void principale();
