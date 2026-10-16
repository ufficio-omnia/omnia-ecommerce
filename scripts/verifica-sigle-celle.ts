// Autotest delle sigle di allineamento nelle celle di tabella ("[C]" centrato, "[G]" giustificato).
//
// Difetto reale (relazione dell'Istituto Romano San Michele): il modello ha scritto DUE sigle di fila in una cella
// ("[G][C]!!Addetto Antincendio!! coordinato da !!Coordinatore dei Servizi!!"); il generatore del Word ne toglieva
// una sola e l'altra restava stampata nel documento. Qui si controlla che:
//   - nessuna sigla resti nel documento, comunque sia scritta (due di fila, con spazi, nel grassetto, nel colore,
//     con un'icona in mezzo);
//   - il resto della cella NON cambi: una cella con due sigle deve produrre ESATTAMENTE lo stesso Word della stessa
//     cella con una sola (stessi grassetti, stessi colori, stesso allineamento, stesse icone);
//   - grassetto, colore, centratura e le sigle singole restino com'erano;
//   - le righe di testo fuori tabella (dove la sigla decide davvero l'allineamento) non siano state toccate.
// Gratuito, nessun database né rete: gira nel livello 1, quindi in prebuild.
import fs from "fs";
import path from "path";
import { buildDocxBuffer } from "../src/lib/docx-generator";
import { estraiTestiPerNodo } from "./lib/xml-word";
import { trovaMarcatoriResidui } from "./lib/controlli-relazione";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const JSZip = require("jszip");

const fallimenti: string[] = [];
function atteso(nome: string, ok: boolean, dettaglio = "") {
  console.log(`${ok ? "ok    " : "FALLITO"} ${nome}${ok ? "" : ` — ${dettaglio}`}`);
  if (!ok) fallimenti.push(nome);
}
const leggi = (relativo: string) => fs.readFileSync(path.join(__dirname, "..", relativo), "utf-8").replace(/\r\n/g, "\n");

async function documento(markdown: string): Promise<{ xml: string; nodi: string[] }> {
  const buffer = await buildDocxBuffer("Prova", markdown, { font: "Calibri", dimensioneCarattere: 12 }, undefined, undefined, {});
  const zip = await JSZip.loadAsync(buffer);
  const xml: string = (await zip.file("word/document.xml")?.async("string")) ?? "";
  return { xml, nodi: estraiTestiPerNodo(xml) };
}

// Una tabella di prova con la cella da provare nella seconda colonna; le altre celle sono sempre uguali.
const tabellaCon = (cella: string) => `# Prova\n\n| Tipologia | Profilo | Tempo |\n|---|---|---|\n| [C]**Incendio** | ${cella} | [C]**≤5 minuti** * |\n| [C]**Sanitaria** | [C]Altro profilo | [C]Immediata |\n`;

async function main() {
  console.log("--- Il caso reale: [G][C] con testo colorato ---");
  {
    const reale = await documento(tabellaCon("[G][C]!!Addetto Antincendio!! coordinato da !!Coordinatore dei Servizi!!"));
    atteso("nessuna sigla resta nel documento", trovaMarcatoriResidui(reale.nodi).length === 0, trovaMarcatoriResidui(reale.nodi).join(" / "));
    atteso("il testo della cella è completo e senza sigle", reale.nodi.join("").includes("Addetto Antincendio coordinato da Coordinatore dei Servizi"), JSON.stringify(reale.nodi.filter((n) => /Addetto|Coordinatore/.test(n))));
    const celle = reale.xml.split("<w:tc>").filter((c) => c.includes("Addetto Antincendio"));
    const cella = celle[0] ?? "";
    atteso("la cella resta centrata", /<w:jc w:val="center"\/>/.test(cella));
    atteso("i due nomi dei ruoli restano in grassetto e a colori", [...cella.matchAll(/<w:r>(?:(?!<\/w:r>)[\s\S])*?<w:b\/>(?:(?!<\/w:r>)[\s\S])*?<w:color w:val="[0-9A-F]{6}"\/>(?:(?!<\/w:r>)[\s\S])*?<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]).join("|") === "Addetto Antincendio|Coordinatore dei Servizi", cella.replace(/<[^>]+>/g, " ").replace(/\s+/g, " "));
    const singola = await documento(tabellaCon("[C]!!Addetto Antincendio!! coordinato da !!Coordinatore dei Servizi!!"));
    atteso("identico, in tutto il documento, alla stessa cella con UNA sola sigla", reale.xml === singola.xml);
  }

  console.log("--- Ogni variante equivale alla cella con una sola sigla ---");
  const varianti: [string, string, string][] = [
    ["[G][C] di fila", "[G][C]testo della cella", "[C]testo della cella"],
    ["[C][G] di fila", "[C][G]testo della cella", "[C]testo della cella"],
    ["[C] [G] con lo spazio in mezzo", "[C] [G] testo della cella", "[C]testo della cella"],
    ["tre sigle", "[G][C][G]testo della cella", "[C]testo della cella"],
    ["due sigle e testo in grassetto", "[G][C]**testo della cella**", "[C]**testo della cella**"],
    ["due sigle dentro il grassetto", "**[G][C]testo della cella**", "**[C]testo della cella**"],
    ["due sigle con testo colorato", "[G][C]!!testo colorato!! e altro", "[C]!!testo colorato!! e altro"],
    ["due sigle e icona dopo", "[G][C][ICONA:sicurezza] testo della cella", "[C][ICONA:sicurezza] testo della cella"],
    ["icona prima delle due sigle", "[ICONA:sicurezza][G][C]testo della cella", "[C][ICONA:sicurezza]testo della cella"],
    ["icona in mezzo alle due sigle", "[G][ICONA:sicurezza][C]testo della cella", "[C][ICONA:sicurezza]testo della cella"],
    ["sigla dentro il colore", "!![C]testo colorato!! e altro", "[C]!!testo colorato!! e altro"],
    ["sigla dentro il grassetto interno", "**[C]testo della cella**", "[C]**testo della cella**"],
    ["sigla a metà cella", "[C]testo [G]della cella", "[C]testo della cella"],
    ["due sigle e un marcatore di riga", "[RIGA:SICUREZZA][G][C]testo della cella", "[RIGA:SICUREZZA][C]testo della cella"],
  ];
  for (const [nome, doppia, singola] of varianti) {
    const a = await documento(tabellaCon(doppia));
    const b = await documento(tabellaCon(singola));
    atteso(`${nome}: nessuna sigla nel documento`, trovaMarcatoriResidui(a.nodi).length === 0, trovaMarcatoriResidui(a.nodi).join(" / "));
    atteso(`${nome}: Word identico a quello della cella con una sola sigla`, a.xml === b.xml);
  }

  console.log("--- Il resto non cambia ---");
  {
    const a = await documento(tabellaCon("[C]**Grassetto** e !!colore!! e *corsivo*"));
    const celle = a.xml.split("<w:tc>").filter((c) => c.includes("Grassetto"));
    const cella = celle[0] ?? "";
    atteso("una sigla singola con grassetto, colore e corsivo: centrata e con i tre stili", /<w:jc w:val="center"\/>/.test(cella) && /<w:b\/>[\s\S]*?Grassetto/.test(cella) && /<w:color w:val="[0-9A-F]{6}"\/>[\s\S]*?colore/.test(cella) && /<w:i\/>[\s\S]*?corsivo/.test(cella));
    atteso("una sigla singola non lascia nulla nel documento", trovaMarcatoriResidui(a.nodi).length === 0, trovaMarcatoriResidui(a.nodi).join(" / "));
    const senzaSigla = await documento(tabellaCon("Testo senza alcuna sigla"));
    atteso("una cella senza sigla resta com'è (il testo c'è, nessun marcatore)", senzaSigla.nodi.join("").includes("Testo senza alcuna sigla") && trovaMarcatoriResidui(senzaSigla.nodi).length === 0);
    const asterisco = await documento(tabellaCon("[G][C]**Entro 7 giorni lavorativi \\***"));
    atteso("il grassetto con asterisco finale (\\*) resta com'era anche con due sigle", asterisco.nodi.join("").includes("Entro 7 giorni lavorativi *") && trovaMarcatoriResidui(asterisco.nodi).length === 0, JSON.stringify(asterisco.nodi.filter((n) => /giorni/.test(n))));
  }

  console.log("--- Fuori dalle celle nulla è stato toccato ---");
  {
    const sorgente = leggi("src/lib/docx-generator.ts");
    const inizio = sorgente.indexOf("function estraiAllineamento(");
    const fine = sorgente.indexOf("// Una o più sigle di allineamento di fila");
    const fnRiga = sorgente.slice(inizio, fine === -1 ? inizio + 600 : Math.max(inizio, fine));
    atteso(
      "il testo fuori tabella usa ancora la sua regola (una sigla in testa decide centrato/giustificato)",
      /const match = riga\.match\(CELLA_ALLINEAMENTO_REGEX\);/.test(fnRiga) && /alignment: match\[2\] === "C" \? AlignmentType\.CENTER : AlignmentType\.JUSTIFIED/.test(fnRiga),
    );
    const prosa = await documento("# Prova\n\n[C]Paragrafo centrato\n\n[G]Paragrafo giustificato lungo che prosegue per qualche parola in più\n\nParagrafo senza sigla\n");
    const par = (testo: string) => prosa.xml.split("<w:p>").filter((p) => p.includes(testo))[0] ?? "";
    atteso("un paragrafo con [C] resta centrato e uno con [G] giustificato, senza sigle", /<w:jc w:val="center"\/>/.test(par("Paragrafo centrato")) && /<w:jc w:val="both"\/>/.test(par("Paragrafo giustificato")) && trovaMarcatoriResidui(prosa.nodi).length === 0);
    atteso(
      "la pulizia delle celle è usata solo per le celle (corpo tabella e peso delle colonne), mai per il testo fuori tabella o per l'intestazione",
      (sorgente.match(/pulisciSigleAllineamentoCella\(/g) ?? []).length === 3 &&
        sorgente.includes("function pulisciSigleAllineamentoCella(cellaGrezza: string): string {") &&
        sorgente.includes("const cella = pulisciSigleAllineamentoCella(celleGrezza);") &&
        sorgente.includes("return pulisciSigleAllineamentoCella(togliMarcatoriEvidenziazione(cella))"),
    );
  }

  if (fallimenti.length > 0) {
    console.log(`\n${fallimenti.length} controlli falliti:\n- ${fallimenti.join("\n- ")}`);
    process.exit(1);
  }
  console.log("\nTutti i controlli sono andati a buon fine.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
