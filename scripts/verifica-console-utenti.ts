// Autotest di «Utenti» e della scheda cliente: costruzione dell'elenco (ordini,
// abbonamenti, crediti, messaggi, accettazioni legali), filtri e ordinamenti,
// stato della prova di accettazione, testi delle email, scadenza dell'abbonamento
// a mano e collegamenti di sicurezza di pagine e azioni.
// Gratuito, nessun database né rete: gira nel livello 1, quindi in prebuild.
import fs from "fs";
import path from "path";
import { escapeHtml, testoPerEmail } from "../src/lib/html";
import { aggiungiGiorni, mezzanotteRoma } from "../src/lib/console/periodo";
import {
  abbonamentiDaAnnullareSuStripe,
  conteggiPerTipo,
  costruisciRigheUtenti,
  descriviAccettazione,
  eAnonimizzato,
  filtraUtenti,
  leggiOrdineUtenti,
  leggiTipoUtente,
  messaggioAbbonamentoDaAnnullare,
  ordinaUtenti,
  statoProvaAbbonamento,
  statoProvaOrdine,
  type AccessoUtente,
  type AccettazioneScheda,
  type DatiElencoUtenti,
} from "../src/lib/console/utenti-calcoli";

const fallimenti: string[] = [];
function atteso(nome: string, ok: boolean, dettaglio = "") {
  console.log(`${ok ? "ok    " : "FALLITO"} ${nome}${ok ? "" : ` — ${dettaglio}`}`);
  if (!ok) fallimenti.push(nome);
}
function uguale<T>(nome: string, ottenuto: T, previsto: T) {
  atteso(nome, JSON.stringify(ottenuto) === JSON.stringify(previsto), `ottenuto ${JSON.stringify(ottenuto)}, previsto ${JSON.stringify(previsto)}`);
}
const leggi = (relativo: string) => fs.readFileSync(path.join(__dirname, "..", relativo), "utf-8").replace(/\r\n/g, "\n");

const ADESSO = new Date("2026-10-13T10:00:00Z");

console.log("--- Account anonimizzati ---");
uguale("l'indirizzo prodotto dall'anonimizzazione è riconosciuto", eAnonimizzato("cliente-anonimizzato-1a2b3c4d@omniaitalia.invalid"), true);
uguale("un'email vera non lo è, neppure se contiene la parola", [eAnonimizzato("cliente-anonimizzato-1a2b3c4d@omniaitalia.com"), eAnonimizzato("mario@omniaitalia.invalid"), eAnonimizzato("x-cliente-anonimizzato-1@omniaitalia.invalid"), eAnonimizzato(null), eAnonimizzato("")], [false, false, false, false, false]);

console.log("--- Elenco: una riga per utente ---");
const U1 = "11111111-1111-1111-1111-111111111111";
const U2 = "22222222-2222-2222-2222-222222222222";
const U3 = "33333333-3333-3333-3333-333333333333";
const U4 = "44444444-4444-4444-4444-444444444444";
const U5 = "55555555-5555-5555-5555-555555555555";
const accessi = new Map<string, AccessoUtente>([
  [U1, { ultimoAccesso: "2026-10-12T08:00:00Z", bannato: false }],
  [U5, { ultimoAccesso: null, bannato: true }],
]);
const dati: DatiElencoUtenti = {
  utenti: [
    { id: U1, email: "uno@example.com", role: "cliente", created_at: "2026-09-01T10:00:00Z" },
    { id: U2, email: "due@example.com", role: "cliente", created_at: "2026-09-10T10:00:00Z" },
    { id: U3, email: "tre@example.com", role: "cliente", created_at: "2026-09-20T10:00:00Z" },
    { id: U4, email: "admin@example.com", role: "admin", created_at: "2026-08-01T10:00:00Z" },
    { id: U5, email: "cliente-anonimizzato-55555555@omniaitalia.invalid", role: "cliente", created_at: "2026-07-01T10:00:00Z" },
  ],
  aziende: [{ user_id: U1, ragione_sociale: "Pulizie Rossi S.r.l.", partita_iva: "01234567890", codice_fiscale: null, buyer_type: "azienda" }, { user_id: U2, ragione_sociale: "Mario Bianchi", partita_iva: null, codice_fiscale: "BNCMRA80A01H501U", buyer_type: "consumatore" }],
  ordini: [
    { id: "o1", user_id: U1, status: "pagato", total_amount: 399, created_at: "2026-09-02T10:00:00Z" },
    { id: "o2", user_id: U1, status: "pagato", total_amount: "100.50", created_at: "2026-09-03T10:00:00Z" },
    { id: "o3", user_id: U1, status: "in_attesa", total_amount: 50, created_at: "2026-09-04T10:00:00Z" },
    { id: "o4", user_id: U5, status: "pagato", total_amount: 20, created_at: "2026-07-02T10:00:00Z" },
  ],
  // o1 ha la prova; o2, o3 e o4 no
  ordiniConAccettazioni: new Set(["o1"]),
  abbonamenti: [
    // U1: abbonamento Stripe attivo con prova, preceduto da uno scaduto
    { id: "a0", user_id: U1, plan: "starter", status: "annullato", stripe_subscription_id: "sub_vecchio", created_at: "2026-05-01T10:00:00Z", current_period_end: "2026-06-01T00:00:00Z", cancel_at_period_end: false, livemode: true },
    { id: "a1", user_id: U1, plan: "Professional", status: "attivo", stripe_subscription_id: "sub_1", created_at: "2026-09-05T10:00:00Z", current_period_end: "2026-11-05T00:00:00Z", cancel_at_period_end: true, livemode: true },
    // U2: abbonamento creato a mano, nessuna prova prevista
    { id: "a2", user_id: U2, plan: "enterprise", status: "attivo", stripe_subscription_id: null, created_at: "2026-09-11T10:00:00Z", current_period_end: null, cancel_at_period_end: false, livemode: null },
    // U3: Stripe di prova senza accettazioni
    { id: "a3", user_id: U3, plan: "starter", status: "attivo", stripe_subscription_id: "sub_3", created_at: "2026-09-21T10:00:00Z", current_period_end: "2026-11-21T00:00:00Z", cancel_at_period_end: false, livemode: false },
  ],
  abbonamentiConAccettazioni: new Set(["a1"]),
  crediti: [{ user_id: U1, balance: 3 }, { user_id: U3, balance: 0 }],
  messaggi: [
    // U1: l'ultimo messaggio è del cliente (nell'elenco i messaggi non sono ordinati)
    { user_id: U1, sender: "cliente", created_at: "2026-10-10T10:00:00Z" },
    { user_id: U1, sender: "admin", created_at: "2026-10-09T10:00:00Z" },
    { user_id: U1, sender: "cliente", created_at: "2026-10-08T10:00:00Z" },
    // U2: l'ultimo è dell'admin
    { user_id: U2, sender: "cliente", created_at: "2026-10-01T10:00:00Z" },
    { user_id: U2, sender: "admin", created_at: "2026-10-02T10:00:00Z" },
  ],
  accessi,
};
const righe = costruisciRigheUtenti(dati, ADESSO);
const riga = (id: string) => righe.find((r) => r.id === id)!;
uguale("una riga per utente, nell'ordine ricevuto", righe.map((r) => r.id), [U1, U2, U3, U4, U5]);
uguale("U1: ordini 3, pagati 2, pagato 499,50 (importi testuali compresi), 2 senza accettazioni", [riga(U1).ordini.totale, riga(U1).ordini.pagati, riga(U1).ordini.pagatoLordo, riga(U1).ordini.senzaAccettazioni], [3, 2, 499.5, 2]);
uguale("U1: l'abbonamento mostrato è l'ULTIMO (non il primo) e il piano è normalizzato in minuscolo", [riga(U1).abbonamento?.piano, riga(U1).abbonamento?.righe], ["professional", 2]);
uguale("U1: attivo, in disdetta (la disdetta vale solo per un abbonamento attivo)", [riga(U1).abbonamento?.stato, riga(U1).abbonamento?.inDisdetta, riga(U1).abbonamento?.manuale, riga(U1).abbonamento?.prova], ["attivo", true, false, false]);
uguale("U1: l'abbonamento annullato precedente (Stripe, senza prova) conta come mancante", riga(U1).abbonamentiSenzaAccettazioni, 1);
uguale("U1: accettazioni mancanti = 2 ordini + 1 abbonamento", riga(U1).accettazioniMancanti, 3);
uguale("U1: saldo crediti, ultimo accesso, azienda", [riga(U1).saldoCrediti, riga(U1).ultimoAccesso, riga(U1).azienda, riga(U1).tipoCliente], [3, "2026-10-12T08:00:00Z", "Pulizie Rossi S.r.l.", "azienda"]);
uguale("U1: da rispondere (l'ultimo messaggio per data è del cliente, anche se non è l'ultimo della lista)", riga(U1).daRispondere, true);
uguale("U2: abbonamento a mano — nessuna accettazione da cercare, quindi nessuna mancante", [riga(U2).abbonamento?.manuale, riga(U2).abbonamentiSenzaAccettazioni, riga(U2).accettazioniMancanti], [true, 0, 0]);
uguale("U2: l'ultimo messaggio è dell'admin: non da rispondere. Consumatore riconosciuto", [riga(U2).daRispondere, riga(U2).tipoCliente], [false, "consumatore"]);
uguale("U3: abbonamento di prova con Stripe e senza accettazioni: prova e 1 mancante", [riga(U3).abbonamento?.prova, riga(U3).accettazioniMancanti], [true, 1]);
uguale("U4: admin senza attività, mai acceduto", [riga(U4).ruolo, riga(U4).ordini.totale, riga(U4).abbonamento, riga(U4).ultimoAccesso, riga(U4).accettazioniMancanti], ["admin", 0, null, null, 0]);
uguale("U5: anonimizzato e bloccato, con un ordine senza prova", [riga(U5).anonimizzato, riga(U5).bannato, riga(U5).accettazioniMancanti], [true, true, 1]);
uguale("un utente senza profilo azienda: azienda nulla", [riga(U3).azienda, riga(U3).tipoCliente], [null, null]);
uguale("senza dati: nessuna riga e nessun errore", costruisciRigheUtenti({ ...dati, utenti: [] }, ADESSO), []);
{
  // abbonamento scaduto da più di 30 giorni = cessato; scaduto da meno = sola lettura
  const base = { id: "x", user_id: U3, plan: "starter", status: "attivo", stripe_subscription_id: "sub_x", created_at: "2026-01-01T00:00:00Z", cancel_at_period_end: false, livemode: true };
  const sola = costruisciRigheUtenti({ ...dati, abbonamenti: [{ ...base, current_period_end: "2026-10-01T00:00:00Z" }] }, ADESSO).find((r) => r.id === U3)!;
  const cessato = costruisciRigheUtenti({ ...dati, abbonamenti: [{ ...base, current_period_end: "2026-08-01T00:00:00Z" }] }, ADESSO).find((r) => r.id === U3)!;
  uguale("scaduto da pochi giorni: sola lettura, e non «in disdetta» anche se la disdetta era richiesta", [sola.abbonamento?.stato, sola.abbonamento?.inDisdetta], ["sola_lettura", false]);
  uguale("scaduto da oltre 30 giorni: cessato", cessato.abbonamento?.stato, "cessato");
}

console.log("--- Filtri e ordinamenti ---");
uguale("conteggi per tipo", conteggiPerTipo(righe), { tutti: 5, online: 0, ecommerce: 2, omnia_ai: 3, ufficio_gare: 0, da_rispondere: 1, senza_accettazioni: 3, senza_attivita: 0, admin: 1 });
uguale("filtro «Con ordini»", filtraUtenti(righe, "ecommerce", "").map((r) => r.id), [U1, U5]);
uguale("filtro «Con abbonamento AI»", filtraUtenti(righe, "omnia_ai", "").map((r) => r.id), [U1, U2, U3]);
uguale("filtro «Da rispondere»", filtraUtenti(righe, "da_rispondere", "").map((r) => r.id), [U1]);
uguale("filtro «Senza accettazioni»", filtraUtenti(righe, "senza_accettazioni", "").map((r) => r.id), [U1, U3, U5]);
uguale("filtro «Admin»", filtraUtenti(righe, "admin", "").map((r) => r.id), [U4]);
uguale("«Senza attività» esclude gli admin e chi ha ordini o abbonamenti", filtraUtenti(righe, "senza_attivita", "").map((r) => r.id), []);
uguale("ricerca per email, senza distinguere maiuscole", filtraUtenti(righe, "tutti", "  DUE@exam").map((r) => r.id), [U2]);
uguale("ricerca per ragione sociale", filtraUtenti(righe, "tutti", "rossi").map((r) => r.id), [U1]);
uguale("ricerca per inizio dell'identificativo, non per un pezzo in mezzo", [filtraUtenti(righe, "tutti", "3333").map((r) => r.id), filtraUtenti(righe, "tutti", "-3333").map((r) => r.id)], [[U3], []]);
uguale("ricerca e tipo si combinano", filtraUtenti(righe, "ecommerce", "uno").map((r) => r.id), [U1]);
uguale("tipo e ordine sconosciuti (parametri dell'indirizzo) tornano al predefinito", [leggiTipoUtente("; drop table"), leggiTipoUtente(undefined), leggiTipoUtente("admin"), leggiOrdineUtenti("x"), leggiOrdineUtenti(undefined), leggiOrdineUtenti("email"), leggiOrdineUtenti("accesso")], ["tutti", "tutti", "admin", "registrazione", "registrazione", "email", "accesso"]);
uguale("ordine per registrazione: dal più recente", ordinaUtenti(righe, "registrazione").map((r) => r.id), [U3, U2, U1, U4, U5]);
uguale("ordine per accesso: chi ha acceduto prima, chi non ha mai acceduto in fondo (dal più recente iscritto)", ordinaUtenti(righe, "accesso").map((r) => r.id), [U1, U3, U2, U4, U5]);
uguale("ordine per email: alfabetico", ordinaUtenti(righe, "email").map((r) => r.email), ["admin@example.com", "cliente-anonimizzato-55555555@omniaitalia.invalid", "due@example.com", "tre@example.com", "uno@example.com"]);
atteso("l'ordinamento non modifica l'elenco ricevuto", righe[0].id === U1 && righe.length === 5);

console.log("--- Prova di accettazione ---");
const acc: AccettazioneScheda = { tipo: "condizioni_e_privacy", quando: "2026-09-02T09:00:00Z", ip: "203.0.113.7", userAgent: "Mozilla/5.0", documento: { tipo: "condizioni_vendita", versione: 3, sha256: "a".repeat(64), inVigoreDal: "2026-01-01" } };
uguale("ordine: con accettazioni registrata, senza mancante", [statoProvaOrdine([acc]), statoProvaOrdine([])], ["registrata", "mancante"]);
uguale("abbonamento con Stripe: registrata o mancante", [statoProvaAbbonamento(false, [acc]), statoProvaAbbonamento(false, [])], ["registrata", "mancante"]);
uguale("abbonamento a mano: «non prevista», non «mancante»; se per caso ha accettazioni, registrata", [statoProvaAbbonamento(true, []), statoProvaAbbonamento(true, [acc])], ["non_prevista", "registrata"]);
uguale("descrizione di un'accettazione: cosa, documento e versione", descriviAccettazione(acc), "Condizioni e privacy · Condizioni generali di vendita v3");
uguale("accettazione con documento non trovato: lo si dice", descriviAccettazione({ ...acc, documento: null }), "Condizioni e privacy · documento non trovato");
uguale("tipi sconosciuti restano leggibili (nessun errore)", descriviAccettazione({ ...acc, tipo: "nuovo_tipo", documento: { ...acc.documento!, tipo: "nuovo_documento" } }), "nuovo_tipo · nuovo_documento v3");

console.log("--- Testi per le email ---");
uguale("il testo del cliente o dell'admin non diventa markup", escapeHtml(`<script>alert("x")</script> & 'ok'`), "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; 'ok'");
uguale("a capo diventano <br> dopo la neutralizzazione", testoPerEmail("riga 1\r\nriga <2>\nriga 3"), "riga 1<br>riga &lt;2&gt;<br>riga 3");
uguale("«&amp;» scritto dall'utente non si raddoppia in modo ambiguo: la & iniziale viene sempre neutralizzata", escapeHtml("&amp;"), "&amp;amp;");

console.log("--- Abbonamento a mano: scadenza ---");
// «Valido fino al 31/12» vuol dire fino alla mezzanotte che CHIUDE il 31, non all'inizio del 31.
uguale("fine giornata d'inverno (CET): 31/12 → 23:00 UTC", mezzanotteRoma(aggiungiGiorni("2026-12-31", 1)).toISOString(), "2026-12-31T23:00:00.000Z");
uguale("fine giornata d'estate (CEST): 31/07 → 22:00 UTC", mezzanotteRoma(aggiungiGiorni("2026-07-31", 1)).toISOString(), "2026-07-31T22:00:00.000Z");
uguale("passaggio all'ora legale (25/10/2026): il 25 dura 25 ore, la fine è 00:00 del 26 = 23:00 UTC", mezzanotteRoma(aggiungiGiorni("2026-10-25", 1)).toISOString(), "2026-10-25T23:00:00.000Z");

console.log("--- Abbonamenti Stripe da annullare prima di eliminare o anonimizzare ---");
{
  const sub = (plan: string, status: string, stripe: string | null, livemode: boolean | null) => ({ plan, status, stripe_subscription_id: stripe, livemode });
  const blocca = (r: ReturnType<typeof sub>) => abbonamentiDaAnnullareSuStripe([r]).length === 1;
  uguale("abbonamento live attivo: blocca", blocca(sub("starter", "attivo", "sub_1", true)), true);
  uguale("abbonamento live annullato: non blocca", blocca(sub("starter", "annullato", "sub_1", true)), false);
  uguale("abbonamento di prova attivo: non blocca", blocca(sub("starter", "attivo", "sub_2", false)), false);
  uguale("livemode nullo (sconosciuto) e attivo: blocca", blocca(sub("starter", "attivo", "sub_3", null)), true);
  uguale("senza stripe_subscription_id (creato a mano) e attivo: non blocca", [blocca(sub("starter", "attivo", null, null)), blocca(sub("starter", "attivo", null, true)), blocca(sub("starter", "attivo", "", true))], [false, false, false]);
  uguale("live «scaduto»: blocca (il database può essere indietro rispetto a Stripe, un pagamento può essere in nuovo tentativo)", blocca(sub("starter", "scaduto", "sub_4", true)), true);
  uguale("livemode nullo e annullato: non blocca", blocca(sub("starter", "annullato", "sub_5", null)), false);
  uguale("stato sconosciuto: nel dubbio blocca", blocca(sub("starter", "qualcosa_di_nuovo", "sub_6", true)), true);
  uguale("nessuna riga: niente da annullare", abbonamentiDaAnnullareSuStripe([]), []);
  {
    // storia reale: un abbonamento di prova vecchio, uno live annullato, uno live attivo
    const storia = [sub("starter", "attivo", "sub_prova", false), sub("starter", "annullato", "sub_vecchio", true), sub("Professional", "attivo", "sub_vero", true)];
    uguale("in una storia mista restano solo quelli da annullare, con le righe intatte", abbonamentiDaAnnullareSuStripe(storia).map((r) => r.stripe_subscription_id), ["sub_vero"]);
    uguale("l'elenco ricevuto non viene modificato", storia.length, 3);
  }
  const uno = messaggioAbbonamentoDaAnnullare([sub("Professional", "attivo", "sub_vero", true)], "eliminare");
  atteso("messaggio: dice che va annullato da Stripe prima, il piano (nome del catalogo) e l'azione rifiutata", /annullalo prima da Stripe/.test(uno) && /«Professional»/.test(uno) && /potrai eliminare l'account/.test(uno) && /non è stato toccato/.test(uno), uno);
  const due = messaggioAbbonamentoDaAnnullare([sub("starter", "attivo", "sub_a", true), sub("starter", "scaduto", "sub_b", null), sub("enterprise", "attivo", "sub_c", true)], "anonimizzare");
  atteso("messaggio con più abbonamenti: quanti sono e i piani, senza ripetere lo stesso", /ha 3 abbonamenti OMNIA AI non annullati \(«Starter», «Enterprise»\)/.test(due) && /potrai anonimizzare l'account/.test(due), due);
  atteso("messaggio con un piano fuori catalogo: lo si dice com'è scritto nel database", /«vecchio-piano»/.test(messaggioAbbonamentoDaAnnullare([sub("vecchio-piano", "attivo", "sub_x", true)], "eliminare")));
}

console.log("--- Sicurezza: azioni ---");
const azioniUtenti = leggi("src/app/site-console/azioni/utenti.ts");
const funzioni = azioniUtenti.split(/^export async function /m).slice(1);
uguale("le azioni sulla scheda sono quattro", funzioni.map((f) => f.split("(")[0]).sort(), ["anonimizzaUtente", "eliminaUtente", "impostaAbbonamentoManuale", "rispondiAlCliente"]);
for (const f of funzioni) {
  const nome = f.split("(")[0];
  const guardia = f.indexOf("await richiediAdminAzione()");
  atteso(`${nome}: richiediAdminAzione è la prima cosa, prima di qualunque lettura o scrittura`, guardia >= 0 && guardia < f.search(/createAdminClient\(\)|leggiBersaglio\(|formData\.get/), `posizione ${guardia}`);
}
const soloAzioniAsync = azioniUtenti.slice(azioniUtenti.indexOf("export async function rispondiAlCliente"));
atteso("il file delle azioni è «use server» e non esporta altro che funzioni asincrone e tipi", azioniUtenti.startsWith('"use server"') && !/^export (const|let|var|function) /m.test(azioniUtenti) && soloAzioniAsync.length > 0);
atteso("la risposta al cliente: lunghezza massima, utente non anonimizzato, testo neutralizzato nell'email", /LUNGHEZZA_MASSIMA_MESSAGGIO/.test(azioniUtenti) && /eAnonimizzato\(cliente\.email\)/.test(azioniUtenti) && /\$\{testoPerEmail\(testo\)\}/.test(azioniUtenti) && !/\$\{testo\}/.test(azioniUtenti));
atteso("la risposta parte con mittente 'admin' e l'email porta al sito dell'e-commerce, non alla console", /sender: "admin"/.test(azioniUtenti) && /\$\{BASE_URL\}\/dashboard\/messaggi/.test(azioniUtenti) && !/CONSOLE_BASE_URL/.test(azioniUtenti));
atteso("abbonamento a mano: piano dal catalogo (non testo libero), stato in lista chiusa, data validata", /normalizzaPianoSlug\(/.test(azioniUtenti) && /!\(piano in PIANI\)/.test(azioniUtenti) && /STATI_ABBONAMENTO\.includes\(stato\)/.test(azioniUtenti) && /GIORNO\.test\(fine\)/.test(azioniUtenti));
atteso("abbonamento a mano: si rifiuta se l'ultimo abbonamento è gestito da Stripe", /if \(ultima\?\.stripe_subscription_id\)/.test(azioniUtenti));
atteso("abbonamento a mano: la scadenza è la fine della giornata a Roma", /mezzanotteRoma\(aggiungiGiorni\(giorno, 1\)\)/.test(azioniUtenti));
atteso("elimina e anonimizza: mai il proprio account, mai un altro admin, utente valido", /userId === sessioneId/.test(azioniUtenti) && /data\.role === "admin"/.test(azioniUtenti) && /UUID\.test\(userId\)/.test(azioniUtenti));
{
  const elimina = funzioni.find((f) => f.startsWith("eliminaUtente"))!;
  const controllo = elimina.indexOf('.eq("status", "pagato")');
  const cancellazione = elimina.indexOf("auth.admin.deleteUser");
  atteso("elimina utente: controlla ordini pagati, incassi veri e crediti acquistati PRIMA di cancellare", controllo > 0 && elimina.indexOf("omnia_ai_incassi") > 0 && elimina.indexOf("omnia_ai_credit_purchases") > 0 && cancellazione > controllo && /conteggio > 0/.test(elimina));
  atteso("elimina utente: se il controllo non riesce non si tocca l'account", /if \(ordiniPagati\.error\)/.test(elimina) && elimina.indexOf("if (ordiniPagati.error)") < cancellazione);
  atteso("elimina utente: i file delle fatture si tolgono dallo storage", /storage\.from\("invoices"\)\.remove\(percorsi\)/.test(elimina));
  // l'abbonamento Stripe non terminato blocca: dopo la guardia admin e i controlli su sé stessi/altro admin, prima di ogni lettura contabile e di ogni scrittura
  const controlloStripe = elimina.indexOf('controllaAbbonamentiStripe(bersaglio.id, "eliminare")');
  atteso(
    "elimina utente: rifiuta se c'è un abbonamento Stripe non annullato, dopo i controlli su sé stessi/altro admin e prima di qualunque scrittura",
    controlloStripe > elimina.indexOf("leggiBersaglio(") && controlloStripe > elimina.indexOf('typeof bersaglio === "string"') && controlloStripe > 0 && controlloStripe < elimina.indexOf("createAdminClient()") && controlloStripe < elimina.indexOf("omnia_ai_incassi") && controlloStripe < elimina.indexOf("auth.admin.deleteUser") && controlloStripe < elimina.indexOf("storage.from") && /if \(abbonamentoStripe\) return \{ errore: abbonamentoStripe \}/.test(elimina),
  );
}
{
  const anonimizza = funzioni.find((f) => f.startsWith("anonimizzaUtente"))!;
  atteso("anonimizza: email .invalid, password casuale, accesso bloccato, dati di fatturazione tolti", /@omniaitalia\.invalid/.test(anonimizza) && /randomUUID\(\)/.test(anonimizza) && /ban_duration/.test(anonimizza) && /from\("companies"\)\.delete\(\)/.test(anonimizza));
  atteso("anonimizza: non lo si fa due volte", /eAnonimizzato\(bersaglio\.email\)/.test(anonimizza));
  const controlloStripe = anonimizza.indexOf('controllaAbbonamentiStripe(bersaglio.id, "anonimizzare")');
  atteso(
    "anonimizza: rifiuta se c'è un abbonamento Stripe non annullato, dopo i controlli già presenti e prima di toccare account, profilo e dati di fatturazione",
    controlloStripe > anonimizza.indexOf('typeof bersaglio === "string"') && controlloStripe > anonimizza.indexOf("eAnonimizzato(bersaglio.email)") && controlloStripe > 0 && controlloStripe < anonimizza.indexOf("createAdminClient()") && controlloStripe < anonimizza.indexOf("auth.admin.updateUserById") && controlloStripe < anonimizza.indexOf('from("users").update') && controlloStripe < anonimizza.indexOf('from("companies").delete()') && /if \(abbonamentoStripe\) return \{ errore: abbonamentoStripe \}/.test(anonimizza),
  );
  atteso("anonimizza: l'indirizzo prodotto è riconosciuto dal riconoscimento usato nell'elenco", eAnonimizzato("cliente-anonimizzato-12345678@omniaitalia.invalid"));
}
{
  // la funzione che legge gli abbonamenti dell'utente: solo righe con Stripe, ripiego senza la colonna livemode (e allora nel dubbio si blocca), errore = rifiuto
  const inizio = azioniUtenti.indexOf("async function controllaAbbonamentiStripe(");
  const controllo = azioniUtenti.slice(inizio, azioniUtenti.indexOf("export async function eliminaUtente"));
  atteso("controllo Stripe: legge subscriptions dell'utente con stripe_subscription_id non nullo e il filtro puro decide", inizio > 0 && /from\("subscriptions"\)/.test(controllo) && /\.eq\("user_id", userId\)/.test(controllo) && /\.not\("stripe_subscription_id", "is", null\)/.test(controllo) && /abbonamentiDaAnnullareSuStripe\(righe\)/.test(controllo));
  atteso("controllo Stripe: senza la colonna livemode (migrazione 0078) ripiega e tratta tutto come sconosciuto, quindi blocca", /schemaAssente\(risposta\.error\)/.test(controllo) && /colonnaDisponibile \? \(r\.livemode \?\? null\) : null/.test(controllo));
  atteso("controllo Stripe: se la lettura fallisce si rifiuta senza toccare nulla", /if \(risposta\.error\) \{[^}]*return "[^"]*non è stato toccato/.test(controllo));
  atteso("controllo Stripe: la console non chiama Stripe (solo rifiuto)", !/from "stripe"|@\/lib\/stripe|createStripeClient/.test(azioniUtenti));
}
const azioniOrdini = leggi("src/app/site-console/azioni/ordini.ts");
atteso("ritorno alla scheda: solo «/utenti/<uuid>», mai un indirizzo qualunque", /const RITORNO_SCHEDA = \/\^\\\/utenti\\\/\[0-9a-f\]\{8\}/.test(azioniOrdini) && /RITORNO_SCHEDA\.test\(ritorno\) \? ritorno : predefinita/.test(azioniOrdini));
{
  // il redirect aperto sarebbe possibile se «ritorno» fosse usato senza la regola
  const RITORNO = /^\/utenti\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  uguale("la regola accetta la scheda di un utente", RITORNO.test(`/utenti/${U1}`), true);
  uguale("la regola respinge indirizzi esterni, relativi al protocollo e percorsi diversi", ["https://evil.example/", "//evil.example", `/utenti/${U1}/../..`, `/utenti/${U1}?x=1`, "/ordini", "/utenti/non-un-uuid", `/utenti/${U1}\n`].map((v) => RITORNO.test(v)), [false, false, false, false, false, false, false]);
}
{
  const link = azioniOrdini.slice(azioniOrdini.indexOf("export async function ottieniLinkFattura"));
  atteso("link della fattura: admin per prima cosa, id ordine validato, link firmato di 60 secondi", link.indexOf("await richiediAdminAzione()") >= 0 && link.indexOf("await richiediAdminAzione()") < link.indexOf("createAdminClient()") && /createSignedUrl\(fattura\.file_path, 60\)/.test(link) && /\[0-9a-f\]\{8\}/.test(link));
}

console.log("--- Sicurezza: lettura e pagine ---");
const lettura = leggi("src/lib/console/utenti.ts");
atteso("nessun «users(...)» senza suggerimento (PGRST201 con paid_by): in questo file la tabella users si legge sempre per nome", !/users\(/.test(lettura));
atteso("la lettura dei dati usa la service role e non una sessione dell'utente", /createAdminClient\(\)/.test(lettura) && !/supabase\/server/.test(lettura));
for (const [file, lettura2] of [
  ["src/app/site-console/(app)/utenti/page.tsx", /await leggiElencoUtenti\(/],
  ["src/app/site-console/(app)/utenti/[id]/page.tsx", /await leggiScheda\(/],
] as const) {
  const testo = leggi(file);
  const admin = testo.indexOf("await richiediAdminPagina()");
  atteso(`${file.replace("src/app/site-console/(app)/", "")}: richiediAdminPagina prima di leggere i dati`, admin >= 0 && testo.search(lettura2) > admin);
}
{
  const scheda = leggi("src/app/site-console/(app)/utenti/[id]/page.tsx");
  atteso("la scheda: identificativo validato come UUID, altrimenti 404", /const UUID = \/\^\[0-9a-f\]\{8\}/.test(scheda) && /if \(!UUID\.test\(id\)\) notFound\(\)/.test(scheda));
  atteso("la scheda sa chi guarda (per non offrire di eliminare sé stessi)", /idSessione=\{sessione\.userId\}/.test(scheda));
}
atteso("nessun HTML grezzo nelle viste: i testi dei clienti (messaggi, user agent) si mostrano come testo", !/dangerouslySetInnerHTML/.test(leggi("src/app/site-console/_componenti/scheda-cliente-vista.tsx")) && !/dangerouslySetInnerHTML/.test(leggi("src/app/site-console/_componenti/utenti-vista.tsx")));
atteso("le azioni distruttive chiedono conferma prima di partire", (leggi("src/app/site-console/_componenti/scheda-cliente-vista.tsx").match(/conferma=/g) ?? []).length >= 3 && /window\.confirm\(conferma\)/.test(leggi("src/app/site-console/_componenti/pulsante-azione.tsx")));
atteso("il pulsante «Scarica» apre la scheda nel clic, prima di aspettare il server", /window\.open\("about:blank", "_blank"\)/.test(leggi("src/app/site-console/_componenti/pulsante-apri-link.tsx")) && /<PulsanteApriLink azione=\{ottieniLinkFattura\} campi=\{\{ orderId: o\.id \}\}/.test(leggi("src/app/site-console/_componenti/scheda-cliente-vista.tsx")));
const layout = leggi("src/app/site-console/(app)/layout.tsx");
atteso("la barra laterale riceve le conversazioni da rispondere", /contaMessaggiDaRispondere\(\)/.test(layout) && /messaggi: messaggi \?\? undefined/.test(layout));
atteso("la voce «Utenti» della barra è attiva (non più «presto»)", /href: "\/utenti", etichetta: "Utenti", pronto: true/.test(leggi("src/app/site-console/_componenti/navigazione.ts")));
atteso("nessun collegamento alla console dai due siti pubblici dentro la scheda (le email vanno all'e-commerce)", !/CONSOLE_BASE_URL/.test(azioniUtenti));

if (fallimenti.length > 0) {
  console.error(`\n${fallimenti.length} controllo/i fallito/i:\n- ${fallimenti.join("\n- ")}`);
  process.exit(1);
}
console.log("\nAutotest di utenti e scheda cliente: tutti i casi ok.");
