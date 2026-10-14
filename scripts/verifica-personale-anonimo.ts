// Autotest del filtro sui dati del personale uscente (src/lib/personale-anonimo.ts).
//
// La pagina pubblica «Riservatezza» dice che nominativi, codici fiscali e matricole non
// vengono riportati nei dati ricavati dagli elenchi del personale. Qui si prova che il
// filtro lo garantisce davvero, che non rovina i dati legittimi e che gira in tutti i
// punti dove quei dati nascono o vengono usati. Dichiara anche, con un caso apposta, il
// suo limite: un nome in chiaro senza etichetta in un campo libero non si riconosce.
// Gratuito, nessun database né rete: gira nel livello 1, quindi in prebuild.
import fs from "fs";
import path from "path";
import { formattaDatiGaraStrutturati } from "../src/lib/gara-chat-prompt";
import { nessunIntervento, personaleUscenteSicuro, ripulisciPersonaleUscente, ripulisciTesto, type InterventiPulizia } from "../src/lib/personale-anonimo";

const fallimenti: string[] = [];
function atteso(nome: string, ok: boolean, dettaglio = "") {
  console.log(`${ok ? "ok    " : "FALLITO"} ${nome}${ok ? "" : ` — ${dettaglio}`}`);
  if (!ok) fallimenti.push(nome);
}
function uguale<T>(nome: string, ottenuto: T, previsto: T) {
  atteso(nome, JSON.stringify(ottenuto) === JSON.stringify(previsto), `ottenuto ${JSON.stringify(ottenuto)}, previsto ${JSON.stringify(previsto)}`);
}
const leggi = (relativo: string) => fs.readFileSync(path.join(__dirname, "..", relativo), "utf-8").replace(/\r\n/g, "\n");
const pulisci = (t: string) => ripulisciTesto(t);
const vuoti = (): InterventiPulizia => ({ vociScartate: 0, campiEstranei: 0, codiciFiscali: 0, matricole: 0, nominativi: 0 });

console.log("--- Codici fiscali ---");
uguale("codice fiscale tolto dal testo", pulisci("Livello 3, RSSMRA80A01H501U, tempo pieno"), "Livello 3, tempo pieno");
uguale("anche in minuscolo", pulisci("addetto rssmra80a01h501u livello 2"), "addetto livello 2");
uguale("anche spezzato da spazi (copia da PDF)", pulisci("cf RSS MRA 80A01 H501U livello 2"), "cf livello 2");
uguale("anche con trattini e punti", pulisci("RSS-MRA-80A01-H501-U e BNC.NNA.85M41.H501.Z"), "e");
uguale("anche con omocodia (cifre sostituite da lettere)", pulisci("codice RSSMRA80A01H50MU fine"), "codice fine");
uguale("due codici nello stesso campo", pulisci("RSSMRA80A01H501U / BNCNNA85M41H501Z"), null);
uguale("solo un codice fiscale: il campo resta vuoto (null)", pulisci("RSSMRA80A01H501U"), null);
uguale("sedici lettere con la forma giusta ma senza cifre NON sono un codice fiscale", pulisci("ABCDEFLMALMALMNZ"), "ABCDEFLMALMALMNZ");
uguale("un codice incollato a una parola più lunga non si tocca", pulisci("XRSSMRA80A01H501U1"), "XRSSMRA80A01H501U1");
uguale("una partita IVA (11 cifre) non è un codice fiscale di persona: resta", pulisci("P.IVA 01234567890"), "P.IVA 01234567890");

console.log("--- Matricole e codici identificativi ---");
uguale("matr. 12345", pulisci("Operaio matr. 12345 livello 3"), "Operaio livello 3");
uguale("matricola A123", pulisci("matricola A123, 36 ore"), "36 ore");
uguale("n. matricola: 456", pulisci("n. matricola: 456 operaio"), "operaio");
uguale("matricola con numero davanti (Matr.n. 78)", pulisci("Matr.n. 78 impiegato"), "impiegato");
uguale("badge", pulisci("badge 77 turno mattina"), "turno mattina");
uguale("codice dipendente", pulisci("cod. dipendente 9001 livello 4"), "livello 4");
uguale("id operatore", pulisci("id operatore 55 livello 2"), "livello 2");
uguale("«matrimonio» non è «matr»", pulisci("congedo per matrimonio 2020"), "congedo per matrimonio 2020");
uguale("«mat.» senza numero non si tocca", pulisci("mat. prima disponibile"), "mat. prima disponibile");
uguale("un numero senza etichetta resta (può essere ore, livello, anzianità)", pulisci("36 ore, livello 3, dal 2015"), "36 ore, livello 3, dal 2015");

console.log("--- Nominativi etichettati ---");
uguale("«Sig.ra Cognome Nome»", pulisci("Sig.ra Bianchi Anna, livello 3"), "livello 3");
uguale("«nominativo: COGNOME NOME»", pulisci("nominativo: ROSSI MARIO - operaio"), "operaio");
uguale("«cognome Verdi»", pulisci("cognome Verdi, 20 ore"), "20 ore");
uguale("«Dott. Rossi»", pulisci("Dott. Rossi responsabile"), "responsabile");
uguale("«nome e cognome Anna Neri»", pulisci("nome e cognome Anna Neri impiegata"), "impiegata");
uguale("«nome reparto» (minuscola dopo l'etichetta) non è un nominativo: resta", pulisci("nome reparto Pediatria"), "nome reparto Pediatria");
uguale("«significa» non è «sig»", pulisci("significa turno notturno"), "significa turno notturno");

console.log("--- Testo legittimo invariato ---");
for (const t of [
  "Livello 3 - Operaio, CCNL Multiservizi, tempo indeterminato",
  "dal 01/03/2015 (9 anni)",
  "turno mattina 6-12, reparto Pediatria",
  "Addetto 1",
  "6 ore giornaliere su 5 giorni, sede Palazzo Comunale",
  "Q (quadro) - Responsabile di Commessa",
]) {
  uguale(`invariato: «${t}»`, pulisci(t), t);
}

console.log("--- Limite dichiarato ---");
uguale(
  "un nome in chiaro SENZA etichetta in un campo libero non si riconosce (lì resta l'istruzione al modello)",
  pulisci("Rossi Mario, livello 3"),
  "Rossi Mario, livello 3",
);

console.log("--- Voci: schema chiuso e valori ---");
const sporca = [
  { livello_contrattuale: "Livello 3 - Operaio", numero_addetti: 1, ore_settimanali: 36, anzianita: "dal 2015", note: "turno mattina", nome: "Mario", cognome: "Rossi", matricola: "123", codice_fiscale: "RSSMRA80A01H501U" },
];
const campiEstranei = ripulisciPersonaleUscente(sporca);
uguale("i campi non previsti sono scartati", Object.keys(campiEstranei.voci[0]).sort(), ["anzianita", "livello_contrattuale", "note", "numero_addetti", "ore_settimanali"]);
uguale("e contati", campiEstranei.interventi.campiEstranei, 4);
atteso("i valori ammessi restano com'erano", campiEstranei.voci[0].livello_contrattuale === "Livello 3 - Operaio" && campiEstranei.voci[0].ore_settimanali === 36 && campiEstranei.voci[0].note === "turno mattina");
atteso("l'elenco ricevuto non viene modificato", Object.keys(sporca[0]).length === 9);

const mista = ripulisciPersonaleUscente([
  { livello_contrattuale: "Livello 2 matr. 99", numero_addetti: "3", ore_settimanali: "36,5", anzianita: "RSSMRA80A01H501U", note: "Sig. Verdi Luca" },
  { livello_contrattuale: "RSSMRA80A01H501U", numero_addetti: -2 },
  { numero_addetti: Number.NaN },
  null,
  "testo",
  [1],
]);
uguale("numero di addetti da stringa, ore con la virgola; campi vuoti dopo la pulizia omessi", mista.voci[0], { livello_contrattuale: "Livello 2", numero_addetti: 3, ore_settimanali: 36.5 });
uguale("livello che era solo un codice fiscale: «Livello non indicato», addetti non validi = 1", mista.voci[1], { livello_contrattuale: "Livello non indicato", numero_addetti: 1 });
uguale("voce senza livello né numero valido: restano i valori di ripiego", mista.voci[2], { livello_contrattuale: "Livello non indicato", numero_addetti: 1 });
uguale("tre voci valide e tre scartate (non oggetti)", [mista.voci.length, mista.interventi.vociScartate], [3, 3]);
uguale("contatori: codici fiscali (anzianità + livello), matricole, nominativi", [mista.interventi.codiciFiscali, mista.interventi.matricole, mista.interventi.nominativi], [2, 1, 1]);
uguale("input che non è un elenco: nessuna voce", ripulisciPersonaleUscente({ a: 1 }).voci, []);
uguale("input nullo: nessuna voce", ripulisciPersonaleUscente(null).voci, []);
const gia = ripulisciPersonaleUscente(mista.voci);
uguale("idempotente: ripulire un elenco già pulito non cambia nulla", gia.voci, mista.voci);
atteso("e non segnala interventi", nessunIntervento(gia.interventi));
atteso("dati puliti fin dall'inizio: nessun intervento", nessunIntervento(ripulisciPersonaleUscente([{ livello_contrattuale: "Livello 3", numero_addetti: 2, ore_settimanali: 20 }]).interventi));
atteso("nessun codice fiscale rimane in nessun campo dell'output", !JSON.stringify(mista.voci).match(/RSSMRA80A01H501U/i));
uguale("contatori a zero in partenza", vuoti(), { vociScartate: 0, campiEstranei: 0, codiciFiscali: 0, matricole: 0, nominativi: 0 });
uguale("personaleUscenteSicuro(null) = null", personaleUscenteSicuro(null), null);

console.log("--- Punti in cui il filtro gira ---");
const avvisoOriginale = console.warn;
console.warn = () => {}; // il filtro segnala nel log ciò che toglie: qui è atteso, non va nell'uscita del test
const prompt = formattaDatiGaraStrutturati({
  sedi: null,
  personale_uscente: [{ livello_contrattuale: "Livello 3 - Operaio", numero_addetti: 1, ore_settimanali: 36, anzianita: "dal 2015", note: "RSSMRA80A01H501U matr. 4521 turno mattina" }],
});
console.warn = avvisoOriginale;
atteso("dato già salvato col codice fiscale: nel prompt di generazione non arriva", !/RSSMRA80A01H501U|4521/i.test(prompt) && /turno mattina/.test(prompt), prompt);
const estrazione = leggi("src/app/actions/gara-extraction.ts");
atteso("l'estrazione ripulisce prima di salvare", estrazione.indexOf("ripulisciPersonaleUscente(result.personale_uscente)") !== -1 && estrazione.indexOf("ripulisciPersonaleUscente(result.personale_uscente)") < estrazione.indexOf("personale_uscente: personaleUscente,"));
atteso("e salva il risultato ripulito, mai direttamente quello del modello", /personale_uscente: personaleUscente,/.test(estrazione) && !/personale_uscente: result\.personale_uscente/.test(estrazione));
const formattazione = leggi("src/lib/gara-chat-prompt.ts");
atteso("la formattazione per il modello passa dal filtro", /const personale = personaleUscenteSicuro\(grezzo\);/.test(formattazione));

// Nessun altro punto deve trasformare le voci del personale in testo per il modello o per il
// documento: se ne comparisse uno nuovo, deve passare dal filtro e finire in questo elenco.
const consumatoriNoti = new Set([
  "src/app/actions/gara-extraction.ts", // salva (dopo il filtro)
  "src/app/actions/gara-chat.ts", // legge i dati e li passa a gara-chat-prompt
  "src/lib/gara-chat-prompt.ts", // formatta (con il filtro)
  "src/lib/evidenza-dati.ts", // solo conteggi e confronti numerici, nessun testo verso il modello
  "src/lib/valori-impresa.ts", // solo confronti numerici
  "src/lib/organigramma-fatti.ts", // solo il totale degli addetti
  "src/lib/personale-anonimo.ts", // il filtro stesso
]);
const trovati: string[] = [];
const visita = (dir: string) => {
  for (const voce of fs.readdirSync(path.join(__dirname, "..", dir), { withFileTypes: true })) {
    const relativo = `${dir}/${voce.name}`;
    if (voce.isDirectory()) visita(relativo);
    else if (/\.(ts|tsx)$/.test(voce.name) && /personale_uscente/.test(leggi(relativo))) trovati.push(relativo);
  }
};
visita("src");
uguale("nessun nuovo punto usa il personale uscente senza essere passato di qui", trovati.filter((f) => !consumatoriNoti.has(f)), []);

console.log("");
if (fallimenti.length > 0) {
  console.error(`${fallimenti.length} controlli falliti:\n - ${fallimenti.join("\n - ")}`);
  process.exit(1);
}
console.log("Tutti i controlli sono andati a buon fine.");
