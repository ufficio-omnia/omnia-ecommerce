// Autotest del PIANO DI LAVORO NELL'ABBONAMENTO e delle CONCESSIONI dalla console, senza rete e con un database e uno Stripe finti:
//   - il prezzo: piano + supplemento (150/350/900 €), uno per piano, con la chiave «_pdl»; il supplemento si cambia dalla console;
//   - chi ha il diritto a generare, in ordine: concessione, abbonamento (solo le gare del PIANO, non quelle a crediti), prova gratuita, acquisto;
//   - le concessioni: tutte le gare o una, con numero massimo e scadenza, revocate mai cancellate;
//   - il cambio di piano con e senza piano di lavoro (aggiungerlo è salire, toglierlo è scendere);
//   - l'allineamento dei prezzi su Stripe (mai modificare né archiviare un prezzo esistente);
//   - le regole scritte nel codice: migrazione 0101, checkout, webhook, cambio piano, azioni e pagina della console.
// Gratuito: gira nel livello 1, quindi in prebuild.
import fs from "fs";
import path from "path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PIANI_ORDINE } from "../src/lib/omnia-ai-plans";
import { lookupKeyDelPiano, lookupKeyDellOfferta, offertaDaLookupKey, pianoDaLookupKey } from "../src/lib/omnia-ai-stripe-prices";
import {
  CHIAVE_POLITICA_PROVA,
  LIMITI_SURPLUS,
  SURPLUS_PIANO_LAVORO_PREDEFINITO,
  chiaveSurplusPianoLavoro,
  descriviConcessione,
  etichettaOfferta,
  interpretaDestinazione,
  interpretaPoliticaProva,
  interpretaSurplus,
  prezzoConPianoLavoro,
  rilevaCambioPianoLavoro,
  scegliConcessione,
  statoPrezzoOfferta,
  surplusDaImpostazioni,
  tipoCambioOfferta,
  validaNuovaConcessione,
  type OffertaAbbonamento,
  type RigaConcessione,
} from "../src/lib/piano-lavoro-offerta-calcoli";
import { valutaDirittoPiano, type ContestoDirittoPiano } from "../src/lib/piano-lavoro-gara-calcoli";
import { leggiDirittiPianoLavoro } from "../src/lib/piano-lavoro-diritti";
import { leggiSurplusPianoLavoro } from "../src/lib/piano-lavoro-offerta";
import { allineaPrezziPianoLavoro, type PrezzoStripePianoLavoro, type StripePianoLavoro } from "../src/lib/console/piano-lavoro-stripe";
import { emailUfficioPianoLavoroAbbonamento } from "../src/lib/omnia-ai-email-piano-lavoro-calcoli";
import { emailUfficioNuovoCliente } from "../src/lib/omnia-ai-email-eventi-calcoli";
import type { OmniaAiAccessState } from "../src/lib/omnia-ai-access";

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
type Guasti = { tabelleAssenti?: string[]; colonneAssenti?: Record<string, string[]> };

class Interrogazione {
  private filtri: ((r: Riga) => boolean)[] = [];
  private colonne = "";
  private ordine: { colonna: string; crescente: boolean } | null = null;
  private massimo = Infinity;
  private singolo = false;
  constructor(
    private nome: string,
    private db: Db,
    private guasti: Guasti,
  ) {}
  select(colonne?: string) {
    this.colonne = colonne ?? "";
    return this;
  }
  eq(c: string, v: unknown) {
    this.filtri.push((r) => r[c] === v);
    return this;
  }
  in(c: string, valori: unknown[]) {
    this.filtri.push((r) => valori.includes(r[c]));
    return this;
  }
  order(colonna: string, o?: { ascending?: boolean }) {
    this.ordine = { colonna, crescente: o?.ascending !== false };
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
  then<T>(res: (v: { data: unknown; error: { code?: string; message: string } | null }) => T, rej?: (e: unknown) => T) {
    return Promise.resolve(this.esegui()).then(res, rej);
  }
  private esegui(): { data: unknown; error: { code?: string; message: string } | null } {
    if (this.guasti.tabelleAssenti?.includes(this.nome)) return { data: null, error: { code: "42P01", message: `relation "${this.nome}" does not exist` } };
    const assenti = this.guasti.colonneAssenti?.[this.nome] ?? [];
    if (assenti.some((c) => this.colonne.split(",").map((x) => x.trim()).includes(c))) return { data: null, error: { code: "42703", message: "column does not exist" } };
    let righe = (this.db[this.nome] ?? []).filter((r) => this.filtri.every((f) => f(r)));
    if (this.ordine) {
      const { colonna, crescente } = this.ordine;
      righe = [...righe].sort((a, b) => (String(a[colonna]) < String(b[colonna]) ? -1 : String(a[colonna]) > String(b[colonna]) ? 1 : 0) * (crescente ? 1 : -1));
    }
    righe = righe.slice(0, this.massimo);
    return { data: this.singolo ? (righe[0] ?? null) : righe, error: null };
  }
}
const fintoAdmin = (db: Db, guasti: Guasti = {}) => ({ from: (nome: string) => new Interrogazione(nome, db, guasti) }) as unknown as SupabaseClient;

const ACCOUNT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ALTRO = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const GARA = "11111111-1111-4111-8111-111111111111";
const GARA2 = "22222222-2222-4222-8222-222222222222";
const GARA3 = "33333333-3333-4333-8333-333333333333";
const FUTURO = new Date(Date.now() + 10 * 86_400_000).toISOString();
const PASSATO = new Date(Date.now() - 2 * 86_400_000).toISOString();
const attivo: OmniaAiAccessState = { stato: "attivo" };
const inProva = { stato: "prova", gare: { rimanenti: 2, totale: 3 } } as unknown as OmniaAiAccessState;

async function main() {
  // ═════ 1. prezzi e supplementi ═════
  uguale("supplementi di partenza: 150, 350 e 900 euro al mese", PIANI_ORDINE.map((p) => SURPLUS_PIANO_LAVORO_PREDEFINITO[p]), [15000, 35000, 90000]);
  uguale(
    "il supplemento salvato dalla console conta se è un intero in centesimi nei limiti, altrimenti vale quello del codice",
    [interpretaSurplus("20000", "starter"), interpretaSurplus(" 20000 ", "starter"), interpretaSurplus(null, "professional"), interpretaSurplus("abc", "enterprise"), interpretaSurplus("150,00", "starter"), interpretaSurplus("50", "starter"), interpretaSurplus(String(LIMITI_SURPLUS.massimoCentesimi + 1), "starter"), interpretaSurplus(-5, "starter")],
    [20000, 20000, 35000, 90000, 15000, 15000, 15000, 15000],
  );
  uguale(
    "i tre supplementi si leggono dalle impostazioni, uno per piano, con il valore del codice per quelli che mancano",
    surplusDaImpostazioni([{ chiave: chiaveSurplusPianoLavoro("professional"), valore: "40000" }, { chiave: "altra_cosa", valore: "1" }]),
    { starter: 15000, professional: 40000, enterprise: 90000 },
  );
  uguale("il prezzo con il piano di lavoro è il prezzo del piano + il supplemento (Starter 699 → 849 €)", [prezzoConPianoLavoro(69900, 15000), prezzoConPianoLavoro(149000, 35000), prezzoConPianoLavoro(290000, 90000)], [84900, 184000, 380000]);
  uguale("prezzo Stripe dell'offerta: allineato, mancante o da allineare", [statoPrezzoOfferta(84900, 84900), statoPrezzoOfferta(84900, null), statoPrezzoOfferta(84900, undefined), statoPrezzoOfferta(84900, 69900)], ["allineato", "mancante", "mancante", "da_allineare"]);
  {
    const salvati = new Map<string, string>([[chiaveSurplusPianoLavoro("starter"), "17500"]]);
    const db: Db = { console_impostazioni: [...salvati].map(([chiave, valore]) => ({ chiave, valore })) };
    uguale("lettura dal database: il supplemento della console, gli altri del codice; con la tabella assente tutti del codice", [await leggiSurplusPianoLavoro(fintoAdmin(db)), await leggiSurplusPianoLavoro(fintoAdmin({}, { tabelleAssenti: ["console_impostazioni"] }))], [{ starter: 17500, professional: 35000, enterprise: 90000 }, { starter: 15000, professional: 35000, enterprise: 90000 }]);
  }

  // ═════ 2. la chiave Stripe dell'offerta ═════
  uguale(
    "chiavi Stripe: «omnia_ai_<piano>» senza piano di lavoro, «omnia_ai_<piano>_pdl» con; dal prezzo si risale a entrambi",
    [lookupKeyDelPiano("starter"), lookupKeyDellOfferta("starter", false), lookupKeyDellOfferta("professional", true), offertaDaLookupKey("omnia_ai_enterprise_pdl"), offertaDaLookupKey("omnia_ai_starter"), pianoDaLookupKey("omnia_ai_professional_pdl"), pianoDaLookupKey("omnia_ai_professional")],
    ["omnia_ai_starter", "omnia_ai_starter", "omnia_ai_professional_pdl", { piano: "enterprise", pianoLavoro: true }, { piano: "starter", pianoLavoro: false }, "professional", "professional"],
  );
  uguale("chiavi non riconosciute: nessuna offerta", [offertaDaLookupKey(null), offertaDaLookupKey(undefined), offertaDaLookupKey(""), offertaDaLookupKey("omnia_ai_pdl"), offertaDaLookupKey("omnia_ai_foo_pdl"), offertaDaLookupKey("altro_starter_pdl"), offertaDaLookupKey("omnia_ai_starter_pdl_pdl"), pianoDaLookupKey("omnia_ai_starter_x")], [null, null, null, null, null, null, null, null]);

  // ═════ 3. il cambio di piano ═════
  {
    const base = (piano: "starter" | "professional" | "enterprise", pianoLavoro = false): OffertaAbbonamento => ({ piano, pianoLavoro });
    uguale(
      "destinazione dal browser: «piano» mantiene il piano di lavoro che si ha, «:lavoro» lo aggiunge, «:base» lo toglie; il resto non vale",
      [interpretaDestinazione("professional", base("starter", true)), interpretaDestinazione("professional", base("starter", false)), interpretaDestinazione("starter:lavoro", base("starter")), interpretaDestinazione("starter:base", base("starter", true)), interpretaDestinazione("starter:altro", base("starter")), interpretaDestinazione("fantasia", base("starter")), interpretaDestinazione("starter:lavoro:x", base("starter")), interpretaDestinazione("", base("starter")), interpretaDestinazione("constructor", base("starter"))],
      [{ piano: "professional", pianoLavoro: true }, { piano: "professional", pianoLavoro: false }, { piano: "starter", pianoLavoro: true }, { piano: "starter", pianoLavoro: false }, null, null, null, null, null],
    );
    uguale(
      "salire o scendere: dall'ordine dei piani; a parità di piano aggiungere il piano di lavoro è salire e toglierlo è scendere; identica = nulla da fare",
      [
        tipoCambioOfferta(base("starter"), base("professional")),
        tipoCambioOfferta(base("professional"), base("starter")),
        tipoCambioOfferta(base("starter"), base("starter", true)),
        tipoCambioOfferta(base("starter", true), base("starter")),
        tipoCambioOfferta(base("starter"), base("starter")),
        tipoCambioOfferta(base("starter", true), base("professional")),
        tipoCambioOfferta(base("professional", true), base("starter", true)),
        tipoCambioOfferta(base("enterprise"), base("starter", true)),
      ],
      ["upgrade", "downgrade", "upgrade", "downgrade", null, "upgrade", "downgrade", "downgrade"],
    );
    uguale("etichetta dell'offerta", [etichettaOfferta(base("starter")), etichettaOfferta(base("professional", true))], ["Starter", "Professional con piano di lavoro"]);
    uguale("piano di lavoro aggiunto o tolto: solo se si sa cosa c'era prima", [rilevaCambioPianoLavoro(false, true), rilevaCambioPianoLavoro(true, false), rilevaCambioPianoLavoro(true, true), rilevaCambioPianoLavoro(false, false), rilevaCambioPianoLavoro(null, true), rilevaCambioPianoLavoro(undefined, false)], ["aggiunto", "tolto", null, null, null, null]);
  }

  // ═════ 4. le concessioni ═════
  {
    const oggi = "2026-11-06";
    const c = (extra: Partial<RigaConcessione> = {}): RigaConcessione => ({ id: "c1", tipo: "tutte", gara_id: null, gare_massime: null, scade_il: null, attiva: true, ...extra });
    const id = (righe: RigaConcessione[], gara = GARA, usate: Record<string, string[]> = {}) => scegliConcessione(righe, gara, oggi, usate)?.id ?? null;
    uguale("concessione per tutte le gare, senza limiti: vale", id([c()]), "c1");
    uguale("revocata: non vale", id([c({ attiva: false })]), null);
    uguale("scade oggi: vale ancora (l'ultimo giorno è incluso); scaduta ieri: no", [id([c({ scade_il: "2026-11-06" })]), id([c({ scade_il: "2026-11-05" })])], ["c1", null]);
    uguale("per una sola gara: vale per quella, non per le altre", [id([c({ tipo: "gara", gara_id: GARA })]), id([c({ tipo: "gara", gara_id: GARA2 })])], ["c1", null]);
    uguale("per una gara cancellata (nessun id): non vale per nessuna", id([c({ tipo: "gara", gara_id: null })]), null);
    uguale(
      "con un numero massimo di gare: vale finché c'è posto; una gara che ne fa già parte vale sempre (la seconda versione con la proroga non conta di nuovo)",
      [id([c({ gare_massime: 2 })], GARA3, { c1: [GARA] }), id([c({ gare_massime: 2 })], GARA3, { c1: [GARA, GARA2] }), id([c({ gare_massime: 2 })], GARA2, { c1: [GARA, GARA2] }), id([c({ gare_massime: 1 })], GARA, {})],
      ["c1", null, "c1", "c1"],
    );
    uguale("se ce ne sono due: prima quella per la singola gara, poi quella per tutte", [id([c({ id: "tutte" }), c({ id: "una", tipo: "gara", gara_id: GARA })]), id([c({ id: "tutte" }), c({ id: "una", tipo: "gara", gara_id: GARA2 })])], ["una", "tutte"]);
    uguale(
      "descrizione per la console",
      [descriviConcessione({ tipo: "tutte", gara_titolo: null, gare_massime: null, scade_il: null }), descriviConcessione({ tipo: "tutte", gara_titolo: null, gare_massime: 3, scade_il: "2026-12-31" }), descriviConcessione({ tipo: "tutte", gara_titolo: null, gare_massime: 1, scade_il: null }), descriviConcessione({ tipo: "gara", gara_titolo: "Pulizie", gare_massime: null, scade_il: null })],
      ["Tutte le gare, senza scadenza", "Fino a 3 gare, fino al 31/12/2026", "Fino a 1 gara, senza scadenza", "Solo la gara «Pulizie»"],
    );

    const valida = (extra: Partial<Parameters<typeof validaNuovaConcessione>[0]> = {}) => validaNuovaConcessione({ tipo: "tutte", garaId: "", gareMassime: "", scadeIl: "", motivo: "Cliente pilota", ...extra }, oggi);
    const errore = (extra: Partial<Parameters<typeof validaNuovaConcessione>[0]>) => {
      const e = valida(extra);
      return e.ok ? null : e.errore;
    };
    atteso("nuova concessione valida per tutte le gare (senza limiti, con limite e scadenza) e per una gara", valida().ok && valida({ gareMassime: "5", scadeIl: "2026-12-31" }).ok && valida({ tipo: "gara", garaId: GARA }).ok);
    atteso("nuova concessione: il tipo e il motivo sono obbligatori (il motivo resta nella storia)", errore({ tipo: "altro" }) !== null && errore({ tipo: "" }) !== null && errore({ motivo: "" }) !== null && errore({ motivo: " a " }) !== null && errore({ motivo: "x".repeat(301) }) !== null);
    atteso(
      "nuova concessione: scadenza non passata e ben formata; numero massimo intero da 1 a 1000; per una gara serve l'id e niente numero massimo",
      errore({ scadeIl: "2026-11-05" }) !== null && errore({ scadeIl: "domani" }) !== null && errore({ scadeIl: "2026-13-45" }) !== null && errore({ gareMassime: "0" }) !== null && errore({ gareMassime: "1001" }) !== null && errore({ gareMassime: "2,5" }) !== null && errore({ tipo: "gara", garaId: "" }) !== null && errore({ tipo: "gara", garaId: "non-un-uuid" }) !== null && errore({ tipo: "gara", garaId: GARA, gareMassime: "3" }) !== null,
    );
  }

  // ═════ 5. chi ha il diritto a generare ═════
  {
    const base: ContestoDirittoPiano = { analisiCompleta: true, garaUsabile: true, piani: [], prorogaStato: null, concessioneId: null, abbonamentoCopreGara: false, provaGratuita: false, acquistoPagato: false, aperturaSviluppo: false, adesso: new Date() };
    const esito = (c: Partial<ContestoDirittoPiano>) => {
      const e = valutaDirittoPiano({ ...base, ...c });
      return e.ok ? `${e.fonte}${e.concessioneId ? `:${e.concessioneId}` : ""} v${e.versione}` : e.motivo;
    };
    uguale("senza nessuna fonte il piano non è attivo", esito({}), "non_attivo");
    uguale(
      "ogni fonte da sola abilita la generazione, con la sua etichetta",
      [esito({ concessioneId: "c9" }), esito({ abbonamentoCopreGara: true }), esito({ provaGratuita: true }), esito({ acquistoPagato: true }), esito({ aperturaSviluppo: true })],
      ["concessione:c9 v1", "abbonamento v1", "prova v1", "acquisto v1", "sviluppo v1"],
    );
    uguale(
      "precedenza (prima le gratuite): concessione, abbonamento, prova, acquisto, apertura di sviluppo",
      [esito({ concessioneId: "c9", abbonamentoCopreGara: true, provaGratuita: true, acquistoPagato: true, aperturaSviluppo: true }), esito({ abbonamentoCopreGara: true, provaGratuita: true, acquistoPagato: true, aperturaSviluppo: true }), esito({ provaGratuita: true, acquistoPagato: true, aperturaSviluppo: true }), esito({ acquistoPagato: true, aperturaSviluppo: true })],
      ["concessione:c9 v1", "abbonamento v1", "prova v1", "acquisto v1"],
    );
    const pronto = [{ versione: 1, stato: "pronto" as const, creata_il: new Date(Date.now() - 600_000).toISOString() }];
    uguale(
      "le altre regole valgono per tutte le fonti: analisi non finita, gara bloccata, seconda versione solo con la proroga",
      [esito({ concessioneId: "c9", analisiCompleta: false }), esito({ abbonamentoCopreGara: true, garaUsabile: false }), esito({ abbonamentoCopreGara: true, piani: pronto }), esito({ abbonamentoCopreGara: true, piani: pronto, prorogaStato: "con_nuova_data" })],
      ["analisi_non_completata", "gara_bloccata", "versioni_esaurite", "abbonamento v2"],
    );
  }

  // ═════ 6. le letture del diritto, con il database finto ═════
  {
    const sottoscrizione = (extra: Riga = {}): Riga => ({ user_id: ACCOUNT, status: "attivo", piano_lavoro: true, current_period_end: FUTURO, created_at: "2026-10-01T00:00:00Z", ...extra });
    const consumo = (extra: Riga = {}): Riga => ({ gara_id: GARA, user_id: ACCOUNT, tipo: "piano", ...extra });
    const diritti = (db: Db, opz: { gara?: string; stato?: OmniaAiAccessState; guasti?: Guasti } = {}) => leggiDirittiPianoLavoro({ admin: fintoAdmin(db, opz.guasti), accountId: ACCOUNT, garaId: opz.gara ?? GARA, statoAccesso: opz.stato ?? attivo });
    const copre = async (db: Db, opz?: Parameters<typeof diritti>[1]) => (await diritti(db, opz)).abbonamentoCopreGara;

    uguale(
      "abbonamento con piano di lavoro: copre una gara che ha consumato una gara del PIANO",
      [await copre({ gara_consumi: [consumo()], subscriptions: [sottoscrizione()] }), await copre({ gara_consumi: [consumo({ tipo: "credito" })], subscriptions: [sottoscrizione()] }), await copre({ gara_consumi: [], subscriptions: [sottoscrizione()] }), await copre({ gara_consumi: [consumo({ gara_id: GARA2 })], subscriptions: [sottoscrizione()] })],
      [true, false, false, false],
    );
    uguale(
      "…solo se l'abbonamento è attivo, non scaduto e include il piano di lavoro (di quell'account)",
      [await copre({ gara_consumi: [consumo()], subscriptions: [sottoscrizione({ piano_lavoro: false })] }), await copre({ gara_consumi: [consumo()], subscriptions: [sottoscrizione({ piano_lavoro: null })] }), await copre({ gara_consumi: [consumo()], subscriptions: [sottoscrizione({ status: "annullato" })] }), await copre({ gara_consumi: [consumo()], subscriptions: [sottoscrizione({ current_period_end: PASSATO })] }), await copre({ gara_consumi: [consumo()], subscriptions: [sottoscrizione({ user_id: ALTRO })] }), await copre({ gara_consumi: [consumo()], subscriptions: [] })],
      [false, false, false, false, false, false],
    );
    uguale("senza la migrazione 0101 (colonna assente) l'abbonamento non copre nulla e la pagina non cade", await copre({ gara_consumi: [consumo()], subscriptions: [sottoscrizione()] }, { guasti: { colonneAssenti: { subscriptions: ["piano_lavoro"] } } }), false);
    uguale("l'ultimo abbonamento attivo è quello che conta", await copre({ gara_consumi: [consumo()], subscriptions: [sottoscrizione({ piano_lavoro: true, created_at: "2026-09-01T00:00:00Z" }), sottoscrizione({ piano_lavoro: false, created_at: "2026-10-15T00:00:00Z" })] }), false);

    const conc = (extra: Riga = {}): Riga => ({ id: "c1", user_id: ACCOUNT, tipo: "tutte", gara_id: null, gare_massime: null, scade_il: null, attiva: true, creata_il: "2026-10-20T00:00:00Z", ...extra });
    const piano = (garaId: string, concessione: string, stato = "pronto"): Riga => ({ gara_id: garaId, concessione_id: concessione, stato });
    const idConc = async (db: Db, opz?: Parameters<typeof diritti>[1]) => (await diritti(db, opz)).concessioneId;
    uguale(
      "concessione: per tutte le gare del cliente, per la sua gara, non per quelle di un altro cliente né revocata",
      [await idConc({ omnia_ai_piano_lavoro_concessioni: [conc()] }), await idConc({ omnia_ai_piano_lavoro_concessioni: [conc({ user_id: ALTRO })] }), await idConc({ omnia_ai_piano_lavoro_concessioni: [conc({ attiva: false })] }), await idConc({ omnia_ai_piano_lavoro_concessioni: [conc({ tipo: "gara", gara_id: GARA })] }), await idConc({ omnia_ai_piano_lavoro_concessioni: [conc({ tipo: "gara", gara_id: GARA2 })] })],
      ["c1", null, null, "c1", null],
    );
    uguale(
      "concessione con numero massimo: contano le gare che hanno già un piano generato o in corso grazie a lei (non quelle in errore, non quelle di altre concessioni)",
      [
        await idConc({ omnia_ai_piano_lavoro_concessioni: [conc({ gare_massime: 2 })], gara_piani_lavoro: [piano(GARA2, "c1"), piano(GARA3, "c1", "errore")] }),
        await idConc({ omnia_ai_piano_lavoro_concessioni: [conc({ gare_massime: 2 })], gara_piani_lavoro: [piano(GARA2, "c1"), piano(GARA3, "c1", "in_corso")] }),
        await idConc({ omnia_ai_piano_lavoro_concessioni: [conc({ gare_massime: 2 })], gara_piani_lavoro: [piano(GARA2, "c1"), piano(GARA3, "c1")] }),
        await idConc({ omnia_ai_piano_lavoro_concessioni: [conc({ gare_massime: 2 })], gara_piani_lavoro: [piano(GARA, "c1"), piano(GARA3, "c1")] }),
        await idConc({ omnia_ai_piano_lavoro_concessioni: [conc({ gare_massime: 2 })], gara_piani_lavoro: [piano(GARA2, "altra"), piano(GARA3, "altra")] }),
      ],
      ["c1", null, null, "c1", "c1"],
    );
    uguale("senza la migrazione 0101 (tabella assente) nessuna concessione", await idConc({}, { guasti: { tabelleAssenti: ["omnia_ai_piano_lavoro_concessioni"] } }), null);

    const politica = (valore: string): Db => ({ console_impostazioni: [{ chiave: CHIAVE_POLITICA_PROVA, valore }] });
    const prova = async (db: Db, stato: OmniaAiAccessState) => {
      const d = await diritti(db, { stato });
      return [d.inProva, d.provaGratuita, d.provaBloccata];
    };
    uguale(
      "utenti in prova: «gratis» = incluso, «bloccato» = non disponibile, «acquisto» (e qualunque altro valore o assenza) = lo comprano; un abbonato non è mai «in prova»",
      [await prova(politica("gratis"), inProva), await prova(politica("bloccato"), inProva), await prova(politica("acquisto"), inProva), await prova(politica("boh"), inProva), await prova({}, inProva), await prova(politica("gratis"), attivo), await prova(politica("bloccato"), attivo)],
      [[true, true, false], [true, false, true], [true, false, false], [true, false, false], [true, false, false], [false, false, false], [false, false, false]],
    );
    uguale("interpretazione della regola per la prova", [interpretaPoliticaProva("gratis"), interpretaPoliticaProva("bloccato"), interpretaPoliticaProva("acquisto"), interpretaPoliticaProva(""), interpretaPoliticaProva(null), interpretaPoliticaProva("GRATIS")], ["gratis", "bloccato", "acquisto", "acquisto", "acquisto", "acquisto"]);

    const acquisto = (await diritti({ omnia_ai_piani_lavoro_acquisti: [{ user_id: ACCOUNT, gara_id: GARA, stato: "pagata" }] })).acquistoPagato;
    atteso("l'acquisto pagato della gara resta una fonte (blocco 5)", acquisto === true);
  }

  // ═════ 7. l'allineamento dei prezzi su Stripe ═════
  {
    type Chiamata = { params: Parameters<StripePianoLavoro["prices"]["create"]>[0]; chiave: string };
    const prezzo = (chiave: string, importo: number, extra: Partial<PrezzoStripePianoLavoro> = {}): PrezzoStripePianoLavoro => ({ lookup_key: chiave, unit_amount: importo, currency: "eur", product: "prod_abbonamento", recurring: { interval: "month", interval_count: 1 }, tax_behavior: "inclusive", ...extra });
    const stripeFinto = (attivi: PrezzoStripePianoLavoro[], fallisciAlla?: number) => {
      const chiamate: Chiamata[] = [];
      const stripe: StripePianoLavoro = {
        prices: {
          list: async () => ({ data: attivi }),
          create: async (params, o) => {
            if (fallisciAlla !== undefined && chiamate.length === fallisciAlla) throw new Error("Stripe non risponde");
            chiamate.push({ params, chiave: o.idempotencyKey });
            return {};
          },
        },
      };
      return { stripe, chiamate };
    };
    const offerte = [
      { piano: "starter" as const, nome: "Starter", importoCentesimi: 84900 },
      { piano: "professional" as const, nome: "Professional", importoCentesimi: 184000 },
      { piano: "enterprise" as const, nome: "Enterprise", importoCentesimi: 380000 },
    ];
    const piani = [prezzo("omnia_ai_starter", 69900), prezzo("omnia_ai_professional", 149000), prezzo("omnia_ai_enterprise", 290000)];

    const nuovi = stripeFinto(piani);
    const creati = await allineaPrezziPianoLavoro(nuovi.stripe, offerte);
    atteso(
      "primo allineamento: crea i tre prezzi con la chiave «_pdl», sullo stesso prodotto del piano, mensili, IVA inclusa, con la chiave di idempotenza (nessun doppione), senza spostare nessuna chiave",
      creati.creati.join() === "Starter,Professional,Enterprise" && creati.aggiornati.length === 0 && !creati.errore && nuovi.chiamate.length === 3 && nuovi.chiamate.every((c) => c.params.product === "prod_abbonamento" && c.params.currency === "eur" && c.params.recurring.interval === "month" && c.params.tax_behavior === "inclusive" && !("transfer_lookup_key" in c.params)) && nuovi.chiamate.map((c) => c.params.lookup_key).join() === "omnia_ai_starter_pdl,omnia_ai_professional_pdl,omnia_ai_enterprise_pdl" && nuovi.chiamate.map((c) => c.params.unit_amount).join() === "84900,184000,380000" && nuovi.chiamate[0].chiave === "omnia-ai-pdl-starter-84900",
      JSON.stringify(nuovi.chiamate),
    );

    const giaAllineati = stripeFinto([...piani, prezzo("omnia_ai_starter_pdl", 84900), prezzo("omnia_ai_professional_pdl", 184000), prezzo("omnia_ai_enterprise_pdl", 380000)]);
    const invariati = await allineaPrezziPianoLavoro(giaAllineati.stripe, offerte);
    atteso("già allineati: non si crea nulla", invariati.invariati.length === 3 && invariati.creati.length === 0 && invariati.aggiornati.length === 0 && giaAllineati.chiamate.length === 0);

    const dacambiare = stripeFinto([...piani, prezzo("omnia_ai_starter_pdl", 84900), prezzo("omnia_ai_professional_pdl", 175000, { product: { id: "prod_pdl" } })]);
    const misto = await allineaPrezziPianoLavoro(dacambiare.stripe, offerte);
    atteso(
      "importo cambiato: si crea un prezzo NUOVO e la chiave passa a lui (il vecchio non si tocca, serve agli abbonamenti già attivi); i mancanti si creano; gli uguali restano",
      misto.invariati.join() === "Starter" && misto.aggiornati.join() === "Professional" && misto.creati.join() === "Enterprise" && dacambiare.chiamate.length === 2 && dacambiare.chiamate[0].params.transfer_lookup_key === true && dacambiare.chiamate[0].params.product === "prod_pdl" && dacambiare.chiamate[0].params.unit_amount === 184000 && !("transfer_lookup_key" in dacambiare.chiamate[1].params),
      JSON.stringify(misto),
    );

    const senzaPiano = stripeFinto([prezzo("omnia_ai_starter", 69900)]);
    const mancaBase = await allineaPrezziPianoLavoro(senzaPiano.stripe, offerte);
    atteso("se manca anche il prezzo del piano su Stripe si ferma con un messaggio che dice cosa fare, senza toccare gli altri", !!mancaBase.errore && /Professional/.test(mancaBase.errore) && /Piani e prezzi/.test(mancaBase.errore) && senzaPiano.chiamate.length === 1 && mancaBase.creati.join() === "Starter");

    const cade = stripeFinto(piani, 1);
    const spegni = console.error;
    console.error = () => {};
    const interrotto = await allineaPrezziPianoLavoro(cade.stripe, offerte);
    console.error = spegni;
    atteso("se Stripe rifiuta a metà lo dice, con ciò che è già stato fatto, e non va avanti", !!interrotto.errore && /dopo Starter/.test(interrotto.errore) && interrotto.creati.join() === "Starter" && cade.chiamate.length === 1);
  }

  // ═════ 8. le email ═════
  {
    const cliente = { email: "info@pulizie.it", nome: "Mario", cognome: "Rossi", ragioneSociale: "Pulizie <Srl>" } as unknown as Parameters<typeof emailUfficioPianoLavoroAbbonamento>[0]["cliente"];
    const aggiunto = emailUfficioPianoLavoroAbbonamento({ prova: false, cliente, piano: "starter", cambio: "aggiunto", dal: null, stripeSubscriptionId: "sub_1" });
    const tolto = emailUfficioPianoLavoroAbbonamento({ prova: false, cliente, piano: "professional", cambio: "tolto", dal: new Date("2026-12-01T00:00:00Z"), stripeSubscriptionId: "sub_1" });
    atteso("email all'ufficio: piano di lavoro aggiunto subito (con il testo del cliente protetto)", /aggiunto all'abbonamento/.test(aggiunto.oggetto) && /ha aggiunto il piano di lavoro al suo abbonamento/.test(aggiunto.html) && /Vale subito/.test(aggiunto.html) && /stripe\.com/.test(aggiunto.html) && !/Pulizie <Srl>/.test(aggiunto.html));
    atteso("email all'ufficio: piano di lavoro tolto dal prossimo rinnovo", /tolto dall'abbonamento/.test(tolto.oggetto) && /ha tolto il piano di lavoro dal suo abbonamento/.test(tolto.html) && /prossimo rinnovo/.test(tolto.html));
    const nuovo = (pianoLavoro: boolean) => emailUfficioNuovoCliente({ prova: false, primoAbbonamento: true, cliente, piano: "starter", pianoLavoro, importoCentesimi: 84900, quando: new Date(), accountNuovo: true, creatoDaConsole: false, pilot: false, stripeSubscriptionId: "sub_1" }).html;
    atteso("email di un nuovo cliente: «Piano di lavoro incluso» solo se c'è", /Piano di lavoro incluso/.test(nuovo(true)) && !/Piano di lavoro incluso/.test(nuovo(false)));
  }

  // ═════ 9. regole scritte nel codice ═════
  {
    const migrazione = leggi("supabase/migrations/0101_piano_lavoro_abbonamento.sql");
    atteso("migrazione 0101: l'abbonamento ricorda il piano di lavoro (solo vero/falso, falso per chi c'era già), quello programmato e le avvertenze accettate; idempotente", /add column if not exists piano_lavoro boolean not null default false/.test(migrazione) && /add column if not exists piano_lavoro_programmato boolean/.test(migrazione) && /piano_lavoro_condizioni_versione integer/.test(migrazione) && /piano_lavoro_condizioni_hash text/.test(migrazione) && /notify pgrst/.test(migrazione));
    atteso(
      "migrazione 0101: concessioni con tutte le regole di accesso attive, SOLO per il server (nessun permesso ai ruoli utente), mai cancellate; forma vincolata (una gara oppure tutte, mai un numero massimo su una gara)",
      /create table if not exists public\.omnia_ai_piano_lavoro_concessioni/.test(migrazione) && /enable row level security/.test(migrazione) && /grant select, insert, update on public\.omnia_ai_piano_lavoro_concessioni to service_role/.test(migrazione) && !/grant[^;]*delete[^;]*concessioni/.test(migrazione) && !/(authenticated|anon)[^;]*concessioni|concessioni[^;]*(authenticated|anon)/.test(migrazione.replace(/--[^\n]*/g, "")) && /check \(tipo in \('tutte', 'gara'\)\)/.test(migrazione) && /tipo = 'gara' and gare_massime is null/.test(migrazione) && /tipo = 'tutte' and gara_id is null/.test(migrazione) && /user_id uuid not null references public\.users \(id\) on delete cascade/.test(migrazione),
    );
    atteso("migrazione 0101: la riga del piano ricorda la concessione che l'ha reso possibile, e il cliente NON la legge (la sua lista di colonne non cambia)", /add column if not exists concessione_id uuid references public\.omnia_ai_piano_lavoro_concessioni/.test(migrazione) && !/grant[^;]*concessione_id/.test(migrazione));

    const calcoli = leggi("src/lib/piano-lavoro-offerta-calcoli.ts");
    atteso("le regole pure dell'offerta non importano nulla del server (nessun database, nessuna chiave)", !/supabase|createAdminClient|anthropic|stripe"/i.test(calcoli.replace(/\/\/.*$/gm, "")));

    const checkout = leggi("src/app/actions/omnia-ai-subscription.ts");
    // (09/11/2026: l'opzione nell'abbonamento NON si offre più: il punto unico è venditaAbbonamentoPianoLavoroAttiva, spento da ABBONAMENTO_PIANO_LAVORO_OFFERTO)
    atteso("checkout: l'opzione si riverifica QUI (oggi mai offerta; se un domani si riaccende: vendita accesa, avvertenze accettate) e non per chi non la chiede", /const pianoLavoro = formData\.get\("pianoLavoro"\) === "on"/.test(checkout) && /if \(pianoLavoro\) \{\s*if \(!\(await venditaAbbonamentoPianoLavoroAttiva\(admin\)\)\) return \{ error: MESSAGGIO_ABBONAMENTO_PIANO_LAVORO_NON_OFFERTO \}/.test(checkout) && !/venditaPianoLavoroAttiva/.test(checkout) && /formData\.get\("acceptPianoLavoro"\) !== "on"/.test(checkout));
    atteso(
      "checkout: il prezzo Stripe è quello dell'offerta e deve valere listino + supplemento letto dal server (mai dal modulo); se non coincide si ferma",
      /getStripePrezzoAttivoOfferta\(stripe, planSlug as PianoSlug, pianoLavoro\)/.test(checkout) && /prezzoConPianoLavoro\(voce\.prezzoListinoCentesimi, \(await leggiSurplusPianoLavoro\(admin\)\)\[planSlug as PianoSlug\]\)/.test(checkout) && /prezzoStripe\.unit_amount !== importoAtteso/.test(checkout) && !/formData\.get\("(surplus|prezzo)/.test(checkout),
    );
    atteso("checkout: i metadata dicono che il piano di lavoro è incluso, con versione e impronta delle avvertenze accettate", /metadata\.pianoLavoro = "1"/.test(checkout) && /metadata\.pianoLavoroCondizioniVersione = String\(VERSIONE_CONDIZIONI_PIANO_LAVORO\)/.test(checkout) && /metadata\.pianoLavoroCondizioniHash = createHash\("sha256"\)/.test(checkout));

    const webhook = leggi("src/app/api/webhooks/stripe/route.ts");
    atteso("webhook: alla creazione dell'abbonamento si scrive il piano di lavoro (con avvertenze), con due ripieghi: senza le colonne nuove si crea comunque l'abbonamento (e lo si dice nel log), come prima per la modalità", /const pianoLavoroIncluso = metadata\?\.pianoLavoro === "1"/.test(webhook) && /\.\.\.colonnePianoLavoro/.test(webhook) && /migrazione 0101 non eseguita/.test(webhook) && /pianoLavoro: metadata\?\.pianoLavoro === "1"/.test(webhook));
    atteso(
      "webhook: ad ogni aggiornamento il piano di lavoro lo dice il prezzo Stripe («_pdl»); la lettura precedente è a parte (senza la migrazione il resto funziona); avvertenze registrate quando si aggiunge",
      /const offertaAggiornata = item \? offertaDaLookupKey\(item\.price\.lookup_key\) : null/.test(webhook) && /nuoveColonne\.piano_lavoro = offertaAggiornata\.pianoLavoro/.test(webhook) && /from\("subscriptions"\)\.select\("piano_lavoro"\)/.test(webhook) && /nuoveColonne\.piano_lavoro_condizioni_versione/.test(webhook) && !/pianoDaLookupKey\(/.test(webhook.replace(/\/\/.*$/gm, "")),
    );
    atteso("webhook: il cambio programmato ricorda se la nuova offerta include il piano di lavoro (a parte, senza far cadere l'aggiornamento di prima) e avvisa l'ufficio una volta", /pianoLavoroProgrammato = offertaSuccessiva\.pianoLavoro/.test(webhook) && /update\(\{ piano_lavoro_programmato: pianoProgrammato \? pianoLavoroProgrammato : null \}\)/.test(webhook) && /programmatoPrima !== pianoLavoroProgrammato/.test(webhook) && (webhook.match(/notificaCambioPianoLavoroAbbonamento\(/g) ?? []).length === 2);

    const cambio = leggi("src/app/actions/omnia-ai-plan-change.ts");
    atteso("cambio piano: il piano di lavoro si AGGIUNGE solo se è in vendita e solo subito (con le avvertenze accettate), si mantiene o si toglie sempre; Stripe vede il prezzo dell'offerta", /interpretaDestinazione\(destinazioneRaw, offertaAttuale\)/.test(cambio) && /tipoCambioOfferta\(offertaAttuale, destinazione\)/.test(cambio) && /destinazione\.pianoLavoro && !offertaAttuale\.pianoLavoro/.test(cambio) && /venditaAbbonamentoPianoLavoroAttiva\(\)\)\) return \{ error: MESSAGGIO_ABBONAMENTO_PIANO_LAVORO_NON_OFFERTO \}/.test(cambio) && !/venditaPianoLavoroAttiva/.test(cambio) && /tipo !== "upgrade"/.test(cambio) && /accettaAvvertenze !== true/.test(cambio) && (cambio.match(/getStripePriceIdOfferta\(stripe, destinazione\.piano, destinazione\.pianoLavoro\)/g) ?? []).length === 2);
    atteso("cambio piano: le azioni partono dalla guardia del titolare; senza la migrazione 0101 l'abbonamento si legge comunque", (cambio.match(/await richiediTitolareAzione\(\)/g) ?? []).length === 3 && /schemaAssente\(error\)\) \(\{ data, error \} = await cerca\(base\)\)/.test(cambio));

    const azioniConsole = leggi("src/app/site-console/azioni/piano-lavoro.ts");
    const funzioni = [...azioniConsole.matchAll(/export async function (\w+)\(([^)]*)\)[^{]*\{\n([^\n]*)\n/g)];
    atteso("console: ogni azione parte da richiediAdminAzione() (sono 7)", funzioni.length === 7 && funzioni.every((f) => /await richiediAdminAzione\(\)/.test(f[3])), funzioni.map((f) => `${f[1]}:${f[3].trim().slice(0, 40)}`).join(" | "));
    atteso("console: le concessioni si revocano e non si cancellano; il cliente si rilegge dall'email (mai da un id del browser), deve essere un titolare e la gara deve essere sua", !/\.delete\(\)/.test(azioniConsole) && /attiva: false, revocata_il/.test(azioniConsole) && /cercaClientePerConcessione\(String\(formData\.get\("email"\)/.test(azioniConsole) && /ricerca\.stato === "ufficio_gare"/.test(azioniConsole) && /cliente\.gare\.find\(\(g\) => g\.id === v\.garaId\)/.test(azioniConsole) && /creata_da_email: sessione\.email/.test(azioniConsole));
    atteso("console: la vendita si accende solo con i prezzi allineati e la migrazione eseguita, si spegne sempre; i supplementi e il prezzo hanno limiti", /nonAllineati = dati\.piani\.filter\(\(p\) => p\.stripe\.stato !== "allineato"\)/.test(azioniConsole) && /concessioniDisponibili/.test(azioniConsole) && /LIMITI_SURPLUS\.minimoCentesimi/.test(azioniConsole) && /PREZZO_PIANO_LAVORO\.minimoCentesimi/.test(azioniConsole) && /\(POLITICHE_PROVA as string\[\]\)\.includes\(politica\)/.test(azioniConsole));
    atteso("console: la pagina è protetta dal controllo admin e compare nel menu", /await richiediAdminPagina\(\)/.test(leggi("src/app/site-console/(app)/piano-lavoro/page.tsx")) && /href: "\/piano-lavoro"/.test(leggi("src/app/site-console/_componenti/navigazione.ts")));
    const letturaConsole = leggi("src/lib/console/piano-lavoro.ts");
    atteso("console: la lettura tollera la migrazione 0101 mancante e il ruolo del cliente si verifica (un Ufficio Gare non riceve concessioni)", /schemaAssente\(concessioniQ\.error\)/.test(letturaConsole) && /from\("omnia_ai_membri"\)/.test(letturaConsole) && /stato: "ufficio_gare"/.test(letturaConsole));

    const paginaAbbonati = leggi("src/app/site-omnia-ai/abbonati/[piano]/page.tsx");
    atteso("pagine di acquisto: l'opzione compare solo se l'abbonamento con il piano di lavoro è offerto, cioè oggi MAI (la pagina di un piano e il modulo dell'area riservata; la pagina pubblica dei piani non nomina più nessun supplemento)", /\(await venditaAbbonamentoPianoLavoroAttiva\(admin\)\) \? \(await getOffertePianoLavoro\(admin\)\)\[piano\] : null/.test(paginaAbbonati) && !/venditaPianoLavoroAttiva/.test(paginaAbbonati) && /await surplusSeInVendita\(\)/.test(leggi("src/app/site-omnia-ai/dashboard/omnia-ai/layout.tsx")) && /await surplusSeInVendita\(\)/.test(leggi("src/app/site-omnia-ai/dashboard/omnia-ai/abbonamento/page.tsx")));
    const opzione = leggi("src/components/omnia-ai/opzione-piano-lavoro.tsx");
    atteso("modulo: con la spunta si mostra il prezzo mensile totale, le avvertenze e l'accettazione obbligatoria, e il pulsante resta spento finché non si accetta", /name="pianoLavoro"/.test(opzione) && /name="acceptPianoLavoro"[\s\S]{0,200}required/.test(opzione) && /totaleCentesimi/.test(opzione) && /canSubmit = acceptCondizioniPrivacy && acceptClausoleSpecifiche && \(!pianoLavoro \|\| acceptPianoLavoro\)/.test(leggi("src/app/site-omnia-ai/abbonati/[piano]/abbonati-piano-form.tsx")) && /canSubmit = acceptCondizioniPrivacy && acceptClausoleSpecifiche && \(!pianoLavoro \|\| acceptPianoLavoro\)/.test(leggi("src/app/site-omnia-ai/dashboard/omnia-ai/activate-subscription-form.tsx")));
    const diritti = leggi("src/lib/piano-lavoro-diritti.ts");
    atteso("diritti: l'abbonamento copre solo le gare che hanno consumato una gara del piano; la pagina e le azioni usano la stessa lettura", /consumo\?\.tipo !== "piano"/.test(diritti) && /\.eq\("status", "attivo"\)/.test(diritti) && /abbonamento\.piano_lavoro !== true/.test(diritti) && /leggiDirittiPianoLavoro/.test(leggi("src/app/actions/gara-piano-lavoro.ts")) && /leggiDirittiPianoLavoro/.test(leggi("src/app/site-omnia-ai/dashboard/omnia-ai/gare/[id]/page.tsx")));
    atteso("questi controlli sono nella batteria prima della build", /verifica-piano-lavoro-abbonamento-omnia-ai\.ts/.test(leggi("package.json")));
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
