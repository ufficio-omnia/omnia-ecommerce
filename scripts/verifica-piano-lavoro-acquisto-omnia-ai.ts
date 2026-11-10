// Autotest dell'ACQUISTO SINGOLO del piano di lavoro (75 € per gara, Stripe una tantum), senza rete e con un database finto:
//   - prezzo (console o codice), quando si vende (interruttore + chiave Stripe reale, o prova in locale con la chiave di prova), a chi si offre;
//   - il webhook: l'acquisto diventa «pagato» solo lì, una volta sola, solo se la sessione è quella giusta; pagamenti di prova mai da fatturare;
//     pagamento doppio riconosciuto; email richiamate anche per un evento rimandato;
//   - le avvertenze accettate prima del pagamento (versione e impronta);
//   - le regole scritte nel codice: migrazione 0097 (nessuna scrittura dal cliente, colonne limitate, tipi di email), azione con la guardia del
//     titolare e il prezzo letto dal server, webhook, riquadro.
// Gratuito: gira nel livello 1, quindi in prebuild.
import fs from "fs";
import path from "path";
import { createHash } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CLAUSOLE_PIANO_LAVORO,
  CLAUSOLE_SPECIFICHE_PIANO_LAVORO,
  PREZZO_PIANO_LAVORO,
  VERSIONE_CONDIZIONI_PIANO_LAVORO,
  controllaSessioneAcquisto,
  interpretaInterruttoreVenditaPianoLavoro,
  interpretaPrezzoPianoLavoro,
  interpretaRitornoPagamento,
  provaAcquistoLocaleAttiva,
  testoCanonicoCondizioniPianoLavoro,
  valutaOffertaAcquisto,
  venditaPianoLavoroVisibile,
} from "../src/lib/piano-lavoro-acquisto-calcoli";
import type { EsitoDirittoPiano } from "../src/lib/piano-lavoro-gara-calcoli";
import { leggiAcquistoPagato, leggiPrezzoPianoLavoro, registraPagamentoPianoLavoro, venditaPianoLavoroAttiva, type SessionePagamentoPianoLavoro } from "../src/lib/piano-lavoro-acquisto";
import { emailClientePianoLavoroAcquistato, emailUfficioPianoLavoroAcquistato } from "../src/lib/omnia-ai-email-piano-lavoro-calcoli";
import { costruisciPagamenti, percorsoFatturaPagamento, type PianoLavoroCliente } from "../src/lib/omnia-ai-pagamenti";
import { aggregaRicavi } from "../src/lib/console/ricavi-calcoli";
import { calcolaPeriodo } from "../src/lib/console/periodo";

const fallimenti: string[] = [];
function atteso(nome: string, ok: boolean, dettaglio = "") {
  console.log(`${ok ? "ok    " : "FALLITO"} ${nome}${ok ? "" : ` — ${dettaglio}`}`);
  if (!ok) fallimenti.push(nome);
}
function uguale<T>(nome: string, ottenuto: T, previsto: T) {
  atteso(nome, JSON.stringify(ottenuto) === JSON.stringify(previsto), `ottenuto ${JSON.stringify(ottenuto)}, previsto ${JSON.stringify(previsto)}`);
}
const leggi = (relativo: string) => fs.readFileSync(path.join(__dirname, "..", relativo), "utf-8").replace(/\r\n/g, "\n");

// ───── database finto ─────
type Riga = Record<string, unknown>;
type Db = Record<string, Riga[]>;

class Interrogazione {
  private filtri: ((r: Riga) => boolean)[] = [];
  private operazione: "select" | "update" = "select";
  private dati: Riga | null = null;
  private conteggio = false;
  private soloConteggio = false;
  private massimo = Infinity;
  private singolo = false;
  constructor(
    private nome: string,
    private db: Db,
    private tabelleAssenti: string[],
  ) {}
  select(_colonne?: string, opzioni?: { count?: string; head?: boolean }) {
    if (opzioni?.count) {
      this.conteggio = true;
      this.soloConteggio = !!opzioni.head;
    }
    return this;
  }
  update(d: Riga) {
    this.operazione = "update";
    this.dati = d;
    return this;
  }
  eq(c: string, v: unknown) {
    this.filtri.push((r) => r[c] === v);
    return this;
  }
  neq(c: string, v: unknown) {
    this.filtri.push((r) => r[c] !== v);
    return this;
  }
  lt(c: string, v: unknown) {
    this.filtri.push((r) => typeof r[c] === "string" && typeof v === "string" && (r[c] as string) < v);
    return this;
  }
  limit(n: number) {
    this.massimo = n;
    return this;
  }
  maybeSingle() {
    this.singolo = true;
    return this;
  }
  then<T>(res: (v: { data: unknown; count?: number; error: { code?: string; message: string } | null }) => T, rej?: (e: unknown) => T) {
    return Promise.resolve(this.esegui()).then(res, rej);
  }
  private esegui(): { data: unknown; count?: number; error: { code?: string; message: string } | null } {
    if (this.tabelleAssenti.includes(this.nome)) return { data: null, error: { code: "42P01", message: `relation "${this.nome}" does not exist` } };
    const tabella = (this.db[this.nome] ??= []);
    const trovate = tabella.filter((r) => this.filtri.every((f) => f(r)));
    if (this.operazione === "update") for (const r of trovate) Object.assign(r, this.dati);
    if (this.conteggio && this.soloConteggio) return { data: null, count: trovate.length, error: null };
    const limitate = trovate.slice(0, this.massimo);
    return { data: this.singolo ? (limitate[0] ?? null) : limitate, error: null };
  }
}

function fintoAdmin(db: Db, tabelleAssenti: string[] = []) {
  return { from: (nome: string) => new Interrogazione(nome, db, tabelleAssenti) } as unknown as SupabaseClient;
}

const ACCOUNT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ALTRO = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const GARA = "11111111-1111-4111-8111-111111111111";
const ACQUISTO = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const rigaAttesa = (extra: Riga = {}): Riga => ({
  id: ACQUISTO,
  user_id: ACCOUNT,
  gara_id: GARA,
  gara_titolo: "Pulizie impianti sportivi",
  prezzo_centesimi: 7500,
  stato: "in_attesa_pagamento",
  stripe_session_id: "cs_1",
  stripe_payment_intent_id: null,
  pagata_il: null,
  importo_pagato_centesimi: null,
  stato_fattura: "da_fatturare",
  ...extra,
});

const sessione = (extra: Partial<SessionePagamentoPianoLavoro> = {}): SessionePagamentoPianoLavoro =>
  ({
    id: "cs_1",
    payment_status: "paid",
    payment_intent: "pi_1",
    amount_total: 7500,
    livemode: true,
    customer_details: { name: "Pulizie Srl", email: "info@pulizie.it", address: null, tax_ids: [] },
    customer_email: "info@pulizie.it",
    metadata: { tipo: "omnia_ai_piano_lavoro", acquistoId: ACQUISTO, userId: ACCOUNT, garaId: GARA },
    ...extra,
  }) as unknown as SessionePagamentoPianoLavoro;

const spegniErrori = async <T>(f: () => Promise<T>): Promise<T> => {
  const originale = console.error;
  console.error = () => {};
  try {
    return await f();
  } finally {
    console.error = originale;
  }
};

async function main() {
  // ═════ 1. prezzo ═════
  uguale(
    "prezzo: da console un intero in centesimi nei limiti; altrimenti vale il prezzo del codice (75 €)",
    [interpretaPrezzoPianoLavoro("9000"), interpretaPrezzoPianoLavoro(" 4500 "), interpretaPrezzoPianoLavoro(null), interpretaPrezzoPianoLavoro(""), interpretaPrezzoPianoLavoro("75"), interpretaPrezzoPianoLavoro("75,00"), interpretaPrezzoPianoLavoro("-100"), interpretaPrezzoPianoLavoro("99999999999"), interpretaPrezzoPianoLavoro("abc"), interpretaPrezzoPianoLavoro(1_000_001)],
    [9000, 4500, 7500, 7500, 7500, 7500, 7500, 7500, 7500, 7500],
  );
  atteso("il prezzo di partenza è 75 € IVA inclusa (7500 centesimi)", PREZZO_PIANO_LAVORO.predefinitoCentesimi === 7500);

  // ═════ 2. quando si vende ═════
  uguale(
    "la prova in locale vale solo con la variabile a «1» e MAI in produzione né su Vercel",
    [{ OMNIA_AI_PIANO_LAVORO_ACQUISTO_PROVA: "1" }, {}, { OMNIA_AI_PIANO_LAVORO_ACQUISTO_PROVA: "0" }, { OMNIA_AI_PIANO_LAVORO_ACQUISTO_PROVA: "1", NODE_ENV: "production" }, { OMNIA_AI_PIANO_LAVORO_ACQUISTO_PROVA: "1", VERCEL: "1" }].map(provaAcquistoLocaleAttiva),
    [true, false, false, false, false],
  );
  uguale(
    "si vende solo con l'interruttore acceso E la chiave Stripe reale; oppure in locale con la chiave di prova; mai con la chiave di prova e basta",
    [
      venditaPianoLavoroVisibile({ interruttore: true, modalita: "reale", provaLocale: false }),
      venditaPianoLavoroVisibile({ interruttore: false, modalita: "reale", provaLocale: false }),
      venditaPianoLavoroVisibile({ interruttore: true, modalita: "prova", provaLocale: false }),
      venditaPianoLavoroVisibile({ interruttore: true, modalita: "sconosciuta", provaLocale: false }),
      venditaPianoLavoroVisibile({ interruttore: false, modalita: "prova", provaLocale: true }),
      venditaPianoLavoroVisibile({ interruttore: true, modalita: "reale", provaLocale: true }),
      venditaPianoLavoroVisibile({ interruttore: false, modalita: "sconosciuta", provaLocale: true }),
    ],
    [true, false, false, false, true, true, false],
  );
  uguale("l'interruttore vale solo «1»", [interpretaInterruttoreVenditaPianoLavoro("1"), interpretaInterruttoreVenditaPianoLavoro("true"), interpretaInterruttoreVenditaPianoLavoro(""), interpretaInterruttoreVenditaPianoLavoro(null), interpretaInterruttoreVenditaPianoLavoro(undefined)], [true, false, false, false, false]);

  {
    // lettura dal database e dall'ambiente (chiave Stripe)
    // Su Vercel la build gira con VERCEL=1 e NODE_ENV=production: la prova in locale si spegne proprio per questo, quindi il test
    // deve simulare un computer locale (né VERCEL né NODE_ENV=production) e poi rimettere l'ambiente com'era.
    const salvate = { chiave: process.env.STRIPE_SECRET_KEY_OMNIA_AI, prova: process.env.OMNIA_AI_PIANO_LAVORO_ACQUISTO_PROVA, vercel: process.env.VERCEL, nodeEnv: process.env.NODE_ENV };
    const env = process.env as Record<string, string | undefined>;
    const imposta = (chiave: string | undefined, prova: string | undefined) => {
      if (chiave === undefined) delete env.STRIPE_SECRET_KEY_OMNIA_AI;
      else env.STRIPE_SECRET_KEY_OMNIA_AI = chiave;
      if (prova === undefined) delete env.OMNIA_AI_PIANO_LAVORO_ACQUISTO_PROVA;
      else env.OMNIA_AI_PIANO_LAVORO_ACQUISTO_PROVA = prova;
      delete env.VERCEL;
      delete env.NODE_ENV;
    };
    try {
      const acceso = fintoAdmin({ console_impostazioni: [{ chiave: "vendita_piano_lavoro_attiva", valore: "1" }, { chiave: "piano_lavoro_prezzo_singolo_centesimi", valore: "9900" }] });
      const spento = fintoAdmin({ console_impostazioni: [{ chiave: "vendita_piano_lavoro_attiva", valore: "0" }] });
      const senzaTabella = fintoAdmin({}, ["console_impostazioni"]);
      imposta("sk_live_abc", undefined);
      uguale("chiave reale: vende se l'interruttore è acceso, non se è spento o assente, non se la tabella manca", [await venditaPianoLavoroAttiva(acceso), await venditaPianoLavoroAttiva(spento), await venditaPianoLavoroAttiva(fintoAdmin({})), await venditaPianoLavoroAttiva(senzaTabella)], [true, false, false, false]);
      imposta("sk_test_abc", undefined);
      uguale("chiave di prova senza la prova in locale: non vende mai, nemmeno con l'interruttore acceso (il database è condiviso con la produzione)", await venditaPianoLavoroAttiva(acceso), false);
      imposta("sk_test_abc", "1");
      uguale("chiave di prova con la prova in locale: vende", await venditaPianoLavoroAttiva(spento), true);
      imposta(undefined, "1");
      uguale("senza chiave Stripe non vende", await venditaPianoLavoroAttiva(acceso), false);
      uguale("prezzo: letto dalla console se c'è, altrimenti 75 €; con la tabella assente 75 €", [await leggiPrezzoPianoLavoro(acceso), await leggiPrezzoPianoLavoro(spento), await leggiPrezzoPianoLavoro(senzaTabella)], [9900, 7500, 7500]);
    } finally {
      imposta(salvate.chiave, salvate.prova);
      if (salvate.vercel !== undefined) env.VERCEL = salvate.vercel;
      if (salvate.nodeEnv !== undefined) env.NODE_ENV = salvate.nodeEnv;
    }
  }

  // ═════ 3. a chi si offre ═════
  {
    const nonAttivo: EsitoDirittoPiano = { ok: false, motivo: "non_attivo", messaggio: "x" };
    const base = { diritto: nonAttivo, titolare: true, venditaAttiva: true, prezzoCentesimi: 7500 };
    uguale("il titolare senza diritto e con la vendita accesa può comprare, con il prezzo", valutaOffertaAcquisto(base), { stato: "acquistabile", prezzoCentesimi: 7500 });
    uguale("l'Ufficio Gare vede che serve l'acquisto ma non compra", valutaOffertaAcquisto({ ...base, titolare: false }), { stato: "solo_titolare", prezzoCentesimi: 7500 });
    uguale("vendita spenta: nessuna offerta", valutaOffertaAcquisto({ ...base, venditaAttiva: false }), { stato: "nessuna" });
    uguale("chi può già generare non compra", valutaOffertaAcquisto({ ...base, diritto: { ok: true, versione: 1, fonte: "acquisto", riprova: false, concessioneId: null, consumaUnita: false } }), { stato: "nessuna" });
    uguale(
      "se pagare non cambierebbe nulla non si offre: analisi non finita, gara bloccata, già in corso, versioni esaurite",
      (["analisi_non_completata", "gara_bloccata", "gia_in_corso", "versioni_esaurite"] as const).map((motivo) => valutaOffertaAcquisto({ ...base, diritto: { ok: false, motivo, messaggio: "x" } }).stato),
      ["nessuna", "nessuna", "nessuna", "nessuna"],
    );
    uguale("ritorno da Stripe: solo «pagato» e «annullato»", [interpretaRitornoPagamento("pagato"), interpretaRitornoPagamento("annullato"), interpretaRitornoPagamento("altro"), interpretaRitornoPagamento(undefined), interpretaRitornoPagamento(["pagato", "x"])], ["pagato", "annullato", null, null, "pagato"]);
  }

  // ═════ 4. avvertenze accettate ═════
  {
    const testo = testoCanonicoCondizioniPianoLavoro();
    atteso("avvertenze: versione 1, sei clausole numerate di seguito, quelle specifiche (natura, documenti, responsabilità) marcate", VERSIONE_CONDIZIONI_PIANO_LAVORO === 1 && CLAUSOLE_PIANO_LAVORO.map((c) => c.numero).join() === "1,2,3,4,5,6" && CLAUSOLE_SPECIFICHE_PIANO_LAVORO.map((c) => c.numero).join() === "2,4,6" && /\[specifica\]/.test(testo));
    atteso("avvertenze: dicono che è un dimensionamento di partenza e non un preventivo, che i prezzi sono standard da sostituire, che il costo del lavoro non c'è, la proroga e la limitazione di responsabilità", /dimensionamento di partenza, non un preventivo/.test(testo) && /sostituiti con quelli dei fornitori del cliente/.test(testo) && /Il costo del lavoro non è compreso/.test(testo) && /proroga dei termini/.test(testo) && /limitata, salvo dolo o colpa grave, al corrispettivo pagato/.test(testo));
    const hash = createHash("sha256").update(testo).digest("hex");
    atteso("l'impronta è stabile (stesso testo, stessa impronta) e cambia se cambia una parola", hash === createHash("sha256").update(testoCanonicoCondizioniPianoLavoro()).digest("hex") && hash !== createHash("sha256").update(testo.replace("Excel", "Exce1")).digest("hex") && hash.length === 64);
  }

  // ═════ 5. controllo della sessione ═════
  {
    const riga = { stripe_session_id: "cs_1", user_id: ACCOUNT };
    uguale(
      "sessione: deve essere quella dell'acquisto e dello stesso cliente",
      [controllaSessioneAcquisto(riga, { id: "cs_1", metadata: { userId: ACCOUNT } }), controllaSessioneAcquisto(riga, { id: "cs_2" }), controllaSessioneAcquisto(riga, { id: "cs_1", metadata: { userId: ALTRO } }), controllaSessioneAcquisto({ ...riga, stripe_session_id: null }, { id: "cs_9", metadata: { userId: ACCOUNT } })],
      [{ ok: true }, { ok: false, motivo: "sessione_diversa" }, { ok: false, motivo: "cliente_diverso" }, { ok: true }],
    );
  }

  // ═════ 6. il webhook ═════
  type ChiamataNotifica = { livemode: boolean; eventoId: string | null; stato: unknown; importo: unknown; doppio: boolean };
  const nuovaNotifica = () => {
    const chiamate: ChiamataNotifica[] = [];
    const notifica = (async (p: Parameters<NonNullable<Parameters<typeof registraPagamentoPianoLavoro>[0]["notifica"]>>[0]) => {
      chiamate.push({ livemode: p.livemode, eventoId: p.eventoId, stato: p.acquisto.stato, importo: p.acquisto.importo_pagato_centesimi, doppio: !!p.pagamentoDoppio });
    }) as NonNullable<Parameters<typeof registraPagamentoPianoLavoro>[0]["notifica"]>;
    return { chiamate, notifica };
  };

  {
    const db: Db = { omnia_ai_piani_lavoro_acquisti: [rigaAttesa()] };
    const n = nuovaNotifica();
    const esito = await registraPagamentoPianoLavoro({ admin: fintoAdmin(db), sessione: sessione(), eventoId: "evt_1", notifica: n.notifica });
    const r = db.omnia_ai_piani_lavoro_acquisti[0];
    atteso("pagamento riuscito: l'acquisto diventa «pagato», con importo, sessione, payment intent, modalità e dati di fatturazione di Stripe", esito.esito === "registrato" && r.stato === "pagata" && r.importo_pagato_centesimi === 7500 && r.stripe_session_id === "cs_1" && r.stripe_payment_intent_id === "pi_1" && r.livemode === true && typeof r.pagata_il === "string" && (r.dati_stripe as { name: string }).name === "Pulizie Srl", JSON.stringify({ esito, r }));
    atteso("un pagamento reale resta «da fatturare»", r.stato_fattura === "da_fatturare" && r.note_fattura === undefined);
    uguale("le email partono una volta, con l'acquisto già pagato e senza segnalare doppioni", n.chiamate, [{ livemode: true, eventoId: "evt_1", stato: "pagata", importo: 7500, doppio: false }]);

    // Stripe rimanda lo stesso evento: niente cambia, le email si richiamano (il loro registro evita i doppioni)
    const pagataIl = r.pagata_il;
    const n2 = nuovaNotifica();
    const ripetuto = await registraPagamentoPianoLavoro({ admin: fintoAdmin(db), sessione: sessione(), eventoId: "evt_1", notifica: n2.notifica });
    atteso("evento rimandato: «già registrato», nessuna modifica (stessa data di pagamento), email richiamate", ripetuto.esito === "gia_registrato" && r.pagata_il === pagataIl && n2.chiamate.length === 1 && n2.chiamate[0].doppio === false);
  }

  {
    const db: Db = { omnia_ai_piani_lavoro_acquisti: [rigaAttesa()] };
    const n = nuovaNotifica();
    await registraPagamentoPianoLavoro({ admin: fintoAdmin(db), sessione: sessione({ livemode: false }), eventoId: "evt_2", notifica: n.notifica });
    const r = db.omnia_ai_piani_lavoro_acquisti[0];
    atteso("pagamento di prova (Stripe in modalità test): registrato ma mai da fatturare, con la nota", r.stato === "pagata" && r.livemode === false && r.stato_fattura === "non_dovuta" && /prova/.test(String(r.note_fattura)) && n.chiamate[0].livemode === false);
  }

  {
    const casi: [string, Db, Partial<SessionePagamentoPianoLavoro>, string][] = [
      ["sessione non pagata", { omnia_ai_piani_lavoro_acquisti: [rigaAttesa()] }, { payment_status: "unpaid" }, "non_pagata"],
      ["acquisto senza id nei metadata", { omnia_ai_piani_lavoro_acquisti: [rigaAttesa()] }, { metadata: { tipo: "omnia_ai_piano_lavoro" } }, "acquisto_id_mancante"],
      ["acquisto inesistente", { omnia_ai_piani_lavoro_acquisti: [] }, {}, "non_trovato"],
      ["sessione di un altro pagamento", { omnia_ai_piani_lavoro_acquisti: [rigaAttesa({ stripe_session_id: "cs_altra" })] }, {}, "sessione_diversa"],
      ["cliente diverso", { omnia_ai_piani_lavoro_acquisti: [rigaAttesa({ user_id: ALTRO })] }, {}, "cliente_diverso"],
    ];
    for (const [nome, db, extra, motivo] of casi) {
      const n = nuovaNotifica();
      const esito = await spegniErrori(() => registraPagamentoPianoLavoro({ admin: fintoAdmin(db), sessione: sessione(extra), eventoId: "evt_x", notifica: n.notifica }));
      const r = db.omnia_ai_piani_lavoro_acquisti[0];
      atteso(`webhook ignorato — ${nome}: nessuna modifica e nessuna email`, esito.esito === "ignorato" && esito.motivo === motivo && (!r || r.stato === "in_attesa_pagamento") && n.chiamate.length === 0, JSON.stringify(esito));
    }
    const nSenza = nuovaNotifica();
    const senzaTabella = await spegniErrori(() => registraPagamentoPianoLavoro({ admin: fintoAdmin({}, ["omnia_ai_piani_lavoro_acquisti"]), sessione: sessione(), eventoId: "evt_y", notifica: nSenza.notifica }));
    atteso("senza la migrazione 0097 il webhook non cade: ignora e lo scrive nel log", senzaTabella.esito === "ignorato" && nSenza.chiamate.length === 0);
  }

  {
    // due schede di pagamento aperte insieme: il secondo pagamento resta registrato e l'email lo segnala come doppione
    const primo = rigaAttesa({ id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", stato: "pagata", pagata_il: "2026-11-01T10:00:00.000Z", stripe_session_id: "cs_0" });
    const db: Db = { omnia_ai_piani_lavoro_acquisti: [primo, rigaAttesa()] };
    const n = nuovaNotifica();
    const esito = await registraPagamentoPianoLavoro({ admin: fintoAdmin(db), sessione: sessione(), eventoId: "evt_3", notifica: n.notifica });
    atteso("pagamento doppio per la stessa gara: registrato comunque, ma l'email lo segnala", esito.esito === "registrato" && db.omnia_ai_piani_lavoro_acquisti[1].stato === "pagata" && n.chiamate.length === 1 && n.chiamate[0].doppio === true);
    const altraGara: Db = { omnia_ai_piani_lavoro_acquisti: [{ ...primo, gara_id: "22222222-2222-4222-8222-222222222222" }, rigaAttesa()] };
    const n2 = nuovaNotifica();
    await registraPagamentoPianoLavoro({ admin: fintoAdmin(altraGara), sessione: sessione(), eventoId: "evt_4", notifica: n2.notifica });
    atteso("un acquisto pagato di un'ALTRA gara non è un doppione", n2.chiamate[0].doppio === false);
  }

  // ═════ 7. il diritto da acquisto ═════
  {
    const pagata: Db = { omnia_ai_piani_lavoro_acquisti: [rigaAttesa({ stato: "pagata" }), rigaAttesa({ id: "e", gara_id: "22222222-2222-4222-8222-222222222222", stato: "in_attesa_pagamento" })] };
    uguale(
      "il diritto c'è solo con un acquisto PAGATO di QUESTA gara e di QUESTO cliente (non in attesa, non di un'altra gara o azienda); senza tabella: nessun diritto",
      [await leggiAcquistoPagato(fintoAdmin(pagata), ACCOUNT, GARA), await leggiAcquistoPagato(fintoAdmin(pagata), ACCOUNT, "22222222-2222-4222-8222-222222222222"), await leggiAcquistoPagato(fintoAdmin(pagata), ALTRO, GARA), await leggiAcquistoPagato(fintoAdmin(pagata), ACCOUNT, "33333333-3333-4333-8333-333333333333"), await leggiAcquistoPagato(fintoAdmin({}, ["omnia_ai_piani_lavoro_acquisti"]), ACCOUNT, GARA)],
      [true, false, false, false, false],
    );
  }

  // ═════ 8. le email ═════
  {
    const cliente = { email: "info@pulizie.it", nome: "Mario", cognome: "Rossi", ragioneSociale: "Pulizie Srl" } as unknown as Parameters<typeof emailUfficioPianoLavoroAcquistato>[0]["cliente"];
    const ufficio = emailUfficioPianoLavoroAcquistato({ prova: false, acquistoId: ACQUISTO, cliente, azienda: null, fatturazione: { nome: "Pulizie Srl", email: null, telefono: null, indirizzo: "Via Roma 1, 20100 Milano, IT", identificativiFiscali: ["eu_vat: IT01234567890"] }, garaTitolo: "Pulizie <impianti>", importoPagatoCentesimi: 7500, pagataIl: new Date("2026-11-03T10:00:00Z"), stripePaymentIntentId: "pi_1", pagamentoDoppio: false });
    atteso("email all'ufficio: gara (con il testo protetto), importo, dati di fatturazione, cosa fare (la fattura), link a Stripe", /Piano di lavoro acquistato/.test(ufficio.oggetto) && /Pulizie &lt;impianti&gt;/.test(ufficio.html) && !/Pulizie <impianti>/.test(ufficio.html) && /75/.test(ufficio.html) && /IT01234567890/.test(ufficio.html) && /fattura/i.test(ufficio.html) && /stripe\.com/.test(ufficio.html) && !/PAGAMENTO DOPPIO/.test(ufficio.oggetto));
    const doppio = emailUfficioPianoLavoroAcquistato({ prova: false, acquistoId: ACQUISTO, cliente, azienda: null, fatturazione: null, garaTitolo: "G", importoPagatoCentesimi: 7500, pagataIl: new Date(), stripePaymentIntentId: null, pagamentoDoppio: true });
    atteso("email all'ufficio: il pagamento doppio è nell'oggetto e nel testo", /^PAGAMENTO DOPPIO/.test(doppio.oggetto.replace(/^\[PROVA\] ?/, "")) && /pagamento doppio/.test(doppio.html));
    const prova = emailUfficioPianoLavoroAcquistato({ prova: true, acquistoId: ACQUISTO, cliente, azienda: null, fatturazione: null, garaTitolo: "G", importoPagatoCentesimi: 7500, pagataIl: new Date(), stripePaymentIntentId: "pi_1", pagamentoDoppio: false });
    atteso("un pagamento di prova è segnato come prova nell'oggetto", /prova/i.test(prova.oggetto));
    const conferma = emailClientePianoLavoroAcquistato({ prova: false, garaTitolo: "Gara & Co", importoCentesimi: 7500, pagataIl: new Date("2026-11-03T10:00:00Z"), linkGara: "https://omnia-ai.it/dashboard/omnia-ai/gare/x" });
    atteso("conferma al cliente: importo IVA inclusa, cosa fare adesso, dimensionamento di partenza e prezzi da sostituire, proroga, pulsante per tornare alla gara", /75/.test(conferma.html) && /IVA inclusa/.test(conferma.html) && /Gara &amp; Co/.test(conferma.html) && /dimensionamento di partenza, non un preventivo/.test(conferma.html) && /prezzi standard/.test(conferma.html) && /proroga/.test(conferma.html) && /https:\/\/omnia-ai\.it\/dashboard\/omnia-ai\/gare\/x/.test(conferma.html));
  }

  // ═════ 8b. pagamenti del cliente, ricavi, da fatturare ═════
  {
    const pl = (extra: Partial<PianoLavoroCliente> = {}): PianoLavoroCliente => ({ id: ACQUISTO, gara_titolo: "Pulizie impianti", prezzo_centesimi: 7500, importo_pagato_centesimi: 7500, pagata_il: "2026-11-03T10:00:00Z", livemode: true, stato_fattura: "da_fatturare", numero_fattura: null, data_fattura: null, fattura_file_path: null, ...extra });
    const elenco = costruisciPagamenti([], [], [], [], [pl(), pl({ id: "x", pagata_il: null }), pl({ id: "y", livemode: false, stato_fattura: "non_dovuta", pagata_il: "2026-11-04T10:00:00Z", importo_pagato_centesimi: null })]);
    atteso(
      "pagamenti del cliente: solo gli acquisti PAGATI, con descrizione, importo (o prezzo se manca), prova e stato della fattura; i più recenti per primi",
      elenco.length === 2 && elenco[0].id === "y" && elenco[0].prova === true && elenco[0].fattura.tipo === "non_dovuta" && elenco[0].importoCentesimi === 7500 && elenco[1].fonte === "piano_lavoro" && elenco[1].chiave === `piano_lavoro:${ACQUISTO}` && /Piano di lavoro della gara — Pulizie impianti/.test(elenco[1].descrizione) && elenco[1].fattura.tipo === "in_preparazione" && elenco[1].prova === false,
      JSON.stringify(elenco),
    );
    uguale("la fattura di un piano di lavoro ha il suo PDF in una cartella a parte", percorsoFatturaPagamento("piano_lavoro", ACQUISTO), `omnia-ai/piani-lavoro/${ACQUISTO}.pdf`);

    const ottobre = calcolaPeriodo({}, new Date("2026-11-12T10:00:00Z"));
    const ricavi = aggregaRicavi(
      [
        { dominio: "omnia_ai", fonte: "piano_lavoro", data: "2026-11-03T10:00:00Z", lordo: 75, impostaStripe: null, prova: false, dataApprossimata: false },
        { dominio: "omnia_ai", fonte: "piano_lavoro", data: "2026-11-04T10:00:00Z", lordo: 75, impostaStripe: null, prova: true, dataApprossimata: false },
        { dominio: "omnia_ai", fonte: "abbonamento", data: "2026-11-05T10:00:00Z", lordo: 122, impostaStripe: null, prova: false, dataApprossimata: false },
      ],
      ottobre,
      22,
      false,
    );
    const mese = ricavi.perMese[0];
    atteso(
      "ricavi: un acquisto del piano di lavoro non finisce tra gli abbonamenti ma nella sua colonna, scorporando l'IVA (75 € → 61,48 €); quello di prova è escluso e dichiarato",
      Math.abs(ricavi.totali.pianiLavoroNetto - 75 / 1.22) < 0.005 && ricavi.totali.acquistiPianoLavoro === 1 && Math.abs(ricavi.totali.abbonamentiNetto - 100) < 0.005 && ricavi.totali.incassiAbbonamento === 1 && Math.abs(mese.pianiLavoro - 75 / 1.22) < 0.005 && ricavi.prova.voci === 1 && ricavi.prova.incluse === false && Math.abs(ricavi.totali.omniaAiNetto - (75 / 1.22 + 100)) < 0.005,
      JSON.stringify(ricavi.totali),
    );

    const fatturazione = leggi("src/lib/console/fatturazione.ts");
    atteso("da fatturare: legge gli acquisti PAGATI (tabella assente tollerata, ogni altro errore dichiarato), li riga con la chiave «piano_lavoro:<id>», scorpora l'IVA e porta lo stato di fattura", /from\("omnia_ai_piani_lavoro_acquisti"\)\.select\(COLONNE_PIANO_LAVORO\)\.eq\("stato", "pagata"\)/.test(fatturazione) && /pianiLavoroQ\.error && !schemaAssente\(pianiLavoroQ\.error\)/.test(fatturazione) && /chiave: `piano_lavoro:\$\{p\.id\}`/.test(fatturazione) && /fonte: "piano_lavoro"/.test(fatturazione) && /calcolaImporti\(num\(p\.importo_pagato_centesimi \?\? p\.prezzo_centesimi\) \/ 100, null, null, parametri\.aliquotaIva\)/.test(fatturazione) && /\.\.\.statoDi\(p\)/.test(fatturazione));
    atteso("da fatturare: il contatore della barra laterale somma anche i piani di lavoro (solo pagati, da fatturare, non di prova)", /omnia_ai_piani_lavoro_acquisti"\)\.select\("importo_pagato_centesimi, prezzo_centesimi"\)\.eq\("stato", "pagata"\)\.eq\("stato_fattura", "da_fatturare"\)\.eq\("livemode", true\)/.test(fatturazione) && /pianiReali\.length/.test(fatturazione));
    const ricaviLettura = leggi("src/lib/console/ricavi.ts");
    atteso("ricavi: legge gli acquisti pagati nel periodo, con la data del pagamento (esatta) e il segno di prova, e la tabella assente non fa cadere la pagina", /from\("omnia_ai_piani_lavoro_acquisti"\)[\s\S]{0,200}\.eq\("stato", "pagata"\)\.gte\("pagata_il", periodo\.daIso\)\.lt\("pagata_il", periodo\.aIso\)/.test(ricaviLettura) && /fonte: "piano_lavoro"/.test(ricaviLettura) && /pianiLavoroQ\.error && !schemaAssente\(pianiLavoroQ\.error\)/.test(ricaviLettura));
    atteso("dati di prova e scheda cliente: contano e mostrano anche i piani di lavoro", /omnia_ai_piani_lavoro_acquisti/.test(leggi("src/lib/console/prova.ts")) && /omnia_ai_piani_lavoro_acquisti/.test(leggi("src/lib/console/utenti.ts")) && /Piani di lavoro acquistati/.test(leggi("src/app/site-console/_componenti/scheda-cliente-vista.tsx")));
    const eliminazione = leggi("src/app/site-console/azioni/utenti.ts");
    atteso("eliminare un cliente con un acquisto reale del piano di lavoro è rifiutato (dato contabile da conservare: si anonimizza)", /omnia_ai_piani_lavoro_acquisti"\)\.select\("id", \{ count: "exact", head: true \}\)\.eq\("user_id", bersaglio\.id\)\.eq\("stato", "pagata"\)\.eq\("livemode", true\)/.test(eliminazione) && /pianiLavoroReali\.count/.test(eliminazione));
    const costi = leggi("src/lib/console/costi.ts") + leggi("src/lib/console/costi-calcoli.ts");
    atteso("costi e margini non includono gli acquisti del piano di lavoro (come le revisioni)", !/omnia_ai_piani_lavoro_acquisti/.test(costi));
    const paginaPagamenti = leggi("src/app/site-omnia-ai/dashboard/omnia-ai/pagamenti/page.tsx");
    const grant = (leggi("supabase/migrations/0097_piano_lavoro_acquisti.sql").match(/grant select \(([^)]*)\)\s*on public\.omnia_ai_piani_lavoro_acquisti to authenticated/) ?? [])[1] ?? "";
    const colonneGrant = grant.split(",").map((c) => c.trim()).filter(Boolean);
    const colonnePagina = ((paginaPagamenti.match(/COLONNE_PIANO_LAVORO = "([^"]*)"/) ?? [])[1] ?? "").split(",").map((c) => c.trim()).filter(Boolean);
    atteso("pagamenti del cliente: legge con la SUA sessione (mai la chiave di servizio), solo le sue righe pagate, e solo colonne che la migrazione gli concede", /from\("omnia_ai_piani_lavoro_acquisti"\)[\s\S]{0,200}\.eq\("user_id", user\.id\)[\s\S]{0,60}\.eq\("stato", "pagata"\)/.test(paginaPagamenti) && !/createAdminClient/.test(paginaPagamenti) && colonnePagina.length >= 8 && colonnePagina.every((c) => colonneGrant.includes(c)), `${colonnePagina.filter((c) => !colonneGrant.includes(c)).join(",")}`);
  }

  // ═════ 9. regole scritte nel codice ═════
  {
    const migrazione = leggi("supabase/migrations/0097_piano_lavoro_acquisti.sql");
    atteso("migrazione 0097: tabella con le regole di accesso attive, stato e stato di fattura vincolati, sessione Stripe unica, riferimenti che si azzerano (mai cancellati) con l'utente e la gara", /create table if not exists public\.omnia_ai_piani_lavoro_acquisti/.test(migrazione) && /enable row level security/.test(migrazione) && /check \(stato in \('in_attesa_pagamento', 'pagata'\)\)/.test(migrazione) && /check \(stato_fattura in \('da_fatturare', 'fatturata', 'non_dovuta'\)\)/.test(migrazione) && /stripe_session_id text unique/.test(migrazione) && /user_id uuid references public\.users \(id\) on delete set null/.test(migrazione) && /gara_id uuid references public\.gare \(id\) on delete set null/.test(migrazione));
    atteso("migrazione 0097: il server scrive (senza cancellare: è un pagamento ricevuto); il titolare legge solo i SUOI pagamenti e solo le colonne utili (niente dati di Stripe, indirizzo IP, browser, note interne)", /grant select, insert, update on public\.omnia_ai_piani_lavoro_acquisti to service_role/.test(migrazione) && !/grant[^;]*delete[^;]*omnia_ai_piani_lavoro_acquisti/.test(migrazione) && /for select using \(user_id = auth\.uid\(\)\)/.test(migrazione) && !/grant (insert|update|delete)[^;]*to authenticated/.test(migrazione) && !/grant select \([^)]*\b(dati_stripe|accept_ip|accept_user_agent|note_fattura|stripe_session_id|stripe_payment_intent_id|condizioni_hash)\b/.test(migrazione));
    const tipi = [...leggi("supabase/migrations/0090_omnia_ai_email_eventi_allegati.sql").matchAll(/^\s+'([a-z_]+)',?$/gm)].map((m) => m[1]);
    const nuovi = [...migrazione.matchAll(/^\s+'([a-z_]+)',?$/gm)].map((m) => m[1]);
    atteso("migrazione 0097: il registro delle email accetta TUTTI i tipi di prima e i due nuovi", tipi.length >= 10 && tipi.every((t) => nuovi.includes(t)) && nuovi.includes("piano_lavoro_acquistato") && nuovi.includes("piano_lavoro_ricevuto"), `${tipi.length} vecchi, ${nuovi.length} nuovi`);
    const eventi = leggi("src/lib/omnia-ai-email-eventi.ts");
    atteso("i due tipi di email sono nel tipo TypeScript e usati dall'invio", /"piano_lavoro_acquistato"/.test(eventi) && /"piano_lavoro_ricevuto"/.test(eventi) && /tipo: "piano_lavoro_acquistato"/.test(leggi("src/lib/omnia-ai-email-piano-lavoro.ts")) && /tipo: "piano_lavoro_ricevuto"/.test(leggi("src/lib/omnia-ai-email-piano-lavoro.ts")));

    const azioni = leggi("src/app/actions/gara-piano-lavoro.ts");
    const i = azioni.indexOf("export async function acquistaPianoLavoro");
    const acquista = azioni.slice(i);
    atteso("acquisto: l'azione parte dalla guardia del TITOLARE (l'Ufficio Gare non compra), poi accesso in scrittura, accettazioni, vendita accesa, solo dopo il diritto e il prezzo", i !== -1 && acquista.indexOf("await richiediTitolareAzione()") !== -1 && acquista.indexOf("richiediTitolareAzione") < acquista.indexOf("requireOmniaAiWriteAccess") && acquista.indexOf("requireOmniaAiWriteAccess") < acquista.indexOf("accettaAvvertenze") && acquista.indexOf("accettaClausole") < acquista.indexOf("venditaPianoLavoroAttiva") && acquista.indexOf("venditaPianoLavoroAttiva") < acquista.indexOf("valutaDirittoPiano") && acquista.indexOf("valutaDirittoPiano") < acquista.indexOf("leggiPrezzoPianoLavoro"));
    atteso("acquisto: il prezzo lo rilegge il server (quello del form serve solo a accorgersi di un cambio) ed è quello che si addebita e si registra", /const prezzo = await leggiPrezzoPianoLavoro\(admin\)/.test(acquista) && /mostrato !== prezzo/.test(acquista) && /unit_amount: prezzo/.test(acquista) && /prezzo_centesimi: prezzo/.test(acquista) && !/unit_amount: mostrato/.test(acquista));
    atteso("acquisto: si paga solo se cambia qualcosa (nessun diritto già presente, nessun acquisto già pagato, gara analizzata e usabile)", /leggiDirittiPianoLavoro\(\{ admin, accountId: contesto\.accountId, garaId \}\)/.test(acquista) && /diritti\.acquistoPagato/.test(acquista) && /acquistoPagato: false/.test(acquista) && /esito\.motivo !== "non_attivo"/.test(acquista) && /if \(esito\.ok\)/.test(acquista));
    atteso("acquisto: la gara si legge con la sessione del cliente (regole di accesso), l'email di Stripe è quella dell'account, il pagamento si registra solo con l'accettazione (versione, impronta, indirizzo IP)", /supabase\.from\("gare"\)/.test(acquista) && /customer_email: user\.email/.test(acquista) && /condizioni_hash: condizioniHash/.test(acquista) && /accept_ip: ip/.test(acquista) && /condizioni_versione: VERSIONE_CONDIZIONI_PIANO_LAVORO/.test(acquista));
    atteso("acquisto: i metadata dicono il tipo (per il webhook) e Stripe riporta alla gara; l'azione NON segna mai l'acquisto come pagato", /tipo: "omnia_ai_piano_lavoro"/.test(acquista) && /acquistoId: acquisto\.id/.test(acquista) && /\?piano_lavoro=pagato/.test(acquista) && /\?piano_lavoro=annullato/.test(acquista) && !/stato: "pagata"/.test(azioni) && !/stato_fattura/.test(azioni));
    atteso("la generazione ricontrolla il diritto con l'acquisto pagato letto dal server", /acquistoPagato: diritti\.acquistoPagato/.test(azioni) && /leggiDirittiPianoLavoro\(\{ admin, accountId: contesto\.accountId, garaId \}\)/.test(azioni));

    const webhook = leggi("src/app/api/webhooks/stripe/route.ts");
    atteso("webhook: il ramo «omnia_ai_piano_lavoro» registra il pagamento (con la chiave di servizio) e non passa dal ramo e-commerce", /session\.metadata\?\.tipo === "omnia_ai_piano_lavoro"/.test(webhook) && /registraPagamentoPianoLavoro\(\{ admin: createAdminClient\(\), sessione: session, eventoId \}\)/.test(webhook) && webhook.indexOf("omnia_ai_piano_lavoro") < webhook.indexOf("const email = session.customer_email"));
    const lib = leggi("src/lib/piano-lavoro-acquisto.ts");
    atteso("il solo punto che segna «pagata» è la registrazione del webhook, e solo da «in_attesa_pagamento»", (lib.match(/stato: "pagata"/g) ?? []).length === 1 && /\.eq\("stato", "in_attesa_pagamento"\)/.test(lib));

    const pagina = leggi("src/app/site-omnia-ai/dashboard/omnia-ai/gare/[id]/page.tsx");
    atteso("pagina della gara: il diritto comprende l'acquisto pagato; l'offerta si valuta solo senza diritto; l'Ufficio Gare non è «titolare»", /acquistoPagato: dirittiPianoLavoro\.acquistoPagato/.test(pagina) && /titolare: !ufficioGare/.test(pagina) && /valutaOffertaAcquisto\(/.test(pagina));
    const pannello = leggi("src/app/site-omnia-ai/dashboard/omnia-ai/gare/[id]/piano-lavoro-panel.tsx");
    atteso("riquadro: il modulo d'acquisto compare solo con l'offerta «acquistabile»; mostra prezzo, avvertenze, due accettazioni obbligatorie e rimanda il prezzo visto", /offerta\.stato === "acquistabile"/.test(pannello) && /name="accettaAvvertenze"[\s\S]{0,200}?required/.test(pannello) && /name="accettaClausole"[\s\S]{0,200}?required/.test(pannello) && /name="prezzoMostratoCentesimi"/.test(pannello) && /IVA inclusa/.test(pannello) && /disabled=\{!accetta \|\| !approva \|\| inCorso\}/.test(pannello));
    atteso("riquadro: l'Ufficio Gare legge che compra il titolare; il riquadro dal browser importa solo regole pure", /offerta\.stato === "solo_titolare"/.test(pannello) && /lo acquista il titolare/.test(pannello) && !/from "@\/lib\/piano-lavoro-acquisto"/.test(pannello) && /from "@\/lib\/piano-lavoro-acquisto-calcoli"/.test(pannello));
    const calcoli = leggi("src/lib/piano-lavoro-acquisto-calcoli.ts");
    atteso("le regole pure dell'acquisto non importano nulla del server (nessun database, nessuna chiave)", !/supabase|createAdminClient|anthropic|stripe"/i.test(calcoli.replace(/\/\/.*$/gm, "")));
    atteso("questi controlli sono nella batteria prima della build", /verifica-piano-lavoro-acquisto-omnia-ai\.ts/.test(leggi("package.json")));
  }

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
