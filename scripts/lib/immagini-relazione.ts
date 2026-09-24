// Manifest delle figure di un documento Word e confronto con il testo
// sorgente. Nato da un'anomalia osservata una volta sola e non
// riprodotta (4 immagini nel documento contro 1 solo blocco
// [ORGANIGRAMMA] nel testo): senza sapere QUALE figura era stata prodotta
// e DA QUALE parte del testo, l'unica strada era rigenerare a pagamento.
//
// Il renderer produce solo due tipi di immagine — organigramma e icona
// [ICONA:nome] — e ciascuna dichiara il proprio tipo nel testo alternativo
// (vedi docx-generator.ts). Il controllo verifica che:
//  - ogni figura sia riconducibile a uno dei due tipi (altrimenti è una
//    figura indebita, potenzialmente una fotografia: R16);
//  - il numero di organigrammi nel documento coincida con i blocchi
//    [ORGANIGRAMMA] del testo sorgente;
//  - il numero di icone coincida con i tag [ICONA:nome] validi del testo
//    sorgente (un file media può essere condiviso da più icone identiche
//    per nome e colore: si contano le figure nel documento, non i file).
// Ogni errore riporta il manifest completo, così l'anomalia si diagnostica
// dal solo output/dump, senza rigenerare.
import { NOMI_ICONE } from "../../src/lib/icons";
import { NOME_IMMAGINE_ORGANIGRAMMA, PREFISSO_NOME_IMMAGINE_ICONA } from "../../src/lib/docx-generator";
import { attributoXml, estraiTestiVisibili } from "./xml-word";

export type FiguraDocumento = {
  indice: number;
  tipo: "organigramma" | "icona" | "sconosciuta";
  nomeAlt: string;
  descrizioneAlt: string;
  fileMedia: string;
  byte: number;
  pixelIntrinseci: { w: number; h: number } | null;
  dimensioneInDocumento: { w: number; h: number } | null;
  inTabella: boolean;
  parte: string;
  contestoTesto: string;
  sorgente: string | null;
};

export type SorgenteFigure = {
  organigrammi: { indice: number; parte: string; primaRiga: string; righe: number }[];
  icone: { indice: number; nome: string; parte: string; riga: string }[];
};

const EMU_PER_PIXEL = 9525;

function abbrevia(testo: string, max = 90): string {
  const pulito = testo.replace(/\s+/g, " ").trim();
  return pulito.length > max ? `${pulito.slice(0, max - 1)}…` : pulito;
}

// Percorso dei titoli sotto cui si trova la riga corrente ("1. Qualità… ›
// 1.2 Modalità… › Piano operativo"): dice DA QUALE parte del testo viene
// una figura.
function percorso(titoli: Map<number, string>): string {
  return [...titoli.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, t]) => t)
    .join(" › ");
}

export function estraiSorgenteFigure(markdown: string): SorgenteFigure {
  const organigrammi: SorgenteFigure["organigrammi"] = [];
  const icone: SorgenteFigure["icone"] = [];
  const titoli = new Map<number, string>();
  let inOrganigramma = false;
  let inizioOrganigramma: { parte: string; primaRiga: string; righe: number } | null = null;

  for (const riga of markdown.split("\n")) {
    const t = riga.trim();
    const titolo = t.match(/^(#{1,4})\s+(.+)$/);
    if (titolo && !inOrganigramma) {
      const livello = titolo[1].length;
      titoli.set(livello, abbrevia(titolo[2], 60));
      for (const l of [...titoli.keys()]) if (l > livello) titoli.delete(l);
      continue;
    }
    if (/^\[ORGANIGRAMMA\]$/i.test(t)) {
      inOrganigramma = true;
      inizioOrganigramma = { parte: percorso(titoli), primaRiga: "", righe: 0 };
      continue;
    }
    if (/^\[\/ORGANIGRAMMA\]$/i.test(t)) {
      if (inizioOrganigramma) {
        organigrammi.push({ indice: organigrammi.length + 1, ...inizioOrganigramma });
      }
      inOrganigramma = false;
      inizioOrganigramma = null;
      continue;
    }
    if (inOrganigramma) {
      if (inizioOrganigramma) {
        if (!inizioOrganigramma.primaRiga && t) inizioOrganigramma.primaRiga = abbrevia(t, 70);
        if (t) inizioOrganigramma.righe++;
      }
      continue;
    }
    for (const m of riga.matchAll(/\[ICONA:([a-zA-Z]+)\]/g)) {
      const nome = m[1].toLowerCase();
      if (NOMI_ICONE.includes(nome)) {
        icone.push({ indice: icone.length + 1, nome, parte: percorso(titoli), riga: abbrevia(riga, 80) });
      }
    }
  }
  return { organigrammi, icone };
}

// Legge le figure dal pacchetto Word (JSZip già caricato).
export async function estraiFigureDocumento(
  zip: { file(nome: string): { async(tipo: "string"): Promise<string>; async(tipo: "nodebuffer"): Promise<Buffer> } | null },
): Promise<FiguraDocumento[]> {
  const documentXml = (await zip.file("word/document.xml")?.async("string")) ?? "";
  const relsXml = (await zip.file("word/_rels/document.xml.rels")?.async("string")) ?? "";

  const rels = new Map<string, string>();
  for (const m of relsXml.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = attributoXml(m[0], "Id");
    const target = attributoXml(m[0], "Target");
    if (id && target) rels.set(id, target);
  }

  // Intervalli delle tabelle (per sapere se una figura sta in una cella).
  const intervalliTabella: [number, number][] = [];
  {
    let profondita = 0;
    let inizio = -1;
    for (const m of documentXml.matchAll(/<w:tbl>|<\/w:tbl>/g)) {
      if (m[0] === "<w:tbl>") {
        if (profondita === 0) inizio = m.index ?? 0;
        profondita++;
      } else {
        profondita--;
        if (profondita === 0 && inizio >= 0) intervalliTabella.push([inizio, (m.index ?? 0) + m[0].length]);
      }
    }
  }

  const figure: FiguraDocumento[] = [];
  const titoli = new Map<number, string>();

  for (const p of documentXml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)) {
    const xmlParagrafo = p[0];
    const posizione = p.index ?? 0;
    const testoParagrafo = estraiTestiVisibili(xmlParagrafo);

    const heading = xmlParagrafo.match(/<w:pStyle w:val="Heading(\d)"/);
    if (heading) {
      const livello = Number(heading[1]);
      titoli.set(livello, abbrevia(testoParagrafo, 60));
      for (const l of [...titoli.keys()]) if (l > livello) titoli.delete(l);
    }

    for (const d of xmlParagrafo.matchAll(/<w:drawing>[\s\S]*?<\/w:drawing>/g)) {
      const drawing = d[0];
      const docPr = drawing.match(/<wp:docPr\b[^>]*>/)?.[0] ?? "";
      const nomeAlt = attributoXml(docPr, "name") ?? "";
      const descrizioneAlt = attributoXml(docPr, "descr") ?? "";
      const embed = drawing.match(/r:embed="([^"]+)"/)?.[1] ?? "";
      const target = rels.get(embed) ?? "";
      const fileMedia = target ? `word/${target}` : "(non risolto)";
      const buffer = target ? await zip.file(fileMedia)?.async("nodebuffer") : undefined;

      let pixelIntrinseci: FiguraDocumento["pixelIntrinseci"] = null;
      if (buffer && buffer.length > 24 && buffer.readUInt32BE(0) === 0x89504e47) {
        pixelIntrinseci = { w: buffer.readUInt32BE(16), h: buffer.readUInt32BE(20) };
      }
      const extent = drawing.match(/<wp:extent cx="(\d+)" cy="(\d+)"/);

      const tipo: FiguraDocumento["tipo"] =
        nomeAlt === NOME_IMMAGINE_ORGANIGRAMMA
          ? "organigramma"
          : nomeAlt.startsWith(PREFISSO_NOME_IMMAGINE_ICONA)
            ? "icona"
            : "sconosciuta";

      figure.push({
        indice: figure.length + 1,
        tipo,
        nomeAlt,
        descrizioneAlt,
        fileMedia,
        byte: buffer?.length ?? 0,
        pixelIntrinseci,
        dimensioneInDocumento: extent
          ? { w: Math.round(Number(extent[1]) / EMU_PER_PIXEL), h: Math.round(Number(extent[2]) / EMU_PER_PIXEL) }
          : null,
        inTabella: intervalliTabella.some(([a, b]) => posizione >= a && posizione < b),
        parte: percorso(titoli),
        contestoTesto: abbrevia(testoParagrafo, 80),
        sorgente: null,
      });
    }
  }
  return figure;
}

// Abbina a ciascuna figura la parte di testo sorgente da cui deriva (per
// ordine di comparsa: organigrammi con blocchi, icone con tag validi).
export function abbinaSorgente(figure: FiguraDocumento[], sorgente: SorgenteFigure): void {
  let iOrg = 0;
  let iIcona = 0;
  for (const f of figure) {
    if (f.tipo === "organigramma") {
      const s = sorgente.organigrammi[iOrg++];
      f.sorgente = s
        ? `blocco [ORGANIGRAMMA] n.${s.indice} sotto «${s.parte || "(nessun titolo)"}», ${s.righe} righe, inizia con «${s.primaRiga}»`
        : "nessun blocco [ORGANIGRAMMA] corrispondente nel testo sorgente";
    } else if (f.tipo === "icona") {
      const s = sorgente.icone[iIcona++];
      f.sorgente = s
        ? `tag [ICONA:${s.nome}] n.${s.indice} sotto «${s.parte || "(nessun titolo)"}», riga «${s.riga}»`
        : "nessun tag [ICONA:…] valido corrispondente nel testo sorgente";
    } else {
      f.sorgente = "nessuna parte del testo sorgente può produrre questa figura";
    }
  }
}

export function formattaManifest(figure: FiguraDocumento[]): string[] {
  if (figure.length === 0) return ["(nessuna figura nel documento)"];
  return figure.map((f) => {
    const dim = f.dimensioneInDocumento ? `${f.dimensioneInDocumento.w}×${f.dimensioneInDocumento.h}px nel documento` : "dimensione ignota";
    const intr = f.pixelIntrinseci ? `${f.pixelIntrinseci.w}×${f.pixelIntrinseci.h}px intrinseci` : "png non leggibile";
    return [
      `#${f.indice} [${f.tipo}] alt="${f.nomeAlt}" (${f.descrizioneAlt})`,
      `${f.fileMedia.replace("word/media/", "media/")} ${f.byte} byte, ${intr}, ${dim}`,
      f.inTabella ? "in tabella" : "fuori tabella",
      `parte: «${f.parte || "(prima del primo titolo)"}»`,
      `testo vicino: «${f.contestoTesto}»`,
      `sorgente: ${f.sorgente ?? "?"}`,
    ].join(" | ");
  });
}

export function riepilogoFigure(figure: FiguraDocumento[]): string {
  const organigrammi = figure.filter((f) => f.tipo === "organigramma").length;
  const icone = figure.filter((f) => f.tipo === "icona").length;
  const sconosciute = figure.filter((f) => f.tipo === "sconosciuta").length;
  const file = new Set(figure.map((f) => f.fileMedia)).size;
  return `${organigrammi} organigrammi + ${icone} icone${sconosciute ? ` + ${sconosciute} SCONOSCIUTE` : ""} (${file} file media distinti)`;
}

export function verificaFigure(figure: FiguraDocumento[], sorgente: SorgenteFigure): string[] {
  const errori: string[] = [];
  const org = figure.filter((f) => f.tipo === "organigramma");
  const icone = figure.filter((f) => f.tipo === "icona");
  const sconosciute = figure.filter((f) => f.tipo === "sconosciuta");

  if (sconosciute.length > 0) {
    errori.push(
      `Immagini: ${sconosciute.length} figura/e non riconducibile/i né a un organigramma né a un'icona (possibile fotografia o altra figura indebita, R16): ${sconosciute
        .map((f) => `#${f.indice} in «${f.parte || "?"}»`)
        .join("; ")}.`,
    );
  }
  if (org.length !== sorgente.organigrammi.length) {
    errori.push(
      `Immagini: ${org.length} organigramma/i nel documento contro ${sorgente.organigrammi.length} blocco/hi [ORGANIGRAMMA] nel testo sorgente (un blocco non renderizzato o un organigramma in più).`,
    );
  }
  if (icone.length !== sorgente.icone.length) {
    errori.push(
      `Immagini: ${icone.length} icona/e nel documento contro ${sorgente.icone.length} tag [ICONA:nome] validi nel testo sorgente (un tag non convertito o un'icona in più).`,
    );
  } else {
    icone.forEach((f, i) => {
      const atteso = `${PREFISSO_NOME_IMMAGINE_ICONA}${sorgente.icone[i].nome}`;
      if (f.nomeAlt !== atteso) {
        errori.push(
          `Immagini: icona #${f.indice} nel documento è "${f.nomeAlt}" ma il tag sorgente corrispondente (n.${sorgente.icone[i].indice}) è [ICONA:${sorgente.icone[i].nome}] — disallineamento tra testo e documento.`,
        );
      }
    });
  }
  return errori;
}
