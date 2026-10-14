// Autotest di incassi, ricavi e abbonamenti OMNIA AI: da fattura Stripe a riga di
// incasso, aggregazione dei ricavi per dominio e per mese, metriche degli
// abbonamenti, e collegamenti del webhook. Gratuito, nessun database né rete (un
// client Supabase finto): gira nel livello 1, quindi in prebuild.
import fs from "fs";
import path from "path";
import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { calcolaMetriche, statoAbbonamento, type AbbonamentoDb } from "../src/lib/console/abbonamenti-calcoli";
import { assemblaClienti } from "../src/lib/console/costi-calcoli";
import { calcolaPeriodo } from "../src/lib/console/periodo";
import { aggregaRicavi, type VoceRicavo } from "../src/lib/console/ricavi-calcoli";
import { collegaIncassiASubscription, incassoDaFattura, registraIncassoDaFattura, schemaAssente, tipoIncasso } from "../src/lib/omnia-ai-incassi";

const fallimenti: string[] = [];
function atteso(nome: string, ok: boolean, dettaglio = "") {
  console.log(`${ok ? "ok    " : "FALLITO"} ${nome}${ok ? "" : ` — ${dettaglio}`}`);
  if (!ok) fallimenti.push(nome);
}
function uguale<T>(nome: string, ottenuto: T, previsto: T) {
  atteso(nome, JSON.stringify(ottenuto) === JSON.stringify(previsto), `ottenuto ${JSON.stringify(ottenuto)}, previsto ${JSON.stringify(previsto)}`);
}
function vicino(nome: string, ottenuto: number | null, previsto: number, tolleranza = 0.005) {
  atteso(nome, ottenuto !== null && Math.abs(ottenuto - previsto) <= tolleranza, `ottenuto ${ottenuto}, previsto ${previsto}`);
}
const leggi = (relativo: string) => fs.readFileSync(path.join(__dirname, "..", relativo), "utf-8").replace(/\r\n/g, "\n");

// ───── Da fattura Stripe a incasso ─────
console.log("--- Fattura Stripe → incasso ---");
const fattura = (o: Record<string, unknown> = {}): Stripe.Invoice =>
  ({
    id: "in_1",
    amount_paid: 69900,
    currency: "EUR",
    billing_reason: "subscription_create",
    created: 1_790_000_000,
    status_transitions: { paid_at: 1_790_000_100 },
    parent: { subscription_details: { subscription: "sub_1" } },
    customer: "cus_1",
    customer_name: "  Pulizie Rossi S.r.l.  ",
    customer_email: "amm@pulizie-rossi.it",
    customer_phone: "",
    customer_address: { line1: "Via Roma 1", line2: null, postal_code: "00100", city: "Roma", state: "RM", country: "IT" },
    customer_tax_ids: [{ type: "eu_vat", value: "IT01234567890" }, { type: "it_cf", value: null }],
    number: "ABCD-0001",
    hosted_invoice_url: "https://invoice.stripe.com/i/x",
    ...o,
  }) as unknown as Stripe.Invoice;

const primo = incassoDaFattura(fattura(), false);
uguale("primo pagamento: tipo, importo lordo, valuta in minuscolo, di prova", [primo?.tipo, primo?.importo_lordo_centesimi, primo?.valuta, primo?.livemode], ["primo", 69900, "eur", false]);
uguale("senza imposte calcolate da Stripe: imposta e imponibile restano nulli (non si finge che sia tutto imponibile)", [primo?.imposta_centesimi, primo?.imponibile_centesimi], [null, null]);
uguale("la data di incasso è quella del pagamento, non quella di creazione della fattura", primo?.pagato_il, new Date(1_790_000_100 * 1000).toISOString());
uguale("snapshot cliente: nome ripulito, telefono vuoto → null, indirizzo e partita IVA", [primo?.cliente_snapshot?.nome, primo?.cliente_snapshot?.telefono, primo?.cliente_snapshot?.indirizzo?.citta, primo?.cliente_snapshot?.identificativi_fiscali], ["Pulizie Rossi S.r.l.", null, "Roma", [{ tipo: "eu_vat", valore: "IT01234567890" }]]);
uguale("numero e link della ricevuta Stripe", [primo?.numero_ricevuta, primo?.ricevuta_url], ["ABCD-0001", "https://invoice.stripe.com/i/x"]);
uguale("tipi: ciclo = rinnovo, cambio piano = conguaglio, altro = altro", [tipoIncasso("subscription_cycle"), tipoIncasso("subscription_update"), tipoIncasso("manual"), tipoIncasso(undefined)], ["rinnovo", "conguaglio", "altro", "altro"]);
const conImposte = incassoDaFattura(fattura({ total_taxes: [{ amount: 12606 }], total_excluding_tax: 57294 }), true);
uguale("con imposte calcolate da Stripe: si registrano imposta e imponibile", [conImposte?.imposta_centesimi, conImposte?.imponibile_centesimi, conImposte?.livemode], [12606, 57294, true]);
uguale("fattura a zero (prova gratuita, sconto totale): non è un incasso", incassoDaFattura(fattura({ amount_paid: 0 }), true), null);
uguale("fattura senza abbonamento: ignorata", incassoDaFattura(fattura({ parent: null }), true), null);
uguale("subscription come oggetto invece che come id", incassoDaFattura(fattura({ parent: { subscription_details: { subscription: { id: "sub_9" } } } }), true)?.stripe_subscription_id, "sub_9");
uguale("senza data di pagamento ripiega sulla creazione", incassoDaFattura(fattura({ status_transitions: {} }), true)?.pagato_il, new Date(1_790_000_000 * 1000).toISOString());

console.log("--- Registrazione dell'incasso (client finto) ---");
type Chiamata = { tabella: string; op: string; valori?: unknown; filtri: [string, unknown][] };
function clienteFinto(config: { subscriptionUserId?: string | null; erroreInsert?: { code?: string; message: string } | null }) {
  const chiamate: Chiamata[] = [];
  const client = {
    from(tabella: string) {
      const c: Chiamata = { tabella, op: "select", filtri: [] };
      const b = {
        select() { return b; },
        insert(valori: unknown) { c.op = "insert"; c.valori = valori; chiamate.push(c); return Promise.resolve({ error: config.erroreInsert ?? null }); },
        update(valori: unknown) { c.op = "update"; c.valori = valori; return b; },
        eq(col: string, val: unknown) { c.filtri.push([col, val]); return b; },
        is(col: string, val: unknown) { c.filtri.push([`${col} is`, val]); return b; },
        maybeSingle() { chiamate.push(c); return Promise.resolve({ data: config.subscriptionUserId ? { user_id: config.subscriptionUserId } : null, error: null }); },
        then(risolvi: (r: unknown) => unknown) { chiamate.push(c); return risolvi({ error: null }); },
      };
      return b;
    },
  };
  return { client: client as unknown as SupabaseClient, chiamate };
}
async function main() {
  {
    const { client, chiamate } = clienteFinto({ subscriptionUserId: "u-1" });
    const esito = await registraIncassoDaFattura(client, fattura(), false);
    const insert = chiamate.find((c) => c.op === "insert");
    atteso("incasso registrato con l'utente della subscription", esito.stato === "registrato" && (insert?.valori as { user_id: string })?.user_id === "u-1", JSON.stringify(esito));
    atteso("la riga porta stripe_invoice_id (chiave dell'idempotenza) e livemode", (insert?.valori as { stripe_invoice_id: string; livemode: boolean })?.stripe_invoice_id === "in_1" && (insert?.valori as { livemode: boolean })?.livemode === false);
  }
  {
    const { client, chiamate } = clienteFinto({ subscriptionUserId: null });
    const esito = await registraIncassoDaFattura(client, fattura(), true);
    atteso("subscription non ancora creata (evento arrivato prima): incasso registrato senza utente, si aggancerà dopo", esito.stato === "registrato" && (chiamate.find((c) => c.op === "insert")?.valori as { user_id: null })?.user_id === null, JSON.stringify(esito));
  }
  uguale("evento ripetuto (violazione di unicità 23505): duplicato, nessun errore", (await registraIncassoDaFattura(clienteFinto({ erroreInsert: { code: "23505", message: "duplicate key" } }).client, fattura(), true)).stato, "duplicato");
  uguale("tabella non ancora creata (PGRST205): tabella_assente, l'evento non va ritentato all'infinito", (await registraIncassoDaFattura(clienteFinto({ erroreInsert: { code: "PGRST205", message: "Could not find the table" } }).client, fattura(), true)).stato, "tabella_assente");
  uguale("errore del database: errore (il webhook risponde 500 e Stripe riprova)", (await registraIncassoDaFattura(clienteFinto({ erroreInsert: { code: "08006", message: "connessione persa" } }).client, fattura(), true)).stato, "errore");
  uguale("fattura non di abbonamento: ignorata, nessuna scrittura", (await registraIncassoDaFattura(clienteFinto({}).client, fattura({ parent: null }), true)).stato, "ignorato");
  uguale("riconoscimento di colonna/tabella mancante", [schemaAssente({ code: "PGRST204" }), schemaAssente({ code: "42703" }), schemaAssente({ code: "42P01" }), schemaAssente({ code: "23505" }), schemaAssente(null)], [true, true, true, false, false]);
  {
    const { client, chiamate } = clienteFinto({});
    await collegaIncassiASubscription(client, "sub_1", "u-1");
    const u = chiamate.find((c) => c.op === "update");
    atteso("aggancio degli incassi alla subscription: solo quelli ancora senza utente", JSON.stringify(u?.filtri) === JSON.stringify([["stripe_subscription_id", "sub_1"], ["user_id is", null]]) && (u?.valori as { user_id: string })?.user_id === "u-1", JSON.stringify(u));
  }

  // ───── Ricavi ─────
  console.log("--- Ricavi per dominio e per mese ---");
  const ottobre = calcolaPeriodo({}, new Date("2026-10-12T10:00:00Z"));
  const voce = (o: Partial<VoceRicavo>): VoceRicavo => ({ dominio: "ecommerce", fonte: "ordine", data: "2026-10-05T10:00:00Z", lordo: 122, impostaStripe: null, prova: false, dataApprossimata: false, ...o });
  const voci: VoceRicavo[] = [
    voce({}), // e-commerce 122 lordi = 100 netti (aliquota)
    voce({ data: "2026-10-06T10:00:00Z", dataApprossimata: true, lordo: 61 }), // bonifico senza data di conferma
    voce({ dominio: "omnia_ai", fonte: "abbonamento", lordo: 699, impostaStripe: 126.05 }), // imposta di Stripe
    voce({ dominio: "omnia_ai", fonte: "abbonamento", lordo: 1490, prova: true, data: "2026-10-07T10:00:00Z" }), // di prova
    voce({ dominio: "omnia_ai", fonte: "crediti", lordo: 290, prova: true, data: "2026-10-08T10:00:00Z" }), // di prova
    voce({ dominio: "omnia_ai", fonte: "crediti", lordo: 122, data: "2026-10-09T10:00:00Z" }), // vero
    voce({ data: "2026-09-30T22:30:00Z", lordo: 244 }), // 00:30 del 1 ottobre a Roma: è di OTTOBRE
    voce({ data: "2026-09-30T21:30:00Z", lordo: 500 }), // 23:30 del 30 settembre a Roma: fuori dal periodo
  ];
  const senzaProva = aggregaRicavi(voci, ottobre, 22, false);
  vicino("e-commerce: ordini di ottobre 122 + 61 + 244 lordi, 150 netti col 22 %", senzaProva.totali.ecommerceNetto, (122 + 61 + 244) / 1.22);
  uguale("e-commerce: 3 ordini (quello delle 23:30 di settembre è escluso, quello delle 00:30 di ottobre dentro)", senzaProva.totali.ecommerceOrdini, 3);
  vicino("abbonamenti AI: netto dall'imposta di Stripe (699 - 126,05), non dall'aliquota", senzaProva.totali.abbonamentiNetto, 699 - 126.05);
  vicino("crediti AI: solo quello vero (122 lordi → 100 netti)", senzaProva.totali.creditiNetto, 100);
  vicino("totale netto = e-commerce + AI", senzaProva.totali.netto, (122 + 61 + 244) / 1.22 + (699 - 126.05) + 100);
  uguale("dati di prova esclusi dai totali ma contati: 2 voci, 1780 € lordi", [senzaProva.prova.voci, senzaProva.prova.lordo, senzaProva.prova.incluse], [2, 1780, false]);
  uguale("ordini con data di pagamento approssimata: 1", senzaProva.dateApprossimate, 1);
  uguale("netto scorporato con l'aliquota in almeno una voce: segnalato", senzaProva.ivaStimata, true);
  const conProva = aggregaRicavi(voci, ottobre, 22, true);
  vicino("con i dati di prova inclusi il totale lordo cresce di 1780", conProva.totali.lordo - senzaProva.totali.lordo, 1780);
  uguale("il mese di ottobre ha tutti i valori; una sola riga mensile per un periodo di un mese", [senzaProva.perMese.length, senzaProva.perMese[0].mese], [1, "2026-10"]);
  vicino("il totale del mese = totale del periodo", senzaProva.perMese[0].totale, senzaProva.totali.netto);
  const anno = aggregaRicavi([voce({ data: "2026-02-10T10:00:00Z" }), voce({ data: "2026-04-10T10:00:00Z" })], calcolaPeriodo({ p: "anno" }, new Date("2026-10-12T10:00:00Z")), 22, false);
  uguale("periodo annuale: dodici righe mensili, anche vuote", anno.perMese.length, 12);
  uguale("i mesi senza ricavi hanno zero (non mancano)", [anno.perMese[2].mese, anno.perMese[2].totale], ["2026-03", 0]);
  vicino("febbraio ha il suo ordine", anno.perMese[1].ecommerce, 100);

  // ───── Abbonamenti ─────
  console.log("--- Metriche degli abbonamenti ---");
  const adesso = new Date("2026-10-12T10:00:00Z");
  const sub = (o: Partial<AbbonamentoDb>): AbbonamentoDb => ({
    user_id: "U", plan: "starter", status: "attivo", stripe_subscription_id: "sub_x", created_at: "2026-08-01T09:00:00Z",
    current_period_end: "2026-11-01T09:00:00Z", cancel_at_period_end: false, livemode: true, disdetta_richiesta_il: null, terminata_il: null, ...o,
  });
  const righe: AbbonamentoDb[] = [
    sub({ user_id: "U1" }), // attivo da agosto
    sub({ user_id: "U2", plan: "professional", created_at: "2026-10-05T09:00:00Z", current_period_end: "2026-11-05T09:00:00Z" }), // nuovo in ottobre
    sub({ user_id: "U3", plan: "enterprise", created_at: "2026-07-01T09:00:00Z", current_period_end: "2026-10-20T09:00:00Z", cancel_at_period_end: true, disdetta_richiesta_il: "2026-10-03T12:00:00Z" }), // in disdetta
    sub({ user_id: "U4", status: "annullato", created_at: "2026-07-20T09:00:00Z", current_period_end: "2026-09-20T09:00:00Z" }), // sola lettura
    sub({ user_id: "U5", status: "annullato", created_at: "2026-06-20T09:00:00Z", current_period_end: "2026-08-20T09:00:00Z" }), // cessato dal 19 settembre
    sub({ user_id: "U6", stripe_subscription_id: null }), // creato a mano
    sub({ user_id: "U7", livemode: false }), // di prova
  ];
  const ott = calcolaMetriche(righe, calcolaPeriodo({}, adesso), adesso, false);
  uguale("fotografia di oggi: 3 attivi (U1, U2, U3), 1 in sola lettura, 1 cessato", [ott.attivi, ott.solaLettura, ott.cessati], [3, 1, 1]);
  uguale("in disdetta: solo U3", ott.inDisdetta, 1);
  uguale("nuovi in ottobre: solo U2", ott.nuovi, 1);
  uguale("disdette richieste in ottobre (U3, il 3): 1", ott.disdetteRichieste, 1);
  uguale("esclusi: 1 di prova (U7) e 1 creato a mano (U6)", ott.esclusi, { prova: 1, manuali: 1 });
  vicino("MRR da listino lordo: 699 + 1490 + 2900", ott.mrrLordo, 5089);
  uguale("a inizio ottobre erano attivi U1 e U3; nessuno perso fino a oggi: abbandono 0", [ott.attiviInizioPeriodo, ott.persi, ott.abbandono], [2, 0, 0]);
  uguale("nessun cessato in ottobre (U5 è cessato a settembre)", ott.cessatiNelPeriodo, 0);
  const sett = calcolaMetriche(righe, calcolaPeriodo({ p: "mese-scorso" }, adesso), adesso, false);
  uguale("settembre: a inizio mese attivi U1, U3, U4; U4 è finito il 20 → perso 1 su 3", [sett.attiviInizioPeriodo, sett.persi], [3, 1]);
  vicino("abbandono di settembre = 1/3", sett.abbandono, 1 / 3, 0.0001);
  uguale("U5 cessa il 19 settembre (fine periodo 20 agosto + 30 giorni): cessati nel periodo 1", sett.cessatiNelPeriodo, 1);
  uguale("nuovi a settembre: nessuno", sett.nuovi, 0);
  const conProvaMetriche = calcolaMetriche(righe, calcolaPeriodo({}, adesso), adesso, true);
  uguale("includendo la prova: U7 entra tra gli attivi (4) e non risulta più escluso", [conProvaMetriche.attivi, conProvaMetriche.esclusi.prova], [4, 0]);
  const solaProva = calcolaMetriche([sub({ user_id: "P", livemode: false })], calcolaPeriodo({}, adesso), adesso, false);
  uguale("tutti i clienti di prova nascosti: zero clienti, 1 escluso", [solaProva.clienti.length, solaProva.esclusi.prova], [0, 1]);
  uguale("nessun cliente attivo a inizio periodo: abbandono non calcolabile (null, non 0)", solaProva.abbandono, null);
  uguale("più righe dello stesso utente contano come un cliente", calcolaMetriche([sub({ user_id: "D" }), sub({ user_id: "D", stripe_subscription_id: "sub_y" })], calcolaPeriodo({}, adesso), adesso, false).clienti.length, 1);
  uguale("stato: attivo", statoAbbonamento({ status: "attivo", current_period_end: "2026-11-01T09:00:00Z" }, adesso).stato, "attivo");
  uguale("stato: attivo ma con il periodo scaduto da 3 giorni = sola lettura (come l'area riservata)", statoAbbonamento({ status: "attivo", current_period_end: "2026-10-09T09:00:00Z" }, adesso).stato, "sola_lettura");
  uguale("stato: non attivo e senza data di fine = cessato (prudente)", statoAbbonamento({ status: "annullato", current_period_end: null }, adesso).stato, "cessato");

  // ───── Costi: ricavo dagli incassi ─────
  console.log("--- Costi: il ricavo passa agli incassi reali ---");
  const settembre = calcolaPeriodo({ p: "mese-scorso" }, adesso);
  const dati = {
    costi: [{ user_id: "A", categoria: "cliente" as const, operazioni: 10, operazioni_senza_costo: 0, costo_usd: 10, input_token: 0, output_token: 0 }],
    gare: [{ user_id: "A", gare_piano: 1, gare_credito: 0 }],
    abbonamenti: [{ user_id: "A", plan: "starter", status: "attivo", stripe_subscription_id: "sub_a", created_at: "2026-08-01T09:00:00Z", current_period_end: "2026-11-01T09:00:00Z", cancel_at_period_end: false }],
    acquisti: [],
    identita: new Map(),
  };
  const daListino = assemblaClienti(dati, { cambioUsdEur: 1, aliquotaIva: 22 }, settembre, adesso).righe[0];
  const daIncassi = assemblaClienti({ ...dati, incassiAbbonamento: [{ user_id: "A", importo: 122 }] }, { cambioUsdEur: 1, aliquotaIva: 22 }, settembre, adesso).righe[0];
  atteso("senza incassi il ricavo si stima dal listino", daListino.ricavoAbbonamentoLordo > 600 && daListino.giorniAbbonamento === 30);
  vicino("con gli incassi il ricavo è quello incassato (122), non il listino", daIncassi.ricavoAbbonamentoLordo, 122);
  vicino("margine = 122 / 1,22 - 10 = 90", daIncassi.margine, 90, 0.0001);
  const soloIncasso = assemblaClienti({ ...dati, costi: [], gare: [], incassiAbbonamento: [{ user_id: "Z", importo: 122 }] }, { cambioUsdEur: 1, aliquotaIva: 22 }, settembre, adesso);
  uguale("un cliente con un incasso e nessun costo compare comunque", soloIncasso.righe.map((r) => r.userId), ["Z"]);
  uguale("con la tabella degli incassi presente ma vuota il ricavo è zero (non il listino)", assemblaClienti({ ...dati, incassiAbbonamento: [] }, { cambioUsdEur: 1, aliquotaIva: 22 }, settembre, adesso).righe[0].ricavoAbbonamentoLordo, 0);

  // ───── Webhook e migrazione ─────
  console.log("--- Webhook Stripe e migrazione 0078 ---");
  const webhook = leggi("src/app/api/webhooks/stripe/route.ts");
  atteso("il webhook gestisce invoice.paid con la funzione condivisa", /case "invoice\.paid":/.test(webhook) && /registraIncassoDaFattura\(createAdminClient\(\), event\.data\.object as Stripe\.Invoice, event\.livemode\)/.test(webhook));
  atteso("errore transitorio → 500 (Stripe riprova); tabella assente → nessun 500", /esito\.stato === "errore"[\s\S]{0,200}status: 500/.test(webhook) && !/tabella_assente[\s\S]{0,120}status: 500/.test(webhook));
  atteso("creazione, aggiornamento e cancellazione dell'abbonamento ripiegano sulla scrittura di sempre se la migrazione manca (3 volte schemaAssente)", (webhook.match(/schemaAssente\(/g) ?? []).length === 3);
  atteso("il webhook passa livemode dell'evento a aggiornamento e cancellazione, e della sessione alla creazione", /handleOmniaAiSubscriptionUpdated\(event\.data\.object as Stripe\.Subscription, event\.livemode, event\.id,/.test(webhook) && /handleOmniaAiSubscriptionDeleted\(event\.data\.object as Stripe\.Subscription, event\.livemode\)/.test(webhook) && /livemode: session\.livemode/.test(webhook));
  atteso("dopo aver creato la subscription si agganciano gli incassi arrivati prima", webhook.indexOf("subscriptionRowId = sub.id;") < webhook.indexOf("collegaIncassiASubscription(admin, stripeSubscriptionId, userId)"));
  atteso("la data di disdetta si azzera solo se l'abbonamento è tornato attivo (mai su uno concluso)", /else if \(subscription\.status === "active" \|\| subscription\.status === "trialing"\)[\s\S]{0,120}disdetta_richiesta_il = null/.test(webhook));
  const gestorePagamentoFallito = webhook.slice(webhook.indexOf("async function handleOmniaAiInvoicePaymentFailed("), webhook.indexOf("// Il cambio piano immediato"));
  atteso("l'handler di invoice.payment_failed resta quello di prima per l'area cliente (notifica, nessun incasso); in più avvisa l'ufficio", /handleOmniaAiInvoicePaymentFailed\(event\.data\.object as Stripe\.Invoice, event\.livemode, event\.id\)/.test(webhook) && /creaNotifica\(/.test(gestorePagamentoFallito) && !/registraIncasso|omnia_ai_incassi/.test(gestorePagamentoFallito) && /notificaMancatoPagamento\(/.test(gestorePagamentoFallito));
  const sql = leggi("supabase/migrations/0078_omnia_ai_incassi.sql");
  atteso("incassi: fattura Stripe unica, RLS attiva, solo service role", /stripe_invoice_id text not null unique/.test(sql) && /alter table public\.omnia_ai_incassi enable row level security/.test(sql) && /grant select, insert, update on public\.omnia_ai_incassi to service_role/.test(sql) && !/to authenticated/.test(sql));
  atteso("una sola chiave esterna verso users, che non cancella l'incasso (vedi 0076)", (sql.match(/references public\.users/g) ?? []).length === 1 && /on delete set null/.test(sql));
  atteso("le subscriptions guadagnano livemode, disdetta_richiesta_il e terminata_il senza chiavi esterne", /add column if not exists livemode boolean/.test(sql) && /add column if not exists disdetta_richiesta_il timestamptz/.test(sql) && /add column if not exists terminata_il timestamptz/.test(sql));
  atteso("il backfill marca di prova solo le righe con abbonamento Stripe e livemode ancora nullo", /set livemode = false\s+where livemode is null\s+and stripe_subscription_id is not null/.test(sql));
  const backfill = leggi("scripts/backfill-incassi-stripe.ts");
  atteso("lo script di backfill è in prova di default e scrive solo con --esegui", /process\.argv\.includes\("--esegui"\)/.test(backfill) && /if \(esegui\) \{\s*const esito = await registraIncassoDaFattura/.test(backfill));
  atteso("il backfill usa la stessa funzione di trasformazione del webhook", /incassoDaFattura\(fattura, livemode\)/.test(backfill) && /registraIncassoDaFattura\(admin, fattura, livemode\)/.test(backfill));

  console.log("--- Sicurezza delle pagine ---");
  for (const [file, lettura] of [["src/app/site-console/(app)/ricavi/page.tsx", /await leggiRicavi\(/], ["src/app/site-console/(app)/abbonamenti/page.tsx", /await leggiAbbonamenti\(/]] as const) {
    const testo = leggi(file);
    const admin = testo.indexOf("await richiediAdminPagina()");
    atteso(`${file.split("/").slice(-2, -1)[0]}: richiediAdminPagina prima di leggere i dati`, admin >= 0 && testo.search(lettura) > admin);
  }

  if (fallimenti.length > 0) {
    console.error(`\n${fallimenti.length} controllo/i fallito/i:\n- ${fallimenti.join("\n- ")}`);
    process.exit(1);
  }
  console.log("\nAutotest di incassi, ricavi e abbonamenti: tutti i casi ok.");
}

main().catch((errore) => {
  console.error(errore);
  process.exit(1);
});
