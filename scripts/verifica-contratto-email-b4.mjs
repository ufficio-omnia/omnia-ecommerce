// Controllo di compatibilità tra la copia del contratto delle notifiche nei modelli di B1 (src/lib/radar/email-modelli/contratto.ts) e
// l'originale di B2 (src/lib/radar/notifiche/tipi.ts), letto in SOLA LETTURA con «git show <ramo>:<file>». Nessuna scrittura nel repository:
// i file di prova vanno in una cartella temporanea del sistema, cancellata alla fine.
// Controlla: (1) ogni tipo esportato è assegnabile nei due sensi; (2) le costanti sono uguali; (3) la firma ComponiEmailRadar coincide.
// Uso: node scripts/verifica-contratto-email-b4.mjs [ramo di B2, di base feature/tender-intelligence-b4-db]
// Dopo l'integrazione (quando tipi.ts è nel ramo corrente) si può passare HEAD.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RADICE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RAMO = process.argv[2] || "feature/tender-intelligence-b4-db";
const FILE_B2 = "src/lib/radar/notifiche/tipi.ts";
const FILE_B1 = "src/lib/radar/email-modelli/contratto.ts";

const TIPI = [
  "CategoriaNotifica",
  "TipoEvento",
  "ScadenzaNota",
  "FonteGara",
  "LottoConScadenza",
  "GaraEmail",
  "ModificaRilevata",
  "EvidenzaModifica",
  "EventoScadenza",
  "EventoModifica",
  "GaraRiepilogo",
  "EventoRiepilogo",
  "EventoRadar",
  "RuoloDestinatario",
  "DestinatarioEmail",
  "EmailComposta",
  "ComponiEmailRadar",
];
const COSTANTI = ["VERSIONE_CONTRATTO_NOTIFICHE", "CATEGORIE_NOTIFICA", "TIPI_EVENTO", "CATEGORIA_DEL_TIPO", "GIORNI_PROMEMORIA", "MASSIMO_GARE_RIEPILOGO"];

function git(...argomenti) {
  return spawnSync("git", ["-c", "core.autocrlf=false", ...argomenti], { cwd: RADICE, encoding: "utf8" });
}

const commit = git("rev-parse", "--short", RAMO);
const originale = git("show", `${RAMO}:${FILE_B2}`);
if (commit.status !== 0 || originale.status !== 0) {
  console.error(`FERMO: ${FILE_B2} non leggibile nel ramo «${RAMO}» (${(originale.stderr || commit.stderr).trim()})`);
  process.exit(2);
}
const impronta = createHash("sha256").update(originale.stdout).digest("hex");
console.log(`Contratto di B2: ${RAMO} @ ${commit.stdout.trim()}, ${FILE_B2}, sha256 ${impronta}`);

const cartella = fs.mkdtempSync(path.join(os.tmpdir(), "contratto-email-b4-"));
let esito = 0;
try {
  fs.writeFileSync(path.join(cartella, "b2.ts"), originale.stdout, "utf8");
  fs.copyFileSync(path.join(RADICE, FILE_B1), path.join(cartella, "b1.ts"));
  fs.writeFileSync(
    path.join(cartella, "tipi-controllo.ts"),
    [
      'import type * as B1 from "./b1";',
      'import type * as B2 from "./b2";',
      "type Reciproci<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;",
      ...TIPI.map((t) => `export const ${t}: Reciproci<B1.${t}, B2.${t}> = true;`),
      "",
    ].join("\n"),
    "utf8",
  );
  const tsc = spawnSync(
    process.execPath,
    [path.join(RADICE, "node_modules/typescript/bin/tsc"), "--noEmit", "--strict", "--skipLibCheck", "--target", "es2022", "--module", "esnext", "--moduleResolution", "bundler", path.join(cartella, "tipi-controllo.ts")],
    { cwd: cartella, encoding: "utf8" },
  );
  if (tsc.status === 0) {
    console.log(`ok     tipi identici nei due sensi: ${TIPI.length}/${TIPI.length}`);
  } else {
    esito = 1;
    const diversi = [...new Set([...tsc.stdout.matchAll(/tipi-controllo\.ts\(\d+,\d+\): error TS\d+: [^\n]*/g)].map((m) => m[0]))];
    console.log(`FALLITO tipi diversi o mancanti:\n${diversi.map((d) => `  ${d}`).join("\n") || tsc.stdout}`);
  }
  fs.writeFileSync(
    path.join(cartella, "costanti-controllo.ts"),
    [
      'import * as B1 from "./b1";',
      'import * as B2 from "./b2";',
      `const nomi = ${JSON.stringify(COSTANTI)};`,
      "let diverse = 0;",
      "for (const n of nomi) {",
      "  const a = JSON.stringify((B1 as Record<string, unknown>)[n]);",
      "  const b = JSON.stringify((B2 as Record<string, unknown>)[n]);",
      '  if (a !== b || a === undefined) { diverse++; console.log(`FALLITO costante ${n}: B1 ${a} ≠ B2 ${b}`); }',
      "}",
      'if (!diverse) console.log(`ok     costanti uguali: ${nomi.length}/${nomi.length}`);',
      "process.exit(diverse ? 1 : 0);",
      "",
    ].join("\n"),
    "utf8",
  );
  const costanti = spawnSync(process.execPath, [path.join(RADICE, "node_modules/tsx/dist/cli.mjs"), path.join(cartella, "costanti-controllo.ts")], { cwd: cartella, encoding: "utf8" });
  process.stdout.write(costanti.stdout);
  if (costanti.status !== 0) {
    esito = 1;
    if (costanti.stderr) console.log(costanti.stderr.split("\n").slice(0, 5).join("\n"));
  }
} finally {
  fs.rmSync(cartella, { recursive: true, force: true });
}
console.log(esito ? "\nIl contratto copiato nei modelli NON coincide con quello di B2." : "\nIl contratto copiato nei modelli coincide con quello di B2.");
process.exit(esito);
