// Controlli sui colori semantici di un documento Word generato (livello 1,
// condivisi con il livello 2 tramite controlli-relazione.ts). Leggono l'XML
// del documento, non il testo sorgente: verificano ciò che il lettore vede.
//
//  1. Nessun colore fuori dai tre previsti (verde, arancio, blu primario),
//     le loro tinte derivate e i neutri strutturali — il rosso ammesso solo
//     sul segnaposto dei criteri tabellari.
//  2. Nessuna evidenziazione nelle tabelle di soli dati.
//  3. R22-bis: al massimo due righe evidenziate per tabella, mai un'intera
//     colonna; su una riga evidenziata la tinta SOSTITUISCE i fondi (nessuna
//     cella con l'alternanza o la tinta della prima colonna).
//  4. Intestazioni di tabella sempre in uno dei tre colori pieni.
//  5. Legenda presente se e solo se i colori semantici in uso sono più di due.
import { TITOLO_LEGENDA_COLORI } from "../../src/lib/docx-generator";
import {
  COLORE_PIENO,
  COLORE_SEGNALE_TABELLARE,
  ETICHETTA_LEGENDA,
  MAX_RIGHE_EVIDENZIATE_PER_TABELLA,
  TIPI_SEMANTICI,
  coloriAmmessi,
  eTabellaDiSoliDati,
  tintaEvidenziazione,
  tintaRiquadro,
  type TipoSemantico,
} from "../../src/lib/colori-semantici";
import { attributoXml, estraiTestiVisibili } from "./xml-word";

const TESTO_SEGNAPOSTO_TABELLARE = "CRITERIO TABELLARE - COMPILARE";

function maiuscolo(valore: string | null): string | null {
  return valore ? valore.toUpperCase() : null;
}

function tipoDaColorePieno(colore: string | null): TipoSemantico | null {
  return TIPI_SEMANTICI.find((t) => COLORE_PIENO[t] === colore) ?? null;
}
function tipoDaTintaEvidenziazione(colore: string | null): TipoSemantico | null {
  return TIPI_SEMANTICI.find((t) => tintaEvidenziazione(t) === colore) ?? null;
}
function tipoDaTintaRiquadro(colore: string | null): TipoSemantico | null {
  return TIPI_SEMANTICI.find((t) => tintaRiquadro(t) === colore) ?? null;
}

type CellaXml = { testo: string; riempimento: string | null; bordoSinistro: { spessore: number; colore: string | null } | null };

function leggiCella(xml: string): CellaXml {
  const shd = xml.match(/<w:shd\b[^>]*\/?>/)?.[0] ?? "";
  const bordi = xml.match(/<w:tcBorders>[\s\S]*?<\/w:tcBorders>/)?.[0] ?? "";
  const sinistro = bordi.match(/<w:left\b[^>]*\/?>/)?.[0] ?? "";
  const stile = attributoXml(sinistro, "w:val");
  return {
    testo: estraiTestiVisibili(xml).trim(),
    riempimento: maiuscolo(attributoXml(shd, "w:fill")),
    bordoSinistro:
      sinistro && stile && stile !== "nil" && stile !== "none"
        ? { spessore: Number(attributoXml(sinistro, "w:sz") ?? 0), colore: maiuscolo(attributoXml(sinistro, "w:color")) }
        : null,
  };
}

function leggiTabelle(documentXml: string): CellaXml[][][] {
  return (documentXml.match(/<w:tbl>[\s\S]*?<\/w:tbl>/g) || []).map((tabella) =>
    (tabella.match(/<w:tr[ >][\s\S]*?<\/w:tr>/g) || []).map((riga) => (riga.match(/<w:tc>[\s\S]*?<\/w:tc>/g) || []).map(leggiCella)),
  );
}

export type EsitoControlliColori = { errori: string[]; tipiUsati: Set<TipoSemantico> };

export function verificaColoriDocumento(documentXml: string, headerXml = "", footerXml = ""): EsitoControlliColori {
  const errori: string[] = [];
  const tipiUsati = new Set<TipoSemantico>();
  const ammessi = coloriAmmessi();
  const xmlCompleto = `${documentXml}\n${headerXml}\n${footerXml}`;

  // --- 1. Nessun colore fuori dai tre previsti ---
  const trovati = new Map<string, number>();
  const conta = (valore: string | undefined) => {
    if (!valore || !/^[0-9A-Fa-f]{6}$/.test(valore)) return;
    const colore = valore.toUpperCase();
    trovati.set(colore, (trovati.get(colore) ?? 0) + 1);
  };
  for (const m of xmlCompleto.matchAll(/<w:color\b[^>]*\bw:val="([^"]*)"/g)) conta(m[1]);
  for (const m of xmlCompleto.matchAll(/\bw:fill="([^"]*)"/g)) conta(m[1]);
  for (const m of xmlCompleto.matchAll(/<w:(?:top|left|bottom|right|insideH|insideV|between|bar)\b[^>]*\bw:color="([^"]*)"/g)) conta(m[1]);
  for (const m of xmlCompleto.matchAll(/\(colore ([0-9A-Fa-f]{6})\)/g)) conta(m[1]);

  const rosso = COLORE_SEGNALE_TABELLARE.toUpperCase();
  const usiRosso = trovati.get(rosso) ?? 0;
  const eccezioni = [...trovati.keys()].filter((c) => !ammessi.has(c) && c !== rosso);
  for (const colore of eccezioni) {
    errori.push(`Colori: ${colore} compare ${trovati.get(colore)} volta/e nel documento ma non è tra i tre colori previsti (verde ${COLORE_PIENO.AMBIENTE}, arancio ${COLORE_PIENO.SICUREZZA}, blu primario ${COLORE_PIENO.CAPITOLATO}) né una loro tinta o un neutro strutturale.`);
  }

  // Il rosso esiste solo come segnaposto dei criteri tabellari: ogni suo uso
  // deve stare in un testo che è esattamente quel segnaposto.
  if (usiRosso > 0) {
    const runConRosso = (documentXml.match(/<w:r>[\s\S]*?<\/w:r>/g) || []).filter((run) => new RegExp(`<w:color\\b[^>]*\\bw:val="${rosso}"`, "i").test(run));
    const fuoriSegnaposto = runConRosso.filter((run) => estraiTestiVisibili(run).replace(/\s+/g, " ").trim().toUpperCase() !== TESTO_SEGNAPOSTO_TABELLARE);
    if (fuoriSegnaposto.length > 0 || runConRosso.length !== usiRosso) {
      errori.push(`Colori: il rosso (${rosso}) è ammesso solo sul testo del segnaposto "${TESTO_SEGNAPOSTO_TABELLARE}", ma compare ${usiRosso} volta/e (${runConRosso.length - fuoriSegnaposto.length} sul segnaposto).`);
    }
  }

  // --- Tabelle: riquadri, intestazioni, evidenziazioni ---
  const tabelle = leggiTabelle(documentXml);
  tabelle.forEach((righe, indiceTabella) => {
    const etichetta = `Tabella ${indiceTabella + 1}`;

    // Riquadro d'impegno: tabella a cella singola, fondo tenue del tipo.
    if (righe.length === 1 && righe[0].length === 1) {
      const cella = righe[0][0];
      const tipo = tipoDaTintaRiquadro(cella.riempimento);
      if (tipo) {
        tipiUsati.add(tipo);
        if (!cella.bordoSinistro || cella.bordoSinistro.colore !== COLORE_PIENO[tipo]) {
          errori.push(`${etichetta} (riquadro ${tipo}): manca il bordo sinistro nel colore pieno ${COLORE_PIENO[tipo]}.`);
        }
      }
      return;
    }
    if (righe.length < 2 || righe[0].length < 2) return;

    // Intestazione: sempre uno dei tre colori pieni, uguale su tutta la riga.
    const [intestazione, ...corpo] = righe;
    const fillIntestazione = new Set(intestazione.map((c) => c.riempimento));
    const tipoIntestazione = fillIntestazione.size === 1 ? tipoDaColorePieno([...fillIntestazione][0]) : null;
    if (!tipoIntestazione) {
      errori.push(`${etichetta}: l'intestazione non è in un unico colore pieno tra i tre previsti (trovati: ${[...fillIntestazione].join(", ")}).`);
    } else if (tipoIntestazione !== "CAPITOLATO") {
      tipiUsati.add(tipoIntestazione);
    }

    // Evidenziazioni: riga = bordo sinistro spesso in colore pieno sulla
    // prima cella; cella = sola tinta tenue.
    const righeEvidenziate: number[] = [];
    // Per ogni riga del corpo e colonna: evidenziata (per riga o per cella).
    const celleEvidenziatePerRiga: boolean[][] = [];
    const rigaEvidenziataPerRiga: boolean[] = [];
    corpo.forEach((riga, indiceRiga) => {
      const prima = riga[0];
      const tipoBordo = prima?.bordoSinistro ? tipoDaColorePieno(prima.bordoSinistro.colore) : null;
      const tipoRigaDaFondo = tipoDaTintaEvidenziazione(prima?.riempimento ?? null);
      const eRigaEvidenziata = Boolean(tipoBordo && tipoRigaDaFondo === tipoBordo);
      if (eRigaEvidenziata && tipoBordo) {
        righeEvidenziate.push(indiceRiga);
        tipiUsati.add(tipoBordo);
        // La tinta SOSTITUISCE i fondi: ogni cella della riga ha la tinta del
        // tipo, nessuna l'alternanza o la tinta della prima colonna.
        for (const [indiceCella, cella] of riga.entries()) {
          if (cella.riempimento !== tintaEvidenziazione(tipoBordo)) {
            errori.push(`${etichetta}, riga ${indiceRiga + 1}, cella ${indiceCella + 1}: su una riga evidenziata (${tipoBordo}) il fondo è ${cella.riempimento ?? "assente"}, atteso ${tintaEvidenziazione(tipoBordo)} (l'evidenziazione sostituisce l'alternanza dei fondi, non vi si somma).`);
          }
        }
      } else if (prima?.bordoSinistro && tipoBordo && prima.bordoSinistro.spessore >= 12) {
        errori.push(`${etichetta}, riga ${indiceRiga + 1}: bordo sinistro spesso in colore pieno senza la tinta tenue del suo tipo.`);
      }
      const celle = riga.map((c) => {
        const tipo = tipoDaTintaEvidenziazione(c.riempimento);
        if (tipo) tipiUsati.add(tipo);
        return Boolean(tipo);
      });
      celleEvidenziatePerRiga.push(celle);
      rigaEvidenziataPerRiga.push(eRigaEvidenziata);
    });

    const haEvidenziazioni = righeEvidenziate.length > 0 || celleEvidenziatePerRiga.some((r) => r.some(Boolean));
    // Stessa definizione di colonna "intera" del renderer
    // (analizzaEvidenziazioniTabella): ogni riga evidenziata in quella
    // colonna e almeno una per sola cella.
    if (haEvidenziazioni && eTabellaDiSoliDati(corpo.map((riga) => riga.map((c) => c.testo)))) {
      errori.push(`${etichetta}: evidenziazione in una tabella di soli dati (${corpo.length} righe, nessuna cella descrittiva fuori dalla prima colonna).`);
    }
    if (righeEvidenziate.length > MAX_RIGHE_EVIDENZIATE_PER_TABELLA) {
      errori.push(`${etichetta}: ${righeEvidenziate.length} righe evidenziate, al massimo ${MAX_RIGHE_EVIDENZIATE_PER_TABELLA} (R22-bis).`);
    }
    const numColonne = Math.max(...corpo.map((r) => r.length));
    if (corpo.length >= 2) {
      for (let colonna = 0; colonna < numColonne; colonna++) {
        const tutte = corpo.every((_, i) => celleEvidenziatePerRiga[i][colonna]);
        const almenoUnaPerCella = corpo.some((_, i) => celleEvidenziatePerRiga[i][colonna] && !rigaEvidenziataPerRiga[i]);
        if (tutte && almenoUnaPerCella) {
          errori.push(`${etichetta}: la colonna ${colonna + 1} è evidenziata per intero (R22-bis: mai un'intera colonna).`);
        }
      }
    }
  });

  // --- Legenda: se e solo se i colori semantici in uso sono più di due ---
  const testoDocumento = estraiTestiVisibili(documentXml);
  const legendaPresente = testoDocumento.includes(TITOLO_LEGENDA_COLORI);
  if (tipiUsati.size > 2 && !legendaPresente) {
    errori.push(`Legenda: i colori semantici in uso sono ${tipiUsati.size} (${[...tipiUsati].join(", ")}) ma manca la legenda in coda all'indice.`);
  }
  if (tipiUsati.size <= 2 && legendaPresente) {
    errori.push(`Legenda: presente ma i colori semantici in uso sono solo ${tipiUsati.size}: la legenda serve oltre i due.`);
  }
  if (legendaPresente) {
    for (const tipo of TIPI_SEMANTICI) {
      if (!testoDocumento.includes(ETICHETTA_LEGENDA[tipo])) errori.push(`Legenda: manca la voce "${ETICHETTA_LEGENDA[tipo]}".`);
    }
  }

  return { errori, tipiUsati };
}
