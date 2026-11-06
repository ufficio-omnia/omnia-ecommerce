// Utilità: scrive in un Excel il catalogo di macchinari e attrezzature del piano di lavoro (src/lib/piano-lavoro-catalogo.ts), con le colonne
// vuote per la VALIDAZIONE (prezzo corretto, voce da togliere, note): è il documento da far rivedere a chi conosce il mercato.
//   tsx scripts/genera-catalogo-macchinari.ts <file.xlsx>
import ExcelJS from "exceljs";
import { CATALOGO, type RegolaQuantita } from "../src/lib/piano-lavoro-catalogo";

const NOMI_BASE: Record<string, string> = { fte: "addetti equivalenti", sedi: "sedi", mq: "mq", mqEsterni: "mq di aree esterne" };

const SINGOLARE_BASE: Record<string, string> = { fte: "addetto equivalente", sedi: "sede", mq: "mq", mqEsterni: "mq di aree esterne" };

function testoRegola(r: RegolaQuantita): string {
  if (r.basi.length === 0) return `${r.min} (fissa)`;
  const parti = r.basi.map((b) => (b.fattore !== undefined ? `${b.fattore.toLocaleString("it-IT")} per ${SINGOLARE_BASE[b.su]}` : `1 ogni ${b.ogni?.toLocaleString("it-IT")} ${NOMI_BASE[b.su]}`));
  return `${parti.join(" oppure ")} (il maggiore), da ${r.min} a ${r.max}`;
}

async function main() {
  const file = process.argv[2];
  if (!file) throw new Error("Indica il file di destinazione (.xlsx).");
  const wb = new ExcelJS.Workbook();
  wb.creator = "OMNIA AI";
  const ws = wb.addWorksheet("Catalogo da validare");
  const colonne = [
    ["Voce", 52],
    ["Categoria", 14],
    ["Serve…", 12],
    ["Modello di riferimento (marca)", 40],
    ["Prezzo standard\n(€, IVA esclusa)", 16],
    ["Minimo", 11],
    ["Massimo", 11],
    ["Vita utile\n(mesi)", 11],
    ["Quantità: regola", 48],
    ["Fonte del prezzo", 60],
    ["Rilevato il", 12],
    ["VALIDAZIONE\nPrezzo corretto (€)", 18],
    ["VALIDAZIONE\nVoce da togliere? (SI/NO)", 18],
    ["VALIDAZIONE\nNote", 40],
  ] as const;
  ws.columns = colonne.map(([header, width]) => ({ header, width }));
  const testata = ws.getRow(1);
  testata.height = 42;
  testata.eachCell((c, i) => {
    c.font = { bold: true, color: { argb: "FFFFFFFF" } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: i >= 12 ? "FF2E7D32" : "FF1F3864" } };
    c.alignment = { wrapText: true, vertical: "middle", horizontal: "center" };
  });
  for (const v of CATALOGO) {
    const r = ws.addRow([v.nome, v.categoria, v.quando === "sempre" ? "sempre" : "se serve", v.riferimento || "—", v.prezzo, v.prezzoMin, v.prezzoMax, v.vitaUtileMesi, testoRegola(v.regola), v.fonte, v.rilevatoIl, null, null, null]);
    r.eachCell((c, i) => {
      c.alignment = { wrapText: true, vertical: "top" };
      c.border = { top: { style: "thin" }, left: { style: "thin" }, bottom: { style: "thin" }, right: { style: "thin" } };
      if (i === 5 || i === 6 || i === 7 || i === 12) c.numFmt = "#,##0.00";
      if (i >= 12) c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8F5E9" } };
    });
    r.getCell(13).dataValidation = { type: "list", allowBlank: true, formulae: ['"SI,NO"'] };
  }
  ws.views = [{ state: "frozen", xSplit: 1, ySplit: 1 }];
  await wb.xlsx.writeFile(file);
  console.log(`scritto ${file}: ${CATALOGO.length} voci`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
