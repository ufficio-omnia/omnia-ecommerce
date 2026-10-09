// Disegna le figure di esempio (scripts/lib/figure-esempio.ts) con il
// disegnatore vero e le salva come PNG in test/diagnostica/figure/ (cartella
// ignorata da git), per guardarle a occhio dopo ogni modifica al layout.
// Gratuito: nessuna chiamata a modelli, nessun database.
//
//   npx tsx scripts/disegna-figure-prova.ts [prefisso]      es. "flusso"
//   npx tsx scripts/disegna-figure-prova.ts flusso --font "Times New Roman"
import fs from "fs";
import path from "path";
import { disegnaFigura } from "../src/lib/figura-disegno";
import { tuttiGliEsempiFigure } from "./lib/figure-esempio";

(async () => {
  const argomenti = process.argv.slice(2);
  const indiceFont = argomenti.indexOf("--font");
  const font = indiceFont >= 0 ? argomenti[indiceFont + 1] : null;
  const prefisso = argomenti.find((a, i) => !a.startsWith("--") && !(indiceFont >= 0 && i === indiceFont + 1)) ?? "";
  const cartella = path.join(__dirname, "..", "test", "diagnostica", "figure");
  fs.mkdirSync(cartella, { recursive: true });
  for (const [nome, dati] of Object.entries(tuttiGliEsempiFigure)) {
    if (prefisso && !nome.startsWith(prefisso)) continue;
    const r = await disegnaFigura(dati, { font });
    const file = path.join(cartella, `${nome}${font ? `-${font.replace(/\W+/g, "")}` : ""}.png`);
    fs.writeFileSync(file, r.buffer);
    console.log(`${nome}: ${r.larghezzaPx}x${r.altezzaPx}px (nel documento ${r.width}x${r.height}) → ${file}`);
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
