// Mutazioni della deduplicazione TED (ted-stessa-procedura.ts e importa.ts): ogni mutazione toglie un pezzo della regola e almeno una delle
// prove (verifica-radar-ted-stessa-procedura.ts, verifica-radar-0121.ts) DEVE fallire. Ogni file torna com'era dal contenuto letto prima
// (mai git checkout), anche se la prova si interrompe.
// Uso: node scripts/mutazioni-ted-stessa-procedura.mjs
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RADICE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const R = "src/lib/radar/fonti/ted-stessa-procedura.ts";
const I = "src/lib/radar/importa.ts";
const MUTAZIONI = [
  { nome: "M1 riferimenti interni diversi non separano più", file: R, cerca: "if (ra && rb && ra !== rb) return false;", con: "" },
  { nome: "M2 titolo compatibile con UNA sola parola in comune", file: R, cerca: "if ([...corto].every((w) => lungo.has(w))) return \"compatibili\";", con: "if ([...corto].some((w) => lungo.has(w))) return \"compatibili\";" },
  { nome: "M3 ente sempre uguale", file: R, cerca: "if (a.cf.length > 0 && b.cf.length > 0) return a.cf.some((c) => b.cf.includes(c));", con: "return true;" },
  { nome: "M4 il CPV non sostituisce più l'ente (centrali di committenza)", file: R, cerca: "if (titoli === \"compatibili\") return ente === true || stessoCpv;", con: "if (titoli === \"compatibili\") return ente === true;" },
  { nome: "M5 titoli non confrontabili = stessa gara", file: R, cerca: "if (titoli === \"non_confrontabili\") return ente === true && stessoCpv;", con: "if (titoli === \"non_confrontabili\") return true;" },
  { nome: "M6 riferimenti segnaposto («1», «Generica») considerati significativi", file: R, cerca: "if (r.length < 3 || /^\\d{1,3}$/.test(r) || RIFERIMENTI_VUOTI.test(r)) return null;", con: "if (r.length < 1) return null;" },
  { nome: "M7 nessuna priorità alla gara che porta la chiave del BT-04", file: R, cerca: "Number(b.propria) - Number(a.propria) || ", con: "" },
  { nome: "M8 bandi: si torna alla prima gara del BT-04 (regola vecchia)", file: I, cerca: "let d = garaCompatibile(v.identita, famiglia, opzioniUnione);", con: "let d = famiglia[0]?.gara ?? null;" },
  { nome: "M9 esiti: si torna alla prima gara del BT-04 (regola vecchia)", file: I, cerca: "const g = garaCompatibile(e.identita, famiglie.get(e.meta.procedureId) ?? [], { modificaDichiarata: !!e.meta.motivoModifica });", con: "const g = (famiglie.get(e.meta.procedureId) ?? [])[0]?.gara ?? null;" },
  { nome: "M10 l'identità dei bandi non si salva più", file: I, cerca: "          foto: fotoIdentita(v.identita),\n", con: "" },
  { nome: "M11 una gara nuova prende sempre la chiave «ted:<BT-04>»", file: I, cerca: "const chiave = famiglia.length === 0 && !chiaviNuove.has(base) ? base : chiaveSeparata(v.meta.procedureId, v.meta.numero);", con: "const chiave = base;" },
  { nome: "M12 nessuna identità di ripiego per le gare scritte prima della regola", file: I, cerca: "const tutte = [...(identita.get(g.id) ?? []), identitaDaRiga(g)];", con: "const tutte = [...(identita.get(g.id) ?? [])];" },
];
const PROVE = ["scripts/verifica-radar-ted-stessa-procedura.ts", "scripts/verifica-radar-0121.ts"];

const tsx = path.join(RADICE, "node_modules", ".bin", process.platform === "win32" ? "tsx.cmd" : "tsx");
let uccise = 0;
for (const m of MUTAZIONI) {
  const file = path.join(RADICE, m.file);
  const originale = fs.readFileSync(file, "utf8");
  const volte = originale.split(m.cerca).length - 1;
  if (volte !== 1) {
    console.log(`NON APPLICABILE ${m.nome}: testo trovato ${volte} volte`);
    process.exitCode = 1;
    continue;
  }
  const fallite = [];
  try {
    fs.writeFileSync(file, originale.replace(m.cerca, m.con));
    for (const prova of PROVE) {
      const r = spawnSync(tsx, [prova], { cwd: RADICE, encoding: "utf8", shell: process.platform === "win32", timeout: 280_000, env: { ...process.env, VERCEL: "1", NODE_ENV: "production" } });
      if (r.status !== 0) fallite.push(`${path.basename(prova)}: ${(r.stdout ?? "").split("\n").filter((x) => x.startsWith("FALLITO")).length} falliti`);
    }
  } finally {
    fs.writeFileSync(file, originale);
  }
  if (fs.readFileSync(file, "utf8") !== originale) throw new Error(`${m.file} non ripristinato`);
  if (fallite.length) uccise++;
  console.log(`${fallite.length ? "uccisa  " : "SOPRAVVISSUTA"} ${m.nome}${fallite.length ? ` — ${fallite.join("; ")}` : ""}`);
}
console.log(`Mutazioni della deduplicazione TED: ${uccise}/${MUTAZIONI.length} uccise`);
if (uccise !== MUTAZIONI.length) process.exitCode = 1;
