// Autotest dei TITOLI di omnia-ai.it (richiesta dell'utente, 11/11/2026):
//   1. il font dei titoli di pagina e di sezione (h1 e h2) sta in UNA regola sola (Montserrat ExtraBold, con Helvetica Neue / Arial di riserva),
//      nessun titolo scrive il suo font a mano; il carattere è ospitato da noi (mai da un CDN) con la sua licenza; il marchio e i titoletti (h3)
//      restano in Syne;
//   2. nessun titolo di pagina o di sezione finisce con il punto: né quelli scritti nelle pagine, né quelli scritti nei testi condivisi.
// I documenti legali (testi approvati) non si toccano: i loro titoli vengono dai file dei documenti. Nessuna rete. Gratuito: gira nel livello 1.
import fs from "fs";
import path from "path";
import { BANDA_PIANO_LAVORO, SITO_COME_FUNZIONA_PIANO_LAVORO, SITO_HOME_PIANO_LAVORO, TITOLO_CONDIZIONI_PIANO_LAVORO } from "../src/lib/piano-lavoro-testi";
import { SEZIONE_SERVIZI } from "../src/lib/servizi-categorie";
import { FOOD_MENU } from "../src/lib/gara-settore";
import { RISERVATEZZA_DOCUMENTI_TITOLO, RISERVATEZZA_TITOLO } from "../src/lib/omnia-ai-riservatezza";

const fallimenti: string[] = [];
function atteso(nome: string, ok: boolean, dettaglio = "") {
  console.log(`${ok ? "ok    " : "FALLITO"} ${nome}${ok ? "" : ` — ${dettaglio}`}`);
  if (!ok) fallimenti.push(nome);
}
const radice = path.join(__dirname, "..");
const leggi = (relativo: string) => fs.readFileSync(path.join(radice, relativo), "utf-8").replace(/\r\n/g, "\n");
const elenco = (cartella: string): string[] => {
  const risultato: string[] = [];
  const percorri = (dir: string) => {
    for (const voce of fs.readdirSync(path.join(radice, dir), { withFileTypes: true })) {
      const rel = `${dir}/${voce.name}`;
      if (voce.isDirectory()) percorri(rel);
      else if (rel.endsWith(".tsx")) risultato.push(rel);
    }
  };
  percorri(cartella);
  return risultato.sort();
};

console.log("--- Font dei titoli ---");
const css = leggi("src/app/site-omnia-ai/omnia-ai.css");
const senzaCommenti = css.replace(/\/\*[\s\S]*?\*\//g, "");
const regola = senzaCommenti.match(/(?:^|\n)h1,\s*h2\s*\{([^}]*)\}/);
atteso("c'è una regola sola «h1, h2» con il font dei titoli", !!regola);
const corpo = regola?.[1] ?? "";
atteso("la regola usa Montserrat, poi Helvetica Neue, Helvetica e Arial di riserva, senza grazie (sans-serif), in grassetto 800", /font-family:\s*"Montserrat",\s*"Helvetica Neue",\s*Helvetica,\s*Arial,\s*sans-serif;/.test(corpo) && /font-weight:\s*800;/.test(corpo), corpo.trim());
atteso("la regola bilancia le righe dei titoli (niente parola sola in fondo)", /text-wrap:\s*balance;/.test(corpo));
{
  // il carattere è ospitato da noi: due file (latin e latin-ext) dichiarati nel CSS con il percorso locale, che esistono davvero, più la licenza
  const facce = [...senzaCommenti.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => m[1]).filter((b) => /font-family:\s*"Montserrat"/.test(b));
  const sorgenti = facce.map((b) => b.match(/url\("([^"]+)"\)/)?.[1] ?? "");
  atteso("Montserrat 800 è dichiarato due volte nel CSS (latin e latin-ext) con unicode-range, dai file nostri in /fonts (mai da indirizzi esterni)", facce.length === 2 && facce.every((b) => /font-weight:\s*800;/.test(b) && /unicode-range:/.test(b)) && sorgenti.every((u) => /^\/fonts\/montserrat-800-latin(-ext)?\.woff2$/.test(u)), sorgenti.join(", "));
  atteso("i file del carattere esistono e hanno dimensioni plausibili, e c'è la licenza (SIL Open Font License) accanto", sorgenti.every((u) => { const f = path.join(radice, "public", u); return fs.existsSync(f) && fs.statSync(f).size > 10_000; }) && /SIL Open Font License/.test(fs.existsSync(path.join(radice, "public/fonts/montserrat-LICENSE-OFL.txt")) ? leggi("public/fonts/montserrat-LICENSE-OFL.txt") : ""));
  atteso("nessun carattere si carica da Google Fonts né da altri indirizzi esterni (privacy: stessa scelta già fatta per Syne e Space Grotesk)", !/fonts\.googleapis|fonts\.gstatic|@import\s+url\(["']?https?:/.test(css) && !/fonts\.googleapis|fonts\.gstatic/.test(leggi("src/app/site-omnia-ai/layout.tsx")));
}
atteso("il marchio e i titoletti (h3) restano in Syne, in grassetto", /(?:^|\n)h3,\s*\.font-marchio\s*\{[^}]*font-family:\s*"Syne",\s*sans-serif;[^}]*font-weight:\s*800;/.test(senzaCommenti));
atteso("nessun h1 o h2 ha un font scritto a mano nel suo selettore (solo la regola unica); l'eccezione è il testo delle risposte della chat", (() => {
  const blocchi = [...senzaCommenti.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
  const conFont = blocchi.filter(([, sel, dich]) => /\bh[12]\b/.test(sel) && /font-family|font-weight/.test(dich) && !/^\s*h1,\s*h2\s*$/.test(sel) && !/prose-chat/.test(sel));
  return conFont.length === 0;
})(), "un selettore con h1/h2 scrive il suo font");
atteso("il titolo di pagina dell'area riservata (.omnia-app-titolo) e la banda della revisione non scrivono il loro font", (() => {
  const blocco = (nome: string) => senzaCommenti.match(new RegExp(`${nome.replace(/\./g, "\\.")}\\s*\\{([^}]*)\\}`))?.[1] ?? "";
  return !/font-family|font-weight/.test(blocco(".omnia-app-titolo")) && !/font-family|font-weight/.test(blocco(".omnia-revisione h2"));
})());

console.log("\n--- Nessun punto alla fine dei titoli ---");
const cartelle = ["src/app/site-omnia-ai", "src/components/omnia-ai"];
const file = cartelle.flatMap(elenco).filter((f) => !f.includes("/legal/"));
const conPunto: string[] = [];
for (const f of file) {
  const testo = leggi(f);
  for (const m of testo.matchAll(/<h([12])([^>]*)>([\s\S]*?)<\/h\1>/g)) {
    const contenuto = m[3].replace(/\{\/\*[\s\S]*?\*\/\}/g, "").trim();
    // solo il testo scritto a mano: le espressioni ({...}) e i titoli che iniziano con un'espressione si controllano nei loro testi sotto
    if (/^[^<{]*$/.test(contenuto) && /\.\s*$/.test(contenuto)) conPunto.push(`${f}: «${contenuto.slice(-50)}»`);
  }
}
atteso(`nessun h1 o h2 scritto nelle pagine e nei componenti finisce con il punto (${file.length} file controllati)`, conPunto.length === 0, conPunto.join(" | "));

const testi: [string, string][] = [
  ["BANDA_PIANO_LAVORO.titolo", BANDA_PIANO_LAVORO.titolo],
  ["SITO_HOME_PIANO_LAVORO.titolo", SITO_HOME_PIANO_LAVORO.titolo],
  ["SITO_COME_FUNZIONA_PIANO_LAVORO.titolo", SITO_COME_FUNZIONA_PIANO_LAVORO.titolo],
  ["TITOLO_CONDIZIONI_PIANO_LAVORO", TITOLO_CONDIZIONI_PIANO_LAVORO],
  ["SEZIONE_SERVIZI.titolo", SEZIONE_SERVIZI.titolo],
  ["FOOD_MENU.titolo", FOOD_MENU.titolo],
  ["RISERVATEZZA_TITOLO", RISERVATEZZA_TITOLO],
  ["RISERVATEZZA_DOCUMENTI_TITOLO", RISERVATEZZA_DOCUMENTI_TITOLO],
];
atteso("i titoli scritti nei testi condivisi (piano di lavoro, categorie, OMNIA FOOD MENU, riservatezza) non finiscono con il punto", testi.every(([, t]) => !/[.]\s*$/.test(t)), testi.filter(([, t]) => /[.]\s*$/.test(t)).map(([n]) => n).join(", "));
atteso("il titolo di una frase intera resta una frase: i punti DENTRO il titolo non si toccano (es. «non indovina. Recupera…»)", /OMNIA AI non indovina\. Recupera, e cita la fonte<\/h1>/.test(leggi("src/app/site-omnia-ai/come-funziona/page.tsx")) && /Portaci una gara vera\. Ti mostriamo cosa esce<\/h2>/.test(leggi("src/app/site-omnia-ai/page.tsx")));

if (fallimenti.length > 0) {
  console.log(`\n${fallimenti.length} controlli falliti:\n- ${fallimenti.join("\n- ")}`);
  process.exit(1);
}
console.log("\nTutti i controlli sono andati a buon fine.");
