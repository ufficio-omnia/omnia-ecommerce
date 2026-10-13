// Autotest di Prodotti e sconti, Knowledge base AI e Impostazioni: regole di prezzo e
// sconto, importi scritti all'italiana, riordino delle anteprime, nomi dei file per lo
// storage, controllo dell'IBAN dei dati bancari e collegamenti di sicurezza di pagine
// e azioni. Gratuito, nessun database né rete: gira nel livello 1, quindi in prebuild.
import fs from "fs";
import path from "path";
import { IBAN_DI_ESEMPIO, eIbanDiEsempio, erroreIban, normalizzaIban } from "../src/lib/console/iban";
import {
  ERRORE_IMPORTO,
  erroreSconto,
  errorePrezzoConSconto,
  giudicaAnteprima,
  leggiDatiNuovoProdotto,
  leggiImporto,
  leggiOrdineFile,
  nomeFileSicuro,
  riepilogoProdotti,
  riordinaVoci,
} from "../src/lib/console/prodotti-calcoli";

const fallimenti: string[] = [];
function atteso(nome: string, ok: boolean, dettaglio = "") {
  console.log(`${ok ? "ok    " : "FALLITO"} ${nome}${ok ? "" : ` — ${dettaglio}`}`);
  if (!ok) fallimenti.push(nome);
}
function uguale<T>(nome: string, ottenuto: T, previsto: T) {
  atteso(nome, JSON.stringify(ottenuto) === JSON.stringify(previsto), `ottenuto ${JSON.stringify(ottenuto)}, previsto ${JSON.stringify(previsto)}`);
}
const leggi = (relativo: string) => fs.readFileSync(path.join(__dirname, "..", relativo), "utf-8").replace(/\r\n/g, "\n");

console.log("--- Importi scritti dall'admin ---");
uguale("«399», «399,5», «399.50» e «1.5» sono importi", [leggiImporto("399"), leggiImporto("399,5"), leggiImporto("399.50"), leggiImporto(" 1.5 ")], [399, 399.5, 399.5, 1.5]);
uguale("zero, negativo, vuoto, testo e notazione scientifica non lo sono", ["0", "0,00", "-5", "", "abc", "1e3", "12,3,4", "12 €"].map((v) => leggiImporto(v)), [null, null, null, null, null, null, null, null]);
uguale("più di due decimali si rifiuta (niente arrotondamenti silenziosi)", [leggiImporto("10,999"), leggiImporto("0,001")], [null, null]);
uguale("oltre il massimo (100.000) si rifiuta; il massimo stesso no", [leggiImporto("100000"), leggiImporto("100000,01"), leggiImporto("1000000")], [100000, null, null]);
uguale("assente o nullo", [leggiImporto(null), leggiImporto(undefined)], [null, null]);
atteso("il messaggio d'errore dice come scrivere un importo", /due decimali/.test(ERRORE_IMPORTO) && /399,50/.test(ERRORE_IMPORTO));

console.log("--- Nuovo prodotto ---");
const valido = leggiDatiNuovoProdotto({ titolo: "  Pacchetto PREMIUM  ", categoria: " Servizi ", prezzo: "399,00", descrizione: " Il pacchetto completo " });
uguale("campi ripuliti, categoria e descrizione vuote diventano nulle", [valido, leggiDatiNuovoProdotto({ titolo: "X", categoria: "", prezzo: "10", descrizione: "  " })], [{ dati: { titolo: "Pacchetto PREMIUM", categoria: "Servizi", prezzo: 399, descrizione: "Il pacchetto completo" } }, { dati: { titolo: "X", categoria: null, prezzo: 10, descrizione: null } }]);
atteso("titolo vuoto, prezzo non valido e testi troppo lunghi si rifiutano con un motivo", [
  leggiDatiNuovoProdotto({ titolo: "  ", categoria: "", prezzo: "10", descrizione: "" }),
  leggiDatiNuovoProdotto({ titolo: "X", categoria: "", prezzo: "gratis", descrizione: "" }),
  leggiDatiNuovoProdotto({ titolo: "X".repeat(201), categoria: "", prezzo: "10", descrizione: "" }),
  leggiDatiNuovoProdotto({ titolo: "X", categoria: "C".repeat(101), prezzo: "10", descrizione: "" }),
  leggiDatiNuovoProdotto({ titolo: "X", categoria: "", prezzo: "10", descrizione: "D".repeat(2001) }),
].every((e) => "errore" in e && e.errore.length > 10));

console.log("--- Sconti ---");
uguale("lo sconto deve essere minore del listino: minore va bene, uguale o maggiore no", [erroreSconto(399, 299), erroreSconto(399, 399) !== null, erroreSconto(399, 400) !== null], [null, true, true]);
atteso("il rifiuto nomina il prezzo di listino", /399,00/.test(erroreSconto(399, 450) ?? ""));
uguale("alzare il prezzo di un prodotto in sconto va bene; scendere sotto lo sconto no", [errorePrezzoConSconto(450, true, 399), errorePrezzoConSconto(399, true, 399) !== null, errorePrezzoConSconto(350, true, 399) !== null], [null, true, true]);
uguale("senza sconto attivo il prezzo è libero (anche sotto un vecchio prezzo scontato)", [errorePrezzoConSconto(100, false, 399), errorePrezzoConSconto(100, true, null)], [null, null]);

console.log("--- Riepilogo del catalogo ---");
const catalogo = [
  { attivo: true, prezzo: 399, scontoAttivo: true, file: 3, ordini: 2 },
  { attivo: true, prezzo: 99, scontoAttivo: false, file: 0, ordini: 0 },
  { attivo: false, prezzo: 49, scontoAttivo: true, file: 0, ordini: 1 },
];
uguale("totale, attivi, disattivati, in sconto (solo tra gli attivi) e senza file (solo tra gli attivi)", riepilogoProdotti(catalogo), { totale: 3, attivi: 2, disattivati: 1, inSconto: 1, attiviSenzaFile: 1 });
uguale("catalogo vuoto", riepilogoProdotti([]), { totale: 0, attivi: 0, disattivati: 0, inSconto: 0, attiviSenzaFile: 0 });

console.log("--- File e anteprime ---");
uguale("ordine di un file: intero 0-999, altrimenti il predefinito", [leggiOrdineFile("3", 0), leggiOrdineFile("", 5), leggiOrdineFile("-1", 5), leggiOrdineFile("1000", 5), leggiOrdineFile("2,5", 5), leggiOrdineFile("x", 5), leggiOrdineFile(null, 7)], [3, 5, 5, 5, 5, 5, 7]);
uguale("nome per lo storage: ogni carattere non ammesso (spazio, parentesi, accento) diventa un «_»", [nomeFileSicuro("Piano di lavoro (v2) è pronto.xlsx"), nomeFileSicuro("già-fatto_2026.pdf")], ["Piano_di_lavoro__v2____pronto.xlsx", "gi_-fatto_2026.pdf"]);
{
  const lungo = nomeFileSicuro(`${"a".repeat(300)}.xlsx`);
  atteso("un nome lunghissimo si accorcia tenendo l'estensione", lungo.length === 100 && lungo.endsWith(".xlsx"));
}
uguale("anteprima accettata: JPG, PNG e WebP fino a 3 MB", [giudicaAnteprima({ name: "a.jpg", size: 1000, type: "image/jpeg" }), giudicaAnteprima({ name: "a.png", size: 3 * 1024 * 1024, type: "image/png" }), giudicaAnteprima({ name: "a.webp", size: 10, type: "image/webp" })], [null, null, null]);
atteso("anteprima rifiutata con il motivo: vuota, formato, peso", giudicaAnteprima({ name: "a.jpg", size: 0, type: "image/jpeg" }) === "file vuoto" && /formato/.test(giudicaAnteprima({ name: "a.gif", size: 10, type: "image/gif" }) ?? "") && /3 MB/.test(giudicaAnteprima({ name: "a.jpg", size: 3 * 1024 * 1024 + 1, type: "image/jpeg" }) ?? ""));

console.log("--- Riordino delle anteprime ---");
const galleria = [{ id: "a", sort_order: 0 }, { id: "b", sort_order: 1 }, { id: "c", sort_order: 2 }];
uguale("«b» su: a e b si scambiano, c resta", riordinaVoci(galleria, "b", "up"), [{ id: "b", sort_order: 0 }, { id: "a", sort_order: 1 }]);
uguale("«a» giù: a e b si scambiano", riordinaVoci(galleria, "a", "down"), [{ id: "b", sort_order: 0 }, { id: "a", sort_order: 1 }]);
uguale("la prima non sale, l'ultima non scende, una voce sconosciuta non si sposta", [riordinaVoci(galleria, "a", "up"), riordinaVoci(galleria, "c", "down"), riordinaVoci(galleria, "zzz", "up")], [null, null, null]);
uguale("un'unica anteprima non si sposta", riordinaVoci([{ id: "a", sort_order: 0 }], "a", "down"), null);
// con numeri uguali o con buchi lo scambio dei soli numeri non funzionava: si rinumera tutto
uguale("numeri con buchi (0, 5, 9): «c» su → 0, 1, 2 nell'ordine a, c, b", riordinaVoci([{ id: "a", sort_order: 0 }, { id: "b", sort_order: 5 }, { id: "c", sort_order: 9 }], "c", "up"), [{ id: "c", sort_order: 1 }, { id: "b", sort_order: 2 }]);
{
  const ugualiTutte = [{ id: "a", sort_order: 0 }, { id: "b", sort_order: 0 }, { id: "c", sort_order: 0 }];
  const cambi = riordinaVoci(ugualiTutte, "c", "up");
  uguale("tre anteprime con lo stesso numero: lo spostamento produce comunque un ordine pulito", cambi, [{ id: "c", sort_order: 1 }, { id: "b", sort_order: 2 }]);
}

console.log("--- IBAN dei dati bancari ---");
uguale("IBAN validi di paesi diversi (con le cifre di controllo giuste)", ["IT60X0542811101000000123456", "DE89370400440532013000", "GB82WEST12345698765432", "FR1420041010050500013M02606", "ES9121000418450200051332"].map((i) => erroreIban(i)), [null, null, null, null, null]);
uguale("spazi, minuscole e trattini si tollerano", [erroreIban("it60 x054 2811 1010 0000 0123 456"), erroreIban("IT60-X054-2811-1010-0000-0123-456")], [null, null]);
atteso("un refuso (una cifra cambiata) è scoperto dalla cifra di controllo", /cifra di controllo/.test(erroreIban("IT60X0542811101000000123457") ?? ""), String(erroreIban("IT60X0542811101000000123457")));
atteso("due cifre scambiate sono scoperte", erroreIban("IT60X0542811101000000123465") !== null);
atteso("lunghezza sbagliata per un IBAN italiano (27)", /27 caratteri/.test(erroreIban("IT60X054281110100000012345") ?? ""));
atteso("vuoto e formato errato dicono cosa non va", /Inserisci/.test(erroreIban("  ") ?? "") && /formato/.test(erroreIban("12345") ?? "") && /formato/.test(erroreIban("IT6X") ?? ""));
uguale("normalizzazione", normalizzaIban(" it60 x054-2811.1010 0000 0123 456 "), "IT60X0542811101000000123456");
uguale("l'IBAN di esempio della migrazione 0029 è riconosciuto in qualunque scrittura, uno vero no", [eIbanDiEsempio(IBAN_DI_ESEMPIO), eIbanDiEsempio("it60 x054 2811 1010 0000 0123 456"), eIbanDiEsempio("DE89370400440532013000")], [true, true, false]);
atteso("l'IBAN di esempio è, tecnicamente, valido: lo segnala il confronto, non il controllo", erroreIban(IBAN_DI_ESEMPIO) === null);
atteso("la migrazione 0029 contiene proprio quell'IBAN di esempio", leggi("supabase/migrations/0029_bank_settings.sql").includes(IBAN_DI_ESEMPIO));

console.log("--- Sicurezza: azioni ---");
for (const file of ["src/app/site-console/azioni/prodotti.ts", "src/app/site-console/azioni/impostazioni.ts", "src/app/site-console/azioni/knowledge-base.ts"]) {
  const testo = leggi(file);
  const funzioni = testo.split(/^export async function /m).slice(1);
  atteso(`${file.split("/").pop()}: «use server» e solo funzioni asincrone e tipi in esportazione`, testo.startsWith('"use server"') && !/^export (const|let|var|function|default) /m.test(testo) && funzioni.length > 0);
  for (const f of funzioni) {
    const nome = f.split("(")[0];
    const guardia = f.indexOf("await richiediAdminAzione()");
    atteso(`${file.split("/").pop()} · ${nome}: richiediAdminAzione prima di tutto`, guardia >= 0 && guardia < f.search(/createAdminClient\(\)|leggiProdotto\(|formData\.get/), `posizione ${guardia}`);
  }
}
const azioniProdotti = leggi("src/app/site-console/azioni/prodotti.ts");
uguale("le azioni sui prodotti sono dodici", (azioniProdotti.match(/^export async function /gm) ?? []).length, 12);
atteso("ogni modifica invalida anche il catalogo pubblico (/prodotti) e la console", /revalidatePath\("\/site-console", "layout"\);\s*revalidatePath\("\/prodotti"\);/.test(azioniProdotti));
atteso("nessuna azione tace davanti a un errore: ogni scrittura riporta un errore all'utente", !/^\s*return;\s*$/m.test(azioniProdotti));
atteso("le chiavi (prodotto, file, anteprima) sono validate come UUID prima di toccare i dati", (azioniProdotti.match(/UUID\.test\(/g) ?? []).length >= 12);
atteso("sconto: si controlla che sia minore del listino PRIMA di scrivere, e un prezzo non scende sotto uno sconto attivo", /erroreSconto\(Number\(prodotto\.price\), scontato\)/.test(azioniProdotti) && /errorePrezzoConSconto\(/.test(azioniProdotti));
atteso("attiva/disattiva: lo stato voluto arriva dal modulo («attivo»), non è dedotto da quello attuale", /formData\.get\("attivo"\)/.test(azioniProdotti) && !/discount_active: !|active: !/.test(azioniProdotti));
{
  const elimina = azioniProdotti.slice(azioniProdotti.indexOf("export async function eliminaProdotto"), azioniProdotti.indexOf("// ───── Sconto"));
  atteso("elimina prodotto: rifiuta se ha ordini PRIMA di cancellare, e toglie dallo storage file e anteprime", elimina.indexOf('.eq("product_id", productId)') > 0 && elimina.indexOf("(count ?? 0) > 0") < elimina.indexOf('.from("products").delete()') && /remove\(documenti\)/.test(elimina) && /product-previews"\)\.remove\(anteprime\)/.test(elimina));
}
atteso("aggiungi file: peso massimo, prodotto esistente, nome sicuro e, se la riga non si salva, il file caricato si toglie", /PESO_MASSIMO_FILE_PRODOTTO/.test(azioniProdotti) && /leggiProdotto\(productId\)\)\) return/.test(azioniProdotti) && /nomeFileSicuro\(file\.name\)/.test(azioniProdotti) && /remove\(\[percorso\]\);\s*return \{ errore: "Il file è stato caricato ma non registrato/.test(azioniProdotti));
atteso("anteprime: ogni immagine è giudicata (formato, peso), gli scarti si dicono, il riordino rinumera tutto", /giudicaAnteprima\(f\)/.test(azioniProdotti) && /Non caricate:/.test(azioniProdotti) && /riordinaVoci\(/.test(azioniProdotti));
atteso("link del file: firmato per 60 secondi, con il nome per il download", /createSignedUrl\(file\.file_path, 60, \{ download: nome \}\)/.test(azioniProdotti));
atteso("nessun embed users(...) né uso del client di sessione: tutto con la service role", !/users\(/.test(azioniProdotti) && !/supabase\/server/.test(azioniProdotti));

const azioniImpostazioni = leggi("src/app/site-console/azioni/impostazioni.ts");
{
  const salva = azioniImpostazioni.slice(azioniImpostazioni.indexOf("export async function salvaDatiBancari"));
  atteso("dati bancari: l'IBAN si controlla (cifra di controllo) PRIMA di scrivere", salva.indexOf("erroreIban(iban)") > 0 && salva.indexOf("erroreIban(iban)") < salva.indexOf('.from("bank_settings")'));
  atteso("dati bancari: se nessuna riga viene aggiornata NON si dice «salvato»", /\.eq\("id", 1\)\s*\.select\("id"\)/.test(salva) && /data\.length === 0\) return \{ errore:/.test(salva));
  atteso("dati bancari: si invalida anche l'area riservata del cliente (/dashboard)", /revalidatePath\("\/dashboard"\)/.test(salva));
}

const azioniKb = leggi("src/app/site-console/azioni/knowledge-base.ts");
atteso("knowledge base: formato e peso del file controllati prima di caricare, e un documento non salvato non lascia il file nello storage", /isIndexableFile\(file\.name\)/.test(azioniKb) && /PESO_MASSIMO_BYTE/.test(azioniKb) && /remove\(\[filePath\]\)/.test(azioniKb));
atteso("knowledge base: un documento senza testo non si segna «pronto»", /stato: "errore", nota_stile: notaStile/.test(azioniKb));
atteso("knowledge base: eliminando un documento si tolgono anche le immagini estratte dallo storage", /knowledge_base_immagini"\)\.select\("storage_path"\)/.test(azioniKb) && /storage\.from\("knowledge-base"\)\.remove\(percorsi\)/.test(azioniKb));
atteso("knowledge base: le chiamate ai modelli restano registrate come costi di piattaforma (userId nullo)", (azioniKb.match(/userId: null/g) ?? []).length >= 3);

console.log("--- Sicurezza: pagine e viste ---");
for (const [file, lettura] of [
  ["src/app/site-console/(app)/prodotti/page.tsx", /await leggiProdotti\(/],
  ["src/app/site-console/(app)/knowledge-base/page.tsx", /await leggiKnowledgeBase\(/],
  ["src/app/site-console/(app)/impostazioni/page.tsx", /getBankDetails\(\)/],
] as const) {
  const testo = leggi(file);
  const admin = testo.indexOf("await richiediAdminPagina()");
  atteso(`${file.replace("src/app/site-console/(app)/", "")}: richiediAdminPagina prima di leggere i dati`, admin >= 0 && testo.search(lettura) > admin);
}
atteso("la pagina della knowledge base dichiara un maxDuration (l'elaborazione è sincrona)", /export const maxDuration = \d{3}/.test(leggi("src/app/site-console/(app)/knowledge-base/page.tsx")));
{
  const prodotti = leggi("src/app/site-console/_componenti/prodotti-vista.tsx");
  atteso("prodotti: le azioni distruttive (elimina prodotto, rimuovi file, elimina anteprima) chiedono conferma", /azione=\{eliminaProdotto\}[^>]*conferma=/.test(prodotti.replace(/\n\s*/g, " ")) && /azione=\{rimuoviFile\}[^>]*conferma=/.test(prodotti.replace(/\n\s*/g, " ")) && /azione=\{rimuoviAnteprima\}[^>]*conferma=/.test(prodotti.replace(/\n\s*/g, " ")));
  atteso("prodotti: un prodotto con ordini non si può eliminare dalla pagina (pulsante spento con la spiegazione)", /disabilitato=\{p\.ordini\.totali > 0\}/.test(prodotti));
  atteso("prodotti: un prodotto in catalogo senza file è segnalato", /senza file/.test(prodotti) && /attiviSenzaFile/.test(prodotti));
  atteso("prodotti: l'attiva/disattiva manda lo stato voluto", /attivo: String\(!p\.attivo\)/.test(prodotti));
  atteso("nessun HTML grezzo nelle viste nuove", !/dangerouslySetInnerHTML/.test(prodotti + leggi("src/app/site-console/_componenti/knowledge-base-vista.tsx") + leggi("src/app/site-console/_componenti/impostazioni-vista.tsx")));
}
{
  const kb = leggi("src/app/site-console/_componenti/knowledge-base-vista.tsx");
  atteso("knowledge base: eliminare e ricalcolare chiedono conferma", /azione=\{eliminaDocumento\}[^>]*conferma=/.test(kb.replace(/\n\s*/g, " ")) && /azione=\{ricalcolaStruttura\}[^>]*conferma=/.test(kb.replace(/\n\s*/g, " ")));
  atteso("knowledge base: i segnaposto si evidenziano per posizione, non con un test su un'espressione globale (stateful)", /i % 2 === 1/.test(kb) && !/\.test\(parte\)/.test(kb));
  atteso("knowledge base: un documento fermo da troppo si segnala", /MINUTI_ELABORAZIONE_SOSPETTA/.test(kb));
}
{
  const imp = leggi("src/app/site-console/_componenti/impostazioni-vista.tsx");
  atteso("impostazioni: l'IBAN di esempio e i dati vuoti sono segnalati in rosso, un IBAN non valido in giallo", /eIbanDiEsempio\(banca\.iban\)/.test(imp) && /quello di esempio/.test(imp) && /erroreIban\(banca\.iban\)/.test(imp));
  atteso("impostazioni: cambio e IVA usano la stessa azione della pagina Costi", /salvaParametri/.test(imp) && /from "\.\.\/azioni\/costi"/.test(imp));
}
const nav = leggi("src/app/site-console/_componenti/navigazione.ts");
atteso("le tre voci nuove della barra sono attive (non più «presto»)", ["/prodotti", "/knowledge-base", "/impostazioni"].every((h) => new RegExp(`href: "${h}", etichetta: "[^"]+", pronto: true`).test(nav)));

if (fallimenti.length > 0) {
  console.error(`\n${fallimenti.length} controllo/i fallito/i:\n- ${fallimenti.join("\n- ")}`);
  process.exit(1);
}
console.log("\nAutotest di prodotti, knowledge base e impostazioni: tutti i casi ok.");
