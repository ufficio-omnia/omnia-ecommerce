// Autotest dei pulsanti DEMO e del calendario su omnia-ai.it (richieste dell'utente del 03/11/2026 e del 04/11/2026).
// Percorso attuale: TUTTI i pulsanti «Richiedi la demo» e la voce «Demo» del menu portano al modulo /demo; dopo l'invio del modulo
// (validato e salvato come lead «pending») si apre il calendario Google dove il visitatore prenota. Il calendario NON è raggiungibile
// direttamente da un pulsante del sito: saltare il modulo renderebbe impossibile misurare il costo per demo prenotata.
// Si controlla (nessuna rete, nessun database) che:
//   - il link del calendario sia uno solo, quello giusto, e stia in un solo posto del codice;
//   - il componente lo disegni con i soli attributi sicuri (nuova scheda, noopener noreferrer, etichetta per gli screen reader);
//   - i pulsanti di home (in alto e in fondo), di piani e la voce del menu (desktop e mobile) portino a /demo;
//   - il calendario si apra solo dal modulo, dopo l'esito positivo del server (e col pulsante di riserva);
//   - la pagina /demo abbia il modulo, nessuna scorciatoia verso il calendario, e resti nella mappa del sito.
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
  console.log("--- Il link del calendario ---");
  atteso("è il link del calendario indicato dall'utente", LINK_PRENOTA_DEMO === "https://calendar.app.google/uCs53hNYmtynF9R59", LINK_PRENOTA_DEMO);
  atteso("è un indirizzo https e il dominio è quello del calendario Google", /^https:\/\/calendar\.app\.google\/[A-Za-z0-9]+$/.test(LINK_PRENOTA_DEMO));
  const tutti = elencoFile("src", (n) => /\.(ts|tsx)$/.test(n));
  const conLink = tutti.filter((f) => leggi(f).includes("calendar.app.google"));
  atteso("l'indirizzo compare in UN solo file del codice (unica fonte)", conLink.length === 1 && conLink[0] === "src/lib/omnia-ai-demo-link.ts", conLink.join(", "));

  console.log("\n--- Il componente ---");
  const html = renderToStaticMarkup(createElement(LinkDemo, { testo: "Apri il calendario", className: "omnia-btn omnia-btn-p", style: { marginTop: 10 } }));
  atteso("punta al calendario", html.includes(`href="${LINK_PRENOTA_DEMO}"`), html);
  atteso("si apre in una nuova scheda, senza dare accesso alla pagina di partenza", html.includes('target="_blank"') && html.includes('rel="noopener noreferrer"'), html);
  atteso("mostra il testo e porta la classe e lo stile del pulsante", html.includes(">Apri il calendario</a>") && html.includes('class="omnia-btn omnia-btn-p"') && html.includes("margin-top:10px"), html);
  atteso("per gli screen reader dice che si apre in una nuova scheda (e contiene il testo visibile)", html.includes('aria-label="Apri il calendario (si apre in una nuova scheda)"'), html);
  const htmlSemplice = renderToStaticMarkup(createElement(LinkDemo, { testo: "Prenota" }));
  atteso("senza classe né stile resta un link semplice con la stessa etichetta accessibile", htmlSemplice.includes(">Prenota</a>") && htmlSemplice.includes('aria-label="Prenota (si apre in una nuova scheda)"') && !htmlSemplice.includes("class="), htmlSemplice);
  const sorgenteComponente = leggi("src/components/omnia-ai/link-demo.tsx");
  atteso("il componente prende il link dall'unica fonte", /import \{ LINK_PRENOTA_DEMO \} from "@\/lib\/omnia-ai-demo-link";/.test(sorgenteComponente) && /href=\{LINK_PRENOTA_DEMO\}/.test(sorgenteComponente));
  atteso("il componente passa il clic al link, se chi lo usa ne dà uno", /onClick=\{onClick\}/.test(sorgenteComponente) && /onClick\?: \(\) => void;/.test(sorgenteComponente));

  console.log("\n--- Tutti i pulsanti DEMO portano al modulo /demo ---");
  const home = leggi("src/app/site-omnia-ai/page.tsx");
  atteso("home, sezione in fondo: «Richiedi la demo» è un link alla pagina /demo", /<Link className="omnia-btn omnia-btn-p" href="\/demo">\s*Richiedi la demo\s*<\/Link>/.test(home));
  const hero = leggi("src/components/omnia-ai/hero-demo.tsx");
  atteso("home, in alto: «Richiedi la demo» è un link alla pagina /demo e «Come funziona» resta un link del sito", /<Link className="omnia-btn omnia-btn-p" href="\/demo">\s*Richiedi la demo\s*<\/Link>/.test(hero) && /<Link className="omnia-btn omnia-btn-s" href="\/come-funziona">/.test(hero));
  const piani = leggi("src/app/site-omnia-ai/piani/piani-vista.tsx");
  atteso("piani: «Richiedi la demo» è un link alla pagina /demo, con lo stile di prima", /<Link\s+className=\{`omnia-btn \$\{!vendita && p\.inEvidenza \? "omnia-btn-p" : "omnia-btn-s"\}`\}\s+href="\/demo"\s+style=\{vendita \? \{ marginTop: 10 \} : undefined\}\s*>\s*Richiedi la demo\s*<\/Link>/.test(piani));
  atteso("piani: «Abbonati» resta un link del sito", /<Link className="omnia-btn omnia-btn-p" href=\{`\/abbonati\/\$\{p\.slug\}`\}>/.test(piani));
  const header = leggi("src/components/omnia-ai/site-header.tsx");
  atteso("menu: la voce «Demo» è un link alla pagina /demo, e le altre voci sono quelle di prima", /\{ href: "\/demo", label: "Demo" \}/.test(header) && /href: "\/come-funziona"/.test(header) && /href: "\/piani"/.test(header) && /href: "\/contatti"/.test(header));
  atteso("menu desktop e mobile: tutte le voci sono link del sito, quello mobile chiude il menu al clic, nessuna va al calendario", /<Link key=\{v\.href\} href=\{v\.href\}>/.test(header) && /<Link key=\{v\.href\} href=\{v\.href\} className="omnia-menu-voce" onClick=\{\(\) => chiudi\(\)\}>/.test(header) && !/LinkDemo|calendar|target="_blank"/.test(header));
  const conLinkDemo = tutti.filter((f) => f !== "src/components/omnia-ai/link-demo.tsx" && /LinkDemo/.test(leggi(f)));
  atteso("nessun pulsante porta direttamente al calendario: il componente del calendario è usato solo dal modulo", uguali(conLinkDemo, ["src/components/omnia-ai/demo-form.tsx"]), conLinkDemo.join(", "));

  console.log("\n--- La pagina /demo e il modulo ---");
  const paginaDemo = leggi("src/app/site-omnia-ai/demo/page.tsx");
  atteso("la pagina ha il titolo di sempre e il modulo (una volta sola), senza scorciatoie verso il calendario", paginaDemo.includes("OMNIA AI: portaci una gara vera. Ti mostriamo cosa esce</h1>") && paginaDemo.includes('title: "Richiedi la demo — OMNIA AI"') && (paginaDemo.match(/<DemoForm \/>/g) ?? []).length === 1 && !/LinkDemo|calendar\.app|Prenota direttamente/.test(paginaDemo));
  atteso("la frase della pagina spiega il percorso: dati, poi giorno e ora nel calendario (non più «rispondiamo entro 24 ore»)", /Lasciaci i tuoi dati e scegli subito giorno e ora della demo nel calendario\./.test(paginaDemo) && !/Rispondiamo entro 24 ore/.test(paginaDemo));
  const modulo = leggi("src/components/omnia-ai/demo-form.tsx");
  atteso("il calendario si apre dal modulo solo dopo l'esito positivo del server, con il pulsante di riserva se la scheda è bloccata", modulo.indexOf("if (scheda) scheda.location.href = LINK_PRENOTA_DEMO") > modulo.indexOf("if (!risposta.ok)") && /<LinkDemo className="omnia-btn omnia-btn-p" testo="Apri il calendario e scegli l'orario" \/>/.test(modulo) && /CONTINUA E PRENOTA LA DEMO/.test(modulo));
  atteso("la pagina /demo è nella mappa del sito", /path: "\/demo"/.test(leggi("src/app/sitemap.ts")));
  atteso("l'azione che riceve il modulo è quella nuova, con il controllo anti-bot", /export async function inviaRichiestaDemo\(/.test(leggi("src/app/actions/omnia-ai-demo.ts")) && /verificaFormUmano\(formData\)/.test(leggi("src/app/actions/omnia-ai-demo.ts")));

  console.log("\n--- Catena ---");
  atteso("il test è nella catena verifica:livello1", /tsx scripts\/verifica-demo-calendario-omnia-ai\.ts/.test(leggi("package.json")));

  if (fallimenti.length > 0) {
    console.log(`\n${fallimenti.length} controlli falliti:\n- ${fallimenti.join("\n- ")}`);
    process.exit(1);
  }
  console.log("\nTutti i controlli sono andati a buon fine.");
}

function uguali(a: unknown, b: unknown) {
  return JSON.stringify(a) === JSON.stringify(b);
}

main();
