// Autotest dell'estratto del registro degli accessi in PDF e del suo invio al cliente (src/lib/console/accessi-dati-*.ts).
//
// Nasce dal 19/11/2026: l'estratto esisteva solo come pagina stampata dal browser, che tagliava la colonna «Motivo», e al
// cliente non arrivava nulla. Qui si prova che il PDF si genera, che nessuna riga di testo esce dalla sua cella, che la tabella
// lunga passa alle pagine successive, che l'email non lascia passare HTML scritto a mano e che i collegamenti nel codice ci
// sono (casella nel modulo, niente email per gli accessi a tutti i clienti, pulsanti nella pagina).
// Gratuito, nessun database né rete né email: gira nel livello 1, quindi in prebuild.
import fs from "fs";
import path from "path";
import { PDFDocument } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { aCapo, creaPdfEstrattoAccessi } from "../src/lib/console/accessi-dati-pdf";
import { emailClienteEstrattoAccessi } from "../src/lib/console/accessi-dati-email-calcoli";
import { nomeFilePdfEstratto, type RigaAccesso } from "../src/lib/console/accessi-dati-calcoli";

const fallimenti: string[] = [];
function atteso(nome: string, ok: boolean, dettaglio = "") {
  console.log(`${ok ? "ok    " : "FALLITO"} ${nome}${ok ? "" : ` — ${dettaglio}`}`);
  if (!ok) fallimenti.push(nome);
}
const leggi = (relativo: string) => fs.readFileSync(path.join(__dirname, "..", relativo), "utf-8").replace(/\r\n/g, "\n");

const riga = (i: number, motivo: string, tutti = false): RigaAccesso => ({
  id: String(i),
  creatoIl: "2026-11-19T13:33:20Z",
  accessoIl: "2026-11-19T13:00:00Z",
  operatoreEmail: "ufficio@esempio.it",
  clienteId: "c",
  clienteEmail: "cliente@esempio.it",
  tuttiIClienti: tutti,
  caso: "manutenzione_sicurezza",
  motivo,
  ambito: "LETTURA DEI DATI DELLA GARA (COMUNE DI ESEMPIO)",
  garaId: null,
});

async function main() {
  console.log("--- Testo a capo nelle celle ---");
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(fs.readFileSync(path.join(__dirname, "..", "src/assets/fonts/LiberationSans-Regular.ttf")));
  const lungo = "ERRORE ANALISI ESTRAZIONE DATI DI GARA - ERRORE RIENTRATO DOPO LA CORREZIONE DEL SALVATAGGIO ".repeat(4);
  const righe = aCapo(lungo, font, 9, 150);
  atteso("un testo lungo va su più righe", righe.length > 3, `${righe.length} righe`);
  atteso("nessuna riga è più larga della cella", righe.every((r) => font.widthOfTextAtSize(r, 9) <= 150), righe.find((r) => font.widthOfTextAtSize(r, 9) > 150) ?? "");
  const parolone = aCapo("indirizzo-lunghissimo-senza-spazi@dominio-molto-lungo-di-esempio.it", font, 9, 60);
  atteso("una parola più lunga della cella si spezza invece di uscire", parolone.length > 1 && parolone.every((r) => font.widthOfTextAtSize(r, 9) <= 60), JSON.stringify(parolone));
  atteso("nessun carattere perso spezzando", parolone.join("") === "indirizzo-lunghissimo-senza-spazi@dominio-molto-lungo-di-esempio.it");
  atteso("a capo e tabulazioni del motivo diventano spazi", aCapo("riga uno\nriga\tdue", font, 9, 500).join(" ") === "riga uno riga due");
  atteso("testo vuoto: una riga vuota, nessun errore", JSON.stringify(aCapo("", font, 9, 100)) === '[""]');

  console.log("--- PDF ---");
  const base = { cliente: { email: "cliente@esempio.it" }, periodo: { da: null, a: null }, emessoIl: new Date("2026-11-19T13:35:27Z"), operatore: "ufficio@esempio.it" };
  const uno = await creaPdfEstrattoAccessi({ ...base, righe: [riga(1, lungo)] });
  atteso("il PDF si genera ed è un PDF", Buffer.from(uno).subarray(0, 5).toString() === "%PDF-");
  atteso("un accesso con motivo lungo: una pagina", (await PDFDocument.load(uno)).getPageCount() === 1);
  const orizzontale = (await PDFDocument.load(uno)).getPage(0).getSize();
  atteso("foglio A4 orizzontale", Math.round(orizzontale.width) === 842 && Math.round(orizzontale.height) === 595, JSON.stringify(orizzontale));
  const molte = await creaPdfEstrattoAccessi({ ...base, righe: Array.from({ length: 30 }, (_, i) => riga(i, i % 2 ? "breve" : lungo, i % 5 === 0)) });
  atteso("trenta accessi: più pagine, nessun errore", (await PDFDocument.load(molte)).getPageCount() > 1);
  const zero = await creaPdfEstrattoAccessi({ ...base, righe: [] });
  atteso("nessun accesso: il PDF si genera lo stesso (dice «nessun accesso»)", (await PDFDocument.load(zero)).getPageCount() === 1);
  const strani = await creaPdfEstrattoAccessi({ ...base, cliente: { email: null }, righe: [riga(1, "accenti àèìòù «» — e simboli € ° ’ “ ”")] });
  atteso("accenti, virgolette e cliente senza email: nessun errore", (await PDFDocument.load(strani)).getPageCount() === 1);
  atteso("nome del file con il giorno di Roma", nomeFilePdfEstratto(new Date("2026-11-19T23:30:00Z")) === "estratto-accessi-OMNIA-AI-2026-11-20.pdf", nomeFilePdfEstratto(new Date("2026-11-19T23:30:00Z")));

  console.log("--- Email al cliente ---");
  const nuova = emailClienteEstrattoAccessi({ occasione: "nuovo_accesso", accesso: { accessoIl: new Date("2026-11-19T13:00:00Z"), caso: "manutenzione_sicurezza", ambito: "<b>gara</b>", motivo: "<script>alert(1)</script>" } });
  atteso("HTML scritto nel motivo non passa", !nuova.html.includes("<script>") && nuova.html.includes("&lt;script&gt;"));
  atteso("HTML scritto nell'ambito non passa", !nuova.html.includes("<b>gara</b>"));
  atteso("dice data, caso e che c'è il PDF in allegato", nuova.html.includes("19/11/2026, 14:00") && nuova.html.includes("c) Manutenzione") && nuova.html.includes("In allegato"));
  atteso("oggetto con OMNIA AI", nuova.oggetto.startsWith("OMNIA AI"));
  const richiesta = emailClienteEstrattoAccessi({ occasione: "su_richiesta" });
  atteso("su richiesta: testo dell'estratto, senza dati di un accesso", richiesta.html.includes("In allegato") && !richiesta.html.includes("Motivo"));

  console.log("--- Collegamenti nel codice ---");
  const azione = leggi("src/app/site-console/azioni/accessi-dati.ts");
  const modulo = leggi("src/app/site-console/_componenti/accessi-dati-vista.tsx");
  const pagina = leggi("src/app/site-console/_componenti/estratto-accessi-vista.tsx");
  atteso("la casella del modulo e l'azione usano lo stesso nome e valore", modulo.includes('name="invia_estratto" value="si"') && azione.includes('formData.get("invia_estratto") === "si"'));
  // Regola dell'utente (19/11/2026): l'estratto al cliente parte SOLO se l'amministratore lo sceglie, mai in automatico.
  const casella = modulo.match(/<input[^>]*name="invia_estratto"[^>]*\/>/)?.[0] ?? "";
  atteso("la casella di invio NON è spuntata di partenza", casella !== "" && !/defaultChecked|checked/.test(casella), casella);
  atteso("l'invio dipende solo dalla casella (nessun altro invio nell'azione di registrazione)", (azione.slice(0, azione.indexOf("export async function inviaEstrattoAlCliente")).match(/inviaEstrattoAccessi\(/g) ?? []).length === 1);
  atteso("nessuna email per un accesso a tutti i clienti", /if \(!v\.tuttiIClienti && cliente && formData\.get\("invia_estratto"\)/.test(azione));
  atteso("l'invio avviene DOPO la registrazione (mai email per un accesso non registrato)", azione.indexOf("inviaEstrattoAccessi({") > azione.indexOf('.from("omnia_ai_accessi_dati")'));
  atteso("pagina dell'estratto: Scarica PDF e Invia al cliente", pagina.includes("percorsoPdf") && pagina.includes("inviaEstrattoAlCliente"));
  atteso("pagina e PDF usano la stessa nota", pagina.includes("{NOTA_ESTRATTO}"));
  atteso("la rotta del PDF richiede l'amministratore", leggi("src/app/site-console/(app)/accessi-dati/estratto/[cliente]/pdf/route.ts").includes("await richiediAdminPagina()"));
  atteso("la stampa dal browser non taglia più la tabella", /@media print[\s\S]*\.cn-scorri \{\s*overflow: visible/.test(leggi("src/app/site-console/console.css")));

  console.log("");
  if (fallimenti.length > 0) {
    console.error(`${fallimenti.length} controlli falliti:\n - ${fallimenti.join("\n - ")}`);
    process.exit(1);
  }
  console.log("Tutti i controlli sono andati a buon fine.");
}

main();
