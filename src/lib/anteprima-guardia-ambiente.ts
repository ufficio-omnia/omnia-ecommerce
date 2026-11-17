// SOLO SUL RAMO anteprima/tender-intelligence-staging: MAI da unire in master né in feature/tender-intelligence.
//
// Guardia FAIL-CLOSED dell'ambiente per la Vercel Preview di Tender Intelligence (fase B1), collegata SOLO allo staging.
// Legge soltanto le variabili d'ambiente: nessuna rete, nessun database. Restituisce i NOMI dei controlli non superati,
// mai i valori. Elenco vuoto = ambiente autorizzato.
// La usano: scripts/guardia-anteprima.ts (primo comando di prebuild e di build, con in più la prova di rete delle chiavi
// sullo staging), next.config.ts (prima di qualsiasi lavoro di `next build` e `next start`) e src/proxy.ts (a runtime:
// 503 su ogni richiesta se l'ambiente non è valido).
//
// Ambiente autorizzato = Supabase Staging «ryawdldqiumqsskrnyps» e, per ogni altro servizio, nessun valore o un valore
// FINTO dichiarato qui sotto. Ogni variabile che il codice legge sta in uno dei gruppi qui sotto: la verifica
// scripts/verifica-anteprima-guardia.ts si ferma se il codice ne legge una che non c'è.

export const RAMO_ANTEPRIMA = "anteprima/tender-intelligence-staging";
export const STAGING_REF = "ryawdldqiumqsskrnyps";
export const STAGING_URL = `https://${STAGING_REF}.supabase.co`;
const PRODUZIONE_REF = "bihfrzspqxsrzlbqqvqa";
const DOMINI_PRODUZIONE = ["omnia-ai.it", "omniaitalia.com"];

// Supabase: le uniche tre variabili Supabase lette dal codice (browser: URL e chiave pubblica; server: anche la chiave di servizio).
export const VARIABILI_SUPABASE = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"];

// Servizi esterni: vuoti oppure con il valore FINTO dichiarato qui (non sono segreti). Con un valore finto le chiamate
// falliscono con «non autorizzato»: nessun addebito, nessuna email, nessun dato inviato a terzi.
export const SERVIZI_FINTI: Record<string, string> = {
  ANTHROPIC_API_KEY: "sk-ant-anteprima-finto",
  OPENAI_API_KEY: "sk-anteprima-finto",
  VOYAGE_API_KEY: "pa-anteprima-finto",
  STRIPE_SECRET_KEY: "sk_test_anteprima_finto",
  STRIPE_SECRET_KEY_OMNIA_AI: "sk_test_anteprima_finto",
  STRIPE_WEBHOOK_SECRET: "whsec_anteprima_finto",
  STRIPE_WEBHOOK_SECRET_OMNIA_AI: "whsec_anteprima_finto",
  RESEND_API_KEY: "re_anteprima_finto",
  GOOGLE_OAUTH_CLIENT_ID: "finto-anteprima.apps.googleusercontent.com",
  GOOGLE_OAUTH_CLIENT_SECRET: "finto-anteprima",
  GOOGLE_CALENDAR_ID: "finto-anteprima@anteprima-staging.invalid",
  GOOGLE_CALENDAR_REFRESH_TOKEN: "finto-anteprima",
  GOOGLE_ADS_REFRESH_TOKEN: "finto-anteprima",
  GOOGLE_ADS_CUSTOMER_ID: "0000000000",
  GOOGLE_ADS_LOGIN_CUSTOMER_ID: "0000000000",
  GOOGLE_ADS_DEMO_CONVERSION_ACTION_ID: "0",
  GA4_MEASUREMENT_ID: "G-ANTEPRIMA0",
  GA4_API_SECRET: "finto-anteprima",
  // Chiavi di PROVA ufficiali di Cloudflare Turnstile: la verifica passa sempre, nessun contatto con chiavi vere.
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
  TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
};

// Interruttori: solo i valori che li lasciano spenti (o, per DEMO_ADS_VALIDATE_ONLY e DEMO_GA4_MP_DEBUG, in sola verifica).
export const INTERRUTTORI_SPENTI: Record<string, string[]> = {
  DEMO_LEADS_ATTIVO: ["", "0"],
  DEMO_GA4_MP_ENABLED: ["", "0"],
  DEMO_ADS_IMPORT_ENABLED: ["", "0"],
  DEMO_CALENDAR_SYNC_ENABLED: ["", "0"],
  DEMO_ADS_VALIDATE_ONLY: ["", "1"],
  DEMO_ADS_ALLOW_EMAIL_ONLY: ["", "0"],
  DEMO_GA4_MP_DEBUG: ["", "0", "1"],
  OMNIA_AI_SCRIPT_PROVE: ["", "0"],
  OMNIA_AI_MODELLO_PROVA: ["", "0", "spento"],
  OMNIA_AI_COPERTINA_ACQUISTO_PROVA: ["", "0"],
  OMNIA_AI_PIANO_LAVORO_ACQUISTO_PROVA: ["", "0"],
  OMNIA_AI_RADAR_APERTO: ["", "0"],
  OMNIA_AI_PIANO_LAVORO_APERTO: ["", "0"],
};

// Segreti propri dell'anteprima (casuali, diversi da quelli di produzione). CRON_SECRET è obbligatorio: una rotta dei cron
// confronta l'intestazione con `Bearer ${CRON_SECRET}`, che senza la variabile diventerebbe «Bearer undefined».
export const SEGRETI_OBBLIGATORI = ["CRON_SECRET"];
export const SEGRETI_FACOLTATIVI = ["DEMO_CONSENT_SIGNING_SECRET", "DEMO_LEADS_HASH_SECRET"];
const LUNGHEZZA_MINIMA_SEGRETO = 32;

// Configurazioni senza credenziali: qualunque valore, ma sempre soggetto al controllo generale (nessun riferimento alla produzione).
export const CONFIGURAZIONI_LIBERE = [
  "NEXT_PUBLIC_SITE_URL",
  "OPENAI_IMAGE_MODEL",
  "OPENAI_IMAGE_QUALITY",
  "OPENAI_LETTURA_MODEL",
  "DEMO_CALENDAR_INTERNAL_DOMAINS",
  "DEMO_CALENDAR_INTERNAL_EMAILS",
  "DEMO_CALENDAR_TITLE_REGEX",
  "DEMO_MATCH_WINDOW_DAYS",
  "DEMO_ADS_REAL_FROM",
  "DEMO_GA4_PROVA_EMAIL",
  "DEMO_MULTI_RICHIESTA",
];

// Variabili della piattaforma lette dal codice.
export const VARIABILI_PIATTAFORMA = ["NODE_ENV", "VERCEL", "VERCEL_ENV"];

// Le 18 variabili NEXT_PUBLIC_VERCEL_* che Vercel aggiunge da sola ai progetti Next.js, in produzione E nelle anteprime
// (documentazione Vercel, «Framework environment variables», sezione Next.js). Per esempio
// NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL contiene SEMPRE il dominio di produzione, anche nelle anteprime.
const VERCEL_FRAMEWORK = new Set([
  "NEXT_PUBLIC_VERCEL_ENV", "NEXT_PUBLIC_VERCEL_TARGET_ENV", "NEXT_PUBLIC_VERCEL_URL", "NEXT_PUBLIC_VERCEL_BRANCH_URL",
  "NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL", "NEXT_PUBLIC_VERCEL_DEPLOYMENT_ID", "NEXT_PUBLIC_VERCEL_PROJECT_ID",
  "NEXT_PUBLIC_VERCEL_GIT_PROVIDER", "NEXT_PUBLIC_VERCEL_GIT_REPO_SLUG", "NEXT_PUBLIC_VERCEL_GIT_REPO_OWNER",
  "NEXT_PUBLIC_VERCEL_GIT_REPO_ID", "NEXT_PUBLIC_VERCEL_GIT_COMMIT_REF", "NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA",
  "NEXT_PUBLIC_VERCEL_GIT_COMMIT_MESSAGE", "NEXT_PUBLIC_VERCEL_GIT_COMMIT_AUTHOR_LOGIN", "NEXT_PUBLIC_VERCEL_GIT_COMMIT_AUTHOR_NAME",
  "NEXT_PUBLIC_VERCEL_GIT_PREVIOUS_SHA", "NEXT_PUBLIC_VERCEL_GIT_PULL_REQUEST_ID",
]);

// Variabili di SISTEMA della piattaforma (Vercel, npm, Next): escluse dal controllo generale perché alcune contengono di
// proposito il dominio di produzione (per esempio VERCEL_PROJECT_PRODUCTION_URL) senza essere credenziali né accessi.
const SISTEMA = /^(VERCEL_|npm_|NEXT_PRIVATE_|NEXT_RUNTIME$|TURBO_|__NEXT)/;

export function variabiliCatalogate(): Set<string> {
  return new Set([
    ...VARIABILI_SUPABASE,
    ...Object.keys(SERVIZI_FINTI),
    ...Object.keys(INTERRUTTORI_SPENTI),
    ...SEGRETI_OBBLIGATORI,
    ...SEGRETI_FACOLTATIVI,
    ...CONFIGURAZIONI_LIBERE,
    ...VARIABILI_PIATTAFORMA,
  ]);
}

function decodificaBase64Url(parte: string): string | null {
  try {
    const base64 = parte.replace(/-/g, "+").replace(/_/g, "/");
    return atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
  } catch {
    return null;
  }
}

// Progetto dichiarato da una chiave JWT di Supabase (chiavi «legacy»): null se il valore non è un JWT leggibile.
function progettoDelJwt(valore: string): string | null {
  const parti = valore.split(".");
  if (parti.length !== 3 || !parti[0].startsWith("eyJ")) return null;
  const testo = decodificaBase64Url(parti[1]);
  if (!testo) return null;
  try {
    const payload = JSON.parse(testo) as { ref?: unknown; iss?: unknown };
    if (typeof payload.ref === "string") return payload.ref;
    if (typeof payload.iss === "string" && payload.iss.includes("supabase")) return "sconosciuto";
    return null;
  } catch {
    return null;
  }
}

function indirizzoAmmesso(valore: string): boolean {
  if (!valore) return true;
  let host: string;
  try {
    host = new URL(valore).hostname.toLowerCase();
  } catch {
    return false;
  }
  return host === "localhost" || host === "127.0.0.1" || host.endsWith(".invalid") || host.endsWith(".vercel.app");
}

export function erroriAmbienteAnteprima(env: Record<string, string | undefined>): string[] {
  const e: string[] = [];
  const v = (k: string) => (env[k] ?? "").trim();

  // 1. Piattaforma: su Vercel solo un'anteprima, e solo di questo ramo (se Vercel dichiara il ramo).
  if (v("VERCEL")) {
    if (v("VERCEL_ENV") !== "preview") e.push("VERCEL_ENV non è «preview»: questo ramo non va mai in produzione");
    if (v("VERCEL_GIT_COMMIT_REF") && v("VERCEL_GIT_COMMIT_REF") !== RAMO_ANTEPRIMA) e.push("VERCEL_GIT_COMMIT_REF non è il ramo d'anteprima autorizzato");
    // Il codice per il browser spegne i tag Google (Analytics e Ads veri) solo se sa di essere su un'anteprima: senza questa
    // variabile di Vercel lo spegnimento non avverrebbe, quindi si blocca.
    if (v("NEXT_PUBLIC_VERCEL_ENV") !== "preview") e.push("NEXT_PUBLIC_VERCEL_ENV non è «preview»: i tag Google non verrebbero spenti nel browser");
  }

  // 2. Supabase: SOLO lo staging, URL esatto, chiavi nel formato del progetto di staging.
  if (v("NEXT_PUBLIC_SUPABASE_URL").replace(/\/+$/, "") !== STAGING_URL) e.push("NEXT_PUBLIC_SUPABASE_URL non è lo staging autorizzato");
  if (!v("NEXT_PUBLIC_SUPABASE_ANON_KEY").startsWith("sb_publishable_")) e.push("NEXT_PUBLIC_SUPABASE_ANON_KEY non è una chiave publishable");
  if (!v("SUPABASE_SERVICE_ROLE_KEY").startsWith("sb_secret_")) e.push("SUPABASE_SERVICE_ROLE_KEY non è una chiave secret");

  // 3. Controllo generale su TUTTE le variabili (non solo quelle del catalogo), escluse quelle di sistema della piattaforma.
  for (const [k, grezzo] of Object.entries(env)) {
    const valore = (grezzo ?? "").trim();
    if (!valore || SISTEMA.test(k)) continue;
    if (VERCEL_FRAMEWORK.has(k)) {
      // Informative, mai usate dal codice come indirizzo di un servizio: per loro il nome del dominio di produzione è
      // ammesso, ma le *_URL devono essere un semplice nome di dominio, senza protocollo, percorso o credenziali.
      if (k.endsWith("_URL") && !/^[a-z0-9.-]+(:\d+)?$/i.test(valore)) e.push(`${k} non è un semplice nome di dominio`);
    } else if (DOMINI_PRODUZIONE.some((d) => valore.toLowerCase().includes(d))) {
      e.push(`${k} contiene un dominio di produzione`);
    }
    if (valore.includes(PRODUZIONE_REF)) e.push(`${k} contiene l'identificativo del progetto Supabase di produzione`);
    const altriSupabase = (valore.toLowerCase().match(/[a-z0-9]{20}\.supabase\.(co|in)/g) ?? []).filter((h) => !h.startsWith(STAGING_REF));
    if (altriSupabase.length) e.push(`${k} punta a un progetto Supabase diverso dallo staging`);
    if (/postgres(ql)?:\/\//i.test(valore)) e.push(`${k} contiene una stringa di connessione a un database`);
    if (/\b(sk|rk|pk)_live_/.test(valore)) e.push(`${k} contiene una chiave Stripe «live»`);
    const progetto = progettoDelJwt(valore);
    if (progetto && progetto !== STAGING_REF) e.push(`${k} è una chiave JWT di un progetto diverso dallo staging`);
  }

  // 4. Servizi esterni: vuoti o con il valore finto dichiarato.
  for (const [k, finto] of Object.entries(SERVIZI_FINTI)) if (v(k) && v(k) !== finto) e.push(`${k} non è vuota né ha il valore finto dichiarato`);

  // 5. Interruttori spenti.
  for (const [k, ammessi] of Object.entries(INTERRUTTORI_SPENTI)) if (!ammessi.includes(v(k))) e.push(`${k} non è spento`);

  // 6. Segreti propri dell'anteprima.
  for (const k of SEGRETI_OBBLIGATORI) if (v(k).length < LUNGHEZZA_MINIMA_SEGRETO) e.push(`${k} mancante o più corto di ${LUNGHEZZA_MINIMA_SEGRETO} caratteri`);
  for (const k of SEGRETI_FACOLTATIVI) if (v(k) && v(k).length < LUNGHEZZA_MINIMA_SEGRETO) e.push(`${k} più corto di ${LUNGHEZZA_MINIMA_SEGRETO} caratteri`);

  // 7. Indirizzo del sito: vuoto, locale, .invalid o un indirizzo *.vercel.app (mai un dominio vero).
  if (!indirizzoAmmesso(v("NEXT_PUBLIC_SITE_URL"))) e.push("NEXT_PUBLIC_SITE_URL non è vuoto, locale, .invalid né *.vercel.app");

  return [...new Set(e)];
}

export function ambienteAnteprimaValido(env: Record<string, string | undefined>): boolean {
  return erroriAmbienteAnteprima(env).length === 0;
}
