// Autotest di «Richiedi la demo → calendario» su omnia-ai.it (richiesta dell'utente, 03/11/2026, corretta lo stesso giorno): i
// pulsanti «Richiedi la demo» di home e piani portano direttamente al calendario Google dove il visitatore prenota da sé la demo,
// in una nuova scheda. La voce «Demo» del menu invece porta alla pagina /demo, con il suo modulo di contatto com'era, e DENTRO
// quella pagina c'è il pulsante «Prenota direttamente la demo» verso il calendario.
// Si controlla (nessuna rete, nessun database) che:
//   - il link sia uno solo, quello giusto, e stia in un solo posto del codice;
//   - il componente lo disegni con i soli attributi sicuri (nuova scheda, noopener noreferrer, etichetta per gli screen reader);
//   - i pulsanti di home (in alto e in fondo) e di piani lo usino, e nessuno di essi punti alla pagina /demo;
//   - il menu (desktop e mobile) colleghi «Demo» alla pagina /demo come prima della modifica;
//   - la pagina /demo conservi testo, modulo ed email all'ufficio e abbia il pulsante di prenotazione PRIMA del modulo.
import fs from "fs";
import path from "path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import LinkDemo from "../src/components/omnia-ai/link-demo";
import { LINK_PRENOTA_DEMO } from "../src/lib/omnia-ai-demo-link";

const fallimenti: string[] = [];
function atteso(nome: string, ok: boolean, dettaglio = "") {
  console.log(`${ok ? "ok    " : "FALLITO"} ${nome}${ok ? "" : ` — ${dettaglio}`}`);
  if (!ok) fallimenti.push(nome);
}
const radice = path.join(__dirname, "..");
const leggi = (relativo: string) => fs.readFileSync(path.join(radice, relativo), "utf-8").replace(/\r\n/g, "\n");
function elencoFile(cartella: string, filtro: (n: string) => boolean): string[] {
  const risultato: string[] = [];
  const percorri = (relativo: string) => {
    for (const voce of fs.readdirSync(path.join(radice, relativo), { withFileTypes: true })) {
      const figlio = `${relativo}/${voce.name}`;
      if (voce.isDirectory()) percorri(figlio);
      else if (filtro(voce.name)) risultato.push(figlio);
    }
  };
  percorri(cartella);
  return risultato.sort();
}

function main() {
  console.log("--- Il link ---");
  atteso("è il link del calendario indicato dall'utente", LINK_PRENOTA_DEMO === "https://calendar.app.google/uCs53hNYmtynF9R59", LINK_PRENOTA_DEMO);
  atteso("è un indirizzo https e il dominio è quello del calendario Google", /^https:\/\/calendar\.app\.google\/[A-Za-z0-9]+$/.test(LINK_PRENOTA_DEMO));
  const tutti = elencoFile("src", (n) => /\.(ts|tsx)$/.test(n));
  const conLink = tutti.filter((f) => leggi(f).includes("calendar.app.google"));
  atteso("l'indirizzo compare in UN solo file del codice (unica fonte)", conLink.length === 1 && conLink[0] === "src/lib/omnia-ai-demo-link.ts", conLink.join(", "));

  console.log("\n--- Il componente ---");
  const html = renderToStaticMarkup(createElement(LinkDemo, { testo: "Richiedi la demo", className: "omnia-btn omnia-btn-p", style: { marginTop: 10 } }));
  atteso("punta al calendario", html.includes(`href="${LINK_PRENOTA_DEMO}"`), html);
  atteso("si apre in una nuova scheda, senza dare accesso alla pagina di partenza", html.includes('target="_blank"') && html.includes('rel="noopener noreferrer"'), html);
  atteso("mostra il testo e porta la classe e lo stile del pulsante", html.includes(">Richiedi la demo</a>") && html.includes('class="omnia-btn omnia-btn-p"') && html.includes("margin-top:10px"), html);
  atteso("per gli screen reader dice che si apre in una nuova scheda (e contiene il testo visibile)", html.includes('aria-label="Richiedi la demo (si apre in una nuova scheda)"'), html);
  const htmlSemplice = renderToStaticMarkup(createElement(LinkDemo, { testo: "Prenota direttamente la demo" }));
  atteso("senza classe né stile resta un link semplice con la stessa etichetta accessibile", htmlSemplice.includes(">Prenota direttamente la demo</a>") && htmlSemplice.includes('aria-label="Prenota direttamente la demo (si apre in una nuova scheda)"') && !htmlSemplice.includes("class="), htmlSemplice);
  const sorgenteComponente = leggi("src/components/omnia-ai/link-demo.tsx");
  atteso("il componente prende il link dall'unica fonte", /import \{ LINK_PRENOTA_DEMO \} from "@\/lib\/omnia-ai-demo-link";/.test(sorgenteComponente) && /href=\{LINK_PRENOTA_DEMO\}/.test(sorgenteComponente));
  atteso("il componente passa il clic al link, se chi lo usa ne dà uno", /onClick=\{onClick\}/.test(sorgenteComponente) && /onClick\?: \(\) => void;/.test(sorgenteComponente));

  console.log("\n--- Dove si usa ---");
  const home = leggi("src/app/site-omnia-ai/page.tsx");
  atteso("home, sezione in fondo: «Richiedi la demo» è il link al calendario", /<LinkDemo className="omnia-btn omnia-btn-p" testo="Richiedi la demo" \/>/.test(home) && /import LinkDemo from "@\/components\/omnia-ai\/link-demo";/.test(home));
  const hero = leggi("src/components/omnia-ai/hero-demo.tsx");
  atteso("home, in alto: «Richiedi la demo» è il link al calendario e «Come funziona» resta un link del sito", /<LinkDemo className="omnia-btn omnia-btn-p" testo="Richiedi la demo" \/>/.test(hero) && /<Link className="omnia-btn omnia-btn-s" href="\/come-funziona">/.test(hero));
  const piani = leggi("src/app/site-omnia-ai/piani/piani-vista.tsx");
  atteso("piani: «Richiedi la demo» è il link al calendario, con lo stesso stile di prima", /<LinkDemo\s+className=\{`omnia-btn \$\{!vendita && p\.inEvidenza \? "omnia-btn-p" : "omnia-btn-s"\}`\}\s+testo="Richiedi la demo"\s+style=\{vendita \? \{ marginTop: 10 \} : undefined\}\s*\/>/.test(piani));
  atteso("piani: «Abbonati» resta un link del sito", /<Link className="omnia-btn omnia-btn-p" href=\{`\/abbonati\/\$\{p\.slug\}`\}>/.test(piani));
  console.log("\n--- Il menu: «Demo» porta alla pagina /demo, come prima ---");
  const header = leggi("src/components/omnia-ai/site-header.tsx");
  atteso("la voce «Demo» è un link alla pagina /demo del sito, e le altre voci sono quelle di prima", /\{ href: "\/demo", label: "Demo" \}/.test(header) && /href: "\/come-funziona"/.test(header) && /href: "\/piani"/.test(header) && /href: "\/contatti"/.test(header));
  atteso("il menu non porta direttamente al calendario (nessun LinkDemo, nessun indirizzo del calendario)", !/LinkDemo|calendar|target="_blank"/.test(header));
  atteso("menu desktop e mobile: tutte le voci sono link del sito, quello mobile chiude il menu al clic", /<Link key=\{v\.href\} href=\{v\.href\}>/.test(header) && /<Link key=\{v\.href\} href=\{v\.href\} className="omnia-menu-voce" onClick=\{\(\) => chiudi\(\)\}>/.test(header));

  const CON_DEMO_AMMESSI = new Set(["src/components/omnia-ai/site-header.tsx", "src/app/sitemap.ts"]);
  const SENZA_DEMO = tutti.filter((f) => !/^src\/app\/site-omnia-ai\/demo\//.test(f) && !CON_DEMO_AMMESSI.has(f));
  const ancoraVersoDemo = SENZA_DEMO.filter((f) => /href=["'{`]*\/demo\b|href: "\/demo"|"\/demo"/.test(leggi(f)));
  atteso("i pulsanti «Richiedi la demo» di home e piani non puntano alla pagina /demo: la collega solo il menu (e la mappa del sito)", ancoraVersoDemo.length === 0, ancoraVersoDemo.join(", "));

  console.log("\n--- La pagina /demo: testo e modulo com'erano, più il pulsante di prenotazione ---");
  const paginaDemo = leggi("src/app/site-omnia-ai/demo/page.tsx");
  atteso("il testo della pagina è quello di sempre (titolo, frase, «Rispondiamo entro 24 ore»)", paginaDemo.includes("OMNIA AI: portaci una gara vera. Ti mostriamo cosa esce.") && /Nessuna presentazione preconfezionata: lavoriamo su un bando che ti interessa davvero\.\s*Rispondiamo entro 24 ore\.\s*<\/p>/.test(paginaDemo) && paginaDemo.includes('title: "Richiedi la demo — OMNIA AI"'));
  atteso("il modulo di contatto è nella pagina (una volta sola)", (paginaDemo.match(/<DemoForm \/>/g) ?? []).length === 1 && /import DemoForm from "@\/components\/omnia-ai\/demo-form";/.test(paginaDemo));
  atteso("il pulsante «Prenota direttamente la demo» è nella pagina, con lo stile dei pulsanti principali, ed è il link al calendario", /<LinkDemo className="omnia-btn omnia-btn-p" testo="Prenota direttamente la demo" \/>/.test(paginaDemo) && /import LinkDemo from "@\/components\/omnia-ai\/link-demo";/.test(paginaDemo));
  atteso("il pulsante sta PRIMA del modulo, e una frase dice che in alternativa si può compilare il modulo", paginaDemo.indexOf("<LinkDemo") > 0 && paginaDemo.indexOf("<LinkDemo") < paginaDemo.indexOf("<DemoForm />") && /Oppure compila il modulo qui sotto\./.test(paginaDemo));
  const modulo = leggi("src/components/omnia-ai/demo-form.tsx");
  atteso("il modulo ha ancora i suoi campi, il controllo anti-bot e il pulsante di invio", ["nome", "azienda", "email", "telefono", "settore", "bando"].every((c) => modulo.includes(`name="${c}"`)) && /<TurnstileCampo /.test(modulo) && /useActionState\(requestDemo, initialState\)/.test(modulo) && /Richiedi la demo/.test(modulo));
  atteso("l'azione che invia la richiesta all'ufficio c'è ancora, con il controllo anti-bot", /export async function requestDemo\(/.test(leggi("src/app/actions/omnia-ai-demo.ts")) && /verificaFormUmano\(formData\)/.test(leggi("src/app/actions/omnia-ai-demo.ts")));
  atteso("la pagina /demo è ancora nella mappa del sito (nessun cambio per i motori di ricerca)", /path: "\/demo"/.test(leggi("src/app/sitemap.ts")));

  console.log("\n--- Catena ---");
  atteso("il test è nella catena verifica:livello1", /tsx scripts\/verifica-demo-calendario-omnia-ai\.ts/.test(leggi("package.json")));

  if (fallimenti.length > 0) {
    console.log(`\n${fallimenti.length} controlli falliti:\n- ${fallimenti.join("\n- ")}`);
    process.exit(1);
  }
  console.log("\nTutti i controlli sono andati a buon fine.");
}

main();
