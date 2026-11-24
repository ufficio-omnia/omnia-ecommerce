// UN giro pianificato di una fonte sullo STAGING, lanciato dall'Utilità di pianificazione di Windows (decisione dell'utente del 23/11,
// documento 54A; documento 54). Uso: node scripts/pianificazione/lancia-giro-pianificato.mjs <ted|pvl|sintel|sardegnacat>
// Si lancia SOLO dalla cartella dedicata «pianificazione-staging» (una worktree ferma sul commit autorizzato), mai dal ramo di lavoro.
//   1) sceglie l'autorizzazione VALIDA della fonte nel registro (pianificazione-calcoli.mjs): nessuna = il giro non parte (scaduta,
//      esaurita, revocata: blocco automatico, nessun rinnovo da solo);
//   2) controlla commit (quello dichiarato nell'autorizzazione), albero pulito e impronta dello script della fonte; se no, si ferma;
//   3) ambiente SOLO dalla guardia dello staging, variabili vietate tolte, npx senza rete;
//   4) esegue esegui-autorizzato.mjs con l'autorizzazione e il comando ESATTO registrato: ricevuta, semaforo della fonte, comando, esito;
//   5) scrive UNA riga nel registro locale (solo numeri e motivi) e termina. Nessun nuovo tentativo: il giro dopo riparte dal cursore.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { COMANDI_PIANIFICATI, FONTI_PIANIFICATE, SCRIPT_DELLA_FONTE, SESSIONE_PIANIFICAZIONE, ambienteDelGiro, controlliCartella, eCartellaPianificazione, esitoDaUscita, rigaLog, scegliAutorizzazione } from "./pianificazione-calcoli.mjs";

const AUTORIZZAZIONI = "C:/Users/Dell/Desktop/OMNIA-PROGETTO1/TENDER_INTELLIGENCE_FASE0/autorizzazioni";
// guardia dello staging: copia durevole del coordinamento (24/11, documento 54, D3), identica all'originale (sha256 331eca7747ec77c2…)
const GUARDIA = "file:///C:/Users/Dell/Desktop/OMNIA-PROGETTO1/TENDER_INTELLIGENCE_FASE0/autorizzazioni/guardia-staging.mjs";
const CARTELLA_LOG = "C:/Users/Dell/Desktop/OMNIA-PROGETTO1/TENDER_INTELLIGENCE_FASE0/pianificazione/log";

const fonte = process.argv[2];
const inizio = new Date().toISOString();
const CARTELLA = path.resolve(path.dirname(decodeURIComponent(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"))), "..", "..");
fs.mkdirSync(CARTELLA_LOG, { recursive: true });
const scriviLog = (r) => fs.appendFileSync(path.join(CARTELLA_LOG, `${inizio.slice(0, 10)}.jsonl`), `${JSON.stringify(r)}\n`);
const fine = (codice, campi) => {
  scriviLog(rigaLog({ inizio, fine: new Date().toISOString(), fonte, codice, ...campi }));
  process.exit(codice);
};

if (!FONTI_PIANIFICATE.includes(fonte)) {
  console.error(`uso: node scripts/pianificazione/lancia-giro-pianificato.mjs <${FONTI_PIANIFICATE.join("|")}>`);
  process.exit(2);
}

// 0) solo dalla cartella dedicata, mai dal ramo di lavoro
if (!eCartellaPianificazione(CARTELLA)) fine(2, { motivo: "cartella_non_dedicata" });

// 1) l'autorizzazione della fonte
const registro = await import(new URL(`file:///${AUTORIZZAZIONI}/registro.mjs`).href);
let eventi;
try {
  eventi = registro.leggiRegistro();
} catch {
  fine(2, { motivo: "registro_illeggibile" });
}
const scelta = scegliAutorizzazione(eventi, { fonte, sessione: SESSIONE_PIANIFICAZIONE, cartella: CARTELLA, adesso: new Date() });
if (!scelta.aut) fine(0, { motivo: scelta.motivo });
const aut = scelta.aut;

// 2) commit, albero pulito, impronta dello script
const git = (args) => spawnSync("git", ["-c", "core.autocrlf=false", ...args], { cwd: CARTELLA, encoding: "utf8" });
const head = git(["rev-parse", "HEAD"]).stdout.trim();
const porcelain = git(["status", "--porcelain"]).stdout;
const impronta = crypto.createHash("sha256").update(fs.readFileSync(path.join(CARTELLA, SCRIPT_DELLA_FONTE[fonte]))).digest("hex");
const fermo = controlliCartella({ head, porcelain, impronta, aut });
if (fermo) fine(2, { aut: aut.id, motivo: fermo });

// 3) ambiente dello staging, solo dalla guardia
const { caricaStaging, oscura } = await import(GUARDIA);
const v = caricaStaging();
let env;
try {
  env = ambienteDelGiro(process.env, v);
} catch {
  fine(2, { aut: aut.id, motivo: "non_staging" });
}

// 4) il lanciatore registrato, con il comando ESATTO dell'autorizzazione
const r = spawnSync(process.execPath, [`${AUTORIZZAZIONI}/esegui-autorizzato.mjs`, aut.id, SESSIONE_PIANIFICAZIONE, "--", ...COMANDI_PIANIFICATI[fonte]], {
  cwd: CARTELLA, env, encoding: "utf8", maxBuffer: 50 * 1024 * 1024, timeout: 45 * 60_000, windowsHide: true,
});
const uscita = oscura(`${r.stdout ?? ""}`, v);
const uso = uscita.match(/\(ricevuta (USO-[0-9a-f]{12})\)/)?.[1] ?? null;

// 5) una riga di numeri e motivi
fine(r.status ?? 1, { aut: aut.id, uso, esito: esitoDaUscita(uscita), motivo: r.error ? "avvio_fallito" : uso ? null : "non_registrato" });
