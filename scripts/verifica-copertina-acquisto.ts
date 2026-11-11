// Autotest dell'ACQUISTO della copertina della relazione tecnica (prezzo per cliente deciso dalla console, Stripe una tantum, una gara alla volta),
// senza rete e con un database finto:
//   - quando si può pagare (chiave Stripe reale, o chiave di prova con la prova in locale) e a chi si offre (compra solo il titolare);
//   - una gara PAGATA dà diritto alle generazioni anche se la console poi spegne il servizio; il limite di 3 per stile resta;
//   - il webhook: l'acquisto diventa «pagato» solo lì, una volta sola, solo se la sessione è quella giusta; pagamenti di prova mai da fatturare;
//     pagamento doppio riconosciuto; email richiamate anche per un evento rimandato;
//   - le condizioni accettate prima del pagamento (versione e impronta), BOZZA finché il legale non le approva;
//   - pagamenti del cliente, ricavi e «da fatturare» della console;
//   - le regole scritte nel codice: migrazione 0107, azione con la guardia del titolare e il prezzo letto dal server, webhook, riquadro.
// Gratuito: gira nel livello 1, quindi in prebuild.
import fs from "fs";
import path from "path";
import { createHash } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  APPROVAZIONE_LEGALE_COPERTINA,
  CLAUSOLE_COPERTINA,
  CLAUSOLE_SPECIFICHE_COPERTINA,
  NOTA_CONSOLE_CONDIZIONI_COPERTINA,
  TESTI_COPERTINA,
  VERSIONE_CONDIZIONI_COPERTINA,
  acquistoCopertinaDisponibile,
  controllaSessioneAcquistoCopertina,
  interpretaRitornoCopertina,
  provaAcquistoCopertinaLocaleAttiva,
  testoApprovazioneSpecificaCopertina,
  testoCanonicoCondizioniCopertina,
  valutaOffertaCopertina,
} from "../src/lib/copertina-acquisto-calcoli";
import { registraPagamentoCopertina, type SessionePagamentoCopertina } from "../src/lib/copertina-acquisto";
import { decidi, leggiContestoCopertina, pagamentoCopertinaDisponibile } from "../src/lib/copertina-diritto";
import { valutaDirittoCopertina, type ContestoDirittoCopertina, type ImpostazioniCopertina } from "../src/lib/copertina-diritto-calcoli";
import { emailClienteCopertinaAcquistata, emailUfficioCopertinaAcquistata } from "../src/lib/omnia-ai-email-copertina-calcoli";
import { costruisciPagamenti, percorsoFatturaPagamento, type CopertinaClientePagamento } from "../src/lib/omnia-ai-pagamenti";
import { aggregaRicavi } from "../src/lib/console/ricavi-calcoli";
import { calcolaPeriodo } from "../src/lib/console/periodo";
import { descrizioneCopertinaRiga } from "../src/lib/console/fatturazione-calcoli";

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
  returns() {
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
const ALTRA_GARA = "22222222-2222-4222-8222-222222222222";
const ACQUISTO = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const rigaAttesa = (extra: Riga = {}): Riga => ({
  id: ACQUISTO,
  user_id: ACCOUNT,
  gara_id: GARA,
  gara_titolo: "Pulizie impianti sportivi",
  prezzo_centesimi: 4900,
  stato: "in_attesa_pagamento",
  stripe_session_id: "cs_1",
  stripe_payment_intent_id: null,
  pagata_il: null,
  importo_pagato_centesimi: null,
  stato_fattura: "da_fatturare",
  ...extra,
});

const sessione = (extra: Partial<SessionePagamentoCopertina> = {}): SessionePagamentoCopertina =>
  ({
    id: "cs_1",
    payment_status: "paid",
    payment_intent: "pi_1",
    amount_total: 4900,
    livemode: true,
    customer_details: { name: "Pulizie Srl", email: "info@pulizie.it", address: null, tax_ids: [] },
    customer_email: "info@pulizie.it",
    metadata: { tipo: "omnia_ai_copertina", acquistoId: ACQUISTO, userId: ACCOUNT, garaId: GARA },
    ...extra,
  }) as unknown as SessionePagamentoCopertina;

const spegniErrori = async <T>(f: () => Promise<T>): Promise<T> => {
  const originale = console.error;
  console.error = () => {};
  try {
    return await f();
  } finally {
    console.error = originale;
  }
};

const impostazioniPagamento = (extra: Partial<ImpostazioniCopertina> = {}): ImpostazioniCopertina => ({ attivo: true, modalita: "pagamento", prezzoCentesimi: 4900, gareMassime: null, scadeIl: null, nota: null, ...extra });
const impostazioniGratis = (extra: Partial<ImpostazioniCopertina> = {}): ImpostazioniCopertina => ({ attivo: true, modalita: "gratis", prezzoCentesimi: null, gareMassime: null, scadeIl: null, nota: null, ...extra });
const uso = (stilizzato = 0, realistico = 0) => ({ gareGratisUsate: [] as string[], perStile: { stilizzato, realistico } });
const ctx = (extra: Partial<ContestoDirittoCopertina> = {}): ContestoDirittoCopertina => ({
  impostazioni: impostazioniPagamento(),
  schemaAssente: false,
  sviluppoLocale: false,
  oggi: "2026-11-11",
  garaId: GARA,
  uso: uso(),
  stile: "stilizzato",
  acquistata: false,
  pagamentoDisponibile: true,
  ...extra,
});

const ENV_REALE = { STRIPE_SECRET_KEY_OMNIA_AI: "sk_live_abc" };
const ENV_PROVA = { STRIPE_SECRET_KEY_OMNIA_AI: "sk_test_abc" };
const ENV_PROVA_LOCALE = { STRIPE_SECRET_KEY_OMNIA_AI: "sk_test_abc", OMNIA_AI_COPERTINA_ACQUISTO_PROVA: "1" };

async function main() {
  // ═════ 1. quando si può pagare ═════
  console.log("--- Quando si può pagare ---");
  uguale(
    "la prova in locale vale solo con la variabile a «1» e MAI in produzione né su Vercel",
    [{ OMNIA_AI_COPERTINA_ACQUISTO_PROVA: "1" }, {}, { OMNIA_AI_COPERTINA_ACQUISTO_PROVA: "0" }, { OMNIA_AI_COPERTINA_ACQUISTO_PROVA: "1", NODE_ENV: "production" }, { OMNIA_AI_COPERTINA_ACQUISTO_PROVA: "1", VERCEL: "1" }].map(provaAcquistoCopertinaLocaleAttiva),
    [true, false, false, false, false],
  );
  uguale(
    "si paga con la chiave Stripe reale; in locale anche con quella di prova se la prova è accesa; mai con la chiave di prova e basta né con una sconosciuta",
    [
      acquistoCopertinaDisponibile({ modalita: "reale", provaLocale: false }),
      acquistoCopertinaDisponibile({ modalita: "prova", provaLocale: false }),
      acquistoCopertinaDisponibile({ modalita: "prova", provaLocale: true }),
      acquistoCopertinaDisponibile({ modalita: "sconosciuta", provaLocale: true }),
      acquistoCopertinaDisponibile({ modalita: "reale", provaLocale: true }),
    ],
    [true, false, true, false, true],
  );
  uguale(
    "dall'ambiente: chiave live sì; chiave test senza prova no; chiave test con prova in locale sì; nessuna chiave no",
    [pagamentoCopertinaDisponibile(ENV_REALE), pagamentoCopertinaDisponibile(ENV_PROVA), pagamentoCopertinaDisponibile(ENV_PROVA_LOCALE), pagamentoCopertinaDisponibile({})],
    [true, false, true, false],
  );
  atteso("la prova in locale della copertina ha la sua variabile (non si accende per sbaglio con quella del piano di lavoro)", !pagamentoCopertinaDisponibile({ STRIPE_SECRET_KEY_OMNIA_AI: "sk_test_abc", OMNIA_AI_PIANO_LAVORO_ACQUISTO_PROVA: "1" }));

  // ═════ 2. il diritto con l'acquisto ═════
  console.log("--- Il diritto con l'acquisto ---");
  {
    const daPagare = valutaDirittoCopertina(ctx());
    atteso("servizio a pagamento, gara non pagata, pagamento possibile: non si genera, si può COMPRARE (con il prezzo)", !daPagare.ok && daPagare.motivo === "a_pagamento" && daPagare.acquistabile === true && daPagare.prezzoCentesimi === 4900);
    atteso("il messaggio dice il prezzo per la gara e che dopo l'acquisto si generano fino a 3 copertine per stile (vale anche per l'Ufficio Gare, che non ha il modulo d'acquisto)",!daPagare.ok && /49/.test(daPagare.messaggio) && /IVA inclusa/.test(daPagare.messaggio) && /una volta acquistato/.test(daPagare.messaggio) && !/qui sotto/.test(daPagare.messaggio) && /3 copertine per stile/.test(daPagare.messaggio));
    const nonPossibile = valutaDirittoCopertina(ctx({ pagamentoDisponibile: false }));
    atteso("pagamento NON possibile (chiave non reale o migrazione 0107 mancante): si vede il prezzo, non si compra e non si genera", !nonPossibile.ok && nonPossibile.motivo === "a_pagamento" && nonPossibile.acquistabile === false && /non è ancora disponibile/.test(nonPossibile.messaggio));
    atteso("senza il prezzo (riga incompleta) non è acquistabile", (() => { const e = valutaDirittoCopertina(ctx({ impostazioni: impostazioniPagamento({ prezzoCentesimi: null }) })); return !e.ok && e.motivo === "a_pagamento" && e.acquistabile === false; })());

    const pagata = valutaDirittoCopertina(ctx({ acquistata: true }));
    atteso("gara PAGATA: si genera, con fonte «pagamento» e senza usare gare gratis", pagata.ok && pagata.fonte === "pagamento" && pagata.consumaGara === false);
    atteso("gara pagata e servizio poi SPENTO dalla console: il cliente tiene ciò che ha pagato", valutaDirittoCopertina(ctx({ acquistata: true, impostazioni: impostazioniPagamento({ attivo: false }) })).ok && valutaDirittoCopertina(ctx({ acquistata: true, impostazioni: null })).ok);
    atteso("gara pagata e modalità poi cambiata in «gratis» scaduta: si genera lo stesso (vale l'acquisto)", valutaDirittoCopertina(ctx({ acquistata: true, impostazioni: impostazioniGratis({ scadeIl: "2026-01-01", gareMassime: 1 }) })).ok);
    atteso("gara pagata: il limite di 3 per stile resta (e i due stili sono indipendenti)", (() => { const quarta = valutaDirittoCopertina(ctx({ acquistata: true, uso: uso(3, 0) })); const realistica = valutaDirittoCopertina(ctx({ acquistata: true, uso: uso(3, 0), stile: "realistico" })); return !quarta.ok && quarta.motivo === "limite_stile" && realistica.ok; })());
    atteso("l'acquisto vale per UNA gara: l'altra gara non pagata resta da pagare (il contesto dice quale gara è pagata)", (() => { const e = valutaDirittoCopertina(ctx({ acquistata: false, garaId: ALTRA_GARA })); return !e.ok && e.motivo === "a_pagamento"; })());
    atteso("in locale senza le tabelle (migrazione 0106) resta aperto per le prove, ma una gara pagata è «pagamento»", (() => { const a = valutaDirittoCopertina(ctx({ schemaAssente: true, impostazioni: null, sviluppoLocale: true })); const b = valutaDirittoCopertina(ctx({ schemaAssente: true, impostazioni: null, sviluppoLocale: true, acquistata: true })); return a.ok && a.fonte === "sviluppo" && b.ok && b.fonte === "pagamento"; })());
  }

  // ═════ 3. a chi si offre ═════
  console.log("--- A chi si offre ---");
  {
    const daPagare = valutaDirittoCopertina(ctx());
    uguale("il titolare, con il servizio a pagamento e il pagamento possibile, può comprare (con il prezzo)", valutaOffertaCopertina({ diritto: daPagare, titolare: true }), { stato: "acquistabile", prezzoCentesimi: 4900 });
    uguale("l'Ufficio Gare vede che serve l'acquisto ma non compra", valutaOffertaCopertina({ diritto: daPagare, titolare: false }), { stato: "solo_titolare", prezzoCentesimi: 4900 });
    uguale("pagamento non possibile: nessuna offerta", valutaOffertaCopertina({ diritto: valutaDirittoCopertina(ctx({ pagamentoDisponibile: false })), titolare: true }), { stato: "nessuna" });
    uguale("chi può già generare (gratis, o gara già pagata) non compra", [valutaOffertaCopertina({ diritto: valutaDirittoCopertina(ctx({ impostazioni: impostazioniGratis() })), titolare: true }).stato, valutaOffertaCopertina({ diritto: valutaDirittoCopertina(ctx({ acquistata: true })), titolare: true }).stato], ["nessuna", "nessuna"]);
    uguale("servizio spento: nessuna offerta", valutaOffertaCopertina({ diritto: valutaDirittoCopertina(ctx({ impostazioni: impostazioniPagamento({ attivo: false }) })), titolare: true }), { stato: "nessuna" });
    uguale("ritorno da Stripe: solo «pagato» e «annullato»", [interpretaRitornoCopertina("pagato"), interpretaRitornoCopertina("annullato"), interpretaRitornoCopertina("altro"), interpretaRitornoCopertina(undefined), interpretaRitornoCopertina(["pagato", "x"])], ["pagato", "annullato", null, null, "pagato"]);
  }

  // ═════ 4. la decisione sul database (finto) ═════
  console.log("--- La decisione letta dal database ---");
  {
    const db = (extra: Db = {}): Db => ({
      omnia_ai_copertina_impostazioni: [{ user_id: ACCOUNT, attivo: true, modalita: "pagamento", prezzo_centesimi: 4900, gare_massime: null, scade_il: null, nota: null }],
      gara_copertine: [],
      omnia_ai_copertine_acquisti: [],
      ...extra,
    });
    const letto = await leggiContestoCopertina({ admin: fintoAdmin(db()), accountId: ACCOUNT, garaId: GARA });
    atteso("senza acquisti: gara non pagata, tabella degli acquisti presente", !letto.errore && !letto.acquistata && letto.acquistiDisponibili);
    const conAcquisto = (riga: Riga) => leggiContestoCopertina({ admin: fintoAdmin(db({ omnia_ai_copertine_acquisti: [riga] })), accountId: ACCOUNT, garaId: GARA });
    atteso("acquisto PAGATO di questa gara e di questo cliente: gara pagata", (await conAcquisto(rigaAttesa({ stato: "pagata" }))).acquistata);
    atteso("acquisto solo «in attesa di pagamento»: NON conta (il pagamento lo conferma solo il webhook)", !(await conAcquisto(rigaAttesa())).acquistata);
    atteso("acquisto pagato di un'ALTRA gara o di un ALTRO cliente: NON conta", !(await conAcquisto(rigaAttesa({ stato: "pagata", gara_id: ALTRA_GARA }))).acquistata && !(await conAcquisto(rigaAttesa({ stato: "pagata", user_id: ALTRO }))).acquistata);
    const senzaTabella = await leggiContestoCopertina({ admin: fintoAdmin(db(), ["omnia_ai_copertine_acquisti"]), accountId: ACCOUNT, garaId: GARA });
    atteso("tabella degli acquisti assente (migrazione 0107): nessun errore, nessun acquisto, e non si può comprare", !senzaTabella.errore && !senzaTabella.acquistata && !senzaTabella.acquistiDisponibili && !senzaTabella.schemaAssente);
    const guasto = await spegniErrori(() =>
      leggiContestoCopertina({ admin: { from: (n: string) => (n === "omnia_ai_copertine_acquisti" ? { select: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ limit: async () => ({ data: null, error: { code: "XX000", message: "boom" } }) }) }) }) }) } : new Interrogazione(n, db(), [])) } as unknown as SupabaseClient, accountId: ACCOUNT, garaId: GARA }),
    );
    atteso("un altro errore nella lettura degli acquisti: «errore» (nel dubbio non si decide)", guasto.errore);

    const pagata = await conAcquisto(rigaAttesa({ stato: "pagata" }));
    uguale("decisione con chiave reale: gara non pagata → da comprare; gara pagata → si genera", [(() => { const e = decidi(letto, GARA, "stilizzato", ENV_REALE); return e.ok ? "ok" : e.motivo; })(), (() => { const e = decidi(pagata, GARA, "stilizzato", ENV_REALE); return e.ok ? e.fonte : e.motivo; })()], ["a_pagamento", "pagamento"]);
    atteso("decisione con chiave di prova senza prova in locale: non acquistabile; con la prova in locale: acquistabile", (() => { const a = decidi(letto, GARA, "stilizzato", ENV_PROVA); const b = decidi(letto, GARA, "stilizzato", ENV_PROVA_LOCALE); return !a.ok && a.motivo === "a_pagamento" && !a.acquistabile && !b.ok && b.motivo === "a_pagamento" && b.acquistabile; })());
    atteso("senza la tabella degli acquisti non è acquistabile nemmeno con la chiave reale", (() => { const e = decidi(senzaTabella, GARA, "stilizzato", ENV_REALE); return !e.ok && e.motivo === "a_pagamento" && !e.acquistabile; })());
  }

  // ═════ 5. condizioni accettate ═════
  console.log("--- Condizioni di acquisto ---");
  {
    const testo = testoCanonicoCondizioniCopertina();
    atteso("condizioni: versione 1, sei clausole numerate di seguito, specifiche (natura del risultato, loghi e contenuti, responsabilità) marcate", VERSIONE_CONDIZIONI_COPERTINA === 1 && CLAUSOLE_COPERTINA.map((c) => c.numero).join() === "1,2,3,4,5,6" && CLAUSOLE_SPECIFICHE_COPERTINA.map((c) => c.numero).join() === "2,3,6" && /\[specifica\]/.test(testo));
    atteso("condizioni: dicono cosa compra il cliente (3 generazioni per stile), che il risultato può avere imprecisioni, i loghi, il pagamento anticipato e la limitazione di responsabilità", /fino a 3 generazioni in stile stilizzato e fino a 3 generazioni in stile realistico/.test(testo) && /imprecisioni/.test(testo) && /diritto di usare i loghi/.test(testo) && /pagamento è anticipato/.test(testo) && /limitata, salvo dolo o colpa grave, al corrispettivo pagato/.test(testo));
    atteso("condizioni: dicono al cliente che i dati vanno a OpenAI (la Privacy policy va aggiornata prima di vendere)", /inviati a OpenAI/.test(testo) && /Privacy policy/.test(testo));
    const hash = createHash("sha256").update(testo).digest("hex");
    atteso("l'impronta è stabile (stesso testo, stessa impronta) e cambia se cambia una parola", hash === createHash("sha256").update(testoCanonicoCondizioniCopertina()).digest("hex") && hash !== createHash("sha256").update(testo.replace("fino a 3", "fino a 4")).digest("hex") && hash.length === 64);
    atteso(
      "le clausole sono approvate (11 novembre 2026, versione 1) e la console lo dice, senza attribuirle al legale, ricordando che resta la Privacy policy",
      APPROVAZIONE_LEGALE_COPERTINA !== null && APPROVAZIONE_LEGALE_COPERTINA.data === "11 novembre 2026" && APPROVAZIONE_LEGALE_COPERTINA.versioneClausole === VERSIONE_CONDIZIONI_COPERTINA && /approvate il 11 novembre 2026 su indicazione del titolare/.test(NOTA_CONSOLE_CONDIZIONI_COPERTINA) && !/BOZZA/.test(NOTA_CONSOLE_CONDIZIONI_COPERTINA) && !/dal legale/.test(NOTA_CONSOLE_CONDIZIONI_COPERTINA) && /Privacy policy/.test(NOTA_CONSOLE_CONDIZIONI_COPERTINA) && /nuova versione e una nuova approvazione/.test(NOTA_CONSOLE_CONDIZIONI_COPERTINA),
    );
    // Impronta della versione 1 approvata: se cambia anche una parola questo controllo fallisce, finché non si aumenta VERSIONE_CONDIZIONI_COPERTINA, si ripete l'approvazione e si aggiorna qui.
    uguale("l'impronta delle clausole approvate (versione 1) non è cambiata", hash, "073b20dce3a864dbdc986b56328518876a156931ff37334f7a115afe90899c54");
    atteso("l'approvazione specifica nomina le clausole 2, 3 e 6", /clausole 2 \(natura del risultato\), 3 \(loghi e contenuti del cliente\), 6 \(limitazione di responsabilità\)/.test(testoApprovazioneSpecificaCopertina([2, 3, 6], ["natura del risultato", "loghi e contenuti del cliente", "limitazione di responsabilità"])));
    atteso("testi per il cliente: pagamento ricevuto/confermato/annullato e «solo il titolare»", /lo sto confermando/.test(TESTI_COPERTINA.pagamentoRicevuto) && /Pagamento confermato/.test(TESTI_COPERTINA.pagamentoConfermato) && /non è stato addebitato nulla/.test(TESTI_COPERTINA.pagamentoAnnullato) && /la acquista il titolare/.test(TESTI_COPERTINA.soloTitolare("49 €")));
  }

  // ═════ 6. controllo della sessione ═════
  {
    const riga = { stripe_session_id: "cs_1", user_id: ACCOUNT };
    uguale(
      "sessione: deve essere quella dell'acquisto e dello stesso cliente",
      [controllaSessioneAcquistoCopertina(riga, { id: "cs_1", metadata: { userId: ACCOUNT } }), controllaSessioneAcquistoCopertina(riga, { id: "cs_2" }), controllaSessioneAcquistoCopertina(riga, { id: "cs_1", metadata: { userId: ALTRO } }), controllaSessioneAcquistoCopertina({ ...riga, stripe_session_id: null }, { id: "cs_9", metadata: { userId: ACCOUNT } })],
      [{ ok: true }, { ok: false, motivo: "sessione_diversa" }, { ok: false, motivo: "cliente_diverso" }, { ok: true }],
    );
  }

  // ═════ 7. il webhook ═════
  console.log("--- Il webhook ---");
  type ChiamataNotifica = { livemode: boolean; eventoId: string | null; stato: unknown; importo: unknown; doppio: boolean };
  const nuovaNotifica = () => {
    const chiamate: ChiamataNotifica[] = [];
    const notifica = (async (p: Parameters<NonNullable<Parameters<typeof registraPagamentoCopertina>[0]["notifica"]>>[0]) => {
      chiamate.push({ livemode: p.livemode, eventoId: p.eventoId, stato: p.acquisto.stato, importo: p.acquisto.importo_pagato_centesimi, doppio: !!p.pagamentoDoppio });
    }) as NonNullable<Parameters<typeof registraPagamentoCopertina>[0]["notifica"]>;
    return { chiamate, notifica };
  };

  {
    const db: Db = { omnia_ai_copertine_acquisti: [rigaAttesa()] };
    const n = nuovaNotifica();
    const esito = await registraPagamentoCopertina({ admin: fintoAdmin(db), sessione: sessione(), eventoId: "evt_1", notifica: n.notifica });
    const r = db.omnia_ai_copertine_acquisti[0];
    atteso("pagamento riuscito: l'acquisto diventa «pagato», con importo, sessione, payment intent, modalità e dati di fatturazione di Stripe", esito.esito === "registrato" && r.stato === "pagata" && r.importo_pagato_centesimi === 4900 && r.stripe_session_id === "cs_1" && r.stripe_payment_intent_id === "pi_1" && r.livemode === true && typeof r.pagata_il === "string" && (r.dati_stripe as { name: string }).name === "Pulizie Srl", JSON.stringify({ esito, r }));
    atteso("un pagamento reale resta «da fatturare»", r.stato_fattura === "da_fatturare" && r.note_fattura === undefined);
    uguale("le email partono una volta, con l'acquisto già pagato e senza segnalare doppioni", n.chiamate, [{ livemode: true, eventoId: "evt_1", stato: "pagata", importo: 4900, doppio: false }]);

    // con l'acquisto pagato la gara risulta pagata (è ciò che legge la pagina e l'azione che genera)
    const ctxDopo = await leggiContestoCopertina({ admin: fintoAdmin({ ...db, omnia_ai_copertina_impostazioni: [], gara_copertine: [] }), accountId: ACCOUNT, garaId: GARA });
    atteso("dopo il webhook la gara risulta pagata nel contesto letto", ctxDopo.acquistata);

    // Stripe rimanda lo stesso evento: niente cambia, le email si richiamano (il loro registro evita i doppioni)
    const pagataIl = r.pagata_il;
    const n2 = nuovaNotifica();
    const ripetuto = await registraPagamentoCopertina({ admin: fintoAdmin(db), sessione: sessione(), eventoId: "evt_1", notifica: n2.notifica });
    atteso("evento rimandato: «già registrato», nessuna modifica (stessa data di pagamento), email richiamate", ripetuto.esito === "gia_registrato" && r.pagata_il === pagataIl && n2.chiamate.length === 1 && n2.chiamate[0].doppio === false);
  }

  {
    const db: Db = { omnia_ai_copertine_acquisti: [rigaAttesa()] };
    const n = nuovaNotifica();
    await registraPagamentoCopertina({ admin: fintoAdmin(db), sessione: sessione({ livemode: false }), eventoId: "evt_2", notifica: n.notifica });
    const r = db.omnia_ai_copertine_acquisti[0];
    atteso("pagamento di prova (Stripe in modalità test): registrato ma mai da fatturare, con la nota", r.stato === "pagata" && r.livemode === false && r.stato_fattura === "non_dovuta" && /prova/.test(String(r.note_fattura)) && n.chiamate[0].livemode === false);
  }

  {
    const casi: [string, Db, Partial<SessionePagamentoCopertina>, string][] = [
      ["sessione non pagata", { omnia_ai_copertine_acquisti: [rigaAttesa()] }, { payment_status: "unpaid" }, "non_pagata"],
      ["acquisto senza id nei metadata", { omnia_ai_copertine_acquisti: [rigaAttesa()] }, { metadata: { tipo: "omnia_ai_copertina" } }, "acquisto_id_mancante"],
      ["acquisto inesistente", { omnia_ai_copertine_acquisti: [] }, {}, "non_trovato"],
      ["sessione di un altro pagamento", { omnia_ai_copertine_acquisti: [rigaAttesa({ stripe_session_id: "cs_altra" })] }, {}, "sessione_diversa"],
      ["cliente diverso", { omnia_ai_copertine_acquisti: [rigaAttesa({ user_id: ALTRO })] }, {}, "cliente_diverso"],
    ];
    for (const [nome, db, extra, motivo] of casi) {
      const n = nuovaNotifica();
      const esito = await spegniErrori(() => registraPagamentoCopertina({ admin: fintoAdmin(db), sessione: sessione(extra), eventoId: "evt_x", notifica: n.notifica }));
      const r = db.omnia_ai_copertine_acquisti[0];
      atteso(`webhook ignorato — ${nome}: nessuna modifica e nessuna email`, esito.esito === "ignorato" && esito.motivo === motivo && (!r || r.stato === "in_attesa_pagamento") && n.chiamate.length === 0, JSON.stringify(esito));
    }
    const nSenza = nuovaNotifica();
    const senzaTabella = await spegniErrori(() => registraPagamentoCopertina({ admin: fintoAdmin({}, ["omnia_ai_copertine_acquisti"]), sessione: sessione(), eventoId: "evt_y", notifica: nSenza.notifica }));
    atteso("senza la migrazione 0107 il webhook non cade: ignora e lo scrive nel log", senzaTabella.esito === "ignorato" && nSenza.chiamate.length === 0);
  }

  {
    // due schede di pagamento aperte insieme: il secondo pagamento resta registrato e l'email lo segnala come doppione
    const primo = rigaAttesa({ id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", stato: "pagata", pagata_il: "2026-11-01T10:00:00.000Z", stripe_session_id: "cs_0" });
    const db: Db = { omnia_ai_copertine_acquisti: [primo, rigaAttesa()] };
    const n = nuovaNotifica();
    const esito = await registraPagamentoCopertina({ admin: fintoAdmin(db), sessione: sessione(), eventoId: "evt_3", notifica: n.notifica });
    atteso("pagamento doppio per la stessa gara: registrato comunque, ma l'email lo segnala", esito.esito === "registrato" && db.omnia_ai_copertine_acquisti[1].stato === "pagata" && n.chiamate.length === 1 && n.chiamate[0].doppio === true);
    const altraGara: Db = { omnia_ai_copertine_acquisti: [{ ...primo, gara_id: ALTRA_GARA }, rigaAttesa()] };
    const n2 = nuovaNotifica();
    await registraPagamentoCopertina({ admin: fintoAdmin(altraGara), sessione: sessione(), eventoId: "evt_4", notifica: n2.notifica });
    atteso("un acquisto pagato di un'ALTRA gara non è un doppione", n2.chiamate[0].doppio === false);
  }

  // ═════ 8. le email ═════
  console.log("--- Le email ---");
  {
    const cliente = { email: "info@pulizie.it", nome: "Mario", cognome: "Rossi", ragioneSociale: "Pulizie Srl" } as unknown as Parameters<typeof emailUfficioCopertinaAcquistata>[0]["cliente"];
    const ufficio = emailUfficioCopertinaAcquistata({ prova: false, acquistoId: ACQUISTO, cliente, azienda: null, fatturazione: { nome: "Pulizie Srl", email: null, telefono: null, indirizzo: "Via Roma 1, 20100 Milano, IT", identificativiFiscali: ["eu_vat: IT01234567890"] }, garaTitolo: "Pulizie <impianti>", importoPagatoCentesimi: 4900, pagataIl: new Date("2026-11-11T10:00:00Z"), stripePaymentIntentId: "pi_1", pagamentoDoppio: false });
    atteso("email all'ufficio: gara (con il testo protetto), importo, dati di fatturazione, cosa fare (la fattura), link a Stripe", /Copertina acquistata/.test(ufficio.oggetto) && /Pulizie &lt;impianti&gt;/.test(ufficio.html) && !/Pulizie <impianti>/.test(ufficio.html) && /49/.test(ufficio.html) && /IT01234567890/.test(ufficio.html) && /fattura/i.test(ufficio.html) && /stripe\.com/.test(ufficio.html) && /3 generazioni per stile/.test(ufficio.html) && !/PAGAMENTO DOPPIO/.test(ufficio.oggetto));
    const doppio = emailUfficioCopertinaAcquistata({ prova: false, acquistoId: ACQUISTO, cliente, azienda: null, fatturazione: null, garaTitolo: "G", importoPagatoCentesimi: 4900, pagataIl: new Date(), stripePaymentIntentId: null, pagamentoDoppio: true });
    atteso("email all'ufficio: il pagamento doppio è nell'oggetto e nel testo", /^PAGAMENTO DOPPIO/.test(doppio.oggetto.replace(/^\[PROVA\] ?/, "")) && /pagamento doppio/.test(doppio.html));
    const prova = emailUfficioCopertinaAcquistata({ prova: true, acquistoId: ACQUISTO, cliente, azienda: null, fatturazione: null, garaTitolo: "G", importoPagatoCentesimi: 4900, pagataIl: new Date(), stripePaymentIntentId: "pi_1", pagamentoDoppio: false });
    atteso("un pagamento di prova è segnato come prova nell'oggetto", /prova/i.test(prova.oggetto));
    const conferma = emailClienteCopertinaAcquistata({ prova: false, garaTitolo: "Gara & Co", importoCentesimi: 4900, pagataIl: new Date("2026-11-11T10:00:00Z"), linkGara: "https://omnia-ai.it/dashboard/omnia-ai/gare/x" });
    atteso("conferma al cliente: importo IVA inclusa, cosa fare adesso (due stili, 3 per stile), controllare testi e loghi, pulsante per tornare alla gara", /49/.test(conferma.html) && /IVA inclusa/.test(conferma.html) && /Gara &amp; Co/.test(conferma.html) && /stilizzato/.test(conferma.html) && /3 generazioni per ogni stile/.test(conferma.html) && /imprecisioni/.test(conferma.html) && /https:\/\/omnia-ai\.it\/dashboard\/omnia-ai\/gare\/x/.test(conferma.html));
  }

  // ═════ 9. pagamenti del cliente, ricavi, da fatturare ═════
  console.log("--- Pagamenti, ricavi, da fatturare ---");
  {
    const cp = (extra: Partial<CopertinaClientePagamento> = {}): CopertinaClientePagamento => ({ id: ACQUISTO, gara_titolo: "Pulizie impianti", prezzo_centesimi: 4900, importo_pagato_centesimi: 4900, pagata_il: "2026-11-11T10:00:00Z", livemode: true, stato_fattura: "da_fatturare", numero_fattura: null, data_fattura: null, fattura_file_path: null, ...extra });
    const elenco = costruisciPagamenti([], [], [], [], [], [], [cp(), cp({ id: "x", pagata_il: null }), cp({ id: "y", livemode: false, stato_fattura: "non_dovuta", pagata_il: "2026-11-12T10:00:00Z", importo_pagato_centesimi: null })]);
    atteso(
      "pagamenti del cliente: solo gli acquisti PAGATI, con descrizione, importo (o prezzo se manca), prova e stato della fattura; i più recenti per primi",
      elenco.length === 2 && elenco[0].id === "y" && elenco[0].prova === true && elenco[0].fattura.tipo === "non_dovuta" && elenco[0].importoCentesimi === 4900 && elenco[1].fonte === "copertina" && elenco[1].chiave === `copertina:${ACQUISTO}` && /Copertina della relazione tecnica — Pulizie impianti/.test(elenco[1].descrizione) && elenco[1].fattura.tipo === "in_preparazione" && elenco[1].prova === false,
      JSON.stringify(elenco),
    );
    uguale("la fattura di una copertina ha il suo PDF in una cartella a parte", percorsoFatturaPagamento("copertina", ACQUISTO), `omnia-ai/copertine/${ACQUISTO}.pdf`);
    uguale("la riga di fatturazione della console descrive la copertina con la gara", descrizioneCopertinaRiga("Pulizie impianti"), "Copertina della relazione tecnica — Pulizie impianti");

    const novembre = calcolaPeriodo({}, new Date("2026-11-20T10:00:00Z"));
    const ricavi = aggregaRicavi(
      [
        { dominio: "omnia_ai", fonte: "copertina", data: "2026-11-11T10:00:00Z", lordo: 49, impostaStripe: null, prova: false, dataApprossimata: false },
        { dominio: "omnia_ai", fonte: "copertina", data: "2026-11-12T10:00:00Z", lordo: 49, impostaStripe: null, prova: true, dataApprossimata: false },
        { dominio: "omnia_ai", fonte: "abbonamento", data: "2026-11-13T10:00:00Z", lordo: 122, impostaStripe: null, prova: false, dataApprossimata: false },
      ],
      novembre,
      22,
      false,
    );
    const mese = ricavi.perMese[0];
    atteso(
      "ricavi: un acquisto della copertina non finisce tra gli abbonamenti ma nella sua colonna, scorporando l'IVA (49 € → 40,16 €); quello di prova è escluso e dichiarato",
      Math.abs(ricavi.totali.copertineNetto - 49 / 1.22) < 0.005 && ricavi.totali.acquistiCopertina === 1 && Math.abs(ricavi.totali.abbonamentiNetto - 100) < 0.005 && ricavi.totali.incassiAbbonamento === 1 && Math.abs(mese.copertine - 49 / 1.22) < 0.005 && ricavi.prova.voci === 1 && ricavi.prova.incluse === false && Math.abs(ricavi.totali.omniaAiNetto - (49 / 1.22 + 100)) < 0.005,
      JSON.stringify(ricavi.totali),
    );

    const fatturazione = leggi("src/lib/console/fatturazione.ts");
    atteso("da fatturare: legge gli acquisti PAGATI (tabella assente tollerata, ogni altro errore dichiarato), li riga con la chiave «copertina:<id>», scorpora l'IVA e porta lo stato di fattura", /from\("omnia_ai_copertine_acquisti"\)\.select\(COLONNE_COPERTINA\)\.eq\("stato", "pagata"\)/.test(fatturazione) && /copertineQ\.error && !schemaAssente\(copertineQ\.error\)/.test(fatturazione) && /chiave: `copertina:\$\{c\.id\}`/.test(fatturazione) && /fonte: "copertina"/.test(fatturazione) && /calcolaImporti\(num\(c\.importo_pagato_centesimi \?\? c\.prezzo_centesimi\) \/ 100, null, null, parametri\.aliquotaIva\)/.test(fatturazione) && /\.\.\.statoDi\(c\)/.test(fatturazione));
    atteso("da fatturare: il contatore della barra laterale somma anche le copertine (solo pagate, da fatturare, non di prova) e senza la tabella conta il resto", /omnia_ai_copertine_acquisti"\)\.select\("importo_pagato_centesimi, prezzo_centesimi"\)\.eq\("stato", "pagata"\)\.eq\("stato_fattura", "da_fatturare"\)\.eq\("livemode", true\)/.test(fatturazione) && /copertineReali\.length/.test(fatturazione) && /if \(copertineQ\.error && !tabellaCopertineAssente\) return null;/.test(fatturazione));
    const ricaviLettura = leggi("src/lib/console/ricavi.ts");
    atteso("ricavi: legge gli acquisti pagati nel periodo, con la data del pagamento (esatta) e il segno di prova, e la tabella assente non fa cadere la pagina", /from\("omnia_ai_copertine_acquisti"\)[\s\S]{0,200}\.eq\("stato", "pagata"\)\.gte\("pagata_il", periodo\.daIso\)\.lt\("pagata_il", periodo\.aIso\)/.test(ricaviLettura) && /fonte: "copertina"/.test(ricaviLettura) && /copertineQ\.error \? \[\]/.test(ricaviLettura));
    atteso("dati di prova e scheda cliente: contano e mostrano anche le copertine", /omnia_ai_copertine_acquisti/.test(leggi("src/lib/console/prova.ts")) && /omnia_ai_copertine_acquisti/.test(leggi("src/lib/console/utenti.ts")) && /Copertine della relazione acquistate/.test(leggi("src/app/site-console/_componenti/scheda-cliente-vista.tsx")));
    const eliminazione = leggi("src/app/site-console/azioni/utenti.ts");
    atteso("eliminare un cliente con un acquisto reale della copertina è rifiutato (dato contabile da conservare: si anonimizza)", /omnia_ai_copertine_acquisti"\)\.select\("id", \{ count: "exact", head: true \}\)\.eq\("user_id", bersaglio\.id\)\.eq\("stato", "pagata"\)\.eq\("livemode", true\)/.test(eliminazione) && /copertineReali\.count/.test(eliminazione));
    const costi = leggi("src/lib/console/costi.ts") + leggi("src/lib/console/costi-calcoli.ts");
    atteso("costi e margini non includono gli acquisti della copertina (come le revisioni)", !/omnia_ai_copertine_acquisti/.test(costi));
    const paginaPagamenti = leggi("src/app/site-omnia-ai/dashboard/omnia-ai/pagamenti/page.tsx");
    const grant = (leggi("supabase/migrations/0107_copertine_acquisti.sql").match(/grant select \(([^)]*)\)\s*on public\.omnia_ai_copertine_acquisti to authenticated/) ?? [])[1] ?? "";
    const colonneGrant = grant.split(",").map((c) => c.trim()).filter(Boolean);
    const colonnePagina = ((paginaPagamenti.match(/COLONNE_COPERTINA = "([^"]*)"/) ?? [])[1] ?? "").split(",").map((c) => c.trim()).filter(Boolean);
    atteso("pagamenti del cliente: legge con la SUA sessione (mai la chiave di servizio), solo le sue righe pagate, e solo colonne che la migrazione gli concede", /from\("omnia_ai_copertine_acquisti"\)[\s\S]{0,200}\.eq\("user_id", user\.id\)[\s\S]{0,60}\.eq\("stato", "pagata"\)/.test(paginaPagamenti) && !/createAdminClient/.test(paginaPagamenti) && colonnePagina.length >= 8 && colonnePagina.every((c) => colonneGrant.includes(c)), `${colonnePagina.filter((c) => !colonneGrant.includes(c)).join(",")}`);
  }

  // ═════ 10. regole scritte nel codice ═════
  console.log("--- Regole nel codice ---");
  {
    const migrazione = leggi("supabase/migrations/0107_copertine_acquisti.sql");
    atteso("migrazione 0107: tabella con le regole di accesso attive, stato e stato di fattura vincolati, sessione Stripe unica, riferimenti che si azzerano (mai cancellati) con l'utente e la gara", /create table if not exists public\.omnia_ai_copertine_acquisti/.test(migrazione) && /enable row level security/.test(migrazione) && /check \(stato in \('in_attesa_pagamento', 'pagata'\)\)/.test(migrazione) && /check \(stato_fattura in \('da_fatturare', 'fatturata', 'non_dovuta'\)\)/.test(migrazione) && /stripe_session_id text unique/.test(migrazione) && /user_id uuid references public\.users \(id\) on delete set null/.test(migrazione) && /gara_id uuid references public\.gare \(id\) on delete set null/.test(migrazione));
    atteso("migrazione 0107: il server scrive (senza cancellare: è un pagamento ricevuto); il titolare legge solo i SUOI pagamenti e solo le colonne utili (niente dati di Stripe, indirizzo IP, browser, note interne)", /grant select, insert, update on public\.omnia_ai_copertine_acquisti to service_role/.test(migrazione) && !/grant[^;]*delete[^;]*omnia_ai_copertine_acquisti/.test(migrazione) && /for select using \(user_id = auth\.uid\(\)\)/.test(migrazione) && !/grant (insert|update|delete)[^;]*to authenticated/.test(migrazione) && !/grant select \([^)]*\b(dati_stripe|accept_ip|accept_user_agent|note_fattura|stripe_session_id|stripe_payment_intent_id|condizioni_hash)\b/.test(migrazione));
    const tipi = [...leggi("supabase/migrations/0104_pacchetti_servizi.sql").matchAll(/^\s+'([a-z_]+)',?$/gm)].map((m) => m[1]).filter((t) => /^(nuovo_cliente|cambio_piano|acquisto_crediti|disdetta|mancato_pagamento|pagamento_ricevuto|disdetta_confermata|metodo_pagamento_cambiato|revisione_umana_richiesta|revisione_umana_ricevuta|piano_lavoro_acquistato|piano_lavoro_ricevuto|pacchetto_acquistato|pacchetto_ricevuto)$/.test(t));
    const nuovi = [...migrazione.matchAll(/^\s+'([a-z_]+)',?$/gm)].map((m) => m[1]);
    atteso("migrazione 0107: il registro delle email accetta TUTTI i tipi di prima e i due nuovi", tipi.length === 14 && tipi.every((t) => nuovi.includes(t)) && nuovi.includes("copertina_acquistata") && nuovi.includes("copertina_ricevuta"), `${tipi.length} vecchi, ${nuovi.length} nuovi`);
    const eventi = leggi("src/lib/omnia-ai-email-eventi.ts");
    const invio = leggi("src/lib/omnia-ai-email-copertina.ts");
    atteso("i due tipi di email sono nel tipo TypeScript e usati dall'invio, con chiavi per acquisto (mai doppie)", /"copertina_acquistata"/.test(eventi) && /"copertina_ricevuta"/.test(eventi) && /tipo: "copertina_acquistata"/.test(invio) && /tipo: "copertina_ricevuta"/.test(invio) && /chiave: `copertina:\$\{acquisto\.id\}:ufficio`/.test(invio) && /chiave: `copertina:\$\{acquisto\.id\}:cliente`/.test(invio));

    const azioni = leggi("src/app/actions/gara-copertina.ts");
    const i = azioni.indexOf("export async function acquistaCopertina");
    const acquista = azioni.slice(i, azioni.indexOf("export type DownloadCopertinaState"));
    const ordine = ["richiediTitolareAzione()", "requireOmniaAiWriteAccess", "accettaAvvertenze", "accettaClausole", "estrazione_stato !== \"completata\"", "leggiContestoCopertina(", "ctx.acquistata", "decidi(ctx", "diritto.motivo !== \"a_pagamento\"", "diritto.acquistabile", "mostrato !== prezzo", "omnia_ai_copertine_acquisti", "checkout.sessions.create"].map((s) => acquista.indexOf(s));
    atteso("acquisto: l'azione parte dalla guardia del TITOLARE (l'Ufficio Gare non compra), poi accesso in scrittura, accettazioni, gara analizzata, impostazioni del cliente, diritto, prezzo, registrazione e solo alla fine Stripe", i !== -1 && ordine.every((p, k) => p >= 0 && (k === 0 || p > ordine[k - 1])), JSON.stringify(ordine));
    atteso("acquisto: il prezzo è QUELLO DELLE IMPOSTAZIONI del cliente, riletto dal server (quello del form serve solo a accorgersi di un cambio) ed è quello che si addebita e si registra", /const prezzo = diritto\.prezzoCentesimi/.test(acquista) && /mostrato !== prezzo/.test(acquista) && /unit_amount: prezzo/.test(acquista) && /prezzo_centesimi: prezzo/.test(acquista) && !/unit_amount: mostrato/.test(acquista) && !/formData\.get\("prezzo"\)/.test(acquista));
    atteso("acquisto: si paga solo se cambia qualcosa (gara non già pagata, nessun diritto già presente, servizio a pagamento, pagamento possibile)", /if \(ctx\.acquistata\) return \{ error/.test(acquista) && /if \(diritto\.ok\) return \{ error/.test(acquista) && /diritto\.motivo !== "a_pagamento"\) return \{ error: diritto\.messaggio/.test(acquista) && /!diritto\.acquistabile \|\| diritto\.prezzoCentesimi === null/.test(acquista));
    atteso("acquisto: la gara si legge con la sessione del cliente (regole di accesso), l'email di Stripe è quella dell'account, l'accettazione si registra (versione, impronta, indirizzo IP, Privacy policy)", /supabase\.from\("gare"\)/.test(acquista) && /customer_email: user\.email/.test(acquista) && /condizioni_hash: condizioniHash/.test(acquista) && /accept_ip: ip/.test(acquista) && /condizioni_versione: VERSIONE_CONDIZIONI_COPERTINA/.test(acquista) && /privacy_versione: documenti\?\.privacyPolicy\.version/.test(acquista));
    atteso("acquisto: i metadata dicono il tipo (per il webhook) e Stripe riporta alla gara; l'azione NON segna mai l'acquisto come pagato né tocca la fatturazione", /tipo: "omnia_ai_copertina"/.test(acquista) && /acquistoId: acquisto\.id/.test(acquista) && /\?copertina=pagato/.test(acquista) && /\?copertina=annullato/.test(acquista) && !/stato: "pagata"/.test(azioni) && !/stato_fattura/.test(azioni));
    atteso("acquisto: la riga registra se il pagamento è di prova (chiave test) e non si legge nulla dal browser tranne gara, prezzo visto e accettazioni", /livemode: !process\.env\.STRIPE_SECRET_KEY_OMNIA_AI\?\.startsWith\("sk_test_"\)/.test(acquista) && (acquista.match(/formData\.get\("([a-zA-Z]+)"\)/g) ?? []).every((m) => /garaId|accettaAvvertenze|accettaClausole|prezzoMostratoCentesimi/.test(m)));
    const generazione = azioni.slice(azioni.indexOf("export async function generaCopertinaGara"), i);
    atteso("la generazione registra la fonte «pagamento» quando la gara è pagata (la fonte la decide il server)", /fonte: diritto\.fonte/.test(generazione) && /decidi\(ctx, gara\.id, stile\)/.test(generazione));

    const webhook = leggi("src/app/api/webhooks/stripe/route.ts");
    atteso("webhook: il ramo «omnia_ai_copertina» registra il pagamento (con la chiave di servizio) e non passa dal ramo e-commerce", /session\.metadata\?\.tipo === "omnia_ai_copertina"/.test(webhook) && /registraPagamentoCopertina\(\{ admin: createAdminClient\(\), sessione: session, eventoId \}\)/.test(webhook) && webhook.indexOf("omnia_ai_copertina") < webhook.indexOf("const email = session.customer_email"));
    const lib = leggi("src/lib/copertina-acquisto.ts");
    atteso("il solo punto che segna «pagata» è la registrazione del webhook, e solo da «in_attesa_pagamento»", (lib.match(/stato: "pagata"/g) ?? []).length === 1 && /\.eq\("stato", "in_attesa_pagamento"\)/.test(lib));

    const pagina = leggi("src/app/site-omnia-ai/dashboard/omnia-ai/gare/[id]/page.tsx");
    atteso("pagina della gara: l'offerta si valuta sul diritto (decidiCopertina); l'Ufficio Gare non è «titolare»; l'acquisto pagato rende visibile il riquadro", /valutaOffertaCopertina\(\{ diritto: decidiCopertina\(ctxCopertina, gara\.id, "stilizzato"\), titolare: !ufficioGare \}\)/.test(pagina) && /acquistata: ctxCopertina\.acquistata/.test(pagina) && /interpretaRitornoCopertina\(ritornoCopertina\)/.test(pagina));
    const pannello = leggi("src/app/site-omnia-ai/dashboard/omnia-ai/gare/[id]/copertina-panel.tsx");
    const modulo = leggi("src/app/site-omnia-ai/dashboard/omnia-ai/gare/[id]/copertina-acquisto.tsx");
    atteso("riquadro: il modulo d'acquisto compare solo con l'offerta «acquistabile», FUORI dal modulo di generazione, e non appena pagato (finché il webhook non conferma)", /offerta\.stato === "acquistabile" && !inConferma/.test(pannello) && pannello.indexOf("</form>") < pannello.indexOf("<AcquistoCopertina") && /const inConferma = ritorno === "pagato" && !acquistata/.test(pannello));
    atteso("modulo d'acquisto: mostra prezzo (IVA inclusa), condizioni da leggere, due accettazioni obbligatorie e rimanda il prezzo visto; il pulsante resta spento finché non si accetta", /name="accettaAvvertenze"[\s\S]{0,200}?required/.test(modulo) && /name="accettaClausole"[\s\S]{0,200}?required/.test(modulo) && /name="prezzoMostratoCentesimi"/.test(modulo) && /IVA inclusa/.test(modulo) && /disabled=\{!accetta \|\| !approva \|\| inCorso\}/.test(modulo));
    atteso("riquadro: l'Ufficio Gare legge che compra il titolare; il browser importa solo regole pure", /offerta\.stato === "solo_titolare"/.test(pannello) && /soloTitolare/.test(pannello) && !/from "@\/lib\/copertina-diritto"/.test(pannello + modulo) && !/from "@\/lib\/copertina-acquisto"/.test(pannello + modulo) && /from "@\/lib\/copertina-acquisto-calcoli"/.test(pannello));
    const calcoli = leggi("src/lib/copertina-acquisto-calcoli.ts");
    atteso("le regole pure dell'acquisto non importano nulla del server (nessun database, nessuna chiave)", !/supabase|createAdminClient|anthropic|stripe"/i.test(calcoli.replace(/\/\/.*$/gm, "")));

    const consoleAzione = leggi("src/app/site-console/azioni/copertina.ts");
    atteso("console: salvando «a pagamento» dice subito cosa manca perché il cliente possa pagare (migrazione 0107, chiave Stripe reale) e che le condizioni sono una bozza", /Salvato, ma il cliente per ora NON può pagare/.test(consoleAzione) && /manca la migrazione 0107/.test(consoleAzione) && /pagamentoCopertinaDisponibile\(process\.env\)/.test(consoleAzione) && /NOTA_CONSOLE_CONDIZIONI_COPERTINA/.test(consoleAzione) && !/non è ancora attivo/.test(consoleAzione));
    atteso("questi controlli sono nella batteria prima della build", /verifica-copertina-acquisto\.ts/.test(leggi("package.json")));
  }

  console.log("");
  if (fallimenti.length > 0) {
    console.error(`${fallimenti.length} controlli falliti:\n - ${fallimenti.join("\n - ")}`);
    process.exit(1);
  }
  console.log("Tutti i controlli dell'acquisto della copertina sono superati.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
