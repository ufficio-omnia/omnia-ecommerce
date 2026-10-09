// Disegna gli organigrammi di esempio (scripts/lib/organigrammi-esempio.ts)
// con il disegnatore vero e li salva come PNG in test/diagnostica/organigrammi/
// (cartella ignorata da git), per guardarli a occhio dopo ogni modifica al
// layout. Gratuito: nessuna chiamata a modelli, nessun database.
//
//   npx tsx scripts/disegna-organigrammi-prova.ts
import fs from "fs";
import path from "path";
import { disegnaOrganigramma } from "../src/lib/organigramma-disegno";
import { tuttiGliEsempi } from "./lib/organigrammi-esempio";

(async () => {
  const cartella = path.join(__dirname, "..", "test", "diagnostica", "organigrammi");
  fs.mkdirSync(cartella, { recursive: true });
  for (const [nome, dati] of Object.entries(tuttiGliEsempi)) {
    const r = await disegnaOrganigramma(dati);
    fs.writeFileSync(path.join(cartella, `${nome}.png`), r.buffer);
    console.log(`${nome}: ${r.larghezzaPx}x${r.altezzaPx}px (nel documento ${r.width}x${r.height})`);
  }
  console.log(`\nImmagini in ${cartella}`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
