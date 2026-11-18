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
//   3. collegamenti d'accesso generati LATO SERVER (generate_link, come il 17/11) per i SOLI utenti di prova dell'elenco, scritti in un file
//      locale FUORI dal repository; non si stampano mai (si stampa solo dove sta il file);
//   4. avvio del server come la Preview: scripts/avvia-anteprima-locale.mjs avvia <file> <porta> (ambiente pulito, guardia, next start);
//   5. allo spegnimento del server il file dei collegamenti si CANCELLA (anche in caso di errore o di interruzione).
// Nessuna password, mai. Le prove di questo script sono solo a secco (verifica-radar-b3-interfaccia.ts), mai contro lo staging.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const NOME_SCRIPT = "collaudo-accesso-b3.mjs";
export const STAGING_REF = "ryawdldqiumqsskrnyps";
export const STAGING_URL = `https://${STAGING_REF}.supabase.co`;
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

export function collegamento(porta, zona, tokenHash) {
  const t = encodeURIComponent(tokenHash);
  return zona === "console"
    ? `http://localhost:${porta}/auth/conferma?token_hash=${t}&__zone=console`
    : `http://localhost:${porta}/attiva-account?type=email&next=/dashboard/omnia-ai/opportunita/cerca&token_hash=${t}&__zone=omnia-ai`;
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
    out.push({ email: u.email, zona: u.zona, collegamento: collegamento(porta, u.zona, hash) });
  }
  return out;
}

/** Il collaudo. Iniettabili per le prove a secco: controllaPorta, fetchFn, avvia (al posto del server), cartella del progetto, file di uscita. */
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
  const fileCollegamenti = opzioni.fileCollegamenti ?? path.join(os.tmpdir(), "omnia-collaudo-b3", `collegamenti-${Date.now()}.json`);
  if (dentro(fileCollegamenti, cartella)) throw new Fermo("il file dei collegamenti deve stare FUORI dal repository");

  // 3. collegamenti (scrittura sullo staging: token monouso)
  const collegamenti = await generaCollegamenti({ variabili, porta, fetchFn: opzioni.fetchFn ?? fetch });
  fs.mkdirSync(path.dirname(fileCollegamenti), { recursive: true });
  fs.writeFileSync(fileCollegamenti, JSON.stringify(collegamenti, null, 2), { mode: 0o600 });
  console.log(`Collegamenti d'accesso per ${collegamenti.length} utenti di prova in ${fileCollegamenti} (non stampati; il file si cancella allo spegnimento).`);

  // 4–5. server come la Preview; alla fine il file si cancella in ogni caso
  try {
    const avvia =
      opzioni.avvia ??
      (() =>
        new Promise((risolvi) => {
          const figlio = spawn(process.execPath, [lanciatore, "avvia", fileVariabili, porta], { cwd: cartella, stdio: "inherit", env: process.env });
          for (const segnale of ["SIGINT", "SIGTERM"]) process.on(segnale, () => figlio.kill(segnale));
          figlio.on("exit", (codice) => risolvi(codice ?? 0));
        }));
    return await avvia();
  } finally {
    fs.rmSync(fileCollegamenti, { force: true });
    console.log("File dei collegamenti cancellato.");
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
