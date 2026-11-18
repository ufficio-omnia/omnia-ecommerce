// SOLO SUL RAMO anteprima/tender-intelligence-b3. Prova in LOCALE della Vercel Preview: stessa build e stesso
// ambiente che avrà su Vercel (NODE_ENV=production, VERCEL=1, VERCEL_ENV=preview, ramo d'anteprima), con le variabili
// lette da un file che sta FUORI da questa cartella (lo stesso da importare su Vercel).
//
//   node scripts/avvia-anteprima-locale.mjs build <file variabili>          → npm run build (guardia, batteria, build, controllo del compilato)
//   node scripts/avvia-anteprima-locale.mjs avvia <file variabili> [porta]  → guardia, poi `next start` (porta 3110 se non indicata)
//
// Se la guardia non passa (scripts/guardia-anteprima.ts) non parte nulla e il comando esce con errore.
// Stampa solo i nomi delle variabili, mai i valori.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RAMO = "anteprima/tender-intelligence-b3";
const cartella = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [modo, fileVariabili, porta = "3110"] = process.argv.slice(2);

function ferma(motivo) {
  console.error(`GUARDIA DELL'ANTEPRIMA: avvio BLOCCATO — ${motivo}`);
  process.exit(1);
}

if (modo !== "build" && modo !== "avvia") ferma("primo argomento: «build» oppure «avvia»");
if (!fileVariabili || !fs.existsSync(fileVariabili)) ferma("file delle variabili mancante");
const assoluto = path.resolve(fileVariabili);
if (assoluto.toLowerCase().startsWith(cartella.toLowerCase() + path.sep)) ferma("il file delle variabili deve stare FUORI dalla cartella del progetto");
if (!/^\d{4,5}$/.test(porta)) ferma("porta non valida");

const variabili = {};
for (const riga of fs.readFileSync(assoluto, "utf8").split(/\r?\n/)) {
  const m = riga.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
  if (!m) continue;
  let v = m[2].trim();
  if (v.length >= 2 && ((v[0] === '"' && v.endsWith('"')) || (v[0] === "'" && v.endsWith("'")))) v = v.slice(1, -1);
  variabili[m[1]] = v;
}

// Ambiente PULITO, come su Vercel: niente di quello che c'è nel terminale (dove potrebbero esserci variabili di
// produzione esportate a mano o di altri programmi), solo le variabili di sistema indispensabili per avviare Node su
// Windows e su Unix, più quelle del file. NODE_OPTIONS e OSSERVA_RETE_FILE passano solo se impostati (osservazione
// della rete durante le prove locali); anche loro restano soggetti alla guardia.
const SISTEMA = new Set([
  "PATH", "PATHEXT", "SYSTEMROOT", "WINDIR", "COMSPEC", "TEMP", "TMP", "TMPDIR", "HOME", "USERPROFILE", "APPDATA",
  "LOCALAPPDATA", "HOMEDRIVE", "HOMEPATH", "PROGRAMDATA", "PROGRAMFILES", "PROGRAMFILES(X86)", "COMMONPROGRAMFILES",
  "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE", "OS", "LANG", "NODE_OPTIONS", "OSSERVA_RETE_FILE",
]);
const base = Object.fromEntries(Object.entries(process.env).filter(([k]) => SISTEMA.has(k.toUpperCase())));
// NEXT_PUBLIC_VERCEL_ENV: Vercel la imposta da sola nelle anteprime; qui si simula, perché spegne i tag Google nel browser.
const env = { ...base, ...variabili, NODE_ENV: "production", VERCEL: "1", VERCEL_ENV: "preview", NEXT_PUBLIC_VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: RAMO };
const node = process.execPath;
const tsx = path.join(cartella, "node_modules", "tsx", "dist", "cli.mjs");

const guardia = spawnSync(node, [tsx, path.join(cartella, "scripts", "guardia-anteprima.ts")], { cwd: cartella, env, stdio: "inherit" });
if (guardia.status !== 0) ferma("ambiente non autorizzato (vedi l'elenco qui sopra)");

if (modo === "build") {
  const npm = path.join(path.dirname(node), "node_modules", "npm", "bin", "npm-cli.js");
  const esito = spawnSync(node, [npm, "run", "build"], { cwd: cartella, env, stdio: "inherit" });
  process.exit(esito.status ?? 1);
}

if (!fs.existsSync(path.join(cartella, ".next", "BUILD_ID"))) ferma("build mancante: eseguire prima «build» con lo stesso file");
// Solo sull'interfaccia di loopback (condizione 7 dell'utente, 18/11): il server non è raggiungibile dalla rete locale né da fuori.
// Con il NOME «localhost», mai con l'indirizzo 127.0.0.1 o ::1: Next confronta l'origine di partenza (http://<-H>:<porta>) con quella dei
// riscritti di zona del proxy, che normalizza sempre in «localhost». Con 127.0.0.1 le origini differiscono, il riscritto diventa una
// richiesta HTTP esterna, il proxy gira due volte e la console va in ciclo di reindirizzamenti (le 118 richieste del 18/11).
console.log(`Anteprima locale (come la Preview, solo staging) su http://localhost:${porta}, solo su questo computer — zone: ?__zone=omnia-ai, ?__zone=console`);
const server = spawn(node, [path.join(cartella, "node_modules", "next", "dist", "bin", "next"), "start", "-H", "localhost", "-p", porta], { cwd: cartella, env, stdio: "inherit" });
server.on("exit", (codice) => process.exit(codice ?? 0));
for (const segnale of ["SIGINT", "SIGTERM"]) process.on(segnale, () => server.kill(segnale));
