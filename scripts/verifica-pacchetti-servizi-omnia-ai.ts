// Autotest dei PACCHETTI PREPAGATI dei servizi aggiuntivi (richiesta dell'utente, 10/11/2026): 5 piani di lavoro a 300 €, che non scadono ma
// si esauriscono man mano che si usano, e si perdono se il cliente disdice (come i crediti); il titolare compra, l'Ufficio Gare vede i pacchetti
// e con «Acquista» avvisa il titolare; nella home compaiono i servizi dei settori che l'azienda tratta.
//   1. regole pure: elenco dei pacchetti (console), cosa si offre a chi guarda, quali servizi compaiono, saldo e diritto, condizioni;
//   2. il diritto alla generazione: dove sta il pacchetto nell'ordine delle fonti, una sola unità per gara;
//   3. il database (finto): saldo, consumo, riaccredito, estinzione, e il webhook che accredita le unità una volta sola;
//   4. le scritture nel codice: azioni, webhook, cessazione, generazione, pagine, menu, email;
//   5. la migrazione 0104 letta come testo (le funzioni SQL vere sono provate a parte su un Postgres in memoria);
//   6. le schede disegnate (titolare, Ufficio Gare).
// Nessuna rete, nessun modello. Gratuito: gira nel livello 1, quindi in prebuild.
import fs from "fs";
import path from "path";
import { createHash } from "crypto";
import { createRequire } from "module";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  APPROVAZIONE_LEGALE_PACCHETTI,
  CATALOGO_PREDEFINITO,
  CLAUSOLE_PACCHETTI,
  CLAUSOLE_SPECIFICHE_PACCHETTI,
  ETICHETTA_MOVIMENTO,
  LIMITI_CATALOGO,
  LIMITI_OFFERTA,
  SERVIZI,
  SERVIZI_PACCHETTO,
  TESTI_PACCHETTI,
  VERSIONE_CONDIZIONI_PACCHETTI,
  convenienzaPacchetto,
  costruisciSchede,
  daRigaOfferta,
  dataItaliana,
  dirittoDaPacchetto,
  eServizioPacchetto,
  euroInCentesimi,
  formattaEuro,
  interpretaCatalogoPacchetti,
  interpretaEsitoConsumo,
  offertaAcquistabile,
  proponiPacchettoPiuConveniente,
  serializzaCatalogoPacchetti,
  serviziPerLaHome,
  testoCanonicoCondizioniPacchetti,
  testoUnita,
  trovaPacchetto,
  validaCatalogoDaModulo,
  validaNuovaOfferta,
  valutaOffertaPacchetti,
  type SchedaServizio,
} from "../src/lib/pacchetti-servizi-calcoli";
import { aperturaSviluppoAttiva, valutaDirittoPiano, type ContestoDirittoPiano } from "../src/lib/piano-lavoro-gara-calcoli";
import type { Settore } from "../src/lib/gara-settore";
import {
  chiudiOffertaAcquistata,
  consumaUnita,
  contaAcquistiPacchetti,
  creaOffertaDedicata,
  leggiConcessioniPerScheda,
  leggiOfferteAttive,
  leggiOfferteConsole,
  leggiOffertaPerAcquisto,
  revocaOffertaDedicata,
  risolviPacchetto,
  estinguiPacchetti,
  leggiMovimentiPacchetti,
  pacchettiDisponibili,
  leggiSaldiPacchetti,
  leggiSettoriGare,
  leggiStatoPacchettoGara,
  registraPagamentoPacchetto,
  riaccreditaUnita,
  rettificaPacchetti,
  type SessionePagamentoPacchetto,
} from "../src/lib/pacchetti-servizi";
import { emailClientePacchettoAcquistato, emailUfficioPacchettoAcquistato } from "../src/lib/omnia-ai-email-pacchetti-calcoli";
import { emailAvvisoAcquistoPacchetto } from "../src/lib/omnia-ai-email-ufficio-gare-calcoli";
import { chiaveAvviso } from "../src/lib/omnia-ai-account-calcoli";
import { costruisciPagamenti, percorsoFatturaPagamento, CHIAVE_PAGAMENTO, TABELLA_PER_FONTE, type PacchettoCliente } from "../src/lib/omnia-ai-pagamenti";
import ServiziPerLeGare from "../src/components/omnia-ai/servizi-per-le-gare";

const richiedi = createRequire(path.join(__dirname, "..", "package.json"));
const { createElement } = richiedi("react") as typeof import("react");
const { renderToStaticMarkup } = richiedi("react-dom/server") as typeof import("react-dom/server");

const fallimenti: string[] = [];
function atteso(nome: string, ok: boolean, dettaglio = "") {
  console.log(`${ok ? "ok    " : "FALLITO"} ${nome}${ok ? "" : ` — ${dettaglio}`}`);
  if (!ok) fallimenti.push(nome);
}
function uguale(nome: string, ottenuto: unknown, previsto: unknown) {
  atteso(nome, JSON.stringify(ottenuto) === JSON.stringify(previsto), `ottenuto ${JSON.stringify(ottenuto)}, previsto ${JSON.stringify(previsto)}`);
}
const radice = path.join(__dirname, "..");
const leggi = (relativo: string) => fs.readFileSync(path.join(radice, relativo), "utf-8").replace(/\r\n/g, "\n");
const senzaCommenti = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const testoDi = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const corpoFunzione = (sorgente: string, nome: string) => {
  const inizio = sorgente.indexOf(`export async function ${nome}(`);
  if (inizio === -1) return "";
  const resto = sorgente.slice(inizio + 10);
  const prossima = resto.search(/\nexport (async )?function /);
  return prossima === -1 ? sorgente.slice(inizio) : sorgente.slice(inizio, inizio + 10 + prossima);
};

// ───── database finto (con le funzioni SQL imitate) ─────
type Riga = Record<string, unknown>;
type Db = Record<string, Riga[]>;
type Esito = { data: unknown; error: { code?: string; message: string } | null };

class Interrogazione implements PromiseLike<Esito> {
  private filtri: ((r: Riga) => boolean)[] = [];
  private operazione: "select" | "update" | "insert" = "select";
  private dati: Riga | null = null;
  private massimo = Infinity;
  private singolo = false;
  constructor(
    private nome: string,
    private db: Db,
    private assenti: string[],
  ) {}
  select() {
    return this;
  }
  update(d: Riga) {
    this.operazione = "update";
    this.dati = d;
    return this;
  }
  insert(d: Riga) {
    this.operazione = "insert";
    this.dati = d;
    return this;
  }
  in(c: string, valori: unknown[]) {
    this.filtri.push((r) => valori.includes(r[c]));
    return this;
  }
  single() {
    this.singolo = true;
    return this;
  }
  eq(c: string, v: unknown) {
    this.filtri.push((r) => r[c] === v);
    return this;
  }
  order(colonna: string, opzioni?: { ascending?: boolean }) {
    const ordina = (righe: Riga[]) => [...righe].sort((a, b) => String(a[colonna]).localeCompare(String(b[colonna])) * (opzioni?.ascending === false ? -1 : 1));
    this.ordinamento = ordina;
    return this;
  }
  private ordinamento: ((r: Riga[]) => Riga[]) | null = null;
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
  private esegui(): Esito {
    if (this.assenti.includes(this.nome)) return { data: null, error: { code: "42P01", message: `relation "${this.nome}" does not exist` } };
    const tabella = (this.db[this.nome] ??= []);
    if (this.operazione === "insert") {
      const riga: Riga = { id: `inserita-${tabella.length + 1}`, ...this.dati };
      tabella.push(riga);
      return { data: this.singolo ? riga : [riga], error: null };
    }
    let trovate = tabella.filter((r) => this.filtri.every((f) => f(r)));
    if (this.ordinamento) trovate = this.ordinamento(trovate);
    trovate = trovate.slice(0, this.massimo);
    if (this.operazione === "update") {
      for (const r of trovate) Object.assign(r, this.dati);
    }
    return { data: this.singolo ? (trovate[0] ?? null) : trovate, error: null };
  }
  then<T1 = Esito, T2 = never>(ok?: ((v: Esito) => T1 | PromiseLike<T1>) | null, ko?: ((r: unknown) => T2 | PromiseLike<T2>) | null): PromiseLike<T1 | T2> {
    return Promise.resolve(this.esegui()).then(ok, ko);
  }
}

type Rpc = Record<string, (args: Record<string, unknown>, db: Db) => Esito>;
function fintoAdmin(db: Db, assenti: string[] = [], rpc: Rpc = {}): SupabaseClient & { chiamate: { nome: string; args: Record<string, unknown> }[] } {
  const chiamate: { nome: string; args: Record<string, unknown> }[] = [];
  return {
    from: (nome: string) => new Interrogazione(nome, db, assenti),
    rpc: async (nome: string, args: Record<string, unknown>) => {
      chiamate.push({ nome, args });
      const f = rpc[nome];
      return f ? f(args, db) : { data: null, error: { code: "PGRST202", message: `function ${nome} not found` } };
    },
    chiamate,
  } as unknown as SupabaseClient & { chiamate: { nome: string; args: Record<string, unknown> }[] };
}

const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";
const GARA = "aaaaaaaa-aaaa-4aaa-8aaa-000000000001";
const GARA2 = "aaaaaaaa-aaaa-4aaa-8aaa-000000000002";

// le cinque funzioni SQL, imitate nella loro regola (la prova vera sul Postgres è a parte)
function funzioniSql(): Rpc {
  return {
    omnia_ai_pacchetto_accredita: (a, db) => {
      const r = (db.omnia_ai_pacchetti_acquisti ?? []).find((x) => x.id === a.p_acquisto);
      if (!r) return { data: "non_trovato", error: null };
      if (r.stato !== "pagata") return { data: "non_pagata", error: null };
      if (r.accreditata_il) return { data: "gia_accreditato", error: null };
      if (!r.user_id) return { data: "senza_utente", error: null };
      const s = ((db.omnia_ai_pacchetti_saldi ??= []).find((x) => x.user_id === r.user_id && x.servizio === r.servizio) ?? (() => { const n = { user_id: r.user_id, servizio: r.servizio, saldo: 0 }; db.omnia_ai_pacchetti_saldi.push(n); return n; })()) as { saldo: number };
      s.saldo += r.quantita as number;
      r.accreditata_il = "2026-11-10T10:00:00Z";
      return { data: "accreditato", error: null };
    },
    omnia_ai_pacchetto_consuma: (a, db) => {
      const consumi = (db.omnia_ai_pacchetti_consumi ??= []);
      if (consumi.some((c) => c.gara_id === a.p_gara && c.servizio === a.p_servizio)) return { data: "gia_consumata", error: null };
      const s = (db.omnia_ai_pacchetti_saldi ?? []).find((x) => x.user_id === a.p_user && x.servizio === a.p_servizio) as { saldo: number } | undefined;
      if (!s || s.saldo < 1) return { data: "saldo_insufficiente", error: null };
      consumi.push({ user_id: a.p_user, servizio: a.p_servizio, gara_id: a.p_gara });
      s.saldo -= 1;
      return { data: "consumata", error: null };
    },
    omnia_ai_pacchetto_riaccredita: (a, db) => {
      const consumi = (db.omnia_ai_pacchetti_consumi ??= []);
      const i = consumi.findIndex((c) => c.gara_id === a.p_gara && c.servizio === a.p_servizio && c.user_id === a.p_user);
      if (i === -1) return { data: "nessun_consumo", error: null };
      consumi.splice(i, 1);
      ((db.omnia_ai_pacchetti_saldi ?? []).find((x) => x.user_id === a.p_user && x.servizio === a.p_servizio) as { saldo: number }).saldo += 1;
      return { data: "riaccreditata", error: null };
    },
    omnia_ai_pacchetto_estingui: (a, db) => {
      let totale = 0;
      for (const s of (db.omnia_ai_pacchetti_saldi ?? []) as { user_id: string; saldo: number }[]) {
        if (s.user_id === a.p_user && s.saldo > 0) {
          totale += s.saldo;
          s.saldo = 0;
        }
      }
      return { data: totale, error: null };
    },
    omnia_ai_pacchetto_rettifica: (a, db) => {
      const s = (db.omnia_ai_pacchetti_saldi ?? []).find((x) => x.user_id === a.p_user && x.servizio === a.p_servizio) as { saldo: number } | undefined;
      const nuovo = (s?.saldo ?? 0) + (a.p_delta as number);
      if (nuovo < 0) return { data: null, error: { message: "saldo insufficiente" } };
      if (s) s.saldo = nuovo;
      else (db.omnia_ai_pacchetti_saldi ??= []).push({ user_id: a.p_user, servizio: a.p_servizio, saldo: nuovo });
      return { data: nuovo, error: null };
    },
  };
}

async function spegniErrori<T>(f: () => Promise<T>): Promise<T> {
  const vecchio = console.error;
  console.error = () => undefined;
  try {
    return await f();
  } finally {
    console.error = vecchio;
  }
}

async function main() {
  // ═════ 1. regole pure ═════
  console.log("--- I servizi e l'elenco dei pacchetti ---");
  uguale("i servizi a pacchetto sono il piano di lavoro e OMNIA FOOD MENU", [...SERVIZI_PACCHETTO], ["piano_lavoro", "food_menu"]);
  uguale("solo il piano di lavoro si compra oggi: OMNIA FOOD MENU «sta arrivando»", [SERVIZI.piano_lavoro.disponibile, SERVIZI.food_menu.disponibile], [true, false]);
  uguale("eServizioPacchetto: solo i due servizi", [eServizioPacchetto("piano_lavoro"), eServizioPacchetto("food_menu"), eServizioPacchetto("altro"), eServizioPacchetto(5), eServizioPacchetto(null)], [true, true, false, false, false]);
  uguale("testoUnita: singolare e plurale", [testoUnita(1, "piano_lavoro"), testoUnita(5, "piano_lavoro")], ["1 piano di lavoro", "5 piani di lavoro"]);
  uguale("l'elenco di partenza è l'esempio dell'utente: 5 piani di lavoro a 300 € (IVA inclusa)", CATALOGO_PREDEFINITO.piano_lavoro, [{ quantita: 5, prezzoCentesimi: 30000 }]);
  uguale("OMNIA FOOD MENU non ha pacchetti in vendita", CATALOGO_PREDEFINITO.food_menu, []);
  uguale("mai salvato (assente, null, vuoto): l'elenco di partenza", [null, undefined, "", "  "].map((v) => interpretaCatalogoPacchetti("piano_lavoro", v)), Array(4).fill(CATALOGO_PREDEFINITO.piano_lavoro));
  uguale("illeggibile (non JSON, non un elenco): l'elenco di partenza", ["{", "abc", '{"quantita":5}', "5", "true"].map((v) => interpretaCatalogoPacchetti("piano_lavoro", v)), Array(5).fill(CATALOGO_PREDEFINITO.piano_lavoro));
  uguale("elenco vuoto salvato dalla console = nessun pacchetto in vendita (scelta della console)", interpretaCatalogoPacchetti("piano_lavoro", "[]"), []);
  uguale(
    "elenco salvato: ordinato per quantità, doppioni tolti (vince il primo), voci non valide scartate",
    interpretaCatalogoPacchetti("piano_lavoro", JSON.stringify([{ quantita: 20, prezzoCentesimi: 90000 }, { quantita: 5, prezzoCentesimi: 30000 }, { quantita: 5, prezzoCentesimi: 99999 }, { quantita: 1, prezzoCentesimi: 7500 }, { quantita: 10, prezzoCentesimi: 0 }, { quantita: 2.5, prezzoCentesimi: 100 }, { quantita: "5", prezzoCentesimi: 100 }, null, "x", { quantita: 3 }])),
    [{ quantita: 5, prezzoCentesimi: 30000 }, { quantita: 20, prezzoCentesimi: 90000 }],
  );
  atteso("al massimo sei pacchetti", interpretaCatalogoPacchetti("piano_lavoro", JSON.stringify(Array.from({ length: 9 }, (_, i) => ({ quantita: i + 2, prezzoCentesimi: 1000 })))).length === LIMITI_CATALOGO.pacchettiMassimi);
  uguale("serializza e rilegge dà lo stesso elenco", interpretaCatalogoPacchetti("piano_lavoro", serializzaCatalogoPacchetti([{ quantita: 10, prezzoCentesimi: 55000 }, { quantita: 5, prezzoCentesimi: 30000 }])), [{ quantita: 5, prezzoCentesimi: 30000 }, { quantita: 10, prezzoCentesimi: 55000 }]);

  console.log("\n--- Il modulo della console: validazione ---");
  uguale("euroInCentesimi: «300», «299,90», «299.9», «0,5»", ["300", "299,90", "299.9", "0,5"].map(euroInCentesimi), [30000, 29990, 29990, 50]);
  uguale("euroInCentesimi: segni, migliaia, lettere, tre decimali, vuoto → null", ["-5", "+5", "1.000,00", "abc", "5,123", "", "  ", "1e3", "5 €"].map(euroInCentesimi), Array(9).fill(null));
  uguale("modulo valido: righe vuote ignorate, ordinato", validaCatalogoDaModulo([{ quantita: "10", prezzoEuro: "550" }, { quantita: "", prezzoEuro: "" }, { quantita: "5", prezzoEuro: "300,00" }]), { ok: true, catalogo: [{ quantita: 5, prezzoCentesimi: 30000 }, { quantita: 10, prezzoCentesimi: 55000 }] });
  uguale("modulo tutto vuoto = nessun pacchetto in vendita", validaCatalogoDaModulo([{ quantita: "", prezzoEuro: "" }]), { ok: true, catalogo: [] });
  const errori = (righe: { quantita: string; prezzoEuro: string }[]) => {
    const e = validaCatalogoDaModulo(righe);
    return e.ok ? null : e.errore;
  };
  atteso("quantità non intera rifiutata, con il numero del pacchetto", /^Pacchetto 1: la quantità/.test(errori([{ quantita: "5,5", prezzoEuro: "300" }]) ?? ""));
  atteso("quantità 1 (non è un pacchetto) e oltre il massimo rifiutate", !!errori([{ quantita: "1", prezzoEuro: "75" }]) && !!errori([{ quantita: "1001", prezzoEuro: "75" }]));
  atteso("prezzo non valido, zero o enorme rifiutato", !!errori([{ quantita: "5", prezzoEuro: "gratis" }]) && !!errori([{ quantita: "5", prezzoEuro: "0" }]) && !!errori([{ quantita: "5", prezzoEuro: "200000" }]));
  atteso("quantità senza prezzo (e viceversa) rifiutata", !!errori([{ quantita: "5", prezzoEuro: "" }]) && !!errori([{ quantita: "", prezzoEuro: "300" }]));
  atteso("due pacchetti con la stessa quantità rifiutati", /stessa quantità/.test(errori([{ quantita: "5", prezzoEuro: "300" }, { quantita: "5", prezzoEuro: "290" }]) ?? ""));
  atteso("più di sei pacchetti rifiutati", !!errori(Array.from({ length: 7 }, (_, i) => ({ quantita: String(i + 2), prezzoEuro: "100" }))));

  console.log("\n--- Convenienza e scelta del pacchetto ---");
  uguale("5 a 300 € contro 75 € la gara: 60 € l'uno, risparmio 75 €", convenienzaPacchetto({ quantita: 5, prezzoCentesimi: 30000 }, 7500), { perUnitaCentesimi: 6000, risparmioCentesimi: 7500 });
  uguale("un pacchetto che costa quanto le gare singole (o di più) non dichiara risparmio", [convenienzaPacchetto({ quantita: 5, prezzoCentesimi: 37500 }, 7500).risparmioCentesimi, convenienzaPacchetto({ quantita: 5, prezzoCentesimi: 40000 }, 7500).risparmioCentesimi], [null, null]);
  uguale("il pacchetto proposto in gara è quello che costa meno per unità (a parità, il più grande)", [proponiPacchettoPiuConveniente([{ quantita: 5, prezzoCentesimi: 30000 }, { quantita: 20, prezzoCentesimi: 90000 }, { quantita: 10, prezzoCentesimi: 58000 }])?.quantita, proponiPacchettoPiuConveniente([{ quantita: 5, prezzoCentesimi: 30000 }, { quantita: 10, prezzoCentesimi: 60000 }])?.quantita, proponiPacchettoPiuConveniente([])], [20, 10, null]);
  const catalogo = [{ quantita: 5, prezzoCentesimi: 30000 }, { quantita: 10, prezzoCentesimi: 55000 }];
  uguale("trovaPacchetto: solo una quantità in vendita adesso (numero o testo)", [trovaPacchetto(catalogo, 5)?.prezzoCentesimi, trovaPacchetto(catalogo, "10")?.prezzoCentesimi, trovaPacchetto(catalogo, 7), trovaPacchetto(catalogo, "x"), trovaPacchetto(catalogo, null), trovaPacchetto([], 5)], [30000, 55000, null, null, null, null]);
  uguale("formattaEuro: tondo senza decimali, altrimenti due", [formattaEuro(30000).replace(/\s/g, " "), formattaEuro(29990).replace(/\s/g, " ")], ["300 €", "299,90 €"]);

  console.log("\n--- Cosa si offre a chi guarda ---");
  const base = { servizio: "piano_lavoro" as const, titolare: true, venditaAttiva: true, catalogo };
  uguale("il titolare con la vendita accesa può comprare", valutaOffertaPacchetti(base), { stato: "acquistabile", pacchetti: catalogo });
  uguale("l'Ufficio Gare vede i pacchetti ma non compra", valutaOffertaPacchetti({ ...base, titolare: false }), { stato: "solo_titolare", pacchetti: catalogo });
  uguale("vendita spenta: nessuna offerta (né al titolare né all'Ufficio Gare)", [valutaOffertaPacchetti({ ...base, venditaAttiva: false }), valutaOffertaPacchetti({ ...base, venditaAttiva: false, titolare: false })], [{ stato: "nessuna" }, { stato: "nessuna" }]);
  uguale("nessun pacchetto in elenco: nessuna offerta", valutaOffertaPacchetti({ ...base, catalogo: [] }), { stato: "nessuna" });
  uguale("OMNIA FOOD MENU: sempre «in arrivo», anche con la vendita accesa e un elenco, mai acquistabile", [valutaOffertaPacchetti({ ...base, servizio: "food_menu" }), valutaOffertaPacchetti({ ...base, servizio: "food_menu", titolare: false })], [{ stato: "in_arrivo" }, { stato: "in_arrivo" }]);

  console.log("\n--- Quali servizi compaiono nella home ---");
  const home = (settoriGare: (Settore | null)[], saldi: Partial<Record<"piano_lavoro" | "food_menu", number>> = {}, acquisti: Partial<Record<"piano_lavoro" | "food_menu", number>> = {}) => serviziPerLaHome({ settoriGare, saldi, acquisti }).map((s) => `${s.servizio}:${s.motivo}`);
  uguale("gare di pulizie → il pacchetto del piano di lavoro", home(["pulizie"]), ["piano_lavoro:settore"]);
  uguale("gare di ristorazione collettiva → OMNIA FOOD MENU", home(["ristorazione_collettiva"]), ["food_menu:settore"]);
  uguale("pulizie E ristorazione → entrambi", home(["pulizie", "ristorazione_collettiva", "altro"]), ["piano_lavoro:settore", "food_menu:settore"]);
  uguale("gare non ancora classificate contano come pulizie (come nella scheda della gara)", home([null]), ["piano_lavoro:settore"]);
  uguale("solo altri settori → nessun servizio", home(["altro", "altro"]), []);
  uguale("nessuna gara e nessun saldo → nulla", home([]), []);
  uguale("un saldo si vede sempre, anche senza gare di quel settore", home(["altro"], { piano_lavoro: 3 }), ["piano_lavoro:saldo"]);
  uguale("chi ha già comprato lo vede anche a saldo zero", home([], {}, { piano_lavoro: 1 }), ["piano_lavoro:acquisti"]);
  uguale("il motivo «settore» ha la precedenza", home(["pulizie"], { piano_lavoro: 2 }, { piano_lavoro: 1 }), ["piano_lavoro:settore"]);

  const schede = (c: Partial<Parameters<typeof costruisciSchede>[0]> = {}) =>
    costruisciSchede({ settoriGare: ["pulizie"], saldi: {}, acquisti: {}, titolare: true, venditaAttiva: true, cataloghi: { piano_lavoro: catalogo }, prezzoSingolo: { piano_lavoro: 7500 }, ...c });
  uguale("scheda del piano di lavoro: pacchetti con prezzo per unità e risparmio", schede()[0].pacchetti, [{ quantita: 5, prezzoCentesimi: 30000, perUnitaCentesimi: 6000, risparmioCentesimi: 7500 }, { quantita: 10, prezzoCentesimi: 55000, perUnitaCentesimi: 5500, risparmioCentesimi: 20000 }]);
  uguale("vendita spenta e nessun saldo: nessuna scheda (non si mostrano prezzi che non si possono pagare)", schede({ venditaAttiva: false }), []);
  uguale("vendita spenta ma con un saldo: la scheda c'è, senza pacchetti", schede({ venditaAttiva: false, saldi: { piano_lavoro: 4 } }).map((s) => [s.saldo, s.offerta.stato, s.pacchetti.length]), [[4, "nessuna", 0]]);
  uguale("OMNIA FOOD MENU: scheda «in arrivo», senza pacchetti, anche con la vendita spenta", schede({ settoriGare: ["ristorazione_collettiva"], venditaAttiva: false }).map((s) => [s.servizio, s.offerta.stato, s.pacchetti.length]), [["food_menu", "in_arrivo", 0]]);
  uguale("pulizie e ristorazione: due schede, il piano di lavoro prima", schede({ settoriGare: ["pulizie", "ristorazione_collettiva"] }).map((s) => s.servizio), ["piano_lavoro", "food_menu"]);
  uguale("Ufficio Gare: le stesse schede ma «solo titolare»", schede({ titolare: false })[0].offerta.stato, "solo_titolare");
  uguale("senza il prezzo singolo nessun risparmio dichiarato", schede({ prezzoSingolo: { piano_lavoro: null } })[0].pacchetti.map((p) => p.risparmioCentesimi), [null, null]);

  console.log("\n--- Saldo e diritto ---");
  uguale("saldo positivo, gara nuova: ha il diritto e consuma un'unità", dirittoDaPacchetto({ saldo: 3, garaGiaConsumata: false }), { ha: true, consumaUnita: true });
  uguale("saldo zero, gara nuova: nessun diritto", dirittoDaPacchetto({ saldo: 0, garaGiaConsumata: false }), { ha: false, consumaUnita: false });
  uguale("gara che ha già usato la sua unità: diritto senza consumare, anche a saldo zero", [dirittoDaPacchetto({ saldo: 0, garaGiaConsumata: true }), dirittoDaPacchetto({ saldo: 4, garaGiaConsumata: true })], [{ ha: true, consumaUnita: false }, { ha: true, consumaUnita: false }]);
  uguale("esito delle funzioni SQL: solo i tre valori noti", ["consumata", "gia_consumata", "saldo_insufficiente", "boh", null, 5].map(interpretaEsitoConsumo), ["consumata", "gia_consumata", "saldo_insufficiente", null, null, null]);
  atteso("ogni tipo di movimento ha la sua etichetta leggibile", ["acquisto", "consumo", "riaccredito", "rettifica", "estinzione"].every((t) => (ETICHETTA_MOVIMENTO as Record<string, string>)[t]?.length > 3));

  // ═════ 2. il diritto alla generazione ═════
  console.log("\n--- Offerte dedicate: validazione e regole ---");
  const oggiRoma = "2026-11-10";
  const modulo = { email: " Cliente@Pulizie.IT ", servizio: "piano_lavoro", quantita: "10", prezzoEuro: "450", scadeIl: "2026-12-31", nota: " accordo commerciale " };
  uguale("offerta valida: email in minuscolo, prezzo in centesimi, scadenza e nota senza spazi", validaNuovaOfferta(modulo, oggiRoma), { ok: true, valori: { email: "cliente@pulizie.it", servizio: "piano_lavoro", quantita: 10, prezzoCentesimi: 45000, scadeIl: "2026-12-31", nota: "accordo commerciale" } });
  uguale("senza scadenza né nota restano vuote; la quantità può essere 1; prezzo con la virgola", validaNuovaOfferta({ ...modulo, quantita: "1", prezzoEuro: "70,50", scadeIl: "", nota: "  " }, oggiRoma), { ok: true, valori: { email: "cliente@pulizie.it", servizio: "piano_lavoro", quantita: 1, prezzoCentesimi: 7050, scadeIl: null, nota: null } });
  uguale("la scadenza di oggi è valida (ultimo giorno incluso)", validaNuovaOfferta({ ...modulo, scadeIl: oggiRoma }, oggiRoma).ok, true);
  const erroreOfferta = (c: Partial<typeof modulo>) => {
    const e = validaNuovaOfferta({ ...modulo, ...c }, oggiRoma);
    return e.ok ? null : e.errore;
  };
  atteso("email vuota, senza chiocciola, senza dominio o lunghissima rifiutate", !!erroreOfferta({ email: "  " }) && !!erroreOfferta({ email: "cliente.pulizie.it" }) && !!erroreOfferta({ email: "cliente@pulizie" }) && !!erroreOfferta({ email: `${"a".repeat(250)}@x.it` }));
  atteso("servizio sconosciuto o non ancora disponibile (OMNIA FOOD MENU) rifiutato", !!erroreOfferta({ servizio: "altro" }) && /non è ancora disponibile/.test(erroreOfferta({ servizio: "food_menu" }) ?? ""));
  atteso("quantità zero, enorme, decimale o non numerica rifiutata", !!erroreOfferta({ quantita: "0" }) && !!erroreOfferta({ quantita: String(LIMITI_OFFERTA.quantitaMassima + 1) }) && !!erroreOfferta({ quantita: "1,5" }) && !!erroreOfferta({ quantita: "dieci" }) && !!erroreOfferta({ quantita: "" }));
  atteso("prezzo non valido, zero, negativo o enorme rifiutato", !!erroreOfferta({ prezzoEuro: "gratis" }) && !!erroreOfferta({ prezzoEuro: "0" }) && !!erroreOfferta({ prezzoEuro: "-5" }) && !!erroreOfferta({ prezzoEuro: "200000" }) && !!erroreOfferta({ prezzoEuro: "" }));
  atteso("scadenza passata, inventata o in formato sbagliato rifiutata", !!erroreOfferta({ scadeIl: "2026-11-09" }) && !!erroreOfferta({ scadeIl: "2026-02-31" }) && !!erroreOfferta({ scadeIl: "31/12/2026" }));
  atteso("nota troppo lunga rifiutata", !!erroreOfferta({ nota: "x".repeat(LIMITI_OFFERTA.notaMassima + 1) }) && validaNuovaOfferta({ ...modulo, nota: "x".repeat(LIMITI_OFFERTA.notaMassima) }, oggiRoma).ok);
  const attiva = { stato: "attiva" as const, scade_il: null };
  uguale("offerta acquistabile: attiva, senza scadenza o con scadenza non passata (anche oggi); non se scaduta, acquistata o revocata", [offertaAcquistabile(attiva, oggiRoma), offertaAcquistabile({ ...attiva, scade_il: oggiRoma }, oggiRoma), offertaAcquistabile({ ...attiva, scade_il: "2026-11-09" }, oggiRoma), offertaAcquistabile({ stato: "acquistata", scade_il: null }, oggiRoma), offertaAcquistabile({ stato: "revocata", scade_il: null }, oggiRoma)], [true, true, false, false, false]);
  uguale("al cliente arrivano solo id, servizio, quantità, prezzo e scadenza (mai la nota interna)", daRigaOfferta({ id: "o1", servizio: "piano_lavoro", quantita: 10, prezzo_centesimi: 45000, scade_il: "2026-12-31", nota: "segreto", user_id: U1 } as Parameters<typeof daRigaOfferta>[0]), { id: "o1", servizio: "piano_lavoro", quantita: 10, prezzoCentesimi: 45000, scadeIl: "2026-12-31" });
  uguale("dataItaliana", dataItaliana("2026-12-31"), "31/12/2026");

  const offerteCliente = [{ id: "of1", servizio: "piano_lavoro" as const, quantita: 10, prezzoCentesimi: 45000, scadeIl: "2026-12-31" }];
  uguale("l'offerta dedicata compare PER PRIMA, con id e scadenza, poi i pacchetti dell'elenco; prezzo per unità e risparmio calcolati come per gli altri", schede({ offerte: offerteCliente })[0].pacchetti.map((p) => [p.offertaId ?? null, p.quantita, p.prezzoCentesimi, p.perUnitaCentesimi, p.risparmioCentesimi, p.scadeIl ?? null]), [["of1", 10, 45000, 4500, 30000, "2026-12-31"], [null, 5, 30000, 6000, 7500, null], [null, 10, 55000, 5500, 20000, null]]);
  uguale("l'offerta dedicata si vende anche con l'elenco pubblico vuoto (resta solo lei)", schede({ offerte: offerteCliente, cataloghi: { piano_lavoro: [] } })[0].pacchetti.map((p) => p.offertaId ?? null), ["of1"]);
  uguale("vendita spenta: nemmeno l'offerta dedicata si offre", schede({ offerte: offerteCliente, venditaAttiva: false }), []);
  uguale("un cliente con un'offerta dedicata ma senza gare di pulizie vede comunque la scheda (motivo «offerta»)", schede({ settoriGare: ["altro"], offerte: offerteCliente }).map((x) => [x.servizio, x.motivo]), [["piano_lavoro", "offerta"]]);
  uguale("senza offerte la scheda è quella di prima", schede({ offerte: [] })[0].pacchetti.map((p) => p.offertaId ?? null), [null, null]);
  uguale("Ufficio Gare: la stessa scheda, «solo titolare» (l'offerta si compra solo dal titolare)", schede({ titolare: false, offerte: offerteCliente })[0].offerta.stato, "solo_titolare");
  atteso("l'offerta di un servizio non compare nell'altro: OMNIA FOOD MENU resta «in arrivo» e senza pacchetti, mentre il piano di lavoro mostra la sua offerta", (() => { const due = schede({ settoriGare: ["ristorazione_collettiva"], offerte: offerteCliente }); return due.find((x) => x.servizio === "food_menu")?.pacchetti.length === 0 && due.find((x) => x.servizio === "food_menu")?.offerta.stato === "in_arrivo" && due.find((x) => x.servizio === "piano_lavoro")?.pacchetti.some((p) => p.offertaId === "of1") === true; })());
  uguale("serviziPerLaHome: l'offerta dedicata fa comparire il servizio, ma settore, saldo e acquisti hanno la precedenza", [serviziPerLaHome({ settoriGare: [], saldi: {}, acquisti: {}, offerte: { piano_lavoro: 1 } }).map((x) => x.motivo), serviziPerLaHome({ settoriGare: ["pulizie"], saldi: {}, acquisti: {}, offerte: { piano_lavoro: 1 } }).map((x) => x.motivo), serviziPerLaHome({ settoriGare: [], saldi: { piano_lavoro: 2 }, acquisti: {}, offerte: { piano_lavoro: 1 } }).map((x) => x.motivo)], [["offerta"], ["settore"], ["saldo"]]);
  uguale("chi non ha mai avuto unità: haAvutoUnita falso; con una riga di saldo (anche a zero) o con un acquisto: vero", [schede()[0].haAvutoUnita, schede({ saldi: { piano_lavoro: 0 } })[0].haAvutoUnita, schede({ acquisti: { piano_lavoro: 1 } })[0].haAvutoUnita, schede({ saldi: { piano_lavoro: 3 } })[0].haAvutoUnita], [false, true, true, true]);
  const concessioniTesto = ["Fino a 20 gare, fino al 31/12/2026 — usate 1 su 20"];
  uguale("le concessioni gratuite stanno nella scheda del piano di lavoro, e la scheda compare anche senza saldo e con la vendita spenta (è una cosa del cliente)", schede({ concessioni: { piano_lavoro: concessioniTesto }, venditaAttiva: false }).map((x) => [x.concessioni, x.pacchetti.length]), [[concessioniTesto, 0]]);
  uguale("senza concessioni l'elenco è vuoto", schede()[0].concessioni, []);
  uguale("proposta in gara: l'offerta dedicata più conveniente vince, e porta il suo id", [proponiPacchettoPiuConveniente(catalogo, offerteCliente)?.offertaId, proponiPacchettoPiuConveniente(catalogo, offerteCliente)?.perUnitaCentesimi], ["of1", 4500]);
  uguale("proposta in gara: un'offerta meno conveniente dell'elenco non vince; a parità vince l'offerta", [proponiPacchettoPiuConveniente(catalogo, [{ ...offerteCliente[0], prezzoCentesimi: 90000 }])?.offertaId ?? null, proponiPacchettoPiuConveniente([{ quantita: 10, prezzoCentesimi: 45000 }], offerteCliente)?.offertaId], [null, "of1"]);
  uguale("proposta in gara senza offerte: come prima", proponiPacchettoPiuConveniente(catalogo)?.offertaId ?? null, null);

  console.log("\n--- Il pacchetto nell'ordine delle fonti del piano di lavoro ---");
  const adesso = new Date("2026-11-10T10:00:00Z");
  const contesto = (extra: Partial<ContestoDirittoPiano> = {}): ContestoDirittoPiano => ({ analisiCompleta: true, garaUsabile: true, piani: [], prorogaStato: null, concessioneId: null, abbonamentoCopreGara: false, provaGratuita: false, acquistoPagato: false, aperturaSviluppo: false, adesso, ...extra });
  const esito = (extra: Partial<ContestoDirittoPiano>) => {
    const e = valutaDirittoPiano(contesto(extra));
    return e.ok ? { fonte: e.fonte, versione: e.versione, consuma: e.consumaUnita } : { motivo: e.motivo };
  };
  uguale("con un saldo e nessun'altra fonte: fonte «pacchetto», consuma un'unità", esito({ pacchettoSaldo: 5 }), { fonte: "pacchetto", versione: 1, consuma: true });
  uguale("senza saldo e senza altre fonti: non attivo (si offre l'acquisto)", esito({ pacchettoSaldo: 0 }), { motivo: "non_attivo" });
  uguale("senza i campi del pacchetto (vecchio contesto): non attivo, come prima", esito({}), { motivo: "non_attivo" });
  uguale("concessione, abbonamento, prova gratuita, acquisto della gara hanno la precedenza e NON consumano il pacchetto", [esito({ pacchettoSaldo: 5, concessioneId: "c" }), esito({ pacchettoSaldo: 5, abbonamentoCopreGara: true }), esito({ pacchettoSaldo: 5, provaGratuita: true }), esito({ pacchettoSaldo: 5, acquistoPagato: true })].map((e) => ("fonte" in e ? [e.fonte, e.consuma] : e)), [["concessione", false], ["abbonamento", false], ["prova", false], ["acquisto", false]]);
  uguale("il pacchetto precede l'apertura di sviluppo", esito({ pacchettoSaldo: 1, aperturaSviluppo: true }), { fonte: "pacchetto", versione: 1, consuma: true });
  uguale("gara che ha già usato la sua unità, saldo zero: ha ancora il diritto e non consuma", esito({ pacchettoSaldo: 0, pacchettoGaraConsumata: true }), { fonte: "pacchetto", versione: 1, consuma: false });
  const pronto = [{ versione: 1, stato: "pronto" as const, creata_il: "2026-11-09T10:00:00Z" }];
  uguale("seconda generazione per la proroga: stessa unità, nessun consumo in più", esito({ pacchettoSaldo: 0, pacchettoGaraConsumata: true, piani: pronto, prorogaStato: "con_nuova_data" }), { fonte: "pacchetto", versione: 2, consuma: false });
  uguale("senza proroga la seconda generazione non c'è, qualunque sia il saldo", esito({ pacchettoSaldo: 9, pacchettoGaraConsumata: true, piani: pronto }), { motivo: "versioni_esaurite" });
  uguale("analisi non finita, gara bloccata, generazione in corso: nessun consumo possibile (il pacchetto non cambia nulla)", [esito({ pacchettoSaldo: 5, analisiCompleta: false }), esito({ pacchettoSaldo: 5, garaUsabile: false }), esito({ pacchettoSaldo: 5, piani: [{ versione: 1, stato: "in_corso", creata_il: "2026-11-10T09:55:00Z" }] })], [{ motivo: "analisi_non_completata" }, { motivo: "gara_bloccata" }, { motivo: "gia_in_corso" }]);
  const errore1 = valutaDirittoPiano(contesto({ pacchettoSaldo: 2, piani: [{ versione: 1, stato: "errore", creata_il: "2026-11-09T10:00:00Z" }] }));
  atteso("ripetizione dopo un errore: la versione si riprova (la gara può avere già l'unità, riaccreditata o no)", errore1.ok && errore1.riprova === true && errore1.fonte === "pacchetto");
  atteso("aperturaSviluppoAttiva resta com'era (mai in produzione)", aperturaSviluppoAttiva({ OMNIA_AI_PIANO_LAVORO_APERTO: "1", NODE_ENV: "production" }) === false);

  // ═════ 3. il database (finto) ═════
  console.log("\n--- Saldo, consumo, riaccredito, estinzione ---");
  {
    const db: Db = { omnia_ai_pacchetti_saldi: [{ user_id: U1, servizio: "piano_lavoro", saldo: 3 }, { user_id: U1, servizio: "food_menu", saldo: 1 }, { user_id: U2, servizio: "piano_lavoro", saldo: 9 }, { user_id: U1, servizio: "inventato", saldo: 7 }], omnia_ai_pacchetti_consumi: [{ user_id: U1, servizio: "piano_lavoro", gara_id: GARA }] };
    uguale("leggiSaldiPacchetti: per servizio, solo dell'account, solo servizi noti", await leggiSaldiPacchetti(fintoAdmin(db), U1), { piano_lavoro: 3, food_menu: 1 });
    uguale("leggiSaldiPacchetti: senza la migrazione 0104 nessun saldo (e nessun errore)", await spegniErrori(() => leggiSaldiPacchetti(fintoAdmin(db, ["omnia_ai_pacchetti_saldi"]), U1)), {});
    uguale("leggiStatoPacchettoGara: saldo e se la gara ha già usato la sua unità", [await leggiStatoPacchettoGara(fintoAdmin(db), U1, "piano_lavoro", GARA), await leggiStatoPacchettoGara(fintoAdmin(db), U1, "piano_lavoro", GARA2), await leggiStatoPacchettoGara(fintoAdmin(db), U2, "piano_lavoro", GARA)], [{ saldo: 3, garaGiaConsumata: true }, { saldo: 3, garaGiaConsumata: false }, { saldo: 9, garaGiaConsumata: false }]);
    uguale("leggiStatoPacchettoGara: senza le tabelle: nessun saldo, gara non consumata", await spegniErrori(() => leggiStatoPacchettoGara(fintoAdmin(db, ["omnia_ai_pacchetti_saldi", "omnia_ai_pacchetti_consumi"]), U1, "piano_lavoro", GARA)), { saldo: 0, garaGiaConsumata: false });
    uguale("contaAcquistiPacchetti: solo i pagati dell'account", await contaAcquistiPacchetti(fintoAdmin({ omnia_ai_pacchetti_acquisti: [{ user_id: U1, servizio: "piano_lavoro", stato: "pagata" }, { user_id: U1, servizio: "piano_lavoro", stato: "pagata" }, { user_id: U1, servizio: "piano_lavoro", stato: "in_attesa_pagamento" }, { user_id: U2, servizio: "piano_lavoro", stato: "pagata" }] }), U1), { piano_lavoro: 2 });
  }
  {
    const db: Db = { omnia_ai_pacchetti_saldi: [{ user_id: U1, servizio: "piano_lavoro", saldo: 1 }] };
    const admin = fintoAdmin(db, [], funzioniSql());
    const a = await consumaUnita(admin, { accountId: U1, servizio: "piano_lavoro", garaId: GARA, garaTitolo: "Gara" });
    const b = await consumaUnita(admin, { accountId: U1, servizio: "piano_lavoro", garaId: GARA, garaTitolo: "Gara" });
    const c = await consumaUnita(admin, { accountId: U1, servizio: "piano_lavoro", garaId: GARA2, garaTitolo: "Gara 2" });
    uguale("consumaUnita: la prima gara consuma, la stessa gara no, un'altra gara a saldo zero viene rifiutata", [a, b, c], ["consumata", "gia_consumata", "saldo_insufficiente"]);
    uguale("le chiamate al database hanno i parametri giusti (utente, servizio, gara, titolo)", admin.chiamate[0], { nome: "omnia_ai_pacchetto_consuma", args: { p_user: U1, p_servizio: "piano_lavoro", p_gara: GARA, p_gara_titolo: "Gara" } });
    atteso("riaccreditaUnita: l'unità torna e la gara può riprovare", (await riaccreditaUnita(admin, { accountId: U1, servizio: "piano_lavoro", garaId: GARA, motivo: "x" })) === true && (db.omnia_ai_pacchetti_saldi[0].saldo as number) === 1);
    const senzaFunzioni = fintoAdmin({}, [], {});
    uguale("consumaUnita: se il database non risponde (funzione assente) è «errore», non un consumo", await spegniErrori(() => consumaUnita(senzaFunzioni, { accountId: U1, servizio: "piano_lavoro", garaId: GARA, garaTitolo: null })), "errore");
    uguale("consumaUnita: una risposta anomala del database (testo sconosciuto o vuota) NON è un consumo: «errore», e quindi non si genera nulla", [await consumaUnita(fintoAdmin({}, [], { omnia_ai_pacchetto_consuma: () => ({ data: "boh", error: null }) }), { accountId: U1, servizio: "piano_lavoro", garaId: GARA, garaTitolo: null }), await consumaUnita(fintoAdmin({}, [], { omnia_ai_pacchetto_consuma: () => ({ data: null, error: null }) }), { accountId: U1, servizio: "piano_lavoro", garaId: GARA, garaTitolo: null })], ["errore", "errore"]);
    atteso("riaccreditaUnita: un errore si dice (false), non si ignora in silenzio", (await spegniErrori(() => riaccreditaUnita(senzaFunzioni, { accountId: U1, servizio: "piano_lavoro", garaId: GARA, motivo: "x" }))) === false);
  }
  {
    const db: Db = { omnia_ai_pacchetti_saldi: [{ user_id: U1, servizio: "piano_lavoro", saldo: 3 }, { user_id: U1, servizio: "food_menu", saldo: 2 }, { user_id: U2, servizio: "piano_lavoro", saldo: 9 }] };
    uguale("estinguiPacchetti: azzera i saldi del cliente (tutti i servizi) e dice quante unità si sono perse, senza toccare gli altri", [await estinguiPacchetti(fintoAdmin(db, [], funzioniSql()), U1), db.omnia_ai_pacchetti_saldi.map((s) => s.saldo)], [5, [0, 0, 9]]);
    uguale("estinguiPacchetti: senza la migrazione o senza la funzione non solleva mai un errore (il webhook non deve cadere)", [await spegniErrori(() => estinguiPacchetti(fintoAdmin({}, [], {}), U1)), await spegniErrori(() => estinguiPacchetti({ rpc: async () => { throw new Error("rete"); } } as unknown as SupabaseClient, U1))], [0, 0]);
  }
  {
    const db: Db = { omnia_ai_pacchetti_saldi: [{ user_id: U1, servizio: "piano_lavoro", saldo: 2 }] };
    const admin = fintoAdmin(db, [], funzioniSql());
    uguale("rettificaPacchetti: +3 → 5", await rettificaPacchetti(admin, { userId: U1, servizio: "piano_lavoro", delta: 3, motivo: "Regalo", da: "admin@x.it" }), { ok: true, saldo: 5 });
    uguale("rettificaPacchetti: sotto zero rifiutata con un messaggio chiaro", await spegniErrori(() => rettificaPacchetti(admin, { userId: U1, servizio: "piano_lavoro", delta: -50, motivo: "Troppo", da: "a" })), { ok: false, errore: "Il saldo non può scendere sotto zero." });
    uguale("i movimenti: senza la migrazione 0104 nessuno", await spegniErrori(() => leggiMovimentiPacchetti(fintoAdmin({}, ["omnia_ai_pacchetti_movimenti"]), U1)), []);
    uguale("leggiSettoriGare: con la colonna 0103 i settori; senza, tutte «non classificate»", [await leggiSettoriGare(fintoAdmin({ gare: [{ user_id: U1, settore: "pulizie" }, { user_id: U1, settore: "boh" }, { user_id: U1, settore: null }, { user_id: U2, settore: "altro" }] }), U1)], [["pulizie", null, null]]);
  }

  uguale("pacchettiDisponibili: con le tabelle sì, senza la migrazione 0104 no (nulla si offre e nulla si compra)", [await pacchettiDisponibili(fintoAdmin({ omnia_ai_pacchetti_saldi: [] })), await pacchettiDisponibili(fintoAdmin({}, ["omnia_ai_pacchetti_saldi"]))], [true, false]);

  console.log("\n--- Offerte dedicate: database ---");
  const OF1 = "ccccccc1-cccc-4ccc-8ccc-cccccccccc01";
  const riga = (extra: Riga = {}): Riga => ({ id: OF1, user_id: U1, servizio: "piano_lavoro", quantita: 10, prezzo_centesimi: 45000, scade_il: "2099-12-31", nota: "interna", stato: "attiva", creata_il: "2026-11-09T10:00:00Z", creata_da_email: "admin@x.it", chiusa_il: null, chiusa_da_email: null, acquisto_id: null, ...extra });
  const dbOfferte = (): Db => ({
    omnia_ai_pacchetti_offerte: [
      riga(),
      riga({ id: "ccccccc2-cccc-4ccc-8ccc-cccccccccc02", scade_il: "2020-01-01" }),
      riga({ id: "ccccccc3-cccc-4ccc-8ccc-cccccccccc03", stato: "acquistata" }),
      riga({ id: "ccccccc4-cccc-4ccc-8ccc-cccccccccc04", stato: "revocata" }),
      riga({ id: "ccccccc5-cccc-4ccc-8ccc-cccccccccc05", user_id: U2 }),
    ],
    users: [{ id: U1, email: "uno@x.it" }, { id: U2, email: "due@x.it" }],
  });
  uguale("leggiOfferteAttive: solo le attive e non scadute di QUESTO cliente, senza la nota interna", await leggiOfferteAttive(fintoAdmin(dbOfferte()), U1), [{ id: OF1, servizio: "piano_lavoro", quantita: 10, prezzoCentesimi: 45000, scadeIl: "2099-12-31" }]);
  uguale("leggiOfferteAttive: un altro cliente non vede le offerte del primo", (await leggiOfferteAttive(fintoAdmin(dbOfferte()), U2)).map((o) => o.id), ["ccccccc5-cccc-4ccc-8ccc-cccccccccc05"]);
  uguale("leggiOfferteAttive: senza la migrazione 0105 nessuna offerta (e nessun errore)", await spegniErrori(() => leggiOfferteAttive(fintoAdmin({}, ["omnia_ai_pacchetti_offerte"]), U1)), []);
  const perAcquisto = async (utente: string, id: string, db: Db = dbOfferte()) => (await leggiOffertaPerAcquisto(fintoAdmin(db), utente, id))?.id ?? null;
  uguale("leggiOffertaPerAcquisto: la propria offerta valida sì; l'offerta di un altro, scaduta, già acquistata, revocata, inesistente o con un id che non è un id: no", [await perAcquisto(U1, OF1), await perAcquisto(U2, OF1), await perAcquisto(U1, "ccccccc2-cccc-4ccc-8ccc-cccccccccc02"), await perAcquisto(U1, "ccccccc3-cccc-4ccc-8ccc-cccccccccc03"), await perAcquisto(U1, "ccccccc4-cccc-4ccc-8ccc-cccccccccc04"), await perAcquisto(U1, "ccccccc9-cccc-4ccc-8ccc-cccccccccc09"), await perAcquisto(U1, "' or 1=1 --"), await perAcquisto(U1, "")], [OF1, null, null, null, null, null, null, null]);
  uguale("leggiOffertaPerAcquisto: senza la migrazione 0105 nessuna offerta", await spegniErrori(() => leggiOffertaPerAcquisto(fintoAdmin({}, ["omnia_ai_pacchetti_offerte"]), U1, OF1)), null);
  const risolvi = (offertaId: string, quantita: unknown, utente = U1, servizio: "piano_lavoro" | "food_menu" = "piano_lavoro") => risolviPacchetto(fintoAdmin(dbOfferte()), { accountId: utente, servizio, offertaId, quantita });
  uguale("risolviPacchetto: con l'offerta dedicata quantità e prezzo sono QUELLI DELL'OFFERTA (la quantità arrivata dal browser non conta)", await risolvi(OF1, "999"), { quantita: 10, prezzoCentesimi: 45000, offertaId: OF1 });
  uguale("risolviPacchetto: l'offerta di un altro cliente, o di un altro servizio, non si compra e NON ricade sull'elenco pubblico", [await risolvi(OF1, "5", U2), await risolvi(OF1, "5", U1, "food_menu")], [null, null]);
  uguale("risolviPacchetto: senza offerta vale l'elenco pubblico (quantità in vendita, prezzo dell'elenco); una quantità che non c'è no", [await risolvi("", "5"), await risolvi("", 5), await risolvi("", "7"), await risolvi("", null)], [{ quantita: 5, prezzoCentesimi: 30000, offertaId: null }, { quantita: 5, prezzoCentesimi: 30000, offertaId: null }, null, null]);
  {
    const db = dbOfferte();
    const admin = fintoAdmin(db);
    await chiudiOffertaAcquistata(admin, OF1, "acq-1");
    const o = db.omnia_ai_pacchetti_offerte[0];
    atteso("chiudiOffertaAcquistata: l'offerta diventa «acquistata», con l'acquisto e la data", o.stato === "acquistata" && o.acquisto_id === "acq-1" && typeof o.chiusa_il === "string");
    await chiudiOffertaAcquistata(admin, OF1, "acq-2");
    atteso("chiudiOffertaAcquistata: un evento rimandato non riscrive l'acquisto già registrato", o.acquisto_id === "acq-1");
    const revocata = db.omnia_ai_pacchetti_offerte[3];
    await chiudiOffertaAcquistata(admin, revocata.id as string, "acq-3");
    atteso("chiudiOffertaAcquistata: un'offerta già revocata non diventa «acquistata»", revocata.stato === "revocata" && revocata.acquisto_id === null);
    await spegniErrori(() => chiudiOffertaAcquistata(fintoAdmin({}, ["omnia_ai_pacchetti_offerte"]), OF1, "acq-4"));
    atteso("chiudiOffertaAcquistata: senza la migrazione 0105 non solleva errori", true);
  }
  {
    const db = dbOfferte();
    const admin = fintoAdmin(db);
    const creata = await creaOffertaDedicata(admin, { userId: U2, valori: { servizio: "piano_lavoro", quantita: 3, prezzoCentesimi: 21000, scadeIl: null, nota: "prova" }, daEmail: "admin@x.it" });
    const nuova = db.omnia_ai_pacchetti_offerte[db.omnia_ai_pacchetti_offerte.length - 1];
    atteso("creaOffertaDedicata: scrive utente, servizio, quantità, prezzo, scadenza, nota e chi l'ha creata (lo stato parte da «attiva» per il database)", creata.ok && nuova.user_id === U2 && nuova.quantita === 3 && nuova.prezzo_centesimi === 21000 && nuova.scade_il === null && nuova.nota === "prova" && nuova.creata_da_email === "admin@x.it" && nuova.stato === undefined);
    const senza = await spegniErrori(() => creaOffertaDedicata(fintoAdmin({}, ["omnia_ai_pacchetti_offerte"]), { userId: U2, valori: { servizio: "piano_lavoro", quantita: 3, prezzoCentesimi: 21000, scadeIl: null, nota: null }, daEmail: "a@x.it" }));
    atteso("creaOffertaDedicata: senza la migrazione 0105 dice che manca (nessuna eccezione)", !senza.ok && /0105/.test(senza.errore));
    uguale("revocaOffertaDedicata: un'offerta attiva si revoca (con chi e quando); una seconda volta, o una già acquistata, no", [await revocaOffertaDedicata(admin, OF1, "admin@x.it"), await revocaOffertaDedicata(admin, OF1, "admin@x.it"), await revocaOffertaDedicata(admin, "ccccccc3-cccc-4ccc-8ccc-cccccccccc03", "admin@x.it")], ["revocata", "non_attiva", "non_attiva"]);
    atteso("revocaOffertaDedicata: l'offerta revocata ha la data e l'email di chi l'ha revocata; quella acquistata non è stata toccata", db.omnia_ai_pacchetti_offerte[0].stato === "revocata" && db.omnia_ai_pacchetti_offerte[0].chiusa_da_email === "admin@x.it" && db.omnia_ai_pacchetti_offerte[2].stato === "acquistata" && db.omnia_ai_pacchetti_offerte[2].chiusa_da_email === null);
  }
  {
    const lista = await leggiOfferteConsole(fintoAdmin(dbOfferte()));
    atteso("leggiOfferteConsole: tutte le offerte (anche chiuse) con l'email del cliente, dalla più recente", lista.disponibile && lista.offerte.length === 5 && lista.offerte.find((o) => o.user_id === U1)?.cliente_email === "uno@x.it" && lista.offerte.find((o) => o.user_id === U2)?.cliente_email === "due@x.it");
    const unCliente = await leggiOfferteConsole(fintoAdmin(dbOfferte()), { perUtente: U2 });
    uguale("leggiOfferteConsole: per un cliente solo le sue", unCliente.offerte.map((o) => o.user_id), [U2]);
    uguale("leggiOfferteConsole: senza la migrazione 0105 «non disponibile», nessun errore", await spegniErrori(() => leggiOfferteConsole(fintoAdmin({}, ["omnia_ai_pacchetti_offerte"]))), { disponibile: false, offerte: [] });
  }
  {
    const db: Db = {
      omnia_ai_piano_lavoro_concessioni: [
        { id: "k1", user_id: U1, tipo: "tutte", gare_massime: 20, scade_il: "2099-12-31", attiva: true, gara_titolo: null, creata_il: "2026-11-01" },
        { id: "k2", user_id: U1, tipo: "gara", gare_massime: null, scade_il: null, attiva: true, gara_titolo: "Pulizie Aosta", creata_il: "2026-11-02" },
        { id: "k3", user_id: U1, tipo: "tutte", gare_massime: null, scade_il: null, attiva: false, gara_titolo: null, creata_il: "2026-11-03" },
        { id: "k4", user_id: U1, tipo: "tutte", gare_massime: 5, scade_il: "2020-01-01", attiva: true, gara_titolo: null, creata_il: "2026-11-04" },
        { id: "k5", user_id: U2, tipo: "tutte", gare_massime: 5, scade_il: null, attiva: true, gara_titolo: null, creata_il: "2026-11-05" },
      ],
      gara_piani_lavoro: [{ gara_id: GARA, concessione_id: "k1", stato: "pronto" }, { gara_id: GARA, concessione_id: "k1", stato: "pronto" }, { gara_id: GARA2, concessione_id: "k1", stato: "errore" }],
    };
    uguale("leggiConcessioniPerScheda: solo le attive, non scadute, di QUESTO cliente, raccontate in una riga; le gare usate si contano una volta e non quelle in errore", await leggiConcessioniPerScheda(fintoAdmin(db), U1), ["Fino a 20 gare, fino al 31/12/2099 — usate 1 su 20", "Solo la gara «Pulizie Aosta»"]);
    uguale("leggiConcessioniPerScheda: un cliente senza concessioni, o senza la migrazione 0101, non ha nulla", [await leggiConcessioniPerScheda(fintoAdmin(db), "nessuno"), await spegniErrori(() => leggiConcessioniPerScheda(fintoAdmin({}, ["omnia_ai_piano_lavoro_concessioni"]), U1))], [[], []]);
  }

  console.log("\n--- Il webhook: le unità si accreditano una volta sola ---");
  const rigaAttesa = (extra: Riga = {}): Riga => ({ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", user_id: U1, servizio: "piano_lavoro", quantita: 5, prezzo_centesimi: 30000, stato: "in_attesa_pagamento", stripe_session_id: "cs_1", stripe_payment_intent_id: null, pagata_il: null, importo_pagato_centesimi: null, accreditata_il: null, livemode: true, ...extra });
  const sessione = (extra: Partial<SessionePagamentoPacchetto> = {}): SessionePagamentoPacchetto => ({ id: "cs_1", payment_status: "paid", payment_intent: "pi_1", amount_total: 30000, livemode: true, customer_details: { name: "Pulizie Srl", email: "a@x.it" } as SessionePagamentoPacchetto["customer_details"], customer_email: "a@x.it", metadata: { tipo: "omnia_ai_pacchetto", acquistoId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", userId: U1, servizio: "piano_lavoro", quantita: "5" }, ...extra });
  type Chiamata = { livemode: boolean; eventoId: string | null; stato: unknown; accreditoMancante: boolean };
  const nuovaNotifica = () => {
    const chiamate: Chiamata[] = [];
    const notifica = (async (p: Parameters<NonNullable<Parameters<typeof registraPagamentoPacchetto>[0]["notifica"]>>[0]) => {
      chiamate.push({ livemode: p.livemode, eventoId: p.eventoId, stato: p.acquisto.stato, accreditoMancante: !!p.accreditoMancante });
    }) as NonNullable<Parameters<typeof registraPagamentoPacchetto>[0]["notifica"]>;
    return { chiamate, notifica };
  };
  {
    const db: Db = { omnia_ai_pacchetti_acquisti: [rigaAttesa()], omnia_ai_pacchetti_saldi: [] };
    const n = nuovaNotifica();
    const e = await registraPagamentoPacchetto({ admin: fintoAdmin(db, [], funzioniSql()), sessione: sessione(), eventoId: "evt_1", notifica: n.notifica });
    const r = db.omnia_ai_pacchetti_acquisti[0];
    atteso("pagamento riuscito: acquisto «pagato», con importo, sessione, payment intent, modalità e dati di Stripe", e.esito === "registrato" && r.stato === "pagata" && r.importo_pagato_centesimi === 30000 && r.stripe_payment_intent_id === "pi_1" && r.livemode === true && typeof r.pagata_il === "string" && (r.dati_stripe as { name: string }).name === "Pulizie Srl", JSON.stringify({ e, r }));
    atteso("le 5 unità sono nel saldo, e un pagamento reale resta «da fatturare»", (db.omnia_ai_pacchetti_saldi[0]?.saldo as number) === 5 && r.stato_fattura === undefined);
    uguale("l'email parte una volta, con l'acquisto già pagato", n.chiamate, [{ livemode: true, eventoId: "evt_1", stato: "pagata", accreditoMancante: false }]);
    // Stripe rimanda lo stesso evento: il saldo NON raddoppia, l'email si richiama (il suo registro evita i doppioni)
    const n2 = nuovaNotifica();
    const di_nuovo = await registraPagamentoPacchetto({ admin: fintoAdmin(db, [], funzioniSql()), sessione: sessione(), eventoId: "evt_1", notifica: n2.notifica });
    atteso("evento rimandato: «già registrato», il saldo resta 5, l'email richiamata", di_nuovo.esito === "gia_registrato" && (db.omnia_ai_pacchetti_saldi[0].saldo as number) === 5 && n2.chiamate.length === 1);
  }
  {
    // il pagamento era stato registrato ma l'accredito no (errore a metà): l'evento rimandato lo completa
    const db: Db = { omnia_ai_pacchetti_acquisti: [rigaAttesa({ stato: "pagata", pagata_il: "2026-11-10T09:00:00Z", accreditata_il: null })], omnia_ai_pacchetti_saldi: [] };
    const e = await registraPagamentoPacchetto({ admin: fintoAdmin(db, [], funzioniSql()), sessione: sessione(), eventoId: "evt_2", notifica: nuovaNotifica().notifica });
    atteso("pagamento registrato ma non accreditato: l'evento rimandato accredita (una volta)", e.esito === "gia_registrato" && (db.omnia_ai_pacchetti_saldi[0]?.saldo as number) === 5);
  }
  {
    const db: Db = { omnia_ai_pacchetti_acquisti: [rigaAttesa()] };
    const n = nuovaNotifica();
    const senzaFunzione = await spegniErrori(() => registraPagamentoPacchetto({ admin: fintoAdmin(db, [], {}), sessione: sessione(), eventoId: "evt_3", notifica: n.notifica }));
    atteso("se l'accredito non riesce l'esito è «errore» (il webhook risponde 500 e Stripe riprova) e nessuna email parte", senzaFunzione.esito === "errore" && senzaFunzione.motivo === "accredito" && n.chiamate.length === 0);
  }
  {
    const db: Db = { omnia_ai_pacchetti_acquisti: [rigaAttesa()], omnia_ai_pacchetti_saldi: [] };
    const n = nuovaNotifica();
    await registraPagamentoPacchetto({ admin: fintoAdmin(db, [], funzioniSql()), sessione: sessione({ livemode: false }), eventoId: "evt_4", notifica: n.notifica });
    const r = db.omnia_ai_pacchetti_acquisti[0];
    atteso("pagamento di prova (Stripe in modalità test): registrato e accreditato ma mai da fatturare, con la nota", r.stato === "pagata" && r.livemode === false && r.stato_fattura === "non_dovuta" && /prova/.test(String(r.note_fattura)) && n.chiamate[0].livemode === false);
  }
  {
    const db: Db = { omnia_ai_pacchetti_acquisti: [rigaAttesa({ user_id: null, stripe_session_id: "cs_1" })], omnia_ai_pacchetti_saldi: [] };
    const n = nuovaNotifica();
    const e = await spegniErrori(() => registraPagamentoPacchetto({ admin: fintoAdmin(db, [], funzioniSql()), sessione: sessione({ metadata: { tipo: "omnia_ai_pacchetto", acquistoId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" } }), eventoId: "evt_5", notifica: n.notifica }));
    atteso("utente non più presente: pagamento registrato, nessuna unità inventata, l'email all'ufficio lo segnala", e.esito === "registrato" && (db.omnia_ai_pacchetti_saldi ?? []).length === 0 && n.chiamate[0]?.accreditoMancante === true);
  }
  {
    // un acquisto che viene da un'offerta dedicata la chiude, una volta sola; senza offerta nulla cambia
    const db: Db = { omnia_ai_pacchetti_acquisti: [rigaAttesa({ offerta_id: "of-1" })], omnia_ai_pacchetti_saldi: [], omnia_ai_pacchetti_offerte: [{ id: "of-1", stato: "attiva", acquisto_id: null }] };
    const e = await registraPagamentoPacchetto({ admin: fintoAdmin(db, [], funzioniSql()), sessione: sessione(), eventoId: "evt_o1", notifica: nuovaNotifica().notifica });
    const o = db.omnia_ai_pacchetti_offerte[0];
    atteso("pagamento di un'offerta dedicata: le unità vanno nel saldo e l'offerta diventa «acquistata» con l'acquisto", e.esito === "registrato" && (db.omnia_ai_pacchetti_saldi[0]?.saldo as number) === 5 && o.stato === "acquistata" && o.acquisto_id === "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", JSON.stringify({ e, o }));
    await registraPagamentoPacchetto({ admin: fintoAdmin(db, [], funzioniSql()), sessione: sessione(), eventoId: "evt_o1", notifica: nuovaNotifica().notifica });
    atteso("evento rimandato: il saldo resta 5 e l'offerta resta com'è", (db.omnia_ai_pacchetti_saldi[0].saldo as number) === 5 && o.stato === "acquistata");
    const dbSenza: Db = { omnia_ai_pacchetti_acquisti: [rigaAttesa()], omnia_ai_pacchetti_saldi: [], omnia_ai_pacchetti_offerte: [{ id: "of-1", stato: "attiva", acquisto_id: null }] };
    await registraPagamentoPacchetto({ admin: fintoAdmin(dbSenza, [], funzioniSql()), sessione: sessione(), eventoId: "evt_o2", notifica: nuovaNotifica().notifica });
    atteso("un acquisto di un pacchetto dell'elenco non chiude nessuna offerta", dbSenza.omnia_ai_pacchetti_offerte[0].stato === "attiva");
    const dbErrore: Db = { omnia_ai_pacchetti_acquisti: [rigaAttesa({ offerta_id: "of-1" })], omnia_ai_pacchetti_offerte: [{ id: "of-1", stato: "attiva", acquisto_id: null }] };
    const fallito = await spegniErrori(() => registraPagamentoPacchetto({ admin: fintoAdmin(dbErrore, [], {}), sessione: sessione(), eventoId: "evt_o3", notifica: nuovaNotifica().notifica }));
    atteso("se l'accredito non riesce l'offerta NON si chiude (il cliente deve poter ritentare, Stripe riprova)", fallito.esito === "errore" && dbErrore.omnia_ai_pacchetti_offerte[0].stato === "attiva");
  }
  {
    const casi: [string, Db, Partial<SessionePagamentoPacchetto>, string][] = [
      ["sessione non pagata", { omnia_ai_pacchetti_acquisti: [rigaAttesa()] }, { payment_status: "unpaid" }, "non_pagata"],
      ["acquisto senza id nei metadata", { omnia_ai_pacchetti_acquisti: [rigaAttesa()] }, { metadata: { tipo: "omnia_ai_pacchetto" } }, "acquisto_id_mancante"],
      ["acquisto inesistente", { omnia_ai_pacchetti_acquisti: [] }, {}, "non_trovato"],
      ["sessione di un altro pagamento", { omnia_ai_pacchetti_acquisti: [rigaAttesa({ stripe_session_id: "cs_altra" })] }, {}, "sessione_diversa"],
      ["cliente diverso", { omnia_ai_pacchetti_acquisti: [rigaAttesa({ user_id: U2 })] }, {}, "cliente_diverso"],
    ];
    for (const [nome, db, extra, motivo] of casi) {
      const n = nuovaNotifica();
      const admin = fintoAdmin(db, [], funzioniSql());
      const e = await spegniErrori(() => registraPagamentoPacchetto({ admin, sessione: sessione(extra), eventoId: "evt_x", notifica: n.notifica }));
      atteso(`webhook ignorato — ${nome}: nessun accredito, nessuna email`, e.esito === "ignorato" && e.motivo === motivo && admin.chiamate.length === 0 && n.chiamate.length === 0, JSON.stringify(e));
    }
    const nAssente = nuovaNotifica();
    const senzaTabella = await spegniErrori(() => registraPagamentoPacchetto({ admin: fintoAdmin({}, ["omnia_ai_pacchetti_acquisti"], funzioniSql()), sessione: sessione(), eventoId: "evt_y", notifica: nAssente.notifica }));
    atteso("senza la migrazione 0104 la lettura dell'acquisto dà «errore» (transitorio per Stripe: riprova quando la tabella c'è)", senzaTabella.esito === "errore" && nAssente.chiamate.length === 0);
  }

  // ═════ 4. le scritture nel codice ═════
  console.log("\n--- Azioni: acquisto e richiesta ---");
  const azioni = leggi("src/app/actions/pacchetti-servizi.ts");
  atteso("il file dichiara «use server» in testa", azioni.startsWith('"use server";'));
  uguale("le azioni esportate sono due: acquisto (titolare) e richiesta (Ufficio Gare)", [...azioni.matchAll(/export async function (\w+)\(/g)].map((m) => m[1]), ["acquistaPacchettoServizio", "richiediAcquistoPacchetto"]);
  const acq = corpoFunzione(azioni, "acquistaPacchettoServizio");
  const pos = (testo: string, nel = acq) => nel.indexOf(testo);
  atteso("acquisto: la prima cosa è la guardia del titolare", /^export async function acquistaPacchettoServizio\([^)]*\)[^{]*\{\n\s*const guardia = await richiediTitolareAzione\(\);\n\s*if \(!guardia\.ok\) return \{ error: guardia\.errore \};/.test(acq));
  atteso("acquisto: non rilegge la sessione per conto suo", !acq.includes("auth.getUser()"));
  atteso("acquisto: solo con abbonamento attivo (come i crediti: si estinguono con la cessazione), prima di tutto il resto", pos("hasActiveSubscription(contesto.accountId)") !== -1 && pos("hasActiveSubscription") < pos("venditaPacchettiAttiva") && pos("hasActiveSubscription") < pos("insert("));
  atteso("acquisto: servizio valido e già disponibile, vendita accesa, pacchetto (dell'elenco o offerta dedicata del cliente) riletto dal server, TUTTO prima di registrare e di andare a Stripe", pos("eServizioPacchetto(servizioGrezzo)") !== -1 && pos("SERVIZI[servizio].disponibile") !== -1 && pos("venditaPacchettiAttiva(admin)") !== -1 && pos("risolviPacchetto(admin") !== -1 && pos("venditaPacchettiAttiva(admin)") < pos("insert(") && pos("risolviPacchetto(admin") < pos("insert(") && pos("insert(") < pos("checkout.sessions.create"));
  atteso("acquisto: il prezzo si rilegge dal server e quello arrivato dal browser serve solo a accorgersi di un cambio", pos("mostrato !== pacchetto.prezzoCentesimi") !== -1 && pos("prezzoAggiornatoCentesimi: pacchetto.prezzoCentesimi") !== -1 && pos("unit_amount: pacchetto.prezzoCentesimi") !== -1 && !/unit_amount: (mostrato|Number\(formData)/.test(acq));
  atteso("acquisto: due accettazioni esplicite (condizioni + privacy, clausole specifiche) controllate prima del pagamento", pos('formData.get("accettaCondizioni") !== "on"') !== -1 && pos('formData.get("accettaClausole") !== "on"') !== -1 && pos('formData.get("accettaClausole")') < pos("insert("));
  atteso("acquisto: si registrano versione e impronta delle condizioni del pacchetto E delle avvertenze del servizio, con data, IP, browser e privacy", ["condizioni_versione: VERSIONE_CONDIZIONI_PACCHETTI", "condizioni_hash: impronta(testoCanonicoCondizioniPacchetti())", "servizio_condizioni_versione: VERSIONE_CONDIZIONI_PIANO_LAVORO", "servizio_condizioni_hash: impronta(testoCanonicoCondizioniPianoLavoro())", "accettato_il:", "accept_ip: ip", "accept_user_agent:", "privacy_versione:"].every((s) => acq.includes(s)));
  atteso("acquisto: l'account dell'acquisto è il titolare (accountId), mai un dato del modulo", acq.includes("user_id: contesto.accountId") && !/formData\.get\("(userId|accountId|user_id|titolare)/i.test(acq));
  atteso("acquisto: l'email a Stripe è quella dell'account", acq.includes("customer_email: user.email"));
  atteso("acquisto: Stripe in modalità pagamento una tantum, con indirizzo e partita IVA, e i metadata per il webhook", acq.includes('mode: "payment"') && acq.includes('billing_address_collection: "required"') && acq.includes("tax_id_collection: { enabled: true }") && acq.includes('tipo: "omnia_ai_pacchetto"') && acq.includes("acquistoId: acquisto.id") && acq.includes("payment_intent_data: { metadata }"));
  atteso("acquisto: le unità si accreditano solo dal webhook (la pagina di ritorno non le tocca)", /success_url: `\$\{origin\}\/dashboard\/omnia-ai\/servizi\?pacchetto=pagato`/.test(acq) && !/accredita|saldi/.test(senzaCommenti(acq)));
  const ric = corpoFunzione(azioni, "richiediAcquistoPacchetto");
  atteso("richiesta: parte dalla guardia dell'account (titolare o Ufficio Gare) e ammette solo l'Ufficio Gare", ric.includes("await richiediAccountAzione()") && ric.includes('contesto.ruolo !== "ufficio_gare") return { error:'));
  atteso("richiesta: non apre mai un pagamento e non scrive acquisti né saldi", !/stripe|checkout|redirect\(|pacchetti_acquisti|pacchetti_saldi|insert\(/i.test(senzaCommenti(ric)));
  atteso("richiesta: controlla abbonamento, vendita accesa e pacchetto in vendita (o offerta dedicata del cliente) PRIMA di avvisare", ric.indexOf("accessoNegatoPerAccount") !== -1 && ric.indexOf("accessoNegatoPerAccount") < ric.indexOf("avvisaTitolareAcquistoPacchetto(") && ric.indexOf("venditaPacchettiAttiva") !== -1 && ric.indexOf("venditaPacchettiAttiva") < ric.indexOf("avvisaTitolareAcquistoPacchetto(") && ric.indexOf("risolviPacchetto(admin") !== -1 && ric.indexOf("risolviPacchetto(admin") < ric.indexOf("avvisaTitolareAcquistoPacchetto("));
  atteso("richiesta: l'avviso va al titolare dell'account effettivo, da chi ha premuto", ric.includes("titolareId: contesto.accountId") && ric.includes("membroId: contesto.userId") && ric.includes("emailUfficioGare: user.email"));
  atteso("richiesta: un errore dell'avviso non si presenta come successo", ric.includes('if (avviso === "non_riuscito") return { error:') && ric.includes('avviso === "gia_inviato_oggi"'));

  console.log("\n--- Webhook, cessazione, generazione ---");
  const webhook = leggi("src/app/api/webhooks/stripe/route.ts");
  atteso("webhook: il ramo «omnia_ai_pacchetto» registra il pagamento e, se l'accredito non è riuscito, solleva un errore (500: Stripe riprova)", /session\.metadata\?\.tipo === "omnia_ai_pacchetto"\) \{\n\s*const esito = await registraPagamentoPacchetto\(\{ admin: createAdminClient\(\), sessione: session, eventoId \}\);\n\s*if \(esito\.esito === "errore"\) throw new Error/.test(webhook));
  const cessazione = webhook.slice(webhook.indexOf("async function handleOmniaAiSubscriptionDeleted"), webhook.indexOf("async function handleOmniaAiInvoicePaymentFailed"));
  atteso("cessazione: i pacchetti si estinguono insieme ai crediti, solo per l'utente dell'abbonamento terminato", cessazione.includes("estinguiPacchetti(admin, sub.user_id)") && cessazione.indexOf('.from("credits")') < cessazione.indexOf("estinguiPacchetti"));
  const cron = leggi("src/app/api/cron/omnia-ai-purge-cessati/route.ts");
  atteso("controllo giornaliero: stessa estinzione come rete di sicurezza, accanto all'azzeramento dei crediti", cron.includes("await estinguiPacchetti(admin, userId);") && cron.indexOf('update({ balance: 0 })') < cron.indexOf("estinguiPacchetti(admin, userId)"));
  const gara = leggi("src/app/actions/gara-piano-lavoro.ts");
  const genera = corpoFunzione(gara, "generaPianoLavoroGara");
  atteso("generazione: il pacchetto entra nella regola del diritto (saldo e gara già consumata letti dal server)", genera.includes("pacchettoSaldo: diritti.pacchettoSaldo") && genera.includes("pacchettoGaraConsumata: diritti.pacchettoGaraConsumata"));
  atteso("generazione: il consumo avviene dopo la regola, solo per la fonte «pacchetto» con unità da consumare, e PRIMA di generare", genera.indexOf("if (!esito.ok)") < genera.indexOf("consumaUnita(admin") && genera.indexOf('esito.fonte === "pacchetto" && esito.consumaUnita') !== -1 && genera.indexOf("consumaUnita(admin") < genera.indexOf("generaPianoLavoro({"));
  atteso("generazione: senza la conferma esplicita («usaPacchetto») non si consuma nulla", genera.indexOf('formData.get("usaPacchetto") !== "1"') !== -1 && genera.indexOf('formData.get("usaPacchetto") !== "1"') < genera.indexOf("consumaUnita(admin"));
  atteso("generazione: saldo finito o errore del database fermano tutto, senza generare", /consumo === "saldo_insufficiente"\) return/.test(genera) && /consumo === "errore"\) return/.test(genera));
  atteso("generazione: un errore (anche un'eccezione) della generazione riaccredita l'unità appena consumata, e solo quella", genera.includes("try {") && genera.includes("catch (err)") && /if \(!generato\.ok && unitaConsumata\) await riaccreditaUnita\(/.test(genera) && genera.includes('unitaConsumata = consumo === "consumata"'));
  atteso("generazione: i dati sono dell'account effettivo, mai dell'utente loggato", !/\buser\.id\b/.test(genera));
  const acquistoSingolo = corpoFunzione(gara, "acquistaPianoLavoro");
  atteso("acquisto singolo: con un saldo del pacchetto non si fa pagare 75 € (si dice di usare il pacchetto)", acquistoSingolo.includes("pacchettoSaldo: diritti.pacchettoSaldo") && acquistoSingolo.includes('esito.ok && esito.fonte === "pacchetto"') && acquistoSingolo.indexOf('esito.fonte === "pacchetto"') < acquistoSingolo.indexOf("leggiPrezzoPianoLavoro"));
  const paginaGara = leggi("src/app/site-omnia-ai/dashboard/omnia-ai/gare/[id]/page.tsx");
  atteso("pagina della gara: stessi dati del server (saldo e consumo) nella stessa regola, proposta del pacchetto solo a chi può comprare", paginaGara.includes("pacchettoSaldo: dirittiPianoLavoro.pacchettoSaldo") && paginaGara.includes("pacchettoGaraConsumata: dirittiPianoLavoro.pacchettoGaraConsumata") && /proposta: offertaPianoLavoro\.stato === "acquistabile" && \(await pacchettiDisponibili\(adminPianoLavoro\)\) \?/.test(paginaGara));
  const chiamateValuta = [gara, paginaGara].map((s) => (s.match(/valutaDirittoPiano\(\{/g) ?? []).length).reduce((a, b) => a + b, 0);
  const conPacchetto = [gara, paginaGara].map((s) => (s.match(/pacchettoSaldo:/g) ?? []).length).reduce((a, b) => a + b, 0);
  atteso("tutte le chiamate di valutaDirittoPiano nel codice passano il pacchetto (nessuna dimenticata)", chiamateValuta === 3 && conPacchetto === 3, `chiamate ${chiamateValuta}, con pacchetto ${conPacchetto}`);
  const pannello = leggi("src/app/site-omnia-ai/dashboard/omnia-ai/gare/[id]/piano-lavoro-panel.tsx");
  atteso("riquadro della gara: con un'unità da consumare il pulsante lo dice, manda la conferma e chiede conferma", pannello.includes('name="usaPacchetto" value="1"') && pannello.includes("window.confirm(`${TESTI_PACCHETTI.confermaUsoUnita}") && /usa 1 dei tuoi \$\{pacchetto\.saldo\}/.test(pannello));
  atteso("riquadro della gara: la proposta del pacchetto sta accanto all'acquisto singolo e porta alla pagina dei servizi", pannello.includes("pacchetto.proposta") && pannello.includes("/dashboard/omnia-ai/servizi?servizio=piano_lavoro"));
  atteso("acquisto: l'offerta dedicata arriva dall'id (mai da quantità o prezzo del browser), si registra nell'acquisto e nei metadata solo se c'è", acq.includes('String(formData.get("offertaId") ?? "").trim()') && acq.includes("...(pacchetto.offertaId ? { offerta_id: pacchetto.offertaId } : {})") && acq.includes("...(pacchetto.offertaId ? { offertaId: pacchetto.offertaId } : {})") && /unit_amount: pacchetto\.prezzoCentesimi/.test(acq) && !/unit_amount: (mostrato|Number\()/.test(acq));
  atteso("richiesta dell'Ufficio Gare: l'offerta dedicata si rilegge dal database per il cliente e l'avviso porta il suo id", ric.includes('String(formData.get("offertaId") ?? "").trim()') && ric.includes("offertaId: pacchetto.offertaId") && ric.includes("accountId: contesto.accountId"));
  const libOfferte = leggi("src/lib/pacchetti-servizi.ts");
  const corpoOfferta = libOfferte.slice(libOfferte.indexOf("export async function leggiOffertaPerAcquisto"), libOfferte.indexOf("export async function chiudiOffertaAcquistata"));
  atteso("un'offerta si compra solo se è del cliente che compra (condizione sul cliente nella lettura) e ancora acquistabile", /\.eq\("id", offertaId\)\.eq\("user_id", accountId\)/.test(corpoOfferta) && corpoOfferta.includes("offertaAcquistabile(data"));
  atteso("risolviPacchetto: con un'offerta indicata non ricade mai sull'elenco pubblico", /if \(offertaId !== ""\) \{[\s\S]*?return offerta && offerta\.servizio === servizio \? \{[^}]*\} : null;\s*\}/.test(libOfferte));
  atteso("la chiusura dell'offerta è condizionata allo stato «attiva» (un evento rimandato non la riscrive)", /\.update\(\{ stato: "acquistata"[\s\S]*?\}\)\s*\.eq\("id", offertaId\)\s*\.eq\("stato", "attiva"\)/.test(libOfferte));
  atteso("la revoca è condizionata allo stato «attiva» (un'offerta già comprata non si revoca)", /\.update\(\{ stato: "revocata"[\s\S]*?\}\)\s*\.eq\("id", offertaId\)\s*\.eq\("stato", "attiva"\)/.test(libOfferte));
  atteso("la nota interna non arriva mai al cliente: le letture per il cliente non la passano", !/nota/.test(libOfferte.slice(libOfferte.indexOf("export async function leggiOfferteAttive"), libOfferte.indexOf("export async function leggiOffertaPerAcquisto")).replace(/COLONNE_OFFERTA/g, "")) && /export function daRigaOfferta[\s\S]*?\{ id: r\.id, servizio: r\.servizio, quantita: r\.quantita, prezzoCentesimi: r\.prezzo_centesimi, scadeIl: r\.scade_il \}/.test(leggi("src/lib/pacchetti-servizi-calcoli.ts")));
  const mig105 = leggi("supabase/migrations/0105_pacchetti_offerte_dedicate.sql").replace(/--.*$/gm, "");
  atteso("migrazione 0105: tabella delle offerte con la sicurezza a livello di riga attiva e NESSUN permesso ai clienti", mig105.includes("create table if not exists public.omnia_ai_pacchetti_offerte") && mig105.includes("alter table public.omnia_ai_pacchetti_offerte enable row level security") && !/to (authenticated|anon)/.test(mig105) && /grant select, insert, update on public\.omnia_ai_pacchetti_offerte to service_role/.test(mig105) && !/grant [^;]*delete[^;]* on public\.omnia_ai_pacchetti_offerte/.test(mig105));
  atteso("migrazione 0105: stati, quantità e prezzo con i loro limiti; l'acquisto ricorda l'offerta; additiva e idempotente", /stato text not null default 'attiva' check \(stato in \('attiva', 'acquistata', 'revocata'\)\)/.test(mig105) && /quantita integer not null check \(quantita between 1 and 10000\)/.test(mig105) && /prezzo_centesimi integer not null check \(prezzo_centesimi > 0\)/.test(mig105) && /add column if not exists offerta_id uuid references public\.omnia_ai_pacchetti_offerte \(id\) on delete set null/.test(mig105) && !/drop |truncate |delete from /i.test(mig105));
  const compoServizi = leggi("src/components/omnia-ai/servizi-per-le-gare.tsx");
  atteso("la home: l'offerta dedicata ha il suo badge, il collegamento con l'id dell'offerta e, per l'Ufficio Gare, l'id nel modulo che avvisa", compoServizi.includes("TESTI_PACCHETTI.offertaDedicata") && compoServizi.includes("&offerta=${p.offertaId}") && compoServizi.includes("offertaId={p.offertaId}"));
  atteso("la pagina dei servizi apre il modulo dell'offerta indicata e lo manda con il suo id", leggi("src/app/site-omnia-ai/dashboard/omnia-ai/servizi/page.tsx").includes("offertaAperta === p.offertaId") && leggi("src/app/site-omnia-ai/dashboard/omnia-ai/servizi/page.tsx").includes("offertaId={p.offertaId}") && leggi("src/app/site-omnia-ai/dashboard/omnia-ai/servizi/acquisto-pacchetto-form.tsx").includes('name="offertaId" value={offertaId}'));
  const diritti = leggi("src/lib/piano-lavoro-diritti.ts");
  atteso("diritti letti dal server: il pacchetto si legge insieme alle altre fonti", diritti.includes('leggiStatoPacchettoGara(admin, accountId, "piano_lavoro", garaId)') && diritti.includes("pacchettoSaldo: pacchetto.saldo"));

  console.log("\n--- Pagine, home, menu ---");
  const lib = leggi("src/lib/pacchetti-servizi.ts");
  atteso("registrazione del pagamento: l'aggiornamento a «pagata» è condizionato allo stato «in attesa» (due webhook insieme non si sovrappongono)", /\.update\(\{\s*stato: "pagata"[\s\S]*?\.eq\("id", riga\.id\)\s*\.eq\("stato", "in_attesa_pagamento"\)/.test(lib));
  atteso("senza la migrazione 0104 i clienti non vedono pacchetti da comprare: la vendita offerta richiede anche le tabelle (home e pagina dei servizi)", /venditaAttiva: venditaAttiva && disponibile/.test(lib) && /leggiSaldiConStato\(admin, accountId\)/.test(lib));
  atteso("senza la migrazione 0104 né l'acquisto né la richiesta dell'Ufficio Gare partono, e la scheda della gara non propone il pacchetto", (azioni.match(/await pacchettiDisponibili\(admin\)/g) ?? []).length === 2 && /offertaPianoLavoro\.stato === "acquistabile" && \(await pacchettiDisponibili\(adminPianoLavoro\)\)/.test(paginaGara));
  const homePagina = leggi("src/app/site-omnia-ai/dashboard/omnia-ai/page.tsx");
  atteso("home: le schede si leggono sull'account effettivo con la chiave di servizio, solo con l'abbonamento attivo", homePagina.includes("leggiSchedeServizi({ admin: createAdminClient(), accountId, titolare: !ufficioGare, settoriGare })") && /if \(statoAccesso\.stato === "attivo"\) \{\s*const settoriGare/.test(homePagina) && !/\buser\.id\b/.test(homePagina));
  atteso("home: la sezione compare tra l'elenco delle gare e le scorciatoie, per titolare e Ufficio Gare", /<GareRecentiList[^>]*\/>\s*<ServiziPerLeGare schede=\{schedeServizi\} titolare=\{!ufficioGare\} \/>\s*<CosaVuoiFareOggi/.test(homePagina));
  const paginaServizi = leggi("src/app/site-omnia-ai/dashboard/omnia-ai/servizi/page.tsx");
  atteso("pagina «Servizi aggiuntivi»: solo titolare (guardia della pagina), senza leggere la sessione per conto suo", paginaServizi.includes("await richiediTitolarePagina()") && !paginaServizi.includes("auth.getUser"));
  atteso("pagina «Servizi aggiuntivi»: i pacchetti si comprano solo con l'abbonamento attivo, con il ritorno da Stripe detto chiaramente", paginaServizi.includes('statoAccesso.stato === "attivo"') && paginaServizi.includes("TESTI_PACCHETTI.pacchettoPagato") && paginaServizi.includes("TESTI_PACCHETTI.pacchettoAnnullato"));
  const menu = leggi("src/lib/omnia-ai-account-calcoli.ts");
  atteso("menu del titolare: voce «Servizi aggiuntivi»; l'Ufficio Gare non la ha (vede i pacchetti nella home)", /\/servizi`, label: "Servizi aggiuntivi"/.test(menu) && !/VOCI_MENU_UFFICIO_GARE[\s\S]{0,200}servizi/.test(menu.slice(menu.indexOf("export const VOCI_MENU_UFFICIO_GARE"), menu.indexOf("export function vociMenuPer"))));
  atteso("presenza in console: la pagina dei servizi ha la sua etichetta", /servizi: "Servizi aggiuntivi"/.test(leggi("src/lib/omnia-ai-presenza-calcoli.ts")));

  console.log("\n--- Pagamenti e fatture del cliente ---");
  const pacchettoPagato: PacchettoCliente = { id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", servizio: "piano_lavoro", quantita: 5, prezzo_centesimi: 30000, importo_pagato_centesimi: 30000, pagata_il: "2026-11-10T10:00:00Z", livemode: true, stato_fattura: "da_fatturare" };
  const pagamenti = costruisciPagamenti([], [], [], [], [], [pacchettoPagato, { ...pacchettoPagato, id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", pagata_il: null }]);
  uguale("nell'elenco dei pagamenti del cliente compare il pacchetto pagato (non quello in attesa), con l'importo e la fattura «in preparazione»", pagamenti.map((p) => [p.chiave, p.fonte, p.descrizione, p.importoCentesimi, p.fattura.tipo, p.prova]), [[`pacchetto:${pacchettoPagato.id}`, "pacchetto", "Pacchetto di servizi aggiuntivi: 5 piani di lavoro", 30000, "in_preparazione", false]]);
  atteso("la fattura del pacchetto si scarica come le altre: fonte accettata, tabella e cartella dedicate", CHIAVE_PAGAMENTO.test("pacchetto") && TABELLA_PER_FONTE.pacchetto === "omnia_ai_pacchetti_acquisti" && percorsoFatturaPagamento("pacchetto", pacchettoPagato.id) === `omnia-ai/pacchetti/${pacchettoPagato.id}.pdf`);
  const pagine = leggi("src/app/site-omnia-ai/dashboard/omnia-ai/pagamenti/page.tsx");
  atteso("pagina dei pagamenti: legge i pacchetti pagati dell'utente con la sua sessione (solo le colonne concesse), tollerando la migrazione assente", pagine.includes('.from("omnia_ai_pacchetti_acquisti")') && pagine.includes(".eq(\"user_id\", user.id)") && pagine.includes("pacchetti.error ? [] :"));

  console.log("\n--- Email ---");
  const cliente = { nome: "Maria Rossi", email: "maria@pulizie.it" };
  const emailUfficio = emailUfficioPacchettoAcquistato({ prova: false, acquistoId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", cliente, azienda: null, fatturazione: null, servizio: "piano_lavoro", quantita: 5, importoPagatoCentesimi: 30000, pagataIl: adesso, stripePaymentIntentId: "pi_1" });
  atteso("all'ufficio: oggetto con cliente, servizio e quantità; dentro importo, «da fare la fattura» e nessun intervento sul saldo", /Pacchetto acquistato: .*Maria Rossi.*Piano di lavoro, 5 piani di lavoro/.test(emailUfficio.oggetto) && /300,00/.test(testoDi(emailUfficio.html)) && /fattura/.test(testoDi(emailUfficio.html)) && /Non serve nessun intervento sul saldo/.test(testoDi(emailUfficio.html)), emailUfficio.oggetto);
  atteso("all'ufficio: se l'accredito è mancato lo dice in evidenza", /le unità non risultano accreditate/.test(testoDi(emailUficioMancante()) ));
  function emailUficioMancante() {
    return emailUfficioPacchettoAcquistato({ prova: false, acquistoId: "x".repeat(8), cliente, azienda: null, fatturazione: null, servizio: "piano_lavoro", quantita: 5, importoPagatoCentesimi: 30000, pagataIl: adesso, stripePaymentIntentId: null, accreditoMancante: true }).html;
  }
  const emailCliente = emailClientePacchettoAcquistato({ prova: false, servizio: "piano_lavoro", quantita: 5, importoCentesimi: 30000, pagataIl: adesso, linkServizi: "https://omnia-ai.it/dashboard/omnia-ai/servizi" });
  const testoCliente = testoDi(emailCliente.html);
  atteso("al cliente: pacchetto, importo, «non scadono», «le possono usare sia tu sia il tuo Ufficio Gare», «si perdono se l'abbonamento cessa», link ai servizi", /5 piani di lavoro/.test(testoCliente) && /300,00/.test(testoCliente) && /Non scadono/.test(testoCliente) && /sia tu sia il tuo Ufficio Gare/.test(testoCliente) && /si perdono, come per i crediti/.test(testoCliente) && emailCliente.html.includes("https://omnia-ai.it/dashboard/omnia-ai/servizi"));
  atteso("pagamento di prova: oggetto con la dicitura di prova", /prova/i.test(emailClientePacchettoAcquistato({ prova: true, servizio: "piano_lavoro", quantita: 5, importoCentesimi: 30000, pagataIl: adesso, linkServizi: "https://x.it" }).oggetto));
  const avviso = emailAvvisoAcquistoPacchetto({ emailUfficioGare: "gare@pulizie.it", servizio: "piano_lavoro", quantita: 5 });
  atteso("avviso al titolare: chi lo chiede, quale pacchetto, link ai servizi, MAI un prezzo", /gare@pulizie\.it/.test(testoDi(avviso.html)) && /5 piani di lavoro/.test(avviso.oggetto) && avviso.html.includes("/dashboard/omnia-ai/servizi") && !/€|euro|\d+,\d\d/.test(testoDi(avviso.html)) && !/€/.test(avviso.oggetto));
  const avvisoDedicato = emailAvvisoAcquistoPacchetto({ emailUfficioGare: "gare@pulizie.it", servizio: "piano_lavoro", quantita: 10, dedicato: true });
  atteso("avviso per un'offerta dedicata: lo dice (oggetto e testo), dà la quantità e non nomina prezzi", /dedicato a voi/.test(avvisoDedicato.oggetto) && /10 piani di lavoro/.test(avvisoDedicato.oggetto) && /dedicato a voi/.test(testoDi(avvisoDedicato.html)) && !/€|euro|\d+,\d\d/.test(testoDi(avvisoDedicato.html)) && !/dedicato/.test(avviso.oggetto));
  atteso("avviso al titolare: una al giorno per servizio e quantità (la chiave li distingue), la quota resta una in tutto", chiaveAvviso("acquisto_pacchetto", "piano_lavoro:5") === "piano_lavoro:5" && chiaveAvviso("acquisto_pacchetto", "piano_lavoro:10") !== chiaveAvviso("acquisto_pacchetto", "piano_lavoro:5") && chiaveAvviso("quota_esaurita", "x") === "" && chiaveAvviso("revisione_richiesta", "g1") === "g1");
  const avvisi = leggi("src/lib/omnia-ai-ufficio-gare-avvisi.ts");
  atteso("avvisi: il pacchetto usa lo stesso meccanismo (riga unica del giorno nel database), con una chiave per ogni pacchetto dell'elenco e per ogni offerta dedicata", /tipo: "acquisto_pacchetto",\n\s*\/\/[^\n]*\n\s*chiave: chiaveAvviso\("acquisto_pacchetto", offertaId \? `offerta:\$\{offertaId\}` : `\$\{servizio\}:\$\{quantita\}`\)/.test(avvisi));

  // ═════ 5. la migrazione come testo ═════
  console.log("\n--- Migrazione 0104 (testo) ---");
  const mig = leggi("supabase/migrations/0104_pacchetti_servizi.sql");
  const migSenza = senzaCommenti(mig);
  atteso("quattro tabelle, tutte con la sicurezza a livello di riga attiva", ["omnia_ai_pacchetti_acquisti", "omnia_ai_pacchetti_saldi", "omnia_ai_pacchetti_consumi", "omnia_ai_pacchetti_movimenti"].every((t) => migSenza.includes(`create table if not exists public.${t}`) && migSenza.includes(`alter table public.${t} enable row level security`)));
  atteso("nessun permesso di scrittura ai clienti: i grant a authenticated sono solo la lettura di alcune colonne degli acquisti", [...migSenza.matchAll(/grant [^;]* to authenticated/g)].length === 1 && /grant select \(\s*id, user_id, servizio, quantita, prezzo_centesimi, stato, pagata_il, importo_pagato_centesimi, livemode, creata_il,\s*stato_fattura, numero_fattura, data_fattura, fattura_file_path\s*\) on public\.omnia_ai_pacchetti_acquisti to authenticated/.test(migSenza));
  atteso("un acquisto non si cancella (nessun delete al server) e resta se l'utente viene cancellato", !/grant [^;]*delete[^;]* on public\.omnia_ai_pacchetti_acquisti/.test(migSenza) && /user_id uuid references public\.users \(id\) on delete set null/.test(migSenza));
  atteso("il cliente legge solo i propri acquisti (policy «solo le mie righe»)", /for select using \(user_id = auth\.uid\(\)\)/.test(migSenza));
  atteso("indice unico: una sola unità per gara e servizio", /create unique index if not exists omnia_ai_pacchetti_consumi_gara_unico\s+on public\.omnia_ai_pacchetti_consumi \(gara_id, servizio\)\s+where gara_id is not null/.test(migSenza));
  atteso("le cinque funzioni sono tolte a tutti e date solo al server", ["accredita(uuid)", "consuma(uuid, text, uuid, text)", "riaccredita(uuid, text, uuid, text)", "rettifica(uuid, text, integer, text, text)", "estingui(uuid)"].every((f) => migSenza.includes(`revoke all on function public.omnia_ai_pacchetto_${f} from public, anon, authenticated`) && migSenza.includes(`grant execute on function public.omnia_ai_pacchetto_${f} to service_role`)));
  atteso("il saldo non scende mai sotto zero (vincolo del database)", /saldo integer not null default 0 check \(saldo >= 0\)/.test(migSenza));
  const tipiMigrazione = [...(migSenza.match(/omnia_ai_email_eventi_tipo_check check \(\s*tipo in \(([\s\S]*?)\)\s*\)/)?.[1] ?? "").matchAll(/'(\w+)'/g)].map((m) => m[1]).sort();
  const tipiCodice = [...(senzaCommenti(leggi("src/lib/omnia-ai-email-eventi.ts")).match(/export type TipoEmailEvento =([\s\S]*?);/)?.[1] ?? "").matchAll(/"(\w+)"/g)].map((m) => m[1]).sort();
  uguale("i tipi di email consentiti dalla migrazione sono gli stessi del codice (nessuno dimenticato)", tipiMigrazione, tipiCodice);
  atteso("gli avvisi dell'Ufficio Gare ammettono il nuovo tipo: lo stesso elenco del codice", /check \(tipo in \('quota_esaurita', 'revisione_richiesta', 'acquisto_pacchetto'\)\)/.test(migSenza) && /export type TipoAvvisoTitolare = "quota_esaurita" \| "revisione_richiesta" \| "acquisto_pacchetto"/.test(leggi("src/lib/omnia-ai-account-calcoli.ts")));
  atteso("la migrazione non tocca le tabelle dei crediti né degli acquisti del piano di lavoro singolo", !/(credits|omnia_ai_credit_purchases|omnia_ai_piani_lavoro_acquisti)/.test(migSenza));
  atteso("il codice non scrive altro che attraverso le funzioni SQL: nessun update diretto dei saldi", !/from\("omnia_ai_pacchetti_saldi"\)\s*\.(update|insert|upsert)/.test(senzaCommenti(leggi("src/lib/pacchetti-servizi.ts"))) && !/from\("omnia_ai_pacchetti_(saldi|consumi|movimenti)"\)\s*\.(update|insert|upsert|delete)/.test(senzaCommenti(azioni + leggi("src/lib/pacchetti-servizi.ts"))));

  // ═════ 6. condizioni ═════
  console.log("\n--- Condizioni del pacchetto ---");
  atteso("le clausole sono quattro, numerate da 1; la 3 (estinzione alla cessazione) e la 4 (pagamento e rimborsi) sono da approvare specificamente", CLAUSOLE_PACCHETTI.map((c) => c.numero).join() === "1,2,3,4" && CLAUSOLE_SPECIFICHE_PACCHETTI.map((c) => c.numero).join() === "3,4");
  atteso("dicono le cose chieste: non scadono, si esauriscono, anche in più mesi, perse alla cessazione come i crediti, una sola unità per gara, il titolare compra", /non hanno una scadenza/.test(CLAUSOLE_PACCHETTI[1].testo) && /si esauriscono man mano/.test(CLAUSOLE_PACCHETTI[1].testo) && /anche in più mesi/.test(CLAUSOLE_PACCHETTI[1].testo) && /si estinguono/.test(CLAUSOLE_PACCHETTI[2].testo) && /come avviene per i crediti aggiuntivi/.test(CLAUSOLE_PACCHETTI[2].testo) && /Una gara consuma una sola unità/.test(CLAUSOLE_PACCHETTI[1].testo) && /soltanto il titolare/.test(CLAUSOLE_PACCHETTI[1].testo));
  const hash = createHash("sha256").update(testoCanonicoCondizioniPacchetti()).digest("hex");
  atteso("l'impronta del testo è stabile e cambia se cambia una parola", hash.length === 64 && hash === createHash("sha256").update(testoCanonicoCondizioniPacchetti()).digest("hex") && hash !== createHash("sha256").update(testoCanonicoCondizioniPacchetti().replace("scadenza", "scadenz4")).digest("hex") && testoCanonicoCondizioniPacchetti().startsWith(`versione ${VERSIONE_CONDIZIONI_PACCHETTI}`));
  atteso("le condizioni sono una BOZZA (nessuna approvazione del legale registrata) e la console lo dice", APPROVAZIONE_LEGALE_PACCHETTI === null && /BOZZA/.test(leggi("src/lib/pacchetti-servizi-calcoli.ts")));
  atteso("nei testi nessuna promessa sbagliata: non si parla di rimborso per le unità non usate se non per escluderlo, e non c'è scadenza temporale", !/scadono entro|valide per \d+ mesi|rimborsabil[ei] (in|per le) unità/i.test(testoCanonicoCondizioniPacchetti()));

  // ═════ 7. le schede disegnate ═════
  console.log("\n--- Le schede nella home ---");
  const disegna = (s: SchedaServizio[], titolare: boolean) => renderToStaticMarkup(createElement(ServiziPerLeGare, { schede: s, titolare }));
  const schedaPianoLavoro = schede({ saldi: { piano_lavoro: 3 } });
  const htmlTitolare = disegna(schedaPianoLavoro, true);
  const testoTitolare = testoDi(htmlTitolare);
  atteso("titolare: titolo della sezione, saldo, pacchetto con prezzo per unità e risparmio, «Acquista» come collegamento alla pagina dove si paga", /Servizi per le tue gare/.test(testoTitolare) && /Ti restano 3 piani di lavoro/.test(testoTitolare) && /5 piani di lavoro — 300 €/.test(testoTitolare) && /60 € l'uno/.test(testoTitolare) && /risparmi 75 €/.test(testoTitolare) && htmlTitolare.includes('href="/dashboard/omnia-ai/servizi?servizio=piano_lavoro&amp;quantita=5"'), testoTitolare.slice(0, 400));
  atteso("titolare: dice che non scadono e che si perdono se l'abbonamento cessa", /Non scadono/.test(testoTitolare) && /Si perdono se l'abbonamento cessa/.test(testoTitolare));
  atteso("titolare: nessun modulo di avviso (compra lui)", !htmlTitolare.includes("<form"));
  const htmlUfficio = disegna(schede({ titolare: false, saldi: { piano_lavoro: 3 } }), false);
  const testoUfficio = testoDi(htmlUfficio);
  atteso("Ufficio Gare: vede saldo e pacchetti, «Acquista» è un pulsante che avvisa (nessun collegamento alla pagina dei pagamenti), con la spiegazione", /Ti restano 3 piani di lavoro/.test(testoUfficio) && htmlUfficio.includes("<form") && htmlUfficio.includes('name="servizio" value="piano_lavoro"') && htmlUfficio.includes('name="quantita" value="5"') && !htmlUfficio.includes("/dashboard/omnia-ai/servizi") && /gli arriva una email/.test(testoUfficio), testoUfficio.slice(0, 300));
  atteso("Ufficio Gare: nessun accenno ad abbonamento, crediti o pagamenti", !/abbonamento\b.*(vai|gestisci)|pagamenti e fatture/i.test(testoUfficio));
  const htmlDue = disegna(schede({ settoriGare: ["pulizie", "ristorazione_collettiva"] }), true);
  const testoDue = testoDi(htmlDue);
  atteso("pulizie E ristorazione: compaiono entrambi, OMNIA FOOD MENU «Sta arrivando» e senza acquisto", /Piano di lavoro/.test(testoDue) && /OMNIA FOOD MENU/.test(testoDue) && /Sta arrivando/.test(testoDue) && !/FOOD MENU[^]*Acquista/.test(testoDue.slice(testoDue.indexOf("OMNIA FOOD MENU"))), testoDue.slice(0, 300));
  atteso("nessuna scheda: la sezione non compare affatto", disegna([], true) === "");
  const htmlNuovo = testoDi(disegna(schede(), true));
  atteso("chi non ha mai avuto unità NON vede «Esaurito»: vede «Non hai pacchetti attivi», senza badge", !/Esaurito/.test(htmlNuovo) && /Non hai pacchetti attivi/.test(htmlNuovo) && !/Nessun piano di lavoro residuo/.test(htmlNuovo));
  const htmlFinito = testoDi(disegna(schede({ saldi: { piano_lavoro: 0 } }), true));
  atteso("chi ha avuto delle unità e le ha finite vede «Esaurito» e «Nessun piano di lavoro residuo»", /Esaurito/.test(htmlFinito) && /Nessun piano di lavoro residuo/.test(htmlFinito) && !/Non hai pacchetti attivi/.test(htmlFinito));
  atteso("il saldo al singolare: «1 residuo»", /1 residuo\b/.test(testoDi(disegna(schede({ saldi: { piano_lavoro: 1 } }), true))));

  const htmlOfferta = disegna(schede({ offerte: offerteCliente, concessioni: { piano_lavoro: ["Fino a 20 gare, fino al 31/12/2026 — usate 1 su 20"] } }), true);
  const testoOfferta = testoDi(htmlOfferta);
  atteso("titolare: l'offerta dedicata ha il badge, il prezzo, il prezzo per unità, la scadenza e porta alla pagina con il suo id", /Offerta dedicata a te/.test(testoOfferta) && /10 piani di lavoro — 450 €/.test(testoOfferta) && /45 € l'uno/.test(testoOfferta) && /valida fino al 31\/12\/2026/.test(testoOfferta) && htmlOfferta.includes("servizio=piano_lavoro&amp;offerta=of1"), testoOfferta.slice(0, 500));
  atteso("titolare: la concessione gratuita è scritta chiara («Concessione gratuita: Fino a 20 gare…, usate 1 su 20») con la nota che non consuma il pacchetto, e nessun «Esaurito»", /Concessione gratuita: Fino a 20 gare, fino al 31\/12\/2026 — usate 1 su 20/.test(testoOfferta) && /non consuma il pacchetto/.test(testoOfferta) && !/Esaurito/.test(testoOfferta));
  const htmlOffertaUfficio = disegna(schede({ titolare: false, offerte: offerteCliente }), false);
  atteso("Ufficio Gare: l'offerta dedicata ha «Acquista» che avvisa (modulo con l'id dell'offerta), senza collegamenti alla pagina dei pagamenti", htmlOffertaUfficio.includes('name="offertaId" value="of1"') && htmlOffertaUfficio.includes("<form") && !htmlOffertaUfficio.includes("/dashboard/omnia-ai/servizi"));
  atteso("un pacchetto dell'elenco non porta nessun id d'offerta nel suo modulo", !disegna(schede({ titolare: false }), false).includes('name="offertaId"'));

  console.log("\n--- Testi ---");
  atteso("l'uso di un'unità si dice chiaro: quante ne restano dopo, e che è l'ultima", /te ne resteranno 2/.test(TESTI_PACCHETTI.usaUnitaNota(3)) && /ultimo piano di lavoro/.test(TESTI_PACCHETTI.usaUnitaNota(1)));
  atteso("i messaggi all'Ufficio Gare non parlano di prezzi e rimandano all'amministratore", /amministratore/.test(TESTI_PACCHETTI.soloTitolareNota) && !/€|\d+ euro/.test(TESTI_PACCHETTI.soloTitolareNota + TESTI_PACCHETTI.avvisoInviato + TESTI_PACCHETTI.avvisoGiaInviato));

  if (fallimenti.length > 0) {
    console.log(`\n${fallimenti.length} controlli falliti:\n- ${fallimenti.join("\n- ")}`);
    process.exit(1);
  }
  console.log("\nTutti i controlli sono andati a buon fine.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
