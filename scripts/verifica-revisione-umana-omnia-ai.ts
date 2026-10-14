// Autotest della «revisione umana» della relazione tecnica (servizio a pagamento di OMNIA AI):
//   - il prezzo (da 250 € per 5 pagine a 550 € per 50 o più; pagine dal disciplinare, altrimenti dalla
//     relazione generata; +25% se la gara scade entro 72 ore, +50% entro 48, non gestibile sotto 47);
//   - i contatti del referente, le condizioni del servizio (versione e impronta);
//   - il segno «relazione finale» nella chat, il pulsante e la pagina di acquisto;
//   - l'azione che avvia il pagamento (prezzo ricalcolato dal server) e il webhook che registra il pagamento;
//   - le email: all'ufficio con il Word allegato, i dati aziendali e il referente; conferma al cliente;
//     l'allegato riletto dallo storage quando l'email va rimandata.
// Si provano con un database, uno storage e un servizio di posta finti (nessuna rete).
// Gratuito: gira nel livello 1, quindi in prebuild.
import fs from "fs";
import path from "path";
import { createHash } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  MESSAGGIO_NON_GESTIBILE,
  MESSAGGIO_PAGINE_NON_DETERMINABILI,
  MESSAGGIO_SCADUTA,
  REVISIONE,
  calcolaPrezzoRevisione,
  descriviFontePagine,
  fineGiornoRoma,
  oreAllaScadenza,
  paginePerRevisione,
  prezzoBasePerPagine,
  urgenzaPerOre,
  validaContattiRevisione,
} from "../src/lib/omnia-ai-revisione-calcoli";
import { CLAUSOLE_REVISIONE, CLAUSOLE_SPECIFICHE_REVISIONE, VERSIONE_CONDIZIONI_REVISIONE, testoCanonicoCondizioniRevisione } from "../src/lib/omnia-ai-revisione-condizioni";
import { emailClienteRevisioneRicevuta, emailUfficioRevisioneUmana } from "../src/lib/omnia-ai-email-revisione-calcoli";
import { aziendaDaRiga, fatturazioneDaSessione, notificaRevisioneUmana, type RigaRevisione } from "../src/lib/omnia-ai-email-revisione";
import { MAX_TENTATIVI_EMAIL, TENTATIVI_PRIMA_DI_SENZA_ALLEGATO, inviaEmailEvento, riprovaEmailNonInviate } from "../src/lib/omnia-ai-email-eventi";

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
const ORA = 3_600_000;

// ───── posta e storage finti ─────
type Inviata = { from: string; to: string[]; subject: string; html: string; attachments?: { filename: string; content: string }[] };
const inviate: Inviata[] = [];
let invioGuasto = false;
process.env.RESEND_API_KEY = "chiave-di-prova";
globalThis.fetch = (async (_url: unknown, init?: { body?: string }) => {
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

type Riga = Record<string, unknown>;
type Tabelle = Record<string, Riga[]>;
function dbFinto(tabelle: Tabelle, file: Record<string, Buffer> = {}): SupabaseClient {
  let progressivo = 0;
  return {
    storage: {
      from: (bucket: string) => ({
        download: async (percorso: string) => {
          const contenuto = file[`${bucket}/${percorso}`];
          return contenuto ? { data: { arrayBuffer: async () => contenuto.buffer.slice(contenuto.byteOffset, contenuto.byteOffset + contenuto.byteLength) }, error: null } : { data: null, error: { message: "Object not found" } };
        },
      }),
    },
    from: (tabella: string) => {
      const filtri: ((r: Riga) => boolean)[] = [];
      let operazione: "select" | "insert" | "update" = "select";
      let valori: Riga = {};
      let ordina: { colonna: string; crescente: boolean } | null = null;
      let massimo: number | null = null;
      const selezione = () => {
        let righe = (tabelle[tabella] ?? []).filter((r) => filtri.every((f) => f(r)));
        if (ordina) {
          const { colonna, crescente } = ordina;
          righe = [...righe].sort((a, b) => (String(a[colonna]) < String(b[colonna]) ? -1 : 1) * (crescente ? 1 : -1));
        }
        return massimo !== null ? righe.slice(0, massimo) : righe;
      };
      const inserisci = () => {
        if (tabella === "omnia_ai_email_eventi" && (tabelle[tabella] ?? []).some((r) => r.chiave === valori.chiave)) return { data: null, error: { code: "23505", message: "duplicate key" } };
        const riga: Riga = { id: `riga-${++progressivo}`, creata_il: new Date().toISOString(), tentativi: 0, ...valori };
        (tabelle[tabella] ??= []).push(riga);
        return { data: riga, error: null };
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const q: any = {
        select: () => q,
        insert: (v: Riga) => ((operazione = "insert"), (valori = v), q),
        update: (v: Riga) => ((operazione = "update"), (valori = v), q),
        eq: (c: string, v: unknown) => (filtri.push((r) => r[c] === v), q),
        neq: (c: string, v: unknown) => (filtri.push((r) => r[c] !== v), q),
        lt: (c: string, v: number | string) => (filtri.push((r) => (typeof v === "number" ? Number(r[c]) < v : String(r[c]) < v)), q),
        order: (c: string, o?: { ascending?: boolean }) => ((ordina = { colonna: c, crescente: o?.ascending !== false }), q),
        limit: (n: number) => ((massimo = n), q),
        returns: () => q,
        single: async () => (operazione === "insert" ? inserisci() : { data: selezione()[0] ?? null, error: null }),
        maybeSingle: async () => ({ data: selezione()[0] ?? null, error: null }),
        then: (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => {
          let esito: unknown;
          if (operazione === "insert") esito = inserisci();
          else if (operazione === "update") {
            for (const r of selezione()) Object.assign(r, valori);
            esito = { error: null };
          } else esito = { data: selezione(), count: selezione().length, error: null };
          return Promise.resolve(esito).then(ok, ko);
        },
      };
      return q;
    },
  } as unknown as SupabaseClient;
}

const parolaRotta = /\b(undefined|null|NaN)\b/;
const testoVisibile = (e: { oggetto: string; html: string }) => `${e.oggetto} ${e.html.replace(/<[^>]*>/g, " ")}`;

async function main() {
  console.log("--- Prezzo di base per pagine ---");
  uguale("fino a 5 pagine: 250 €", [0, 1, 4, 5].map(prezzoBasePerPagine), [25000, 25000, 25000, 25000]);
  uguale("20 pagine: 350 € (il tratto è lineare)", prezzoBasePerPagine(20), 35000);
  uguale("pagine intermedie, a euro interi", [6, 12, 27, 30, 49].map(prezzoBasePerPagine), [25700, 29700, 39700, 41700, 54300]);
  uguale("50 pagine o più: 550 €", [50, 51, 80, 500].map(prezzoBasePerPagine), [55000, 55000, 55000, 55000]);
  atteso("il prezzo non scende mai aumentando le pagine, e resta tra 250 e 550", Array.from({ length: 200 }, (_, i) => prezzoBasePerPagine(i + 1)).every((p, i, v) => (i === 0 || p >= v[i - 1]) && p >= 25000 && p <= 55000));
  atteso("sempre a euro interi", Array.from({ length: 60 }, (_, i) => prezzoBasePerPagine(i + 1)).every((p) => p % 100 === 0));

  console.log("--- Da dove vengono le pagine ---");
  uguale("la prescrizione del disciplinare vince sulla relazione", paginePerRevisione({ limitePagineDisciplinare: 40, pagineStimateRelazione: 12 }), { pagine: 40, fonte: "disciplinare" });
  uguale("senza prescrizione: le pagine della relazione generata, per eccesso", paginePerRevisione({ limitePagineDisciplinare: null, pagineStimateRelazione: 12.2 }), { pagine: 13, fonte: "relazione" });
  uguale("un limite non valido (zero, negativo) non conta come prescrizione", [paginePerRevisione({ limitePagineDisciplinare: 0, pagineStimateRelazione: 9 })?.fonte, paginePerRevisione({ limitePagineDisciplinare: -3, pagineStimateRelazione: 9 })?.fonte], ["relazione", "relazione"]);
  uguale("limite con decimali: per eccesso", paginePerRevisione({ limitePagineDisciplinare: 12.5, pagineStimateRelazione: null }), { pagine: 13, fonte: "disciplinare" });
  uguale("nessuna delle due: non si può stabilire", [paginePerRevisione({ limitePagineDisciplinare: null, pagineStimateRelazione: null }), paginePerRevisione({ limitePagineDisciplinare: undefined, pagineStimateRelazione: 0 })], [null, null]);
  uguale("descrizione della fonte", [descriviFontePagine("disciplinare"), descriviFontePagine("relazione")], ["pagine prescritte dal disciplinare di gara", "pagine della relazione tecnica generata da OMNIA AI"]);

  console.log("--- Scadenza: la fine del giorno, ora di Roma ---");
  uguale("d'estate (CEST, UTC+2)", fineGiornoRoma("2026-10-20")?.toISOString(), "2026-10-20T21:59:59.000Z");
  uguale("d'inverno (CET, UTC+1)", fineGiornoRoma("2026-12-20")?.toISOString(), "2026-12-20T22:59:59.000Z");
  uguale("giorno del passaggio all'ora legale (marzo): fine giornata in CEST", fineGiornoRoma("2026-03-29")?.toISOString(), "2026-03-29T21:59:59.000Z");
  uguale("giorno del ritorno all'ora solare (ottobre): fine giornata in CET", fineGiornoRoma("2026-10-25")?.toISOString(), "2026-10-25T22:59:59.000Z");
  uguale("una data con l'ora attaccata si legge come data", fineGiornoRoma("2026-10-20T10:00:00+00:00")?.toISOString(), "2026-10-20T21:59:59.000Z");
  uguale("date non valide o assenti: nessuna scadenza", [fineGiornoRoma(null), fineGiornoRoma(""), fineGiornoRoma("domani"), oreAllaScadenza(undefined, new Date())], [null, null, null, null]);
  atteso("ore alla scadenza: 57,9997 ore dal 18/10 a mezzogiorno UTC alla fine del 20/10", Math.abs((oreAllaScadenza("2026-10-20", new Date("2026-10-18T12:00:00Z")) ?? 0) - (9 + 48 + 59 / 60 + 59 / 3600)) < 0.001);

  console.log("--- Urgenza: ai limiti ---");
  const tipo = (ore: number | null) => {
    const u = urgenzaPerOre(ore);
    return `${u.tipo}:${u.percentuale}`;
  };
  uguale("già scaduta", [tipo(-5), tipo(0)], ["scaduta:0", "scaduta:0"]);
  uguale("meno di 47 ore: non gestibile", [tipo(0.01), tipo(24), tipo(46.99)], ["non_gestibile:0", "non_gestibile:0", "non_gestibile:0"]);
  uguale("da 47 a meno di 48 ore: +50%", [tipo(47), tipo(47.5), tipo(47.999)], ["maggiorazione:50", "maggiorazione:50", "maggiorazione:50"]);
  uguale("da 48 a meno di 72 ore: +25%", [tipo(48), tipo(60), tipo(71.999)], ["maggiorazione:25", "maggiorazione:25", "maggiorazione:25"]);
  uguale("da 72 ore in su: nessuna maggiorazione", [tipo(72), tipo(100), tipo(5000)], ["nessuna:0", "nessuna:0", "nessuna:0"]);
  uguale("scadenza non registrata: nessuna maggiorazione", tipo(null), "sconosciuta:0");

  console.log("--- Prezzo completo ---");
  const adesso = new Date("2026-10-18T12:00:00Z");
  const prezzo = (scadenza: string | null, limite: number | null, stima: number | null = null) => calcolaPrezzoRevisione({ scadenza, limitePagineDisciplinare: limite, pagineStimateRelazione: stima, adesso });
  {
    const e = prezzo("2026-12-30", 20);
    atteso("gara lontana, 20 pagine dal disciplinare: 350 € senza maggiorazione", e.ok && e.prezzo.baseCentesimi === 35000 && e.prezzo.totaleCentesimi === 35000 && e.prezzo.maggiorazionePercentuale === 0 && e.prezzo.maggiorazioneCentesimi === 0 && e.prezzo.fonte === "disciplinare", JSON.stringify(e));
  }
  {
    const e = calcolaPrezzoRevisione({ scadenza: "2026-10-20", limitePagineDisciplinare: 20, pagineStimateRelazione: null, adesso: new Date(fineGiornoRoma("2026-10-20")!.getTime() - 60 * ORA) });
    atteso("scade tra circa 60 ore: +25% su 350 € = 438 €", e.ok && e.prezzo.maggiorazionePercentuale === 25 && e.prezzo.totaleCentesimi === 43800 && e.prezzo.maggiorazioneCentesimi === 8800, JSON.stringify(e));
  }
  {
    // la fine del giorno è sempre alle 23:59:59 di Roma: per cadere tra 47 e 48 ore si sceglie `adesso` di conseguenza
    const scadenza = "2026-10-20"; // fine giornata 2026-10-20T21:59:59Z
    const quasi48 = new Date(fineGiornoRoma(scadenza)!.getTime() - 47.5 * ORA);
    const e = calcolaPrezzoRevisione({ scadenza, limitePagineDisciplinare: 20, pagineStimateRelazione: null, adesso: quasi48 });
    atteso("scade tra 47,5 ore: +50% su 350 € = 525 €", e.ok && e.prezzo.maggiorazionePercentuale === 50 && e.prezzo.totaleCentesimi === 52500, JSON.stringify(e));
    const tra40 = calcolaPrezzoRevisione({ scadenza, limitePagineDisciplinare: 20, pagineStimateRelazione: null, adesso: new Date(fineGiornoRoma(scadenza)!.getTime() - 40 * ORA) });
    uguale("scade tra 40 ore: non gestibile, con il suo messaggio", tra40.ok ? "ok" : [tra40.motivo, tra40.messaggio], ["non_gestibile", MESSAGGIO_NON_GESTIBILE]);
    const tra46 = calcolaPrezzoRevisione({ scadenza, limitePagineDisciplinare: 20, pagineStimateRelazione: null, adesso: new Date(fineGiornoRoma(scadenza)!.getTime() - 46.9 * ORA) });
    uguale("scade tra 46,9 ore: ancora non gestibile", tra46.ok ? "ok" : tra46.motivo, "non_gestibile");
    const tra72 = calcolaPrezzoRevisione({ scadenza, limitePagineDisciplinare: 20, pagineStimateRelazione: null, adesso: new Date(fineGiornoRoma(scadenza)!.getTime() - 72 * ORA) });
    atteso("scade tra esattamente 72 ore: nessuna maggiorazione", tra72.ok && tra72.prezzo.maggiorazionePercentuale === 0 && tra72.prezzo.totaleCentesimi === 35000);
    const tra71 = calcolaPrezzoRevisione({ scadenza, limitePagineDisciplinare: 20, pagineStimateRelazione: null, adesso: new Date(fineGiornoRoma(scadenza)!.getTime() - 71.9 * ORA) });
    atteso("scade tra 71,9 ore: +25%", tra71.ok && tra71.prezzo.maggiorazionePercentuale === 25);
  }
  {
    const e30 = calcolaPrezzoRevisione({ scadenza: "2026-10-20", limitePagineDisciplinare: 30, pagineStimateRelazione: null, adesso: new Date(fineGiornoRoma("2026-10-20")!.getTime() - 60 * ORA) });
    atteso("30 pagine: base 417 €, +25% = 521 €", e30.ok && e30.prezzo.baseCentesimi === 41700 && e30.prezzo.totaleCentesimi === 52100, JSON.stringify(e30));
    const e50 = calcolaPrezzoRevisione({ scadenza: "2026-10-20", limitePagineDisciplinare: 50, pagineStimateRelazione: null, adesso: new Date(fineGiornoRoma("2026-10-20")!.getTime() - 47.5 * ORA) });
    atteso("il massimo possibile: 550 € + 50% = 825 €", e50.ok && e50.prezzo.totaleCentesimi === 82500);
    const grande = prezzo("2026-12-30", 120);
    atteso("oltre 50 pagine: 550 €", grande.ok && grande.prezzo.totaleCentesimi === 55000 && grande.prezzo.pagine === 120);
  }
  {
    const e = prezzo("2026-12-30", null, 12);
    atteso("senza prescrizione: pagine della relazione (12 → 297 €)", e.ok && e.prezzo.pagine === 12 && e.prezzo.fonte === "relazione" && e.prezzo.totaleCentesimi === 29700, JSON.stringify(e));
    const senza = prezzo(null, 20);
    atteso("gara senza scadenza registrata: prezzo base, nessuna maggiorazione", senza.ok && senza.prezzo.maggiorazionePercentuale === 0 && senza.prezzo.scadenza === null && senza.prezzo.oreAllaScadenza === null);
    const scaduta = prezzo("2026-10-10", 20);
    uguale("scadenza passata", scaduta.ok ? "ok" : [scaduta.motivo, scaduta.messaggio], ["scaduta", MESSAGGIO_SCADUTA]);
    const nessuna = prezzo("2026-12-30", null, null);
    uguale("pagine non determinabili", nessuna.ok ? "ok" : [nessuna.motivo, nessuna.messaggio], ["pagine_non_determinabili", MESSAGGIO_PAGINE_NON_DETERMINABILI]);
    const urgenteSenzaPagine = prezzo("2026-10-19", null, null);
    uguale("scadenza troppo vicina e pagine mancanti: si dice prima della scadenza", urgenteSenzaPagine.ok ? "ok" : urgenteSenzaPagine.motivo, "non_gestibile");
    atteso("totale = base + maggiorazione, sempre", [15, 25, 33, 45].every((p) => [48, 55, 70, 100].every((ore) => { const x = calcolaPrezzoRevisione({ scadenza: "2026-10-20", limitePagineDisciplinare: p, pagineStimateRelazione: null, adesso: new Date(fineGiornoRoma("2026-10-20")!.getTime() - ore * ORA) }); return !x.ok || x.prezzo.baseCentesimi + x.prezzo.maggiorazioneCentesimi === x.prezzo.totaleCentesimi; })));
    atteso("i messaggi citano le 47 ore e la scadenza", /47 ore/.test(MESSAGGIO_NON_GESTIBILE) && /consulenti umani/.test(MESSAGGIO_NON_GESTIBILE) && /scadenza troppo ravvicinata/.test(MESSAGGIO_NON_GESTIBILE) && /scadenza/.test(MESSAGGIO_SCADUTA));
  }

  console.log("--- Contatti del referente ---");
  {
    const ok = validaContattiRevisione({ nome: "  Mario   Rossi ", email: " Mario.Rossi@Esempio.IT ", cellulare: "+39 333 123 4567" });
    uguale("contatti validi, puliti", ok.ok ? ok.valori : null, { nome: "Mario Rossi", email: "mario.rossi@esempio.it", cellulare: "+393331234567" });
    uguale("«00» iniziale diventa «+»", validaContattiRevisione({ nome: "Anna Bianchi", email: "a@b.it", cellulare: "0039 333 1234567" }).ok && (validaContattiRevisione({ nome: "Anna Bianchi", email: "a@b.it", cellulare: "0039 333 1234567" }) as { valori: { cellulare: string } }).valori.cellulare, "+393331234567");
    uguale("numero con trattini e parentesi", (validaContattiRevisione({ nome: "Anna Bianchi", email: "a@b.it", cellulare: "(333) 123-4567" }) as { valori: { cellulare: string } }).valori.cellulare, "3331234567");
    const errore = (c: Partial<{ nome: unknown; email: unknown; cellulare: unknown }>) => {
      const r = validaContattiRevisione({ nome: "Mario Rossi", email: "m@r.it", cellulare: "3331234567", ...c });
      return r.ok ? null : r.errore;
    };
    atteso("nome troppo corto, vuoto, senza lettere, o troppo lungo", [errore({ nome: "M" }), errore({ nome: "   " }), errore({ nome: "123 456" }), errore({ nome: "a".repeat(121) })].every((e) => e !== null && /nome e cognome/i.test(e)));
    atteso("email non valide", [errore({ email: "" }), errore({ email: "non-una-email" }), errore({ email: "a@b" }), errore({ email: "a b@c.it" })].every((e) => e !== null && /email/i.test(e)));
    atteso("cellulari non validi: lettere, troppo corto (7 cifre), troppo lungo (16)", [errore({ cellulare: "abc" }), errore({ cellulare: "1234567" }), errore({ cellulare: "1234567890123456" }), errore({ cellulare: "" })].every((e) => e !== null && /cellulare/i.test(e)));
    atteso("cellulare di 8 e di 15 cifre: valido", errore({ cellulare: "12345678" }) === null && errore({ cellulare: "+123456789012345" }) === null);
    atteso("valori non testo (null, numeri) non rompono nulla", errore({ nome: null }) !== null && errore({ email: undefined }) !== null && errore({ cellulare: 3331234567 }) === null);
  }

  console.log("--- Condizioni del servizio ---");
  const testi = CLAUSOLE_REVISIONE.map((c) => c.testo).join(" ");
  uguale("clausole numerate di seguito da 1", CLAUSOLE_REVISIONE.map((c) => c.numero), CLAUSOLE_REVISIONE.map((_, i) => i + 1));
  uguale("da approvare specificamente: sospensione dei termini (3) e limitazione di responsabilità (6)", CLAUSOLE_SPECIFICHE_REVISIONE.map((c) => c.numero), [3, 6]);
  atteso("gli impegni di OMNIA AI: contatto in 5 ore lavorative, consegna in 48, intestazione, piè di pagina e copertina grafica personalizzata", /entro 5 ore lavorative dal pagamento/i.test(testi) && /entro 48 ore lavorative dall'invio della richiesta/i.test(testi) && /intestazione, piè di pagina e copertina grafica personalizzata/.test(testi));
  atteso("l'impegno del cliente a fornire le informazioni necessarie", /tutte le informazioni, i dati e i materiali necessari alla revisione/.test(testi));
  atteso("segreto professionale e riservatezza", /segreto professionale/.test(testi) && /riservatezza/.test(testi));
  atteso("il prezzo e le maggiorazioni descritti come in pagina: 250, 550, 5 e 50 pagine, +25% entro 72 ore, +50% entro 48, non gestibili entro 47", /250 euro/.test(testi) && /550 euro/.test(testi) && /5 pagine/.test(testi) && /50 pagine/.test(testi) && /entro 72 ore il corrispettivo è maggiorato del 25%/.test(testi) && /entro 48 ore è maggiorato del 50%/.test(testi) && /entro 47 ore non possono essere gestite/.test(testi));
  atteso("pagine dal disciplinare, altrimenti dalla relazione generata", /prescritte dal disciplinare di gara/.test(testi) && /Relazione tecnica finale generata da OMNIA AI/.test(testi));
  atteso("importi IVA inclusa, pagamento anticipato con Stripe", /IVA inclusa/.test(testi) && /Stripe/.test(testi));
  const canonico = testoCanonicoCondizioniRevisione();
  const impronta = createHash("sha256").update(canonico).digest("hex");
  atteso("l'impronta è stabile e cambia se cambia anche una sola parola", impronta === createHash("sha256").update(testoCanonicoCondizioniRevisione()).digest("hex") && impronta !== createHash("sha256").update(canonico.replace("48 ore", "49 ore")).digest("hex") && /^[0-9a-f]{64}$/.test(impronta));
  atteso("la versione è nel testo canonico", canonico.startsWith(`versione ${VERSIONE_CONDIZIONI_REVISIONE}`));
  atteso("i numeri nelle condizioni sono quelli delle regole (non copiati a mano)", /5 ore lavorative/.test(testi) && REVISIONE.oreContattoLavorative === 5 && REVISIONE.oreConsegnaLavorative === 48 && REVISIONE.prezzoBaseCentesimi === 25000 && REVISIONE.prezzoMassimoCentesimi === 55000);

  console.log("--- Email: testi ---");
  const referente = { nome: "Mario Rossi", email: "mario.rossi@pulizierossi.it", cellulare: "+393331234567" };
  const azienda = aziendaDaRiga({ ragione_sociale: "Pulizie Rossi Srl", forma_giuridica: "SRL", partita_iva: "01234567890", codice_fiscale: "01234567890", indirizzo: "Via Roma 1, 20100 Milano", codice_sdi: "ABC1234", pec: "rossi@pec.it", numero_dipendenti: 42, fatturato_medio_annuo: "1250000.50", certificazioni: "ISO 9001, ISO 14001", settori_attivita: "Pulizie civili", sito_web: "https://pulizierossi.it", telefono_aziendale: "02 1234567", presentazione: "Siamo un'impresa di pulizie\ndal 1990.", referenze: "Comune di Aosta (2021-2024)" });
  const quando = new Date("2026-10-14T09:30:00Z");
  const base = {
    prova: false,
    revisioneId: "11111111-2222-3333-4444-555555555555",
    cliente: { email: "titolare@pulizierossi.it", nome: "Pulizie Rossi Srl" },
    azienda,
    fatturazione: fatturazioneDaSessione({ customer_details: { name: "Pulizie Rossi Srl", email: "amministrazione@pulizierossi.it", phone: null, business_name: null, individual_name: null, address: { line1: "Via Roma 1", line2: null, city: "Milano", state: "MI", postal_code: "20100", country: "IT" }, tax_exempt: "none", tax_ids: [{ type: "eu_vat", value: "IT01234567890" }] } } as never),
    garaTitolo: "Servizio di pulizia — Comune di Aosta",
    scadenza: "2026-10-20",
    oreAllaScadenza: 156,
    pagine: 20,
    fontePagine: "disciplinare" as const,
    baseCentesimi: 35000,
    maggiorazionePercentuale: 0,
    importoPagatoCentesimi: 35000,
    pagataIl: quando,
    referente,
    fileNome: "Relazione tecnica Aosta.docx",
    stripePaymentIntentId: "pi_123",
  };
  const uff = emailUfficioRevisioneUmana(base);
  atteso("ufficio: oggetto con cliente, gara e scadenza", uff.oggetto === "Revisione umana richiesta: Pulizie Rossi Srl — Servizio di pulizia — Comune di Aosta (gara in scadenza il 20/10/2026)", uff.oggetto);
  atteso("ufficio: gli impegni (5 ore lavorative, 48 ore lavorative, intestazione, piè di pagina, copertina) e il file Word in allegato", /entro <strong>5 ore lavorative<\/strong>/.test(uff.html) && /entro <strong>48 ore lavorative<\/strong>/.test(uff.html) && /intestazione, piè di pagina e copertina grafica personalizzata/.test(uff.html) && /Relazione tecnica Aosta\.docx/.test(uff.html) && /in allegato/.test(uff.html));
  atteso("ufficio: il referente con collegamenti per scrivere e chiamare", /mailto:mario\.rossi@pulizierossi\.it/.test(uff.html) && /tel:\+393331234567/.test(uff.html) && /Mario Rossi/.test(uff.html));
  atteso("ufficio: dati aziendali principali (ragione sociale, partita IVA, SDI, PEC, indirizzo, dipendenti, fatturato, certificazioni)", ["Pulizie Rossi Srl", "01234567890", "ABC1234", "rossi@pec.it", "Via Roma 1, 20100 Milano", "42", "1.250.000,50 €", "ISO 9001, ISO 14001", "Pulizie civili"].every((v) => uff.html.includes(v)));
  atteso("ufficio: presentazione e referenze dell'azienda, a capo conservati", /white-space:pre-wrap/.test(uff.html) && /Siamo un&#39;impresa di pulizie\ndal 1990\./.test(uff.html) && /Comune di Aosta \(2021-2024\)/.test(uff.html));
  atteso("ufficio: dati di fatturazione da Stripe (intestatario, indirizzo, partita IVA)", /Via Roma 1, 20100 Milano, MI, IT/.test(uff.html) && /eu_vat: IT01234567890/.test(uff.html) && /amministrazione@pulizierossi\.it/.test(uff.html));
  atteso("ufficio: prezzo con pagine e fonte, importo pagato, collegamento al pagamento su Stripe", /20 \(pagine prescritte dal disciplinare di gara\)/.test(uff.html) && /350,00 €/.test(uff.html) && /dashboard\.stripe\.com\/payments\/pi_123/.test(uff.html));
  atteso("ufficio: senza maggiorazione non compare la riga né «URGENTE»", !/URGENTE/.test(uff.oggetto) && !/Maggiorazione per urgenza/.test(uff.html));
  const urg = emailUfficioRevisioneUmana({ ...base, maggiorazionePercentuale: 25, baseCentesimi: 35000, importoPagatoCentesimi: 43800, prova: true });
  atteso("ufficio, gara in scadenza: «URGENTE», maggiorazione e importo evidenziati, [PROVA]", /^\[PROVA\] URGENTE — Revisione umana richiesta/.test(urg.oggetto) && /URGENTE \(\+25%\)/.test(urg.html) && /\+25% \(88,00 €\)/.test(urg.html) && /438,00 €/.test(urg.html) && /account Stripe di PROVA/.test(urg.html), urg.oggetto);
  const doppio = emailUfficioRevisioneUmana({ ...base, pagamentoDoppio: true });
  atteso("pagamento doppio: segnalato in oggetto e in testa, con l'invito a rimborsare", /^PAGAMENTO DOPPIO — /.test(doppio.oggetto) && /pagamento doppio/.test(doppio.html) && /rimborsa il doppione/.test(doppio.html));
  const maligna = emailUfficioRevisioneUmana({ ...base, garaTitolo: `<script>alert(1)</script>`, referente: { ...referente, nome: `<img src=x onerror=alert(1)>` }, azienda: { ...azienda!, presentazione: `<b onclick="x">grassetto</b>` } });
  atteso("nessun HTML inserito dai testi del cliente (titolo gara, referente, presentazione)", !/<script>|<img src=x|<b onclick/.test(maligna.html) && /&lt;script&gt;/.test(maligna.html));
  const povera = emailUfficioRevisioneUmana({ ...base, azienda: null, fatturazione: null, scadenza: null, oreAllaScadenza: null, stripePaymentIntentId: null });
  atteso("senza profilo azienda, fatturazione, scadenza e id del pagamento: l'email resta corretta", !parolaRotta.test(testoVisibile(povera)) && /non registrata/.test(povera.html) && !/Dati di fatturazione/.test(povera.html) && !/dashboard\.stripe\.com/.test(povera.html) && !/^.*gara in scadenza/.test(povera.oggetto));
  atteso("ufficio: nessuna parola «undefined»/«null»/«NaN»", [uff, urg, doppio, maligna].every((e) => !parolaRotta.test(testoVisibile(e))), [uff, urg, doppio, maligna].find((e) => parolaRotta.test(testoVisibile(e)))?.oggetto);
  const cli = emailClienteRevisioneRicevuta({ prova: false, garaTitolo: "Servizio di pulizia — Comune di Aosta", importoCentesimi: 43800, maggiorazionePercentuale: 25, pagataIl: quando, referente, linkGara: "https://omnia-ai.it/dashboard/omnia-ai/gare/abc" });
  atteso("cliente: conferma con importo (e maggiorazione), referente, tempi e cosa comprende la revisione", cli.oggetto === "Richiesta di revisione umana ricevuta — OMNIA AI" && /438,00 €/.test(cli.html) && /maggiorazione per urgenza del 25%/.test(cli.html) && /Mario Rossi/.test(cli.html) && /entro <strong>5 ore lavorative<\/strong>/i.test(cli.html) && /entro <strong>48 ore lavorative<\/strong>/i.test(cli.html) && /intestazione, piè di pagina e copertina grafica personalizzata/.test(cli.html), cli.oggetto);
  atteso("cliente: rimando alla gara, nessun dato interno né collegamento al pannello Stripe", /omnia-ai\.it\/dashboard\/omnia-ai\/gare\/abc/.test(cli.html) && !/dashboard\.stripe\.com/.test(cli.html) && !/PAGAMENTO DOPPIO/.test(cli.html) && !parolaRotta.test(testoVisibile(cli)));
  atteso("cliente: evento di prova segnato", /^\[PROVA\] /.test(emailClienteRevisioneRicevuta({ prova: true, garaTitolo: "x", importoCentesimi: 35000, maggiorazionePercentuale: 0, pagataIl: quando, referente, linkGara: "https://x" }).oggetto));
  uguale("profilo azienda: valori vuoti o spazi restano vuoti, numeri anche come testo", [aziendaDaRiga({ ragione_sociale: "  ", numero_dipendenti: "12", fatturato_medio_annuo: "abc" })?.ragioneSociale, aziendaDaRiga({ numero_dipendenti: "12" })?.numeroDipendenti, aziendaDaRiga({ fatturato_medio_annuo: "abc" })?.fatturatoMedioAnnuo, aziendaDaRiga(null)], [null, 12, null, null]);
  uguale("fatturazione da Stripe: senza dettagli nessuna, indirizzo composto senza pezzi vuoti", [fatturazioneDaSessione({ customer_details: null } as never), fatturazioneDaSessione({ customer_details: { name: "X", address: { line1: "Via A 1", line2: null, city: "Roma", state: null, postal_code: "00100", country: "IT" }, tax_ids: [] } } as never)?.indirizzo], [null, "Via A 1, 00100 Roma, IT"]);

  console.log("--- Allegato Word: registro, storage, nuovo tentativo ---");
  const WORD = Buffer.from("contenuto-docx-di-prova");
  const allegato = { bucket: "gare", path: "g1/relazione.docx", nome: "Relazione tecnica.docx" };
  {
    azzera();
    const tabelle: Tabelle = { omnia_ai_email_eventi: [] };
    const db = dbFinto(tabelle, { "gare/g1/relazione.docx": WORD });
    const dati = { admin: db, chiave: "rev:1:ufficio", tipo: "revisione_umana_richiesta" as const, destinatario: "ufficio" as const, a: UFFICIO, email: { oggetto: "Revisione", html: "<p>x</p>" }, livemode: true, allegato };
    uguale("email con allegato: inviata", await inviaEmailEvento(dati), "inviata");
    atteso("il Word parte in allegato, con il suo nome, in base64", inviate.length === 1 && inviate[0].attachments?.length === 1 && inviate[0].attachments[0].filename === "Relazione tecnica.docx" && Buffer.from(inviate[0].attachments[0].content, "base64").equals(WORD), JSON.stringify(inviate[0]?.attachments));
    const r = tabelle.omnia_ai_email_eventi[0];
    uguale("a invio riuscito il registro non conserva né testo né dove sta il file", [r.stato, r.invia_a, r.corpo_html, r.allegato_bucket, r.allegato_path, r.allegato_nome], ["inviata", null, null, null, null, null]);
    uguale("stessa email rimandata dall'evento: non riparte", [await inviaEmailEvento(dati), inviate.length], ["duplicata", 1]);
  }
  {
    azzera();
    const tabelle: Tabelle = { omnia_ai_email_eventi: [] };
    const file: Record<string, Buffer> = { "gare/g1/relazione.docx": WORD };
    const db = dbFinto(tabelle, file);
    invioGuasto = true;
    const dati = { admin: db, chiave: "rev:2:ufficio", tipo: "revisione_umana_richiesta" as const, destinatario: "ufficio" as const, a: UFFICIO, email: { oggetto: "Revisione", html: "<p>x</p>" }, livemode: true, allegato };
    uguale("posta fuori uso: «fallita»", await senzaRumore(() => inviaEmailEvento(dati)), "fallita");
    const r = tabelle.omnia_ai_email_eventi[0];
    uguale("il registro tiene dove sta il file (non il file) per rimandarla", [r.stato, r.allegato_bucket, r.allegato_path, r.allegato_nome], ["fallita", "gare", "g1/relazione.docx", "Relazione tecnica.docx"]);
    invioGuasto = false;
    const esito = await riprovaEmailNonInviate(db);
    atteso("il controllo periodico rilegge il file dallo storage e rimanda l'email CON l'allegato", esito.rimandate === 1 && inviate.length === 1 && Buffer.from(inviate[0].attachments?.[0]?.content ?? "", "base64").equals(WORD), JSON.stringify(esito));
    uguale("rimandata: registro svuotato", [r.stato, r.allegato_path], ["inviata", null]);
  }
  {
    // il file non si legge più (gara cancellata, storage in errore): si insiste, poi parte senza allegato e lo dice
    azzera();
    const tabelle: Tabelle = { omnia_ai_email_eventi: [] };
    const db = dbFinto(tabelle, {});
    const dati = { admin: db, chiave: "rev:3:ufficio", tipo: "revisione_umana_richiesta" as const, destinatario: "ufficio" as const, a: UFFICIO, email: { oggetto: "Revisione", html: "<p>corpo</p>" }, livemode: true, allegato };
    uguale("allegato non leggibile al primo tentativo: l'email NON parte ancora (riproverà)", [await senzaRumore(() => inviaEmailEvento(dati)), inviate.length], ["fallita", 0]);
    for (let i = 1; i < TENTATIVI_PRIMA_DI_SENZA_ALLEGATO; i++) await senzaRumore(() => riprovaEmailNonInviate(db));
    atteso(`ancora nessuna email dopo ${TENTATIVI_PRIMA_DI_SENZA_ALLEGATO - 1} nuovi tentativi`, inviate.length === 0, String(inviate.length));
    const ultimo = await senzaRumore(() => riprovaEmailNonInviate(db));
    atteso("dopo i tentativi l'email parte comunque, senza allegato e con l'avviso rosso in testa", ultimo.rimandate === 1 && inviate.length === 1 && !inviate[0].attachments && /Attenzione:<\/strong> il file «Relazione tecnica\.docx» non è stato allegato/.test(inviate[0].html) && /<p>corpo<\/p>/.test(inviate[0].html), JSON.stringify(ultimo));
  }
  {
    azzera();
    const db = dbFinto({ omnia_ai_email_eventi: [] }, {});
    const dati = { admin: db, chiave: "rev:4:ufficio", tipo: "revisione_umana_richiesta" as const, destinatario: "ufficio" as const, a: UFFICIO, email: { oggetto: "Revisione", html: "<p>corpo</p>" }, livemode: true, allegato };
    const tabelleAssenti = { from: () => ({ insert: () => ({ select: () => ({ single: async () => ({ data: null, error: { code: "PGRST205", message: "manca" } }) }) }) }), storage: db.storage } as unknown as SupabaseClient;
    uguale("registro non creato e file non leggibile: l'email parte subito senza allegato (non c'è un secondo tentativo)", [await senzaRumore(() => inviaEmailEvento({ ...dati, admin: tabelleAssenti })), inviate.length, !inviate[0]?.attachments], ["inviata", 1, true]);
  }
  atteso("l'ufficio viene avvisato entro circa un'ora anche se il file non si legge (al più 5 tentativi da 15 minuti)", TENTATIVI_PRIMA_DI_SENZA_ALLEGATO >= 2 && TENTATIVI_PRIMA_DI_SENZA_ALLEGATO <= 5 && TENTATIVI_PRIMA_DI_SENZA_ALLEGATO < MAX_TENTATIVI_EMAIL, String(TENTATIVI_PRIMA_DI_SENZA_ALLEGATO));

  console.log("--- Revisione pagata: le due email ---");
  const riga: RigaRevisione = {
    id: "rev-1",
    user_id: "u1",
    gara_id: "g1",
    gara_titolo: "Servizio di pulizia — Comune di Aosta",
    file_nome: "Relazione tecnica Aosta.docx",
    file_path: "g1/relazione.docx",
    pagine: 20,
    pagine_fonte: "disciplinare",
    prezzo_base_centesimi: 35000,
    maggiorazione_percentuale: 25,
    prezzo_totale_centesimi: 43800,
    scadenza_gara: "2026-10-20",
    ore_alla_scadenza: 58,
    referente_nome: "Mario Rossi",
    referente_email: "mario.rossi@pulizierossi.it",
    referente_cellulare: "+393331234567",
    pagata_il: "2026-10-18T10:00:00Z",
    stripe_payment_intent_id: "pi_999",
    importo_pagato_centesimi: 43800,
  };
  const tabelleBase = (): Tabelle => ({
    users: [{ id: "u1", email: "titolare@pulizierossi.it" }],
    companies: [{ user_id: "u1", ragione_sociale: "Pulizie Rossi Srl", partita_iva: "01234567890", codice_sdi: "ABC1234", pec: "rossi@pec.it", presentazione: "Impresa dal 1990" }],
    omnia_ai_email_eventi: [],
  });
  const sessione = { customer_details: { name: "Pulizie Rossi Srl", email: "amministrazione@pulizierossi.it", address: null, tax_ids: [{ type: "eu_vat", value: "IT01234567890" }] }, customer_email: "titolare@pulizierossi.it", amount_total: 43800 } as never;
  {
    azzera();
    const db = dbFinto(tabelleBase(), { "gare/g1/relazione.docx": WORD });
    await notificaRevisioneUmana({ admin: db, livemode: true, eventoId: "evt_1", revisione: riga, sessione });
    uguale("una email all'ufficio e una al cliente", [aUfficio().length, aCliente().length, aCliente()[0]?.to], [1, 1, ["titolare@pulizierossi.it"]]);
    const u = aUfficio()[0];
    atteso("ufficio: con il Word della relazione in allegato", u.attachments?.length === 1 && u.attachments[0].filename === "Relazione tecnica Aosta.docx" && Buffer.from(u.attachments[0].content, "base64").equals(WORD));
    atteso("ufficio: urgente (+25%), referente, dati aziendali dal profilo, fatturazione da Stripe, importo pagato", /URGENTE/.test(u.subject) && /mario\.rossi@pulizierossi\.it/.test(u.html) && /01234567890/.test(u.html) && /ABC1234/.test(u.html) && /Impresa dal 1990/.test(u.html) && /eu_vat: IT01234567890/.test(u.html) && /438,00 €/.test(u.html));
    atteso("cliente: conferma senza allegato", /Richiesta di revisione umana ricevuta/.test(aCliente()[0].subject) && !aCliente()[0].attachments);
    await notificaRevisioneUmana({ admin: db, livemode: true, eventoId: "evt_2", revisione: riga, sessione });
    uguale("evento rimandato da Stripe: nessuna email in più", inviate.length, 2);
  }
  {
    azzera();
    await notificaRevisioneUmana({ admin: dbFinto(tabelleBase(), { "gare/g1/relazione.docx": WORD }), livemode: false, eventoId: "evt_3", revisione: { ...riga, id: "rev-2" }, sessione, pagamentoDoppio: true });
    atteso("pagamento di prova e doppione: [PROVA] e «PAGAMENTO DOPPIO» all'ufficio", /^\[PROVA\] PAGAMENTO DOPPIO/.test(aUfficio()[0].subject) && /^\[PROVA\] /.test(aCliente()[0].subject), aUfficio()[0]?.subject);
  }
  {
    azzera();
    const tabelle = tabelleBase();
    tabelle.users = [{ id: "u1", email: null }];
    await senzaRumore(() => notificaRevisioneUmana({ admin: dbFinto(tabelle, { "gare/g1/relazione.docx": WORD }), livemode: true, eventoId: "evt_4", revisione: { ...riga, id: "rev-3" }, sessione: { ...(sessione as object), customer_email: null, customer_details: { ...((sessione as { customer_details: object }).customer_details), email: null } } as never }));
    uguale("senza l'email del cliente: all'ufficio parte lo stesso, la conferma no", [aUfficio().length, aCliente().length], [1, 0]);
  }
  {
    azzera();
    const rotto = { from: () => { throw new Error("database non raggiungibile"); }, storage: dbFinto({}).storage } as unknown as SupabaseClient;
    let lanciata = false;
    try {
      await senzaRumore(() => notificaRevisioneUmana({ admin: rotto, livemode: true, eventoId: "evt_5", revisione: riga, sessione }));
    } catch {
      lanciata = true;
    }
    uguale("database non raggiungibile: nessuna eccezione (il webhook non si ferma)", lanciata, false);
  }

  console.log("--- Segno «relazione finale» nella chat ---");
  const chat = leggi("src/app/actions/gara-chat.ts");
  atteso("la relazione composta è segnata «finale», la bozza di un criterio no", /fileGenerato = \{ \.\.\.risultato, finale: true \};/.test(chat) && /fileGenerato = \{ nomeFile, filePath, pagineStimate, avvisiEconomici, valoriImpresa, finale: false \};/.test(chat));
  atteso("il segno si scrive nel messaggio solo per la relazione finale", /const rigaConFinale = fileGenerato\?\.finale \? \{ \.\.\.rigaMessaggio, relazione_finale: true \} : rigaMessaggio;/.test(chat));
  atteso("se la colonna manca (migrazione non eseguita) il messaggio si salva come sempre", /insertAiError && fileGenerato\?\.finale && \/relazione_finale\/\.test\(insertAiError\.message \?\? ""\)/.test(chat) && /inserisciRiga\(rigaMessaggio\)/.test(chat));
  const m88 = leggi("supabase/migrations/0088_gara_messaggi_relazione_finale.sql");
  atteso("migrazione 0088: colonna booleana con default falso, riempimento dei messaggi già esistenti, indice", /add column if not exists relazione_finale boolean not null default false/.test(m88) && /set relazione_finale = true/.test(m88) && /\(s\.titolo_sezione \|\| '\.docx'\) = m\.file_nome/.test(m88) && /create index if not exists gara_messaggi_relazione_finale_idx/.test(m88));
  atteso("migrazione 0088: tocca solo i file Word dell'assistente di gare che hanno sezioni", /m\.ruolo = 'assistente'/.test(m88) && /m\.file_path is not null/.test(m88) && /exists \(\s*select 1 from public\.gara_relazione_sezioni s where s\.gara_id = m\.gara_id/.test(m88));

  console.log("--- Migrazioni 0089 e 0090 ---");
  const m89 = leggi("supabase/migrations/0089_omnia_ai_revisioni.sql");
  atteso("0089: prezzo fissato (pagine, base, maggiorazione 0/25/50, totale), referente, accettazioni con versione e impronta", /maggiorazione_percentuale integer not null default 0 check \(maggiorazione_percentuale in \(0, 25, 50\)\)/.test(m89) && /prezzo_totale_centesimi integer not null check/.test(m89) && /referente_cellulare text not null/.test(m89) && /condizioni_versione integer not null/.test(m89) && /condizioni_hash text not null/.test(m89) && /pagine_fonte text not null check \(pagine_fonte in \('disciplinare', 'relazione'\)\)/.test(m89));
  atteso("0089: stati, sessione Stripe unica, riferimenti che si azzerano (un pagamento non si cancella)", /stato in \('in_attesa_pagamento', 'pagata'\)/.test(m89) && /stripe_session_id text unique/.test(m89) && (m89.replace(/--[^\n]*/g, "").match(/on delete set null/g) ?? []).length === 3 && !/on delete cascade/.test(m89.replace(/--[^\n]*/g, "")));
  atteso("0089: RLS attiva, permessi solo al server, niente delete, nessun accesso ai ruoli utente", /enable row level security/.test(m89) && /grant select, insert, update on public\.omnia_ai_revisioni to service_role/.test(m89) && !/grant[^;]*delete/i.test(m89) && !/to (anon|authenticated)/.test(m89.replace(/--[^\n]*/g, "")));
  atteso("0089: nessun indice unico sui pagamenti (un doppio pagamento resta registrato)", !/create unique index[^;]*omnia_ai_revisioni/.test(m89));
  const m90 = leggi("supabase/migrations/0090_omnia_ai_email_eventi_allegati.sql");
  atteso("0090: tre colonne per l'allegato e i due tipi nuovi", /allegato_bucket text/.test(m90) && /allegato_path text/.test(m90) && /allegato_nome text/.test(m90) && /'revisione_umana_richiesta'/.test(m90) && /'revisione_umana_ricevuta'/.test(m90) && /drop constraint if exists omnia_ai_email_eventi_tipo_check/.test(m90));

  console.log("--- Azione che avvia il pagamento ---");
  const azione = leggi("src/app/actions/omnia-ai-revisione.ts");
  const ordine = ["supabase.auth.getUser()", "requireOmniaAiWriteAccess(", 'formData.get("acceptCondizioni")', "validaContattiRevisione(", "leggiContestoRevisione(", "contesto.pagata", "calcolaPrezzoRevisione(", "prezzoMostratoCentesimi", "storage.from(\"gare\").exists(", '.from("omnia_ai_revisioni")\n    .insert(', "stripe.checkout.sessions.create("];
  atteso("l'ordine dei controlli: accesso, scrittura, accettazioni, contatti, relazione, già pagata, prezzo, prezzo mostrato, file, registrazione, pagamento", ordine.every((v, i) => i === 0 || primaDi(azione, ordine[i - 1], v)), ordine.find((v, i) => i > 0 && !primaDi(azione, ordine[i - 1], v)));
  atteso("entrambe le accettazioni sono obbligatorie (condizioni e privacy; clausole da approvare specificamente)", /formData\.get\("acceptCondizioni"\) !== "on"\) return \{ error:/.test(azione) && /formData\.get\("acceptClausole"\) !== "on"\) return \{ error:/.test(azione));
  atteso("prima di prendere soldi il Word deve esistere davvero", /if \(!esiste\) return \{ error: "Il file Word della relazione tecnica non risulta più disponibile/.test(azione));
  atteso("il prezzo si ricalcola sempre sul server (mai quello del browser) e solo l'ora di adesso conta", /calcolaPrezzoRevisione\(\{[\s\S]*?adesso: new Date\(\)/.test(azione) && /unit_amount: prezzo\.totaleCentesimi/.test(azione) && !/unit_amount: Number\(formData/.test(azione));
  atteso("se il prezzo mostrato è diverso si ferma e dice quello nuovo", /mostrato !== prezzo\.totaleCentesimi/.test(azione) && /prezzoAggiornatoCentesimi: prezzo\.totaleCentesimi/.test(azione));
  atteso("pagamento una tantum con l'email dell'account, dati di fatturazione e partita IVA", /mode: "payment"/.test(azione) && /customer_email: user\.email/.test(azione) && /billing_address_collection: "required"/.test(azione) && /tax_id_collection: \{ enabled: true \}/.test(azione) && !/formData\.get\("email"\)/.test(azione));
  atteso("metadati per il webhook (tipo, richiesta, cliente, gara) sulla sessione e sul pagamento", /tipo: "omnia_ai_revisione", revisioneId: richiesta\.id, userId: user\.id, garaId: contesto\.gara\.id/.test(azione) && /payment_intent_data: \{ metadata \}/.test(azione) && /^[\s\S]*metadata,\n/m.test(azione));
  atteso("la richiesta NON diventa mai «pagata» da qui: solo il webhook", !/stato: "pagata"/.test(azione) && /La richiesta diventa «pagata» solo dal webhook/.test(azione));
  atteso("si registrano le accettazioni: versione, impronta sha256 del testo, IP e user agent, privacy policy", /condizioni_versione: VERSIONE_CONDIZIONI_REVISIONE/.test(azione) && /createHash\("sha256"\)\.update\(testoCanonicoCondizioniRevisione\(\)\)/.test(azione) && /accept_ip: ip/.test(azione) && /privacy_versione: documenti\?\.privacyPolicy\.version/.test(azione));
  atteso("il rientro da Stripe porta alla pagina di acquisto con l'id della richiesta", /success_url: `\$\{origin\}\/dashboard\/omnia-ai\/gare\/\$\{contesto\.gara\.id\}\/revisione\?richiesta=\$\{richiesta\.id\}`/.test(azione));
  atteso("senza la tabella (migrazione 0089) l'errore è chiaro, non un crash", /schemaAssente\(erroreInserimento\)/.test(azione) && /non è ancora disponibile/.test(azione));
  atteso("l'azione non rimanda alla console", !/console\.omniaitalia\.com|CONSOLE_BASE_URL|site-console|lib\/console/.test(azione));

  console.log("--- Webhook: il pagamento ---");
  const rotta = leggi("src/app/api/webhooks/stripe/route.ts");
  atteso("checkout.session.completed riconosce il tipo «omnia_ai_revisione»", /session\.metadata\?\.tipo === "omnia_ai_revisione"\) \{\s*await handleOmniaAiRevisioneCompleted\(session, eventoId\);\s*return;/.test(rotta));
  const gestore = corpo(rotta, "async function handleOmniaAiRevisioneCompleted(");
  atteso("solo sessioni pagate, richiesta e cliente corrispondenti", /session\.payment_status !== "paid"/.test(gestore) && /riga\.stripe_session_id !== session\.id/.test(gestore) && /session\.metadata\.userId !== riga\.user_id/.test(gestore));
  atteso("la richiesta diventa «pagata» una volta sola (aggiornamento condizionato allo stato di attesa)", /stato: "pagata"/.test(gestore) && /\.eq\("stato", "in_attesa_pagamento"\)/.test(gestore) && /importo_pagato_centesimi: session\.amount_total/.test(gestore) && /dati_stripe: session\.customer_details/.test(gestore));
  atteso("le email partono dopo la registrazione del pagamento, anche per un evento rimandato", primaDi(gestore, 'stato: "pagata"', "notificaRevisioneUmana(") && /notificaRevisioneUmana\(\{ admin, livemode: session\.livemode, eventoId, revisione, sessione: session, pagamentoDoppio \}\)/.test(gestore));
  atteso("un secondo pagamento per la stessa relazione è riconosciuto come doppione", /\.eq\("messaggio_id", riga\.messaggio_id\)/.test(gestore) && /\.neq\("id", riga\.id\)/.test(gestore) && /pagamentoDoppio = \(count \?\? 0\) > 0/.test(gestore));
  atteso("un errore nel salvataggio del pagamento si scrive nel registro del server", /errore registrazione del pagamento/.test(gestore));

  console.log("--- Email all'ufficio e al cliente: collegamento ---");
  const notifica = leggi("src/lib/omnia-ai-email-revisione.ts");
  atteso("l'ufficio riceve il Word dallo storage «gare», con chiave e tipo propri; il cliente la conferma senza allegato", /chiave: `rev:\$\{revisione\.id\}:ufficio`/.test(notifica) && /tipo: "revisione_umana_richiesta"/.test(notifica) && /allegato: \{ bucket: "gare", path: revisione\.file_path, nome: revisione\.file_nome \}/.test(notifica) && /chiave: `rev:\$\{revisione\.id\}:cliente`/.test(notifica) && /tipo: "revisione_umana_ricevuta"/.test(notifica));
  atteso("destinatario dell'ufficio e del cliente giusti", /a: EMAIL_UFFICIO/.test(notifica) && /a: cliente\.email/.test(notifica));
  const tipoUnione = (leggi("src/lib/omnia-ai-email-eventi.ts").match(/export type TipoEmailEvento =([^;]*);/) ?? [])[1] ?? "";
  atteso("i due tipi nuovi esistono nel codice", /"revisione_umana_richiesta"/.test(tipoUnione) && /"revisione_umana_ricevuta"/.test(tipoUnione));
  const mail = leggi("src/lib/email.ts");
  atteso("l'invio supporta gli allegati e li manda solo se ce ne sono", /attachments\?: \{ filename: string; content: string \}\[\]/.test(mail) && /attachments && attachments\.length > 0 \? \{ attachments \} : \{\}/.test(mail));

  console.log("--- Pulsante e pagina di acquisto ---");
  const pannello = leggi("src/app/site-omnia-ai/dashboard/omnia-ai/gare/[id]/revisione-panel.tsx");
  atteso("il pulsante dice «RICHIEDI REVISIONE UMANA» e porta alla pagina di acquisto", /RICHIEDI REVISIONE UMANA/.test(pannello) && /href=\{`\/dashboard\/omnia-ai\/gare\/\$\{garaId\}\/revisione`\}/.test(pannello));
  atteso("spiega: contatto in 5 ore lavorative, revisione in 48 ore lavorative, intestazione, piè di pagina e copertina grafica personalizzata", /consulente umano si mette in contatto personale con te <strong>entro \{REVISIONE\.oreContattoLavorative\} ore lavorative<\/strong>/.test(pannello) && /consegnata <strong>entro \{REVISIONE\.oreConsegnaLavorative\} ore lavorative<\/strong>/.test(pannello) && /intestazione, piè di pagina e copertina grafica personalizzata/.test(pannello) && /consulente umano si mette in contatto personale/.test(pannello));
  atteso("indica il prezzo della gara e le regole: da 250 a 550 €, +25% entro 72 ore, +50% entro 48, non gestibile sotto 47", /Prezzo per questa gara/.test(pannello) && /prezzoBaseCentesimi/.test(pannello) && /prezzoMassimoCentesimi/.test(pannello) && /oreMaggiorazione25/.test(pannello) && /maggiorazione25/.test(pannello) && /oreMaggiorazione50/.test(pannello) && /maggiorazione50/.test(pannello) && /oreMinimePerGestire/.test(pannello));
  atteso("con la gara troppo vicina o scaduta niente pulsante: il messaggio al suo posto", /!esito\.ok \?/.test(pannello) && primaDi(pannello, "!esito.ok", "RICHIEDI REVISIONE UMANA"));
  atteso("a revisione già pagata niente pulsante, solo lo stato", primaDi(pannello, "pagata ?", "!esito.ok ?") && /Revisione umana richiesta/.test(pannello));
  const paginaGara = leggi("src/app/site-omnia-ai/dashboard/omnia-ai/gare/[id]/page.tsx");
  atteso("il riquadro compare nella gara solo se esiste la relazione finale", /\{contestoRevisione\?\.relazione && esitoRevisione && <RevisionePanel garaId=\{gara\.id\} esito=\{esitoRevisione\} pagata=\{contestoRevisione\.pagata\} \/>\}/.test(paginaGara) && /contestoRevisione\?\.relazione\s*\?\s*calcolaPrezzoRevisione\(/.test(paginaGara));
  atteso("il prezzo della gara usa la prescrizione del disciplinare e le pagine della relazione", /limitePagineDisciplinare: gara\.limite_pagine_totale/.test(paginaGara) && /pagineStimateRelazione: contestoRevisione\.relazione\.pagineStimate/.test(paginaGara));
  const paginaAcquisto = leggi("src/app/site-omnia-ai/dashboard/omnia-ai/gare/[id]/revisione/page.tsx");
  atteso("pagina di acquisto: serve il login, un abbonamento attivo o in prova, e la relazione finale", /if \(!user \|\| !user\.email\) redirect\("\/login"\)/.test(paginaAcquisto) && /stato\.stato !== "attivo" && stato\.stato !== "prova"/.test(paginaAcquisto) && /!contesto\.relazione/.test(paginaAcquisto));
  atteso("pagina di acquisto: ricalcola il prezzo con le stesse regole e mostra il modulo solo se il prezzo c'è", /calcolaPrezzoRevisione\(/.test(paginaAcquisto) && /if \(!esito\.ok\)/.test(paginaAcquisto) && /<RevisioneForm/.test(paginaAcquisto));
  atteso("pagina di acquisto: a gara già richiesta lo dice, e al ritorno da Stripe distingue pagata e in conferma", /contesto\.pagata/.test(paginaAcquisto) && /Richiesta inviata/.test(paginaAcquisto) && /Stiamo confermando il pagamento/.test(paginaAcquisto) && /richiesta\?\.stato === "pagata"/.test(paginaAcquisto));
  const modulo = leggi("src/app/site-omnia-ai/dashboard/omnia-ai/gare/[id]/revisione/revisione-form.tsx");
  atteso("modulo: referente (nome, email, cellulare), prezzo mostrato nascosto, due consensi obbligatori", /name="referenteNome"/.test(modulo) && /name="referenteEmail"/.test(modulo) && /name="referenteCellulare"/.test(modulo) && /name="prezzoMostratoCentesimi" value=\{totale\}/.test(modulo) && /name="acceptCondizioni"[\s\S]{0,160}checked=\{accettaCondizioni\}[\s\S]{0,160}required/.test(modulo) && /name="acceptClausole"[\s\S]{0,160}checked=\{approvaClausole\}[\s\S]{0,160}required/.test(modulo));
  atteso("modulo: il pulsante di pagamento resta spento finché non si accetta e non si compilano i contatti", /const puoProcedere = accettaCondizioni && approvaClausole && nome\.trim\(\) !== "" && email\.trim\(\) !== "" && cellulare\.trim\(\) !== "";/.test(modulo) && /disabled=\{!puoProcedere \|\| inCorso\}/.test(modulo));
  atteso("modulo: mostra le condizioni per intero, gli impegni e il prezzo con la maggiorazione", /CLAUSOLE_REVISIONE\.map/.test(modulo) && /entro <strong>\{REVISIONE\.oreContattoLavorative\} ore lavorative/i.test(modulo) && /Maggiorazione per urgenza/.test(modulo) && /Totale da pagare/.test(modulo));
  atteso("modulo: se il prezzo cambia mentre si compila, mostra quello nuovo e chiede di confermare di nuovo", /stato\.prezzoAggiornatoCentesimi \?\? prezzo\.totaleCentesimi/.test(modulo) && /Il prezzo è stato aggiornato in base alla scadenza/.test(modulo));
  atteso("la pagina e il modulo non rimandano alla console", ![paginaAcquisto, modulo, pannello].some((t) => /console\.omniaitalia\.com|CONSOLE_BASE_URL|site-console|lib\/console/.test(t)));

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
