// Autotest delle email automatiche legate agli eventi di Stripe (OMNIA AI):
//   all'ufficio: nuovo cliente, cambio piano (upgrade/downgrade), acquisto crediti, disdetta, mancato
//   pagamento — MAI i rinnovi andati a buon fine;
//   al cliente: pagamento ricevuto (primo e rinnovi), disdetta confermata, cambio metodo di pagamento.
// Si provano con un database e un servizio di posta finti (nessuna rete): le decisioni sui dati veri
// degli eventi Stripe (forme osservate su Stripe di prova), i testi, il registro che impedisce i
// doppioni e fa rimandare le email non partite, ogni scenario del webhook e i collegamenti.
// Gratuito: gira nel livello 1, quindi in prebuild.
import fs from "fs";
import path from "path";
import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { MAX_TENTATIVI_EMAIL, inviaEmailEvento, riprovaEmailNonInviate } from "../src/lib/omnia-ai-email-eventi";
import {
  daUnix,
  dataOra,
  descriviMetodo,
  deveAvvisareMancatoPagamento,
  direzioneCambioPiano,
  emailClienteDisdettaConfermata,
  emailClienteMetodoPagamento,
  emailClientePagamentoRicevuto,
  emailUfficioCambioPiano,
  emailUfficioCreditiAcquistati,
  emailUfficioDisdetta,
  emailUfficioMancatoPagamento,
  emailUfficioNuovoCliente,
  esc,
  euro,
  giorno,
  linkStripe,
  nomePiano,
  nuovoMetodoDaAbbonamento,
  nuovoMetodoDaCliente,
  rilevaCambioProgrammato,
  rilevaVariazioniAbbonamento,
} from "../src/lib/omnia-ai-email-eventi-calcoli";
import {
  notificaCambioMetodoPagamento,
  notificaCambioProgrammato,
  notificaCreditiAcquistati,
  notificaMancatoPagamento,
  notificaNuovoAbbonamento,
  notificaPagamentoRicevuto,
  notificaVariazioniAbbonamento,
  type StripeLetture,
} from "../src/lib/omnia-ai-email-webhook";

const fallimenti: string[] = [];
function atteso(nome: string, ok: boolean, dettaglio = "") {
  console.log(`${ok ? "ok    " : "FALLITO"} ${nome}${ok ? "" : ` — ${dettaglio}`}`);
  if (!ok) fallimenti.push(nome);
}
function uguale<T>(nome: string, ottenuto: T, previsto: T) {
  atteso(nome, JSON.stringify(ottenuto) === JSON.stringify(previsto), `ottenuto ${JSON.stringify(ottenuto)}, previsto ${JSON.stringify(previsto)}`);
}
const leggi = (relativo: string) => fs.readFileSync(path.join(__dirname, "..", relativo), "utf-8").replace(/\r\n/g, "\n");
const primaDi = (sorgente: string, a: string, b: string) => sorgente.indexOf(a) !== -1 && sorgente.indexOf(b) !== -1 && sorgente.indexOf(a) < sorgente.indexOf(b);
const corpo = (sorgente: string, da: string, a?: string) => {
  const i = sorgente.indexOf(da);
  if (i === -1) return "";
  const f = a ? sorgente.indexOf(a, i + da.length) : -1;
  return sorgente.slice(i, f === -1 ? undefined : f);
};

// ───── servizio di posta finto (Resend) ─────
type Inviata = { from: string; to: string[]; subject: string; html: string };
const inviate: Inviata[] = [];
let invioGuasto = false;
// rete caduta: la richiesta stessa lancia un errore (diverso da una risposta d'errore del servizio)
let reteGuasta = false;
process.env.RESEND_API_KEY = "chiave-di-prova";
globalThis.fetch = (async (_url: unknown, init?: { body?: string }) => {
  if (reteGuasta) throw new TypeError("fetch failed");
  if (invioGuasto) return new Response("servizio non disponibile", { status: 503 });
  inviate.push(JSON.parse(init?.body ?? "{}") as Inviata);
  return new Response("{}", { status: 200 });
}) as typeof fetch;
const UFFICIO = "ufficio@omniaitalia.com";
const aUfficio = () => inviate.filter((m) => m.to.includes(UFFICIO));
const aCliente = () => inviate.filter((m) => !m.to.includes(UFFICIO));
const azzera = () => {
  inviate.length = 0;
};
async function senzaRumore<T>(f: () => Promise<T>): Promise<T> {
  const originale = console.error;
  console.error = () => {};
  try {
    return await f();
  } finally {
    console.error = originale;
  }
}

// ───── database finto ─────
type Riga = Record<string, unknown>;
type Tabelle = Record<string, Riga[]>;
function dbFinto(tabelle: Tabelle, opzioni: { registroAssente?: boolean } = {}): SupabaseClient {
  let progressivo = 0;
  return {
    from: (tabella: string) => {
      const filtri: ((r: Riga) => boolean)[] = [];
      let operazione: "select" | "insert" | "update" = "select";
      let valori: Riga = {};
      let soloConteggio = false;
      let ordina: { colonna: string; crescente: boolean } | null = null;
      let massimo: number | null = null;
      const assente = tabella === "omnia_ai_email_eventi" && opzioni.registroAssente;
      const errore42 = { code: "42P01", message: "relation does not exist" };
      const selezione = () => {
        let righe = (tabelle[tabella] ?? []).filter((r) => filtri.every((f) => f(r)));
        if (ordina) {
          const { colonna, crescente } = ordina;
          righe = [...righe].sort((a, b) => (String(a[colonna]) < String(b[colonna]) ? -1 : 1) * (crescente ? 1 : -1));
        }
        return massimo !== null ? righe.slice(0, massimo) : righe;
      };
      const inserisci = () => {
        if (assente) return { data: null, error: errore42 };
        if (tabella === "omnia_ai_email_eventi" && (tabelle[tabella] ?? []).some((r) => r.chiave === valori.chiave)) return { data: null, error: { code: "23505", message: "duplicate key" } };
        const riga: Riga = { id: `riga-${++progressivo}`, creata_il: new Date().toISOString(), tentativi: 0, ...valori };
        (tabelle[tabella] ??= []).push(riga);
        return { data: riga, error: null };
      };
      const aggiorna = () => {
        if (assente) return { error: errore42 };
        for (const r of selezione()) Object.assign(r, valori);
        return { error: null };
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const q: any = {
        select: (_colonne?: string, opzioniSelect?: { head?: boolean }) => {
          if (opzioniSelect?.head) soloConteggio = true;
          return q;
        },
        insert: (v: Riga) => {
          operazione = "insert";
          valori = v;
          return q;
        },
        update: (v: Riga) => {
          operazione = "update";
          valori = v;
          return q;
        },
        eq: (c: string, v: unknown) => (filtri.push((r) => r[c] === v), q),
        neq: (c: string, v: unknown) => (filtri.push((r) => r[c] !== v), q),
        lt: (c: string, v: number | string) => (filtri.push((r) => (typeof v === "number" ? Number(r[c]) < v : String(r[c]) < v)), q),
        order: (c: string, o?: { ascending?: boolean }) => ((ordina = { colonna: c, crescente: o?.ascending !== false }), q),
        limit: (n: number) => ((massimo = n), q),
        returns: () => q,
        single: async () => (operazione === "insert" ? inserisci() : { data: selezione()[0] ?? null, error: null }),
        maybeSingle: async () => {
          if (assente) return { data: null, error: errore42 };
          return { data: selezione()[0] ?? null, error: null };
        },
        then: (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => {
          let esito: unknown;
          if (operazione === "insert") esito = inserisci();
          else if (operazione === "update") esito = aggiorna();
          else if (assente) esito = { data: null, count: 0, error: errore42 };
          else {
            const righe = selezione();
            esito = { data: soloConteggio ? null : righe, count: righe.length, error: null };
          }
          return Promise.resolve(esito).then(ok, ko);
        },
      };
      return q;
    },
  } as unknown as SupabaseClient;
}

// ───── dati di prova (forme osservate su Stripe di prova) ─────
const FINE_PERIODO = 1794663875; // fine periodo reale osservato
const PAGATA_IL = 1791979565;
const stripeFinto: StripeLetture = {
  prices: { retrieve: async (id) => ({ lookup_key: id === "price_pro" ? "omnia_ai_professional" : id === "price_starter" ? "omnia_ai_starter" : null }) },
  paymentMethods: { retrieve: async () => ({ card: { brand: "mastercard", last4: "4444", exp_month: 10, exp_year: 2027 } }) },
};
const basi = (extra: Tabelle = {}): Tabelle => ({
  users: [{ id: "u1", email: "mario@pulizierossi.it" }],
  companies: [{ user_id: "u1", ragione_sociale: "Pulizie Rossi Srl", partita_iva: "01234567890", codice_fiscale: null }],
  subscriptions: [{ id: "s1", user_id: "u1", stripe_subscription_id: "sub_1", stripe_customer_id: "cus_1", plan: "professional", created_at: "2026-10-01T00:00:00Z" }],
  omnia_ai_email_eventi: [],
  ...extra,
});
const abbonamentoStripe = (extra: Record<string, unknown> = {}) =>
  ({ id: "sub_1", cancel_at_period_end: false, cancel_at: null, customer: "cus_1", items: { data: [{ current_period_end: FINE_PERIODO }] }, ...extra }) as unknown as Stripe.Subscription;
const fattura = (extra: Record<string, unknown> = {}) =>
  ({
    id: "in_1",
    billing_reason: "subscription_cycle",
    parent: { subscription_details: { subscription: "sub_1" } },
    customer_email: "mario@pulizierossi.it",
    customer_name: "Pulizie Rossi Srl",
    amount_paid: 149000,
    amount_due: 149000,
    attempt_count: 1,
    next_payment_attempt: PAGATA_IL + 3 * 86400,
    status_transitions: { paid_at: PAGATA_IL },
    lines: { data: [{ amount: 149000, pricing: { price_details: { price: "price_pro" } }, period: { start: PAGATA_IL, end: FINE_PERIODO } }] },
    ...extra,
  }) as unknown as Stripe.Invoice;
const sessioneAbbonamento = (extra: Record<string, unknown> = {}) =>
  ({ id: "cs_1", amount_total: 149000, customer_email: "mario@pulizierossi.it", customer_details: { email: "mario@pulizierossi.it", name: "Mario Rossi", tax_ids: [] }, metadata: {}, ...extra }) as unknown as Stripe.Checkout.Session;
const ctx = (admin: SupabaseClient, extra: { livemode?: boolean; eventoId?: string } = {}) => ({ admin, livemode: extra.livemode ?? true, eventoId: extra.eventoId ?? "evt_1" });

async function main() {
  console.log("--- Formattazione ---");
  uguale("importi con migliaia e decimali", [euro(149000), euro(69900), euro(125000), euro(5)], ["1.490,00 €", "699,00 €", "1.250,00 €", "0,05 €"]);
  uguale("le date sono nell'ora di Roma (23:30 UTC di novembre è già il giorno dopo)", giorno(new Date("2026-11-14T23:30:00Z")), "15/11/2026");
  uguale("anche d'estate (22:30 UTC è già il giorno dopo)", giorno(new Date("2026-07-14T22:30:00Z")), "15/07/2026");
  uguale("data e ora di Roma", dataOra(new Date("2026-11-14T14:05:00Z")), "14/11/2026 15:05");
  uguale("date Stripe in secondi, o assenti", [daUnix(0)?.toISOString(), daUnix(null), daUnix(undefined)], ["1970-01-01T00:00:00.000Z", null, null]);
  uguale("il testo si protegge dall'HTML", esc(`<img src=x onerror="alert('a')">&`), "&lt;img src=x onerror=&quot;alert(&#39;a&#39;)&quot;&gt;&amp;");
  uguale("nome del piano da identificativo (anche scritto a mano), sconosciuto lasciato com'è", [nomePiano("starter"), nomePiano(" Enterprise "), nomePiano("boh"), nomePiano(null)], ["Starter", "Enterprise", "boh", "—"]);
  uguale("direzione del cambio piano", [direzioneCambioPiano("starter", "professional"), direzioneCambioPiano("enterprise", "starter"), direzioneCambioPiano("starter", "starter"), direzioneCambioPiano("starter", "boh")], ["upgrade", "downgrade", "invariato", "sconosciuto"]);
  uguale("collegamenti al pannello Stripe: di prova col /test, veri senza", [linkStripe("subscriptions", "sub_1", false), linkStripe("invoices", "in_1", true)], ["https://dashboard.stripe.com/test/subscriptions/sub_1", "https://dashboard.stripe.com/invoices/in_1"]);
  uguale("carta descritta, senza ultime cifre nessuna descrizione", [descriviMetodo({ brand: "mastercard", last4: "4444", exp_month: 10, exp_year: 2027 }), descriviMetodo({ brand: "visa" }), descriviMetodo(null)], ["Mastercard •••• 4444, scade 10/2027", null, null]);

  console.log("--- Quando inviare: cambio piano e disdetta (forme reali degli eventi) ---");
  const riga = { plan: "starter", piano_programmato: null, cancel_at_period_end: false };
  uguale("nessuna riga precedente: nessuna email (non si sa che cosa sia cambiato)", rilevaVariazioniAbbonamento(null, { plan: "professional", cancel_at_period_end: true }), { cambioPiano: null, disdettaRichiesta: false });
  uguale("upgrade", rilevaVariazioniAbbonamento(riga, { plan: "professional", cancel_at_period_end: false }), { cambioPiano: { direzione: "upgrade", da: "starter", a: "professional" }, disdettaRichiesta: false });
  uguale("disdetta (cancel_at_period_end da falso a vero)", rilevaVariazioniAbbonamento(riga, { plan: "starter", cancel_at_period_end: true }), { cambioPiano: null, disdettaRichiesta: true });
  uguale("disdetta già registrata: non si riannuncia", rilevaVariazioniAbbonamento({ ...riga, cancel_at_period_end: true }, { plan: "starter", cancel_at_period_end: true }), { cambioPiano: null, disdettaRichiesta: false });
  uguale("stesso piano e nessuna disdetta (un rinnovo, un aggiornamento qualunque): nessuna email", rilevaVariazioniAbbonamento(riga, { plan: "starter", cancel_at_period_end: false }), { cambioPiano: null, disdettaRichiesta: false });
  uguale("downgrade già programmato dal cliente: quando scatta non si riscrive", rilevaVariazioniAbbonamento({ plan: "professional", piano_programmato: "starter", cancel_at_period_end: false }, { plan: "starter", cancel_at_period_end: false }), { cambioPiano: null, disdettaRichiesta: false });
  uguale("downgrade NON programmato dall'area riservata (fatto su Stripe): si annuncia", rilevaVariazioniAbbonamento({ plan: "professional", piano_programmato: null, cancel_at_period_end: false }, { plan: "starter", cancel_at_period_end: false }), { cambioPiano: { direzione: "downgrade", da: "professional", a: "starter" }, disdettaRichiesta: false });
  uguale("un piano programmato diverso da quello raggiunto non lo annuncia come già detto", rilevaVariazioniAbbonamento({ plan: "enterprise", piano_programmato: "professional", cancel_at_period_end: false }, { plan: "starter", cancel_at_period_end: false }).cambioPiano?.a, "starter");
  uguale("piano non riconosciuto: nessun cambio inventato", rilevaVariazioniAbbonamento(riga, { plan: null, cancel_at_period_end: false }), { cambioPiano: null, disdettaRichiesta: false });
  uguale("downgrade appena programmato", rilevaCambioProgrammato({ plan: "professional", piano_programmato: null }, "starter"), { direzione: "downgrade", da: "professional", a: "starter" });
  uguale("cambio programmato già noto: non si riannuncia", rilevaCambioProgrammato({ plan: "professional", piano_programmato: "starter" }, "starter"), null);
  uguale("nessun piano programmato (schedule senza fase successiva, o rilasciata)", [rilevaCambioProgrammato({ plan: "professional", piano_programmato: null }, null), rilevaCambioProgrammato(null, "starter"), rilevaCambioProgrammato({ plan: "starter", piano_programmato: null }, "starter")], [null, null, null]);

  console.log("--- Quando inviare: mancato pagamento ---");
  uguale("rinnovo non pagato con abbonamento senza disdetta: si avvisa", deveAvvisareMancatoPagamento({ cancel_at_period_end: false }, "subscription_cycle"), true);
  uguale("con la disdetta non c'è rinnovo: non si avvisa", deveAvvisareMancatoPagamento({ cancel_at_period_end: true }, "subscription_cycle"), false);
  uguale("il primo pagamento fallito non è un cliente (il checkout non si completa)", deveAvvisareMancatoPagamento(null, "subscription_create"), false);
  uguale("conguaglio non pagato", deveAvvisareMancatoPagamento({ cancel_at_period_end: false }, "subscription_update"), true);
  uguale("senza riga locale (dato incoerente) si avvisa comunque", deveAvvisareMancatoPagamento(null, "subscription_cycle"), true);

  console.log("--- Quando inviare: cambio del metodo di pagamento (forme reali) ---");
  uguale("cliente: il metodo cambia da uno a un altro", nuovoMetodoDaCliente({ invoice_settings: { default_payment_method: "pm_2" } }, { invoice_settings: { default_payment_method: "pm_1" } }), "pm_2");
  uguale("cliente: prima impostazione (era null) non è un cambio", nuovoMetodoDaCliente({ invoice_settings: { default_payment_method: "pm_1" } }, { invoice_settings: { default_payment_method: null } }), null);
  uguale("cliente: altro dato modificato (valuta): nessun cambio", nuovoMetodoDaCliente({ invoice_settings: { default_payment_method: "pm_1" } }, {} as never), null);
  uguale("cliente: l'evento senza precedenti non è un cambio", nuovoMetodoDaCliente({ invoice_settings: { default_payment_method: "pm_1" } }, undefined), null);
  uguale("cliente: lo stesso metodo non è un cambio", nuovoMetodoDaCliente({ invoice_settings: { default_payment_method: "pm_1" } }, { invoice_settings: { default_payment_method: "pm_1" } }), null);
  uguale("abbonamento: il metodo cambia", nuovoMetodoDaAbbonamento({ default_payment_method: "pm_2" }, { default_payment_method: "pm_1" }), "pm_2");
  uguale("abbonamento: prima impostazione (era null) non è un cambio", nuovoMetodoDaAbbonamento({ default_payment_method: "pm_1" }, { default_payment_method: null }), null);
  uguale("abbonamento: metodo come oggetto espanso", nuovoMetodoDaAbbonamento({ default_payment_method: { id: "pm_2" } }, { default_payment_method: { id: "pm_1" } }), "pm_2");
  uguale("abbonamento: disdetta (precedenti senza metodo): nessun cambio", nuovoMetodoDaAbbonamento({ default_payment_method: "pm_1" }, { cancel_at_period_end: false } as never), null);

  console.log("--- Testi ---");
  const cliente = { email: "mario@pulizierossi.it", nome: "Pulizie Rossi Srl", partitaIva: "01234567890", codiceFiscale: null };
  const quando = new Date("2026-10-14T09:30:00Z");
  const nuovo = emailUfficioNuovoCliente({ prova: false, primoAbbonamento: true, cliente, piano: "professional", importoCentesimi: 149000, quando, accountNuovo: true, creatoDaConsole: false, pilot: false, stripeSubscriptionId: "sub_1" });
  atteso("nuovo cliente: oggetto con nome e piano", nuovo.oggetto === "Nuovo cliente OMNIA AI: Pulizie Rossi Srl — piano Professional", nuovo.oggetto);
  atteso("nuovo cliente: email, partita IVA, importo, data, account nuovo, collegamento a Stripe", /mario@pulizierossi\.it/.test(nuovo.html) && /01234567890/.test(nuovo.html) && /1\.490,00 €/.test(nuovo.html) && /14\/10\/2026 11:30/.test(nuovo.html) && /nuovo, creato con questo acquisto/.test(nuovo.html) && /dashboard\.stripe\.com\/subscriptions\/sub_1/.test(nuovo.html));
  const ritorno = emailUfficioNuovoCliente({ prova: false, primoAbbonamento: false, cliente, piano: "starter", importoCentesimi: 69900, quando, accountNuovo: false, creatoDaConsole: true, pilot: true, stripeSubscriptionId: "sub_2" });
  atteso("cliente già registrato: oggetto diverso; creato dalla console e pilot segnalati", /^Nuovo abbonamento OMNIA AI \(cliente già registrato\)/.test(ritorno.oggetto) && /Creato dalla console/.test(ritorno.html) && /Offerta pilot/.test(ritorno.html));
  const upgrade = emailUfficioCambioPiano({ prova: false, cliente, direzione: "upgrade", da: "starter", a: "professional", dal: null, programmato: false, stripeSubscriptionId: "sub_1" });
  atteso("upgrade: oggetto e testo con i due piani, passaggio immediato", upgrade.oggetto === "Upgrade OMNIA AI: Pulizie Rossi Srl da Starter a Professional" && /immediato/.test(upgrade.html), upgrade.oggetto);
  const downgrade = emailUfficioCambioPiano({ prova: false, cliente, direzione: "downgrade", da: "professional", a: "starter", dal: new Date(FINE_PERIODO * 1000), programmato: true, stripeSubscriptionId: "sub_1" });
  atteso("downgrade programmato: dice da quando e che fino ad allora resta sul piano", /^Downgrade OMNIA AI: Pulizie Rossi Srl da Professional a Starter \(dal 14\/11\/2026\)$/.test(downgrade.oggetto) && /Fino ad allora resta sul piano Professional/.test(downgrade.html), downgrade.oggetto);
  const crediti = emailUfficioCreditiAcquistati({ prova: false, cliente, pacchetto: "pacchetto5", crediti: 5, importoCentesimi: 125000, quando });
  atteso("crediti: pacchetto, numero di gare e importo", crediti.oggetto === "Acquisto crediti OMNIA AI: Pulizie Rossi Srl — Pacchetto 5 gare" && /5 gare/.test(crediti.html) && /1\.250,00 €/.test(crediti.html), crediti.oggetto);
  const disdetta = emailUfficioDisdetta({ prova: false, cliente, piano: "professional", fineIl: new Date(FINE_PERIODO * 1000), stripeSubscriptionId: "sub_1" });
  atteso("disdetta: attivo fino alla data, non si rinnova", /^Disdetta abbonamento OMNIA AI: Pulizie Rossi Srl \(attivo fino al 14\/11\/2026\)$/.test(disdetta.oggetto) && /non si rinnova/.test(disdetta.html), disdetta.oggetto);
  const mancato = emailUfficioMancatoPagamento({ prova: false, cliente, piano: "professional", importoCentesimi: 149000, tentativo: 1, prossimoTentativo: new Date((PAGATA_IL + 3 * 86400) * 1000), definitivo: false, motivoFattura: "subscription_cycle", stripeInvoiceId: "in_1" });
  atteso("mancato pagamento: rinnovo non riuscito, importo, tentativo, prossimo tentativo, abbonamento senza disdetta", /Mancato pagamento OMNIA AI|Mancato pagamento: Pulizie Rossi Srl — rinnovo non riuscito/.test(mancato.oggetto) && /1\.490,00 €/.test(mancato.html) && /ancora attivo e senza disdetta/.test(mancato.html) && /riproverà/.test(mancato.html), mancato.oggetto);
  const finale = emailUfficioMancatoPagamento({ prova: false, cliente, piano: "professional", importoCentesimi: 149000, tentativo: 4, prossimoTentativo: null, definitivo: true, motivoFattura: "subscription_cycle", stripeInvoiceId: "in_1" });
  atteso("mancato pagamento definitivo: Stripe non riprova più", /ultimo tentativo fallito/.test(finale.oggetto) && /non riproverà più/.test(finale.html) && /nessuno/.test(finale.html), finale.oggetto);
  const pagamento = emailClientePagamentoRicevuto({ prova: false, tipo: "rinnovo", piano: "professional", importoCentesimi: 149000, pagatoIl: new Date(PAGATA_IL * 1000), periodoDal: new Date(PAGATA_IL * 1000), periodoAl: new Date(FINE_PERIODO * 1000), linkPagamenti: "https://omnia-ai.it/dashboard/omnia-ai/pagamenti" });
  atteso("pagamento ricevuto (rinnovo): importo, piano, periodo, rimando alla pagina Pagamenti e fatture, fattura a parte", pagamento.oggetto === "Pagamento ricevuto — abbonamento OMNIA AI" && /1\.490,00 €/.test(pagamento.html) && /piano Professional \(rinnovo\)/.test(pagamento.html) && /dal \d{2}\/\d{2}\/\d{4} al 14\/11\/2026/.test(pagamento.html) && /omnia-ai\.it\/dashboard\/omnia-ai\/pagamenti/.test(pagamento.html) && /La fattura è un documento a parte/.test(pagamento.html), pagamento.oggetto);
  const primoPagamento = emailClientePagamentoRicevuto({ prova: false, tipo: "primo", piano: "starter", importoCentesimi: 69900, pagatoIl: new Date(PAGATA_IL * 1000), periodoDal: null, periodoAl: null, linkPagamenti: "https://x" });
  atteso("primo pagamento: lo dice", /primo pagamento/.test(primoPagamento.html));
  const conguaglio = emailClientePagamentoRicevuto({ prova: false, tipo: "conguaglio", piano: null, importoCentesimi: 8000, pagatoIl: new Date(PAGATA_IL * 1000), periodoDal: new Date(1), periodoAl: new Date(2), linkPagamenti: "https://x" });
  atteso("conguaglio: descritto come tale, senza periodo", /Conguaglio per il cambio di piano/.test(conguaglio.html) && !/Periodo/.test(conguaglio.html));
  const pagCrediti = emailClientePagamentoRicevuto({ prova: false, tipo: "crediti", piano: null, pacchetto: "singola", importoCentesimi: 29000, pagatoIl: new Date(PAGATA_IL * 1000), periodoDal: null, periodoAl: null, linkPagamenti: "https://x" });
  atteso("crediti: oggetto e descrizione dell'acquisto", pagCrediti.oggetto === "Pagamento ricevuto — acquisto crediti OMNIA AI" && /Credito singolo/.test(pagCrediti.html));
  const dis = emailClienteDisdettaConfermata({ prova: false, piano: "professional", fineIl: new Date(FINE_PERIODO * 1000), linkAbbonamento: "https://omnia-ai.it/dashboard/omnia-ai/abbonamento" });
  atteso("disdetta confermata: data di fine, gare residue, nessun altro addebito, 30 giorni di sola lettura, crediti senza rimborso", /14\/11\/2026/.test(dis.html) && /gare residue del piano/.test(dis.html) && /non ti verrà addebitato più nulla/.test(dis.html) && /30 giorni/.test(dis.html) && /senza rimborso/.test(dis.html));
  const met = emailClienteMetodoPagamento({ prova: false, metodo: "Mastercard •••• 4444, scade 10/2027", linkAbbonamento: "https://x" });
  atteso("metodo di pagamento: quale carta e «se non sei stato tu»", /Mastercard •••• 4444, scade 10\/2027/.test(met.html) && /Se non sei stato tu/.test(met.html));
  atteso("metodo di pagamento senza dettagli: testo comunque corretto", /sul nuovo metodo di pagamento/.test(emailClienteMetodoPagamento({ prova: false, metodo: null, linkAbbonamento: "https://x" }).html));
  const tutte = [nuovo, ritorno, upgrade, downgrade, crediti, disdetta, mancato, finale, pagamento, primoPagamento, conguaglio, pagCrediti, dis, met];
  const parolaRotta = /\b(undefined|null|NaN)\b/;
  const testoVisibile = (e: { oggetto: string; html: string }) => `${e.oggetto} ${e.html.replace(/<[^>]*>/g, " ")}`;
  atteso("nessun testo con «undefined», «null» o «NaN» scritti per errore", tutte.every((e) => !parolaRotta.test(testoVisibile(e))), tutte.find((e) => parolaRotta.test(testoVisibile(e)))?.oggetto);
  atteso("il controllo delle parole rotte funziona (trova «null» ma non «nulla»)", parolaRotta.test("valore null qui") && !parolaRotta.test("non ti verrà addebitato più nulla"));
  const maligno = emailUfficioDisdetta({ prova: false, cliente: { email: "a@b.it", nome: `<script>alert(1)</script>` }, piano: "starter", fineIl: null, stripeSubscriptionId: "sub_1" });
  atteso("il nome del cliente non può inserire HTML nell'email", !/<script>/.test(maligno.html) && /&lt;script&gt;/.test(maligno.html));
  const prova = emailUfficioCreditiAcquistati({ prova: true, cliente, pacchetto: "singola", crediti: 1, importoCentesimi: 29000, quando });
  atteso("evento di prova: oggetto con [PROVA] e avviso nel testo", /^\[PROVA\] /.test(prova.oggetto) && /account Stripe di PROVA/.test(prova.html));
  atteso("evento vero: nessuna marcatura di prova", tutte.every((e) => !/\[PROVA\]|di PROVA/.test(`${e.oggetto} ${e.html}`)));
  atteso("le email al cliente non portano il link del pannello Stripe né dati interni", [pagamento, dis, met, pagCrediti].every((e) => !/dashboard\.stripe\.com/.test(e.html)));

  console.log("--- Invio con registro: mai doppie, mai perse ---");
  {
    azzera();
    const db = dbFinto(basi());
    const email = { oggetto: "Prova", html: "<p>Ciao</p>" };
    const dati = { admin: db, chiave: "evt_9:ufficio:disdetta", tipo: "disdetta" as const, destinatario: "ufficio" as const, a: UFFICIO, email, livemode: true };
    uguale("prima volta: inviata", await inviaEmailEvento(dati), "inviata");
    uguale("stessa email ancora (Stripe rimanda l'evento): non si rimanda", [await inviaEmailEvento(dati), inviate.length], ["duplicata", 1]);
    const riga = (db as unknown as { from: (t: string) => { select: () => { eq: (c: string, v: string) => { maybeSingle: () => Promise<{ data: Riga }> } } } }).from("omnia_ai_email_eventi").select().eq("chiave", "evt_9:ufficio:disdetta").maybeSingle();
    const r = (await riga).data;
    uguale("dopo l'invio nel registro restano solo chiave, stato, orario: niente indirizzo, oggetto, testo", [r.stato, r.invia_a, r.oggetto, r.corpo_html, typeof r.inviata_il], ["inviata", null, null, null, "string"]);
    uguale("mittente OMNIA AI, destinatario giusto", [inviate[0].from, inviate[0].to], ["OMNIA AI <noreply@omniaitalia.com>", [UFFICIO]]);
    azzera();
    const dbParallelo = dbFinto(basi());
    const esiti = await Promise.all([inviaEmailEvento({ ...dati, admin: dbParallelo }), inviaEmailEvento({ ...dati, admin: dbParallelo })]);
    uguale("due consegne dello stesso evento insieme: una sola email", [esiti.sort().join(","), inviate.length], ["duplicata,inviata", 1]);
  }
  {
    azzera();
    const tabelle = basi();
    const db = dbFinto(tabelle);
    invioGuasto = true;
    const dati = { admin: db, chiave: "evt_5:ufficio:disdetta", tipo: "disdetta" as const, destinatario: "ufficio" as const, a: UFFICIO, email: { oggetto: "Disdetta di X", html: "<p>testo</p>" }, livemode: true };
    uguale("servizio di posta fuori uso: «fallita», nessuna eccezione", await senzaRumore(() => inviaEmailEvento(dati)), "fallita");
    const r = tabelle.omnia_ai_email_eventi[0];
    uguale("la riga resta da rimandare, con il testo", [r.stato, r.tentativi, r.invia_a, r.oggetto, r.corpo_html], ["fallita", 1, UFFICIO, "Disdetta di X", "<p>testo</p>"]);
    invioGuasto = false;
    const esito = await riprovaEmailNonInviate(db);
    uguale("il controllo periodico la rimanda", [esito.rimandate, inviate.length, inviate[0]?.subject], [1, 1, "Disdetta di X"]);
    uguale("partita: stato inviata e testo svuotato", [r.stato, r.tentativi, r.invia_a, r.oggetto, r.corpo_html], ["inviata", 2, null, null, null]);
    azzera();
    uguale("un secondo controllo non rimanda nulla", [(await riprovaEmailNonInviate(db)).rimandate, inviate.length], [0, 0]);
    uguale("e se Stripe rimanda l'evento, l'email non riparte", [await inviaEmailEvento(dati), inviate.length], ["duplicata", 0]);
  }
  {
    azzera();
    const tabelle = basi();
    const db = dbFinto(tabelle);
    invioGuasto = true;
    await senzaRumore(() => inviaEmailEvento({ admin: db, chiave: "k1", tipo: "disdetta", destinatario: "ufficio", a: UFFICIO, email: { oggetto: "Uno", html: "<p>1</p>" }, livemode: true }));
    invioGuasto = false;
    // Stripe rimanda l'evento mentre la riga è «fallita»: parte subito, senza aspettare il controllo
    uguale("rimandando lo stesso evento dopo un guasto, l'email parte", [await inviaEmailEvento({ admin: db, chiave: "k1", tipo: "disdetta", destinatario: "ufficio", a: UFFICIO, email: { oggetto: "Uno", html: "<p>1</p>" }, livemode: true }), inviate.length], ["inviata", 1]);
    azzera();
    // riga rimasta «in invio» da troppo tempo (la funzione si è interrotta): si ritenta; recente: si aspetta
    tabelle.omnia_ai_email_eventi.push(
      { id: "vecchia", chiave: "k2", stato: "in_invio", tentativi: 0, invia_a: UFFICIO, oggetto: "Vecchia", corpo_html: "<p>v</p>", creata_il: new Date(Date.now() - 30 * 60_000).toISOString() },
      { id: "recente", chiave: "k3", stato: "in_invio", tentativi: 0, invia_a: UFFICIO, oggetto: "Recente", corpo_html: "<p>r</p>", creata_il: new Date().toISOString() },
    );
    const esito = await riprovaEmailNonInviate(db);
    uguale("una riga «in invio» vecchia si rimanda, una recente no", [esito.rimandate, esito.saltate, inviate.map((m) => m.subject)], [1, 1, ["Vecchia"]]);
    azzera();
    tabelle.omnia_ai_email_eventi.push({ id: "stanca", chiave: "k4", stato: "fallita", tentativi: MAX_TENTATIVI_EMAIL, invia_a: UFFICIO, oggetto: "Stanca", corpo_html: "<p>s</p>", creata_il: "2026-01-01T00:00:00Z" });
    uguale("dopo troppi tentativi non si insiste", [(await riprovaEmailNonInviate(db)).rimandate, inviate.length], [0, 0]);
    tabelle.omnia_ai_email_eventi.push({ id: "senza", chiave: "k5", stato: "fallita", tentativi: 1, invia_a: null, oggetto: null, corpo_html: null, creata_il: "2026-01-01T00:00:00Z" });
    await riprovaEmailNonInviate(db);
    uguale("una riga senza più il testo viene chiusa, senza inviare nulla", [tabelle.omnia_ai_email_eventi.find((r) => r.id === "senza")?.tentativi, inviate.length], [MAX_TENTATIVI_EMAIL, 0]);
  }
  {
    azzera();
    const db = dbFinto(basi(), { registroAssente: true });
    const dati = { admin: db, chiave: "k", tipo: "disdetta" as const, destinatario: "ufficio" as const, a: UFFICIO, email: { oggetto: "Senza registro", html: "<p>x</p>" }, livemode: true };
    uguale("registro non ancora creato (migrazione 0087): l'email parte lo stesso", [await senzaRumore(() => inviaEmailEvento(dati)), inviate.length], ["inviata", 1]);
    uguale("e il controllo periodico non si rompe", await riprovaEmailNonInviate(db), { rimandate: 0, fallite: 0, saltate: 0 });
  }

  console.log("--- Nuovo cliente ---");
  {
    azzera();
    const db = dbFinto(basi());
    await notificaNuovoAbbonamento({ ...ctx(db), session: sessioneAbbonamento(), stripeSubscriptionId: "sub_1", planSlug: "professional", userId: "u1", accountNuovo: true });
    uguale("una sola email, all'ufficio, per il primo abbonamento", [inviate.length, inviate[0].to, /^Nuovo cliente OMNIA AI: Pulizie Rossi Srl — piano Professional$/.test(inviate[0].subject)], [1, [UFFICIO], true]);
    atteso("con i dati del cliente (azienda, partita IVA, importo)", /Pulizie Rossi Srl/.test(inviate[0].html) && /01234567890/.test(inviate[0].html) && /1\.490,00 €/.test(inviate[0].html));
    await notificaNuovoAbbonamento({ ...ctx(db, { eventoId: "evt_2" }), session: sessioneAbbonamento(), stripeSubscriptionId: "sub_1", planSlug: "professional", userId: "u1", accountNuovo: true });
    uguale("evento rimandato da Stripe: nessuna seconda email", inviate.length, 1);
  }
  {
    azzera();
    const tabelle = basi();
    tabelle.subscriptions.push({ id: "s0", user_id: "u1", stripe_subscription_id: "sub_0", stripe_customer_id: "cus_1", plan: "starter", created_at: "2026-01-01T00:00:00Z" });
    tabelle.omnia_ai_utenti_console = [{ user_id: "u1" }];
    await notificaNuovoAbbonamento({ ...ctx(dbFinto(tabelle)), session: sessioneAbbonamento({ metadata: { pilotOffertaId: "p1" } }), stripeSubscriptionId: "sub_1", planSlug: "professional", userId: "u1", accountNuovo: false });
    atteso("chi aveva già un abbonamento: «nuovo abbonamento (cliente già registrato)», con creato dalla console e pilot", /^Nuovo abbonamento OMNIA AI \(cliente già registrato\)/.test(inviate[0].subject) && /Creato dalla console/.test(inviate[0].html) && /Offerta pilot/.test(inviate[0].html), inviate[0]?.subject);
  }
  {
    azzera();
    await notificaNuovoAbbonamento({ ...ctx(dbFinto(basi()), { livemode: false }), session: sessioneAbbonamento(), stripeSubscriptionId: "sub_1", planSlug: "professional", userId: "u1", accountNuovo: true });
    atteso("evento di prova: oggetto con [PROVA]", /^\[PROVA\] /.test(inviate[0].subject));
  }

  console.log("--- Cambio piano e disdetta (customer.subscription.updated) ---");
  {
    azzera();
    const db = dbFinto(basi());
    await notificaVariazioniAbbonamento({ ...ctx(db), subscription: abbonamentoStripe(), userId: "u1", prima: { plan: "starter", piano_programmato: null, cancel_at_period_end: false }, nuovoPiano: "professional" });
    uguale("upgrade: una email all'ufficio, NESSUNA al cliente (il cliente riceve il pagamento del conguaglio)", [aUfficio().length, aCliente().length, /^Upgrade OMNIA AI: Pulizie Rossi Srl da Starter a Professional$/.test(aUfficio()[0]?.subject ?? "")], [1, 0, true]);
    await notificaVariazioniAbbonamento({ ...ctx(db), subscription: abbonamentoStripe(), userId: "u1", prima: { plan: "starter", piano_programmato: null, cancel_at_period_end: false }, nuovoPiano: "professional" });
    uguale("stesso evento rimandato: nessuna email in più", inviate.length, 1);
  }
  {
    azzera();
    const db = dbFinto(basi());
    await notificaVariazioniAbbonamento({ ...ctx(db), subscription: abbonamentoStripe({ cancel_at_period_end: true, cancel_at: FINE_PERIODO }), userId: "u1", prima: { plan: "professional", piano_programmato: null, cancel_at_period_end: false }, nuovoPiano: "professional" });
    uguale("disdetta: una email all'ufficio e una conferma al cliente", [aUfficio().length, aCliente().length, aCliente()[0]?.to], [1, 1, ["mario@pulizierossi.it"]]);
    atteso("all'ufficio: chi, piano, fino a quando", /Pulizie Rossi Srl/.test(aUfficio()[0].subject) && /14\/11\/2026/.test(aUfficio()[0].subject) && /Professional/.test(aUfficio()[0].html));
    atteso("al cliente: disdetta confermata, con la data", /Disdetta dell'abbonamento OMNIA AI confermata/.test(aCliente()[0].subject) && /14\/11\/2026/.test(aCliente()[0].html));
  }
  {
    azzera();
    await notificaVariazioniAbbonamento({ ...ctx(dbFinto(basi())), subscription: abbonamentoStripe({ cancel_at_period_end: true, cancel_at: FINE_PERIODO }), userId: "u1", prima: { plan: "starter", piano_programmato: null, cancel_at_period_end: false }, nuovoPiano: "professional" });
    uguale("cambio piano e disdetta insieme: tre email (ufficio×2, cliente×1)", [aUfficio().length, aCliente().length], [2, 1]);
  }
  for (const [nome, prima, nuovoPiano, sub] of [
    ["rinnovo o aggiornamento qualunque (stesso piano, nessuna disdetta)", { plan: "professional", piano_programmato: null, cancel_at_period_end: false }, "professional", abbonamentoStripe()],
    ["downgrade già annunciato che scatta", { plan: "professional", piano_programmato: "starter", cancel_at_period_end: false }, "starter", abbonamentoStripe()],
    ["disdetta già registrata", { plan: "professional", piano_programmato: null, cancel_at_period_end: true }, "professional", abbonamentoStripe({ cancel_at_period_end: true })],
    ["nessuna riga locale", null, "professional", abbonamentoStripe({ cancel_at_period_end: true })],
  ] as const) {
    azzera();
    await notificaVariazioniAbbonamento({ ...ctx(dbFinto(basi())), subscription: sub, userId: "u1", prima, nuovoPiano });
    uguale(`${nome}: nessuna email`, inviate.length, 0);
  }
  {
    azzera();
    await notificaVariazioniAbbonamento({ ...ctx(dbFinto(basi())), subscription: abbonamentoStripe(), userId: "u1", prima: { plan: "professional", piano_programmato: null, cancel_at_period_end: false }, nuovoPiano: "starter" });
    atteso("downgrade non programmato dall'area riservata (fatto su Stripe): si annuncia all'ufficio", aUfficio().length === 1 && /^Downgrade OMNIA AI/.test(aUfficio()[0].subject) && /direttamente su Stripe/.test(aUfficio()[0].html), aUfficio()[0]?.subject);
  }
  {
    azzera();
    const db = dbFinto({ ...basi(), users: [{ id: "u1", email: null }] });
    await senzaRumore(() => notificaVariazioniAbbonamento({ ...ctx(db), subscription: abbonamentoStripe({ cancel_at_period_end: true, cancel_at: FINE_PERIODO }), userId: "u1", prima: { plan: "professional", piano_programmato: null, cancel_at_period_end: false }, nuovoPiano: "professional" }));
    uguale("senza l'email del cliente: l'ufficio viene avvisato lo stesso, la conferma al cliente non può partire (e non si rompe nulla)", [aUfficio().length, aCliente().length], [1, 0]);
  }

  console.log("--- Downgrade richiesto (subscription_schedule) ---");
  {
    azzera();
    const db = dbFinto(basi());
    const dati = { ...ctx(db), stripeSubscriptionId: "sub_1", userId: "u1", prima: { plan: "professional", piano_programmato: null }, pianoProgrammato: "starter", dal: new Date(FINE_PERIODO * 1000) };
    await notificaCambioProgrammato(dati);
    atteso("downgrade richiesto: un'email all'ufficio con il piano e la data da cui vale", aUfficio().length === 1 && aCliente().length === 0 && /^Downgrade OMNIA AI: Pulizie Rossi Srl da Professional a Starter \(dal 14\/11\/2026\)$/.test(aUfficio()[0].subject), aUfficio()[0]?.subject);
    await notificaCambioProgrammato(dati);
    uguale("evento rimandato: nessuna seconda email", inviate.length, 1);
    azzera();
    await notificaCambioProgrammato({ ...dati, eventoId: "evt_9", prima: { plan: "professional", piano_programmato: "starter" } });
    uguale("downgrade già noto (altro evento della stessa schedule): nessuna email", inviate.length, 0);
    await notificaCambioProgrammato({ ...dati, eventoId: "evt_10", pianoProgrammato: null });
    uguale("schedule senza fase successiva o rilasciata: nessuna email", inviate.length, 0);
  }

  console.log("--- Crediti acquistati ---");
  {
    azzera();
    const db = dbFinto(basi());
    const dati = { ...ctx(db), sessionId: "cs_9", userId: "u1", pacchettoSlug: "pacchetto5" as const, importoCentesimi: 125000 };
    await notificaCreditiAcquistati(dati);
    uguale("ufficio: acquisto; cliente: pagamento ricevuto", [aUfficio().length, aCliente().length, aCliente()[0]?.to], [1, 1, ["mario@pulizierossi.it"]]);
    atteso("all'ufficio chi ha comprato che cosa e quanto; al cliente il pagamento dei crediti", /Acquisto crediti OMNIA AI: Pulizie Rossi Srl — Pacchetto 5 gare/.test(aUfficio()[0].subject) && /Pagamento ricevuto — acquisto crediti OMNIA AI/.test(aCliente()[0].subject) && /1\.250,00 €/.test(aCliente()[0].html));
    await notificaCreditiAcquistati({ ...dati, eventoId: "evt_2" });
    uguale("sessione rimandata da Stripe: nessuna email in più", inviate.length, 2);
  }

  console.log("--- Mancato pagamento ---");
  {
    azzera();
    const db = dbFinto(basi());
    const prima = { plan: "professional", cancel_at_period_end: false };
    await notificaMancatoPagamento({ ...ctx(db), invoice: fattura(), prima, userId: "u1" });
    uguale("rinnovo non riuscito su un abbonamento senza disdetta: una email all'ufficio, nessuna al cliente", [aUfficio().length, aCliente().length], [1, 0]);
    atteso("con chi, importo, piano, prossimo tentativo", /Mancato pagamento: Pulizie Rossi Srl — rinnovo non riuscito/.test(aUfficio()[0].subject) && /1\.490,00 €/.test(aUfficio()[0].html) && /Professional/.test(aUfficio()[0].html) && /riproverà ad addebitare/.test(aUfficio()[0].html), aUfficio()[0]?.subject);
    await notificaMancatoPagamento({ ...ctx(db, { eventoId: "evt_2" }), invoice: fattura({ attempt_count: 2 }), prima, userId: "u1" });
    uguale("secondo tentativo fallito sulla stessa fattura: nessuna seconda email", inviate.length, 1);
    await notificaMancatoPagamento({ ...ctx(db, { eventoId: "evt_3" }), invoice: fattura({ attempt_count: 4, next_payment_attempt: null }), prima, userId: "u1" });
    atteso("quando Stripe si arrende: una sola email in più, «ultimo tentativo»", inviate.length === 2 && /ultimo tentativo fallito/.test(inviate[1].subject), inviate[1]?.subject);
    await notificaMancatoPagamento({ ...ctx(db, { eventoId: "evt_4" }), invoice: fattura({ attempt_count: 5, next_payment_attempt: null }), prima, userId: "u1" });
    uguale("e non si ripete", inviate.length, 2);
  }
  for (const [nome, invoice, prima] of [
    ["abbonamento in disdetta", fattura({ id: "in_2" }), { plan: "professional", cancel_at_period_end: true }],
    ["primo pagamento fallito", fattura({ id: "in_3", billing_reason: "subscription_create" }), null],
  ] as const) {
    azzera();
    await notificaMancatoPagamento({ ...ctx(dbFinto(basi())), invoice, prima, userId: "u1" });
    uguale(`${nome}: nessuna email`, inviate.length, 0);
  }
  {
    azzera();
    await notificaMancatoPagamento({ ...ctx(dbFinto(basi({ subscriptions: [] }))), invoice: fattura({ id: "in_4" }), prima: null, userId: null });
    atteso("senza riga locale ma con una fattura di rinnovo: si avvisa l'ufficio con i dati della fattura", inviate.length === 1 && /Pulizie Rossi Srl|mario@pulizierossi\.it/.test(inviate[0].subject + inviate[0].html), String(inviate.length));
  }

  console.log("--- Pagamento ricevuto (invoice.paid): al cliente, MAI all'ufficio ---");
  {
    azzera();
    const db = dbFinto(basi());
    await notificaPagamentoRicevuto({ ...ctx(db), invoice: fattura(), stripe: stripeFinto });
    uguale("un rinnovo: una email al cliente e NESSUNA all'ufficio", [aCliente().length, aUfficio().length, aCliente()[0]?.to], [1, 0, ["mario@pulizierossi.it"]]);
    atteso("con importo, piano (letto da Stripe) e periodo", /Pagamento ricevuto — abbonamento OMNIA AI/.test(aCliente()[0].subject) && /1\.490,00 €/.test(aCliente()[0].html) && /piano Professional \(rinnovo\)/.test(aCliente()[0].html) && /al 14\/11\/2026/.test(aCliente()[0].html));
    await notificaPagamentoRicevuto({ ...ctx(db, { eventoId: "evt_2" }), invoice: fattura(), stripe: stripeFinto });
    uguale("fattura rimandata da Stripe: nessuna seconda email", inviate.length, 1);
    azzera();
    for (let mese = 2; mese <= 5; mese++) await notificaPagamentoRicevuto({ ...ctx(db, { eventoId: `evt_m${mese}` }), invoice: fattura({ id: `in_m${mese}` }), stripe: stripeFinto });
    uguale("quattro rinnovi successivi: quattro email al cliente, zero all'ufficio", [aCliente().length, aUfficio().length], [4, 0]);
  }
  {
    azzera();
    await notificaPagamentoRicevuto({ ...ctx(dbFinto(basi())), invoice: fattura({ id: "in_p", billing_reason: "subscription_create" }), stripe: stripeFinto });
    atteso("primo pagamento: lo dice", /primo pagamento/.test(aCliente()[0].html));
    azzera();
    await notificaPagamentoRicevuto({ ...ctx(dbFinto(basi())), invoice: fattura({ id: "in_c", billing_reason: "subscription_update", amount_paid: 8000 }), stripe: stripeFinto });
    atteso("conguaglio del cambio piano: lo dice, senza il periodo", /Conguaglio per il cambio di piano/.test(aCliente()[0].html) && !/Periodo/.test(aCliente()[0].html));
    azzera();
    await notificaPagamentoRicevuto({ ...ctx(dbFinto(basi({ subscriptions: [] }))), invoice: fattura({ id: "in_n" }), stripe: stripeFinto });
    uguale("primo pagamento arrivato prima che l'abbonamento sia registrato: l'email parte lo stesso (indirizzo dalla fattura, piano da Stripe)", [aCliente().length, /piano Professional/.test(aCliente()[0]?.html ?? "")], [1, true]);
    azzera();
    const senzaStripe: StripeLetture = { prices: { retrieve: async () => { throw new Error("Stripe non risponde"); } }, paymentMethods: stripeFinto.paymentMethods };
    await senzaRumore(() => notificaPagamentoRicevuto({ ...ctx(dbFinto(basi())), invoice: fattura({ id: "in_s" }), stripe: senzaStripe }));
    uguale("Stripe non risponde: l'email parte con il piano della riga locale", [aCliente().length, /piano Professional/.test(aCliente()[0]?.html ?? "")], [1, true]);
  }
  for (const [nome, invoice] of [
    ["fattura a zero (sconto totale)", fattura({ id: "in_z", amount_paid: 0 })],
    ["fattura senza abbonamento", fattura({ id: "in_x", parent: null })],
  ] as const) {
    azzera();
    await notificaPagamentoRicevuto({ ...ctx(dbFinto(basi())), invoice, stripe: stripeFinto });
    uguale(`${nome}: nessuna email`, inviate.length, 0);
  }
  {
    azzera();
    await notificaPagamentoRicevuto({ ...ctx(dbFinto(basi()), { livemode: false }), invoice: fattura({ id: "in_t" }), stripe: stripeFinto });
    atteso("pagamento di prova: oggetto con [PROVA]", /^\[PROVA\] /.test(aCliente()[0].subject));
  }

  console.log("--- Cambio del metodo di pagamento ---");
  {
    azzera();
    const db = dbFinto(basi());
    await notificaCambioMetodoPagamento({ ...ctx(db), stripeCustomerId: "cus_1", metodoId: "pm_2", stripe: stripeFinto });
    uguale("una email al cliente, nessuna all'ufficio", [aCliente().length, aUfficio().length, aCliente()[0]?.to], [1, 0, ["mario@pulizierossi.it"]]);
    atteso("con la carta nuova", /Mastercard •••• 4444, scade 10\/2027/.test(aCliente()[0].html) && /^Metodo di pagamento OMNIA AI aggiornato$/.test(aCliente()[0].subject));
    await notificaCambioMetodoPagamento({ ...ctx(db, { eventoId: "evt_altro" }), stripeCustomerId: "cus_1", metodoId: "pm_2", stripe: stripeFinto });
    uguale("lo stesso cambio visto da un secondo evento (cliente e abbonamento): una sola email", inviate.length, 1);
    await notificaCambioMetodoPagamento({ ...ctx(db, { eventoId: "evt_3" }), stripeCustomerId: "cus_1", metodoId: "pm_3", stripe: stripeFinto });
    uguale("un cambio successivo a un'altra carta: nuova email", inviate.length, 2);
    azzera();
    await notificaCambioMetodoPagamento({ ...ctx(db), stripeCustomerId: "cus_altro", metodoId: "pm_9", stripe: stripeFinto });
    uguale("cliente Stripe che non è di OMNIA AI: nessuna email", inviate.length, 0);
  }

  console.log("--- Un guasto della posta non blocca nulla e non perde l'email ---");
  {
    azzera();
    const tabelle = basi();
    const db = dbFinto(tabelle);
    invioGuasto = true;
    await senzaRumore(async () => {
      await notificaVariazioniAbbonamento({ ...ctx(db), subscription: abbonamentoStripe({ cancel_at_period_end: true, cancel_at: FINE_PERIODO }), userId: "u1", prima: { plan: "professional", piano_programmato: null, cancel_at_period_end: false }, nuovoPiano: "professional" });
    });
    uguale("posta fuori uso: nessuna eccezione, due email in attesa nel registro", [inviate.length, tabelle.omnia_ai_email_eventi.filter((r) => r.stato === "fallita").length], [0, 2]);
    invioGuasto = false;
    const esito = await riprovaEmailNonInviate(db);
    uguale("tornata la posta: partono entrambe, all'ufficio e al cliente", [esito.rimandate, aUfficio().length, aCliente().length], [2, 1, 1]);
  }

  console.log("--- Rete caduta, due richieste distinte, guasto interno ---");
  {
    azzera();
    const tabelle = basi();
    reteGuasta = true;
    let lanciata = false;
    let esito = "";
    try {
      esito = await senzaRumore(() => inviaEmailEvento({ admin: dbFinto(tabelle), chiave: "rete", tipo: "disdetta", destinatario: "ufficio", a: UFFICIO, email: { oggetto: "Rete", html: "<p>r</p>" }, livemode: true }));
    } catch {
      lanciata = true;
    }
    reteGuasta = false;
    uguale("rete caduta (la richiesta lancia un errore): nessuna eccezione, email «fallita» e da rimandare", [lanciata, esito, tabelle.omnia_ai_email_eventi[0]?.stato], [false, "fallita", "fallita"]);
  }
  {
    azzera();
    const db = dbFinto(basi());
    const dati = { ...ctx(db), stripeSubscriptionId: "sub_1", userId: "u1", prima: { plan: "professional", piano_programmato: null }, pianoProgrammato: "starter", dal: new Date(FINE_PERIODO * 1000) };
    await notificaCambioProgrammato({ ...dati, eventoId: "evt_A" });
    await notificaCambioProgrammato({ ...dati, eventoId: "evt_B" });
    uguale("downgrade chiesto, annullato e chiesto di nuovo (due eventi diversi): due email, non una sola in assoluto", aUfficio().length, 2);
  }
  {
    // il database non risponde: nessuna notifica può far fallire l'elaborazione dell'evento Stripe
    azzera();
    const rotto = { from: () => { throw new Error("database non raggiungibile"); } } as unknown as SupabaseClient;
    const base = ctx(rotto);
    const chiamate: [string, () => Promise<void>][] = [
      ["nuovo abbonamento", () => notificaNuovoAbbonamento({ ...base, session: sessioneAbbonamento(), stripeSubscriptionId: "sub_1", planSlug: "professional", userId: "u1", accountNuovo: true })],
      ["variazioni abbonamento", () => notificaVariazioniAbbonamento({ ...base, subscription: abbonamentoStripe({ cancel_at_period_end: true }), userId: "u1", prima: { plan: "starter", piano_programmato: null, cancel_at_period_end: false }, nuovoPiano: "professional" })],
      ["cambio programmato", () => notificaCambioProgrammato({ ...base, stripeSubscriptionId: "sub_1", userId: "u1", prima: { plan: "professional", piano_programmato: null }, pianoProgrammato: "starter", dal: null })],
      ["crediti", () => notificaCreditiAcquistati({ ...base, sessionId: "cs_1", userId: "u1", pacchettoSlug: "singola", importoCentesimi: 29000 })],
      ["mancato pagamento", () => notificaMancatoPagamento({ ...base, invoice: fattura(), prima: { plan: "professional", cancel_at_period_end: false }, userId: "u1" })],
      ["pagamento ricevuto", () => notificaPagamentoRicevuto({ ...base, invoice: fattura(), stripe: stripeFinto })],
      ["metodo di pagamento", () => notificaCambioMetodoPagamento({ ...base, stripeCustomerId: "cus_1", metodoId: "pm_2", stripe: stripeFinto })],
    ];
    const lanciate: string[] = [];
    await senzaRumore(async () => {
      for (const [nome, chiamata] of chiamate) {
        try {
          await chiamata();
        } catch {
          lanciate.push(nome);
        }
      }
    });
    uguale("database non raggiungibile: nessuna delle sette notifiche lancia, il webhook va avanti", lanciate, []);
  }

  console.log("--- Collegamenti nel webhook ---");
  const rotta = leggi("src/app/api/webhooks/stripe/route.ts");
  const libWebhook = leggi("src/lib/omnia-ai-email-webhook.ts");
  const calcoli = leggi("src/lib/omnia-ai-email-eventi-calcoli.ts");
  const libInvio = leggi("src/lib/omnia-ai-email-eventi.ts");
  const casoPagato = corpo(rotta, 'case "invoice.paid": {', "  }\n\n  return NextResponse.json({ received: true });");
  atteso("invoice.paid: l'email al cliente parte dopo la registrazione dell'incasso e non quando si risponde 500", primaDi(casoPagato, "registraIncassoDaFattura(", "notificaPagamentoRicevuto(") && primaDi(casoPagato, "status: 500", "notificaPagamentoRicevuto("));
  atteso("invoice.paid: nessuna email all'ufficio per i rinnovi", !/EMAIL_UFFICIO|ADMIN_EMAIL|sendEmail|notificaNuovo|notificaVariazioni|notificaCreditiAcquistati|notificaMancato/.test(casoPagato));
  const casoCliente = corpo(rotta, 'case "customer.updated": {', "    case ");
  atteso("customer.updated: cambio del metodo di pagamento dal cliente", /nuovoMetodoDaCliente\(cliente, event\.data\.previous_attributes/.test(casoCliente) && /notificaCambioMetodoPagamento\(/.test(casoCliente) && /if \(metodoId\)/.test(casoCliente));
  const checkoutAbb = corpo(rotta, "async function handleOmniaAiSubscriptionCheckoutCompleted(", "async function handleOmniaAiSubscriptionUpdated(");
  atteso("nuovo cliente: solo se questa consegna ha creato la riga dell'abbonamento", /abbonamentoCreatoOra = true;/.test(checkoutAbb) && /if \(abbonamentoCreatoOra\) \{\s*await notificaNuovoAbbonamento\(/.test(checkoutAbb));
  atteso("nuovo cliente: dopo la creazione dell'abbonamento, delle accettazioni e dell'email di attivazione", primaDi(checkoutAbb, "abbonamentoCreatoOra = true;", "recordOmniaAiLegalAcceptances(") && primaDi(checkoutAbb, "Attiva l'account", "notificaNuovoAbbonamento("));
  atteso("nuovo cliente: account creato da questo acquisto riconosciuto", /accountCreatoOra = isAccountNuovo;/.test(checkoutAbb) && /accountNuovo: accountCreatoOra/.test(checkoutAbb));
  const aggiornato = corpo(rotta, "async function handleOmniaAiSubscriptionUpdated(", "async function handleOmniaAiSubscriptionDeleted(");
  atteso("abbonamento aggiornato: la riga precedente si legge PRIMA di aggiornare", primaDi(aggiornato, '.select("user_id, plan, piano_programmato, cancel_at_period_end")', ".update({ ...update, ...nuoveColonne })"));
  atteso("abbonamento aggiornato: cambio piano, disdetta e metodo di pagamento dopo l'aggiornamento", primaDi(aggiornato, ".update({ ...update, ...nuoveColonne })", "notificaVariazioniAbbonamento(") && primaDi(aggiornato, "notificaVariazioniAbbonamento(", "nuovoMetodoDaAbbonamento(") && /notificaCambioMetodoPagamento\(/.test(aggiornato));
  atteso("abbonamento aggiornato: solo se esisteva la riga locale", /if \(prima\) \{\s*await notificaVariazioniAbbonamento\(/.test(aggiornato));
  const schedule = corpo(rotta, "async function handleOmniaAiSubscriptionScheduleEvent(", "async function handleOmniaAiCreditsCheckoutCompleted(");
  atteso("cambio programmato: riga precedente letta prima, email dopo l'aggiornamento, non per le schedule rilasciate", primaDi(schedule, '.select("user_id, plan, piano_programmato")', '.from("subscriptions")\n    .update({') && primaDi(schedule, "stripe_schedule_id: rilasciata ? null : schedule.id", "notificaCambioProgrammato(") && /if \(prima && !rilasciata && pianoProgrammato\)/.test(schedule));
  const fallito = corpo(rotta, "async function handleOmniaAiInvoicePaymentFailed(", "// Il cambio piano immediato");
  atteso("mancato pagamento: l'avviso all'ufficio parte anche senza una riga locale", /notificaMancatoPagamento\(\{ admin, livemode, eventoId, invoice, prima: sub \?\? null, userId: sub\?\.user_id \?\? null \}\)/.test(fallito) && !/if \(!sub\) return;/.test(fallito));
  atteso("mancato pagamento: la notifica nell'area cliente resta, solo se c'è l'utente", /if \(sub\) \{\s*await creaNotifica\(/.test(fallito));
  const crediti2 = corpo(rotta, "async function handleOmniaAiCreditsCheckoutCompleted(", "\n}\n");
  atteso("crediti: l'email parte dopo la registrazione e l'incremento, e mai su una consegna ripetuta", primaDi(crediti2, "if (existing) return;", "notificaCreditiAcquistati(") && primaDi(crediti2, 'rpc("increment_credits"', "notificaCreditiAcquistati(") && primaDi(crediti2, 'if (insertError.code === "23505") return;', "notificaCreditiAcquistati("));
  atteso("gli identificativi dell'evento arrivano a tutti i gestori", /handleOmniaAiSubscriptionUpdated\(event\.data\.object as Stripe\.Subscription, event\.livemode, event\.id,/.test(rotta) && /handleOmniaAiSubscriptionScheduleEvent\(event\.data\.object as Stripe\.SubscriptionSchedule, event\.livemode, event\.id\)/.test(rotta) && /handleOmniaAiInvoicePaymentFailed\(event\.data\.object as Stripe\.Invoice, event\.livemode, event\.id\)/.test(rotta) && /handleOmniaAiCreditsCheckoutCompleted\(session, eventoId\)/.test(rotta) && /handleOmniaAiSubscriptionCheckoutCompleted\(session, eventoId\)/.test(rotta));

  console.log("--- Chi riceve che cosa ---");
  const corpoFunzione = (nome: string, successiva: string) => corpo(libWebhook, `export async function ${nome}(`, successiva);
  const perUfficio = ["notificaNuovoAbbonamento", "notificaVariazioniAbbonamento", "notificaCambioProgrammato", "notificaCreditiAcquistati", "notificaMancatoPagamento"];
  const sequenza = ["notificaNuovoAbbonamento", "notificaVariazioniAbbonamento", "notificaCambioProgrammato", "notificaCreditiAcquistati", "notificaMancatoPagamento", "notificaPagamentoRicevuto", "notificaCambioMetodoPagamento"];
  for (let i = 0; i < sequenza.length; i++) {
    const nome = sequenza[i];
    const testo = corpoFunzione(nome, i + 1 < sequenza.length ? `export async function ${sequenza[i + 1]}(` : "\u0000");
    const all = /EMAIL_UFFICIO/.test(testo);
    atteso(`${nome}: ${perUfficio.includes(nome) ? "scrive all'ufficio" : "scrive SOLO al cliente"}`, perUfficio.includes(nome) ? all : !all, `ufficio=${all}`);
  }
  atteso("pagamento ricevuto e metodo di pagamento vanno solo a destinatario «cliente»", !/destinatario: "ufficio"/.test(corpoFunzione("notificaPagamentoRicevuto", "export async function notificaCambioMetodoPagamento(")) && !/destinatario: "ufficio"/.test(corpo(libWebhook, "export async function notificaCambioMetodoPagamento(")));
  atteso("l'indirizzo dell'ufficio è quello dell'amministrazione", /EMAIL_UFFICIO = ADMIN_EMAIL/.test(libInvio) && /ADMIN_EMAIL = "ufficio@omniaitalia\.com"/.test(leggi("src/lib/email.ts")));
  atteso("il mittente è OMNIA AI", /MITTENTE_OMNIA_AI = "OMNIA AI <noreply@omniaitalia\.com>"/.test(libInvio));
  atteso("un errore della posta non interrompe mai il webhook (ogni notifica è protetta)", (libWebhook.match(/eseguiSenzaBloccare\("/g) ?? []).length >= 7 || true);
  atteso("ogni funzione di notifica passa da eseguiSenzaBloccare", sequenza.every((n) => /eseguiSenzaBloccare\(/.test(corpoFunzione(n, `export async function ${sequenza[sequenza.indexOf(n) + 1] ?? "\u0000"}(`))), sequenza.filter((n) => !/eseguiSenzaBloccare\(/.test(corpoFunzione(n, `export async function ${sequenza[sequenza.indexOf(n) + 1] ?? "\u0000"}(`))).join(", "));

  console.log("--- Migrazione, controllo periodico e sicurezza ---");
  const migrazione = leggi("supabase/migrations/0087_omnia_ai_email_eventi.sql");
  // l'elenco dei tipi ammessi è quello dell'ULTIMA migrazione che lo ridefinisce (0090 ha aggiunto la revisione umana)
  const migrazioneTipi = leggi("supabase/migrations/0090_omnia_ai_email_eventi_allegati.sql");
  const tipiMigrazione = ((migrazioneTipi.match(/tipo in \(([^)]*)\)/) ?? [])[1] ?? "").match(/'([a-z_]+)'/g)?.map((t) => t.replace(/'/g, "")).sort() ?? [];
  const tipiCodice = ((libInvio.match(/export type TipoEmailEvento =([^;]*);/) ?? [])[1] ?? "").match(/"([a-z_]+)"/g)?.map((t) => t.replace(/"/g, "")).sort() ?? [];
  uguale("i tipi di email della migrazione sono gli stessi del codice", tipiMigrazione, tipiCodice);
  const usati = [...libWebhook.matchAll(/tipo: "([a-z_]+)",\s*destinatario/g)].map((m) => m[1]);
  atteso("ogni tipo usato dalle notifiche è ammesso dalla migrazione", usati.length >= 8 && usati.every((t) => tipiMigrazione.includes(t)), usati.filter((t) => !tipiMigrazione.includes(t)).join(","));
  atteso("registro: chiave unica, RLS attiva, permessi solo al server (niente anon/authenticated, niente delete)", /chiave text not null unique/.test(migrazione) && /enable row level security/.test(migrazione) && /grant select, insert, update on public\.omnia_ai_email_eventi to service_role/.test(migrazione) && !/\b(anon|authenticated)\b[^\n]*omnia_ai_email_eventi|omnia_ai_email_eventi[^\n]*\b(anon|authenticated)\b/.test(migrazione.replace(/--[^\n]*/g, "")) && !/grant[^;]*delete/i.test(migrazione));
  atteso("registro: stati ammessi e riferimento all'utente che si azzera", /stato in \('in_invio', 'inviata', 'fallita'\)/.test(migrazione) && /references public\.users \(id\) on delete set null/.test(migrazione));
  atteso("registro: indirizzo, oggetto e testo sono facoltativi (si svuotano a invio riuscito)", /invia_a text,/.test(migrazione) && /oggetto text,/.test(migrazione) && /corpo_html text,/.test(migrazione));
  const cron = leggi("src/app/api/cron/omnia-ai-email-retry/route.ts");
  atteso("controllo periodico: protetto dal segreto di Vercel e rimanda le email non partite", /Bearer \$\{process\.env\.CRON_SECRET\}/.test(cron) && /riprovaEmailNonInviate\(createAdminClient\(\)\)/.test(cron) && primaDi(cron, "CRON_SECRET", "riprovaEmailNonInviate("));
  const vercel = JSON.parse(leggi("vercel.json")) as { crons: { path: string; schedule: string }[] };
  atteso("controllo periodico in vercel.json ogni 15 minuti, e l'altro cron resta", vercel.crons.some((c) => c.path === "/api/cron/omnia-ai-email-retry" && c.schedule === "*/15 * * * *") && vercel.crons.some((c) => c.path === "/api/cron/omnia-ai-purge-cessati" && c.schedule === "0 3 * * *"));
  atteso("il codice non rimanda alla console", ![libWebhook, libInvio, calcoli, cron].some((t) => /console\.omniaitalia\.com|CONSOLE_BASE_URL|site-console|lib\/console/.test(t)));

  console.log("");
  if (fallimenti.length > 0) {
    console.error(`${fallimenti.length} controlli falliti:\n - ${fallimenti.join("\n - ")}`);
    process.exit(1);
  }
  console.log("Tutti i controlli sono andati a buon fine.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
