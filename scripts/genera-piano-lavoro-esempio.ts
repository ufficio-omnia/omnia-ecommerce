// Utilità di sviluppo: scrive in una cartella due Excel d'esempio del piano di lavoro (dai dati di prova di
// test/fixtures/piano-lavoro-milanosport.json e un piano sintetico), da aprire in Excel per controllarne l'aspetto.
//   tsx scripts/genera-piano-lavoro-esempio.ts <cartella>
import fs from "fs";
import path from "path";
import { normalizzaPianoLavoro } from "../src/lib/piano-lavoro-dati";
import { costruisciExcelPianoLavoro } from "../src/lib/piano-lavoro-excel";

async function main() {
  const cartella = process.argv[2];
  if (!cartella) throw new Error("Indica la cartella di destinazione.");
  fs.mkdirSync(cartella, { recursive: true });
  const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "test", "fixtures", "piano-lavoro-milanosport.json"), "utf-8")) as { dati: unknown };
  const { dati } = normalizzaPianoLavoro(fixture.dati);
  const { buffer, risultato } = await costruisciExcelPianoLavoro(dati, { generatoIl: new Date() });
  const file = path.join(cartella, "Esempio-Piano-di-Lavoro-Milanosport.xlsx");
  fs.writeFileSync(file, buffer);
  console.log(`scritto ${file}: ${risultato.oreTotali.toFixed(1)} ore/anno, ${risultato.fte.toFixed(1)} FTE, ${buffer.length} byte`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
