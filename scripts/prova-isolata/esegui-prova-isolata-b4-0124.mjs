// PROVA DELLA SOLA MIGRAZIONE 0124 (richiesta 40, 20/11/2026) SU UN POSTGRES ISOLATO. Docker autorizzato dall'utente SOLO per prove su un
// PostgreSQL isolato: immagine postgres:17.11 già sul disco, contenitore temporaneo --rm con nome proprio, --network none, nessuna porta,
// nessun volume, password casuale mai salvata. Mai rmi, volume rm o prune; mai il Supabase locale; nessun database reale.
//
// Le migrazioni si leggono dal COMMIT DEDICATO (git show), cioè esattamente ciò che si applicherebbe allo staging: l'insieme del Radar fino
// alla 0122 (SENZA 0123 e 0125, che non esistono in quel commit), poi una fotografia degli oggetti, poi la 0124 DUE volte (idempotenza),
// poi i controlli di 50_prova_b4_0124.sql.
// Uso: node scripts/prova-isolata/esegui-prova-isolata-b4-0124.mjs postgres:17.11 [commit, di base il ramo migrazione/tender-intelligence-0124]
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const QUI = path.dirname(fileURLToPath(import.meta.url));
const RADICE = path.join(QUI, "..", "..");
const immagine = process.argv[2];
const commit = process.argv[3] ?? "migrazione/tender-intelligence-0124";
if (immagine !== "postgres:17.11") {
  console.error("Uso: node scripts/prova-isolata/esegui-prova-isolata-b4-0124.mjs postgres:17.11 [commit] (solo l'immagine già sul disco)");
  process.exit(2);
}
const git = (...a) => spawnSync("git", ["-c", "core.autocrlf=false", ...a], { cwd: RADICE, encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
const id = git("rev-parse", commit).stdout.trim();
if (!/^[0-9a-f]{40}$/.test(id)) {
  console.error(`Commit non trovato: ${commit}`);
  process.exit(2);
}
const elenco = git("ls-tree", "--name-only", id, "supabase/migrations/").stdout.split("\n").filter(Boolean);
for (const vietata of ["0123", "0125"]) {
  if (elenco.some((f) => path.basename(f).startsWith(`${vietata}_`))) {
    console.error(`FERMO: il commit ${id} contiene la ${vietata}: non è il commit dedicato della sola 0124`);
    process.exit(2);
  }
}
const dalCommit = (v) => {
  const f = elenco.find((n) => path.basename(n).startsWith(`${v}_`));
  if (!f) throw new Error(`migrazione ${v} assente dal commit ${id}`);
  const r = git("show", `${id}:${f}`);
  if (r.status !== 0) throw new Error(`lettura di ${f} non riuscita`);
  return { etichetta: `${v} (dal commit)`, testo: r.stdout };
};
const daFile = (etichetta, nome) => ({ etichetta, testo: fs.readFileSync(path.join(QUI, nome), "utf8") });
const passi = [
  daFile("prerequisiti minimi", "00_prerequisiti.sql"),
  ...["0109", "0110", "0111", "0112", "0113", "0114", "0115", "0116", "0117", "0120", "0121"].map(dalCommit),
  daFile("prerequisiti B4 (auth, Ufficio Gare)", "30_prerequisiti_b4.sql"),
  daFile("dati sintetici B4", "35_dati_b4.sql"),
  dalCommit("0122"),
  { etichetta: "fotografia degli oggetti prima della 0124", testo: "create table prova.oggetti_prima_0124 as select * from prova.oggetti_ora();" },
  dalCommit("0124"),
  { ...dalCommit("0124"), etichetta: "0124 di nuovo (idempotenza)" },
  daFile("controlli della 0124", "50_prova_b4_0124.sql"),
];
const nome = `omnia-prova-b4-0124-${randomBytes(4).toString("hex")}`;
const docker = (args, input) => spawnSync("docker", args, { encoding: "utf8", input, maxBuffer: 50 * 1024 * 1024 });
const avvio = docker(["run", "--rm", "-d", "--name", nome, "--network", "none", "-e", `POSTGRES_PASSWORD=${randomBytes(18).toString("hex")}`, immagine]);
if (avvio.status !== 0) {
  console.error(`Contenitore non avviato: ${avvio.stderr.trim()}`);
  process.exit(2);
}
console.log(`Commit provato: ${id} (${elenco.length} migrazioni nell'albero; nessuna 0123 né 0125)`);
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
  for (const { etichetta, testo } of passi) {
    const r = docker(["exec", "-i", nome, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-f", "-"], testo);
    const righe = `${r.stdout}\n${r.stderr}`.split("\n").map((x) => x.replace(/^psql:[^:]*:\d+:\s*/, "").replace(/^(NOTICE|AVVISO):\s*/, "")).filter((x) => /^(ok|FALLITO|piano)\s/.test(x) || /ERROR|ERRORE/.test(x));
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
console.log(codice === 0 ? `Prova isolata della 0124: TUTTO SUPERATO (${ok} controlli ok)` : `Prova isolata della 0124: FALLITA (${ok} controlli ok prima dell'errore)`);
process.exit(codice);
