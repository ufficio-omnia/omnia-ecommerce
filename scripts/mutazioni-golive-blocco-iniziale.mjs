// Mutazioni della prova del blocco iniziale per il go-live (verifica-golive-blocco-iniziale.ts): ogni mutazione toglie una delle difese e la
// prova DEVE fallire. Ogni file torna com'era dal contenuto letto prima (mai git checkout), anche se la prova si interrompe.
// Uso: node scripts/mutazioni-golive-blocco-iniziale.mjs
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RADICE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const f = (p) => path.join(RADICE, p);
const MUTAZIONI = [
  { nome: "M1 TED: il giro non guarda più se la fonte è accesa", file: "src/lib/radar/importa-ted.ts", cerca: 'if (!fonte || !fonte.attiva) return { eseguita: false, motivo: "fonte_spenta" };', con: 'if (!fonte) return { eseguita: false, motivo: "fonte_spenta" };' },
  { nome: "M2 PVL: il giro non guarda più se la fonte è accesa", file: "src/lib/radar/importa-pvl.ts", cerca: 'if (!fonte || !fonte.attiva) return { eseguita: false, motivo: "fonte_spenta" };', con: 'if (!fonte) return { eseguita: false, motivo: "fonte_spenta" };' },
  { nome: "M3 Sintel e SardegnaCAT: il giro non guarda più se la fonte è accesa", file: "src/lib/radar/importa-regionali.ts", cerca: 'if (!riga || !riga.attiva) return { eseguita: false, motivo: "fonte_spenta" };', con: 'if (!riga) return { eseguita: false, motivo: "fonte_spenta" };' },
  { nome: "M4 console: «giro mancato» anche per una fonte spenta", file: "src/lib/radar/stato-fonti-calcoli.ts", cerca: "if (s.attiva && cron && mie.length > 0) {", con: "if (cron && mie.length > 0) {" },
  { nome: "M5 registro: la fonte spenta registrata come giro riuscito", file: "src/lib/radar/esecuzioni-calcoli.ts", cerca: 'if (r.motivo === "fonte_spenta") return { modo, esito: "inerte" };', con: 'if (r.motivo === "fonte_spenta") return { modo, esito: "ok" };' },
  { nome: "M6 porta oraria tolta (ogni chiamata del cron diventa un giro)", file: "src/lib/radar/giro-programmato.ts", cerca: 'if (!eOraDiUnGiro(fonte, adesso)) return { passa: false, motivo: "fuori_orario" };', con: "" },
];

const tsx = path.join(RADICE, "node_modules", ".bin", process.platform === "win32" ? "tsx.cmd" : "tsx");
let uccise = 0;
for (const m of MUTAZIONI) {
  const file = f(m.file);
  const originale = fs.readFileSync(file, "utf8");
  const volte = originale.split(m.cerca).length - 1;
  if (volte !== 1) {
    console.log(`NON APPLICABILE ${m.nome}: testo trovato ${volte} volte`);
    process.exitCode = 1;
    continue;
  }
  try {
    fs.writeFileSync(file, originale.replace(m.cerca, m.con));
    const r = spawnSync(tsx, ["scripts/verifica-golive-blocco-iniziale.ts"], { cwd: RADICE, encoding: "utf8", shell: process.platform === "win32", timeout: 280_000, env: { ...process.env, VERCEL: "1", NODE_ENV: "production" } });
    const fallita = r.status !== 0;
    const motivi = (r.stdout ?? "").split("\n").filter((x) => x.startsWith("FALLITO")).map((x) => x.slice(8, 60));
    if (fallita) uccise++;
    console.log(`${fallita ? "uccisa  " : "SOPRAVVISSUTA"} ${m.nome}${motivi.length ? ` — ${motivi.join(" | ")}` : ""}`);
  } finally {
    fs.writeFileSync(file, originale);
  }
  if (fs.readFileSync(file, "utf8") !== originale) throw new Error(`${m.file} non ripristinato`);
}
console.log(`Mutazioni del blocco iniziale: ${uccise}/${MUTAZIONI.length} uccise`);
if (uccise !== MUTAZIONI.length) process.exitCode = 1;
