// Collaudo CON ACCESSO della fase B4, gradi 1–2 («Per te», profilo di ricerca, Opportunità per l'Ufficio Gare) sullo STAGING (piano 28,
// approvato con D1, D2 e D3 ridotta). Scrive sullo staging (sessioni, presenza, utilizzi, profili, salvataggi e la gara sintetica D2): parte
// SOLO con un'autorizzazione registrata del coordinatore (tipo «scrittura_prova», 1 uso), lanciato da esegui-autorizzato.mjs dalla cartella
// dell'anteprima. Stesso schema di collaudo-accesso-b3.mjs (collaudato il 18/11), con gli utenti e le verifiche della B4.
//
//   node scripts/collaudo-accesso-b4.mjs <file delle variabili> <porta>      → la finestra del collaudo (solo con autorizzazione registrata)
//   node scripts/collaudo-accesso-b4.mjs --preliminare <porta>               → controllo PRELIMINARE: solo /pronto con i pulsanti bloccati;
//                                                                              nessuna autorizzazione, nessun file delle variabili, nessuna rete
//   node scripts/collaudo-accesso-b4.mjs --misure <registro> <finestre.json> → controllo 10: richieste per vista dal registro dell'osservatore
//                                                                              di rete (file locali); nessuna rete
//
// Finestra del collaudo, in ordine, fermandosi al primo problema PRIMA di qualunque rete:
//   1. porta delle autorizzazioni: TI_REGISTRO e controllaPorta (registro del coordinatore);
//   2. guardia: file delle variabili FUORI dal repository; Supabase = SOLO lo staging; interruttori della B4 come nel piano 28 (Per te e
//      Ufficio Gare «attivo», classificazioni «attive», notifiche spente); lanciatore dell'anteprima presente;
//   3. server d'ACCESSO solo sul loopback, con il nome «localhost» (porta dell'app + 1), SENZA alcun collegamento: GET /pronto mostra lo
//      stato e un pulsante per utente, nell'ordine del piano: D3 (ti-admin) → 1 (titolare-benchmark, D1) → 2 (ti-titolare) →
//      3 (ufficio-benchmark) → 4 (ti-titolare2). Un pulsante funziona solo dopo che i precedenti sono riusciti;
//   4. avvio dell'app come la Preview (scripts/avvia-anteprima-locale.mjs);
//   5. SOLO al clic su «Entra come …» (POST con il codice della pagina, l'origine e l'host giusti): prerequisiti dell'utente letti con la
//      chiave di servizio (solo GET; se mancano: 409 e il pulsante NON si consuma), poi il collegamento di QUELL'utente (generate_link),
//      verificato subito LATO SERVER (@supabase/ssr, verifyOtp). PRIMA di mandare il browser nell'app, con il token solo in memoria: identità,
//      controlli positivi, i tre tentativi di scrittura innocui sul profilo (attesi 401/403) e l'isolamento da tutte le altre imprese. Solo
//      se tutto è in regola: 303 verso l'app con il cookie di sessione per «localhost». Un solo tentativo per utente (poi 410);
//   6. «Verifiche finali» (dopo il passo 4): conteggi con la chiave di servizio, solo GET, delle scritture della finestra (profili,
//      salvate, gara D2, gare gratuite);
//   7. VIOLAZIONE o ERRORE in qualunque verifica = FERMO: nessun cookie, ogni altro pulsante 423, l'app viene spenta, uscita 3;
//   8. allo spegnimento si chiude anche il server d'accesso e si stampa il resoconto dei 10 controlli (parte lato server).
//
// Mai token, chiavi, cookie, collegamenti o id completi a schermo, nei log o su disco (condizione 7 dell'utente del 18/11). Nessuna
// password. Le prove di questo script sono solo a secco (scripts/verifica-collaudo-accesso-b4.ts), mai contro lo staging.
import { spawn } from "node:child_process";
import { randomBytes, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createServerClient } from "@supabase/ssr";

export const NOME_SCRIPT = "collaudo-accesso-b4.mjs";
export const STAGING_REF = "ryawdldqiumqsskrnyps";
export const STAGING_URL = `https://${STAGING_REF}.supabase.co`;
export const SOLO_LOCALE = "localhost";
export const COOKIE_SESSIONE = `sb-${STAGING_REF}-auth-token`;
const PRODUZIONE_REF = "bihfrzspqxsrzlbqqvqa";
const INDIRIZZI_LOOPBACK = new Set(["::1", "127.0.0.1"]);
const OPPORTUNITA = "/dashboard/omnia-ai/opportunita";
/** Le righe scritte dal collaudo si riconoscono dalla data: dall'apertura della finestra, con 5 minuti di margine per l'orologio. */
export const MARGINE_INIZIO_MS = 5 * 60 * 1000;
/** Esiti che fermano il collaudo. */
export const ESITI_FERMO = new Set(["VIOLAZIONE", "ERRORE"]);

// Le tre imprese di prova, indicate dal loro titolare.
export const IMPRESA_1 = "ti-titolare@prova.test";
export const IMPRESA_2 = "ti-titolare2@prova.test";
export const IMPRESA_3 = "titolare-benchmark@prova.test";
export const IMPRESE = [IMPRESA_1, IMPRESA_2, IMPRESA_3];
export const UFFICIO_GARE = "ufficio-benchmark@prova.test";

// Gli utenti del collaudo, NELL'ORDINE del piano 28 (D3 prima di D1 e del passo 3). D3 è ridotta: ti-admin abilita SOLO il Radar
// dell'impresa 3 dalla console (nessuna «Prova gratuita»).
export const UTENTI_COLLAUDO = [
  { email: "ti-admin@prova.test", zona: "console", arrivo: "/", passo: "D3", ruolo: "amministratore", compito: "abilita SOLO il Radar dell'impresa 3 dalla console (nessuna prova gratuita), poi Esci" },
  { email: IMPRESA_3, zona: "omnia-ai", arrivo: `${OPPORTUNITA}/profilo`, passo: "1 (D1)", ruolo: "titolare", impresa: IMPRESA_3, prerequisiti: ["radar_impresa_3"], compito: "salva il profilo dell'impresa 3, apre «Per te», poi Esci" },
  { email: IMPRESA_1, zona: "omnia-ai", arrivo: OPPORTUNITA, passo: "2", ruolo: "titolare", impresa: IMPRESA_1, compito: "profilo, «Per te», correlate, salvate e monitorate, Cerca, misure, poi Esci" },
  { email: UFFICIO_GARE, zona: "omnia-ai", arrivo: OPPORTUNITA, passo: "3", ruolo: "ufficio_gare", impresa: IMPRESA_3, prerequisiti: ["radar_impresa_3", "membro_attivo"], compito: "menu, profilo in sola lettura, «Per te», salvate, gara D2, misure, poi Esci" },
  { email: IMPRESA_2, zona: "omnia-ai", arrivo: OPPORTUNITA, passo: "4", ruolo: "titolare", impresa: IMPRESA_2, gareGratuite: true, garaD2Invisibile: true, compito: "«Per te» con l'invito, una ricerca in Cerca, Monitorate, gara D2 per indirizzo diretto, poi Esci" },
];

// Tabelle con i dati di un'impresa che la sessione di un'ALTRA impresa non deve poter leggere (RLS), con la colonna dell'impresa.
export const TABELLE_ISOLAMENTO = [
  { tabella: "omnia_ai_radar_profili", colonna: "user_id" },
  { tabella: "omnia_ai_radar_salvate", colonna: "user_id" },
  { tabella: "omnia_ai_radar_gare_aggiunte", colonna: "user_id" },
  { tabella: "omnia_ai_radar_impostazioni", colonna: "user_id" },
  { tabella: "omnia_ai_radar_utilizzi", colonna: "user_id" },
  { tabella: "omnia_ai_notifiche", colonna: "user_id" },
  { tabella: "gare", colonna: "user_id" },
  { tabella: "subscriptions", colonna: "user_id" },
  { tabella: "omnia_ai_gare_gratuite", colonna: "user_id" },
  { tabella: "omnia_ai_membri", colonna: "titolare_id" },
  { tabella: "users", colonna: "id" },
];

// La gara sintetica D2: dati dichiarati, collegamento su un dominio che non esiste (.invalid), nessun CIG.
export const GARA_D2 = { oggetto: "COLLAUDO B4 — gara sintetica dell'Ufficio Gare", ente: "Ente sintetico COLLAUDO B4", url: "https://esempio.invalid/collaudo-b4" };
export const PREFISSO_D2 = "COLLAUDO B4 — gara sintetica";

/** La gara aggiunta è quella sintetica dichiarata? Oggetto col prefisso, collegamento su .invalid, nessun CIG. */
export function garaD2Conforme(g) {
  let host = "";
  try {
    host = new URL(String(g?.url ?? "")).hostname;
  } catch {
    host = "";
  }
  return String(g?.oggetto ?? "").startsWith(PREFISSO_D2) && host.endsWith(".invalid") && !g?.cig;
}

// Tentativi di scrittura diretta sul profilo con il token dell'utente (piano 28 §5): costruiti per NON scrivere nulla nemmeno se, per
// errore, fossero ammessi. a: filtro impossibile (posizione 0, fuori dal vincolo 1–5) → 0 righe; b: id impossibile → 0 righe; c: posizione 9,
// fuori dal vincolo → la riga sarebbe respinta (400). Attesi 401 o 403: qualunque altra risposta vuol dire che il permesso c'è.
export const ID_IMPOSSIBILE = "00000000-0000-0000-0000-000000000000";
export const STATI_SCRITTURA_RESPINTA = new Set([401, 403]);
export function tentativiScrittura(idImpresa) {
  const base = `${STAGING_URL}/rest/v1/omnia_ai_radar_profili`;
  return [
    { lettera: "a", metodo: "PATCH", url: `${base}?user_id=eq.${idImpresa}&posizione=eq.0`, corpo: { nome: "Profilo principale" } },
    { lettera: "b", metodo: "DELETE", url: `${base}?id=eq.${ID_IMPOSSIBILE}`, corpo: null },
    { lettera: "c", metodo: "POST", url: base, corpo: { user_id: idImpresa, posizione: 9, nome: "COLLAUDO B4 — tentativo da respingere" } },
  ];
}

// I 10 controlli obbligatori dell'approvazione del 19/11 (28_APPROVAZIONE_COLLAUDO_B4.md): che cosa verifica lo script lato server e che
// cosa si osserva nel browser (passi del piano 28 §3), con l'esito di ognuno nel resoconto.
export const CONTROLLI = [
  { n: 1, titolo: "Profilo e filtri di «Per te»", browser: "passi 1, 2b, 2c, 2d, 3c" },
  { n: 2, titolo: "A pertinenti, B solo su richiesta, C escluse", browser: "passi 2d e 2e, letturaElenco su «Per te» (correlate solo dopo il separatore)" },
  { n: 3, titolo: "Nessuna gara doppia: chiavi uniche per pagina in «Per te», Cerca e Monitorate", browser: "letturaElenco su ogni pagina di «Per te», Cerca e Monitorate (passi 2d, 2f, 2g, 3c, 3d, 4)" },
  { n: 4, titolo: "Accesso dell'Ufficio Gare a Opportunità", browser: "passi 3a, 3c, 3d, 3f" },
  { n: 5, titolo: "Profilo in sola lettura per l'Ufficio Gare", browser: "passo 3b" },
  { n: 6, titolo: "Tre tentativi di scrittura diretta sul profilo con il token dell'utente: 401/403", browser: null },
  { n: 7, titolo: "Isolamento completo tra imprese, gara D2 compresa", browser: "passo 4 (Monitorate senza gare altrui, scheda della gara D2 per indirizzo diretto: «non trovata»)" },
  { n: 8, titolo: "Salvate, monitorate e aggiunte", browser: "passi 2f, 3d, 3e (in Monitorate «salvata da te»)" },
  { n: 9, titolo: "Gare gratuite dell'impresa 2: «usate» resta 0, nessuna riga nel registro", browser: "passo 4 (una ricerca in Cerca)" },
  { n: 10, titolo: "Richieste per vista e 60 s fermi senza richieste della pagina, anche per l'Ufficio Gare", browser: "passi 2h e 3g; conteggio con --misure sul registro dell'osservatore" },
];

export class Fermo extends Error {}

export function leggiVariabili(testo) {
  const v = {};
  for (const riga of testo.split(/\r?\n/)) {
    const m = riga.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let x = m[2].trim();
    if (x.length >= 2 && ((x[0] === '"' && x.endsWith('"')) || (x[0] === "'" && x.endsWith("'")))) x = x.slice(1, -1);
    v[m[1]] = x;
  }
  return v;
}

/** I problemi dell'ambiente (solo nomi, mai valori). Vuoto = solo staging e interruttori della B4 come nel piano 28. */
export function erroriAmbiente(v) {
  const e = [];
  if ((v.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/, "") !== STAGING_URL) e.push("NEXT_PUBLIC_SUPABASE_URL non è lo staging");
  if (!(v.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "").startsWith("sb_publishable_")) e.push("NEXT_PUBLIC_SUPABASE_ANON_KEY non è una chiave publishable");
  if (!(v.SUPABASE_SERVICE_ROLE_KEY ?? "").startsWith("sb_secret_")) e.push("SUPABASE_SERVICE_ROLE_KEY non è una chiave secret");
  for (const [k, valore] of Object.entries(v)) {
    if (typeof valore !== "string" || !valore) continue;
    if (valore.includes(PRODUZIONE_REF)) e.push(`${k} contiene l'identificativo del progetto di produzione`);
    if (/\b(sk|rk|pk)_live_/.test(valore)) e.push(`${k} contiene una chiave «live»`);
    if (/postgres(ql)?:\/\//i.test(valore)) e.push(`${k} contiene una stringa di connessione a un database`);
  }
  if (v.RADAR_PER_TE !== "attivo") e.push("RADAR_PER_TE non è «attivo»");
  if (v.RADAR_UFFICIO_GARE !== "attivo") e.push("RADAR_UFFICIO_GARE non è «attivo»");
  if (v.RADAR_CLASSIFICAZIONI !== "attive") e.push("RADAR_CLASSIFICAZIONI non è «attive»");
  for (const k of ["RADAR_NOTIFICHE_PREFERENZE", "RADAR_NOTIFICHE_EMAIL"]) if (!["", "0"].includes(v[k] ?? "")) e.push(`${k} deve essere spento (vuoto o «0»)`);
  return [...new Set(e)];
}

export function dentro(file, cartella) {
  const f = path.resolve(file).toLowerCase();
  const c = path.resolve(cartella).toLowerCase();
  return f === c || f.startsWith(c + path.sep);
}

export const nomeUtente = (email) => email.split("@")[0];

/** Il percorso d'accesso di un utente: POST /accesso/<parte prima della chiocciola>. */
export const percorsoAccesso = (email) => `/accesso/${nomeUtente(email)}`;

/** Dove arriva il browser dopo l'accesso: l'app su localhost, con la zona scelta da ?__zone. Nessun token. */
export const indirizzoArrivo = (porta, utente) => `http://${SOLO_LOCALE}:${porta}${utente.arrivo}?__zone=${utente.zona}`;

/** Collegamento d'accesso di UN utente di prova (generate_link, lato server, chiave dello staging). Solo l'hash del token, in memoria. */
export async function generaCollegamento({ variabili, email, fetchFn = fetch }) {
  if (!/@prova\.test$/.test(email)) throw new Fermo("solo utenti di prova @prova.test");
  const risposta = await fetchFn(`${STAGING_URL}/auth/v1/admin/generate_link`, {
    method: "POST",
    headers: { apikey: variabili.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${variabili.SUPABASE_SERVICE_ROLE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ type: "magiclink", email }),
  });
  if (!risposta.ok) throw new Fermo(`collegamento per ${nomeUtente(email)} non generato (risposta ${risposta.status})`);
  const d = await risposta.json();
  const hash = d?.hashed_token ?? d?.properties?.hashed_token;
  if (!hash) throw new Fermo(`collegamento per ${nomeUtente(email)} non generato (risposta senza token)`);
  return hash;
}

/** Verifica il token LATO SERVER con la stessa libreria dell'app (@supabase/ssr, verifyOtp) e restituisce i cookie di sessione. */
export async function cookieDiSessione({ variabili, tokenHash, fetchFn = fetch }) {
  const impostati = [];
  const supabase = createServerClient(STAGING_URL, variabili.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: { getAll: () => [], setAll: (lista) => void impostati.push(...lista) },
    global: { fetch: fetchFn },
  });
  const { data, error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: "magiclink" });
  if (error || !data?.session) throw new Fermo(`verifica dell'accesso non riuscita (${error?.code ?? error?.status ?? "nessuna sessione"})`);
  const cookie = impostati.filter((c) => (c.name === COOKIE_SESSIONE || c.name.startsWith(`${COOKIE_SESSIONE}.`)) && c.value);
  if (!cookie.length) throw new Fermo("verifica riuscita ma nessun cookie di sessione prodotto");
  // Il token d'accesso resta solo in memoria: serve alle verifiche lato server e poi si dimentica.
  return { cookie, accessToken: data.session.access_token };
}

// ───── letture per le verifiche: SOLO GET (tranne i tre tentativi), solo conteggi a schermo ─────

/**
 * Le letture dello staging per le verifiche. Con la chiave di servizio (confronti, prerequisiti, verifiche finali) o con il token
 * dell'utente (righe viste). Sempre e solo GET. Gli id restano in memoria e non si stampano mai.
 */
export function creaLettore({ variabili, fetchFn = fetch }) {
  const servizio = { apikey: variabili.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${variabili.SUPABASE_SERVICE_ROLE_KEY}` };
  const diSessione = (token) => ({ apikey: variabili.NEXT_PUBLIC_SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` });
  const leggi = (percorso, intestazioni) => fetchFn(`${STAGING_URL}${percorso}`, { method: "GET", headers: intestazioni });
  const ids = new Map();
  return {
    /** Righe che soddisfano il filtro: { n } oppure { errore: stato }. token = null → chiave di servizio. */
    async conta(tabella, colonna, filtro, token = null) {
      const r = await leggi(`/rest/v1/${tabella}?select=${colonna}&${filtro}&limit=1`, { ...(token ? diSessione(token) : servizio), Prefer: "count=exact" });
      if (!r.ok) return { errore: r.status };
      const n = Number((r.headers.get("content-range") ?? "").split("/")[1]);
      return Number.isFinite(n) ? { n } : { errore: "conteggio assente" };
    },
    /** Righe (chiave di servizio) per le verifiche finali; i valori restano in memoria. */
    async righe(tabella, colonne, filtro) {
      const r = await leggi(`/rest/v1/${tabella}?select=${colonne}&${filtro}`, servizio);
      if (!r.ok) return { errore: r.status };
      const d = await r.json();
      return Array.isArray(d) ? { righe: d } : { errore: "risposta inattesa" };
    },
    /** L'id di un utente di prova (chiave di servizio), o null. */
    async idDi(email) {
      if (!ids.has(email)) {
        const r = await leggi(`/rest/v1/users?select=id&email=eq.${encodeURIComponent(email)}`, servizio);
        const id = r.ok ? (await r.json())?.[0]?.id : null;
        if (!id) return null;
        ids.set(email, id);
      }
      return ids.get(email);
    },
    /** L'utente del token ({ id, email }) o null. */
    async identita(token) {
      const r = await leggi("/auth/v1/user", diSessione(token));
      const d = r.ok ? await r.json() : null;
      return d?.id && d?.email ? { id: d.id, email: String(d.email).toLowerCase() } : null;
    },
    /** I tre tentativi di scrittura con il token dell'utente: solo lo stato della risposta. */
    async tenta(t, token) {
      const r = await fetchFn(t.url, {
        method: t.metodo,
        headers: { ...diSessione(token), "Content-Type": "application/json", Prefer: "return=minimal" },
        ...(t.corpo ? { body: JSON.stringify(t.corpo) } : {}),
      });
      return r.status;
    },
  };
}

const descrivi = (x) => (x.n !== undefined ? String(x.n) : `errore ${x.errore}`);

/** Una voce del resoconto: controllo (1–10), testo (solo nomi di prova, tabelle e conteggi), esito. */
const voce = (controllo, testo, esito) => ({ controllo, testo, esito });

/** Riga stampabile di una voce. */
export const rigaVoce = (v) => `[${v.controllo}] ${v.testo} → ${v.esito}`;

/** La voce va fermata? */
export const daFermare = (voci) => voci.find((v) => ESITI_FERMO.has(v.esito)) ?? null;

/**
 * Controllo positivo: la sessione vede le stesse righe della chiave di servizio, e almeno una. Se la sessione ne vede meno, il token non
 * legge ciò che deve e gli zeri dell'isolamento non dimostrano nulla: ERRORE (fermo). Se non esiste nessuna riga: seVuoto (di regola
 * ERRORE; «NON RIUSCITO» dove la riga dipende da un passo del browser, come il profilo D1 letto dall'Ufficio Gare).
 */
async function positivo(lettore, controllo, testo, tabella, colonna, filtro, token, seVuoto = "ERRORE") {
  const [esistono, viste] = await Promise.all([lettore.conta(tabella, colonna, filtro), lettore.conta(tabella, colonna, filtro, token)]);
  let esito = "ok";
  if (esistono.errore !== undefined || viste.errore !== undefined) esito = "ERRORE";
  else if (esistono.n === 0) esito = seVuoto;
  else if (viste.n !== esistono.n) esito = "ERRORE";
  return voce(controllo, `${testo}: viste ${descrivi(viste)}, esistenti ${descrivi(esistono)} (attese uguali e almeno 1)`, esito);
}

/** Isolamento su UNA tabella rispetto a UN'altra impresa: viste con la sessione 0 (o accesso negato), confrontate con le esistenti. */
async function isolamento(lettore, nome, nomeAltra, { tabella, colonna }, idAltra, token) {
  const filtro = `${colonna}=eq.${idAltra}`;
  const [esistono, viste] = await Promise.all([lettore.conta(tabella, colonna, filtro), lettore.conta(tabella, colonna, filtro, token)]);
  let esito;
  if (viste.n > 0) esito = "VIOLAZIONE";
  else if (viste.errore !== undefined && !STATI_SCRITTURA_RESPINTA.has(viste.errore)) esito = "ERRORE";
  else if (esistono.errore !== undefined) esito = "ERRORE";
  else if (esistono.n === 0) esito = "non applicabile (l'altra impresa non ha righe)";
  else esito = viste.n === 0 ? "ok" : `ok (accesso negato, ${viste.errore})`;
  return voce(7, `${nome} → impresa di ${nomeAltra}, ${tabella}: viste ${descrivi(viste)}, esistenti ${descrivi(esistono)}`, esito);
}

/** Prerequisiti di un utente, con la chiave di servizio, PRIMA di generare il suo collegamento. { ok, motivo }. */
export async function verificaPrerequisiti({ lettore, utente }) {
  for (const p of utente.prerequisiti ?? []) {
    const id3 = await lettore.idDi(IMPRESA_3);
    if (!id3) return { ok: false, motivo: "impresa 3 non trovata" };
    if (p === "radar_impresa_3") {
      const r = await lettore.conta("omnia_ai_radar_impostazioni", "user_id", `user_id=eq.${id3}&attivo=eq.true`);
      if (r.n !== 1) return { ok: false, motivo: `il Radar dell'impresa 3 non risulta abilitato (${descrivi(r)}): completare prima la D3 con ti-admin` };
    }
    if (p === "membro_attivo") {
      const idMembro = await lettore.idDi(utente.email);
      const r = idMembro ? await lettore.conta("omnia_ai_membri", "membro_id", `membro_id=eq.${idMembro}&titolare_id=eq.${id3}&attivo=eq.true`) : { errore: "utente non trovato" };
      if (r.n !== 1) return { ok: false, motivo: `${nomeUtente(utente.email)} non risulta Ufficio Gare attivo dell'impresa 3 (${descrivi(r)})` };
    }
  }
  return { ok: true, motivo: "" };
}

/**
 * Verifiche lato server con la sessione appena creata, PRIMA che il browser entri nell'app. Restituisce le voci e, per il passo 4, lo
 * stato delle gare gratuite dell'impresa 2 (base del controllo 9). Ogni eccezione diventa una voce ERRORE (quindi FERMO).
 */
export async function verificheDopoAccesso({ lettore, utente, accessToken, inizio }) {
  const nome = nomeUtente(utente.email);
  const voci = [];
  const extra = {};
  try {
    const io = await lettore.identita(accessToken);
    if (!io || io.email !== utente.email) {
      voci.push(voce(7, `${nome}: identità della sessione non riconosciuta`, "ERRORE"));
      return { voci, extra };
    }
    voci.push(voce(7, `${nome}: identità della sessione = utente del clic`, "ok"));
    if (utente.ruolo === "amministratore") return { voci, extra };

    const idImpresa = await lettore.idDi(utente.impresa);
    if (!idImpresa) {
      voci.push(voce(7, `${nome}: impresa non trovata`, "ERRORE"));
      return { voci, extra };
    }
    // controlli positivi: il token legge davvero ciò che deve (altrimenti gli zeri dell'isolamento non dimostrano nulla)
    voci.push(await positivo(lettore, 7, `${nome}: propria riga di users`, "users", "id", `id=eq.${io.id}`, accessToken));
    if (utente.ruolo === "ufficio_gare") {
      voci.push(await positivo(lettore, 4, `${nome}: iscrizione attiva all'Ufficio Gare dell'impresa 3`, "omnia_ai_membri", "membro_id", `membro_id=eq.${io.id}&titolare_id=eq.${idImpresa}&attivo=eq.true`, accessToken));
      voci.push(await positivo(lettore, 5, `${nome}: profilo dell'impresa 3 letto con la sua sessione (sola lettura)`, "omnia_ai_radar_profili", "user_id", `user_id=eq.${idImpresa}`, accessToken, "NON RIUSCITO (manca il profilo D1)"));
    } else if (utente.email === IMPRESA_3) {
      voci.push(await positivo(lettore, 4, `${nome}: Ufficio Gare attivo della propria impresa`, "omnia_ai_membri", "titolare_id", `titolare_id=eq.${io.id}&attivo=eq.true`, accessToken));
    }
    // controllo 9, base: la prova gratuita dell'impresa 2 (letta anche con la sua sessione), «usate» 0, nessuna riga nuova nel registro
    if (utente.gareGratuite) {
      voci.push(await positivo(lettore, 9, `${nome}: propria prova gratuita`, "omnia_ai_gare_gratuite", "user_id", `user_id=eq.${io.id}`, accessToken));
      const g = await lettore.righe("omnia_ai_gare_gratuite", "usate", `user_id=eq.${io.id}`);
      const usate = g.righe?.length === 1 ? Number(g.righe[0].usate) : null;
      extra.usateIniziali = usate;
      voci.push(voce(9, `${nome}: gare gratuite «usate» all'accesso: ${usate ?? (g.errore !== undefined ? `errore ${g.errore}` : "riga assente")} (atteso 0)`, usate === 0 ? "ok" : "ERRORE"));
      const log = await lettore.conta("omnia_ai_gare_gratuite_log", "id", `user_id=eq.${io.id}&created_at=gte.${encodeURIComponent(inizio)}`);
      voci.push(voce(9, `${nome}: righe nuove nel registro delle gare gratuite all'accesso: ${descrivi(log)} (atteso 0)`, log.n === 0 ? "ok" : log.errore !== undefined ? "ERRORE" : "VIOLAZIONE"));
    }

    // controllo 6: i tre tentativi di scrittura diretta sul profilo
    for (const t of tentativiScrittura(idImpresa)) {
      let stato;
      try {
        stato = await lettore.tenta(t, accessToken);
      } catch {
        stato = "rete";
      }
      voci.push(voce(6, `${nome}: tentativo ${t.lettera} (${t.metodo} su omnia_ai_radar_profili) risposta ${stato} (attesa 401 o 403)`, STATI_SCRITTURA_RESPINTA.has(stato) ? "ok" : stato === "rete" ? "ERRORE" : "VIOLAZIONE"));
    }

    // controllo 7: isolamento da TUTTE le altre imprese, tabella per tabella
    for (const altra of IMPRESE.filter((x) => x !== utente.impresa)) {
      const idAltra = await lettore.idDi(altra);
      if (!idAltra) {
        voci.push(voce(7, `${nome}: impresa di ${nomeUtente(altra)} non trovata`, "ERRORE"));
        continue;
      }
      voci.push(...(await Promise.all(TABELLE_ISOLAMENTO.map((t) => isolamento(lettore, nome, nomeUtente(altra), t, idAltra, accessToken)))));
    }

    // controllo 7: la gara sintetica D2 dell'impresa 3 è invisibile all'impresa 2
    if (utente.garaD2Invisibile) {
      const id3 = await lettore.idDi(IMPRESA_3);
      const filtro = `user_id=eq.${id3}&oggetto=like.${encodeURIComponent(`${PREFISSO_D2}*`)}`;
      const [esistono, viste] = await Promise.all([lettore.conta("omnia_ai_radar_gare_aggiunte", "id", filtro), lettore.conta("omnia_ai_radar_gare_aggiunte", "id", filtro, accessToken)]);
      let esito = "ok";
      if (viste.n > 0) esito = "VIOLAZIONE";
      else if (viste.errore !== undefined || esistono.errore !== undefined) esito = "ERRORE";
      else if (esistono.n !== 1) esito = "NON RIUSCITO (la gara D2 non c'è)";
      voci.push(voce(7, `${nome}: gara sintetica D2 dell'impresa 3: viste ${descrivi(viste)}, esistenti ${descrivi(esistono)}`, esito));
    }
  } catch {
    voci.push(voce(7, `${nome}: verifica interrotta da un errore`, "ERRORE"));
  }
  return { voci, extra };
}

/** Righe di una tabella scritte o toccate nella finestra (unione per id di più colonne di data, ognuna con un filtro semplice). */
async function righeDellaFinestra(lettore, tabella, colonne, filtroBase, colonneData, inizio) {
  const per = new Map();
  for (const c of colonneData) {
    const r = await lettore.righe(tabella, `id,${colonne}`, `${filtroBase}&${c}=gte.${encodeURIComponent(inizio)}`);
    if (r.errore !== undefined) return { errore: r.errore };
    for (const x of r.righe) per.set(x.id, x);
  }
  return { righe: [...per.values()] };
}

/**
 * Verifiche finali (dopo il passo 4), SOLO con la chiave di servizio e SOLO GET: le scritture della finestra. Nessun valore a schermo,
 * solo conteggi ed esiti. usateIniziali = «usate» dell'impresa 2 letto all'accesso del passo 4.
 */
export async function verificheFinali({ lettore, inizio, usateIniziali }) {
  const voci = [];
  try {
    const [id1, id2, id3, idUfficio] = await Promise.all([lettore.idDi(IMPRESA_1), lettore.idDi(IMPRESA_2), lettore.idDi(IMPRESA_3), lettore.idDi(UFFICIO_GARE)]);
    if (!id1 || !id2 || !id3 || !idUfficio) return [voce(8, "utenti di prova non trovati", "ERRORE")];
    const nomi = new Map([[id1, nomeUtente(IMPRESA_1)], [id2, nomeUtente(IMPRESA_2)], [id3, nomeUtente(IMPRESA_3)]]);

    // 1 e 5: profili
    const profili = await lettore.righe("omnia_ai_radar_profili", "user_id,aggiornato_da,settori", `user_id=in.(${id1},${id2},${id3})`);
    if (profili.errore !== undefined) voci.push(voce(1, `profili: lettura non riuscita (${profili.errore})`, "ERRORE"));
    else {
      for (const [id, attesi] of [[id1, 1], [id3, 1], [id2, 0]]) {
        const suoi = profili.righe.filter((p) => p.user_id === id);
        const autoreGiusto = suoi.every((p) => p.aggiornato_da === id);
        const conSettori = suoi.every((p) => Array.isArray(p.settori) && p.settori.length > 0);
        let esito = "ok";
        if (suoi.length > attesi || !autoreGiusto) esito = "VIOLAZIONE";
        else if (suoi.length < attesi || !conSettori) esito = "NON RIUSCITO";
        voci.push(voce(1, `profili dell'impresa di ${nomi.get(id)}: ${suoi.length} (attesi ${attesi}), autore il titolare: ${autoreGiusto ? "sì" : "NO"}, con settori: ${conSettori ? "sì" : "no"}`, esito));
      }
    }
    const daUfficio = await lettore.conta("omnia_ai_radar_profili", "id", `aggiornato_da=eq.${idUfficio}`);
    voci.push(voce(5, `profili scritti da ${nomeUtente(UFFICIO_GARE)}: ${descrivi(daUfficio)} (attesi 0)`, daUfficio.n === 0 ? "ok" : daUfficio.errore !== undefined ? "ERRORE" : "VIOLAZIONE"));
    const toccati = await lettore.conta("omnia_ai_radar_profili", "id", `aggiornato_il=gte.${encodeURIComponent(inizio)}`);
    voci.push(voce(1, `profili scritti nella finestra: ${descrivi(toccati)} (tetto 2)`, toccati.errore !== undefined ? "ERRORE" : toccati.n <= 2 ? "ok" : "VIOLAZIONE"));

    // 8: salvate e monitorate per impresa
    for (const [id, tetto] of [[id1, 3], [id3, 4], [id2, 0]]) {
      const s = await righeDellaFinestra(lettore, "omnia_ai_radar_salvate", "monitorata,salvata_da,aggiunta_id,creata_il", `user_id=eq.${id}`, ["creata_il", "aggiornata_il", "ultimo_aggiornamento_visto_il"], inizio);
      if (s.errore !== undefined) {
        voci.push(voce(8, `salvate dell'impresa di ${nomi.get(id)}: lettura non riuscita (${s.errore})`, "ERRORE"));
        continue;
      }
      const monitorate = s.righe.filter((r) => r.monitorata).length;
      let esito = "ok";
      if (s.righe.length > tetto) esito = "VIOLAZIONE";
      else if (tetto > 0 && (s.righe.length === 0 || monitorate === 0)) esito = "NON RIUSCITO";
      let testo = `salvate dell'impresa di ${nomi.get(id)} nella finestra: ${s.righe.length} (tetto ${tetto}), monitorate ${monitorate}`;
      if (id === id3) {
        const dallUfficio = s.righe.filter((r) => r.salvata_da === idUfficio).length;
        testo += `, salvate da ${nomeUtente(UFFICIO_GARE)} ${dallUfficio}`;
        if (esito === "ok" && dallUfficio === 0) esito = "NON RIUSCITO";
      }
      voci.push(voce(8, testo, esito));
    }

    // 8 (e D2): gare aggiunte nella finestra: solo la gara sintetica D2, dell'impresa 3, aggiunta dall'Ufficio Gare e salvata
    for (const id of [id1, id2, id3]) {
      const a = await lettore.righe("omnia_ai_radar_gare_aggiunte", "id,oggetto,url,cig,creata_da", `user_id=eq.${id}&creata_il=gte.${encodeURIComponent(inizio)}`);
      if (a.errore !== undefined) {
        voci.push(voce(8, `gare aggiunte dell'impresa di ${nomi.get(id)}: lettura non riuscita (${a.errore})`, "ERRORE"));
        continue;
      }
      if (id !== id3) {
        voci.push(voce(8, `gare aggiunte dell'impresa di ${nomi.get(id)} nella finestra: ${a.righe.length} (attese 0)`, a.righe.length === 0 ? "ok" : "VIOLAZIONE"));
        continue;
      }
      const conformi = a.righe.filter(garaD2Conforme).length;
      const dallUfficio = a.righe.filter((g) => g.creata_da === idUfficio).length;
      let esito = "ok";
      if (a.righe.length > 1 || conformi !== a.righe.length || dallUfficio !== a.righe.length) esito = "VIOLAZIONE";
      else if (a.righe.length === 0) esito = "NON RIUSCITO";
      else {
        const salvata = await lettore.conta("omnia_ai_radar_salvate", "id", `user_id=eq.${id3}&aggiunta_id=eq.${a.righe[0].id}&salvata_da=eq.${idUfficio}`);
        if (salvata.errore !== undefined) esito = "ERRORE";
        else if (salvata.n !== 1) esito = "NON RIUSCITO";
      }
      voci.push(voce(8, `gare aggiunte dell'impresa di ${nomi.get(id)} nella finestra: ${a.righe.length} (attesa 1, la D2), sintetiche dichiarate ${conformi}, aggiunte da ${nomeUtente(UFFICIO_GARE)} ${dallUfficio}`, esito));
    }

    // 9: gare gratuite dell'impresa 2 dopo le sue ricerche; nessuna riga nuova nei registri delle gare gratuite (tetto 0)
    const g = await lettore.righe("omnia_ai_gare_gratuite", "usate", `user_id=eq.${id2}`);
    const usate = g.righe?.length === 1 ? Number(g.righe[0].usate) : null;
    voci.push(voce(9, `gare gratuite «usate» dell'impresa di ${nomi.get(id2)} alla fine: ${usate ?? "non lette"} (all'accesso ${usateIniziali ?? "non lette"}, atteso 0)`, usate === null || usateIniziali === null || usateIniziali === undefined ? "ERRORE" : usate === 0 && usateIniziali === 0 ? "ok" : "VIOLAZIONE"));
    const ricerche = await lettore.conta("omnia_ai_radar_utilizzi", "id", `user_id=eq.${id2}&azione=eq.ricerca&creato_il=gte.${encodeURIComponent(inizio)}`);
    voci.push(voce(9, `ricerche dell'impresa di ${nomi.get(id2)} nella finestra: ${descrivi(ricerche)} (almeno 1)`, ricerche.errore !== undefined ? "ERRORE" : ricerche.n >= 1 ? "ok" : "NON RIUSCITO"));
    const registro = await lettore.conta("omnia_ai_gare_gratuite_log", "id", `created_at=gte.${encodeURIComponent(inizio)}`);
    voci.push(voce(9, `righe nuove nel registro delle gare gratuite (tutte le imprese): ${descrivi(registro)} (tetto 0)`, registro.errore !== undefined ? "ERRORE" : registro.n === 0 ? "ok" : "VIOLAZIONE"));
    const gratuite = await lettore.conta("omnia_ai_gare_gratuite", "user_id", `aggiornato_il=gte.${encodeURIComponent(inizio)}`);
    voci.push(voce(9, `gare gratuite modificate nella finestra (tutte le imprese): ${descrivi(gratuite)} (tetto 0)`, gratuite.errore !== undefined ? "ERRORE" : gratuite.n === 0 ? "ok" : "VIOLAZIONE"));

    // 4: D3 ridotta (solo il Radar dell'impresa 3) e uso di Opportunità da parte dell'Ufficio Gare
    const radar3 = await lettore.conta("omnia_ai_radar_impostazioni", "user_id", `user_id=eq.${id3}&attivo=eq.true`);
    voci.push(voce(4, `Radar dell'impresa di ${nomi.get(id3)} abilitato: ${descrivi(radar3)} (atteso 1)`, radar3.errore !== undefined ? "ERRORE" : radar3.n === 1 ? "ok" : "NON RIUSCITO"));
    const impostazioni = await lettore.conta("omnia_ai_radar_impostazioni", "user_id", `aggiornata_il=gte.${encodeURIComponent(inizio)}`);
    voci.push(voce(4, `impostazioni del Radar scritte nella finestra: ${descrivi(impostazioni)} (tetto 1, D3)`, impostazioni.errore !== undefined ? "ERRORE" : impostazioni.n <= 1 ? "ok" : "VIOLAZIONE"));
    const console3 = await lettore.conta("radar_console_registro", "id", `creato_il=gte.${encodeURIComponent(inizio)}`);
    voci.push(voce(4, `righe nuove nel registro della console: ${descrivi(console3)} (tetto 1, D3)`, console3.errore !== undefined ? "ERRORE" : console3.n <= 1 ? "ok" : "VIOLAZIONE"));
    const usoUfficio = await lettore.conta("omnia_ai_radar_utilizzi", "id", `user_id=eq.${id3}&membro_id=eq.${idUfficio}&creato_il=gte.${encodeURIComponent(inizio)}`);
    voci.push(voce(4, `utilizzi di Opportunità registrati per ${nomeUtente(UFFICIO_GARE)}: ${descrivi(usoUfficio)} (almeno 1)`, usoUfficio.errore !== undefined ? "ERRORE" : usoUfficio.n >= 1 ? "ok" : "NON RIUSCITO"));
  } catch {
    voci.push(voce(8, "verifiche finali interrotte da un errore", "ERRORE"));
  }
  return voci;
}

/** Esito complessivo di un controllo dalle sue voci lato server. */
export function esitoControllo(voci) {
  if (!voci.length) return "nessuna verifica lato server";
  for (const e of ["VIOLAZIONE", "ERRORE"]) if (voci.some((v) => v.esito === e)) return e;
  if (voci.some((v) => v.esito.startsWith("NON RIUSCITO"))) return "NON RIUSCITO";
  return voci.some((v) => v.esito.startsWith("ok")) ? "ok" : "non applicabile";
}

/** Il resoconto dei 10 controlli: esito lato server (con il numero di voci) e la parte da registrare dal browser. */
export function resocontoControlli(voci) {
  return [
    "Resoconto dei 10 controlli (parte lato server; la parte nel browser va nel resoconto con le schermate):",
    ...CONTROLLI.map((c) => {
      const suoi = voci.filter((v) => v.controllo === c.n);
      const esito = esitoControllo(suoi);
      return `  ${c.n}. ${c.titolo}: lato server ${esito}${suoi.length ? ` (${suoi.length} voci)` : ""}${c.browser ? ` · nel browser: ${c.browser}` : ""}`;
    }),
  ];
}

// ───── nel browser: letture della pagina per i controlli 2 e 3 ─────

/**
 * Da eseguire NEL BROWSER sulla pagina aperta (strumento javascript del pannello) come `(${letturaElenco})(document)`: autosufficiente, non
 * usa nulla fuori di sé. Chiavi delle righe di gara (percorso del collegamento, senza parametri), doppie, e le SEZIONI dell'elenco con il
 * titolo del loro titoletto: in «Per te» solo «Gare correlate» (dopo le pertinenti); in Cerca anche «Fuori dai settori monitorati» (trovato
 * nel controllo preliminare del 19/11: i titoletti di Cerca sono più d'uno per costruzione). Nessun dato di persone.
 */
export function letturaElenco(documento) {
  const voci = Array.from(documento.querySelectorAll("a.omnia-opp-riga, .omnia-opp-separatore"));
  const chiavi = [];
  const sezioni = [{ titolo: "", righe: 0 }];
  for (const v of voci) {
    if (v.classList.contains("omnia-opp-separatore")) {
      const forte = typeof v.querySelector === "function" ? v.querySelector("strong") : null;
      sezioni.push({ titolo: String((forte && forte.textContent) || v.textContent || "").trim(), righe: 0 });
      continue;
    }
    chiavi.push(String(v.getAttribute("href") || "").split(/[?#]/)[0]);
    sezioni[sezioni.length - 1].righe += 1;
  }
  const viste = new Set();
  const doppie = [];
  for (const c of chiavi) {
    if (viste.has(c)) doppie.push(c);
    else viste.add(c);
  }
  const fuoriSchema = chiavi.filter((c) => !/\/opportunita\/(gara|aggiunta)\/[^/]+$/.test(c));
  const titoli = sezioni.slice(1).map((s) => s.titolo);
  let esito = "ok";
  if (doppie.length) esito = "DOPPIE";
  else if (fuoriSchema.length) esito = "CHIAVI FUORI SCHEMA";
  else if (titoli.some((t, i) => titoli.indexOf(t) !== i)) esito = "SEZIONE RIPETUTA";
  else if (!chiavi.length) esito = "elenco vuoto";
  const correlate = sezioni.find((s) => s.titolo === "Gare correlate");
  return {
    righe: chiavi.length,
    uniche: viste.size,
    doppie: Array.from(new Set(doppie)),
    fuoriSchema: fuoriSchema.length,
    pertinenti: sezioni[0].righe,
    correlate: correlate ? correlate.righe : 0,
    sezioni: sezioni.map((s, i) => `${i === 0 ? "(prima)" : s.titolo}: ${s.righe}`),
    esito,
  };
}

// ───── controllo 10: misure dal registro dell'osservatore di rete (file locali, nessuna rete) ─────

/** Le righe del registro di osserva-rete-anteprima.mjs: «ISO pid METODO origine+percorso». Le righe illeggibili si scartano. */
export function analizzaRegistro(testo) {
  const righe = [];
  for (const r of String(testo).split(/\r?\n/)) {
    const m = /^(\S+) (\d+) ([A-Z]+) (\S+)$/.exec(r.trim());
    if (!m) continue;
    const t = Date.parse(m[1]);
    let host = "?";
    let percorso = m[4];
    try {
      const u = new URL(m[4]);
      host = u.host;
      percorso = u.pathname;
    } catch {
      // resta «?»: conta come richiesta fuori dallo staging
    }
    if (Number.isFinite(t)) righe.push({ t, pid: Number(m[2]), metodo: m[3], host, percorso });
  }
  return righe;
}

/** Categoria di una richiesta dell'app. Il segnale di presenza (/api/presenza, ogni ~45 s, preesistente) fa 1 RPC e al più 2 getUser. */
export function categoria(r) {
  if (r.host !== `${STAGING_REF}.supabase.co`) return r.host.startsWith(`${SOLO_LOCALE}:`) || r.host === SOLO_LOCALE ? "locale" : "FUORI";
  if (r.percorso === "/auth/v1/user") return "utente";
  if (r.percorso === "/auth/v1/token") return "rinnovo";
  if (r.percorso === "/rest/v1/rpc/omnia_ai_presenza_segnale") return "presenza";
  if (r.percorso.startsWith("/rest/v1/rpc/")) return "rpc";
  if (r.percorso.startsWith("/rest/v1/")) return r.metodo === "GET" || r.metodo === "HEAD" ? "lettura" : "scrittura";
  return "altro";
}

/**
 * Richieste dell'app per finestra di tempo. finestre: [{ nome, da, a, ferma?, massimi? }]. «ferma» (almeno 60 s fermi sulla pagina): 0
 * richieste della pagina; ammesse solo quelle del segnale di presenza (1 RPC e al più 2 getUser per segnale) e i rinnovi della sessione,
 * contati a parte. «massimi»: { "METODO /percorso": n } da non superare (per esempio una sola lettura di radar_procedure per «Per te»).
 * escludiPid: il processo del collaudo stesso (stampato all'avvio), le cui verifiche non sono richieste dell'app.
 * @param {string} testo
 * @param {{ finestre: { nome: string; da: string; a: string; ferma?: boolean; massimi?: Record<string, number> }[]; escludiPid?: number[] }} opzioni
 */
export function misura(testo, { finestre, escludiPid = [] }) {
  const tutte = analizzaRegistro(testo).filter((r) => !escludiPid.includes(r.pid));
  const righe = [];
  let ok = true;
  for (const f of finestre) {
    const da = Date.parse(f.da);
    const a = Date.parse(f.a);
    if (!(Number.isFinite(da) && Number.isFinite(a) && a > da)) {
      righe.push(`${f.nome}: finestra non valida`);
      ok = false;
      continue;
    }
    const dentroFinestra = tutte.filter((r) => r.t >= da && r.t < a);
    const per = {};
    const perPercorso = {};
    for (const r of dentroFinestra) {
      const c = categoria(r);
      per[c] = (per[c] ?? 0) + 1;
      if (c !== "locale") perPercorso[`${r.metodo} ${r.percorso}`] = (perPercorso[`${r.metodo} ${r.percorso}`] ?? 0) + 1;
    }
    const staging = dentroFinestra.filter((r) => !["locale", "FUORI"].includes(categoria(r))).length;
    const problemi = [];
    if (per.FUORI) problemi.push(`${per.FUORI} richieste FUORI dallo staging`);
    let nota = "";
    if (f.ferma) {
      const durata = Math.round((a - da) / 1000);
      const presenze = per.presenza ?? 0;
      const pagina = staging - presenze - (per.utente ?? 0) - (per.rinnovo ?? 0);
      if (durata < 60) problemi.push(`finestra troppo corta (${durata} s, servono 60)`);
      if (pagina > 0) problemi.push(`${pagina} richieste della pagina durante l'attesa`);
      if ((per.utente ?? 0) > 2 * presenze) problemi.push(`${per.utente} getUser per ${presenze} segnali di presenza`);
      nota = ` · ferma ${durata} s: richieste della pagina ${Math.max(pagina, 0)}, segnale di presenza ${presenze} volte`;
    }
    for (const [chiave, massimo] of Object.entries(f.massimi ?? {})) {
      if ((perPercorso[chiave] ?? 0) > massimo) problemi.push(`${chiave}: ${perPercorso[chiave]} (al massimo ${massimo})`);
    }
    if (problemi.length) ok = false;
    const dettaglio = ["lettura", "scrittura", "rpc", "utente", "presenza", "rinnovo", "altro"].filter((c) => per[c]).map((c) => `${c} ${per[c]}`).join(", ");
    righe.push(`${f.nome}: ${staging} richieste allo staging${dettaglio ? ` (${dettaglio})` : ""}${nota} → ${problemi.length ? `NON RIUSCITO: ${problemi.join("; ")}` : "ok"}`);
  }
  return { ok, righe };
}

// ───── server d'accesso ─────

/** Set-Cookie per «localhost»: mai Domain (vale solo per l'host), Path, Max-Age e SameSite come li dà la libreria. Solo caratteri sicuri. */
export function intestazioneCookie({ name, value, options = {} }) {
  if (!/^[A-Za-z0-9._-]+$/.test(name) || !/^[A-Za-z0-9._~-]*$/.test(value)) throw new Fermo("cookie di sessione in un formato inatteso");
  const parti = [`${name}=${value}`, `Path=${options.path ?? "/"}`];
  if (options.maxAge !== undefined) parti.push(`Max-Age=${Math.floor(options.maxAge)}`);
  if (options.expires) parti.push(`Expires=${new Date(options.expires).toUTCString()}`);
  const stesso = options.sameSite === true ? "strict" : options.sameSite;
  if (stesso) parti.push(`SameSite=${String(stesso)[0].toUpperCase()}${String(stesso).slice(1).toLowerCase()}`);
  if (options.httpOnly) parti.push("HttpOnly");
  if (options.secure) parti.push("Secure");
  return parti.join("; ");
}

const nomiCookie = (intestazione) =>
  String(intestazione ?? "")
    .split(";")
    .map((p) => p.trim().split("=")[0])
    .filter(Boolean);

const uguali = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
};

function leggiCorpo(richiesta, massimo) {
  return new Promise((risolvi, rifiuta) => {
    let corpo = "";
    richiesta.setEncoding("utf8");
    richiesta.on("data", (d) => {
      corpo += d;
      if (corpo.length > massimo) {
        rifiuta(new Fermo("richiesta troppo grande"));
        richiesta.destroy();
      }
    });
    richiesta.on("end", () => risolvi(corpo));
    richiesta.on("error", rifiuta);
  });
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const STILE =
  "body{font:16px/1.5 system-ui,sans-serif;margin:0;padding:16px;background:#fff;color:#111}main{max-width:720px;margin:0 auto}h1{font-size:1.4rem}p.stato{padding:12px;border-radius:8px}p.aperta{background:#e6f4ea}p.preliminare{background:#fff4d6}p.fermo{background:#fde2e1;font-weight:600}ol{padding-left:20px}li{margin:12px 0}button{font:inherit;padding:10px 14px;border-radius:8px;border:1px solid #444;background:#f4f4f4;cursor:pointer;max-width:100%}button[disabled]{opacity:.55;cursor:not-allowed}span,small{color:#555;font-size:.9rem}code{background:#f1f1f1;padding:1px 4px;border-radius:4px;word-break:break-all}.d2{border:1px solid #ccc;border-radius:8px;padding:12px}";

function paginaPronto({ portaApp, preliminare, codice, stato }) {
  const app = `http://${SOLO_LOCALE}:${portaApp}`;
  const righe = UTENTI_COLLAUDO.map((u, i) => {
    const p = percorsoAccesso(u.email);
    const usato = stato.usati.has(p);
    const precedenteMancante = UTENTI_COLLAUDO.slice(0, i).find((x) => !stato.riusciti.has(percorsoAccesso(x.email)));
    let nota = "da usare, una volta";
    if (stato.fermo) nota = "fermo";
    else if (preliminare) nota = "bloccato (preliminare)";
    else if (usato) nota = stato.riusciti.has(p) ? "già usato" : "già usato, non riuscito";
    else if (precedenteMancante) nota = `dopo ${nomeUtente(precedenteMancante.email)}`;
    const spento = preliminare || usato || !!stato.fermo || !!precedenteMancante;
    return `<li><form method="post" action="${p}"><input type="hidden" name="via" value="${escapeHtml(codice)}"><button type="submit"${spento ? " disabled" : ""}>Passo ${escapeHtml(u.passo)} · Entra come ${escapeHtml(nomeUtente(u.email))} (${u.zona === "console" ? "console" : "OMNIA AI"})</button> <span>${escapeHtml(nota)}</span><br><small>${escapeHtml(u.compito)}</small></form></li>`;
  }).join("");
  const ultimo = percorsoAccesso(UTENTI_COLLAUDO[UTENTI_COLLAUDO.length - 1].email);
  const finaliSpento = preliminare || !!stato.fermo || stato.finali !== null || !stato.riusciti.has(ultimo);
  const finali = `<form method="post" action="/verifiche-finali"><input type="hidden" name="via" value="${escapeHtml(codice)}"><button type="submit"${finaliSpento ? " disabled" : ""}>Verifiche finali (dopo il passo 4)</button> <span>${stato.finali === null ? "solo letture con la chiave di servizio" : "già eseguite"}</span></form>`;
  const conteggio = `${stato.voci.length} verifiche lato server, ${stato.voci.filter((v) => ESITI_FERMO.has(v.esito)).length} da fermo`;
  let testoStato = "Finestra aperta. Nessun collegamento è stato generato: ognuno nasce solo quando premi il pulsante del suo utente, nell'ordine.";
  let classe = "aperta";
  if (preliminare) {
    testoStato = "MODALITÀ PRELIMINARE: nessun collegamento può essere generato e nessuna richiesta esce da questo computer.";
    classe = "preliminare";
  }
  if (stato.fermo) {
    testoStato = `COLLAUDO FERMATO: ${stato.fermo}. Nessun altro clic: l'app è stata spenta.`;
    classe = "fermo";
  }
  return `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="same-origin"><title>Collaudo B4 · pronto</title><style>${STILE}</style></head><body><main><h1>Collaudo B4 — pronto</h1><p class="stato ${classe}">${escapeHtml(testoStato)}</p><p>App: <a href="${app}/login?__zone=omnia-ai">${app}</a> (solo su questo computer). Questa pagina non contiene token e non ne genera da sola. ${escapeHtml(conteggio)}.</p><ol>${righe}</ol><div class="d2"><strong>Gara sintetica D2</strong> (passo 3e, «Aggiungi a mano», nessun CIG):<br>oggetto <code>${escapeHtml(GARA_D2.oggetto)}</code><br>ente <code>${escapeHtml(GARA_D2.ente)}</code><br>collegamento <code>${escapeHtml(GARA_D2.url)}</code></div><p>${finali}</p></main></body></html>`;
}

function paginaEsito(titolo, righe) {
  return `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Collaudo B4 · ${escapeHtml(titolo)}</title><style>${STILE}</style></head><body><main><h1>${escapeHtml(titolo)}</h1><ul>${righe.map((r) => `<li>${escapeHtml(r)}</li>`).join("")}</ul></main></body></html>`;
}

/**
 * Il server d'accesso (non ancora in ascolto). GET /pronto: la pagina senza token. POST /accesso/<utente> e POST /verifiche-finali con
 * codice della pagina, origine e host di questo server. Ogni altro metodo 405, ogni altro percorso 404, host estranei 403. Nessun
 * registro, nessuna cache, nessun referer.
 *   prerequisiti(utente) → { ok, motivo }: letture di servizio PRIMA del collegamento; se mancano, 409 e il pulsante resta da usare;
 *   accedi(utente) → { cookie, accessToken };
 *   verifica(utente, accessToken) → { voci, extra }: PRIMA del 303; VIOLAZIONE o ERRORE → nessun cookie, FERMO;
 *   finali() → voci; alFermo(motivo): spegne l'app.
 */
export function serverAccesso({ portaApp, preliminare = false, prerequisiti = async () => ({ ok: true }), accedi, verifica = async () => ({ voci: [] }), finali = async () => [], alFermo = () => {} }) {
  const codice = randomBytes(24).toString("base64url");
  const stato = { usati: new Set(), riusciti: new Set(), inCorso: false, fermo: null, finali: null, voci: [], extra: {} };
  const utenti = new Map(UTENTI_COLLAUDO.map((u) => [percorsoAccesso(u.email), u]));
  const base = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY" };
  const ferma = (motivo) => {
    if (stato.fermo) return;
    stato.fermo = motivo;
    console.log(`COLLAUDO FERMATO: ${motivo}. Nessun altro clic; l'app viene spenta.`);
    alFermo(motivo);
  };
  const registra = (voci) => {
    stato.voci.push(...voci);
    for (const v of voci) console.log(rigaVoce(v));
    const grave = daFermare(voci);
    if (grave) ferma(`[${grave.controllo}] ${grave.testo} → ${grave.esito}`);
    return !grave;
  };
  const server = http.createServer(async (richiesta, risposta) => {
    const testo = (codiceHttp, messaggio, extra = {}) => {
      risposta.writeHead(codiceHttp, { ...base, "Content-Type": "text/plain; charset=utf-8", ...extra });
      risposta.end(messaggio);
    };
    const html = (codiceHttp, corpo) => {
      risposta.writeHead(codiceHttp, { ...base, "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'" });
      risposta.end(corpo);
    };
    const porta = server.address()?.port;
    const proprio = `http://${SOLO_LOCALE}:${porta}`;
    if (richiesta.headers.host !== `${SOLO_LOCALE}:${porta}`) return testo(403, `Host non ammesso: aprire questa pagina come ${proprio}`);
    const percorso = (richiesta.url ?? "").split("?")[0];
    if (percorso === "/pronto") {
      if (richiesta.method !== "GET") return testo(405, "Solo GET.", { Allow: "GET" });
      // «same-origin» su /pronto: con «no-referrer» il browser invierebbe Origin: null nei POST dei pulsanti (controllo preliminare B3).
      risposta.writeHead(200, {
        ...base,
        "Referrer-Policy": "same-origin",
        "Content-Type": "text/html; charset=utf-8",
        "Content-Security-Policy": `default-src 'none'; style-src 'unsafe-inline'; form-action 'self' http://${SOLO_LOCALE}:${portaApp}; frame-ancestors 'none'; base-uri 'none'`,
      });
      risposta.end(paginaPronto({ portaApp, preliminare, codice, stato }));
      return;
    }
    const utente = utenti.get(percorso);
    if (!utente && percorso !== "/verifiche-finali") return testo(404, "Non trovato.");
    if (richiesta.method !== "POST") return testo(405, "Si entra solo con il pulsante della pagina /pronto.", { Allow: "POST" });
    if (richiesta.headers.origin !== proprio) return testo(403, "Origine non ammessa.");
    let via = "";
    try {
      via = new URLSearchParams(await leggiCorpo(richiesta, 2048)).get("via") ?? "";
    } catch {
      return testo(413, "Richiesta troppo grande.");
    }
    if (!uguali(via, codice)) return testo(403, "Codice della pagina non valido: riaprire /pronto.");
    if (preliminare) return testo(409, "Modalità preliminare: nessun collegamento viene generato.");
    if (stato.fermo) return testo(423, `Collaudo fermato: ${stato.fermo}.`);
    if (stato.inCorso) return testo(409, "Un'altra operazione è in corso: attendere.");

    if (!utente) {
      // verifiche finali: dopo il passo 4, una volta
      if (!stato.riusciti.has(percorsoAccesso(UTENTI_COLLAUDO[UTENTI_COLLAUDO.length - 1].email))) return testo(409, "Le verifiche finali vengono dopo il passo 4.");
      if (stato.finali !== null) return testo(410, "Verifiche finali già eseguite.");
      stato.finali = "in corso";
      stato.inCorso = true;
      try {
        const voci = await finali(stato.extra);
        registra(voci);
        stato.finali = "fatte";
        console.log("Verifiche finali eseguite.");
        return html(stato.fermo ? 423 : 200, paginaEsito(stato.fermo ? "COLLAUDO FERMATO" : "Verifiche finali", voci.map(rigaVoce)));
      } finally {
        stato.inCorso = false;
      }
    }

    const i = UTENTI_COLLAUDO.indexOf(utente);
    const mancante = UTENTI_COLLAUDO.slice(0, i).find((x) => !stato.riusciti.has(percorsoAccesso(x.email)));
    if (mancante) return testo(409, `Prima va completato il passo ${mancante.passo} (${nomeUtente(mancante.email)}).`);
    if (stato.usati.has(percorso)) return testo(410, "Accesso già usato per questo utente: ne serve uno nuovo con una nuova autorizzazione.");
    stato.inCorso = true;
    try {
      let pre;
      try {
        pre = await prerequisiti(utente);
      } catch {
        pre = { ok: false, motivo: "lettura dei prerequisiti non riuscita" };
      }
      if (!pre.ok) {
        console.log(`Accesso di ${nomeUtente(utente.email)} NON avviato: ${pre.motivo}. Nessun collegamento generato, pulsante ancora da usare.`);
        return testo(409, `Prerequisito mancante: ${pre.motivo}. Nessun collegamento generato.`);
      }
      stato.usati.add(percorso);
      let sessione;
      try {
        sessione = await accedi(utente);
      } catch (e) {
        console.log(`Accesso di ${nomeUtente(utente.email)} NON riuscito: ${e instanceof Fermo ? e.message : "errore inatteso"}.`);
        return testo(502, `Accesso non riuscito per ${nomeUtente(utente.email)}: nessun altro tentativo per questo utente senza una nuova autorizzazione.`);
      }
      // Verifiche lato server PRIMA di mandare il browser nell'app: se qualcosa non va, il browser non entra.
      let esito;
      try {
        esito = await verifica(utente, sessione.accessToken);
      } catch {
        esito = { voci: [voce(7, `${nomeUtente(utente.email)}: verifiche interrotte da un errore`, "ERRORE")] };
      }
      sessione.accessToken = null;
      Object.assign(stato.extra, esito.extra ?? {});
      if (!registra(esito.voci)) return html(423, paginaEsito("COLLAUDO FERMATO", [stato.fermo, "Il browser NON è entrato nell'app. Nessun altro clic."]));
      const nuovi = new Set(sessione.cookie.map((c) => c.name));
      const vecchi = nomiCookie(richiesta.headers.cookie).filter((n) => (n === COOKIE_SESSIONE || n.startsWith(`${COOKIE_SESSIONE}.`)) && !nuovi.has(n));
      risposta.writeHead(303, {
        ...base,
        Location: indirizzoArrivo(portaApp, utente),
        "Set-Cookie": [...sessione.cookie.map(intestazioneCookie), ...vecchi.map((n) => `${n}=; Path=/; Max-Age=0; SameSite=Lax`)],
      });
      risposta.end();
      stato.riusciti.add(percorso);
      console.log(`Accesso di ${nomeUtente(utente.email)} (passo ${utente.passo}): verifiche in regola, sessione impostata nel browser (nessun collegamento in un indirizzo).`);
    } finally {
      stato.inCorso = false;
    }
  });
  server.stato = stato;
  return server;
}

/** In ascolto SOLO sul loopback, con il nome «localhost»; se l'indirizzo risolto non è di loopback si chiude e si ferma. */
export function ascoltaSoloLocale(server, porta) {
  return new Promise((risolvi, rifiuta) => {
    server.once("error", rifiuta);
    server.listen(porta, SOLO_LOCALE, () => {
      const indirizzo = server.address();
      if (!INDIRIZZI_LOOPBACK.has(indirizzo.address)) {
        server.close();
        rifiuta(new Fermo("«localhost» non risolve sul loopback: avvio annullato"));
        return;
      }
      risolvi(indirizzo);
    });
  });
}

export function chiudi(server) {
  return new Promise((risolvi) => {
    if (!server.listening) return risolvi();
    server.close(() => risolvi());
    server.closeAllConnections?.();
  });
}

/** Controllo preliminare: solo /pronto, con i pulsanti bloccati. Nessuna autorizzazione, nessun file, nessuna rete. */
async function preliminare(argv, opzioni) {
  const [porta = "3110"] = argv;
  if (!/^\d{4,5}$/.test(porta)) throw new Fermo("porta non valida");
  const vietato = async () => {
    throw new Fermo("modalità preliminare");
  };
  const server = serverAccesso({ portaApp: porta, preliminare: true, prerequisiti: vietato, accedi: vietato, verifica: vietato, finali: vietato });
  try {
    const indirizzo = await ascoltaSoloLocale(server, opzioni.portaAccesso ?? Number(porta) + 1);
    console.log(`Controllo PRELIMINARE: http://${SOLO_LOCALE}:${indirizzo.port}/pronto — nessuna autorizzazione, nessun file delle variabili, nessuna rete, nessun collegamento. Ctrl+C per chiudere.`);
    await (opzioni.attendi
      ? opzioni.attendi({ portaAccesso: indirizzo.port })
      : new Promise((risolvi) => {
          for (const segnale of ["SIGINT", "SIGTERM"]) process.once(segnale, risolvi);
        }));
    return 0;
  } finally {
    await chiudi(server);
    console.log("Pagina d'accesso chiusa.");
  }
}

/** Controllo 10 dai file locali: registro dell'osservatore e finestre (JSON { escludiPid, finestre }). Nessuna rete. */
function misureDaFile(argv) {
  const [registro, fileFinestre] = argv;
  if (!registro || !fs.existsSync(registro) || !fileFinestre || !fs.existsSync(fileFinestre)) throw new Fermo("uso: --misure <registro dell'osservatore> <finestre.json>");
  const d = JSON.parse(fs.readFileSync(fileFinestre, "utf8"));
  const esito = misura(fs.readFileSync(registro, "utf8"), { finestre: d.finestre ?? [], escludiPid: (d.escludiPid ?? []).map(Number) });
  for (const r of esito.righe) console.log(r);
  console.log(esito.ok ? "Misure: tutte in regola." : "Misure: ALCUNE NON IN REGOLA.");
  return esito.ok ? 0 : 1;
}

/**
 * Il collaudo. Iniettabili per le prove a secco: controllaPorta, fetchFn, avvia (al posto del server dell'app; riceve { portaAccesso,
 * segnale } e deve chiudersi quando il segnale scatta), attendi, cartella, portaAccesso, adesso.
 */
export async function collaudo(argv, env, opzioni = {}) {
  if (argv[0] === "--preliminare") return preliminare(argv.slice(1), opzioni);
  if (argv[0] === "--misure") return misureDaFile(argv.slice(1));
  const cartella = opzioni.cartella ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const [fileVariabili, porta = "3110"] = argv;

  // 1. porta delle autorizzazioni
  let controllaPorta = opzioni.controllaPorta;
  if (!controllaPorta) {
    const registro = env.TI_REGISTRO;
    if (!registro) throw new Fermo("lanciare con esegui-autorizzato.mjs (autorizzazione registrata del coordinatore)");
    ({ controllaPorta } = await import(pathToFileURL(path.join(registro, "registro.mjs")).href));
  }
  try {
    controllaPorta({ script: NOME_SCRIPT });
  } catch (e) {
    throw new Fermo(e instanceof Error ? e.message : String(e));
  }

  // 2. guardia
  if (!fileVariabili || !fs.existsSync(fileVariabili)) throw new Fermo("file delle variabili mancante");
  if (dentro(fileVariabili, cartella)) throw new Fermo("il file delle variabili deve stare FUORI dalla cartella del progetto");
  if (!/^\d{4,5}$/.test(porta)) throw new Fermo("porta non valida");
  const variabili = leggiVariabili(fs.readFileSync(fileVariabili, "utf8"));
  const errori = erroriAmbiente(variabili);
  if (errori.length) throw new Fermo(`ambiente non autorizzato: ${errori.join("; ")}`);
  const lanciatore = path.join(cartella, "scripts", "avvia-anteprima-locale.mjs");
  if (!opzioni.avvia && !fs.existsSync(lanciatore)) throw new Fermo("manca scripts/avvia-anteprima-locale.mjs (i commit d'anteprima vanno integrati prima)");
  const fetchFn = opzioni.fetchFn ?? fetch;
  const inizio = new Date((opzioni.adesso ?? Date.now)() - MARGINE_INIZIO_MS).toISOString();

  // 3. server d'accesso SENZA collegamenti: ognuno nasce solo dal pulsante del suo utente (5.)
  const lettore = creaLettore({ variabili, fetchFn });
  const fermo = new AbortController();
  const server = serverAccesso({
    portaApp: porta,
    prerequisiti: (utente) => verificaPrerequisiti({ lettore, utente }),
    accedi: async (utente) => {
      const tokenHash = await generaCollegamento({ variabili, email: utente.email, fetchFn });
      return cookieDiSessione({ variabili, tokenHash, fetchFn });
    },
    verifica: (utente, accessToken) => verificheDopoAccesso({ lettore, utente, accessToken, inizio }),
    finali: (extra) => verificheFinali({ lettore, inizio, usateIniziali: extra.usateIniziali }),
    alFermo: () => fermo.abort(),
  });

  // 4. server dell'app; 8. alla fine si chiude tutto in ogni caso e si stampa il resoconto
  let codice = 0;
  try {
    const indirizzo = await ascoltaSoloLocale(server, opzioni.portaAccesso ?? Number(porta) + 1);
    console.log(`Pagina del collaudo: http://${SOLO_LOCALE}:${indirizzo.port}/pronto — nessun collegamento generato: ognuno nasce solo dal pulsante del suo utente, nell'ordine, dopo aver verificato il browser.`);
    console.log(`Processo del collaudo: pid ${process.pid} (da escludere dalle misure del controllo 10).`);
    const avvia =
      opzioni.avvia ??
      (({ segnale }) =>
        new Promise((risolvi) => {
          const figlio = spawn(process.execPath, [lanciatore, "avvia", fileVariabili, porta], { cwd: cartella, stdio: "inherit", env: process.env });
          for (const s of ["SIGINT", "SIGTERM"]) process.on(s, () => figlio.kill(s));
          segnale.addEventListener("abort", () => figlio.kill("SIGTERM"), { once: true });
          figlio.on("exit", (c) => risolvi(c ?? 0));
        }));
    codice = await avvia({ portaAccesso: indirizzo.port, segnale: fermo.signal });
  } finally {
    await chiudi(server);
    console.log("Pagina d'accesso chiusa.");
    for (const r of resocontoControlli(server.stato.voci)) console.log(r);
  }
  if (server.stato.fermo) {
    console.log(`Esito: COLLAUDO FERMATO (${server.stato.fermo}).`);
    return 3;
  }
  return codice;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  collaudo(process.argv.slice(2), process.env)
    .then((codice) => process.exit(codice))
    .catch((e) => {
      console.error(`COLLAUDO FERMATO: ${e instanceof Error ? e.message : e}`);
      process.exit(2);
    });
}
