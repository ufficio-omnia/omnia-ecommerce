// Motore INDIPENDENTE per ricalcolare le formule di un Excel del piano di lavoro (fast-formula-parser) e confrontarle con i valori in
// cache scritti dal nostro codice. Serve alle verifiche gratuite (scripts/verifica-piano-lavoro-omnia-ai.ts) e alle prove sulle gare vere
// (scripts/prova-piano-lavoro-reale.ts): se una formula e il numero calcolato dal codice non coincidono, uno dei due è sbagliato.
import ExcelJS from "exceljs";
import FormulaParser from "fast-formula-parser";

const { FormulaHelpers, Types } = FormulaParser as unknown as { FormulaHelpers: { accept: (x: unknown, t: unknown) => number }; Types: { NUMBER: unknown } };

export type Sovrascritture = Map<string, number | string | null>;

export function vicino(a: number, b: number, tolleranza = 1e-9): boolean {
  return Math.abs(a - b) <= tolleranza * Math.max(1, Math.abs(a), Math.abs(b));
}

export async function caricaCartella(buffer: Buffer): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  return wb;
}

export function ricalcola(wb: ExcelJS.Workbook, sovrascritture: Sovrascritture = new Map()) {
  const memo = new Map<string, unknown>();
  const errori: string[] = [];
  // Il parser della libreria non è rientrante: una formula che rimanda a un'altra formula (valutata dentro onCell)
  // ha bisogno di un'istanza propria. Se ne tiene una per ogni livello di annidamento.
  const parsers: { parse: (formula: string, posizione: { sheet: string; row: number; col: number }) => unknown }[] = [];
  let profondita = 0;
  const parserA = (livello: number) => (parsers[livello] ??= nuovoParser());
  const valore = (foglio: string, riga: number, col: number): unknown => {
    const chiave = `${foglio}!${riga},${col}`;
    if (sovrascritture.has(chiave)) return sovrascritture.get(chiave);
    if (memo.has(chiave)) return memo.get(chiave);
    const ws = wb.getWorksheet(foglio);
    const cella = ws ? ws.getCell(riga, col) : null;
    let v: unknown = cella ? cella.value : null;
    if (v !== null && typeof v === "object" && "formula" in (v as object)) {
      const livello = profondita++;
      try {
        v = parserA(livello).parse((v as { formula: string }).formula, { sheet: foglio, row: riga, col });
      } catch (e) {
        errori.push(`${chiave}: ${(e as Error).message}`);
        v = null;
      } finally {
        profondita--;
      }
    } else if (v !== null && typeof v === "object" && "text" in (v as object)) {
      v = (v as { text: string }).text;
    }
    if (v === undefined) v = null;
    memo.set(chiave, v);
    return v;
  };
  const nuovoParser = () =>
    new FormulaParser({
      onCell: (r: { sheet: string; row: number; col: number }) => valore(r.sheet, r.row, r.col),
      onRange: (r: { sheet: string; from: { row: number; col: number }; to: { row: number; col: number } }) => {
        const righe: unknown[][] = [];
        for (let i = r.from.row; i <= r.to.row; i++) {
          const riga: unknown[] = [];
          for (let j = r.from.col; j <= r.to.col; j++) riga.push(valore(r.sheet, i, j));
          righe.push(riga);
        }
        return righe;
      },
      // MIN non è tra le funzioni della libreria: qui serve solo con valori singoli
      functions: {
        MIN: (...args: unknown[]) => Math.min(...args.map((a) => FormulaHelpers.accept(a, Types.NUMBER))),
        MAX: (...args: unknown[]) => Math.max(...args.map((a) => FormulaHelpers.accept(a, Types.NUMBER))),
      },
    });

  let controllate = 0;
  const differenze: string[] = [];
  for (const ws of wb.worksheets) {
    ws.eachRow((riga, nr) => {
      riga.eachCell((cella, nc) => {
        const v = cella.value;
        if (v === null || typeof v !== "object" || !("formula" in (v as object))) return;
        controllate++;
        const cache = (v as { result?: unknown }).result;
        const ricalcolato = valore(ws.name, nr, nc);
        const nome = `${ws.name}!${cella.address}`;
        // ExcelJS, rileggendo il file, restituisce come «assente» un risultato in cache pari a 0 (nel file c'è: <v>0</v>)
        const vuotoCache = cache === undefined || cache === null || cache === "";
        const vuotoRicalc = ricalcolato === undefined || ricalcolato === null || ricalcolato === "" || ricalcolato === 0;
        if (vuotoCache && vuotoRicalc) return;
        if (typeof cache === "number" && typeof ricalcolato === "number") {
          if (!vicino(cache, ricalcolato)) differenze.push(`${nome}: cache ${cache}, ricalcolato ${ricalcolato}`);
        } else if (cache !== ricalcolato) {
          differenze.push(`${nome}: cache ${JSON.stringify(cache)}, ricalcolato ${JSON.stringify(ricalcolato)}`);
        }
      });
    });
  }
  return { controllate, differenze, errori, valore };
}
