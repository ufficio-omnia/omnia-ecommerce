// Guardia anti-produzione per le anteprime e le prove di Tender Intelligence sullo STAGING (16/11/2026, dopo l'incidente dell'anteprima partita
// dalla cartella principale con il database di produzione). Controlla l'ambiente EFFETTIVO, cioè quello che Next userebbe davvero: i file
// d'ambiente caricati più le variabili del processo (che li sovrascrivono). Se trova anche un solo segno della produzione, l'avvio si ferma.
//
// Regole (nessun valore viene mai stampato, solo i nomi delle variabili):
//   1. si accetta un solo file d'ambiente, `.env.development.local` (quello preparato con i soli valori dello staging); `.env.local`, `.env`,
//      `.env.development`, `.env.production*` sono rifiutati perché nella cartella principale contengono la produzione;
//   2. nessuna variabile può contenere l'identificativo del progetto di produzione (URL, chiavi, connessioni al database);
//   3. le chiavi in formato JWT devono appartenere allo staging (campo «ref»);
//   4. l'indirizzo pubblico di Supabase deve essere esattamente quello dello staging, e le due chiavi devono esserci;
//   5. niente chiavi Stripe reali e niente chiave Resend (nessun pagamento né email veri dalle prove);
//   6. (con la rete) le due chiavi devono essere accettate dall'autenticazione dello STAGING: una chiave di produzione viene rifiutata.
// I tre nomi Supabase usati dal codice (client e server) sono NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY;
// la regola 2 vale comunque per TUTTE le variabili.

export const PROGETTO_STAGING = "ryawdldqiumqsskrnyps";
export const PROGETTO_PRODUZIONE = "bihfrzspqxsrzlbqqvqa";
export const FILE_AMMESSI = [".env.development.local"];
export const VARIABILI_SUPABASE = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"];

function payloadJwt(valore) {
  const parti = valore.split(".");
  if (parti.length !== 3 || !parti[0].startsWith("eyJ")) return null;
  try {
    return JSON.parse(Buffer.from(parti[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
  } catch {
    return null;
  }
}

/**
 * @param {{ env: Record<string, string | undefined>, fileCaricati: string[] }} dati
 * @returns {{ ok: boolean, problemi: string[] }}
 */
export function controllaAmbiente({ env, fileCaricati }) {
  const problemi = [];
  for (const f of fileCaricati) {
    if (!FILE_AMMESSI.includes(f)) problemi.push(`viene caricato il file ${f}: per le prove è ammesso solo ${FILE_AMMESSI.join(", ")}`);
  }
  for (const [nome, valore] of Object.entries(env)) {
    if (typeof valore !== "string" || !valore) continue;
    if (valore.toLowerCase().includes(PROGETTO_PRODUZIONE)) problemi.push(`${nome} punta al progetto di PRODUZIONE`);
    const jwt = payloadJwt(valore.trim());
    if (jwt && typeof jwt.ref === "string" && jwt.ref !== PROGETTO_STAGING) problemi.push(`${nome} è una chiave di un altro progetto (non dello staging)`);
    if (/^(sk|rk)_live_/.test(valore.trim())) problemi.push(`${nome} è una chiave Stripe reale`);
  }
  const url = (env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim().replace(/\/+$/, "");
  if (url !== `https://${PROGETTO_STAGING}.supabase.co`) problemi.push("NEXT_PUBLIC_SUPABASE_URL non è l'indirizzo dello staging");
  for (const nome of ["NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"]) {
    if (!(env[nome] ?? "").trim()) problemi.push(`${nome} manca`);
  }
  if ((env.RESEND_API_KEY ?? "").trim()) problemi.push("RESEND_API_KEY è valorizzata: le prove non devono inviare email vere");
  return { ok: problemi.length === 0, problemi: [...new Set(problemi)] };
}

/**
 * Le chiavi devono essere accettate dall'autenticazione dello staging (una chiave di produzione viene rifiutata con 401).
 * @param {Record<string, string | undefined>} env
 * @param {typeof fetch} [fetchFn]
 * @returns {Promise<string[]>} i problemi trovati
 */
export async function verificaChiaviSulloStaging(env, fetchFn = fetch) {
  const problemi = [];
  const base = `https://${PROGETTO_STAGING}.supabase.co/auth/v1/settings`;
  for (const nome of ["NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"]) {
    const chiave = (env[nome] ?? "").trim();
    if (!chiave) continue;
    try {
      const r = await fetchFn(base, { headers: { apikey: chiave }, signal: AbortSignal.timeout(10_000) });
      if (r.status !== 200) problemi.push(`${nome} non è accettata dallo staging (risposta ${r.status})`);
    } catch {
      problemi.push(`${nome}: staging non raggiungibile, impossibile verificare la chiave`);
    }
  }
  return problemi;
}
