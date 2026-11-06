import { AlignmentType, BorderStyle, Document, HeadingLevel, Packer, Paragraph, ShadingType, Table, TableCell, TableRow, TextRun, WidthType } from "docx";
import type { Blocco, Dossier } from "@/lib/piano-lavoro-dossier-legale";

// Il Word per il legale, scritto dal contenuto di piano-lavoro-dossier-legale.ts. Separato dallo script per poterlo provare senza scrivere file.

const FONT = "Calibri";
const BORDO = { style: BorderStyle.SINGLE, size: 4, color: "BFBFBF" };

type Stile = { bold?: boolean; italics?: boolean; size?: number; color?: string };

const testo = (t: string, extra: Stile = {}) => new TextRun({ text: t, font: FONT, size: extra.size ?? 22, bold: extra.bold, italics: extra.italics, color: extra.color });

// Un testo con più righe (\n) diventa un paragrafo con ritorni a capo.
function righe(t: string, extra: Stile = {}): TextRun[] {
  return t.split("\n").map((riga, i) => new TextRun({ text: riga, font: FONT, size: extra.size ?? 22, bold: extra.bold, italics: extra.italics, color: extra.color, break: i > 0 ? 1 : undefined }));
}

function blocco(b: Blocco): (Paragraph | Table)[] {
  switch (b.t) {
    case "p":
      return [new Paragraph({ children: righe(b.testo), spacing: { after: 120 } })];
    case "elenco":
      return b.voci.map((v) => new Paragraph({ children: righe(v), bullet: { level: 0 }, spacing: { after: 80 } }));
    case "numerato":
      return b.voci.map((v, i) => new Paragraph({ children: righe(`${i + 1}. ${v}`), indent: { left: 360, hanging: 360 }, spacing: { after: 100 } }));
    case "clausola":
      return [
        new Paragraph({ children: [testo(b.titolo, { bold: true })], spacing: { before: 160, after: 40 }, keepNext: true }),
        new Paragraph({ children: righe(b.testo), spacing: { after: b.nota ? 40 : 120 }, indent: { left: 360 } }),
        ...(b.nota ? [new Paragraph({ children: [testo(b.nota, { italics: true, color: "7F3F00" })], spacing: { after: 120 }, indent: { left: 360 } })] : []),
      ];
    case "domanda":
      return [
        new Paragraph({
          children: [testo("Per il legale: ", { bold: true }), testo(b.testo)],
          shading: { type: ShadingType.CLEAR, fill: "FFF2CC", color: "auto" },
          spacing: { before: 80, after: 160 },
        }),
      ];
    case "deciso":
      return [
        new Paragraph({
          children: [testo("Deciso: ", { bold: true }), testo(b.testo)],
          shading: { type: ShadingType.CLEAR, fill: "E2EFDA", color: "auto" },
          spacing: { before: 80, after: 160 },
        }),
      ];
    case "tabella": {
      const larghezze = b.intestazioni.length === 2 ? [3000, 6000] : [2400, 4300, 2300];
      const cella = (t: string, i: number, intestazione: boolean) =>
        new TableCell({
          width: { size: larghezze[i], type: WidthType.DXA },
          borders: { top: BORDO, bottom: BORDO, left: BORDO, right: BORDO },
          shading: intestazione ? { type: ShadingType.CLEAR, fill: "D9E1F2", color: "auto" } : undefined,
          margins: { top: 60, bottom: 60, left: 100, right: 100 },
          children: [new Paragraph({ children: righe(t, { bold: intestazione, size: 20 }) })],
        });
      return [
        new Table({
          width: { size: larghezze.reduce((a, c) => a + c, 0), type: WidthType.DXA },
          columnWidths: larghezze,
          rows: [new TableRow({ tableHeader: true, children: b.intestazioni.map((t, i) => cella(t, i, true)) }), ...b.righe.map((r) => new TableRow({ children: r.map((t, i) => cella(t, i, false)) }))],
        }),
        new Paragraph({ children: [], spacing: { after: 120 } }),
      ];
    }
  }
}

export async function creaWordDossier(dossier: Dossier): Promise<Buffer> {
  const figli: (Paragraph | Table)[] = [
    new Paragraph({ heading: HeadingLevel.TITLE, children: [testo(dossier.titolo, { bold: true, size: 40 })], spacing: { after: 120 } }),
    new Paragraph({ children: [testo(dossier.sottotitolo, { italics: true, color: "595959" })], spacing: { after: 360 }, alignment: AlignmentType.LEFT }),
  ];
  for (const s of dossier.sezioni) {
    figli.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [testo(s.titolo, { bold: true, size: 28, color: "1F3864" })], spacing: { before: 360, after: 160 }, keepNext: true }));
    for (const b of s.blocchi) figli.push(...blocco(b));
  }
  const documento = new Document({
    creator: "OMNIA AI",
    title: dossier.titolo,
    sections: [{ properties: { page: { margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } } }, children: figli }],
  });
  return Packer.toBuffer(documento);
}
