// Verifica: i collegamenti dei MENU delle aree riservate (area clienti di OMNIA AI e console) non si precaricano (prefetch={false}).
// Nata dalla misura del 18/11/2026: con il prefetch automatico di Next ogni voce visibile del menu veniva precaricata a ogni pagina e di
// nuovo dopo ogni azione del server, e ogni precaricamento passa dal proxy e disegna il layout (verifica della sessione, stato
// d'accesso): 30–60 chiamate a Supabase per vista. Solo lettura dei sorgenti: nessuna rete, nessun database.
import fs from "node:fs";
import path from "node:path";

const RADICE = path.resolve(__dirname, "..");
const fallimenti: string[] = [];
function atteso(nome: string, ok: boolean, dettaglio = "") {
  console.log(`${ok ? "ok    " : "FALLITO"} ${nome}${ok || !dettaglio ? "" : ` — ${dettaglio}`}`);
  if (!ok) fallimenti.push(nome);
}

// I menu e gli avvisi presenti in ogni pagina delle aree riservate, con il numero di collegamenti che contengono.
const MENU: [string, number][] = [
  ["src/components/omnia-ai/sidebar-nav.tsx", 3],
  ["src/components/omnia-ai/topbar.tsx", 1],
  ["src/components/omnia-ai/profilo-menu.tsx", 1],
  ["src/components/omnia-ai/opportunita/testata-opportunita.tsx", 2],
  ["src/app/site-omnia-ai/dashboard/omnia-ai/layout.tsx", 5],
  ["src/app/site-console/_componenti/barra-laterale-vista.tsx", 1],
];

/** I tag di apertura <Link …> di un sorgente, fino al «>» che chiude il tag (ignorando quelli dentro {…} e stringhe). */
export function tagLink(sorgente: string): string[] {
  const tag: string[] = [];
  let i = sorgente.indexOf("<Link");
  while (i >= 0) {
    if (/[\s>]/.test(sorgente[i + 5] ?? "")) {
      let graffe = 0;
      let virgolette: string | null = null;
      let j = i + 5;
      for (; j < sorgente.length; j++) {
        const c = sorgente[j];
        if (virgolette) {
          if (c === virgolette) virgolette = null;
          continue;
        }
        if (c === '"' || c === "'" || c === "`") virgolette = c;
        else if (c === "{") graffe++;
        else if (c === "}") graffe--;
        else if (c === ">" && graffe === 0) break;
      }
      tag.push(sorgente.slice(i, j + 1));
    }
    i = sorgente.indexOf("<Link", i + 5);
  }
  return tag;
}

// la funzione stessa, sui casi difficili (frecce e confronti dentro le graffe)
const prova = tagLink(`<Link href="/a" onClick={() => x > 1} prefetch={false}>A</Link><Linkx/><Link\n href={b}>B</Link>`);
atteso("0. lettura dei tag <Link>: si ferma al «>» del tag, non a quelli dentro le graffe", prova.length === 2 && prova[0].includes("prefetch={false}") && !prova[1].includes("prefetch"));

for (const [file, numero] of MENU) {
  const tag = tagLink(fs.readFileSync(path.join(RADICE, file), "utf8"));
  const senza = tag.filter((t) => !/\bprefetch=\{false\}/.test(t));
  atteso(`${file}: ${numero} collegamenti, tutti con prefetch={false}`, tag.length === numero && senza.length === 0, `trovati ${tag.length}, senza prefetch={false}: ${senza.map((t) => t.replace(/\s+/g, " ").slice(0, 80)).join(" | ")}`);
}

if (fallimenti.length) {
  console.error(`\n${fallimenti.length} controlli del prefetch dei menu riservati NON superati.`);
  process.exit(1);
}
console.log("\nTutti i controlli del prefetch dei menu riservati sono superati.");
