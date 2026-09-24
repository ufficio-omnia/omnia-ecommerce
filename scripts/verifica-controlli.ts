// Autotest del controllo sulle figure (scripts/lib/immagini-relazione.ts):
// un controllo che non è mai stato visto fallire non dimostra niente. Costruisce
// piccoli documenti con icone e organigramma, verifica che il caso
// legittimo passi (nessun falso allarme) e che ogni anomalia — figura in
// più, figura mancante, figura sconosciuta (una "fotografia"), icona
// diversa da quella del testo — faccia fallire il controllo. Gratuito,
// nessuna chiamata a modelli: gira insieme al livello 1 (npm run
// verifica:livello1, quindi in prebuild).
import { buildDocxBuffer } from "../src/lib/docx-generator";
import { abbinaSorgente, estraiFigureDocumento, estraiSorgenteFigure, verificaFigure } from "./lib/immagini-relazione";
import { trovaMarcatoriResidui } from "./lib/controlli-relazione";
import { estraiTestiPerNodo } from "./lib/xml-word";
import { confrontaSubCriteri, problemiContratto, type Sezione } from "./lib/confronto-tagli";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const JSZip = require("jszip");

const MARKDOWN = `# 1. Criterio di prova

## 1.1 Sotto-criterio con figure

[TABELLA:BLU]
| Attività | Frequenza |
|---|---|
| [C][ICONA:sicurezza] Verifica DPI | [C]Mensile |
| [C][ICONA:sicurezza] Verifica estintori | [C]Mensile |
| [C][ICONA:formazione] Corso base | [C]Annuale |

[TABELLA:VERDE]
| Ambito | Azione |
|---|---|
| [C][ICONA:sicurezza] Rifiuti | [G]Raccolta differenziata |
| [C][ICONA:inesistente] Nome inventato | [G]Non produce alcuna figura |

- [ICONA:ambiente] Elemento di elenco uno
- [ICONA:ambiente] Elemento di elenco due

[ORGANIGRAMMA]
Responsabile di Commessa {LIVELLO:Governo}
  Caposquadra {LIVELLO:Operativo}
[/ORGANIGRAMMA]
`;

type ZipProva = {
  file(nome: string): { async(tipo: "string"): Promise<string>; async(tipo: "nodebuffer"): Promise<Buffer> } | null;
  file(nome: string, contenuto: string): unknown;
};

async function caricaDocumentoDiProva(): Promise<ZipProva> {
  const buffer = await buildDocxBuffer("Prova", MARKDOWN, { font: "Calibri", dimensioneCarattere: 12 }, undefined, undefined, {});
  return (await JSZip.loadAsync(buffer)) as ZipProva;
}

async function valuta(zip: ZipProva): Promise<string[]> {
  const sorgente = estraiSorgenteFigure(MARKDOWN);
  const figure = await estraiFigureDocumento(zip);
  abbinaSorgente(figure, sorgente);
  return verificaFigure(figure, sorgente);
}

async function modifica(zip: ZipProva, trasforma: (xml: string) => string) {
  const xml = (await zip.file("word/document.xml")?.async("string")) ?? "";
  const nuovo = trasforma(xml);
  if (nuovo === xml) throw new Error("Autotest non valido: la mutazione non ha cambiato il documento.");
  zip.file("word/document.xml", nuovo);
}

async function main() {
  const fallimenti: string[] = [];
  const atteso = (nome: string, ok: boolean, dettaglio: string) => {
    console.log(`${ok ? "ok    " : "FALLITO"} ${nome}${ok ? "" : ` — ${dettaglio}`}`);
    if (!ok) fallimenti.push(nome);
  };

  // 0. Caso legittimo: icone di colore/tipo diversi (anche ripetute) più un
  // organigramma NON devono produrre errori.
  {
    const zip = await caricaDocumentoDiProva();
    const errori = await valuta(zip);
    atteso("documento con icone e organigramma: nessun errore", errori.length === 0, errori.join(" / "));
    const sorgente = estraiSorgenteFigure(MARKDOWN);
    atteso(
      "il nome di icona inventato non conta come icona attesa",
      sorgente.icone.length === 6 && sorgente.organigrammi.length === 1,
      `icone attese ${sorgente.icone.length} (6 previste), organigrammi ${sorgente.organigrammi.length}`,
    );
  }

  // 1. Icona mancante nel documento.
  {
    const zip = await caricaDocumentoDiProva();
    await modifica(zip, (xml) => xml.replace(/<w:drawing>(?:(?!<\/w:drawing>)[\s\S])*?name="icona:formazione"[\s\S]*?<\/w:drawing>/, ""));
    const errori = await valuta(zip);
    atteso("icona mancante: il controllo fallisce", errori.some((e) => /icona\/e nel documento contro/.test(e)), errori.join(" / ") || "nessun errore");
  }

  // 2. Figura sconosciuta (una "fotografia"): testo alternativo diverso.
  {
    const zip = await caricaDocumentoDiProva();
    await modifica(zip, (xml) => xml.replace(/name="icona:ambiente"/, 'name="fotografia"'));
    const errori = await valuta(zip);
    atteso("figura sconosciuta: il controllo fallisce", errori.some((e) => /non riconducibile/.test(e)), errori.join(" / ") || "nessun errore");
  }

  // 3. Organigramma in più.
  {
    const zip = await caricaDocumentoDiProva();
    await modifica(zip, (xml) => {
      const blocco = xml.match(/<w:p>(?:(?!<\/w:p>)[\s\S])*?name="organigramma"[\s\S]*?<\/w:p>/)?.[0];
      if (!blocco) throw new Error("Autotest non valido: organigramma non trovato.");
      return xml.replace(blocco, blocco + blocco);
    });
    const errori = await valuta(zip);
    atteso("organigramma in più: il controllo fallisce", errori.some((e) => /organigramma\/i nel documento contro/.test(e)), errori.join(" / ") || "nessun errore");
  }

  // 4. Icona diversa da quella del testo (stesso numero di figure).
  {
    const zip = await caricaDocumentoDiProva();
    await modifica(zip, (xml) => xml.replace(/name="icona:formazione"/, 'name="icona:ambiente"'));
    const errori = await valuta(zip);
    atteso("icona diversa dal testo: il controllo fallisce", errori.some((e) => /disallineamento/.test(e)), errori.join(" / ") || "nessun errore");
  }

  // 5. Marcatori residui: il backslash può stare in un nodo e l'asterisco nel
  // successivo; due asterischi singoli in nodi diversi NON sono "**".
  {
    const bs = trovaMarcatoriResidui(["Entro 7 giorni lavorativi \\", "*"]);
    atteso("backslash residuo (asterisco nel nodo dopo): rilevato", bs.some((e) => /backslash/.test(e)), bs.join(" / ") || "nessun errore");
    const adiacenti = trovaMarcatoriResidui(["Entro 3 giorni ", " *", "*Valori derivati dal monte ore"]);
    atteso("due asterischi singoli in nodi diversi: nessun falso allarme", adiacenti.length === 0, adiacenti.join(" / "));
    const grassetto = trovaMarcatoriResidui(["testo **non convertito** qui"]);
    atteso("grassetto non convertito nello stesso nodo: rilevato", grassetto.some((e) => /grassetto markdown/.test(e)), grassetto.join(" / ") || "nessun errore");
  }

  // 6. Il renderer converte "\*" in un asterisco letterale senza backslash, e
  // l'estrazione dei nodi di testo non include markup XML.
  {
    const md = "# Prova\n\n[TABELLA:BLU]\n| Fase | Tempo |\n|---|---|\n| [C]**4. Evasione** | [C]**Entro 7 giorni lavorativi \\*** |\n\nNota con asterisco escapato \\* in prosa.\n";
    const buffer = await buildDocxBuffer("Prova", md, { font: "Calibri", dimensioneCarattere: 12 }, undefined, undefined, {});
    const zip = (await JSZip.loadAsync(buffer)) as ZipProva;
    const xml = (await zip.file("word/document.xml")?.async("string")) ?? "";
    const nodi = estraiTestiPerNodo(xml);
    const residui = trovaMarcatoriResidui(nodi);
    atteso("asterisco con escape (\\*): nessun backslash nel documento", residui.length === 0, residui.join(" / "));
    atteso("asterisco con escape (\\*): l'asterisco resta visibile", nodi.join("").includes("giorni lavorativi *") && nodi.join("").includes("escapato * in prosa"), JSON.stringify(nodi.filter((n) => /giorni|escapato/.test(n))));
    atteso("l'estrazione dei nodi di testo non contiene markup XML", nodi.every((n) => !n.includes("<w:")), nodi.find((n) => n.includes("<w:"))?.slice(0, 80) ?? "");
  }

  // 7. Confronto prima/dopo dei tagli (scripts/lib/confronto-tagli.ts).
  {
    const fmt = { dimensioneCarattere: 12 };
    const lungo = Array.from({ length: 120 }, (_, i) => `parola${i}`).join(" ");
    const pre: Sezione[] = [
      {
        titolo_sezione: "1. Criterio di prova",
        contenuto: [
          "## 1.1 Alfa",
          "",
          "Ai sensi dell'**art. 14 del Capitolato** e del D.M. 29 gennaio 2021 si opera come segue.",
          "",
          "[TABELLA:BLU]",
          "| Macchina | Capacità |",
          "|---|---|",
          "| [G]Lavasciuga compatta | [C]**1.500 mq/h ***|",
          "| [G]Aspirapolvere con filtro | [C]40 litri * |",
          "| [G]Report di sintesi periodico | [C]Mensile |",
          "",
          "Ogni intervento è chiuso entro 24 ore, come da art. 14, comma 3.",
          "",
          "## 1.2 Beta",
          "",
          lungo,
        ].join("\n"),
      },
    ];
    const valuta = (post: string, fase2: string = lungo) =>
      problemiContratto(confrontaSubCriteri(pre, [{ titolo_sezione: "1. Criterio di prova", contenuto: `${post}\n\n## 1.2 Beta\n\n${fase2}` }], fmt, []));

    const invariato = valuta(pre[0].contenuto.split("## 1.2 Beta")[0].trimEnd());
    atteso("confronto: testo invariato, nessun errore", invariato.errori.length === 0, invariato.errori.join(" / "));

    // Riscrittura equivalente: escape "\*", data numerica, riga rinominata,
    // "art. 14" ancora citato (solo con comma), nessuna perdita reale.
    const equivalente = valuta(
      [
        "## 1.1 Alfa",
        "",
        "Come da D.M. 29/01/2021 si opera come segue.",
        "",
        "[TABELLA:BLU]",
        "| Macchina | Capacità |",
        "|---|---|",
        "| [G]Lavasciuga compatta | [C]**1.500 mq/h \\*** |",
        "| [G]Aspirapolvere con filtro | [C]40 litri \\* |",
        "| [G]Report di sintesi periodico (KPI di servizio) | [C]Mensile |",
        "",
        "Ogni intervento è chiuso entro 24 ore, come da art. 14, comma 3.",
      ].join("\n"),
    );
    atteso("confronto: riscrittura equivalente (escape, data, riga rinominata) senza falsi allarmi", equivalente.errori.length === 0 && !equivalente.avvisi.some((a) => /riga\/righe di tabella/.test(a)), [...equivalente.errori, ...equivalente.avvisi].join(" / "));

    const senzaAsterisco = valuta(
      [
        "## 1.1 Alfa",
        "",
        "Come da art. 14 del Capitolato e D.M. 29/01/2021.",
        "",
        "[TABELLA:BLU]",
        "| Macchina | Capacità |",
        "|---|---|",
        "| [G]Lavasciuga compatta | [C]**1.500 mq/h** |",
        "| [G]Aspirapolvere con filtro | [C]40 litri |",
        "| [G]Report di sintesi periodico | [C]Mensile |",
        "",
        "Ogni intervento è chiuso entro 24 ore, come da art. 14, comma 3.",
      ].join("\n"),
    );
    atteso("confronto: asterisco di conferma tolto da un valore ancora presente: errore", senzaAsterisco.errori.some((e) => /SENZA asterisco/.test(e)), senzaAsterisco.errori.join(" / ") || "nessun errore");

    const senzaArticolo = valuta(
      [
        "## 1.1 Alfa",
        "",
        "Si opera come segue, come da D.M. 29/01/2021.",
        "",
        "[TABELLA:BLU]",
        "| Macchina | Capacità |",
        "|---|---|",
        "| [G]Lavasciuga compatta | [C]**1.500 mq/h ***|",
        "| [G]Aspirapolvere con filtro | [C]40 litri * |",
        "| [G]Report di sintesi periodico | [C]Mensile |",
        "",
        "Ogni intervento è chiuso entro 24 ore.",
      ].join("\n"),
    );
    atteso("confronto: citazione di articolo del capitolato tolta: errore", senzaArticolo.errori.some((e) => /riferimenti al capitolato/.test(e)), senzaArticolo.errori.join(" / ") || "nessun errore");

    const svuotato = valuta(pre[0].contenuto.split("## 1.2 Beta")[0].trimEnd(), "parola0 parola1 parola2 parola3 parola4 parola5 parola6 parola7 parola8 parola9");
    atteso("confronto: sotto-criterio svuotato (<40% delle parole): errore", svuotato.errori.some((e) => /svuotato/.test(e)), svuotato.errori.join(" / ") || "nessun errore");

    const sottoCriterioMancante = problemiContratto(
      confrontaSubCriteri(pre, [{ titolo_sezione: "1. Criterio di prova", contenuto: pre[0].contenuto.split("## 1.2 Beta")[0].trimEnd() }], fmt, []),
    );
    atteso("confronto: sotto-criterio sparito del tutto: errore", sottoCriterioMancante.errori.some((e) => /assente dopo/.test(e)), sottoCriterioMancante.errori.join(" / ") || "nessun errore");

    const rigaTolta = valuta(
      [
        "## 1.1 Alfa",
        "",
        "Ai sensi dell'**art. 14 del Capitolato** e del D.M. 29/01/2021.",
        "",
        "[TABELLA:BLU]",
        "| Macchina | Capacità |",
        "|---|---|",
        "| [G]Lavasciuga compatta | [C]**1.500 mq/h ***|",
        "| [G]Aspirapolvere con filtro | [C]40 litri * |",
        "",
        "Ogni intervento è chiuso entro 24 ore, come da art. 14, comma 3.",
      ].join("\n"),
    );
    atteso("confronto: riga di tabella tolta: avviso (non errore)", rigaTolta.errori.length === 0 && rigaTolta.avvisi.some((a) => /riga\/righe di tabella/.test(a)), [...rigaTolta.errori, ...rigaTolta.avvisi].join(" / "));
  }

  if (fallimenti.length > 0) {
    console.error(`\nAutotest dei controlli FALLITO: ${fallimenti.length} caso/i.`);
    process.exit(1);
  }
  console.log("Autotest dei controlli: tutti i casi ok.");
}

main().catch((err) => {
  console.error("Errore inatteso nell'autotest del controllo figure:", err);
  process.exit(1);
});
