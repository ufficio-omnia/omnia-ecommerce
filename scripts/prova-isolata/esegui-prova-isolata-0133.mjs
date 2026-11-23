// PROVA DELLA 0133 (stato «da_verificare», regole S4 del 23/11) SU UN POSTGRES ISOLATO. Docker autorizzato dall'utente il 19/11/2026 SOLO per
// prove su un PostgreSQL isolato: immagine postgres:17.11 già sul disco, contenitore temporaneo --rm con nome proprio
// («omnia-prova-0133-<casuale>»), --network none, nessuna porta, nessun volume, password casuale mai salvata. Mai rmi, volume rm o prune;
// mai il Supabase locale; nessun database reale, nessuna variabile d'ambiente del progetto letta o passata.
//
// Passi, fermandosi al primo errore: prerequisiti (00), migrazioni del radar 0109–0117, 0120, 0121, dati sintetici e fotografia (97), la 0133,
// la 0133 DI NUOVO (idempotenza), controlli (98). Poi il contenitore si ferma e sparisce.
// Uso: node scripts/prova-isolata/esegui-prova-isolata-0133.mjs postgres:17.11
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const QUI = path.dirname(fileURLToPath(import.meta.url));
const MIGRAZIONI = path.join(QUI, "..", "..", "supabase", "migrations");
const immagine = process.argv[2];
if (immagine !== "postgres:17.11") {
  console.error("Uso: node scripts/prova-isolata/esegui-prova-isolata-0133.mjs postgres:17.11 (solo l'immagine già sul disco)");
  process.exit(2);
}
const migrazione = (v) => {
  const f = fs.readdirSync(MIGRAZIONI).find((n) => n.startsWith(`${v}_`));
  if (!f) throw new Error(`migrazione ${v} non trovata`);
  return path.join(MIGRAZIONI, f);
};
const passi = [
  ["prerequisiti minimi", path.join(QUI, "00_prerequisiti.sql")],
  ...["0109", "0110", "0111", "0112", "0113", "0114", "0115", "0116", "0117", "0120", "0121"].map((v) => [`migrazione ${v}`, migrazione(v)]),
  ["dati sintetici e fotografia prima della 0133", path.join(QUI, "97_dati_0133.sql")],
  ["migrazione 0133", migrazione("0133")],
  ["migrazione 0133 di nuovo (idempotenza)", migrazione("0133")],
  ["controlli dopo la 0133", path.join(QUI, "98_prova_0133.sql")],
];
const nome = `omnia-prova-0133-${randomBytes(4).toString("hex")}`;
const docker = (args, input) => spawnSync("docker", args, { encoding: "utf8", input, maxBuffer: 50 * 1024 * 1024 });
const avvio = docker(["run", "--rm", "-d", "--name", nome, "--network", "none", "-e", `POSTGRES_PASSWORD=${randomBytes(18).toString("hex")}`, immagine]);
if (avvio.status !== 0) {
  console.error(`Contenitore non avviato: ${avvio.stderr.trim()}`);
  process.exit(2);
}
let codice = 0;
let ok = 0;
try {
  let pronto = false;
  for (let i = 0; i < 60 && !pronto; i++) {
    pronto = docker(["exec", nome, "pg_isready", "-U", "postgres", "-q"]).status === 0 && docker(["exec", nome, "psql", "-U", "postgres", "-tAc", "select 1"]).stdout.trim() === "1";
    if (!pronto) spawnSync(process.execPath, ["-e", "setTimeout(() => {}, 1000)"]);
  }
  if (!pronto) throw new Error("Postgres non è pronto");
  console.log(`Contenitore ${nome}: ${docker(["exec", nome, "psql", "-U", "postgres", "-tAc", "select version()"]).stdout.trim().slice(0, 60)}`);
  for (const [etichetta, file] of passi) {
    const r = docker(["exec", "-i", nome, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-f", "-"], fs.readFileSync(file, "utf8"));
    const righe = `${r.stdout}\n${r.stderr}`.split("\n").map((x) => x.replace(/^psql:[^:]*:\d+:\s*/, "").replace(/^(NOTICE|AVVISO):\s*/, "")).filter((x) => /^(ok|FALLITO)\s/.test(x) || /ERROR|ERRORE/.test(x));
    for (const x of righe) {
      console.log(`  ${x}`);
      if (/^ok\s/.test(x)) ok++;
    }
    if (r.status !== 0) {
      console.log(`FALLITO ${etichetta}: psql ha chiuso con codice ${r.status}`);
      codice = 1;
      break;
    }
    console.log(`passo superato: ${etichetta}`);
  }
} catch (e) {
  console.log(`FALLITO: ${e instanceof Error ? e.message : String(e)}`);
  codice = 1;
} finally {
  docker(["stop", nome]);
}
console.log(codice === 0 ? `Prova isolata 0133: TUTTO SUPERATO (${ok} controlli ok)` : `Prova isolata 0133: FALLITA (${ok} controlli ok prima dell'errore)`);
process.exit(codice);
