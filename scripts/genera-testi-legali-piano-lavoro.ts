// Crea il Word «Piano di lavoro: testi da sottoporre al legale» (npm run testi-legali:piano-lavoro).
// Il contenuto viene dalle stesse fonti del programma (src/lib/piano-lavoro-dossier-legale.ts): rigenerandolo il documento non può dire cose
// diverse dal prodotto. Va in test/diagnostica/piano-lavoro/ (cartella locale, non nel repository).
import fs from "fs";
import path from "path";
import { costruisciDossier } from "../src/lib/piano-lavoro-dossier-legale";
import { creaWordDossier } from "../src/lib/piano-lavoro-dossier-word";

async function main() {
  const dossier = costruisciDossier(new Date());
  const buffer = await creaWordDossier(dossier);
  const cartella = path.join(__dirname, "..", "test", "diagnostica", "piano-lavoro");
  fs.mkdirSync(cartella, { recursive: true });
  const file = path.join(cartella, "Piano-di-lavoro-testi-per-il-legale.docx");
  fs.writeFileSync(file, buffer);
  console.log(`Creato ${file} (${Math.round(buffer.length / 1024)} KB, ${dossier.sezioni.length} sezioni)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
