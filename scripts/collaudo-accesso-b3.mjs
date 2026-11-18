// Collaudo CON ACCESSO della fase B3 (interfaccia di Tender Intelligence) sullo STAGING. Scrive sullo staging (sessioni, presenza, utilizzi,
// salvataggi di prova): parte SOLO con un'autorizzazione registrata del coordinatore (tipo «scrittura_prova», 1 uso), lanciato da
// esegui-autorizzato.mjs dalla cartella dell'integrazione.
//
//   node scripts/collaudo-accesso-b3.mjs <file delle variabili> <porta>
//
// In ordine, e fermandosi al primo problema PRIMA di qualunque rete:
//   1. porta delle autorizzazioni: TI_REGISTRO e controllaPorta (registro del coordinatore);
//   2. guardia: file delle variabili FUORI dal repository; Supabase = SOLO lo staging (URL esatto, chiavi nel formato dello staging, nessun
//      identificativo di produzione né chiave «live» in nessuna variabile); lanciatore dell'anteprima presente;
//   3. collegamenti d'accesso generati LATO SERVER (generate_link, come il 17/11) per i SOLI utenti di prova dell'elenco, tenuti SOLO IN
//      MEMORIA: nessun file, nulla a schermo, nulla nei log (condizione 7 dell'utente del 18/11);
//   4. server di REINDIRIZZAMENTO solo su 127.0.0.1, porta dell'app + 1: /accesso/ti-admin, /accesso/ti-titolare, /accesso/ti-titolare2
//      rispondono UNA volta con un 302 al collegamento vero, poi 410; ogni altro percorso 404. Così chi apre il collegamento nel browser naviga
//      a http://127.0.0.1:<porta+1>/accesso/<utente> e il token non compare mai negli strumenti né nelle trascrizioni;
//   5. avvio del server come la Preview: scripts/avvia-anteprima-locale.mjs avvia <file> <porta> (ambiente pulito, guardia, next start solo su
//      127.0.0.1);
//   6. allo spegnimento dell'app si chiude anche il reindirizzamento e i collegamenti si dimenticano (anche in caso di errore o interruzione).
// Nessuna password, mai. Le prove di questo script sono solo a secco (verifica-radar-b3-interfaccia.ts), mai contro lo staging.
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const NOME_SCRIPT = "collaudo-accesso-b3.mjs";
export const STAGING_REF = "ryawdldqiumqsskrnyps";
export const STAGING_URL = `https://${STAGING_REF}.supabase.co`;
export const SOLO_LOCALE = "127.0.0.1";
const PRODUZIONE_REF = "bihfrzspqxsrzlbqqvqa";

// Gli unici utenti del collaudo (piano del resoconto 18, §11.1): amministratore per la console, titolari di due imprese DIVERSE.
export const UTENTI_COLLAUDO = [
  { email: "ti-admin@prova.test", zona: "console" },
  { email: "ti-titolare@prova.test", zona: "omnia-ai" },
  { email: "ti-titolare2@prova.test", zona: "omnia-ai" },
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

/** Il collegamento vero (solo in memoria): sempre http://127.0.0.1:<porta>, come il server dell'app. */
export function collegamento(porta, zona, tokenHash) {
  const t = encodeURIComponent(tokenHash);
  return zona === "console"
    ? `http://${SOLO_LOCALE}:${porta}/auth/conferma?token_hash=${t}&__zone=console`
    : `http://${SOLO_LOCALE}:${porta}/attiva-account?type=email&next=/dashboard/omnia-ai/opportunita/cerca&token_hash=${t}&__zone=omnia-ai`;
}

/** Il percorso di reindirizzamento di un utente: /accesso/<parte prima della chiocciola>. */
export function percorsoAccesso(email) {
  return `/accesso/${email.split("@")[0]}`;
}

/** Un collegamento d'accesso per ogni utente dell'elenco (solo @prova.test), lato server con la chiave di servizio dello staging. */
export async function generaCollegamenti({ variabili, porta, utenti = UTENTI_COLLAUDO, fetchFn = fetch }) {
  const out = [];
  for (const u of utenti) {
    if (!/@prova\.test$/.test(u.email)) throw new Fermo("solo utenti di prova @prova.test");
    const risposta = await fetchFn(`${STAGING_URL}/auth/v1/admin/generate_link`, {
      method: "POST",
      headers: { apikey: variabili.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${variabili.SUPABASE_SERVICE_ROLE_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ type: "magiclink", email: u.email }),
    });
    if (!risposta.ok) throw new Fermo(`collegamento per ${u.email} non generato (risposta ${risposta.status})`);
    const d = await risposta.json();
    const hash = d?.hashed_token ?? d?.properties?.hashed_token;
    if (!hash) throw new Fermo(`collegamento per ${u.email} non generato (risposta senza token)`);
    out.push({ email: u.email, zona: u.zona, percorso: percorsoAccesso(u.email), collegamento: collegamento(porta, u.zona, hash) });
  }
  return out;
}

/**
 * Il server di reindirizzamento (non ancora in ascolto). Ogni percorso dell'elenco risponde UNA volta con 302 al collegamento vero, poi
 * 410; gli altri percorsi 404; solo GET. Nessun registro, nessuna cache, nessun referer. I collegamenti restano solo in questa mappa e si
 * cancellano appena serviti.
 */
export function serverReindirizzamento(collegamenti) {
  const daServire = new Map(collegamenti.map((c) => [c.percorso, c.collegamento]));
  const noti = new Set(daServire.keys());
  const intestazioni = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" };
  const server = http.createServer((richiesta, risposta) => {
    const percorso = (richiesta.url ?? "").split("?")[0];
    if (richiesta.method !== "GET") {
      risposta.writeHead(405, intestazioni);
      risposta.end();
      return;
    }
    const destinazione = daServire.get(percorso);
    if (destinazione) {
      daServire.delete(percorso);
      risposta.writeHead(302, { ...intestazioni, Location: destinazione });
      risposta.end();
      return;
    }
    risposta.writeHead(noti.has(percorso) ? 410 : 404, { ...intestazioni, "Content-Type": "text/plain; charset=utf-8" });
    risposta.end(noti.has(percorso) ? "Collegamento già usato: generane uno nuovo con una nuova autorizzazione." : "Non trovato.");
  });
  server.dimentica = () => daServire.clear();
  return server;
}

/** In ascolto SOLO su 127.0.0.1. */
export function ascoltaSoloLocale(server, porta) {
  return new Promise((risolvi, rifiuta) => {
    server.once("error", rifiuta);
    server.listen(porta, SOLO_LOCALE, () => risolvi(server.address()));
  });
}

export function chiudi(server) {
  return new Promise((risolvi) => {
    server.dimentica?.();
    if (!server.listening) return risolvi();
    server.close(() => risolvi());
    server.closeAllConnections?.();
  });
}

/** Il collaudo. Iniettabili per le prove a secco: controllaPorta, fetchFn, avvia (al posto del server dell'app), cartella, portaRinvio. */
export async function collaudo(argv, env, opzioni = {}) {
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
  const portaRinvio = opzioni.portaRinvio ?? Number(porta) + 1;

  // 3. collegamenti (scrittura sullo staging: token monouso), SOLO in memoria
  const collegamenti = await generaCollegamenti({ variabili, porta, fetchFn: opzioni.fetchFn ?? fetch });

  // 4. reindirizzamento solo su 127.0.0.1; 5–6. server dell'app; alla fine si chiude tutto in ogni caso
  const rinvio = serverReindirizzamento(collegamenti);
  collegamenti.length = 0;
  try {
    const indirizzo = await ascoltaSoloLocale(rinvio, portaRinvio);
    console.log(`Accesso degli utenti di prova (una volta sola ciascuno): ${UTENTI_COLLAUDO.map((u) => `http://${SOLO_LOCALE}:${indirizzo.port}${percorsoAccesso(u.email)}`).join("  ")}`);
    const avvia =
      opzioni.avvia ??
      (() =>
        new Promise((risolvi) => {
          const figlio = spawn(process.execPath, [lanciatore, "avvia", fileVariabili, porta], { cwd: cartella, stdio: "inherit", env: process.env });
          for (const segnale of ["SIGINT", "SIGTERM"]) process.on(segnale, () => figlio.kill(segnale));
          figlio.on("exit", (codice) => risolvi(codice ?? 0));
        }));
    return await avvia({ portaRinvio: indirizzo.port });
  } finally {
    await chiudi(rinvio);
    console.log("Reindirizzamento chiuso, collegamenti dimenticati.");
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
