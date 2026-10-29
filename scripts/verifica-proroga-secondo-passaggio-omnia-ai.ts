// Autotest del secondo passaggio mirato sulla proroga dei termini di presentazione (richiesta dell'utente, 29/10/2026).
//
// Caso reale che l'ha reso necessario (SMAC, gara con 44 documenti): la proroga era disposta nel dispositivo di una DETERMINA
// dirigenziale (per altro tema: rettifica del costo della manodopera), senza la nuova data, e l'analisi generale ha risposto
// «nessuna proroga». Si controlla, con dati sintetici (nessun database, nessuna rete, nessun modello), che:
//   - i documenti che «sembrano atti» e le pagine che parlano di proroga/rinvio/differimento del termine siano riconosciuti, e le
//     frasi che non c'entrano (rimandi a un articolo, proroga tecnica del contratto) non facciano scattare la ricerca;
//   - la scelta delle pagine tenga una determina anche tra moltissime pagine che citano la proroga, con tetti di pagine e di byte;
//   - l'unione con l'analisi generale possa solo AGGIUNGERE una proroga (o la sua data), mai toglierla;
//   - il codice la lanci in parallelo alla chiamata principale, non scriva sulla gara, non lanci mai errori e registri il costo a parte.
import fs from "fs";
import path from "path";
import { testoDataCaricamento } from "../src/lib/gara-documenti-elenco";
import { PROPRIETA_SCADENZA_ESTRAZIONE, STATI_PROROGA, decidiScadenza, puoModificareScadenza, type RisultatoScadenza } from "../src/lib/gara-proroga";
import {
  ISTRUZIONI_SECONDO_PASSAGGIO,
  MAX_BYTE_PDF_INTERO,
  MAX_CARATTERI_PAGINA,
  MAX_PAGINE_PDF_INTERO,
  MAX_PAGINE_SCELTE,
  MAX_PAGINE_TOTALI,
  MAX_PDF_INTERI,
  PROPRIETA_STRUMENTO_PROROGA,
  eSenzaTesto,
  normalizzaTestoRicerca,
  selezionaPassaggi,
  selezioneVuota,
  sembraUnAtto,
  suggeriscePassaggioProroga,
  testoSecondoPassaggio,
  unisciEsitiProroga,
  type DocumentoPerPassaggio,
  type PaginaTesto,
} from "../src/lib/gara-proroga-passaggio";

const fallimenti: string[] = [];
function atteso(nome: string, ok: boolean, dettaglio = "") {
  console.log(`${ok ? "ok    " : "FALLITO"} ${nome}${ok ? "" : ` — ${dettaglio}`}`);
  if (!ok) fallimenti.push(nome);
}
const uguali = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const leggi = (relativo: string) => fs.readFileSync(path.join(__dirname, "..", relativo), "utf-8").replace(/\r\n/g, "\n");

// Frasi sintetiche (scritte per la prova, non copiate da documenti di clienti).
const PAROLE_DETERMINA =
  "Visto il decreto legislativo, ritenuto necessario rettificare il costo della manodopera; si dispone la proroga del termine per la presentazione delle offerte; la nuova scadenza sarà individuata e resa pubblica mediante gli adempimenti di rettifica del bando.";
const PAROLE_MALFUNZIONAMENTO =
  "In caso di malfunzionamento della piattaforma la stazione appaltante può disporre la sospensione del termine per la presentazione delle offerte e la proroga dello stesso per un massimo di 48 ore.";
const PAROLE_NEUTRE = "Il servizio comprende la pulizia ordinaria dei locali, la sanificazione dei servizi igienici e la raccolta differenziata dei rifiuti.";

const pag = (numero: number, testo: string): PaginaTesto => ({ numero, testo });
const doc = (indice: number, nome: string, pagine: PaginaTesto[] | null, extra: Partial<DocumentoPerPassaggio> = {}): DocumentoPerPassaggio => ({
  indice,
  nome,
  caricatoIl: `2026-10-${String(10 + indice).padStart(2, "0")}T08:00:00Z`,
  pagine,
  totalePagine: pagine?.length ?? 0,
  byte: 500_000,
  ...extra,
});

function corpoFunzione(sorgente: string, nome: string): string {
  const inizio = sorgente.indexOf(`export async function ${nome}(`);
  if (inizio < 0) return "";
  const dopo = sorgente.indexOf("\nexport ", inizio + 10);
  return sorgente.slice(inizio, dopo < 0 ? undefined : dopo);
}

function main() {
  // ───────────────────────── Quali documenti sembrano atti ─────────────────────────
  console.log("--- Documenti che «sembrano atti» ---");
  const ATTI = [
    "5382_DeterminaDirigenziale_Originale_471_2026.pdf",
    "DeterminaDirigenziale_Originale_357_2026_rettifica.pdf",
    "avviso-proroga.pdf",
    "Avviso di rinvio.pdf",
    "Chiarimento n. 1 Stazione Appaltante.pdf",
    "chiarimenti (3).pdf",
    "Delibera di Giunta 12.pdf",
    "Decreto 55.pdf",
    "Comunicazione ai concorrenti.pdf",
    "Errata corrige.pdf",
    "Verbale seduta.pdf",
    "Provvedimento.PDF",
  ];
  const NON_ATTI = [
    "1._Bando_di_gara.pdf",
    "2._Disciplinare_di_gara.pdf",
    "3._Capitolato_Speciale_dAppalto.pdf",
    "4._Disciplinare_telematico.pdf",
    "TOTI 01.pdf",
    "Villino Crespi PS1.pdf",
    "Mod. FVOE.pdf",
    "h. Nomina responsabile esterno del trattamento.pdf",
    "Tracciabilita flussi finanziari.pdf",
    "AMMINISTRAZIONE P01.pdf",
  ];
  for (const n of ATTI) atteso(`atto: ${n}`, sembraUnAtto(n));
  atteso("non atti: bando, disciplinare, capitolato, planimetrie, moduli", NON_ATTI.every((n) => !sembraUnAtto(n)), NON_ATTI.filter(sembraUnAtto).join(", "));

  // ───────────────────────── Testo normalizzato ─────────────────────────
  console.log("\n--- Testo per la ricerca ---");
  atteso("sillabazione a fine riga unita («pro-\\nroga» → «proroga»)", normalizzaTestoRicerca("la pro-\nroga del termine") === "la proroga del termine");
  atteso("trattino morbido tolto, maiuscole e spazi ridotti", normalizzaTestoRicerca("Pro­roga   del\n\nTERMINE") === "proroga del termine");
  atteso("un trattino con spazi attorno (non sillabazione) resta", normalizzaTestoRicerca("2026 - 2027") === "2026 - 2027");

  // ───────────────────────── Ricerca di una pagina che parla di proroga ─────────────────────────
  console.log("\n--- Una pagina «suggerisce una proroga» ---");
  const r = (t: string) => suggeriscePassaggioProroga(t);
  atteso("il dispositivo di una determina che proroga il termine di presentazione", r(PAROLE_DETERMINA).trovato && r(PAROLE_DETERMINA).forza >= 3, JSON.stringify(r(PAROLE_DETERMINA)));
  atteso("«pro-roga» spezzata a fine riga", r("Si approva la pro-\nroga del termine di presentazione delle offerte al giorno 24/11/2026.").trovato);
  atteso("«differito» e «differimento»", r("Il termine per la presentazione delle offerte è differito al 24/11/2026.").trovato && r("Differimento della scadenza di presentazione dell'offerta").trovato);
  atteso("«slittamento», «posticipato», «spostamento»", r("slittamento della scadenza di presentazione delle offerte").trovato && r("Il termine di ricezione delle offerte è posticipato").trovato && r("spostamento del termine per la presentazione delle offerte").trovato);
  atteso("«rinvio del termine di presentazione»", r("Si comunica il rinvio del termine di presentazione delle offerte.").trovato);
  atteso("«riapertura dei termini» per presentare l'offerta", r("Riapertura dei termini per la presentazione delle offerte fino al 30/11.").trovato);
  atteso("il rinvio a un articolo NON conta («si rinvia all'art. 5 per il termine di presentazione delle offerte»)", !r("Si rinvia all'art. 5 per il termine di presentazione delle offerte.").trovato);
  atteso("un testo qualunque non scatta", !r(PAROLE_NEUTRE).trovato && !r("").trovato && !r("breve").trovato);
  atteso("la «proroga tecnica» del contratto, senza termine di presentazione, non scatta", !r("Il contratto in essere è prorogato in via tecnica per il tempo strettamente necessario alla conclusione della procedura, ai sensi dell'art. 106 comma 11.").trovato);
  const lontano = `Si dispone la proroga. ${"Testo di riempimento senza importanza. ".repeat(20)} Il termine per la presentazione delle offerte è indicato nel bando.`;
  atteso("proroga e termine di presentazione troppo lontani tra loro: non scatta", !r(lontano).trovato);
  atteso("la clausola generale sul malfunzionamento SCATTA la ricerca (sta al modello escluderla, vedi le istruzioni)", r(PAROLE_MALFUNZIONAMENTO).trovato);
  atteso("una pagina dispositivo pesa più di una che nomina solo la proroga", r(PAROLE_DETERMINA).forza > r("La proroga del termine di presentazione delle offerte è un'ipotesi possibile.").forza);

  // ───────────────────────── Scelta delle pagine ─────────────────────────
  console.log("\n--- Cosa si manda al modello ---");
  const bando = doc(1, "1._Bando_di_gara.pdf", [pag(1, PAROLE_NEUTRE), pag(2, PAROLE_NEUTRE)]);
  const disciplinare = doc(2, "2._Disciplinare_di_gara.pdf", [pag(1, PAROLE_NEUTRE), pag(2, PAROLE_NEUTRE), pag(3, PAROLE_NEUTRE), pag(4, PAROLE_MALFUNZIONAMENTO), pag(5, PAROLE_NEUTRE)]);
  const determina = doc(7, "5382_DeterminaDirigenziale_Originale_471_2026.pdf", [pag(1, PAROLE_NEUTRE), pag(2, PAROLE_NEUTRE), pag(3, PAROLE_DETERMINA), pag(4, "Il dirigente. Firmato digitalmente.")]);
  const sel1 = selezionaPassaggi([bando, disciplinare, determina]);
  atteso("la pagina della determina è scelta, con la pagina dopo come contesto", sel1.passaggi.some((p) => p.indice === 7 && p.pagina === 3) && sel1.passaggi.some((p) => p.indice === 7 && p.pagina === 4), JSON.stringify(sel1.passaggi.map((p) => `${p.indice}:${p.pagina}`)));
  atteso("anche la clausola del disciplinare viene mostrata al modello (che dovrà escluderla)", sel1.passaggi.some((p) => p.indice === 2 && p.pagina === 4));
  atteso("le pagine senza niente di pertinente non vengono mandate", !sel1.passaggi.some((p) => p.indice === 1) && !sel1.passaggi.some((p) => p.indice === 7 && p.pagina === 1));
  atteso("i passaggi sono in ordine di documento e di pagina", uguali(sel1.passaggi.map((p) => [p.indice, p.pagina]), [[2, 4], [2, 5], [7, 3], [7, 4]]), JSON.stringify(sel1.passaggi.map((p) => [p.indice, p.pagina])));
  atteso("nessun PDF intero (i documenti hanno testo)", sel1.pdfInteri.length === 0);

  const nulla = selezionaPassaggi([bando, doc(3, "Capitolato.pdf", [pag(1, PAROLE_NEUTRE)])]);
  atteso("senza passaggi pertinenti la selezione è vuota (nessuna chiamata al modello, nessun costo)", selezioneVuota(nulla));

  // una determina tra tantissime pagine che nominano la proroga: deve restare
  const rumorosa = doc(3, "Disciplinare_lungo.pdf", Array.from({ length: 40 }, (_, i) => pag(i + 1, PAROLE_MALFUNZIONAMENTO)));
  const sel2 = selezionaPassaggi([bando, rumorosa, determina]);
  atteso("anche con 40 pagine rumorose la determina è nella selezione (punteggio più alto)", sel2.passaggi.some((p) => p.indice === 7 && p.pagina === 3));
  atteso(`tetto sulle pagine scelte (${MAX_PAGINE_SCELTE}) e sul totale con il contesto (${MAX_PAGINE_TOTALI})`, sel2.passaggi.length <= MAX_PAGINE_TOTALI && sel2.passaggi.filter((p) => p.indice === 3).length <= MAX_PAGINE_TOTALI - 2, String(sel2.passaggi.length));
  const pari = selezionaPassaggi([doc(1, "A.pdf", Array.from({ length: 20 }, (_, i) => pag(i + 1, PAROLE_MALFUNZIONAMENTO)))]);
  atteso("a parità di punteggio: le prime pagine in ordine (selezione stabile)", pari.passaggi.length > 0 && pari.passaggi[0].pagina === 1 && uguali(pari.passaggi.map((p) => p.pagina), [...pari.passaggi.map((p) => p.pagina)].sort((a, b) => a - b)));
  const lunga = doc(1, "Determina.pdf", [pag(1, `${PAROLE_DETERMINA} ${"x".repeat(MAX_CARATTERI_PAGINA * 2)}`)]);
  atteso(`il testo di una pagina si taglia a ${MAX_CARATTERI_PAGINA} caratteri`, selezionaPassaggi([lunga]).passaggi[0].testo.length === MAX_CARATTERI_PAGINA);

  // scansioni
  const scansione = (indice: number, nome: string, extra: Partial<DocumentoPerPassaggio> = {}) => doc(indice, nome, [pag(1, ""), pag(2, "  "), pag(3, "")], extra);
  atteso("una pagina senza caratteri è «senza testo»; un documento con testo no", eSenzaTesto(scansione(1, "x.pdf")) && !eSenzaTesto(bando));
  atteso("un documento non leggibile (errore) NON è trattato come scansione", !eSenzaTesto(doc(1, "x.pdf", null)));
  const selS = selezionaPassaggi([scansione(4, "Determina_scansione.pdf"), scansione(5, "TOTI 01.pdf"), scansione(6, "Avviso_grande.pdf", { totalePagine: MAX_PAGINE_PDF_INTERO + 1 }), scansione(8, "Avviso_pesante.pdf", { byte: MAX_BYTE_PDF_INTERO + 1 }), doc(9, "Avviso_rotto.pdf", null)]);
  atteso("un atto in scansione piccolo va per intero; una planimetria, un atto grande o pesante o illeggibile no", uguali(selS.pdfInteri, [4]), JSON.stringify(selS.pdfInteri));
  const molte = selezionaPassaggi(Array.from({ length: 6 }, (_, i) => scansione(i + 1, `Determina_${i}.pdf`)));
  atteso(`al massimo ${MAX_PDF_INTERI} PDF interi`, molte.pdfInteri.length === MAX_PDF_INTERO_ATTESO());
  function MAX_PDF_INTERO_ATTESO() { return MAX_PDF_INTERI; }
  atteso("con soli atti in scansione la selezione non è vuota", !selezioneVuota(selS));

  // il caso reale: 44 documenti, uno solo è la determina
  const tutti: DocumentoPerPassaggio[] = [];
  for (let i = 1; i <= 36; i++) tutti.push(doc(i, `planimetria_${i}.pdf`, [pag(1, PAROLE_NEUTRE)]));
  tutti.push(doc(37, "1._Bando_di_gara.pdf", [pag(1, PAROLE_NEUTRE), pag(2, PAROLE_NEUTRE)]));
  tutti.push(doc(38, "2._Disciplinare_di_gara.pdf", [pag(1, PAROLE_NEUTRE), pag(2, PAROLE_MALFUNZIONAMENTO)]));
  tutti.push(doc(39, "3._Capitolato_Speciale_dAppalto.pdf", [pag(1, PAROLE_NEUTRE)]));
  tutti.push(doc(40, "4._Disciplinare_telematico.pdf", [pag(1, PAROLE_MALFUNZIONAMENTO), pag(2, PAROLE_NEUTRE)]));
  tutti.push(doc(41, "5._Schema_contratto.pdf", [pag(1, PAROLE_NEUTRE)]));
  tutti.push(doc(42, "5382_DeterminaDirigenziale_Originale_471_2026.pdf", [pag(1, PAROLE_NEUTRE), pag(2, PAROLE_DETERMINA)]));
  tutti.push(doc(43, "DeterminaDirigenziale_Originale_181_2026_contrarre.pdf", [pag(1, PAROLE_NEUTRE)]));
  tutti.push(doc(44, "DeterminaDirigenziale_Originale_357_2026_rettifica.pdf", [pag(1, PAROLE_NEUTRE)]));
  const sel44 = selezionaPassaggi(tutti);
  atteso("44 documenti: la determina con la proroga è nella selezione e il resto non pesa", sel44.passaggi.some((p) => p.indice === 42 && p.pagina === 2) && sel44.passaggi.length <= 6, `${sel44.passaggi.length} pagine`);

  // ───────────────────────── Testo per il modello ─────────────────────────
  console.log("\n--- Il testo per il modello ---");
  const elenco = [bando, disciplinare, determina].map((d) => ({ indice: d.indice, nome: d.nome, caricatoIl: d.caricatoIl }));
  const testo = testoSecondoPassaggio(sel1, elenco, testoDataCaricamento);
  atteso("contiene le istruzioni, le intestazioni dei documenti con la data di caricamento e il numero di pagina", testo.startsWith(ISTRUZIONI_SECONDO_PASSAGGIO) && testo.includes("=== Documento 7: 5382_DeterminaDirigenziale_Originale_471_2026.pdf — caricato il 17/10/2026") && testo.includes("[pagina 3]"), testo.slice(ISTRUZIONI_SECONDO_PASSAGGIO.length, ISTRUZIONI_SECONDO_PASSAGGIO.length + 200));
  atteso("i documenti compaiono in ordine e il testo della determina c'è", testo.indexOf("Documento 2:") < testo.indexOf("Documento 7:") && testo.includes("si dispone la proroga del termine"));
  const conScansione = testoSecondoPassaggio(selS, [{ indice: 4, nome: "Determina_scansione.pdf", caricatoIl: "2026-10-14T08:00:00Z" }], testoDataCaricamento);
  atteso("gli atti interi sono elencati", /Atti interi allegati come PDF[^]*Documento 4: Determina_scansione\.pdf/.test(conScansione));
  const I = ISTRUZIONI_SECONDO_PASSAGGIO;
  atteso("istruzioni: è una proroga anche se è nel dispositivo di una determina che tratta altro", /dispositivo di una determina/.test(I) && /tratta principalmente altro/.test(I));
  atteso("istruzioni: «la nuova data sarà comunicata/pubblicata con la rettifica» = senza_nuova_data; con la data = con_nuova_data in «scadenza»", /senza_nuova_data/.test(I) && /con_nuova_data/.test(I) && /rettifica del bando/.test(I));
  atteso("istruzioni: NON sono proroga la clausola generale (malfunzionamento), la proroga tecnica, il rinvio della seduta, i chiarimenti, il rimando a un articolo", /GENERALE o IPOTETICA/.test(I) && /malfunzionamento/.test(I) && /proroga tecnica/.test(I) && /seduta di gara/.test(I) && /chiarimenti/.test(I) && /si rinvia all'art\. 5/.test(I));
  atteso("istruzioni: più atti → vale il più recente; nel dubbio «nessuna»", /vale il più recente/.test(I) && /nel dubbio, «nessuna»/.test(I));
  atteso("lo strumento: passaggio e documento prima, poi le stesse voci dell'analisi generale (stesse descrizioni, non copie)", uguali(Object.keys(PROPRIETA_STRUMENTO_PROROGA), ["passaggio", "documento", "proroga_termini", "scadenza", "scadenza_ora", "scadenza_originaria"]) && PROPRIETA_STRUMENTO_PROROGA.proroga_termini === PROPRIETA_SCADENZA_ESTRAZIONE.proroga_termini && PROPRIETA_STRUMENTO_PROROGA.scadenza === PROPRIETA_SCADENZA_ESTRAZIONE.scadenza);
  atteso("lo strumento: gli stati ammessi sono quelli del codice", uguali(PROPRIETA_STRUMENTO_PROROGA.proroga_termini.enum, [...STATI_PROROGA]));
  atteso("la citazione è breve (massimo 25 parole) e facoltativa", /massimo 25 parole/.test(PROPRIETA_STRUMENTO_PROROGA.passaggio.description) && /Ometti il campo/.test(PROPRIETA_STRUMENTO_PROROGA.passaggio.description));

  // ───────────────────────── Le istruzioni rafforzate dell'analisi generale ─────────────────────────
  console.log("\n--- Istruzioni dell'analisi generale ---");
  const P = PROPRIETA_SCADENZA_ESTRAZIONE.proroga_termini.description;
  atteso("la proroga può essere in QUALSIASI documento: determina, provvedimento, dispositivo, rettifica del bando, chiarimento, verbale", /QUALSIASI DOCUMENTO/.test(P) && /determina/.test(P) && /provvedimento dirigenziale/.test(P) && /dispositivo/.test(P) && /rettifica del bando/.test(P) && /verbale/.test(P));
  atteso("anche quando il documento tratta altro (rettifica del costo della manodopera) e con parole come rinvio, differimento, slittamento", /costo della manodopera/.test(P) && /rinvio, differimento, slittamento/.test(P));
  atteso("un provvedimento che proroga ma rimanda la data a una successiva rettifica è «senza_nuova_data»", /rimanda la nuova data a una successiva rettifica del bando/.test(P));
  atteso("cerca in TUTTI i documenti, anche lunghi", /TUTTI i documenti/.test(P));
  atteso("la clausola generale o ipotetica (malfunzionamento) NON è una proroga", /GENERALE o IPOTETICA/.test(P) && /malfunzionamento della piattaforma/.test(P));
  atteso("restano le esclusioni di prima (proroga tecnica, contratto, seduta, chiarimenti, sopralluogo) e il «nel dubbio nessuna»", /proroga tecnica/.test(P) && /CONTRATTO/.test(P) && /seduta di gara/.test(P) && /chiarimenti/.test(P) && /sopralluogo/.test(P) && /non sei sicuro[^.]*rispondi 'nessuna'/.test(P));

  // ───────────────────────── Unione con l'analisi generale ─────────────────────────
  console.log("\n--- Unione dei due esiti ---");
  const gen = (extra: RisultatoScadenza = {}): RisultatoScadenza => ({ scadenza: "2026-10-30", scadenza_ora: "18:00", ...extra });
  const giusto = (nome: string, ottenuto: RisultatoScadenza, previsto: Partial<Record<keyof RisultatoScadenza, unknown>>) => {
    const sbagliati = Object.entries(previsto).filter(([k, v]) => (ottenuto as Record<string, unknown>)[k] !== v);
    atteso(nome, sbagliati.length === 0, sbagliati.map(([k, v]) => `${k}: ${String((ottenuto as Record<string, unknown>)[k])} (atteso ${String(v)})`).join("; "));
  };
  const g0 = gen({ proroga_termini: "nessuna" });
  atteso("nessun esito mirato: resta l'analisi generale (lo stesso oggetto)", unisciEsitiProroga(g0, null) === g0 && unisciEsitiProroga(g0, undefined) === g0);
  atteso("mirato «nessuna», illeggibile, vuoto o inventato: resta l'analisi generale", [{ proroga_termini: "nessuna" }, { proroga_termini: "forse" }, {}, { proroga_termini: 5 }].every((m) => unisciEsitiProroga(g0, m as RisultatoScadenza) === g0));

  const smac = unisciEsitiProroga(g0, { proroga_termini: "senza_nuova_data", passaggio: "si dispone la proroga", documento: "6" } as RisultatoScadenza);
  giusto("IL CASO SMAC: generale «nessuna», mirato «senza data» → senza data, la scadenza e l'ora di prima restano", smac, { proroga_termini: "senza_nuova_data", scadenza: "2026-10-30", scadenza_ora: "18:00" });
  const smacDecisione = decidiScadenza(smac, { scadenza: "2026-10-30", scadenza_ora: "18:00:00", scadenza_manuale: false });
  atteso("… e a quel punto il modulo a mano compare e la scadenza salvata non cambia", puoModificareScadenza(smacDecisione.proroga_stato) && smacDecisione.scadenza === "2026-10-30" && smacDecisione.scadenza_ora === "18:00" && !smacDecisione.scadenza_manuale, JSON.stringify(smacDecisione));
  giusto("generale senza risposta sulla proroga + mirato «senza data» → senza data", unisciEsitiProroga(gen(), { proroga_termini: "senza_nuova_data" }), { proroga_termini: "senza_nuova_data" });
  giusto("generale «senza data» + mirato «senza data» → senza data", unisciEsitiProroga(gen({ proroga_termini: "senza_nuova_data" }), { proroga_termini: "senza_nuova_data" }), { proroga_termini: "senza_nuova_data", scadenza: "2026-10-30" });
  const g1 = gen({ proroga_termini: "con_nuova_data", scadenza: "2026-11-24", scadenza_originaria: "2026-10-30" });
  atteso("generale «con data» + mirato «senza data»: la data nota resta (lo stesso oggetto)", unisciEsitiProroga(g1, { proroga_termini: "senza_nuova_data" }) === g1);

  giusto("generale «nessuna» + mirato «con data» → la data della proroga, con la data di prima come originaria", unisciEsitiProroga(g0, { proroga_termini: "con_nuova_data", scadenza: "2026-11-24", scadenza_ora: "10:00" }), { proroga_termini: "con_nuova_data", scadenza: "2026-11-24", scadenza_ora: "10:00", scadenza_originaria: "2026-10-30" });
  giusto("… senza ora nel mirato: resta l'ora del bando", unisciEsitiProroga(g0, { proroga_termini: "con_nuova_data", scadenza: "2026-11-24" }), { scadenza: "2026-11-24", scadenza_ora: "18:00" });
  giusto("… ora «9:30» del mirato si normalizza", unisciEsitiProroga(g0, { proroga_termini: "con_nuova_data", scadenza: "2026-11-24", scadenza_ora: "9:30" }), { scadenza_ora: "09:30" });
  giusto("generale «senza data» + mirato «con data» → la data trovata, originaria = data del bando", unisciEsitiProroga(gen({ proroga_termini: "senza_nuova_data" }), { proroga_termini: "con_nuova_data", scadenza: "2026-11-24" }), { proroga_termini: "con_nuova_data", scadenza: "2026-11-24", scadenza_originaria: "2026-10-30" });
  giusto("la data originaria scritta dal mirato vale più di quella dedotta", unisciEsitiProroga(g0, { proroga_termini: "con_nuova_data", scadenza: "2026-11-24", scadenza_originaria: "2026-10-28" }), { scadenza_originaria: "2026-10-28" });

  giusto("due proroghe con data: vale la più lontana (mirato più avanti), l'originaria è quella vera del bando", unisciEsitiProroga(g1, { proroga_termini: "con_nuova_data", scadenza: "2026-12-03", scadenza_ora: "12:00" }), { scadenza: "2026-12-03", scadenza_ora: "12:00", scadenza_originaria: "2026-10-30" });
  giusto("… e se il mirato non scrive l'ora, non si tiene quella della proroga precedente", unisciEsitiProroga(g1, { proroga_termini: "con_nuova_data", scadenza: "2026-12-03" }), { scadenza: "2026-12-03", scadenza_ora: undefined });
  atteso("due proroghe con data: se la generale è più avanti, resta la generale (lo stesso oggetto)", unisciEsitiProroga(gen({ proroga_termini: "con_nuova_data", scadenza: "2026-12-03" }), { proroga_termini: "con_nuova_data", scadenza: "2026-11-24" }).scadenza === "2026-12-03");
  const gUguale = gen({ proroga_termini: "con_nuova_data", scadenza: "2026-11-24" });
  atteso("stessa data nei due esiti: resta la generale", unisciEsitiProroga(gUguale, { proroga_termini: "con_nuova_data", scadenza: "2026-11-24" }) === gUguale);

  giusto("mirato «con data» ma data inesistente (30 febbraio) → trattata come «senza data»", unisciEsitiProroga(g0, { proroga_termini: "con_nuova_data", scadenza: "2026-02-30" }), { proroga_termini: "senza_nuova_data", scadenza: "2026-10-30" });
  atteso("mirato «con data» senza data valida e generale «con data»: resta la generale", unisciEsitiProroga(g1, { proroga_termini: "con_nuova_data", scadenza: "boh" }) === g1);

  // il passaggio mirato non toglie mai una proroga
  let nessunaProrogaTolta = true;
  for (const sG of [undefined, "nessuna", "con_nuova_data", "senza_nuova_data"]) {
    for (const mir of [null, {}, { proroga_termini: "nessuna" }, { proroga_termini: "boh" }, { proroga_termini: "senza_nuova_data" }, { proroga_termini: "con_nuova_data", scadenza: "2026-11-24" }, { proroga_termini: "con_nuova_data" }] as (RisultatoScadenza | null)[]) {
      const base = gen({ proroga_termini: sG, scadenza: sG === "con_nuova_data" ? "2026-12-31" : "2026-10-30" });
      const unito = unisciEsitiProroga(base, mir);
      if ((sG === "con_nuova_data" || sG === "senza_nuova_data") && (unito.proroga_termini === "nessuna" || unito.proroga_termini === undefined)) nessunaProrogaTolta = false;
      if (sG === "con_nuova_data" && unito.proroga_termini !== "con_nuova_data") nessunaProrogaTolta = false;
    }
  }
  atteso("in nessuna combinazione il mirato toglie una proroga già trovata (o la sua data)", nessunaProrogaTolta);

  const conManuale = decidiScadenza(unisciEsitiProroga(g0, { proroga_termini: "senza_nuova_data" }), { scadenza: "2026-11-24", scadenza_ora: "10:00:00", scadenza_manuale: true });
  atteso("con una data già inserita a mano: la rianalisi (con il mirato) la conserva", conManuale.scadenza === "2026-11-24" && conManuale.scadenza_ora === "10:00" && conManuale.scadenza_manuale, JSON.stringify(conManuale));

  // ───────────────────────── Controlli sul codice ─────────────────────────
  console.log("\n--- Codice ---");
  const estrazione = leggi("src/app/actions/gara-extraction.ts");
  const iChiamata = estrazione.indexOf("const secondoPassaggio = secondoPassaggioProroga(");
  const iPrincipale = estrazione.indexOf("const response = await anthropic.messages.create(");
  const iAttesa = estrazione.indexOf("const esitoMirato = await secondoPassaggio;");
  const iDecisione = estrazione.indexOf("decidiScadenza(unisciEsitiProroga(result, esitoMirato), scadenzaEsistente)");
  atteso("il secondo passaggio parte PRIMA della chiamata principale (in parallelo, non la allunga)", iChiamata > 0 && iPrincipale > iChiamata);
  atteso("se ne attende il risultato prima di decidere la scadenza, e la decisione usa l'unione dei due esiti", iAttesa > iPrincipale && iDecisione > iAttesa);
  atteso("riceve i PDF della gara, l'account titolare e la gara (il costo va al cliente giusto)", /secondoPassaggioProroga\(\{ anthropic, admin, documenti: pdfDocs, accountId: contesto\.accountId, garaId \}\)/.test(estrazione));
  atteso("nessun altro punto dell'analisi legge il risultato mirato (le altre voci estratte restano quelle di prima)", (estrazione.match(/esitoMirato/g) ?? []).length === 2);

  const lib = leggi("src/lib/gara-proroga-secondo-passaggio.ts");
  const secondo = corpoFunzione(lib, "secondoPassaggioProroga");
  atteso("il secondo passaggio non scrive sulle gare (nessun insert/update/delete/upsert/rpc)", !/\.(insert|update|delete|upsert|rpc)\(/.test(lib));
  atteso("il secondo passaggio non lancia mai errori: tutto in try/catch con ritorno nullo e un solo avviso sul server", /^\s*try \{/m.test(secondo) && /\} catch \(errore\) \{\s*console\.warn\([^)]*\);\s*return null;\s*\}/.test(secondo) && !/\bthrow\b/.test(lib));
  atteso("senza passaggi pertinenti non chiama il modello", /if \(selezioneVuota\(selezione\)\) return null;[\s\S]*valutaSecondoPassaggio\(/.test(secondo));
  atteso("il costo è registrato come operazione a parte, per il titolare, e un errore del registro non toglie il risultato", /operazione: OPERAZIONE_PROROGA/.test(secondo) && /userId: accountId/.test(secondo) && /try \{\s*await logAiUsage\(/.test(secondo));
  atteso("l'operazione ha un nome diverso da quella dell'analisi generale e un'etichetta nella console", OPERAZIONE_PROROGA_PER_TEST() !== "estrazione_gara" && /estrazione_gara_proroga: "[^"]+"/.test(leggi("src/app/site-console/_componenti/costi-dettaglio-vista.tsx")));
  function OPERAZIONE_PROROGA_PER_TEST() { return (/OPERAZIONE_PROROGA = "([^"]+)"/.exec(leggi("src/lib/gara-proroga-passaggio.ts")) ?? [])[1]; }
  atteso("il modello è forzato sullo strumento e senza ragionamento esteso (come l'analisi generale), e sono mandati solo i PDF interi scelti", /tool_choice: \{ type: "tool", name: NOME_STRUMENTO_PROROGA \}/.test(lib) && /thinking: \{ type: "disabled" \}/.test(lib) && /for \(const indice of selezione\.pdfInteri\)/.test(lib) && (lib.match(/type: "document"/g) ?? []).length === 1);
  atteso("stesso modello dell'analisi generale", (/MODELLO_PROROGA = "([^"]+)"/.exec(lib) ?? [])[1] === (/const MODEL = "([^"]+)"/.exec(estrazione) ?? [])[1]);
  atteso("la citazione e il documento indicati dal modello non si leggono, non si salvano e non si registrano", !/\.passaggio\b|\.documento\b/.test(lib) && !/\.passaggio\b|\.documento\b/.test(estrazione) && (lib.match(/console\./g) ?? []).length === 1);
  atteso("il secondo passaggio non consuma né controlla le gare del piano", !/consumeGaraQuota|dirittoGara|requireOmniaAiWriteAccess/.test(lib));
  atteso("tetto di lettura per PDF e lettura in parallelo limitata (non blocca l'analisi)", /TEMPO_MAX_LETTURA_PDF_MS = 40_000/.test(lib) && /LETTURE_IN_PARALLELO = 4/.test(lib));
  atteso("il file in memoria si tiene solo per i piccoli atti (per mandarli interi)", /const piccoloAtto = sembraUnAtto\(nome\) && buffer\.byteLength <= MAX_BYTE_PDF_INTERO;/.test(lib) && /buffer: piccoloAtto \? buffer : null/.test(lib));

  const catena = leggi("package.json");
  atteso("il test è nella catena verifica:livello1", /tsx scripts\/verifica-proroga-secondo-passaggio-omnia-ai\.ts/.test(catena));

  if (fallimenti.length > 0) {
    console.log(`\n${fallimenti.length} controlli falliti:\n- ${fallimenti.join("\n- ")}`);
    process.exit(1);
  }
  console.log("\nTutti i controlli sono andati a buon fine.");
}

main();
