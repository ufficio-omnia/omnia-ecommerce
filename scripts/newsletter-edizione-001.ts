// Prima edizione di Tender Weekly (27/11/2026): dal file JSON curato a mano (notizie verificate sulle fonti) produce
//  - supabase/manuali/newsletter_edizione_001.sql: inserimento come BOZZA, da eseguire a mano DOPO la 0141;
//  - (con --anteprima <cartella>) l'HTML e il testo dell'email per controllarli nel browser.
// Il contenuto passa dalla stessa normalizzazione della console. Nessuna scrittura sul database da qui.
import fs from "fs";
import path from "path";
import { normalizzaContenuto, controllaEdizione } from "../src/lib/newsletter/contenuto";
import { renderNewsletterHtml, renderNewsletterTesto } from "../src/lib/newsletter/template";

const radice = path.join(process.cwd(), "supabase", "manuali");
const dati = JSON.parse(fs.readFileSync(path.join(radice, "newsletter_edizione_001.json"), "utf8"));
const contenuto = normalizzaContenuto(dati.contenuto);
const e = { numero: 1, data_edizione: dati.data_edizione, oggetto: dati.oggetto, preheader: dati.preheader, contenuto };
const controllo = controllaEdizione(e);
if (controllo.bloccanti.length) {
  console.error("Edizione non approvabile:", controllo.bloccanti);
  process.exit(1);
}
if (controllo.avvisi.length) console.log("Avvisi:", controllo.avvisi);

const json = JSON.stringify(contenuto);
if (json.includes("$nl001$")) throw new Error("Delimitatore presente nel testo");
const sql = `-- Tender Weekly, edizione n. 001 (27/11/2026). Da eseguire a mano DOPO la migrazione 0141, una volta sola.
-- Inserisce l'edizione come BOZZA: nella console va riletta, provata con l'email di prova, approvata e inviata.
-- Se il numero 1 esiste già (per esempio un'edizione creata dalla console), non inserisce nulla.
insert into public.newsletter_edizioni (numero, stato, data_edizione, oggetto, preheader, contenuto, origine, note_generazione)
values (
  1,
  'bozza',
  '${dati.data_edizione}',
  $nl001$${dati.oggetto}$nl001$,
  $nl001$${dati.preheader}$nl001$,
  $nl001$${json}$nl001$::jsonb,
  'manuale',
  $nl001$Prima edizione preparata durante lo sviluppo (27/11/2026). Notizie verificate sulle fonti indicate; la sezione OMNIA AI News cita gli Uffici Gare fino a tre (online dal 26/11): confermare prima dell'invio.$nl001$
)
on conflict (numero) do nothing;
`;
fs.writeFileSync(path.join(radice, "newsletter_edizione_001.sql"), sql);
console.log("Scritto supabase/manuali/newsletter_edizione_001.sql");

const i = process.argv.indexOf("--anteprima");
if (i > 0) {
  const cartella = process.argv[i + 1];
  const opz = { urlDisiscrizione: "https://omnia-ai.it/newsletter/disiscrizione" };
  fs.writeFileSync(path.join(cartella, "edizione-001.html"), renderNewsletterHtml(e, opz));
  fs.writeFileSync(path.join(cartella, "edizione-001.txt"), renderNewsletterTesto(e, opz));
  console.log(`Anteprima in ${cartella}`);
}
