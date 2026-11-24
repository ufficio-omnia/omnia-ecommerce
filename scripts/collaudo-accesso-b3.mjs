// Collaudo CON ACCESSO della fase B3 (interfaccia di Tender Intelligence) sullo STAGING. Scrive sullo staging (sessioni, presenza, utilizzi,
// salvataggi di prova): parte SOLO con un'autorizzazione registrata del coordinatore (tipo «scrittura_prova», 1 uso), lanciato da
// esegui-autorizzato.mjs dalla cartella dell'anteprima.
//
//   node scripts/collaudo-accesso-b3.mjs <file delle variabili> <porta>   → la finestra del collaudo (solo con autorizzazione registrata)
//   node scripts/collaudo-accesso-b3.mjs --preliminare <porta>            → controllo PRELIMINARE: solo la pagina /pronto; nessuna
//                                                                           autorizzazione, nessun file delle variabili, nessuna rete
//
// Finestra del collaudo, in ordine, fermandosi al primo problema PRIMA di qualunque rete:
//   1. porta delle autorizzazioni: TI_REGISTRO e controllaPorta (registro del coordinatore);
//   2. guardia: file delle variabili FUORI dal repository; Supabase = SOLO lo staging (URL esatto, chiavi nel formato dello staging, nessun
//      identificativo di produzione né chiave «live» in nessuna variabile); lanciatore dell'anteprima presente;
//   3. server d'ACCESSO solo sul loopback, con il nome «localhost» (porta dell'app + 1), SENZA alcun collegamento: GET /pronto mostra lo
//      stato e un pulsante per utente;
//   4. avvio dell'app come la Preview: scripts/avvia-anteprima-locale.mjs avvia <file> <porta> (ambiente pulito, guardia, next start solo
//      su «localhost»);
//   5. SOLO quando chi collauda, nel browser visibile e già verificato su /pronto, preme «Entra come …»: POST /accesso/<utente> con il
//      codice della pagina, l'origine e l'host giusti. Il server genera il collegamento di QUELL'utente (generate_link), lo verifica subito
//      LATO SERVER con la stessa libreria dell'app (@supabase/ssr, verifyOtp) e risponde 303 verso l'app impostando il cookie di sessione
//      per «localhost» (i cookie valgono per l'host su tutte le porte). Il token non compare mai in un indirizzo, quindi né nella
//      cronologia del browser né nei Referer, e mai a schermo, nei log o su disco (condizione 7 dell'utente del 18/11). Un solo tentativo
//      per utente (poi 410): un rifiuto del browser PRIMA del pulsante non consuma nulla;
//   5b. subito dopo l'accesso dell'impresa 2: verifica dell'ISOLAMENTO lato server con la sua sessione (verificaIsolamento: solo GET, solo
//      conteggi; le righe dell'impresa 1 devono risultare 0 per la RLS);
//   6. allo spegnimento dell'app si chiude anche il server d'accesso (anche in caso di errore o interruzione).
//
// Perché «localhost» e mai l'indirizzo numerico di loopback: con quello Next tratta come esterni i riscritti di zona del proxy e la console
// va in ciclo di reindirizzamenti (diagnosi delle 118 richieste del 18/11; lanciatore dell'anteprima corretto di conseguenza).
// Nessuna password, mai. Le prove di questo script sono solo a secco (verifica-radar-b3-interfaccia.ts), mai contro lo staging.
import { spawn } from "node:child_process";
import { randomBytes, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createServerClient } from "@supabase/ssr";

export const NOME_SCRIPT = "collaudo-accesso-b3.mjs";
export const STAGING_REF = "ryawdldqiumqsskrnyps";
export const STAGING_URL = `https://${STAGING_REF}.supabase.co`;
export const SOLO_LOCALE = "localhost";
export const COOKIE_SESSIONE = `sb-${STAGING_REF}-auth-token`;
const PRODUZIONE_REF = "bihfrzspqxsrzlbqqvqa";
const INDIRIZZI_LOOPBACK = new Set(["::1", "127.0.0.1"]);

// Gli unici utenti del collaudo (documento 20, §2): amministratore per la console, titolari di due imprese DIVERSE. Per l'impresa 2, subito
// dopo l'accesso, la verifica dell'isolamento lato server contro i dati dell'impresa 1 (verificaIsolamento, solo GET e solo conteggi).
export const UTENTI_COLLAUDO = [
  { email: "ti-admin@prova.test", zona: "console", arrivo: "/" },
  { email: "ti-titolare@prova.test", zona: "omnia-ai", arrivo: "/dashboard/omnia-ai/opportunita/cerca" },
  { email: "ti-titolare2@prova.test", zona: "omnia-ai", arrivo: "/dashboard/omnia-ai/opportunita/cerca", verificaIsolamentoDa: "ti-titolare@prova.test" },
];

// Tabelle con i dati di un'impresa (colonna user_id) che la sessione di un'ALTRA impresa non deve poter leggere (RLS).
export const TABELLE_ISOLAMENTO = [
  "omnia_ai_radar_salvate",
  "omnia_ai_radar_gare_aggiunte",
  "omnia_ai_radar_impostazioni",
  "omnia_ai_radar_utilizzi",
  "omnia_ai_notifiche",
  "gare",
  "subscriptions",
  "omnia_ai_gare_gratuite",
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

/** I problemi dell'ambiente (solo nomi, mai valori). Vuoto = solo staging. */
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
  if (!risposta.ok) throw new Fermo(`collegamento per ${email} non generato (risposta ${risposta.status})`);
  const d = await risposta.json();
  const hash = d?.hashed_token ?? d?.properties?.hashed_token;
  if (!hash) throw new Fermo(`collegamento per ${email} non generato (risposta senza token)`);
  return hash;
}

/**
 * Verifica il token LATO SERVER con la stessa libreria e la stessa versione dell'app (@supabase/ssr, verifyOtp come la conferma della
 * console) e restituisce i cookie di sessione che l'app leggerà: stesso nome, stessa codifica, stessa suddivisione in parti.
 */
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
  // Il token d'accesso resta solo in memoria: serve alla verifica dell'isolamento (sola lettura) e poi si dimentica.
  return { cookie, accessToken: data.session.access_token };
}

/**
 * Verifica dell'isolamento LATO SERVER (non solo l'HTML): con la sessione dell'utente appena entrato, SOLO GET, SOLO conteggi.
 * 1. il token è proprio di quell'utente (auth/v1/user);
 * 2. controllo positivo: la sua riga di omnia_ai_radar_impostazioni si legge (1), quindi il token funziona;
 * 3. per ogni tabella di TABELLE_ISOLAMENTO, filtrando sull'id dell'ALTRA impresa: righe viste con la sua sessione (attese 0) e, per
 *    confronto, righe esistenti (chiave di servizio, sempre e solo GET). Nessuna esistente: «non eseguita». Viste > 0: «VIOLAZIONE».
 * Stampa solo conteggi: mai token, id completi o contenuti.
 */
export async function verificaIsolamento({ variabili, accessToken, emailUtente, emailAltraImpresa, fetchFn = fetch }) {
  const soloGet = (url, headers) => fetchFn(url, { method: "GET", headers });
  const servizio = { apikey: variabili.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${variabili.SUPABASE_SERVICE_ROLE_KEY}` };
  const sessione = { apikey: variabili.NEXT_PUBLIC_SUPABASE_ANON_KEY, Authorization: `Bearer ${accessToken}` };
  const nome = nomeUtente(emailUtente);
  const conta = async (tabella, filtro, intestazioni) => {
    const r = await soloGet(`${STAGING_URL}/rest/v1/${tabella}?select=user_id&${filtro}&limit=1`, { ...intestazioni, Prefer: "count=exact" });
    if (!r.ok) return { errore: r.status };
    const n = Number((r.headers.get("content-range") ?? "").split("/")[1]);
    return Number.isFinite(n) ? { n } : { errore: "conteggio assente" };
  };
  const righe = [];
  const io = await soloGet(`${STAGING_URL}/auth/v1/user`, sessione);
  const datiIo = io.ok ? await io.json() : null;
  if (String(datiIo?.email ?? "").toLowerCase() !== emailUtente || !datiIo?.id) return { ok: false, righe: [`Isolamento di ${nome}: sessione non riconosciuta, verifica NON eseguita.`] };
  const altra = await soloGet(`${STAGING_URL}/rest/v1/users?select=id&email=eq.${encodeURIComponent(emailAltraImpresa)}`, servizio);
  const idAltra = altra.ok ? (await altra.json())?.[0]?.id : null;
  if (!idAltra) return { ok: false, righe: [`Isolamento di ${nome}: utente ${nomeUtente(emailAltraImpresa)} non trovato, verifica NON eseguita.`] };
  const propria = await conta("omnia_ai_radar_impostazioni", `user_id=eq.${datiIo.id}`, sessione);
  const positivo = propria.n === 1;
  righe.push(`Isolamento di ${nome}: controllo positivo (propria impostazione del Radar letta con la sua sessione) ${propria.n ?? `errore ${propria.errore}`} → ${positivo ? "ok" : "NON riuscito"}`);
  let violazioni = 0;
  for (const tabella of TABELLE_ISOLAMENTO) {
    const filtro = `user_id=eq.${idAltra}`;
    const esistono = await conta(tabella, filtro, servizio);
    const viste = await conta(tabella, filtro, sessione);
    let esito;
    if (viste.n > 0) {
      violazioni++;
      esito = "VIOLAZIONE";
    } else if (!(esistono.n > 0)) esito = "non eseguita (l'altra impresa non ha righe)";
    else esito = viste.n === 0 ? "ok" : `ok (accesso negato, ${viste.errore})`;
    righe.push(`Isolamento di ${nome} rispetto a ${nomeUtente(emailAltraImpresa)}, ${tabella}: viste ${viste.n ?? `errore ${viste.errore}`}, esistenti ${esistono.n ?? `errore ${esistono.errore}`} → ${esito}`);
  }
  righe.push(violazioni ? `Isolamento di ${nome}: ${violazioni} VIOLAZIONI — STOP.` : `Isolamento di ${nome}: nessuna violazione.`);
  return { ok: positivo && violazioni === 0, righe };
}

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

function paginaPronto({ portaApp, preliminare, codice, usati }) {
  const app = `http://${SOLO_LOCALE}:${portaApp}`;
  const righe = UTENTI_COLLAUDO.map((u) => {
    const p = percorsoAccesso(u.email);
    const usato = usati.has(p);
    return `<li><form method="post" action="${p}"><input type="hidden" name="via" value="${escapeHtml(codice)}"><button type="submit"${preliminare || usato ? " disabled" : ""}>Entra come ${escapeHtml(nomeUtente(u.email))} (${u.zona === "console" ? "console" : "OMNIA AI"})</button> <span>${usato ? "già usato" : preliminare ? "bloccato" : "da usare, una volta"}</span></form></li>`;
  }).join("");
  const stato = preliminare
    ? "MODALITÀ PRELIMINARE: nessun collegamento può essere generato e nessuna richiesta esce da questo computer."
    : "Finestra aperta. Nessun collegamento è stato generato: ognuno nasce solo quando premi il pulsante del suo utente.";
  return `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="same-origin"><title>Collaudo B3 · pronto</title><style>body{font:16px/1.5 system-ui,sans-serif;margin:0;padding:16px;background:#fff;color:#111}main{max-width:640px;margin:0 auto}h1{font-size:1.4rem}p.stato{padding:12px;border-radius:8px;background:${preliminare ? "#fff4d6" : "#e6f4ea"}}ul{list-style:none;padding:0}li{margin:12px 0}button{font:inherit;padding:10px 14px;border-radius:8px;border:1px solid #444;background:#f4f4f4;cursor:pointer;max-width:100%}button[disabled]{opacity:.55;cursor:not-allowed}span{color:#555;font-size:.9rem}</style></head><body><main><h1>Collaudo B3 — pronto</h1><p class="stato">${stato}</p><p>App: <a href="${app}/login?__zone=omnia-ai">${app}</a> (solo su questo computer). Questa pagina non contiene token e non ne genera da sola.</p><ul>${righe}</ul></main></body></html>`;
}

/**
 * Il server d'accesso (non ancora in ascolto). GET /pronto: la pagina senza token. POST /accesso/<utente> con codice della pagina, origine
 * e host di questo server: accedi(utente) → cookie di sessione → 303 verso l'app. Ogni altro metodo 405, ogni altro percorso 404, host
 * estranei 403. Nessun registro, nessuna cache, nessun referer.
 */
export function serverAccesso({ portaApp, preliminare = false, accedi, dopoAccesso = null }) {
  const codice = randomBytes(24).toString("base64url");
  const usati = new Set();
  const utenti = new Map(UTENTI_COLLAUDO.map((u) => [percorsoAccesso(u.email), u]));
  const base = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY" };
  const server = http.createServer(async (richiesta, risposta) => {
    const testo = (stato, messaggio, extra = {}) => {
      risposta.writeHead(stato, { ...base, "Content-Type": "text/plain; charset=utf-8", ...extra });
      risposta.end(messaggio);
    };
    const porta = server.address()?.port;
    const proprio = `http://${SOLO_LOCALE}:${porta}`;
    if (richiesta.headers.host !== `${SOLO_LOCALE}:${porta}`) return testo(403, `Host non ammesso: aprire questa pagina come ${proprio}`);
    const percorso = (richiesta.url ?? "").split("?")[0];
    if (percorso === "/pronto") {
      if (richiesta.method !== "GET") return testo(405, "Solo GET.", { Allow: "GET" });
      // Su /pronto «same-origin» e non «no-referrer»: con «no-referrer» il browser invia Origin: null nei POST dei pulsanti e il controllo
      // dell'origine li respingerebbe (trovato nel controllo preliminare del 18/11). L'indirizzo di /pronto non contiene nulla di riservato e
      // verso l'app (altra porta, quindi altra origine) non esce comunque alcun Referer.
      risposta.writeHead(200, {
        ...base,
        "Referrer-Policy": "same-origin",
        "Content-Type": "text/html; charset=utf-8",
        "Content-Security-Policy": `default-src 'none'; style-src 'unsafe-inline'; form-action 'self' http://${SOLO_LOCALE}:${portaApp}; frame-ancestors 'none'; base-uri 'none'`,
      });
      risposta.end(paginaPronto({ portaApp, preliminare, codice, usati }));
      return;
    }
    const utente = utenti.get(percorso);
    if (!utente) return testo(404, "Non trovato.");
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
    if (usati.has(percorso)) return testo(410, "Accesso già usato per questo utente: ne serve uno nuovo con una nuova autorizzazione.");
    usati.add(percorso);
    try {
      const { cookie, accessToken } = await accedi(utente);
      const nuovi = new Set(cookie.map((c) => c.name));
      const vecchi = nomiCookie(richiesta.headers.cookie).filter((n) => (n === COOKIE_SESSIONE || n.startsWith(`${COOKIE_SESSIONE}.`)) && !nuovi.has(n));
      risposta.writeHead(303, {
        ...base,
        Location: indirizzoArrivo(portaApp, utente),
        "Set-Cookie": [...cookie.map(intestazioneCookie), ...vecchi.map((n) => `${n}=; Path=/; Max-Age=0; SameSite=Lax`)],
      });
      risposta.end();
      console.log(`Accesso di ${nomeUtente(utente.email)}: sessione impostata nel browser (nessun collegamento in un indirizzo).`);
      if (dopoAccesso) await dopoAccesso(utente, accessToken).catch(() => console.log(`Verifica dopo l'accesso di ${nomeUtente(utente.email)} NON riuscita.`));
    } catch (e) {
      console.log(`Accesso di ${nomeUtente(utente.email)} NON riuscito: ${e instanceof Fermo ? e.message : "errore inatteso"}.`);
      testo(502, `Accesso non riuscito per ${nomeUtente(utente.email)}: nessun altro tentativo per questo utente senza una nuova autorizzazione.`);
    }
  });
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
  const server = serverAccesso({
    portaApp: porta,
    preliminare: true,
    accedi: async () => {
      throw new Fermo("modalità preliminare");
    },
  });
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

/** Il collaudo. Iniettabili per le prove a secco: controllaPorta, fetchFn, avvia (al posto del server dell'app), attendi, cartella, portaAccesso. */
export async function collaudo(argv, env, opzioni = {}) {
  if (argv[0] === "--preliminare") return preliminare(argv.slice(1), opzioni);
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

  // 3. server d'accesso SENZA collegamenti: ognuno nasce solo dal pulsante del suo utente (5.)
  const accedi = async (utente) => {
    const tokenHash = await generaCollegamento({ variabili, email: utente.email, fetchFn });
    return cookieDiSessione({ variabili, tokenHash, fetchFn });
  };
  // Dopo l'accesso dell'impresa 2: verifica dell'isolamento lato server (solo GET, solo conteggi), poi il token si dimentica.
  const dopoAccesso = async (utente, accessToken) => {
    if (!utente.verificaIsolamentoDa) return;
    const esito = await verificaIsolamento({ variabili, accessToken, emailUtente: utente.email, emailAltraImpresa: utente.verificaIsolamentoDa, fetchFn });
    for (const riga of esito.righe) console.log(riga);
  };
  const server = serverAccesso({ portaApp: porta, accedi, dopoAccesso });

  // 4. server dell'app; 6. alla fine si chiude tutto in ogni caso
  try {
    const indirizzo = await ascoltaSoloLocale(server, opzioni.portaAccesso ?? Number(porta) + 1);
    console.log(`Pagina del collaudo: http://${SOLO_LOCALE}:${indirizzo.port}/pronto — nessun collegamento generato: ognuno nasce solo dal pulsante del suo utente, dopo aver verificato il browser.`);
    const avvia =
      opzioni.avvia ??
      (() =>
        new Promise((risolvi) => {
          const figlio = spawn(process.execPath, [lanciatore, "avvia", fileVariabili, porta], { cwd: cartella, stdio: "inherit", env: process.env });
          for (const segnale of ["SIGINT", "SIGTERM"]) process.on(segnale, () => figlio.kill(segnale));
          figlio.on("exit", (codice) => risolvi(codice ?? 0));
        }));
    return await avvia({ portaAccesso: indirizzo.port });
  } finally {
    await chiudi(server);
    console.log("Pagina d'accesso chiusa.");
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  collaudo(process.argv.slice(2), process.env)
    .then((codice) => process.exit(codice))
    .catch((e) => {
      console.error(`COLLAUDO FERMATO: ${e instanceof Error ? e.message : e}`);
      process.exit(2);
    });
}
