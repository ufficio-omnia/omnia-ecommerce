// Autotest di «Da fatturare» e «Crediti»: importi (imponibile e IVA), dati di
// fatturazione del cliente, esportazione CSV sicura, crediti venduti/consumati/
// residui/estinti, migrazione 0079 e collegamenti di sicurezza di pagine e azioni.
// Gratuito, nessun database né rete: gira nel livello 1, quindi in prebuild.
import fs from "fs";
import path from "path";
import { calcolaCrediti, ordinaCrediti } from "../src/lib/console/crediti-calcoli";
import {
  GIORNI_TERMINE_INDICATIVO,
  calcolaImporti,
  contaPerStato,
  costruisciCsv,
  csvCella,
  descrizioneCrediti,
  descrizioneIncasso,
  filtroPredefinito,
  giorniDallIncasso,
  leggiFiltroFattura,
  risolviDatiFatturazione,
  testoDaCopiare,
  type RigaFatturazione,
} from "../src/lib/console/fatturazione-calcoli";
import { calcolaPeriodo } from "../src/lib/console/periodo";
import { suggerimentoProva } from "../src/lib/console/prova";

const fallimenti: string[] = [];
function atteso(nome: string, ok: boolean, dettaglio = "") {
  console.log(`${ok ? "ok    " : "FALLITO"} ${nome}${ok ? "" : ` — ${dettaglio}`}`);
  if (!ok) fallimenti.push(nome);
}
function uguale<T>(nome: string, ottenuto: T, previsto: T) {
  atteso(nome, JSON.stringify(ottenuto) === JSON.stringify(previsto), `ottenuto ${JSON.stringify(ottenuto)}, previsto ${JSON.stringify(previsto)}`);
}
function vicino(nome: string, ottenuto: number | null, previsto: number, tolleranza = 0.0001) {
  atteso(nome, ottenuto !== null && Math.abs(ottenuto - previsto) <= tolleranza, `ottenuto ${ottenuto}, previsto ${previsto}`);
}
const leggi = (relativo: string) => fs.readFileSync(path.join(__dirname, "..", relativo), "utf-8").replace(/\r\n/g, "\n");

console.log("--- Importi: imponibile e IVA ---");
uguale("122 € IVA inclusa al 22 %: 100 + 22", calcolaImporti(122, null, null, 22), { lordo: 122, imponibile: 100, iva: 22, ivaDaStripe: false });
const starter = calcolaImporti(699, null, null, 22);
vicino("699 €: imponibile 572,95", starter.imponibile, 572.95);
vicino("699 €: IVA 126,05", starter.iva, 126.05);
atteso("imponibile + IVA = lordo, esattamente, anche con gli arrotondamenti", [699, 1490, 2900, 290, 1250, 349.99, 0.01].every((l) => Math.abs(calcolaImporti(l, null, null, 22).imponibile + calcolaImporti(l, null, null, 22).iva - l) < 1e-9));
uguale("con le imposte calcolate da Stripe si usano quelle", calcolaImporti(122, 22, 100, 22), { lordo: 122, imponibile: 100, iva: 22, ivaDaStripe: true });
uguale("imposta di Stripe a zero: non si fida (nessuna imposta calcolata), scorpora con l'aliquota", calcolaImporti(122, 0, 122, 22).ivaDaStripe, false);
uguale("senza imponibile di Stripe ma con l'imposta: imponibile = lordo - imposta", calcolaImporti(122, 22, null, 22).imponibile, 100);
uguale("aliquota diversa (10 %)", [calcolaImporti(110, null, null, 10).imponibile, calcolaImporti(110, null, null, 10).iva], [100, 10]);

console.log("--- Dati di fatturazione del cliente ---");
const profiloCompleto = { ragione_sociale: "Pulizie Rossi S.r.l.", partita_iva: "01234567890", codice_fiscale: null, indirizzo: "Via Roma 1, 00100 Roma", codice_sdi: "ABCDEFG", pec: null, buyer_type: "azienda" };
const completo = risolviDatiFatturazione(profiloCompleto, null, "x@example.com");
uguale("profilo completo: fonte profilo, nessun dato mancante", [completo.fonte, completo.mancanti], ["profilo", []]);
const snapshot = { nome: "Rossi Pulizie SRL", email: "amm@rossi.it", indirizzo: { riga1: "Via Milano 5", riga2: null, cap: "20100", citta: "Milano", provincia: "MI", paese: "IT" }, identificativi_fiscali: [{ tipo: "eu_vat", valore: "IT09876543210" }, { tipo: "it_cf", valore: "RSSMRA80A01H501U" }] };
const soloStripe = risolviDatiFatturazione(null, snapshot, "u@example.com");
uguale("senza profilo: dati da Stripe", [soloStripe.fonte, soloStripe.ragioneSociale, soloStripe.partitaIva, soloStripe.codiceFiscale, soloStripe.indirizzo], ["stripe", "Rossi Pulizie SRL", "IT09876543210", "RSSMRA80A01H501U", "Via Milano 5, 20100 Milano (MI), IT"]);
uguale("da Stripe non arrivano SDI né PEC: per un'azienda mancano (la fattura elettronica non si può inviare)", soloStripe.mancanti, ["codice SDI o PEC"]);
const misto = risolviDatiFatturazione({ ...profiloCompleto, partita_iva: null, indirizzo: null, codice_sdi: null, pec: "amm@pec.it" }, snapshot, null);
uguale("profilo con lacune completato da Stripe: fonte mista, il profilo ha la precedenza", [misto.fonte, misto.ragioneSociale, misto.partitaIva, misto.indirizzo, misto.pec], ["profilo+stripe", "Pulizie Rossi S.r.l.", "IT09876543210", "Via Milano 5, 20100 Milano (MI), IT", "amm@pec.it"]);
const nessuno = risolviDatiFatturazione(null, null, null);
uguale("nessun dato: fonte nessuna e quattro cose mancanti", [nessuno.fonte, nessuno.mancanti], ["nessuna", ["ragione sociale", "partita IVA o codice fiscale", "indirizzo", "codice SDI o PEC"]]);
const privato = risolviDatiFatturazione({ ragione_sociale: "Mario Bianchi", partita_iva: null, codice_fiscale: "BNCMRA80A01H501U", indirizzo: "Via Po 3, Torino", codice_sdi: null, pec: null, buyer_type: "consumatore" }, null, null);
uguale("un privato non ha bisogno di SDI né PEC", privato.mancanti, []);
uguale("stringhe vuote o di soli spazi valgono come assenti", risolviDatiFatturazione({ ...profiloCompleto, ragione_sociale: "   ", codice_sdi: "", pec: " " }, null, null).mancanti.includes("ragione sociale"), true);
uguale("un identificativo fiscale con valore nullo non rompe nulla", risolviDatiFatturazione(null, { ...snapshot, identificativi_fiscali: [{ tipo: "eu_vat", valore: "" }] }, null).partitaIva, null);

console.log("--- Righe, filtri, testi ---");
const riga = (o: Partial<RigaFatturazione> = {}): RigaFatturazione => ({
  chiave: "incasso:11111111-1111-1111-1111-111111111111", fonte: "incasso", data: "2026-10-01T10:00:00Z", descrizione: "Abbonamento OMNIA AI Starter: rinnovo", userId: "u", cliente: "Pulizie Rossi S.r.l.",
  importi: calcolaImporti(699, null, null, 22), prova: false, stato: "da_fatturare", numeroFattura: null, dataFattura: null, note: null, fatturaFile: false, numeroRicevuta: null, ricevutaUrl: null, dati: completo, giorni: 5, idStripe: "in_1", ...o,
});
uguale("descrizione di un rinnovo con il piano", descrizioneIncasso("rinnovo", "starter"), "Abbonamento OMNIA AI Starter: rinnovo");
uguale("descrizione di un conguaglio senza piano noto", descrizioneIncasso("conguaglio", null), "Abbonamento OMNIA AI: conguaglio per cambio piano");
uguale("descrizione dei crediti", [descrizioneCrediti("singola", 1), descrizioneCrediti("pacchetto5", 5)], ["Credito OMNIA AI (1 gara)", "Pacchetto 5 gare OMNIA AI"]);
uguale("conteggio per stato", contaPerStato([riga(), riga({ stato: "fatturata" }), riga({ stato: "non_dovuta" }), riga({ stato: "da_fatturare" })]), { da_fatturare: 2, fatturata: 1, non_dovuta: 1, tutte: 4 });
uguale("filtro: predefinito 'da fatturare', valori sconosciuti ignorati", [leggiFiltroFattura(undefined), leggiFiltroFattura("fatturata"), leggiFiltroFattura("tutte"), leggiFiltroFattura("; drop table")], ["da_fatturare", "fatturata", "tutte", "da_fatturare"]);
// Difetto segnalato dall'utente: «anche se premo Inclusi non vedo niente». I pagamenti di prova
// nascono 'non dovuti', quindi la scheda predefinita «Da fatturare» restava vuota.
uguale("dati di prova inclusi: la scheda predefinita diventa «Tutte», così i pagamenti di prova (non dovuti) si vedono", [leggiFiltroFattura(undefined, true), leggiFiltroFattura("", true), filtroPredefinito(true), filtroPredefinito(false)], ["tutte", "tutte", "tutte", "da_fatturare"]);
uguale("una scheda scelta a mano si rispetta anche con la prova inclusa", [leggiFiltroFattura("da_fatturare", true), leggiFiltroFattura("non_dovuta", true), leggiFiltroFattura("fatturata", false)], ["da_fatturare", "non_dovuta", "fatturata"]);
{
  const soloProva = [riga({ stato: "non_dovuta", prova: true }), riga({ stato: "non_dovuta", prova: true }), riga({ stato: "non_dovuta", prova: true })];
  const scheda = leggiFiltroFattura(undefined, true);
  const mostrate = scheda === "tutte" ? soloProva : soloProva.filter((r) => r.stato === scheda);
  uguale("con tre pagamenti di prova non dovuti e la prova inclusa, la pagina ne mostra tre (non zero)", mostrate.length, 3);
  uguale("con la prova nascosta la stessa situazione mostra «niente da fatturare»", soloProva.filter((r) => !r.prova && r.stato === leggiFiltroFattura(undefined, false)).length, 0);
}
uguale("giorni dall'incasso: giorni di calendario di Roma", [giorniDallIncasso("2026-10-01T10:00:00Z", new Date("2026-10-12T10:00:00Z")), giorniDallIncasso("2026-10-01T22:30:00Z", new Date("2026-10-02T10:00:00Z"))], [11, 0]);
uguale("l'incasso di oggi ha 0 giorni e un incasso futuro non va sotto zero", [giorniDallIncasso("2026-10-12T08:00:00Z", new Date("2026-10-12T10:00:00Z")), giorniDallIncasso("2026-10-20T08:00:00Z", new Date("2026-10-12T10:00:00Z"))], [0, 0]);
atteso(`il termine indicativo è ${GIORNI_TERMINE_INDICATIVO} giorni`, GIORNI_TERMINE_INDICATIVO === 12);
const copia = testoDaCopiare(riga());
atteso("testo da copiare: ragione sociale, P.IVA, SDI, descrizione, importi, data", copia.includes("Pulizie Rossi S.r.l.") && copia.includes("P.IVA 01234567890") && copia.includes("ABCDEFG") && copia.includes("Imponibile € 572,95 · IVA € 126,05 · Totale € 699,00") && copia.includes("Incassato il 01/10/2026"), copia);
atteso("testo da copiare per un privato: codice destinatario 0000000", testoDaCopiare(riga({ dati: privato })).includes("0000000"));

console.log("--- Esportazione CSV ---");
uguale("una cella con una formula viene neutralizzata (CSV injection)", [csvCella("=HYPERLINK(\"http://x\")"), csvCella("+390123"), csvCella("-2+3"), csvCella("@cmd")], ["\"'=HYPERLINK(\"\"http://x\"\")\"", "'+390123", "'-2+3", "'@cmd"]);
uguale("separatore, virgolette e a capo: la cella si racchiude tra virgolette", [csvCella("a;b"), csvCella('di "Rossi"'), csvCella("riga1\nriga2")], ['"a;b"', '"di ""Rossi"""', '"riga1\nriga2"']);
uguale("valori vuoti e numeri con la virgola decimale", [csvCella(null), csvCella(undefined), csvCella(12.5)], ["", "", "12,5"]);
const csv = costruisciCsv([riga({ cliente: "=cmd|' /C calc'!A0", dati: { ...completo, ragioneSociale: "=cmd|' /C calc'!A0" } }), riga({ chiave: "crediti:22222222-2222-2222-2222-222222222222", stato: "fatturata", numeroFattura: "2026/045", dataFattura: "2026-10-08" })]);
atteso("il CSV comincia con il BOM UTF-8", csv.startsWith("\uFEFF"));
const linee = csv.replace("\uFEFF", "").trimEnd().split("\r\n");
uguale("una riga di intestazione più una per riga, con ritorni a capo CRLF", linee.length, 3);
atteso("la formula nel nome del cliente è neutralizzata nel file", linee[1].includes("'=cmd") && !/(^|;)=cmd/.test(linee[1]), linee[1]);
atteso("importi con la virgola decimale e totale che somma", linee[1].includes("572,95;126,05;699,00"), linee[1]);
atteso("stato, numero e data della fattura nel CSV", linee[2].includes("fatturata;2026/045;08/10/2026"), linee[2]);
uguale("ogni riga ha lo stesso numero di colonne dell'intestazione", new Set(linee.map((l) => l.split(";").length)).size, 1);

console.log("--- Crediti ---");
const periodo = calcolaPeriodo({}, new Date("2026-10-12T10:00:00Z"));
const identita = new Map([["U1", { email: "uno@example.com", ragioneSociale: "Uno S.r.l." }], ["U2", { email: "due@example.com", ragioneSociale: null }], ["U3", { email: "tre@example.com", ragioneSociale: null }]]);
const cr = calcolaCrediti(
  {
    acquisti: [
      { user_id: "U1", crediti: 5, importo_centesimi: 125000, created_at: "2026-10-05T10:00:00Z", prova: false },
      { user_id: "U1", crediti: 1, importo_centesimi: 29000, created_at: "2026-08-10T10:00:00Z", prova: false },
      { user_id: "U2", crediti: 1, importo_centesimi: 29000, created_at: "2026-10-06T10:00:00Z", prova: true },
    ],
    consumi: [{ user_id: "U1", created_at: "2026-10-07T10:00:00Z" }, { user_id: "U1", created_at: "2026-08-20T10:00:00Z" }],
    saldi: [{ user_id: "U1", balance: 3 }, { user_id: "U3", balance: 2 }, { user_id: "U9", balance: 0 }],
    identita,
  },
  periodo,
  false,
);
const per = (id: string) => cr.righe.find((r) => r.userId === id);
uguale("U1: venduti 6 (5 nel periodo), consumati 2 (1 nel periodo), saldo 3", [per("U1")?.vendutiTotali, per("U1")?.acquistatiPeriodo, per("U1")?.consumatiTotali, per("U1")?.consumatiPeriodo, per("U1")?.saldo], [6, 5, 2, 1, 3]);
uguale("U1: estinti derivati = 6 - 2 - 3 = 1", [per("U1")?.estinti, per("U1")?.rettificheManuali], [1, 0]);
vicino("U1: importo del periodo 1.250 €", per("U1")?.importoPeriodo ?? null, 1250);
uguale("U2 (solo acquisti di prova) è nascosto e contato come prova", [per("U2"), cr.provaNascosti], [undefined, 1]);
uguale("U3: saldo 2 senza acquisti = crediti non spiegati dal registro (aggiunti a mano)", [per("U3")?.saldo, per("U3")?.estinti, per("U3")?.rettificheManuali], [2, 0, 2]);
atteso("un utente con saldo zero e nessuna attività non compare", per("U9") === undefined);
uguale("totali sui clienti visibili", [cr.totali.acquistatiPeriodo, cr.totali.consumatiPeriodo, cr.totali.saldoResiduo, cr.totali.vendutiTotali, cr.totali.estinti, cr.totali.rettificheManuali, cr.totali.clienti], [5, 1, 5, 6, 1, 2, 2]);
const crConProva = calcolaCrediti({ acquisti: [{ user_id: "U2", crediti: 1, importo_centesimi: 29000, created_at: "2026-10-06T10:00:00Z", prova: true }], consumi: [], saldi: [{ user_id: "U2", balance: 1 }], identita }, periodo, true);
uguale("con i dati di prova inclusi U2 compare, marcato come prova", [crConProva.righe.length, crConProva.righe[0].prova], [1, true]);
uguale("ordinamento per saldo: dal più alto", ordinaCrediti(cr.righe, "saldo").map((r) => r.userId), ["U1", "U3"]);
uguale("ordinamento per cliente: alfabetico per email", ordinaCrediti(cr.righe, "cliente").map((r) => r.email), ["tre@example.com", "uno@example.com"]);

console.log("--- Dati di prova: dove guardare ---");
const riepilogoProva = { voci: 3, da: "2026-09-12", a: "2026-09-20" };
uguale("prova inclusa ma nessun pagamento di prova nel periodo, e ce ne sono altrove: suggerimento con le date", suggerimentoProva({ includiProva: true, vociNelPeriodo: 0, riepilogo: riepilogoProva }), { voci: 3, da: "2026-09-12", a: "2026-09-20" });
uguale("prova inclusa e il periodo ne contiene: nessun suggerimento", suggerimentoProva({ includiProva: true, vociNelPeriodo: 2, riepilogo: riepilogoProva }), null);
uguale("prova nascosta: nessun suggerimento", suggerimentoProva({ includiProva: false, vociNelPeriodo: 0, riepilogo: riepilogoProva }), null);
uguale("nessun pagamento di prova in tutto: nessun suggerimento", suggerimentoProva({ includiProva: true, vociNelPeriodo: 0, riepilogo: { voci: 0, da: null, a: null } }), null);
const paginaRicavi = leggi("src/app/site-console/(app)/ricavi/page.tsx");
const paginaCosti = leggi("src/app/site-console/(app)/costi/page.tsx");
atteso("Ricavi e Costi suggeriscono dove sono i dati di prova quando il periodo non ne ha", /suggerimentoProva\(/.test(paginaRicavi) && /suggerimentoProva\(/.test(paginaCosti) && /provaAltrove/.test(leggi("src/app/site-console/_componenti/ricavi-vista.tsx")) && /provaAltrove/.test(leggi("src/app/site-console/_componenti/costi-vista.tsx")));
const paginaFatt = leggi("src/app/site-console/(app)/fatturazione/page.tsx");
atteso("la pagina «Da fatturare» passa lo stato della prova alla scelta della scheda", /leggiFiltroFattura\(parametri\.stato, includiProva\)/.test(paginaFatt));
atteso("dopo un aggiornamento si torna alla scheda in cui si lavorava (predefinita legata alla prova)", /filtro !== filtroPredefinito\(includiProva\)/.test(leggi("src/app/site-console/azioni/fatturazione.ts")));
atteso("il collegamento «Esporta CSV» porta sempre la scheda esplicita", /urlConParametri\("\/fatturazione\/esporta", \{ stato: filtro, prova:/.test(leggi("src/app/site-console/_componenti/fatturazione-vista.tsx")));

console.log("--- Migrazione 0079 ---");
const sql = leggi("supabase/migrations/0079_omnia_ai_stato_fattura.sql");
atteso("stato di fatturazione su incassi e acquisti di crediti, con tre stati e predefinito 'da_fatturare'", (sql.match(/add column if not exists stato_fattura text not null default 'da_fatturare'/g) ?? []).length === 2 && (sql.match(/check \(stato_fattura in \('da_fatturare', 'fatturata', 'non_dovuta'\)\)/g) ?? []).length === 2);
atteso("numero, data, note e chi/quando ha aggiornato, senza chiavi esterne", (sql.match(/add column if not exists numero_fattura text/g) ?? []).length === 2 && (sql.match(/add column if not exists data_fattura date/g) ?? []).length === 2 && !/references/.test(sql));
atteso("sul registro dei crediti l'update è concesso SOLO sulle colonne di fatturazione (importi immutabili)", /grant update \(stato_fattura, numero_fattura, data_fattura, note_fattura, fatturazione_aggiornata_il, fatturazione_aggiornata_da\)\s+on public\.omnia_ai_credit_purchases to service_role/.test(sql) && !/grant update on public\.omnia_ai_credit_purchases/.test(sql));
atteso("i pagamenti di prova nascono 'non_dovuta' con un trigger sull'inserimento (il webhook non deve conoscere queste colonne)", /before insert on public\.omnia_ai_incassi/.test(sql) && /before insert on public\.omnia_ai_credit_purchases/.test(sql) && /new\.livemode is false/.test(sql) && /starts_with\(new\.stripe_session_id, 'cs_test_'\)/.test(sql));
atteso("le righe di prova già presenti vengono sistemate, e solo se ancora 'da_fatturare'", (sql.match(/and stato_fattura = 'da_fatturare'/g) ?? []).length === 2);
const incassi = leggi("src/lib/omnia-ai-incassi.ts");
atteso("il webhook e il backfill non scrivono colonne della 0079 (continuano a funzionare prima della migrazione)", !/stato_fattura|numero_fattura/.test(incassi));
const webhook = leggi("src/app/api/webhooks/stripe/route.ts");
atteso("l'inserimento degli acquisti di crediti nel webhook non è stato toccato dalla fatturazione", !/stato_fattura/.test(webhook));

console.log("--- Sicurezza: azioni, pagine, esportazione ---");
const azioni = leggi("src/app/site-console/azioni/fatturazione.ts");
atteso("le due azioni partono da richiediAdminAzione prima di toccare i dati", (azioni.match(/await richiediAdminAzione\(\)/g) ?? []).length === 2 && azioni.indexOf("await richiediAdminAzione()") < azioni.indexOf("leggiModulo(formData, true)"));
atteso("le azioni aggiornano SOLO le colonne di fatturazione (nessun importo)", /\.update\(\{\s*stato_fattura: v\.stato,\s*numero_fattura: v\.numero,\s*data_fattura: v\.data,\s*note_fattura: v\.note,\s*fatturazione_aggiornata_il: adesso,\s*fatturazione_aggiornata_da: userId,\s*\.\.\.extra,\s*\}\)/.test(azioni) && !/importo|stripe_/.test(azioni.slice(azioni.indexOf(".update("), azioni.indexOf(".select(\"id\")"))));
atteso(
  "le uniche colonne in più sono quelle del PDF della fattura (percorso e data di caricamento), solo dal caricamento",
  /extra: \{ fattura_file_path: percorsoFatturaPagamento\(fonte, id\), fattura_caricata_il: [^}]*\}/.test(azioni) && (azioni.match(/\bextra\b/g) ?? []).length >= 4 && !/applica\(righe,[^)]*,[^)]*,[^)]+\)/.test(azioni),
);
atteso("'fatturata' richiede una data valida non futura; 'non dovuta' richiede una nota", /Indica la data della fattura/.test(azioni) && /dataRoma\(new Date\(\)\)/.test(azioni) && /scrivi nelle note perché/.test(azioni));
atteso("chiavi delle righe validate (uuid) e tabelle ammesse in lista chiusa", /const CHIAVE = \/\^\(incasso\|crediti\):/.test(azioni) && /const TABELLE = TABELLA_PER_FONTE;/.test(azioni) && /TABELLA_PER_FONTE = \{ incasso: "omnia_ai_incassi", crediti: "omnia_ai_credit_purchases" \} as const/.test(leggi("src/lib/omnia-ai-pagamenti.ts")));
atteso("l'azione multipla ha un massimo di righe", /MASSIMO_RIGHE = 200/.test(azioni) && /righe\.length > MASSIMO_RIGHE/.test(azioni));
for (const [file, lettura] of [
  ["src/app/site-console/(app)/fatturazione/page.tsx", /await leggiFatturazione\(/],
  ["src/app/site-console/(app)/fatturazione/esporta/route.ts", /await leggiFatturazione\(/],
  ["src/app/site-console/(app)/crediti/page.tsx", /await leggiCrediti\(/],
] as const) {
  const testo = leggi(file);
  const admin = testo.indexOf("await richiediAdminPagina()");
  atteso(`${file.replace("src/app/site-console/(app)/", "")}: richiediAdminPagina prima di leggere i dati`, admin >= 0 && testo.search(lettura) > admin);
}
const esporta = leggi("src/app/site-console/(app)/fatturazione/esporta/route.ts");
atteso("l'esportazione non va mai in cache e scarica come allegato CSV", /"cache-control": "no-store"/.test(esporta) && /content-disposition/.test(esporta) && /text\/csv/.test(esporta));
const layout = leggi("src/app/site-console/(app)/layout.tsx");
atteso("la barra laterale riceve il conteggio degli incassi da fatturare", /contaDaFatturare\(\)/.test(layout) && /daFatturare: daFatturare\?\.n/.test(layout));

if (fallimenti.length > 0) {
  console.error(`\n${fallimenti.length} controllo/i fallito/i:\n- ${fallimenti.join("\n- ")}`);
  process.exit(1);
}
console.log("\nAutotest di fatturazione e crediti: tutti i casi ok.");
