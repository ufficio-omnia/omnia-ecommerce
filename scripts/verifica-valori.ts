// Autotest della guardia R9 sui valori numerici senza riscontro (gratuito,
// nessun modello, nessun DB): gira insieme al livello 1 (npm run
// verifica:livello1, quindi in prebuild).
//
// I casi riprendono quelli reali emersi dal livello 2 su una gara di
// riferimento: una quota del 65% di prodotti Ecolabel scritta come fatto,
// "oltre 300 cicli di lavaggio" per la microfibra, un organico di 21 unità
// che è 8 dipendenti + 13 di personale uscente (derivato, non inventato). Un
// controllo che non si è mai visto fallire non dimostra niente: qui si prova
// anche cosa NON deve toccare (riferimenti normativi, impegni di servizio,
// dati di gara, valori già marcati, valori confermati dal cliente).
import fs from "fs";
import path from "path";
import { buildDocxBuffer } from "../src/lib/docx-generator";
import { REGOLE_OMNIA } from "../src/lib/prompts";
import {
  NOTA_VALORI_PROPOSTI,
  applicaGuardiaValori,
  modificaSicura,
  costruisciEvidenza,
  indicizzaEvidenza,
  testoValoriPerModello,
  trovaValoriSenzaRiscontro,
  type EvidenzaDati,
} from "../src/lib/valori-impresa";
import { estraiTestiPerNodo, estraiTestiVisibili } from "./lib/xml-word";
import { trovaMarcatoriResidui } from "./lib/controlli-relazione";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const JSZip = require("jszip");

const fallimenti: string[] = [];
function atteso(nome: string, ok: boolean, dettaglio = "") {
  console.log(`${ok ? "ok    " : "FALLITO"} ${nome}${ok ? "" : ` — ${dettaglio}`}`);
  if (!ok) fallimenti.push(nome);
}

const radice = path.join(__dirname, "..");
const leggi = (relativo: string) => fs.readFileSync(path.join(radice, relativo), "utf-8").replace(/\r\n/g, "\n");

// Evidenza sintetica, con la stessa forma di una gara reale: 8 dipendenti nel
// profilo, 13 addetti di personale uscente (una riga per addetto, come
// nell'estrazione reale), documenti di gara con i loro numeri.
const EVIDENZA: EvidenzaDati = costruisciEvidenza({
  profilo: {
    numero_dipendenti: 8,
    certificazioni: "UNI EN ISO 9001:2015, UNI EN ISO 14001:2015",
    presentazione: "Impresa di pulizie attiva dal 2009 con 8 dipendenti e una lavasciuga di proprietà.",
  },
  gara: {
    importo: 480000,
    sedi: [
      { denominazione: "SEDE MUNICIPIO", superficie_mq: 2400, orari_apertura: "8-18", frequenze: "giornaliera" },
      { denominazione: "BIBLIOTECA", superficie_mq: 900, orari_apertura: "9-19", frequenze: "tre volte a settimana" },
    ],
    personale_uscente: Array.from({ length: 13 }, (_, i) => ({ livello_contrattuale: `livello ${(i % 3) + 1}`, numero_addetti: 1, ore_settimanali: 20 })),
    criteri_valutazione: "1.1 Organizzazione - max 30 punti. Utilizzo di prodotti con etichetta Ecolabel UE per almeno il 50% del totale.",
  },
  testiDocumenti: [
    "Art. 13.4 CSA: carta tessuto Ecolabel, quota non inferiore al 50% del totale dei prodotti. Il Decreto 2009/568/CE e il D.Lgs. 36/2023 si applicano alla fornitura.",
    "Le lavasciuga devono garantire una resa di 1.500 mq/h e una rumorosità non superiore a 65 dB(A). Interventi urgenti entro 4 ore. Il CAM 2021 prevede la formazione del personale.",
    "Il concorrente dichiari l'organico dedicato. Sono previsti 24 ore su 24 gli interventi di emergenza e 2 volte a settimana la verifica dei servizi igienici.",
  ],
  messaggiCliente: ["Possiamo mettere a disposizione 4 aspirapolvere a zaino e 2 monospazzola per questa commessa."],
});
const INDICE = indicizzaEvidenza(EVIDENZA);
const guardia = (testo: string) => applicaGuardiaValori(testo, EVIDENZA, INDICE);

async function main() {
// --- 1. Valori senza riscontro: marcati con asterisco ---
const DA_MARCARE: [string, string, string][] = [
  ["quota del 65% di prodotti Ecolabel (caso reale)", "Si impiega una gamma di prodotti con una quota di prodotti con etichettatura Ecolabel UE pari al 65% del totale.", "65% *"],
  ["oltre 300 cicli di lavaggio (caso reale)", "I panni in microfibra sono riutilizzabili per oltre 300 cicli di lavaggio.", "300 cicli di lavaggio *"],
  ["numero di lavasciuga non confermato", "Il servizio è svolto con una dotazione di 3 lavasciuga a batteria.", "3 lavasciuga *"],
  ["organico proposto non derivato", "Il presidio è affidato a un team di 5 caposquadra.", "5 caposquadra *"],
  ["prestazione di una macchina", "L'aspiratore garantisce una rumorosità di 58 dB(A) in esercizio.", "58 dB(A) *"],
  ["valore in grassetto", "La quota di prodotti certificati è del **72%** del totale.", "**72%** *"],
  ["voce di elenco", "- Dotazione: 6 monospazzola a disco per le aree grandi.", "6 monospazzola *"],
  ["in cella di tabella", "| [C]Lavasciuga a batteria | [C]2.200 mq/h |", "2.200 mq/h *"],
  ["in cella con grassetto e tag", "| [C]Aspiratore | [C]**61 dB(A)** |", "**61 dB(A)** *"],
  ["riduzione dei consumi proposta", "Il piano prevede una riduzione del 18% dei consumi di detergente.", "18% *"],
];
for (const [nome, testo, atteso_] of DA_MARCARE) {
  const prima = trovaValoriSenzaRiscontro(testo, EVIDENZA, INDICE);
  const esito = guardia(testo);
  const dopo = trovaValoriSenzaRiscontro(esito.testo, EVIDENZA, INDICE);
  atteso(`rilevato senza riscontro: ${nome}`, prima.length >= 1, "nessun valore rilevato");
  atteso(`marcato con asterisco: ${nome}`, esito.testo.includes(atteso_) && esito.marcati.length >= 1, esito.testo);
  atteso(`dopo la guardia non resta nulla da marcare: ${nome}`, dopo.length === 0, dopo.map((d) => d.valore).join(", "));
}

// --- 2. Cosa NON va toccato ---
const NON_TOCCARE: [string, string][] = [
  ["quota confermata dai documenti di gara", "Almeno il 50% del totale dei prodotti è con etichetta Ecolabel UE."],
  ["resa della lavasciuga dal capitolato", "Le lavasciuga garantiscono 1.500 mq/h come richiesto dal capitolato."],
  ["dipendenti dal profilo", "L'impresa impiega 8 dipendenti sul servizio."],
  ["personale uscente dai dati di gara", "Si assorbono 13 unità di personale uscente."],
  ["attrezzature confermate dal cliente in chat", "Per la commessa sono dedicati 4 aspirapolver a zaino e 2 monospazzola."],
  ["valore già marcato in un paragrafo", "Il monte ore proposto è di **150 ore settimanali** *, distribuito sulle sedi."],
  ["valore già marcato in una cella", "| [C]Lavasciuga | [C]3 lavasciuga * |"],
  ["segnaposto da confermare", "Il numero è [DATO DA CONFERMARE: 4 lavasciuga a batteria]."],
  ["riferimento a un articolo", "Come previsto dall'art. 13.4 del CSA e dal punto 3 del disciplinare."],
  ["norma UNI EN ISO", "L'impresa è certificata UNI EN ISO 14001 e UNI EN ISO 9001:2015."],
  ["decreto e anno", "In conformità al D.Lgs. 36/2023 e ai CAM 2021."],
  ["classe Euro 6", "I mezzi sono di classe Euro 6."],
  ["tempo di intervento (impegno di servizio)", "Gli interventi urgenti sono presi in carico entro 8 ore dalla segnalazione."],
  ["frequenza (impegno di servizio)", "La verifica dei servizi igienici è svolta 3 volte a settimana, ogni 2 mesi si fa un controllo generale."],
  ["reperibilità 24 ore su 24", "È garantita la reperibilità 24 ore su 24, 7 giorni su 7."],
  ["data", "Il servizio decorre dal 01/03/2026."],
  ["titolo", "## 1.2 Dotazione di 5 macchine"],
  ["note esplicative con asterisco", "*Valori proposti dall'impresa, da confermare."],
  ["organigramma", "[ORGANIGRAMMA]\nResponsabile {LIVELLO:Governo}\n  5 Operatori {LIVELLO:Operativo}\n[/ORGANIGRAMMA]"],
];
for (const [nome, testo] of NON_TOCCARE) {
  const esito = guardia(testo);
  atteso(`non toccato: ${nome}`, esito.testo === testo && esito.marcati.length === 0, esito.testo);
}

// --- 3. Valori derivati: riconosciuti, dichiarati, non marcati ---
{
  const conComponenti = "Il piano è dimensionato su un organico complessivo di 21 unità (8 risorse stabili dell'impresa e 13 unità di personale uscente).";
  const esito = guardia(conComponenti);
  atteso("derivato con componenti già nel testo: non marcato e non modificato", esito.testo === conComponenti && esito.marcati.length === 0, esito.testo);
  atteso("derivato: dichiarato con l'indicazione di come è ottenuto", esito.derivati.length === 1 && /8 dipendenti dell'impresa \+ 13 unità di personale uscente/.test(esito.derivati[0].derivazione) && esito.derivati[0].dichiaratoNelTesto, JSON.stringify(esito.derivati));

  const senzaComponenti = "L'organico complessivo dedicato alla commessa è di 21 unità, dislocate sulle sedi.";
  const esito2 = guardia(senzaComponenti);
  atteso(
    "derivato senza componenti nel testo: la guardia aggiunge come è stato ottenuto, senza asterisco",
    /21 unità \(8 dipendenti dell'impresa \+ 13 unità di personale uscente\), dislocate/.test(esito2.testo) && esito2.marcati.length === 0 && !esito2.derivati[0].dichiaratoNelTesto,
    esito2.testo,
  );

  const cella = guardia("| [C]Organico complessivo | [C]21 unità |");
  atteso("derivato in una cella: indicata la derivazione, nessun asterisco", /21 unità \(8 dipendenti dell'impresa \+ 13 unità di personale uscente\)/.test(cella.testo) && !/\*/.test(cella.testo), cella.testo);

  const altro = guardia("L'organico complessivo dedicato è di 22 unità.");
  atteso("somma che non corrisponde ai dati noti (22 ≠ 8 + 13): è un valore inventato, marcato", altro.derivati.length === 0 && altro.marcati.length === 1 && /22 unità \*/.test(altro.testo), altro.testo);

  const soloUscente = guardia("Si assorbono 13 unità di personale uscente e 8 dipendenti.");
  atteso("dati noti citati singolarmente: nessuna modifica", soloUscente.testo === "Si assorbono 13 unità di personale uscente e 8 dipendenti.", soloUscente.testo);
}

// --- 4. Nota, idempotenza, struttura ---
{
  const testo = "Prima riga.\n\nUna quota del 65% di prodotti Ecolabel e 300 cicli di lavaggio.\n\n| A | B |\n|---|---|\n| [C]x | [C]9 lavasciuga |";
  const una = guardia(testo);
  const due = guardia(una.testo);
  atteso("nota esplicativa aggiunta una sola volta", una.notaAggiunta && una.testo.split(NOTA_VALORI_PROPOSTI).length === 2, una.testo);
  atteso("idempotente: una seconda applicazione non cambia nulla", due.testo === una.testo && due.marcati.length === 0 && !due.notaAggiunta, due.testo);
  const celle = (s: string) => s.split("\n").filter((r) => r.startsWith("|") && !/^\|[-\s|]+\|$/.test(r)).map((r) => r.split("|").length);
  atteso("tabella: stesso numero di celle per riga dopo la guardia", JSON.stringify(celle(una.testo)) === JSON.stringify(celle(testo)), una.testo);
  const conNota = guardia("Dato.\n\n*Valori proposti dall'impresa, da confermare.\n\nCon 6 monospazzola.");
  atteso("se la nota c'è già non se ne aggiunge un'altra", !conNota.notaAggiunta && conNota.testo.split("Valori proposti").length === 2, conNota.testo);
  atteso("testo senza valori da marcare: nessuna nota", !guardia("Solo testo, senza numeri.").notaAggiunta, "");
  const bold = guardia("Il **quantitativo di 30 lavasciuga professionali** è dedicato.");
  atteso("asterisco mai dentro un tratto in grassetto", /\*\*quantitativo di 30 lavasciuga professionali\*\* \*/.test(bold.testo) || /30 lavasciuga \*/.test(bold.testo) && !/lavasciuga \* professionali\*\*/.test(bold.testo), bold.testo);
}

// --- 4-bis. Marcatori scritti dal modello e dalla verifica AI: riconosciuti, mai raddoppiati ---
// Forme reali emerse da un livello 2: l'asterisco con escape DENTRO il
// grassetto ("**65%\***"). Non riconoscerlo faceva aggiungere un secondo
// asterisco che spezzava il grassetto (un "**" letterale nel Word) e lasciava
// il valore "senza asterisco" agli occhi del controllo finale.
{
  const giaMarcati: [string, string][] = [
    ["asterisco con escape dentro il grassetto", "Una gamma di prodotti con una quota pari al **65%\\*** del totale, in possesso dell'etichetta Ecolabel UE."],
    ["due valori marcati nella stessa riga", "La quota di prodotti Ecolabel è del **65%\\*** del totale; per la carta tessuto la quota di prodotti Ecolabel si attesta al **70%\\*** del totale."],
    ["asterisco e chiusura del grassetto", "La quota di prodotti Ecolabel è del **65% *** del totale."],
    ["asterisco e chiusura seguiti da altro grassetto (forma che la versione precedente corrompeva)", "La quota di prodotti Ecolabel è del **65% *** **del totale**."],
    ["escape dentro il grassetto seguito da altro grassetto", "La quota di prodotti Ecolabel è del **65%\*** **del totale**."],
    ["chiusura del grassetto poi asterisco", "La quota di prodotti Ecolabel è del **65%** * del totale."],
    ["cella con escape dentro il grassetto", "| [C]Detergenti | [C]**65% prodotti Ecolabel\\*** | [G]Criteri |"],
    ["cella con asterisco dopo il grassetto", "| [C]Detergenti | [C]**65% prodotti Ecolabel** * | [G]Criteri |"],
    ["cella con asterisco e chiusura", "| [C]Macchine | [C]**3 macchine ***| [G]Dotazione |"],
  ];
  for (const [nome, testo] of giaMarcati) {
    const esito = guardia(testo);
    atteso(`già marcato dal modello: ${nome} — non toccato`, esito.testo === testo && esito.marcati.length === 0, esito.testo);
    atteso(`già marcato dal modello: ${nome} — il controllo finale non vede residui`, trovaValoriSenzaRiscontro(testo, EVIDENZA, INDICE).length === 0, "");
  }

  // Rete di sicurezza: la guardia non deve poter cambiare come il resto della riga viene letto.
  atteso("rete di sicurezza: un asterisco dentro un grassetto spezza i tratti → modifica non sicura", !modificaSicura("Quota del **65%** del totale.", "Quota del **65% *** del totale."), "");
  atteso("rete di sicurezza: l'asterisco dopo il grassetto lascia i tratti intatti → modifica sicura", modificaSicura("Quota del **65%** del totale.", "Quota del **65%** * del totale."), "");
  atteso("rete di sicurezza: anche i tratti evidenziati (!!..!!) devono restare quelli di prima", !modificaSicura("Il !!Responsabile!! coordina.", "Il !!Responsabi *le!! coordina.") && modificaSicura("Il !!Responsabile!! coordina.", "Il !!Responsabile!! coordina 4 lavasciuga *."), "");
  atteso("nessun valore marcato in modo non sicuro nei casi legittimi: nonMarcabili vuoto", guardia("Con 6 monospazzola e una quota del 72% di prodotti Ecolabel.").nonMarcabili.length === 0, "");

  const dentroGrassetto = guardia("**Nota\\*: la quota proposta di prodotti Ecolabel è del 77% sul totale delle forniture**, come impegno.");
  atteso(
    "valore da marcare dentro un grassetto che contiene un asterisco con escape: l'asterisco va dopo il grassetto, mai dentro",
    /forniture\*\* \*, come impegno/.test(dentroGrassetto.testo) && dentroGrassetto.marcati.length === 1,
    dentroGrassetto.testo,
  );
  for (const [nome, testo] of [...giaMarcati, ["valore da marcare dentro un grassetto", dentroGrassetto.testo]] as [string, string][]) {
    const corpo = testo.startsWith("|") ? `| Voce | Valore | Nota |\n|---|---|---|\n${testo}` : testo;
    const buffer = await buildDocxBuffer("Prova", `# 1. Prova\n\n## 1.1 Voce\n\n${corpo}\n`, { font: "Calibri", dimensioneCarattere: 12 }, undefined, undefined, {});
    const zip = await JSZip.loadAsync(buffer);
    const residui = trovaMarcatoriResidui(estraiTestiPerNodo(await zip.file("word/document.xml").async("string")));
    atteso(`documento reso senza marcatori letterali: ${nome}`, residui.length === 0, residui.join(" / "));
  }
}

// --- 5. Il documento reso resta pulito ---
{
  const testo = `# 1. Criterio di prova

## 1.1 Dotazione

I panni in microfibra sono riutilizzabili per oltre 300 cicli di lavaggio. La quota di prodotti Ecolabel è del **65%** del totale.

| Attrezzatura | Resa |
|---|---|
| [C]Lavasciuga | [C]2.200 mq/h |
| [C]Aspiratore | [C]**61 dB(A)** |

L'organico complessivo dedicato è di 21 unità, dislocate sulle sedi.`;
  const esito = guardia(testo);
  const buffer = await buildDocxBuffer("Prova", esito.testo, { font: "Calibri", dimensioneCarattere: 12 }, undefined, undefined, {});
  const zip = await JSZip.loadAsync(buffer);
  const xml: string = await zip.file("word/document.xml").async("string");
  const residui = trovaMarcatoriResidui(estraiTestiPerNodo(xml));
  atteso("documento reso: nessun marcatore di sintassi residuo", residui.length === 0, residui.join(" / "));
  const visibile = estraiTestiVisibili(xml);
  atteso("documento reso: gli asterischi di proposta e la nota sono visibili", /300 cicli di lavaggio \*/.test(visibile) && /65% \*/.test(visibile) && /2\.200 mq\/h \*/.test(visibile) && /Valori proposti dall'impresa/.test(visibile), visibile.slice(0, 400));
  atteso("documento reso: il derivato mostra come è stato ottenuto", /21 unità \(8 dipendenti dell'impresa \+ 13 unità di personale uscente\)/.test(visibile), "");
}

// --- 6. Testo per il modello che risponde in chat ---
{
  const esito = guardia("Con 3 lavasciuga e una quota del 65% di prodotti Ecolabel. Organico di 21 unità.");
  const testo = testoValoriPerModello(esito.marcati, esito.derivati);
  atteso("testo per il modello: valori marcati da confermare e derivati", /3, 65/.test(testo) && /PROPOSTE DA CONFERMARE/.test(testo) && /21 = 8 dipendenti/.test(testo), testo);
  atteso("nessun valore: nessun testo", testoValoriPerModello([], []) === "", "");
}

// --- 7. Collegamento nei punti di produzione ---
{
  const rel = leggi("src/lib/relazione-tecnica.ts");
  const bozza = rel.slice(rel.indexOf("export async function generaBozzaSezione"), rel.indexOf("function normalizzaTitoloSezione"));
  atteso(
    "collegamento: generaBozzaSezione applica la guardia R9 dopo R8 e prima di salvare e di costruire il Word",
    bozza.includes("applicaGuardiaValori(") &&
      bozza.indexOf("garantisciSenzaRiferimentiEconomici(") < bozza.indexOf("applicaGuardiaValori(") &&
      bozza.indexOf("applicaGuardiaValori(") < bozza.indexOf(".insert(") &&
      bozza.indexOf("applicaGuardiaValori(") < bozza.indexOf("buildDocxBuffer(") &&
      /valoriImpresa(?:,\s*avvisiOrganigramma)?\s*\}/.test(bozza),
    "",
  );
  const finale = rel.slice(rel.indexOf("export async function componiRelazioneFinale"));
  atteso(
    "collegamento: componiRelazioneFinale applica la guardia R9 prima di comporre il documento",
    finale.includes("applicaGuardiaValori(") && finale.indexOf("applicaGuardiaValori(") < finale.indexOf("const contenutoFinale") && /valoriImpresa\s*\}\s*;?\s*\n\}/.test(finale),
    "",
  );
  const chat = leggi("src/app/actions/gara-chat.ts");
  atteso("collegamento: gara-chat dice al modello cosa è stato marcato", chat.split("testoValoriPerModello(").length >= 3, "");
  const l2 = leggi("scripts/verifica-livello2.ts");
  atteso("livello 2: guardia nei due punti di produzione, controllo finale e audit allineato", (l2.match(/applicaGuardiaValori\(/g) || []).length === 2 && /\[R9 valori senza riscontro\]/.test(l2) && /QUALUNQUE valore marcato con un asterisco/.test(l2), "");
  atteso("regola R9: spiega derivati e valori proposti al modello", /VALORI DERIVATI E VALORI PROPOSTI/.test(REGOLE_OMNIA), "");
  const ev = leggi("src/lib/evidenza-dati.ts");
  atteso("evidenza: legge profilo, dati di gara, tutti i chunk dei documenti e i messaggi del cliente", /companies/.test(ev) && /gara_documenti_chunks/.test(ev) && /gara_messaggi/.test(ev) && /range\(/.test(ev), "");
}

}

main()
  .then(() => {
    if (fallimenti.length > 0) {
      console.log(`\n${fallimenti.length} verifiche fallite`);
      process.exit(1);
    }
    console.log("\nAutotest della guardia R9 (valori senza riscontro): tutti i casi ok.");
  })
  .catch((err) => {
    console.error("Errore inatteso nell'autotest della guardia R9:", err);
    process.exit(1);
  });
