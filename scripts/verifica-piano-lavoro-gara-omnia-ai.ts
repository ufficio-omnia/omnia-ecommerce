// Autotest del «piano di lavoro» DENTRO LA GARA di OMNIA AI (riquadro, generazione, download, costi), senza rete e con un database, uno
// storage e un modello FINTI:
//   - chi può generare e quando: analisi finita, gara usabile, una generazione per gara, la seconda solo con una proroga, un errore non
//     conta, una generazione interrotta si può riprendere, l'apertura di sviluppo mai in produzione;
//   - la generazione lato server: documenti della gara (e solo i suoi) in ordine cronologico, Excel nello storage sotto il prefisso della
//     gara, riga con riepilogo e dati, costi registrati per ogni richiesta, errori che lasciano la riga in «errore» senza consumare la versione,
//     mai due generazioni insieme;
//   - il link di download e la lettura dei piani (tollerante alla migrazione mancante);
//   - le regole scritte nel codice: migrazione 0096 (permessi, nessuna scrittura dal cliente), azioni con la guardia dell'account, riquadro
//     con le avvertenze obbligatorie (dimensionamento di partenza, non un preventivo, prezzi da sostituire).
// Gratuito: gira nel livello 1, quindi in prebuild.
import fs from "fs";
import path from "path";
import type { SupabaseClient } from "@supabase/supabase-js";
import type Anthropic from "@anthropic-ai/sdk";
import {
  MESSAGGI_PIANO,
  MINUTI_GENERAZIONE_INTERROTTA,
  aperturaSviluppoAttiva,
  costruisciRiepilogo,
  erroreBreve,
  nomeFilePiano,
  percorsoFilePiano,
  riepilogoValido,
  valutaDirittoPiano,
  type ContestoDirittoPiano,
} from "../src/lib/piano-lavoro-gara-calcoli";
import { COSTO_STIMATO_RICERCA_WEB, generaPianoLavoro, leggiPianiGara, urlScaricoPiano, type DipendenzePiano } from "../src/lib/piano-lavoro-gara";
import { normalizzaPianoLavoro } from "../src/lib/piano-lavoro-dati";
import { RIQUADRO_PIANO_PARTI } from "../src/lib/piano-lavoro-testi";
import { costruisciExcelPianoLavoro } from "../src/lib/piano-lavoro-excel";
import type { estraiPianoLavoro, UsoModello } from "../src/lib/piano-lavoro-estrazione";

const fallimenti: string[] = [];
function atteso(nome: string, ok: boolean, dettaglio = "") {
  console.log(`${ok ? "ok    " : "FALLITO"} ${nome}${ok ? "" : ` — ${dettaglio}`}`);
  if (!ok) fallimenti.push(nome);
}
function uguale<T>(nome: string, ottenuto: T, previsto: T) {
  atteso(nome, JSON.stringify(ottenuto) === JSON.stringify(previsto), `ottenuto ${JSON.stringify(ottenuto)}, previsto ${JSON.stringify(previsto)}`);
}
const leggi = (relativo: string) => fs.readFileSync(path.join(__dirname, "..", relativo), "utf-8").replace(/\r\n/g, "\n");

// ───── database e storage finti ─────
type Riga = Record<string, unknown>;
type Errore = { code?: string; message: string };

class Interrogazione {
  private filtri: [string, unknown][] = [];
  private operazione: "select" | "insert" | "update" = "select";
  private dati: Riga | null = null;
  private singolo = false;
  constructor(
    private nome: string,
    private db: Record<string, Riga[]>,
    private guasti: { tabelle?: string[]; scrittura?: string[] },
  ) {}
  select() {
    return this;
  }
  insert(d: Riga) {
    this.operazione = "insert";
    this.dati = d;
    return this;
  }
  update(d: Riga) {
    this.operazione = "update";
    this.dati = d;
    return this;
  }
  eq(c: string, v: unknown) {
    this.filtri.push([c, v]);
    return this;
  }
  order() {
    return this;
  }
  returns() {
    return this;
  }
  maybeSingle() {
    this.singolo = true;
    return this;
  }
  then<T>(res: (v: { data: unknown; error: Errore | null }) => T, rej?: (e: unknown) => T) {
    return Promise.resolve(this.esegui()).then(res, rej);
  }
  private esegui(): { data: unknown; error: Errore | null } {
    if (this.guasti.tabelle?.includes(this.nome)) return { data: null, error: { code: "42P01", message: `relation "${this.nome}" does not exist` } };
    const tabella = (this.db[this.nome] ??= []);
    const corrisponde = (r: Riga) => this.filtri.every(([c, v]) => r[c] === v);
    if (this.operazione === "insert") {
      if (this.guasti.scrittura?.includes("insert")) return { data: null, error: { code: "XX000", message: "scrittura rifiutata" } };
      if (this.nome === "gara_piani_lavoro" && tabella.some((r) => r.gara_id === this.dati!.gara_id && r.versione === this.dati!.versione)) return { data: null, error: { code: "23505", message: "duplicate key" } };
      const riga: Riga = { id: `00000000-0000-4000-8000-${String(tabella.length + 1).padStart(12, "0")}`, errore: null, completata_il: null, file_path: null, ...this.dati };
      tabella.push(riga);
      return { data: this.singolo ? { id: riga.id } : [riga], error: null };
    }
    const trovate = tabella.filter(corrisponde);
    if (this.operazione === "update") {
      if (this.guasti.scrittura?.includes("update-pronto") && (this.dati as Riga).stato === "pronto") return { data: null, error: { code: "XX000", message: "aggiornamento rifiutato" } };
      for (const r of trovate) Object.assign(r, this.dati);
    }
    return { data: this.singolo ? (trovate[0] ?? null) : trovate, error: null };
  }
}

type Storage = Map<string, Buffer>;
function fintoAdmin(db: Record<string, Riga[]>, storage: Storage, guasti: { tabelle?: string[]; scrittura?: string[]; noDownload?: string[]; noUpload?: boolean } = {}) {
  const scaricati: string[] = [];
  const client = {
    from: (nome: string) => new Interrogazione(nome, db, guasti),
    storage: {
      from: () => ({
        download: async (p: string) => {
          scaricati.push(p);
          if (guasti.noDownload?.includes(p) || !storage.has(p)) return { data: null, error: { message: "non trovato" } };
          const buf = storage.get(p)!;
          return { data: { arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) }, error: null };
        },
        upload: async (p: string, buf: Buffer) => {
          if (guasti.noUpload) return { data: null, error: { message: "spazio esaurito" } };
          storage.set(p, buf);
          return { data: { path: p }, error: null };
        },
        createSignedUrl: async (p: string, _s: number, o: { download: string }) => (storage.has(p) ? { data: { signedUrl: `https://storage.test/${encodeURIComponent(p)}?download=${encodeURIComponent(o.download)}` }, error: null } : { data: null, error: { message: "assente" } }),
      }),
    },
  } as unknown as SupabaseClient;
  return { client, scaricati };
}

const GARA = "11111111-1111-4111-8111-111111111111";
const ALTRA_GARA = "22222222-2222-4222-8222-222222222222";
const ACCOUNT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ALTRO_ACCOUNT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ADESSO = new Date("2026-11-03T12:00:00Z");

function dbBase(): Record<string, Riga[]> {
  return {
    gare: [{ id: GARA, user_id: ACCOUNT, titolo: "Pulizie impianti sportivi: lotto 1/2" }, { id: ALTRA_GARA, user_id: ALTRO_ACCOUNT, titolo: "Altra gara" }],
    gara_documenti: [
      { id: "d2", gara_id: GARA, nome_file: "Capitolato.pdf", file_path: `${GARA}/cap.pdf`, created_at: "2026-10-02T10:00:00Z" },
      { id: "d1", gara_id: GARA, nome_file: "Bando.pdf", file_path: `${GARA}/bando.pdf`, created_at: "2026-10-01T10:00:00Z" },
      { id: "d3", gara_id: GARA, nome_file: "Rettifica.pdf", file_path: `${GARA}/rett.pdf`, created_at: "2026-10-03T10:00:00Z" },
      { id: "dx", gara_id: ALTRA_GARA, nome_file: "Altra.pdf", file_path: `${ALTRA_GARA}/altra.pdf`, created_at: "2026-10-01T10:00:00Z" },
    ],
    gara_piani_lavoro: [],
  };
}
const storageBase = (): Storage =>
  new Map([
    [`${GARA}/cap.pdf`, Buffer.from("capitolato")],
    [`${GARA}/bando.pdf`, Buffer.from("bando")],
    [`${GARA}/rett.pdf`, Buffer.from("rettifica")],
    [`${ALTRA_GARA}/altra.pdf`, Buffer.from("altra")],
  ]);

async function main() {
  const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "test", "fixtures", "piano-lavoro-milanosport.json"), "utf-8")) as { dati: unknown };
  const datiProva = () => normalizzaPianoLavoro(fixture.dati).dati;

  // ═════ 1. chi può generare ═════
  {
    const base: ContestoDirittoPiano = { analisiCompleta: true, garaUsabile: true, piani: [], prorogaStato: null, concessioneId: null, abbonamentoCopreGara: false, provaGratuita: false, acquistoPagato: false, aperturaSviluppo: true, adesso: ADESSO };
    const piano = (versione: number, stato: "in_corso" | "pronto" | "errore", minutiFa = 0) => ({ versione, stato, creata_il: new Date(ADESSO.getTime() - minutiFa * 60_000).toISOString() });
    const motivo = (c: Partial<ContestoDirittoPiano>) => {
      const e = valutaDirittoPiano({ ...base, ...c });
      return e.ok ? `ok v${e.versione}${e.riprova ? " riprova" : ""}` : e.motivo;
    };
    uguale("gara analizzata e usabile, nessun piano: si può generare la versione 1", motivo({}), "ok v1");
    uguale("analisi dei documenti non finita: nessuna generazione, e il motivo viene prima di ogni altro", motivo({ analisiCompleta: false, garaUsabile: false, aperturaSviluppo: false }), "analisi_non_completata");
    const bloccata = valutaDirittoPiano({ ...base, garaUsabile: false, messaggioGaraBloccata: "Gare finite." });
    atteso("gara bloccata (quota esaurita): nessuna generazione, col messaggio della gara", !bloccata.ok && bloccata.motivo === "gara_bloccata" && bloccata.messaggio === "Gare finite.");
    uguale("una generazione in corso da pochi minuti: «già in corso»", motivo({ piani: [piano(1, "in_corso", 3)] }), "gia_in_corso");
    uguale(`una generazione ferma da più di ${MINUTI_GENERAZIONE_INTERROTTA} minuti si considera interrotta: si riprova la stessa versione`, motivo({ piani: [piano(1, "in_corso", MINUTI_GENERAZIONE_INTERROTTA + 1)] }), "ok v1 riprova");
    uguale("un errore non conta: stessa versione, da riprovare", motivo({ piani: [piano(1, "errore", 60)] }), "ok v1 riprova");
    uguale("piano 1 pronto e nessuna proroga: nessuna seconda generazione", motivo({ piani: [piano(1, "pronto", 600)] }), "versioni_esaurite");
    uguale("piano 1 pronto e proroga con nuova data: si può generare la versione 2", motivo({ piani: [piano(1, "pronto", 600)], prorogaStato: "con_nuova_data" }), "ok v2");
    uguale("piano 1 pronto e proroga senza nuova data: si può generare la versione 2", motivo({ piani: [piano(1, "pronto", 600)], prorogaStato: "senza_nuova_data" }), "ok v2");
    uguale("piano 1 pronto e «nessuna» proroga: no", motivo({ piani: [piano(1, "pronto", 600)], prorogaStato: "nessuna" }), "versioni_esaurite");
    uguale("due piani pronti: mai una terza, nemmeno con la proroga", motivo({ piani: [piano(1, "pronto", 900), piano(2, "pronto", 600)], prorogaStato: "con_nuova_data" }), "versioni_esaurite");
    uguale("versione 2 fallita: si riprova la 2 (la 1 resta pronta)", motivo({ piani: [piano(1, "pronto", 900), piano(2, "errore", 600)], prorogaStato: "con_nuova_data" }), "ok v2 riprova");
    uguale("senza il diritto (né acquisto né apertura di sviluppo) il piano non è attivo", motivo({ aperturaSviluppo: false }), "non_attivo");
    uguale("con l'acquisto pagato della gara si genera anche senza l'apertura di sviluppo, e la fonte registrata è «acquisto»", [motivo({ aperturaSviluppo: false, acquistoPagato: true }), (() => { const e = valutaDirittoPiano({ ...base, aperturaSviluppo: true, acquistoPagato: true }); return e.ok ? e.fonte : null; })(), (() => { const e = valutaDirittoPiano({ ...base, aperturaSviluppo: true }); return e.ok ? e.fonte : null; })()], ["ok v1", "acquisto", "sviluppo"]);
    uguale("l'acquisto non scavalca le altre regole: analisi non finita, gara bloccata, già in corso, versioni esaurite valgono anche per chi ha pagato", [
      motivo({ aperturaSviluppo: false, acquistoPagato: true, analisiCompleta: false }),
      motivo({ aperturaSviluppo: false, acquistoPagato: true, garaUsabile: false }),
      motivo({ aperturaSviluppo: false, acquistoPagato: true, piani: [piano(1, "in_corso", 3)] }),
      motivo({ aperturaSviluppo: false, acquistoPagato: true, piani: [piano(1, "pronto", 600)] }),
      motivo({ aperturaSviluppo: false, acquistoPagato: true, piani: [piano(1, "pronto", 600)], prorogaStato: "con_nuova_data" }),
    ], ["analisi_non_completata", "gara_bloccata", "gia_in_corso", "versioni_esaurite", "ok v2"]);
    atteso("i messaggi dicono cosa fare (analizza i documenti, attendi, proroga)", /Estrai dati con AI/.test(MESSAGGI_PIANO.analisiNonCompletata) && /alcuni minuti/.test(MESSAGGI_PIANO.inCorso) && /proroga dei termini/.test(MESSAGGI_PIANO.versioniEsaurite));

    uguale(
      "l'apertura di sviluppo vale solo con la variabile a «1» e MAI in produzione né su Vercel",
      [{ OMNIA_AI_PIANO_LAVORO_APERTO: "1" }, {}, { OMNIA_AI_PIANO_LAVORO_APERTO: "0" }, { OMNIA_AI_PIANO_LAVORO_APERTO: "1", NODE_ENV: "production" }, { OMNIA_AI_PIANO_LAVORO_APERTO: "1", VERCEL: "1" }, { OMNIA_AI_PIANO_LAVORO_APERTO: "1", NODE_ENV: "development" }].map(aperturaSviluppoAttiva),
      [true, false, false, false, false, true],
    );
  }

  // ═════ 2. riepilogo, nomi, errori ═════
  {
    const dati = datiProva();
    const r = costruisciRiepilogo(dati);
    atteso("riepilogo: monte ore, addetti, sedi, tipologie e conteggi dei dati dal piano (Milanosport: 28 sedi, 12 tipologie, 15 macchinari)", r.sedi === 28 && r.tipologie === 12 && r.macchinariVoci === 15 && r.oreTotali > 50000 && r.fte > 40 && r.datiDaDocumenti > 0 && r.daVerificare.length > 0 && r.daVerificare.length <= 12, JSON.stringify(r).slice(0, 300));
    atteso("riepilogo: lo scostamento dal monte ore dichiarato è un numero (il bando lo dichiara) e l'esito è una frase", typeof r.scostamentoPct === "number" && r.esito.length > 10);
    uguale("un riepilogo letto dal database si riconosce (anche passato da JSON); uno malformato no", [riepilogoValido(JSON.parse(JSON.stringify(r)))?.sedi, riepilogoValido({ oreTotali: "tanto" }), riepilogoValido(null), riepilogoValido(42)], [28, null, null, null]);
    uguale("nome del file: senza caratteri vietati, con la versione, lunghezza limitata", [nomeFilePiano('Gara: "Pulizie" <lotto 1/2>?', 2), nomeFilePiano("", 1), nomeFilePiano("x".repeat(300), 1).length <= 120], ["Piano di lavoro - Gara Pulizie lotto 1 2 - v2.xlsx", "Piano di lavoro - gara - v1.xlsx", true]);
    uguale("percorso del file: sotto il prefisso della gara (così si cancella insieme alla gara)", percorsoFilePiano(GARA, 1), `${GARA}/piano-lavoro-v1.xlsx`);
    const e = erroreBreve(new Error(`Errore con chiave sk-ant-abcdefgh12345678 e token eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9abcdef\n${"x".repeat(500)}`));
    atteso("errore conservato: breve e senza chiavi né token", e.length <= 300 && !/sk-ant-abcdefgh/.test(e) && !/eyJhbGciOiJIUz/.test(e) && /\[chiave\]/.test(e) && /\[token\]/.test(e), e);
  }

  // ═════ 3. generazione con dipendenze finte ═════
  const modelloFinto = {} as Anthropic;
  const costruisci = (db: Record<string, Riga[]>, storage: Storage, opzioni: { guasti?: Parameters<typeof fintoAdmin>[2]; usi?: UsoModello[]; estrai?: DipendenzePiano["estrai"] } = {}) => {
    const admin = fintoAdmin(db, storage, opzioni.guasti);
    const costiRegistrati: Parameters<DipendenzePiano["registraCosto"]>[0][] = [];
    const lettiDallEstrazione: string[][] = [];
    const estrai = (opzioni.estrai ??
      (async (documenti, opz) => {
        lettiDallEstrazione.push(documenti.map((d) => d.nome));
        for (const u of opzioni.usi ?? [{ operazione: "piano_lavoro_estrazione", model: "claude-sonnet-5", inputTokens: 300000, outputTokens: 9000, cacheCreationTokens: 0, cacheReadTokens: 0 }, { operazione: "piano_lavoro_prezzo_web", model: "claude-sonnet-5", inputTokens: 2000, outputTokens: 300, cacheCreationTokens: 0, cacheReadTokens: 0, ricercheWeb: 3 }]) await opz.registraUso?.(u);
        return { dati: datiProva() } as unknown as Awaited<ReturnType<typeof estraiPianoLavoro>>;
      })) as DipendenzePiano["estrai"];
    const deps: DipendenzePiano = {
      admin: admin.client,
      anthropic: modelloFinto,
      registraCosto: async (p) => void costiRegistrati.push(p),
      estrai,
      costruisciExcel: costruisciExcelPianoLavoro,
      adesso: () => ADESSO,
    };
    return { deps, costiRegistrati, lettiDallEstrazione, scaricati: admin.scaricati };
  };

  {
    const db = dbBase();
    const storage = storageBase();
    const k = costruisci(db, storage, { guasti: { noDownload: [`${GARA}/rett.pdf`] } });
    const esito = await generaPianoLavoro({ garaId: GARA, accountId: ACCOUNT, versione: 1, fonte: "sviluppo" }, k.deps);
    const riga = db.gara_piani_lavoro[0] as Riga;
    atteso("generazione riuscita: esito ok, una sola riga «pronto» con file, nome, dimensione, riepilogo e dati", esito.ok && db.gara_piani_lavoro.length === 1 && riga.stato === "pronto" && riga.versione === 1 && riga.file_path === `${GARA}/piano-lavoro-v1.xlsx` && riga.file_nome === "Piano di lavoro - Pulizie impianti sportivi lotto 1 2 - v1.xlsx" && typeof riga.dimensione_byte === "number" && (riga.dimensione_byte as number) > 5000 && riga.completata_il === ADESSO.toISOString() && riga.errore === null && riga.user_id === ACCOUNT && riga.gara_id === GARA && riga.fonte_diritto === "sviluppo" && riepilogoValido(riga.riepilogo) !== null && typeof riga.dati === "object", JSON.stringify({ esito, riga: { ...riga, dati: "…" } }).slice(0, 400));
    const file = storage.get(`${GARA}/piano-lavoro-v1.xlsx`);
    atteso("l'Excel è nello storage sotto il prefisso della gara ed è un vero file xlsx", !!file && file.subarray(0, 2).toString() === "PK" && file.length === riga.dimensione_byte);
    uguale("i documenti letti sono SOLO quelli della gara, in ordine di caricamento; quello non scaricabile va in copertina come «non letto»", [k.scaricati, k.lettiDallEstrazione[0], (riga.dati as { documenti: { nonLetti: { nome: string; motivo: string }[] } }).documenti.nonLetti.some((x) => x.nome === "Rettifica.pdf" && /non scaricabile/.test(x.motivo))], [[`${GARA}/bando.pdf`, `${GARA}/cap.pdf`, `${GARA}/rett.pdf`], ["Bando.pdf", "Capitolato.pdf"], true]);
    uguale("i costi sono registrati per ogni richiesta, sull'azienda e sulla gara", k.costiRegistrati.map((c) => [c.userId, c.garaId, c.operazione, c.inputTokens, c.outputTokens]), [[ACCOUNT, GARA, "piano_lavoro_estrazione", 300000, 9000], [ACCOUNT, GARA, "piano_lavoro_prezzo_web", 2000, 300]]);
    // 300.000 in × 3 $/M + 9.000 out × 15 $/M = 1,035; 2.000 in + 300 out = 0,0105; 3 ricerche web × 0,01
    atteso("il costo stimato della riga comprende le richieste, e le ricerche web a parte", Math.abs((riga.costo_stimato as number) - (1.035 + 0.0105 + 3 * COSTO_STIMATO_RICERCA_WEB)) < 1e-3 && riga.richieste_modello === 2 && riga.ricerche_web === 3, String(riga.costo_stimato));
  }

  {
    // gara di un'altra azienda, gara senza documenti
    const db = dbBase();
    const k = costruisci(db, storageBase());
    const altrui = await generaPianoLavoro({ garaId: ALTRA_GARA, accountId: ACCOUNT, versione: 1, fonte: "sviluppo" }, k.deps);
    atteso("una gara di un'altra azienda non si genera, e non nasce nessuna riga", !altrui.ok && /Gara non trovata/.test(altrui.errore) && db.gara_piani_lavoro.length === 0 && k.scaricati.length === 0);
    const vuoto = dbBase();
    vuoto.gara_documenti = [];
    const kv = costruisci(vuoto, storageBase());
    const senza = await generaPianoLavoro({ garaId: GARA, accountId: ACCOUNT, versione: 1, fonte: "sviluppo" }, kv.deps);
    atteso("una gara senza documenti non si genera, e non nasce nessuna riga", !senza.ok && /non ha documenti/.test(senza.errore) && vuoto.gara_piani_lavoro.length === 0);
  }

  {
    // errore del modello: riga «errore», versione non consumata, poi riprova sulla STESSA riga
    const db = dbBase();
    const storage = storageBase();
    const guasta = costruisci(db, storage, { estrai: (async () => { throw new Error("Overloaded: chiave sk-ant-segretissima123456"); }) as unknown as DipendenzePiano["estrai"] });
    const fallito = await generaPianoLavoro({ garaId: GARA, accountId: ACCOUNT, versione: 1, fonte: "sviluppo" }, guasta.deps);
    const rigaErrore = db.gara_piani_lavoro[0] as Riga;
    atteso("modello in errore: esito non ok «non è stata conteggiata», riga in «errore» con testo breve senza chiavi, nessun file nello storage", !fallito.ok && /non è stata conteggiata/.test(fallito.errore) && rigaErrore.stato === "errore" && /Overloaded/.test(String(rigaErrore.errore)) && !/segretissima/.test(String(rigaErrore.errore)) && !storage.has(`${GARA}/piano-lavoro-v1.xlsx`));
    const rieseguito = costruisci(db, storage);
    const dopo = await generaPianoLavoro({ garaId: GARA, accountId: ACCOUNT, versione: 1, fonte: "sviluppo" }, rieseguito.deps);
    atteso("riprovando la stessa versione si riusa la stessa riga (nessun doppione) e finisce «pronto», senza errore residuo", dopo.ok && db.gara_piani_lavoro.length === 1 && db.gara_piani_lavoro[0].stato === "pronto" && db.gara_piani_lavoro[0].errore === null);
    // piano già pronto: non si rigenera la stessa versione
    const ancora = await generaPianoLavoro({ garaId: GARA, accountId: ACCOUNT, versione: 1, fonte: "sviluppo" }, costruisci(db, storage).deps);
    atteso("una versione già pronta non si rigenera", !ancora.ok && /già stato generato/.test(ancora.errore) && db.gara_piani_lavoro.length === 1);
    // la seconda versione è una riga a parte
    const seconda = await generaPianoLavoro({ garaId: GARA, accountId: ACCOUNT, versione: 2, fonte: "sviluppo" }, costruisci(db, storage).deps);
    atteso("la versione 2 è una riga e un file distinti", seconda.ok && db.gara_piani_lavoro.length === 2 && storage.has(`${GARA}/piano-lavoro-v2.xlsx`) && db.gara_piani_lavoro[1].versione === 2);
  }

  {
    // mai due generazioni insieme; una interrotta si riprende
    const db = dbBase();
    db.gara_piani_lavoro.push({ id: "p1", gara_id: GARA, user_id: ACCOUNT, versione: 1, stato: "in_corso", creata_il: new Date(ADESSO.getTime() - 2 * 60_000).toISOString(), errore: null });
    const k = costruisci(db, storageBase());
    const doppia = await generaPianoLavoro({ garaId: GARA, accountId: ACCOUNT, versione: 1, fonte: "sviluppo" }, k.deps);
    atteso("una generazione in corso da 2 minuti: la seconda richiesta è rifiutata e il modello non viene chiamato", !doppia.ok && /già in corso/.test(doppia.errore) && k.lettiDallEstrazione.length === 0 && db.gara_piani_lavoro[0].stato === "in_corso");
    db.gara_piani_lavoro[0].creata_il = new Date(ADESSO.getTime() - (MINUTI_GENERAZIONE_INTERROTTA + 5) * 60_000).toISOString();
    const ripresa = await generaPianoLavoro({ garaId: GARA, accountId: ACCOUNT, versione: 1, fonte: "sviluppo" }, costruisci(db, storageBase()).deps);
    atteso("una generazione ferma da oltre 20 minuti si riprende, sulla stessa riga", ripresa.ok && db.gara_piani_lavoro.length === 1 && db.gara_piani_lavoro[0].stato === "pronto");
  }

  {
    // storage che rifiuta il file, riga che non si aggiorna: errore, non «pronto»
    const db = dbBase();
    const k = costruisci(db, storageBase(), { guasti: { noUpload: true } });
    const e = await generaPianoLavoro({ garaId: GARA, accountId: ACCOUNT, versione: 1, fonte: "sviluppo" }, k.deps);
    atteso("se l'Excel non si riesce a salvare il piano resta in «errore» (mai «pronto» senza file)", !e.ok && db.gara_piani_lavoro[0].stato === "errore" && /Salvataggio del file non riuscito/.test(String(db.gara_piani_lavoro[0].errore)));
    const db2 = dbBase();
    const k2 = costruisci(db2, storageBase(), { guasti: { scrittura: ["update-pronto"] } });
    const e2 = await generaPianoLavoro({ garaId: GARA, accountId: ACCOUNT, versione: 1, fonte: "sviluppo" }, k2.deps);
    atteso("se la riga non si riesce ad aggiornare a «pronto» l'esito è un errore, non un successo", !e2.ok && db2.gara_piani_lavoro[0].stato === "errore");
    const db3 = dbBase();
    const e3 = await generaPianoLavoro({ garaId: GARA, accountId: ACCOUNT, versione: 1, fonte: "sviluppo" }, costruisci(db3, storageBase(), { guasti: { scrittura: ["insert"] } }).deps);
    atteso("se la riga non si riesce nemmeno ad aprire non parte nessuna generazione", !e3.ok && /Non riesco ad avviare/.test(e3.errore) && db3.gara_piani_lavoro.length === 0);
  }

  // ═════ 4. lettura dei piani e download ═════
  {
    const db = dbBase();
    db.gara_piani_lavoro.push(
      { id: "p2", gara_id: GARA, versione: 2, stato: "pronto", creata_il: "2026-11-02T10:00:00Z", completata_il: "2026-11-02T10:05:00Z", file_nome: "v2.xlsx", errore: null, riepilogo: { rotto: true } },
      { id: "p1", gara_id: GARA, versione: 1, stato: "pronto", creata_il: "2026-11-01T10:00:00Z", completata_il: "2026-11-01T10:05:00Z", file_nome: "v1.xlsx", errore: null, riepilogo: costruisciRiepilogo(datiProva()) },
      { id: "px", gara_id: ALTRA_GARA, versione: 1, stato: "pronto", creata_il: "2026-11-01T10:00:00Z", completata_il: null, file_nome: "altro.xlsx", errore: null, riepilogo: null },
    );
    const letti = await leggiPianiGara(fintoAdmin(db, storageBase()).client, GARA);
    atteso("lettura dei piani: solo quelli della gara, il riepilogo valido si legge e quello rotto diventa null senza far cadere la pagina", letti.disponibile && letti.piani.length === 2 && letti.piani.map((p) => p.id).sort().join() === "p1,p2" && letti.piani.find((p) => p.id === "p1")!.riepilogo?.sedi === 28 && letti.piani.find((p) => p.id === "p2")!.riepilogo === null);
    const senzaTabella = await leggiPianiGara(fintoAdmin(db, storageBase(), { tabelle: ["gara_piani_lavoro"] }).client, GARA);
    atteso("senza la migrazione 0096 la lettura dice «non disponibile» (la scheda non compare, la pagina funziona)", !senzaTabella.disponibile && senzaTabella.piani.length === 0);

    const storage = storageBase();
    storage.set(`${GARA}/piano-lavoro-v1.xlsx`, Buffer.from("x"));
    const admin = fintoAdmin(db, storage).client;
    const url = await urlScaricoPiano(admin, { file_path: `${GARA}/piano-lavoro-v1.xlsx`, file_nome: "Piano di lavoro - Gara - v1.xlsx" });
    atteso("link di download: temporaneo, con il nome del file passato a {download} (altrimenti il browser lo apre invece di scaricarlo)", "url" in url && /download=Piano%20di%20lavoro%20-%20Gara%20-%20v1\.xlsx/.test(url.url), JSON.stringify(url));
    const nessuno = await urlScaricoPiano(admin, { file_path: null, file_nome: null });
    const assente = await urlScaricoPiano(admin, { file_path: `${GARA}/non-esiste.xlsx`, file_nome: "x.xlsx" });
    atteso("senza file o con il file assente il download dà un errore leggibile", "errore" in nessuno && "errore" in assente);
  }

  // ═════ 5. regole scritte nel codice ═════
  {
    const migrazione = leggi("supabase/migrations/0096_gara_piani_lavoro.sql");
    atteso("migrazione 0096: tabella con le regole di accesso attive, stato e versione vincolati, una riga per gara e versione, cancellazione a cascata con la gara", /create table if not exists public\.gara_piani_lavoro/.test(migrazione) && /enable row level security/.test(migrazione) && /check \(stato in \('in_corso', 'pronto', 'errore'\)\)/.test(migrazione) && /check \(versione in \(1, 2\)\)/.test(migrazione) && /unique \(gara_id, versione\)/.test(migrazione) && /gara_id uuid not null references public\.gare \(id\) on delete cascade/.test(migrazione));
    atteso("migrazione 0096: il cliente LEGGE le righe della sua azienda (stessa funzione delle altre tabelle di lavoro) e solo alcune colonne: niente dati grezzi, percorsi dei file né costi", /for select using \(\(select public\.omnia_ai_titolare_effettivo\(\)\) = user_id\)/.test(migrazione) && /grant select \(id, gara_id, user_id, versione, stato, file_nome, dimensione_byte, riepilogo, errore, creata_il, completata_il\)\s+on public\.gara_piani_lavoro to authenticated/.test(migrazione) && !/grant select \([^)]*\b(dati|file_path|costo_stimato|fonte_diritto)\b/.test(migrazione));
    atteso("migrazione 0096: dal cliente nessuna scrittura (insert/update/delete solo per la chiave di servizio); idempotente", !/grant (insert|update|delete)[^;]*to authenticated/.test(migrazione) && /grant select, insert, update, delete on public\.gara_piani_lavoro to service_role/.test(migrazione) && /if not exists \(\s*select 1 from pg_policies/.test(migrazione));

    const azioni = leggi("src/app/actions/gara-piano-lavoro.ts");
    const corpo = (nome: string) => {
      const i = azioni.indexOf(`export async function ${nome}`);
      const f = azioni.indexOf("\nexport ", i + 10);
      return azioni.slice(i, f === -1 ? undefined : f);
    };
    const genera = corpo("generaPianoLavoroGara");
    const scarica = corpo("scaricaPianoLavoroGara");
    atteso("azioni: file «use server», solo funzioni asincrone esportate", azioni.startsWith('"use server";') && [...azioni.matchAll(/^export (?!type )(.*)$/gm)].every((m) => m[1].startsWith("async function")));
    atteso("genera: parte dalla guardia dell'account, poi abbonamento in sola lettura, poi il diritto alla generazione; solo dopo avvia il lavoro", genera.indexOf("await richiediAccountAzione()") !== -1 && genera.indexOf("richiediAccountAzione") < genera.indexOf("accessoNegatoPerAccount") && genera.indexOf("accessoNegatoPerAccount") < genera.indexOf("valutaDirittoPiano") && genera.indexOf("valutaDirittoPiano") < genera.indexOf("generaPianoLavoro(") && !genera.includes("auth.getUser()"));
    atteso("genera: gara e proroga si leggono con la sessione del cliente (regole di accesso), il lavoro gira sull'azienda del titolare; versione e fonte le decide la regola, non il form", /accountId: contesto\.accountId/.test(genera) && /versione: esito\.versione/.test(genera) && /fonte: esito\.fonte/.test(genera) && !/formData\.get\("versione"\)/.test(genera));
    atteso("genera: ricontrolla il diritto della gara (quota) per l'account effettivo e rinfresca la pagina", /dirittoGaraPerAccount\(/.test(genera) && /revalidatePath\(/.test(genera));
    atteso("scarica: guardia dell'account, poi la riga si deve vedere con la sessione del cliente (azienda giusta) e solo dopo si legge il percorso con la chiave di servizio, filtrando per l'azienda e per «pronto»", scarica.indexOf("await richiediAccountAzione()") !== -1 && scarica.indexOf("richiediAccountAzione") < scarica.indexOf("createAdminClient()") && /\.eq\("user_id", contesto\.accountId\)/.test(scarica) && /piano\.stato !== "pronto"/.test(scarica) && !scarica.includes("auth.getUser()"));

    const pannello = leggi("src/app/site-omnia-ai/dashboard/omnia-ai/gare/[id]/piano-lavoro-panel.tsx");
    atteso("riquadro: dice che è un dimensionamento di partenza, non un preventivo, con le rese come ipotesi e i prezzi standard da sostituire con quelli dei propri fornitori", /RIQUADRO_PIANO_PARTI\[1\]/.test(pannello) && /dimensionamento di partenza/.test(RIQUADRO_PIANO_PARTI[1]) && /non un preventivo/.test(RIQUADRO_PIANO_PARTI[2]) && /ipotesi da validare/.test(RIQUADRO_PIANO_PARTI[2]) && /sostituire con quelli dei tuoi fornitori/.test(RIQUADRO_PIANO_PARTI[2]));
    atteso("riquadro: il pulsante compare solo se il server dice che si può generare; la seconda versione chiede conferma; il download usa il link temporaneo in una nuova scheda", /const puoGenerare = diritto\.ok/.test(pannello) && /const azioni = puoGenerare \? \(/.test(pannello) && /azioni=\{azioni\}/.test(pannello) && /window\.confirm\(/.test(pannello) && /OpenInNewTabButton/.test(pannello) && /action=\{scaricaPianoLavoroGara\}/.test(pannello));
    atteso("riquadro: dal browser arrivano solo tipi (nessuna funzione del server con chiavi), e mostra cosa è mancante o ipotesi", !/from "@\/lib\/piano-lavoro-gara"/.test(pannello) && /import type \{ EsitoDirittoPiano, FonteDiritto, PianoRiga \} from "@\/lib\/piano-lavoro-gara-calcoli"/.test(pannello) && /mancanti da inserire/.test(pannello) && /Da completare o verificare/.test(pannello));
    const calcoli = leggi("src/lib/piano-lavoro-gara-calcoli.ts");
    atteso("le regole pure non importano nulla del server (nessun database, nessuna chiave)", !/supabase|createAdminClient|anthropic/i.test(calcoli.replace(/\/\/.*$/gm, "")));
    const pagina = leggi("src/app/site-omnia-ai/dashboard/omnia-ai/gare/[id]/page.tsx");
    atteso("pagina della gara: il riquadro compare solo dopo l'analisi (o se c'è già un piano) e solo se la tabella esiste", /pianoLavoroDisponibile && \(gara\.estrazione_stato === "completata" \|\| pianiLavoro\.length > 0\)/.test(pagina) && /garaUsabile: diritto\.consentito/.test(pagina));
    const generatore = leggi("src/lib/piano-lavoro-gara.ts");
    atteso("generazione: tutto ciò che tocca l'esterno arriva da `dipendenze` (provabile senza rete); la gara si filtra per l'azienda; il costo si registra con l'operazione di prova nei test degli script", /d\.admin[\s\S]{0,80}\.eq\("user_id", accountId\)/.test(generatore) && /operazionePerRegistro\(u\.operazione\)/.test(generatore) && /await d\.registraCosto\(/.test(generatore));
    const prossimiPassi = leggi("package.json");
    atteso("questi controlli sono nella batteria prima della build", /verifica-piano-lavoro-gara-omnia-ai\.ts/.test(prossimiPassi));
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
