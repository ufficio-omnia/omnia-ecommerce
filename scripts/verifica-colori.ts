// Autotest dei colori semantici (gratuito, nessuna chiamata a modelli): gira
// insieme al livello 1 (npm run verifica:livello1, quindi in prebuild).
//
// Un controllo che non è mai stato visto fallire non dimostra niente: oltre
// ai casi legittimi (nessun falso allarme), ogni regola viene violata a mano
// nell'XML del documento e il controllo deve accorgersene — colore fuori
// palette, rosso fuori dal segnaposto, evidenziazione in una tabella di soli
// dati, terza riga evidenziata, colonna intera, fondo non sostituito su una
// riga evidenziata, intestazione fuori palette, legenda mancante o di troppo.
import { buildDocxBuffer } from "../src/lib/docx-generator";
import {
  COLORE_PIENO,
  RENDERER_SUPPORTA_COLORI_SEMANTICI,
  TIPI_SEMANTICI,
  analizzaColoriSorgente,
  analizzaEvidenziazioniTabella,
  coloriAmmessi,
  eTabellaDiSoliDati,
  riconosciTipoSemantico,
  schiarisciColore,
  tintaEvidenziazione,
  tintaRiquadro,
} from "../src/lib/colori-semantici";
import { REGOLE_OMNIA, applicaRegoleSupportate } from "../src/lib/prompts";
import { buildGeneraBozzaTool, type GaraContesto } from "../src/lib/gara-chat-prompt";
import { stimaPagineContenuto } from "../src/lib/stima-pagine";
import { trovaMarcatoriResidui } from "./lib/controlli-relazione";
import { verificaColoriDocumento } from "./lib/controlli-colori";
import { estraiTestiPerNodo } from "./lib/xml-word";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const JSZip = require("jszip");

const fallimenti: string[] = [];
function atteso(nome: string, ok: boolean, dettaglio = "") {
  console.log(`${ok ? "ok    " : "FALLITO"} ${nome}${ok ? "" : ` — ${dettaglio}`}`);
  if (!ok) fallimenti.push(nome);
}

const TABELLA_IMPEGNI = (marcatori: { riga2?: string; cella3?: string; riga4?: string } = {}) => `| Impegno | Descrizione |
|---|---|
| [C]Raccolta carta | [G]Si attiva il ritiro settimanale della carta in tutte le aree |
| ${marcatori.riga2 ?? ""}[C]Raccolta differenziata | [G]Si attiva la raccolta differenziata in tutte le aree dell'edificio |
| [C]Controllo DPI | ${marcatori.cella3 ?? ""}[G]Formazione antincendio annuale per tutto il personale operativo |
| ${marcatori.riga4 ?? ""}[C]Referente | [G]Un responsabile unico è l'interlocutore della stazione appaltante |`;

const MD_TRE_TIPI = `# 1. Criterio di prova

## 1.1 Sotto-criterio con tutti i colori

${TABELLA_IMPEGNI({ riga2: "[RIGA:AMBIENTE]", cella3: "[CELLA:SICUREZZA]", riga4: "[RIGA:CAPITOLATO]" })}

[TABELLA:AMBIENTE]
| Azione | Frequenza |
|---|---|
| [C]Pulizia con prodotti Ecolabel | [G]Quotidiana in tutte le aree comuni |
| [C]Smaltimento rifiuti | [G]Secondo il calendario comunale |

[TABELLA:SICUREZZA]
| Corso | Destinatari |
|---|---|
| [C]Antincendio | [G]Tutto il personale operativo del servizio |
| [C]Primo soccorso | [G]Caposquadra e addetti designati |

[BOX:AMBIENTE]
Tutti i detersivi sono certificati Ecolabel UE.
[/BOX]

[BOX:SICUREZZA]
Ogni operatore riceve i DPI previsti dal piano di sicurezza.
[/BOX]

[BOX:CAPITOLATO]
Come richiesto dall'art. 7 del Capitolato Speciale d'Appalto.
[/BOX]
`;

const MD_DUE_TIPI = `# 1. Criterio di prova

## 1.1 Solo due colori

[BOX:AMBIENTE]
Impegno ambientale.
[/BOX]

[BOX:SICUREZZA]
Impegno di sicurezza.
[/BOX]

${TABELLA_IMPEGNI({ riga2: "[RIGA:AMBIENTE]" })}
`;

const MD_DATI = `# 1. Criterio di prova

## 1.1 Tabella di soli dati

| Fascia | Valore | Soglia |
|---|---|---|
| [C]Prima | [C]120 | [C]25% |
| [RIGA:AMBIENTE][C]Seconda | [C]80 | [C]15% |
| [C]Terza | [CELLA:SICUREZZA][C]40 | [C]SI |
`;

const MD_LIMITI = `# 1. Criterio di prova

## 1.1 Limiti di R22-bis

| Impegno | Descrizione |
|---|---|
| [RIGA:AMBIENTE][C]Uno | [G]Primo impegno descritto con parole sufficienti |
| [RIGA:AMBIENTE][C]Due | [G]Secondo impegno descritto con parole sufficienti |
| [RIGA:AMBIENTE][C]Tre | [G]Terzo impegno descritto con parole sufficienti |
| [C]Quattro | [G]Quarto impegno descritto con parole sufficienti |

| Impegno | Descrizione |
|---|---|
| [C]Cinque | [CELLA:SICUREZZA][G]Quinto impegno descritto con parole sufficienti |
| [C]Sei | [CELLA:SICUREZZA][G]Sesto impegno descritto con parole sufficienti |
| [C]Sette | [CELLA:SICUREZZA][G]Settimo impegno descritto con parole sufficienti |
`;

const MD_LEGACY = `# 1. Criterio di prova

## 1.1 Tag colore delle versioni precedenti

[TABELLA:ROSSA]
| Obbligo | Descrizione |
|---|---|
| [C]Uno | [G]Obbligo normativo descritto con parole sufficienti |
| [C]Due | [G]Secondo obbligo descritto con parole sufficienti |

[TABELLA:VERDE]
| Aspetto | Descrizione |
|---|---|
| [C]Uno | [G]Aspetto ambientale descritto con parole sufficienti |
| [C]Due | [G]Secondo aspetto descritto con parole sufficienti |

[BOX:VERDE]
Una parola di colore non è un tipo: riquadro nel primario.
[/BOX]

[BOX]
Riquadro senza tipo.
[/BOX]
`;

const MD_TABELLARE = `# 1. Criterio di prova

## 1.1 Sotto-criterio tabellare

CRITERIO TABELLARE - COMPILARE

| Dato | Valore |
|---|---|
| [C]Segnaposto | [C]CRITERIO TABELLARE - COMPILARE |
| [C]Altro | [G]Testo descrittivo normale della tabella |
`;

type ZipProva = {
  file(nome: string): { async(tipo: "string"): Promise<string> } | null;
  file(nome: string, contenuto: string): unknown;
};

async function documento(markdown: string): Promise<{ zip: ZipProva; xml: string }> {
  const buffer = await buildDocxBuffer("Prova", markdown, { font: "Calibri", dimensioneCarattere: 12 }, undefined, undefined, {});
  const zip = (await JSZip.loadAsync(buffer)) as ZipProva;
  return { zip, xml: (await zip.file("word/document.xml")?.async("string")) ?? "" };
}

function valuta(xml: string) {
  return verificaColoriDocumento(xml);
}

function trasformaCella(xml: string, indiceTabella: number, riga: number, colonna: number, trasforma: (cella: string) => string): string {
  let n = -1;
  return xml.replace(/<w:tbl>[\s\S]*?<\/w:tbl>/g, (tabella) => {
    n++;
    if (n !== indiceTabella) return tabella;
    let r = -1;
    return tabella.replace(/<w:tr[ >][\s\S]*?<\/w:tr>/g, (rigaXml) => {
      r++;
      if (r !== riga) return rigaXml;
      let c = -1;
      return rigaXml.replace(/<w:tc>[\s\S]*?<\/w:tc>/g, (cella) => {
        c++;
        return c === colonna ? trasforma(cella) : cella;
      });
    });
  });
}

function impostaFondo(cella: string, colore: string): string {
  const senzaFondo = cella.replace(/<w:shd\b[^>]*\/>/, "");
  return senzaFondo.replace(/<w:vAlign\b/, `<w:shd w:fill="${colore}" w:val="clear"/><w:vAlign`);
}

function evidenziaRigaXml(xml: string, indiceTabella: number, riga: number, colonne: number, tipo: keyof typeof COLORE_PIENO): string {
  let nuovo = xml;
  for (let colonna = 0; colonna < colonne; colonna++) {
    nuovo = trasformaCella(nuovo, indiceTabella, riga, colonna, (cella) => {
      let c = impostaFondo(cella, tintaEvidenziazione(tipo));
      if (colonna === 0) {
        c = c.replace(/<w:tcBorders>[\s\S]*?<\/w:tcBorders>/, "");
        c = c.replace(/<w:shd\b/, `<w:tcBorders><w:left w:val="single" w:color="${COLORE_PIENO[tipo]}" w:sz="18"/></w:tcBorders><w:shd`);
      }
      return c;
    });
  }
  return nuovo;
}

function righeEvidenziateNelXml(xml: string): number {
  return (xml.match(/<w:left w:val="single" w:color="(?:27974C|D68910|2E86C1)" w:sz="18"\/>/g) || []).length;
}

async function main() {
  // --- 0. Palette e riconoscimento dei tipi ---
  {
    const pieni = TIPI_SEMANTICI.map((t) => COLORE_PIENO[t]);
    atteso("palette: i tre colori pieni sono distinti", new Set(pieni).size === 3, pieni.join(", "));
    const derivati = [...pieni, ...TIPI_SEMANTICI.map(tintaEvidenziazione), ...TIPI_SEMANTICI.map(tintaRiquadro)];
    atteso("palette: pieni, tinte di evidenziazione e tinte di riquadro sono tutti distinti (nessuna ambiguità di lettura)", new Set(derivati).size === derivati.length, derivati.join(", "));
    atteso("palette: le tinte derivate sono tra i colori ammessi", derivati.every((c) => coloriAmmessi().has(c)), "");
    atteso("palette: fondo tenue = colore pieno schiarito del 90%", tintaEvidenziazione("AMBIENTE") === schiarisciColore("27974C", 0.9), tintaEvidenziazione("AMBIENTE"));
    atteso(
      "tipi: AMBIENTE/SICUREZZA/CAPITOLATO riconosciuti, le parole di colore no",
      riconosciTipoSemantico("AMBIENTE") === "AMBIENTE" &&
        riconosciTipoSemantico("sicurezza") === "SICUREZZA" &&
        riconosciTipoSemantico("Capitolato") === "CAPITOLATO" &&
        riconosciTipoSemantico("VERDE") === null &&
        riconosciTipoSemantico("ROSSA") === null &&
        riconosciTipoSemantico("ARANCIONE") === null &&
        riconosciTipoSemantico("BLU") === null &&
        riconosciTipoSemantico("") === null,
      "",
    );
  }

  // --- 1. Regole nel prompt: R20 e R22-bis solo se il renderer le supporta ---
  {
    atteso("prompt: la costante del renderer è vera (il renderer supporta i colori semantici)", RENDERER_SUPPORTA_COLORI_SEMANTICI === true, "");
    atteso("prompt: con il renderer che li supporta R20 e R22-bis sono nelle regole inviate al modello", /\*\*R20 —/.test(REGOLE_OMNIA) && /\*\*R22-bis —/.test(REGOLE_OMNIA), "");
    atteso("prompt: nessun commento HTML residuo nelle regole inviate", !/<!--/.test(REGOLE_OMNIA), "");
    atteso("prompt: le regole rimandate (R23, R24) restano fuori", !/\*\*R23 —/.test(REGOLE_OMNIA) && !/\*\*R24 —/.test(REGOLE_OMNIA), "");
    const base = "prima\n<!-- INIZIO COLORE SEMANTICO -->\n- **R20 — x**\n<!-- FINE COLORE SEMANTICO -->\ndopo";
    const garaMinima = { sub_criteri_tabellari: null, criteri_valutazione: null, criteri_riepilogo: null, limite_pagine_totale: null, punteggio_tecnico_max: null } as unknown as GaraContesto;
    const proprieta = buildGeneraBozzaTool(garaMinima).input_schema.properties as Record<string, { description?: string }>;
    const descrizione = proprieta.contenuto?.description ?? "";
    atteso("prompt: la descrizione dello strumento è stata letta (campo contenuto)", descrizione.length > 500, `lunghezza ${descrizione.length}`);
    atteso("prompt: la descrizione dello strumento insegna i tag tipizzati ([BOX:TIPO], [RIGA:TIPO], [CELLA:TIPO], [TABELLA:AMBIENTE|SICUREZZA])", /\[BOX:AMBIENTE\]/.test(descrizione) && /\[RIGA:TIPO\]/.test(descrizione) && /\[CELLA:TIPO\]/.test(descrizione) && /\[TABELLA:AMBIENTE\]/.test(descrizione) && /\[TABELLA:SICUREZZA\]/.test(descrizione), "");
    atteso("prompt: la descrizione dello strumento non insegna più i tag con una parola di colore", !/\[TABELLA:(?:BLU|ROSSA|VERDE|ARANCIONE)\]/.test(descrizione) && !/\[BOX\]testo/.test(descrizione), "");
    atteso("prompt: se il renderer non le supportasse, R20/R22-bis non verrebbero inviate", !/R20/.test(applicaRegoleSupportate(base, false)) && /prima\ndopo/.test(applicaRegoleSupportate(base, false)), applicaRegoleSupportate(base, false));
    atteso("prompt: se le supporta restano, senza i commenti", /R20/.test(applicaRegoleSupportate(base, true)) && !/<!--/.test(applicaRegoleSupportate(base, true)), "");
  }

  // --- 2. Casi legittimi: nessun falso allarme ---
  {
    const { xml } = await documento(MD_TRE_TIPI);
    const esito = valuta(xml);
    atteso("tre tipi (riquadri, righe/celle evidenziate, intestazioni a tema): nessun errore", esito.errori.length === 0, esito.errori.join(" / "));
    atteso("tre tipi: i tre colori semantici risultano in uso", esito.tipiUsati.size === 3, [...esito.tipiUsati].join(", "));
    atteso("tre tipi: legenda compatta in coda all'indice", /Legenda dei colori/.test(xml) && /Impegni ambientali/.test(xml) && /stazione appaltante/.test(xml), "");
    atteso("tre tipi: nessun marcatore di sintassi lasciato come testo", trovaMarcatoriResidui(estraiTestiPerNodo(xml)).length === 0, trovaMarcatoriResidui(estraiTestiPerNodo(xml)).join(" / "));
    atteso("tre tipi: la riga [RIGA:AMBIENTE] ha il bordo sinistro nel verde pieno e il fondo tenue", xml.includes(`w:color="${COLORE_PIENO.AMBIENTE}" w:sz="18"`) && xml.includes(`w:fill="${tintaEvidenziazione("AMBIENTE")}"`), "");
    atteso("tre tipi: la cella [CELLA:SICUREZZA] ha il fondo tenue arancio senza bordo spesso", xml.includes(`w:fill="${tintaEvidenziazione("SICUREZZA")}"`) && !xml.includes(`w:color="${COLORE_PIENO.SICUREZZA}" w:sz="18"`), "");
    atteso("tre tipi: intestazione verde per la tabella AMBIENTE e arancio per la SICUREZZA", xml.includes(`w:fill="${COLORE_PIENO.AMBIENTE}"`) && xml.includes(`w:fill="${COLORE_PIENO.SICUREZZA}"`), "");
    atteso("tre tipi: i riquadri hanno bordo spesso (3 pt) nel colore pieno e fondo molto tenue", xml.includes(`w:color="${COLORE_PIENO.CAPITOLATO}" w:sz="24"`) && xml.includes(`w:fill="${tintaRiquadro("AMBIENTE")}"`) && xml.includes(`w:fill="${tintaRiquadro("SICUREZZA")}"`), "");
  }
  {
    const { xml } = await documento(MD_DUE_TIPI);
    const esito = valuta(xml);
    atteso("solo due tipi: nessun errore e nessuna legenda", esito.errori.length === 0 && !/Legenda dei colori/.test(xml), esito.errori.join(" / "));
  }
  {
    const { xml } = await documento(MD_TABELLARE);
    const esito = valuta(xml);
    atteso("segnaposto tabellare in rosso: ammesso solo su quel testo, nessun errore", xml.includes('w:val="C0392B"') && esito.errori.length === 0, esito.errori.join(" / ") || "rosso assente");
  }
  {
    const { xml } = await documento(MD_LEGACY);
    const esito = valuta(xml);
    atteso("tag colore delle versioni precedenti ([TABELLA:ROSSA]/[TABELLA:VERDE]/[BOX:VERDE]): niente colori nuovi, nessun errore", esito.errori.length === 0, esito.errori.join(" / "));
    atteso("tag colore delle versioni precedenti: intestazioni tutte nel primario, nessun verde né rosso", !xml.includes(`w:fill="${COLORE_PIENO.AMBIENTE}"`) && !xml.includes('w:fill="C0392B"') && esito.tipiUsati.size === 1, [...esito.tipiUsati].join(", "));
    atteso("tag colore delle versioni precedenti: nessun marcatore lasciato come testo", trovaMarcatoriResidui(estraiTestiPerNodo(xml)).length === 0, trovaMarcatoriResidui(estraiTestiPerNodo(xml)).join(" / "));
  }

  // --- 2-bis. Tag di tabella scritti nel testo (osservato in una generazione
  // reale: "[TABELLA:AMBIENTE] non si applica qui; ...") ---
  {
    const { xml } = await documento(`# 1. Criterio di prova

## 1.1 Tag citati nel testo

[TABELLA:AMBIENTE] non si applica qui; si riporta invece la tabella delle verifiche operative:

- [RIGA:SICUREZZA] Elemento di elenco con un tag fuori posto
- [CELLA:AMBIENTE] Altro elemento

[CELLA:CAPITOLATO]

Paragrafo normale che resta.
`);
    const residui = trovaMarcatoriResidui(estraiTestiPerNodo(xml));
    atteso("tag di tabella scritti nel testo: nessun marcatore lasciato come testo", residui.length === 0, residui.join(" / "));
    atteso("tag di tabella scritti nel testo: il resto della frase e degli elenchi resta", /non si applica qui/.test(xml) && /Elemento di elenco con un tag fuori posto/.test(xml) && /Paragrafo normale che resta/.test(xml), "");
    atteso("tag di tabella scritti nel testo: nessun colore semantico conteggiato", valuta(xml).errori.length === 0 && valuta(xml).tipiUsati.size === 0, valuta(xml).errori.join(" / "));
  }

  // --- 3. Le regole sono applicate dal renderer, non solo chieste al modello ---
  {
    const { xml } = await documento(MD_DATI);
    atteso(
      "tabella di soli dati: l'evidenziazione dichiarata dal modello non viene applicata",
      righeEvidenziateNelXml(xml) === 0 && !xml.includes(`w:fill="${tintaEvidenziazione("AMBIENTE")}"`) && !xml.includes(`w:fill="${tintaEvidenziazione("SICUREZZA")}"`) && valuta(xml).errori.length === 0,
      valuta(xml).errori.join(" / "),
    );
    atteso("tabella di soli dati: nessun marcatore lasciato come testo", trovaMarcatoriResidui(estraiTestiPerNodo(xml)).length === 0, "");
  }
  {
    const { xml } = await documento(MD_LIMITI);
    atteso("più di due righe dichiarate: ne restano due", righeEvidenziateNelXml(xml) === 2, `righe evidenziate: ${righeEvidenziateNelXml(xml)}`);
    atteso(
      "colonna evidenziata per intero: le celle dichiarate non vengono applicate",
      !(xml.match(new RegExp(`w:fill="${tintaEvidenziazione("SICUREZZA")}"`, "g")) || []).length && valuta(xml).errori.length === 0,
      valuta(xml).errori.join(" / "),
    );
  }

  // --- 4. Unità: regole di analisi e tag di colore nel sorgente ---
  {
    const sicuro = analizzaEvidenziazioniTabella([["A", "B"], ["x", "descrizione lunga uno"], ["[RIGA:AMBIENTE]y", "descrizione lunga due"]]);
    atteso("analisi: [RIGA:tipo] riconosciuto e tolto dal testo", sicuro.riga[1] === "AMBIENTE" && sicuro.tabella[2][0] === "y", JSON.stringify(sicuro));
    const ignoto = analizzaEvidenziazioniTabella([["A", "B"], ["[RIGA:VERDE]x", "descrizione lunga uno"], ["y", "[CELLA:BOH]descrizione lunga due"]]);
    atteso("analisi: un tipo sconosciuto non evidenzia nulla ma il marcatore sparisce dal testo", ignoto.riga.every((r) => r === null) && ignoto.cella.every((r) => r.every((c) => c === null)) && !/\[/.test(ignoto.tabella.flat().join("")), JSON.stringify(ignoto));
    atteso("analisi: numeri e SI/NO sono dati, un testo descrittivo no", eTabellaDiSoliDati([["a", "12", "SI"], ["b", "3,5 ore", "NO"]]) && !eTabellaDiSoliDati([["a", "12", "Giornaliera"]]), "");
    const sorgente = analizzaColoriSorgente(`${MD_LEGACY}\n${MD_LIMITI}`);
    atteso("sorgente: parole di colore al posto di un tipo segnalate", sorgente.tagColore.includes("[TABELLA:ROSSA]") && sorgente.tagColore.includes("[TABELLA:VERDE]") && sorgente.tagColore.includes("[BOX:VERDE]"), sorgente.tagColore.join(", "));
    atteso("sorgente: evidenziazioni oltre i limiti segnalate come scartate", sorgente.evidenziazioniScartate.length >= 2, sorgente.evidenziazioniScartate.join(" / "));
    const conMarcatori = TABELLA_IMPEGNI({ riga2: "[RIGA:AMBIENTE]", cella3: "[CELLA:SICUREZZA]" });
    const senzaMarcatori = TABELLA_IMPEGNI();
    atteso("stima pagine: i marcatori di evidenziazione non cambiano la lunghezza stimata", Math.abs(stimaPagineContenuto(conMarcatori) - stimaPagineContenuto(senzaMarcatori)) < 1e-9, `${stimaPagineContenuto(conMarcatori)} vs ${stimaPagineContenuto(senzaMarcatori)}`);
  }

  // --- 5. Mutazioni: ogni regola violata a mano deve far fallire il controllo ---
  {
    const { xml } = await documento(MD_TRE_TIPI);
    const base = valuta(xml).errori.length;
    atteso("(riferimento) il documento di partenza delle mutazioni è pulito", base === 0, valuta(xml).errori.join(" / "));

    const fuoriPalette = xml.replace('w:fill="2E86C1"', 'w:fill="FF0000"');
    atteso("mutazione: un fondo rosso fuori palette → errore", fuoriPalette !== xml && valuta(fuoriPalette).errori.some((e) => /FF0000/.test(e) && /tre colori previsti/.test(e)), valuta(fuoriPalette).errori.join(" / "));

    const quartoColore = xml.replace(/<w:color w:val="FFFFFF"\/>/, '<w:color w:val="8E44AD"/>');
    atteso("mutazione: un quarto colore viola nel testo → errore", quartoColore !== xml && valuta(quartoColore).errori.some((e) => /8E44AD/.test(e)), valuta(quartoColore).errori.join(" / "));

    const rossoAltrove = xml.replace("<w:r><w:rPr>", '<w:r><w:rPr><w:color w:val="C0392B"/>');
    atteso("mutazione: rosso su un testo diverso dal segnaposto tabellare → errore", rossoAltrove !== xml && valuta(rossoAltrove).errori.some((e) => /rosso/.test(e)), valuta(rossoAltrove).errori.join(" / "));

    const senzaLegenda = xml.replace("Legenda dei colori", "Note");
    atteso("mutazione: tre colori in uso senza legenda → errore", senzaLegenda !== xml && valuta(senzaLegenda).errori.some((e) => /manca la legenda/.test(e)), valuta(senzaLegenda).errori.join(" / "));

    const intestazioneChiara = trasformaCella(xml, 0, 0, 0, (cella) => impostaFondo(cella, schiarisciColore("2E86C1", 0.85)));
    atteso("mutazione: intestazione di tabella in una tinta chiara invece del colore pieno → errore", intestazioneChiara !== xml && valuta(intestazioneChiara).errori.some((e) => /intestazione non è in un unico colore pieno/.test(e)), valuta(intestazioneChiara).errori.join(" / "));

    // La tabella 0 è TABELLA_IMPEGNI: riga 2 (corpo 1) evidenziata AMBIENTE.
    const fondoAlternato = trasformaCella(xml, 0, 2, 1, (cella) => impostaFondo(cella, schiarisciColore("2E86C1", 0.85)));
    atteso("mutazione: riga evidenziata con una cella ancora sul fondo alternato → errore", fondoAlternato !== xml && valuta(fondoAlternato).errori.some((e) => /sostituisce l'alternanza/.test(e)), valuta(fondoAlternato).errori.join(" / "));

    const terzaRiga = evidenziaRigaXml(xml, 0, 1, 2, "AMBIENTE");
    atteso("mutazione: una terza riga evidenziata → errore", terzaRiga !== xml && valuta(terzaRiga).errori.some((e) => /righe evidenziate, al massimo 2/.test(e)), valuta(terzaRiga).errori.join(" / "));

    // Nel documento di partenza la colonna 2 è evidenziata nelle righe 2 e 4
    // (per riga) e nella 3 (per cella): evidenziare anche la 1 la riempie.
    const colonna = trasformaCella(xml, 0, 1, 1, (cella) => impostaFondo(cella, tintaEvidenziazione("SICUREZZA")));
    atteso("mutazione: l'ultima cella che completa una colonna evidenziata → errore", colonna !== xml && valuta(colonna).errori.some((e) => /evidenziata per intero/.test(e)), valuta(colonna).errori.join(" / "));
  }
  {
    const { xml } = await documento(MD_DATI);
    const dati = trasformaCella(xml, 0, 1, 1, (cella) => impostaFondo(cella, tintaEvidenziazione("AMBIENTE")));
    atteso("mutazione: evidenziazione in una tabella di soli dati → errore", dati !== xml && valuta(dati).errori.some((e) => /soli dati/.test(e)), valuta(dati).errori.join(" / "));
    const datiRiga = evidenziaRigaXml(xml, 0, 1, 3, "SICUREZZA");
    atteso("mutazione: riga evidenziata in una tabella di soli dati → errore", datiRiga !== xml && valuta(datiRiga).errori.some((e) => /soli dati/.test(e)), valuta(datiRiga).errori.join(" / "));
  }
  {
    const { xml } = await documento(MD_DUE_TIPI);
    const conLegenda = xml.replace("Solo due colori", "Solo due colori Legenda dei colori");
    atteso("mutazione: legenda presente con soli due colori in uso → errore", conLegenda !== xml && valuta(conLegenda).errori.some((e) => /solo 2/.test(e)), valuta(conLegenda).errori.join(" / "));
  }

  if (fallimenti.length > 0) {
    console.log(`\n${fallimenti.length} verifiche fallite`);
    process.exit(1);
  }
  console.log("\nAutotest dei colori semantici: tutti i casi ok.");
}

main().catch((err) => {
  console.error("Errore inatteso nell'autotest dei colori:", err);
  process.exit(1);
});
