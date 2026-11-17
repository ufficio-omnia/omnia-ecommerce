// PROVA DELLA 0121 SU UN POSTGRES ISOLATO (decisione dell'utente del 17/11/2026: funzione delle fonti «testata realmente su un database di
// prova isolato» prima dello staging). DA ESEGUIRE SOLO DOPO L'APPROVAZIONE DELL'UTENTE (avvio di Docker Desktop e, se manca, download
// dell'immagine ufficiale di Postgres).
//
// Che cosa fa, senza toccare nient'altro:
//   - un contenitore usa e getta («docker run --rm»), SENZA porte pubblicate (si parla solo con «docker exec»), senza volumi, con una
//     password casuale mai salvata; nessuna variabile d'ambiente del progetto viene letta o passata;
//   - applica i prerequisiti minimi (00), le migrazioni del radar 0109–0117 e 0120 del ramo, i dati sintetici scritti con la 0120 (10), la
//     0121 DUE volte (idempotenza) e le prove (20), fermandosi al primo errore;
//   - stampa le righe «ok» e «FALLITO» e ferma il contenitore (che sparisce con i suoi dati).
//
// Uso: node scripts/prova-isolata/esegui-prova-isolata.mjs <immagine, per esempio postgres:17> (la stessa versione principale dello staging)
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const QUI = path.dirname(fileURLToPath(import.meta.url));
const MIGRAZIONI = path.join(QUI, "..", "..", "supabase", "migrations");
const immagine = process.argv[2];
if (!immagine || !/^postgres:\d{2}(\.\d+)?(-alpine)?$/.test(immagine)) {
  console.error("Uso: node scripts/prova-isolata/esegui-prova-isolata.mjs postgres:<versione principale dello staging>");
  process.exit(2);
}
const nome = `omnia-prova-0121-${randomBytes(4).toString("hex")}`;
const docker = (args, input) => spawnSync("docker", args, { encoding: "utf8", input, maxBuffer: 50 * 1024 * 1024 });

const passi = [
  ["prerequisiti minimi", path.join(QUI, "00_prerequisiti.sql")],
  ...["0109", "0110", "0111", "0112", "0113", "0114", "0115", "0116", "0117", "0120"].map((v) => [`migrazione ${v}`, path.join(MIGRAZIONI, fs.readdirSync(MIGRAZIONI).find((f) => f.startsWith(`${v}_`)))]),
  ["dati sintetici scritti con la 0120", path.join(QUI, "10_dati_prima_della_0121.sql")],
  ["migrazione 0121", path.join(MIGRAZIONI, "0121_radar_classificazioni.sql")],
  ["migrazione 0121 di nuovo (idempotenza)", path.join(MIGRAZIONI, "0121_radar_classificazioni.sql")],
  ["prove della 0121", path.join(QUI, "20_prova_0121.sql")],
];

let codice = 0;
const avvio = docker(["run", "--rm", "-d", "--name", nome, "--network", "none", "-e", `POSTGRES_PASSWORD=${randomBytes(18).toString("hex")}`, immagine]);
if (avvio.status !== 0) {
  console.error(`Contenitore non avviato: ${avvio.stderr.trim()}`);
  process.exit(2);
}
try {
  // pronto quando accetta connessioni (al massimo 60 s)
  let pronto = false;
  for (let i = 0; i < 60 && !pronto; i++) {
    pronto = docker(["exec", nome, "pg_isready", "-U", "postgres", "-q"]).status === 0 && docker(["exec", nome, "psql", "-U", "postgres", "-tAc", "select 1"]).stdout.trim() === "1";
    if (!pronto) spawnSync(process.execPath, ["-e", "setTimeout(() => {}, 1000)"]);
  }
  if (!pronto) throw new Error("Postgres non è pronto");
  console.log(`Postgres isolato pronto: ${docker(["exec", nome, "psql", "-U", "postgres", "-tAc", "select version()"]).stdout.trim()}`);
  for (const [etichetta, file] of passi) {
    const r = docker(["exec", "-i", nome, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-f", "-"], fs.readFileSync(file, "utf8"));
    const righe = `${r.stdout}\n${r.stderr}`.split("\n").map((x) => x.replace(/^psql:[^:]*:\d+:\s*/, "").replace(/^(NOTICE|AVVISO):\s*/, "")).filter((x) => /^(ok|FALLITO)\s/.test(x) || /ERROR|ERRORE/.test(x));
    for (const x of righe) console.log(`  ${x}`);
    if (r.status !== 0) {
      console.log(`FALLITO ${etichetta}: psql ha chiuso con codice ${r.status}`);
      codice = 1;
      break;
    }
    console.log(`ok     ${etichetta}`);
  }
} catch (e) {
  console.error(`FALLITO: ${e instanceof Error ? e.message : e}`);
  codice = 1;
} finally {
  docker(["stop", nome]);
  console.log(`Contenitore ${nome} fermato e cancellato (--rm).`);
}
console.log(codice === 0 ? "Prova isolata della 0121: tutto a posto." : "Prova isolata della 0121: ci sono errori.");
process.exit(codice);
