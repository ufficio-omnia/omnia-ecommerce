// Motore comune delle prove di mutazione (fase B4, B1). Per ogni mutazione altera UN punto di un sorgente, lancia la verifica e pretende che
// FALLISCA (se `richiede` è indicato, che fallisca proprio un controllo con quel prefisso). Ogni file si ripristina SEMPRE dal buffer letto
// all'inizio (mai git checkout); prima di partire i file devono essere committati; alla fine si controlla che siano identici (sha256).
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

function impronta(testo) {
  return createHash("sha256").update(testo).digest("hex");
}

/** @param {{ radice: string; verifica: string; mutazioni: { nome: string; file: string; cerca: string; con: string; richiede?: string }[] }} d */
export function eseguiMutazioni({ radice, verifica, mutazioni }) {
  const tsx = path.join(radice, "node_modules/tsx/dist/cli.mjs");
  const coinvolti = [...new Set(mutazioni.map((m) => m.file))];
  const sporchi = spawnSync("git", ["-c", "core.autocrlf=false", "status", "--porcelain", "--", ...coinvolti, verifica], { cwd: radice, encoding: "utf8" });
  if (sporchi.status !== 0 || sporchi.stdout.trim()) {
    console.error("FERMO: i sorgenti o la verifica hanno modifiche non committate. Committare prima delle mutazioni.\n" + sporchi.stdout);
    return 2;
  }
  const originali = new Map(coinvolti.map((f) => [f, fs.readFileSync(path.join(radice, f), "utf8")]));
  const impronteIniziali = new Map([...originali].map(([f, t]) => [f, impronta(t)]));
  const base = spawnSync(process.execPath, [tsx, verifica], { cwd: radice, encoding: "utf8" });
  if (base.status !== 0) {
    console.error("FERMO: la verifica fallisce già senza mutazioni.\n" + base.stdout.split("\n").filter((r) => r.startsWith("FALLITO")).join("\n"));
    return 2;
  }
  let uccise = 0;
  const sopravvissute = [];
  for (const m of mutazioni) {
    const originale = originali.get(m.file);
    const volte = originale.split(m.cerca).length - 1;
    if (volte !== 1) {
      console.log(`NON APPLICABILE ${m.nome} — il punto da mutare compare ${volte} volte`);
      sopravvissute.push(m.nome);
      continue;
    }
    try {
      fs.writeFileSync(path.join(radice, m.file), originale.replace(m.cerca, m.con), "utf8");
      const esito = spawnSync(process.execPath, [tsx, verifica], { cwd: radice, encoding: "utf8" });
      const falliti = (esito.stdout ?? "").split("\n").filter((r) => r.startsWith("FALLITO"));
      if (esito.status !== 0 && m.richiede && !falliti.some((r) => r.startsWith(`FALLITO ${m.richiede}`))) {
        sopravvissute.push(m.nome);
        console.log(`SOPRAVVISSUTA ${m.nome} — la prova ${m.richiede} non la coglie`);
      } else if (esito.status !== 0) {
        uccise++;
        console.log(`uccisa   ${m.nome} — ${falliti.length} controlli falliti (es. ${(falliti[0] ?? esito.stderr.split("\n")[0] ?? "").replace(/^FALLITO /, "").slice(0, 90)})`);
      } else {
        sopravvissute.push(m.nome);
        console.log(`SOPRAVVISSUTA ${m.nome}`);
      }
    } finally {
      fs.writeFileSync(path.join(radice, m.file), originale, "utf8");
    }
  }
  for (const [f, h] of impronteIniziali) {
    const ora = impronta(fs.readFileSync(path.join(radice, f), "utf8"));
    if (ora !== h) {
      console.error(`ATTENZIONE: ${f} non è tornato identico (${ora} ≠ ${h})`);
      return 3;
    }
  }
  console.log(`\nMutazioni uccise: ${uccise}/${mutazioni.length}. Sorgenti ripristinati e identici (sha256 verificato).`);
  return sopravvissute.length ? 1 : 0;
}
