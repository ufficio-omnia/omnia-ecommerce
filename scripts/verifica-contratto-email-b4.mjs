// Controllo del contratto delle notifiche nel ramo di B1. Il file src/lib/radar/notifiche/tipi.ts è di B2: entra nel ramo SOLO con un merge
// dal ramo di B2 e qui non si modifica mai. Questo strumento, in SOLA LETTURA (git show, git diff), controlla che:
//   1. la copia di lavoro del file sia identica a quella committata (nessuna modifica locale);
//   2. il file del ramo sia identico, byte per byte, all'impronta verificata dal coordinamento;
//   3. il file del ramo sia identico a quello in cima al ramo di B2 (altrimenti B2 ha pubblicato una versione nuova: si rifà il merge).
// Uso: node scripts/verifica-contratto-email-b4.mjs [ramo di B2, di base feature/tender-intelligence-b4-db]
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RADICE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RAMO_B2 = process.argv[2] || "feature/tender-intelligence-b4-db";
const FILE = "src/lib/radar/notifiche/tipi.ts";
// impronta del contratto, VERSIONE 2, di B2 (punta 4b03fb9), verificata dal coordinamento il 19/11/2026 (la v1 era 4b36014c…)
const IMPRONTA_VERIFICATA = "2c3feca6289492494afd12cd12aea1ca86a2ba1815270b1fea90edcb6947bded";

function git(...argomenti) {
  return spawnSync("git", ["-c", "core.autocrlf=false", ...argomenti], { cwd: RADICE, encoding: "utf8" });
}
function sha(testo) {
  return createHash("sha256").update(testo).digest("hex");
}

const fallimenti = [];
function atteso(nome, ok, dettaglio = "") {
  console.log(`${ok ? "ok    " : "FALLITO"} ${nome}${ok || !dettaglio ? "" : ` — ${dettaglio}`}`);
  if (!ok) fallimenti.push(nome);
}

const nelRamo = git("show", `HEAD:${FILE}`);
atteso(`${FILE} presente nel ramo`, nelRamo.status === 0, nelRamo.stderr.trim());
if (nelRamo.status === 0) {
  const locale = fs.readFileSync(path.join(RADICE, FILE), "utf8");
  atteso("nessuna modifica locale al file di B2", locale === nelRamo.stdout && git("diff", "--quiet", "HEAD", "--", FILE).status === 0);
  const impronta = sha(nelRamo.stdout);
  atteso(`impronta verificata dal coordinamento (${IMPRONTA_VERIFICATA.slice(0, 12)}…)`, impronta === IMPRONTA_VERIFICATA, impronta);
  const diB2 = git("show", `${RAMO_B2}:${FILE}`);
  if (diB2.status !== 0) {
    console.log(`(ramo di B2 «${RAMO_B2}» non leggibile in questo clone: controllo 3 saltato)`);
  } else {
    const cima = git("rev-parse", "--short", RAMO_B2).stdout.trim();
    atteso(`identico al file in cima al ramo di B2 (${RAMO_B2} @ ${cima})`, sha(diB2.stdout) === impronta, `B2 ha ${sha(diB2.stdout)}: versione nuova, chiedere al coordinamento e rifare il merge`);
  }
  const sorgenti = git("log", "--format=%H %s", "HEAD", "--", FILE).stdout.trim().split("\n").filter(Boolean);
  const nonDiB2 = sorgenti.filter((r) => !/^\S+ Tender Intelligence B4: contratto/.test(r));
  atteso("nel ramo il file è cambiato solo dai commit di B2 sul contratto", nonDiB2.length === 0, nonDiB2.join(" | "));
}

console.log(fallimenti.length ? `\n${fallimenti.length} controlli FALLITI sul contratto di B2.` : "\nIl contratto di B2 nel ramo è quello verificato e non è stato toccato.");
process.exit(fallimenti.length ? 1 : 0);
