// SOLO SUI BRANCH DI BENCHMARK (perf/benchmark-regione*): MAI da unire in master.
//
// Guardia FAIL-CLOSED dell'ambiente. Legge soltanto le variabili d'ambiente: nessuna rete, nessun database. Restituisce
// l'elenco dei NOMI dei controlli non superati (mai i valori). Elenco vuoto = ambiente autorizzato.
// La usano: scripts/guardia-benchmark.ts (prima di prebuild e build), next.config.ts (prima di qualsiasi lavoro di
// `next build`) e src/proxy.ts (a runtime: 503 su ogni richiesta se l'ambiente non è valido).
//
// Ambiente autorizzato = SOLO Supabase Staging «ryawdldqiumqsskrnyps» e servizi esterni con valori FINTI o spenti.

export const STAGING_REF = "ryawdldqiumqsskrnyps";
export const STAGING_URL = `https://${STAGING_REF}.supabase.co`;
const PRODUZIONE = ["bihfrzspqxsrzlbqqvqa", "omnia-ai.it", "omniaitalia.com"];

// Le 18 variabili NEXT_PUBLIC_VERCEL_* che Vercel aggiunge da sola ai progetti Next.js, in produzione E nelle anteprime
// (https://vercel.com/docs/environment-variables/framework-environment-variables, sezione «Next.js»). Per esempio
// NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL contiene SEMPRE il dominio di produzione, «even in preview deployments».
const VERCEL_FRAMEWORK = new Set([
  "NEXT_PUBLIC_VERCEL_ENV", "NEXT_PUBLIC_VERCEL_TARGET_ENV", "NEXT_PUBLIC_VERCEL_URL", "NEXT_PUBLIC_VERCEL_BRANCH_URL",
  "NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL", "NEXT_PUBLIC_VERCEL_DEPLOYMENT_ID", "NEXT_PUBLIC_VERCEL_PROJECT_ID",
  "NEXT_PUBLIC_VERCEL_GIT_PROVIDER", "NEXT_PUBLIC_VERCEL_GIT_REPO_SLUG", "NEXT_PUBLIC_VERCEL_GIT_REPO_OWNER",
  "NEXT_PUBLIC_VERCEL_GIT_REPO_ID", "NEXT_PUBLIC_VERCEL_GIT_COMMIT_REF", "NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA",
  "NEXT_PUBLIC_VERCEL_GIT_COMMIT_MESSAGE", "NEXT_PUBLIC_VERCEL_GIT_COMMIT_AUTHOR_LOGIN", "NEXT_PUBLIC_VERCEL_GIT_COMMIT_AUTHOR_NAME",
  "NEXT_PUBLIC_VERCEL_GIT_PREVIOUS_SHA", "NEXT_PUBLIC_VERCEL_GIT_PULL_REQUEST_ID",
]);

// Valori finti attesi (non sono segreti: sono scritti anche in .env.vercel-benchmark).
const FINTI: Record<string, string> = {
  NEXT_PUBLIC_SITE_URL: "https://benchmark-staging.invalid",
  ANTHROPIC_API_KEY: "sk-ant-benchmark-finto",
  OPENAI_API_KEY: "sk-benchmark-finto",
  VOYAGE_API_KEY: "pa-benchmark-finto",
  STRIPE_SECRET_KEY: "sk_test_benchmark_finto",
  STRIPE_SECRET_KEY_OMNIA_AI: "sk_test_benchmark_finto",
  STRIPE_WEBHOOK_SECRET: "whsec_benchmark_finto",
  STRIPE_WEBHOOK_SECRET_OMNIA_AI: "whsec_benchmark_finto",
  RESEND_API_KEY: "re_benchmark_finto",
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
  TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
  GOOGLE_OAUTH_CLIENT_ID: "finto-benchmark.apps.googleusercontent.com",
  GOOGLE_OAUTH_CLIENT_SECRET: "finto-benchmark",
  GOOGLE_CALENDAR_ID: "finto-benchmark@benchmark-staging.invalid",
  GOOGLE_CALENDAR_REFRESH_TOKEN: "finto-benchmark",
  GOOGLE_ADS_REFRESH_TOKEN: "finto-benchmark",
  GOOGLE_ADS_CUSTOMER_ID: "0000000000",
  GOOGLE_ADS_LOGIN_CUSTOMER_ID: "0000000000",
  GOOGLE_ADS_DEMO_CONVERSION_ACTION_ID: "0",
  GA4_MEASUREMENT_ID: "G-BENCHMARK0",
  GA4_API_SECRET: "finto-benchmark",
  // integrazioni demo, sincronizzazioni e interruttori di prova: spenti
  DEMO_LEADS_ATTIVO: "0",
  DEMO_GA4_MP_ENABLED: "0",
  DEMO_ADS_IMPORT_ENABLED: "0",
  DEMO_CALENDAR_SYNC_ENABLED: "0",
  DEMO_ADS_VALIDATE_ONLY: "1",
  OMNIA_AI_SCRIPT_PROVE: "0",
  OMNIA_AI_COPERTINA_ACQUISTO_PROVA: "0",
  OMNIA_AI_PIANO_LAVORO_ACQUISTO_PROVA: "0",
  OMNIA_AI_MODELLO_PROVA: "spento",
};

// Variabili che devono esistere con un valore proprio (segreti casuali dello staging/benchmark): basta che non siano vuote.
const PRESENTI = ["CRON_SECRET", "DEMO_CONSENT_SIGNING_SECRET", "DEMO_LEADS_HASH_SECRET"];

export function erroriAmbienteBenchmark(env: Record<string, string | undefined>): string[] {
  const e: string[] = [];
  const v = (k: string) => (env[k] ?? "").trim();

  // 1-2. Supabase: SOLO lo staging autorizzato, URL esatto e host dichiarato coerente.
  if (v("NEXT_PUBLIC_SUPABASE_URL").replace(/\/+$/, "") !== STAGING_URL) e.push("NEXT_PUBLIC_SUPABASE_URL non è lo staging autorizzato");
  if (v("BENCHMARK_SUPABASE_ATTESO") !== `${STAGING_REF}.supabase.co`) e.push("BENCHMARK_SUPABASE_ATTESO non è lo staging autorizzato");
  if (!v("NEXT_PUBLIC_SUPABASE_ANON_KEY").startsWith("sb_publishable_")) e.push("NEXT_PUBLIC_SUPABASE_ANON_KEY non è una chiave publishable");
  if (!v("SUPABASE_SERVICE_ROLE_KEY").startsWith("sb_secret_")) e.push("SUPABASE_SERVICE_ROLE_KEY non è una chiave secret");
  if (v("BENCHMARK_TOKEN").length < 24) e.push("BENCHMARK_TOKEN mancante o troppo corto");

  // 3. Nessun riferimento alla produzione e nessun altro progetto Supabase in NESSUNA variabile.
  // Escluse le variabili di SISTEMA della piattaforma (Vercel, npm, Next): per esempio VERCEL_PROJECT_PRODUCTION_URL contiene
  // sempre il dominio di produzione ma non è una credenziale né un accesso.
  for (const [k, valore] of Object.entries(env)) {
    if (!valore || /^(VERCEL_|npm_|NEXT_PRIVATE_|NEXT_RUNTIME$|TURBO_|__NEXT)/.test(k)) continue;
    // Variabili «di framework» che Vercel genera da sola per Next.js (elenco ESATTO della documentazione): informative, mai
    // usate dal codice come indirizzo di un servizio. Per loro (e solo per loro) il nome del dominio di produzione è ammesso;
    // restano vietati un progetto Supabase diverso dallo staging e le stringhe di connessione (controlli qui sotto), e le *_URL
    // devono essere un semplice nome di dominio, senza protocollo, percorso o credenziali.
    if (VERCEL_FRAMEWORK.has(k)) {
      if (k.endsWith("_URL") && !/^[a-z0-9.-]+(:\d+)?$/i.test(valore)) e.push(`${k} non è un semplice nome di dominio`);
    } else if (PRODUZIONE.some((p) => valore.includes(p))) e.push(`${k} contiene un riferimento alla produzione`);
    if (valore.includes(PRODUZIONE[0])) e.push(`${k} contiene l'identificativo del progetto Supabase di produzione`);
    const altriSupabase = (valore.match(/[a-z0-9]{20}\.supabase\.(co|in)/g) ?? []).filter((h) => !h.startsWith(STAGING_REF));
    if (altriSupabase.length) e.push(`${k} punta a un progetto Supabase diverso dallo staging`);
    if (/^postgres(ql)?:\/\//.test(valore)) e.push(`${k} contiene una stringa di connessione a un database`);
  }

  // 4-5. Servizi esterni finti e funzioni automatiche spente: valore ESATTO, altrimenti blocco.
  for (const [k, atteso] of Object.entries(FINTI)) if (v(k) !== atteso) e.push(`${k} non ha il valore finto/spento atteso`);
  for (const k of PRESENTI) if (!v(k)) e.push(`${k} mancante`);

  return [...new Set(e)];
}

export function ambienteBenchmarkValido(env: Record<string, string | undefined>): boolean {
  return erroriAmbienteBenchmark(env).length === 0;
}
