// Motore comune delle prove di mutazione (fase B4, B1). Per ogni mutazione altera UN punto di un sorgente, lancia la verifica e pretende che
// FALLISCA (se `richiede` è indicato, che fallisca proprio un controllo con quel prefisso). Ogni file si ripristina SEMPRE dal buffer letto
// all'inizio (mai git checkout); prima di partire i file devono essere committati; alla fine si controlla che siano identici (sha256).
// Ogni verifica gira in UN solo processo (node --import tsx: nessun processo figlio che sopravviva) con un TEMPO MASSIMO: una mutazione che
// tiene ferma la verifica oltre il tempo massimo è «BLOCCATA» e conta come NON uccisa (richiesta del coordinamento del 19/11, dopo la
// mutazione MC8 del collaudo B4 rimasta ferma 85 minuti). Con Ctrl+C il file mutato si ripristina prima di uscire.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const TEMPO_MASSIMO_PREDEFINITO_MS = 120_000;

function impronta(testo) {
  return createHash("sha256").update(testo).digest("hex");
}

/** @param {{ radice: string; verifica: string; mutazioni: { nome: string; file: string; cerca: string; con: string; richiede?: string }[]; tempoMassimoMs?: number }} d */
export function eseguiMutazioni({ radice, verifica, mutazioni, tempoMassimoMs = TEMPO_MASSIMO_PREDEFINITO_MS }) {
  const lancia = () => spawnSync(process.execPath, ["--import", "tsx", verifica], { cwd: radice, encoding: "utf8", timeout: tempoMassimoMs, killSignal: "SIGKILL" });
  const bloccata = (esito) => esito.error?.code === "ETIMEDOUT" || esito.signal !== null;
  const coinvolti = [...new Set(mutazioni.map((m) => m.file))];
  const sporchi = spawnSync("git", ["-c", "core.autocrlf=false", "status", "--porcelain", "--", ...coinvolti, verifica], { cwd: radice, encoding: "utf8" });
  if (sporchi.status !== 0 || sporchi.stdout.trim()) {
    console.error("FERMO: i sorgenti o la verifica hanno modifiche non committate. Committare prima delle mutazioni.\n" + sporchi.stdout);
    return 2;
  }
  const originali = new Map(coinvolti.map((f) => [f, fs.readFileSync(path.join(radice, f), "utf8")]));
  const impronteIniziali = new Map([...originali].map(([f, t]) => [f, impronta(t)]));
  const base = lancia();
  if (bloccata(base)) {
    console.error(`FERMO: la verifica senza mutazioni non si chiude entro ${tempoMassimoMs / 1000} s.`);
    return 2;
  }
  if (base.status !== 0) {
    console.error("FERMO: la verifica fallisce già senza mutazioni.\n" + base.stdout.split("\n").filter((r) => r.startsWith("FALLITO")).join("\n"));
    return 2;
  }
  let uccise = 0;
  const sopravvissute = [];
  // Ctrl+C o arresto durante una mutazione: si ripristina il file prima di uscire.
  let inCorso = null;
  const ripristinaEdEsci = () => {
    if (inCorso) fs.writeFileSync(path.join(radice, inCorso.file), originali.get(inCorso.file), "utf8");
    process.exit(130);
  };
  for (const segnale of ["SIGINT", "SIGTERM"]) process.once(segnale, ripristinaEdEsci);
  for (const m of mutazioni) {
    const originale = originali.get(m.file);
    const volte = originale.split(m.cerca).length - 1;
    if (volte !== 1) {
      console.log(`NON APPLICABILE ${m.nome} — il punto da mutare compare ${volte} volte`);
      sopravvissute.push(m.nome);
      continue;
    }
    try {
      inCorso = m;
      fs.writeFileSync(path.join(radice, m.file), originale.replace(m.cerca, m.con), "utf8");
      const esito = lancia();
      const falliti = (esito.stdout ?? "").split("\n").filter((r) => r.startsWith("FALLITO"));
      if (bloccata(esito)) {
        sopravvissute.push(m.nome);
        console.log(`BLOCCATA ${m.nome} — la verifica non si chiude entro ${tempoMassimoMs / 1000} s: NON conta come uccisa`);
      } else if (esito.status !== 0 && m.richiede && !falliti.some((r) => r.startsWith(`FALLITO ${m.richiede}`))) {
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
      inCorso = null;
    }
  }
  for (const segnale of ["SIGINT", "SIGTERM"]) process.removeListener(segnale, ripristinaEdEsci);
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
