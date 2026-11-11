// Autotest di CHI può generare la copertina della relazione tecnica e quante volte (richiesta dell'utente, 11/11/2026): impostazioni per cliente dalla console
// (acceso/spento, gratis con numero di gare e scadenza, a pagamento con prezzo) e al massimo 3 generazioni per stile e per gara.
// Controlla, senza rete né database (client finti e controlli sul testo dei sorgenti):
//   - le regole: servizio spento di base, gratis (gare in tutto, scadenza con l'ultimo giorno incluso, una gara usa una gara gratis alla prima copertina),
//     a pagamento (prezzo detto, ma il pagamento online non c'è: non si genera), limite di 3 per stile indipendente tra i due stili;
//   - le generazioni che contano (pronte, e in corso da poco; non quelle cancellate né interrotte da oltre 20 minuti);
//   - il modulo della console: tutto rivisto sul server, ciò che non vale per la modalità scelta si RIFIUTA;
//   - la tolleranza alla migrazione 0106 non eseguita (online spento, in locale aperto per le prove) e il registro delle generazioni;
//   - l'azione che genera: l'ordine dei controlli, la riga registrata e poi chiusa o cancellata, il download anche a servizio spento;
//   - la scheda della console e la pagina della gara: il testo giusto, nessuna dicitura di «prova».
// Gratuito: gira nel livello 1, quindi in prebuild.
import fs from "fs";
import path from "path";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  COPERTINE_PER_STILE,
  LIMITE_GARE_GRATIS,
  LIMITI_PREZZO_COPERTINA,
  MESSAGGIO_COPERTINA_SPENTA,
  MINUTI_GENERAZIONE_INTERROTTA,
  copertinaVisibile,
  descriviImpostazioniCopertina,
  generazioniContate,
  impostazioniDaRiga,
  messaggioLimiteStile,
  righeGratisPerCliente,
  usoDaRighe,
  validaImpostazioniCopertina,
  valutaDirittoCopertina,
  type ContestoDirittoCopertina,
  type ImpostazioniCopertina,
  type RigaGenerazione,
} from "../src/lib/copertina-diritto-calcoli";
import { annullaCopertina, completaCopertina, decidi, leggiContestoCopertina, riservaCopertina, sviluppoLocale } from "../src/lib/copertina-diritto";
import type { Stile } from "../src/lib/copertina-relazione-calcoli";

const fallimenti: string[] = [];
function atteso(nome: string, ok: boolean, dettaglio = "") {
  console.log(`${ok ? "ok    " : "FALLITO"} ${nome}${ok ? "" : ` — ${dettaglio}`}`);
  if (!ok) fallimenti.push(nome);
}
const leggi = (relativo: string) => fs.readFileSync(path.join(__dirname, "..", relativo), "utf-8").replace(/\r\n/g, "\n");

const GARA = "aaaaaaaa-1111-4111-8111-111111111111";
const ALTRA_1 = "bbbbbbbb-1111-4111-8111-111111111111";
const ALTRA_2 = "cccccccc-1111-4111-8111-111111111111";
const UTENTE = "dddddddd-1111-4111-8111-111111111111";
const ADESSO = new Date("2026-11-11T10:00:00Z");
const OGGI = "2026-11-11";

const gratis = (extra: Partial<ImpostazioniCopertina> = {}): ImpostazioniCopertina => ({ attivo: true, modalita: "gratis", prezzoCentesimi: null, gareMassime: null, scadeIl: null, nota: null, ...extra });
const pagamento = (extra: Partial<ImpostazioniCopertina> = {}): ImpostazioniCopertina => ({ attivo: true, modalita: "pagamento", prezzoCentesimi: 4900, gareMassime: null, scadeIl: null, nota: null, ...extra });
const uso = (extra: { gare?: string[]; stilizzato?: number; realistico?: number } = {}) => ({ gareGratisUsate: extra.gare ?? [], perStile: { stilizzato: extra.stilizzato ?? 0, realistico: extra.realistico ?? 0 } });
function ctx(extra: Partial<ContestoDirittoCopertina> = {}): ContestoDirittoCopertina {
  return { impostazioni: gratis(), schemaAssente: false, sviluppoLocale: false, oggi: OGGI, garaId: GARA, uso: uso(), stile: "stilizzato", acquistata: false, pagamentoDisponibile: false, ...extra };
}

// Un client finto del database: ogni lettura/scrittura risponde con ciò che il test ha preparato, e le scritture si registrano
function falsoAdmin(risposte: Record<string, { data?: unknown; error?: { code?: string; message?: string } | null }>) {
  const chiamate: { tabella: string; op: string; riga?: unknown; filtri: [string, unknown][] }[] = [];
  const risposta = (tabella: string, op: string) => ({ data: null, error: null, ...(risposte[`${tabella}:${op}`] ?? {}) });
  const admin = {
    from(tabella: string) {
      const filtri: [string, unknown][] = [];
      let op = "lettura";
      let riga: unknown;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const q: any = {
        select: () => q,
        eq: (k: string, v: unknown) => {
          filtri.push([k, v]);
          return q;
        },
        limit: () => q,
        returns: () => q,
        insert: (r: unknown) => {
          op = "inserimento";
          riga = r;
          return q;
        },
        update: (r: unknown) => {
          op = "aggiornamento";
          riga = r;
          return q;
        },
        delete: () => {
          op = "cancellazione";
          return q;
        },
        maybeSingle: async () => risposta(tabella, "lettura"),
        single: async () => {
          chiamate.push({ tabella, op, riga, filtri });
          return risposta(tabella, op);
        },
        then: (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => {
          if (op !== "lettura") chiamate.push({ tabella, op, riga, filtri });
          return Promise.resolve(risposta(tabella, op)).then(ok, ko);
        },
      };
      return q;
    },
  };
  return { admin: admin as unknown as SupabaseClient, chiamate };
}

const rigaDb = (extra: Record<string, unknown> = {}) => ({ user_id: UTENTE, attivo: true, modalita: "gratis", prezzo_centesimi: null, gare_massime: null, scade_il: null, nota: null, ...extra });
const gen = (gara: string, stile: Stile, extra: Partial<RigaGenerazione> = {}): RigaGenerazione => ({ gara_id: gara, stile, stato: "pronta", fonte: "gratis", creata_il: "2026-11-11T09:00:00Z", ...extra });
const NON_ESISTE = { code: "PGRST205", message: "Could not find the table 'public.gara_copertine' in the schema cache" };

async function main() {
  console.log("--- Servizio spento di base ---");
  {
    const senza = valutaDirittoCopertina(ctx({ impostazioni: null }));
    atteso("senza impostazioni il servizio è spento, con il messaggio per il cliente", !senza.ok && senza.motivo === "spento" && senza.messaggio === MESSAGGIO_COPERTINA_SPENTA);
    atteso("impostazioni con il servizio spento: spento", (() => { const e = valutaDirittoCopertina(ctx({ impostazioni: gratis({ attivo: false }) })); return !e.ok && e.motivo === "spento"; })());
    atteso("acceso e gratis senza limiti: si può generare", (() => { const e = valutaDirittoCopertina(ctx()); return e.ok && e.fonte === "gratis"; })());
    atteso("spento batte tutto il resto (anche con il limite per stile raggiunto)", (() => { const e = valutaDirittoCopertina(ctx({ impostazioni: gratis({ attivo: false }), uso: uso({ stilizzato: 3 }) })); return !e.ok && e.motivo === "spento"; })());
    atteso("il riquadro è visibile solo se il servizio è acceso", copertinaVisibile({ impostazioni: gratis(), schemaAssente: false, sviluppoLocale: false }) && !copertinaVisibile({ impostazioni: null, schemaAssente: false, sviluppoLocale: false }) && !copertinaVisibile({ impostazioni: gratis({ attivo: false }), schemaAssente: false, sviluppoLocale: true }));
  }

  console.log("--- Gratis: gare in tutto e scadenza ---");
  {
    const prima = valutaDirittoCopertina(ctx({ impostazioni: gratis({ gareMassime: 2 }) }));
    atteso("una gara nuova con posto nelle gare gratis: si può, e USA una gara gratis", prima.ok && prima.consumaGara === true);
    const seconda = valutaDirittoCopertina(ctx({ impostazioni: gratis({ gareMassime: 2 }), uso: uso({ gare: [GARA, ALTRA_1] }) }));
    atteso("una gara che ne ha già usata una: le altre copertine NON ne usano altre", seconda.ok && seconda.consumaGara === false);
    const finite = valutaDirittoCopertina(ctx({ impostazioni: gratis({ gareMassime: 2 }), uso: uso({ gare: [ALTRA_1, ALTRA_2] }) }));
    atteso("gare gratis finite per una gara nuova: no, con il messaggio che dice quante erano", !finite.ok && finite.motivo === "gare_finite" && /2 gare gratis incluse/.test(finite.messaggio));
    atteso("con UNA sola gara gratis il messaggio è al singolare", (() => { const e = valutaDirittoCopertina(ctx({ impostazioni: gratis({ gareMassime: 1 }), uso: uso({ gare: [ALTRA_1] }) })); return !e.ok && /1 gara gratis inclusa/.test(e.messaggio); })());
    atteso("senza limite di gare: mai «finite»", (() => { const e = valutaDirittoCopertina(ctx({ uso: uso({ gare: [ALTRA_1, ALTRA_2, "e", "f", "g"] }) })); return e.ok && e.consumaGara === true; })());
    atteso("limite di gare = quante ne ha già usate la stessa gara non blocca le sue copertine", valutaDirittoCopertina(ctx({ impostazioni: gratis({ gareMassime: 1 }), uso: uso({ gare: [GARA] }) })).ok);

    const scaduta = valutaDirittoCopertina(ctx({ impostazioni: gratis({ scadeIl: "2026-11-10" }) }));
    atteso("scadenza passata (ieri): no, con la data nel messaggio", !scaduta.ok && scaduta.motivo === "scaduto" && /10\/11\/2026/.test(scaduta.messaggio));
    atteso("scadenza oggi: si può ancora (l'ultimo giorno è incluso)", valutaDirittoCopertina(ctx({ impostazioni: gratis({ scadeIl: OGGI }) })).ok);
    atteso("scadenza domani: si può", valutaDirittoCopertina(ctx({ impostazioni: gratis({ scadeIl: "2026-11-12" }) })).ok);
    atteso("scaduto vale anche per una gara che ha già usato la sua gara gratis", (() => { const e = valutaDirittoCopertina(ctx({ impostazioni: gratis({ scadeIl: "2026-11-10", gareMassime: 5 }), uso: uso({ gare: [GARA] }) })); return !e.ok && e.motivo === "scaduto"; })());
  }

  console.log("--- A pagamento ---");
  {
    const e = valutaDirittoCopertina(ctx({ impostazioni: pagamento() }));
    atteso("a pagamento: non si genera (il pagamento online non c'è ancora)", !e.ok && e.motivo === "a_pagamento");
    atteso("il messaggio dice il prezzo per gara con l'IVA e che il pagamento non c'è ancora", !e.ok && /49/.test(e.messaggio) && /a gara/.test(e.messaggio) && /IVA inclusa/.test(e.messaggio) && /non è ancora disponibile/.test(e.messaggio));
    atteso("prezzo con i centesimi detto con i centesimi", (() => { const x = valutaDirittoCopertina(ctx({ impostazioni: pagamento({ prezzoCentesimi: 4950 }) })); return !x.ok && /49,50/.test(x.messaggio); })());
    atteso("a pagamento ma spento: spento (prima di tutto)", (() => { const x = valutaDirittoCopertina(ctx({ impostazioni: pagamento({ attivo: false }) })); return !x.ok && x.motivo === "spento"; })());
  }

  console.log("--- Al massimo 3 generazioni per stile e per gara ---");
  {
    atteso("il massimo è 3", COPERTINE_PER_STILE === 3);
    atteso("2 stilizzate: la terza si può", valutaDirittoCopertina(ctx({ uso: uso({ stilizzato: 2 }) })).ok);
    const quarta = valutaDirittoCopertina(ctx({ uso: uso({ stilizzato: 3 }) }));
    atteso("3 stilizzate: la quarta no, con il messaggio dello stile", !quarta.ok && quarta.motivo === "limite_stile" && quarta.messaggio === messaggioLimiteStile("stilizzato") && /3 generazioni in stile stilizzato/.test(quarta.messaggio));
    atteso("i due stili sono indipendenti: 3 stilizzate non tolgono le realistiche", valutaDirittoCopertina(ctx({ stile: "realistico", uso: uso({ stilizzato: 3, realistico: 0 }) })).ok);
    atteso("3 realistiche: la quarta realistica no, e il messaggio dice «realistico»", (() => { const e = valutaDirittoCopertina(ctx({ stile: "realistico", uso: uso({ realistico: 3 }) })); return !e.ok && e.motivo === "limite_stile" && /stile realistico/.test(e.messaggio); })());
    atteso("il limite vale anche per chi ha le gare gratis senza limiti", !valutaDirittoCopertina(ctx({ impostazioni: gratis({ gareMassime: null, scadeIl: null }), uso: uso({ realistico: 5 }), stile: "realistico" })).ok);
    atteso("la scadenza e le gare finite vengono PRIMA del limite per stile", (() => { const e = valutaDirittoCopertina(ctx({ impostazioni: gratis({ scadeIl: "2026-11-01" }), uso: uso({ stilizzato: 3 }) })); return !e.ok && e.motivo === "scaduto"; })());
  }

  console.log("--- Migrazione 0106 non eseguita ---");
  {
    atteso("online (senza le tabelle) il servizio è spento", (() => { const e = valutaDirittoCopertina(ctx({ schemaAssente: true, impostazioni: null, sviluppoLocale: false })); return !e.ok && e.motivo === "spento"; })());
    atteso("in locale (senza le tabelle) resta aperto per le prove, fonte «sviluppo», senza usare gare gratis", (() => { const e = valutaDirittoCopertina(ctx({ schemaAssente: true, impostazioni: null, sviluppoLocale: true })); return e.ok && e.fonte === "sviluppo" && e.consumaGara === false; })());
    atteso("in locale senza tabelle il limite di 3 per stile vale lo stesso", !valutaDirittoCopertina(ctx({ schemaAssente: true, impostazioni: null, sviluppoLocale: true, uso: uso({ stilizzato: 3 }) })).ok);
    atteso("in locale CON le tabelle valgono le impostazioni (nessuna apertura nascosta)", (() => { const e = valutaDirittoCopertina(ctx({ schemaAssente: false, impostazioni: null, sviluppoLocale: true })); return !e.ok && e.motivo === "spento"; })());
    atteso("il riquadro, senza le tabelle: visibile solo in locale", copertinaVisibile({ impostazioni: null, schemaAssente: true, sviluppoLocale: true }) && !copertinaVisibile({ impostazioni: null, schemaAssente: true, sviluppoLocale: false }));
    atteso("sviluppo locale: non in produzione e non su Vercel", sviluppoLocale({ NODE_ENV: "development" }) && sviluppoLocale({}) && !sviluppoLocale({ NODE_ENV: "production" }) && !sviluppoLocale({ VERCEL: "1" }));
  }

  console.log("--- Le generazioni che contano ---");
  {
    const righe: RigaGenerazione[] = [
      gen(GARA, "stilizzato"),
      gen(GARA, "stilizzato", { creata_il: "2026-11-11T09:59:00Z", stato: "in_corso" }),
      gen(GARA, "realistico", { creata_il: "2026-11-11T09:20:00Z", stato: "in_corso" }),
      gen(ALTRA_1, "stilizzato"),
      gen(ALTRA_1, "realistico", { fonte: "sviluppo" }),
      gen(ALTRA_2, "stilizzato", { fonte: "pagamento" }),
    ];
    atteso(`una generazione in corso da più di ${MINUTI_GENERAZIONE_INTERROTTA} minuti si considera interrotta e non conta`, generazioniContate(righe, ADESSO).length === 5);
    const u = usoDaRighe(righe, GARA, ADESSO);
    atteso("per questa gara: 2 stilizzate (una pronta e una in corso da poco), 0 realistiche (quella in corso è interrotta)", u.perStile.stilizzato === 2 && u.perStile.realistico === 0);
    atteso("le gare gratis usate: solo quelle con una copertina «gratis» (non «sviluppo» né «pagamento»), distinte", u.gareGratisUsate.length === 2 && u.gareGratisUsate.includes(GARA) && u.gareGratisUsate.includes(ALTRA_1));
    atteso("la copertina in corso da poco conta anche per le gare gratis (così due clic veloci non usano due gare)", usoDaRighe([gen(ALTRA_2, "stilizzato", { stato: "in_corso", creata_il: "2026-11-11T09:58:00Z" })], GARA, ADESSO).gareGratisUsate.includes(ALTRA_2));
    atteso("una riga con uno stato o uno stile sconosciuto non conta", generazioniContate([{ ...gen(GARA, "stilizzato"), stato: "boh" as never }], ADESSO).length === 0 && usoDaRighe([{ ...gen(GARA, "stilizzato"), stile: "cartoon" as never }], GARA, ADESSO).perStile.stilizzato === 0);
    atteso("una data illeggibile in una riga «in corso»: non conta (nessuna eccezione)", generazioniContate([gen(GARA, "stilizzato", { stato: "in_corso", creata_il: "ieri" })], ADESSO).length === 0);
  }

  console.log("--- La riga delle impostazioni ---");
  {
    const imp = impostazioniDaRiga(rigaDb({ gare_massime: 3, scade_il: "2026-12-31T00:00:00+00:00", nota: " prova " }));
    atteso("riga valida: campi letti, data tagliata al giorno", imp?.attivo === true && imp.modalita === "gratis" && imp.gareMassime === 3 && imp.scadeIl === "2026-12-31" && imp.nota === " prova ");
    atteso("modalità sconosciuta, riga vuota o non oggetto: nessuna impostazione (servizio spento), senza eccezioni", impostazioniDaRiga(rigaDb({ modalita: "regalo" })) === null && impostazioniDaRiga(null) === null && impostazioniDaRiga("x") === null);
    atteso("«attivo» solo se è proprio vero (una stringa «true» no)", impostazioniDaRiga(rigaDb({ attivo: "true" }))?.attivo === false);
    atteso("numeri strani (negativi, frazioni, testo) diventano «nessun valore»", (() => { const i = impostazioniDaRiga(rigaDb({ gare_massime: -1, prezzo_centesimi: 4.5 })); return i?.gareMassime === null && i.prezzoCentesimi === null; })());
  }

  console.log("--- Cosa legge il cliente e cosa legge la console ---");
  {
    atteso("gratis senza limite: lo dice", righeGratisPerCliente(gratis(), uso(), GARA).join(" ").includes("senza limite di gare"));
    const nuova = righeGratisPerCliente(gratis({ gareMassime: 5 }), uso({ gare: [ALTRA_1, ALTRA_2] }), GARA).join(" ");
    atteso("gare gratis rimaste, e che la prima copertina di una gara nuova ne usa una", /ti restano 3 gare gratis su 5/.test(nuova) && /ne usa una/.test(nuova));
    const usata = righeGratisPerCliente(gratis({ gareMassime: 5 }), uso({ gare: [GARA, ALTRA_1] }), GARA).join(" ");
    atteso("una gara che ne ha già usata una lo dice, con quante ne restano", /questa gara usa già una delle tue 5 gare gratis \(te ne restano 3\)/.test(usata));
    atteso("l'ultima gara gratis rimasta: al singolare", /ti resta 1 gara gratis su 2/.test(righeGratisPerCliente(gratis({ gareMassime: 2 }), uso({ gare: [ALTRA_1] }), GARA).join(" ")));
    atteso("la scadenza si dice in formato italiano", righeGratisPerCliente(gratis({ scadeIl: "2026-12-31" }), uso(), GARA).join(" ").includes("Gratis fino al 31/12/2026."));
    atteso("a pagamento, spento o senza impostazioni: nessuna riga «gratis»", righeGratisPerCliente(pagamento(), uso(), GARA).length === 0 && righeGratisPerCliente(gratis({ attivo: false }), uso(), GARA).length === 0 && righeGratisPerCliente(null, uso(), GARA).length === 0);
    atteso("console: mai configurato, spento, acceso gratis, acceso a pagamento", descriviImpostazioniCopertina(null).startsWith("Spento") && descriviImpostazioniCopertina(gratis({ attivo: false })) === "Spento." && descriviImpostazioniCopertina(gratis({ gareMassime: 5, scadeIl: "2026-12-31" })) === "Acceso, gratis: fino a 5 gare, fino al 31/12/2026." && /Acceso, a pagamento: .*49.* a gara \(IVA inclusa\)/.test(descriviImpostazioniCopertina(pagamento())));
    atteso("console: gratis senza limiti né scadenza", descriviImpostazioniCopertina(gratis()) === "Acceso, gratis: senza limite di gare, senza scadenza.");
  }

  console.log("--- Il modulo della console: tutto rivisto sul server ---");
  {
    const ok = { stato: "acceso", modalita: "gratis", prezzo: "", gareMassime: "3", scadeIl: "2026-12-31", nota: "" };
    const v = (extra: Partial<typeof ok> = {}, oggi = OGGI) => validaImpostazioniCopertina({ ...ok, ...extra }, oggi);

    const gratisOk = v();
    atteso("gratis con 3 gare e scadenza: valori letti", gratisOk.ok && gratisOk.valori.attivo && gratisOk.valori.modalita === "gratis" && gratisOk.valori.gareMassime === 3 && gratisOk.valori.scadeIl === "2026-12-31" && gratisOk.valori.prezzoCentesimi === null);
    const senzaLimiti = v({ gareMassime: "", scadeIl: "" });
    atteso("gratis senza numero di gare né scadenza: valido (senza limite)", senzaLimiti.ok && senzaLimiti.valori.gareMassime === null && senzaLimiti.valori.scadeIl === null);
    const paga = v({ modalita: "pagamento", prezzo: "49,90", gareMassime: "", scadeIl: "" });
    atteso("a pagamento con prezzo: centesimi, niente gare né scadenza", paga.ok && paga.valori.prezzoCentesimi === 4990 && paga.valori.gareMassime === null && paga.valori.scadeIl === null);
    atteso("spento: valido", v({ stato: "spento" }).ok);
    atteso("stato o modalità mancanti o strani: rifiutati", !v({ stato: "" }).ok && !v({ stato: "forse" }).ok && !v({ modalita: "" }).ok && !v({ modalita: "regalo" }).ok);

    atteso("a pagamento senza prezzo o con prezzo illeggibile: rifiutato", !v({ modalita: "pagamento", prezzo: "", gareMassime: "", scadeIl: "" }).ok && !v({ modalita: "pagamento", prezzo: "tanto", gareMassime: "", scadeIl: "" }).ok);
    atteso("prezzo fuori misura (sotto 1 € o sopra 1.000 €): rifiutato con i limiti", (() => { const sotto = v({ modalita: "pagamento", prezzo: "0,50", gareMassime: "", scadeIl: "" }); const sopra = v({ modalita: "pagamento", prezzo: "1000,01", gareMassime: "", scadeIl: "" }); return !sotto.ok && !sopra.ok && /tra .*1.* e .*1\.?000/.test(sotto.ok ? "" : sotto.errore); })());
    atteso("prezzo ai limiti: accettato (1 € e 1.000 €)", v({ modalita: "pagamento", prezzo: "1", gareMassime: "", scadeIl: "" }).ok && v({ modalita: "pagamento", prezzo: "1000", gareMassime: "", scadeIl: "" }).ok && LIMITI_PREZZO_COPERTINA.minimoCentesimi === 100 && LIMITI_PREZZO_COPERTINA.massimoCentesimi === 100000);
    atteso("a pagamento con numero di gare o scadenza: RIFIUTATO (non ignorato in silenzio)", (() => { const a = v({ modalita: "pagamento", prezzo: "49", gareMassime: "3", scadeIl: "" }); const b = v({ modalita: "pagamento", prezzo: "49", gareMassime: "", scadeIl: "2026-12-31" }); return !a.ok && !b.ok && /solo per il servizio gratis/.test(a.ok ? "" : a.errore); })());
    atteso("gratis con un prezzo: RIFIUTATO", (() => { const e = v({ prezzo: "49" }); return !e.ok && /solo per il servizio a pagamento/.test(e.errore); })());

    atteso("numero di gare: da 1 a 1000, intero", !v({ gareMassime: "0" }).ok && !v({ gareMassime: "-2" }).ok && !v({ gareMassime: "2,5" }).ok && !v({ gareMassime: "abc" }).ok && !v({ gareMassime: String(LIMITE_GARE_GRATIS + 1) }).ok && v({ gareMassime: "1" }).ok && v({ gareMassime: "1000" }).ok);
    atteso("scadenza non valida o di formato strano: rifiutata", !v({ scadeIl: "31/12/2026" }).ok && !v({ scadeIl: "2026-13-45" }).ok && !v({ scadeIl: "domani" }).ok);
    atteso("scadenza già passata: rifiutata se si ACCENDE, accettata se si spegne (si può spegnere un servizio scaduto)", !v({ scadeIl: "2026-11-10" }).ok && v({ scadeIl: "2026-11-10", stato: "spento" }).ok);
    atteso("scadenza di oggi: accettata", v({ scadeIl: OGGI }).ok);
    atteso("nota: tagliata al limite, rifiutata se più lunga; vuota = nessuna nota", !v({ nota: "x".repeat(301) }).ok && (() => { const e = v({ nota: "  " }); return e.ok && e.valori.nota === null; })() && (() => { const e = v({ nota: " prova " }); return e.ok && e.valori.nota === "prova"; })());
  }

  console.log("--- Il database (finto): letture, registro delle generazioni ---");
  {
    const normale = falsoAdmin({
      "omnia_ai_copertina_impostazioni:lettura": { data: rigaDb({ gare_massime: 2 }) },
      "gara_copertine:lettura": { data: [gen(GARA, "stilizzato"), gen(ALTRA_1, "realistico"), gen(GARA, "realistico", { fonte: "sviluppo" })] },
    });
    const letto = await leggiContestoCopertina({ admin: normale.admin, accountId: UTENTE, garaId: GARA, adesso: ADESSO });
    atteso("contesto letto: impostazioni, gare gratis usate e generazioni di questa gara", !letto.errore && !letto.schemaAssente && letto.impostazioni?.gareMassime === 2 && letto.uso.gareGratisUsate.length === 2 && letto.uso.perStile.stilizzato === 1 && letto.uso.perStile.realistico === 1 && letto.oggi === OGGI);
    atteso("e la decisione sul contesto letto torna", (() => { const e = decidi(letto, GARA, "stilizzato", {}); return e.ok && e.consumaGara === false; })());

    const senzaTabella = falsoAdmin({ "omnia_ai_copertina_impostazioni:lettura": { error: NON_ESISTE } });
    const l1 = await leggiContestoCopertina({ admin: senzaTabella.admin, accountId: UTENTE, garaId: GARA, adesso: ADESSO });
    atteso("tabella delle impostazioni assente: «schema assente», nessun errore", l1.schemaAssente && !l1.errore && l1.impostazioni === null);
    atteso("e online decide «spento», in locale «aperto» (prove)", (() => { const online = decidi(l1, GARA, "stilizzato", { NODE_ENV: "production" }); const locale = decidi(l1, GARA, "stilizzato", { NODE_ENV: "development" }); return !online.ok && locale.ok && locale.fonte === "sviluppo"; })());

    const senzaRegistro = falsoAdmin({ "omnia_ai_copertina_impostazioni:lettura": { data: rigaDb() }, "gara_copertine:lettura": { error: NON_ESISTE } });
    const l2 = await leggiContestoCopertina({ admin: senzaRegistro.admin, accountId: UTENTE, garaId: GARA, adesso: ADESSO });
    atteso("registro delle generazioni assente: «schema assente» (le due tabelle vanno insieme)", l2.schemaAssente && !l2.errore);

    const guasto = falsoAdmin({ "omnia_ai_copertina_impostazioni:lettura": { error: { code: "XX000", message: "boom" } } });
    const l3 = await leggiContestoCopertina({ admin: guasto.admin, accountId: UTENTE, garaId: GARA, adesso: ADESSO });
    atteso("errore qualunque nella lettura: «errore» (nel dubbio non si decide, non si apre)", l3.errore && !l3.schemaAssente);
    const guastoRegistro = falsoAdmin({ "omnia_ai_copertina_impostazioni:lettura": { data: rigaDb() }, "gara_copertine:lettura": { error: { code: "XX000", message: "boom" } } });
    atteso("errore nella lettura delle generazioni: «errore»", (await leggiContestoCopertina({ admin: guastoRegistro.admin, accountId: UTENTE, garaId: GARA, adesso: ADESSO })).errore);

    // il registro
    const ok = falsoAdmin({ "gara_copertine:inserimento": { data: { id: "riga-1" } } });
    const r = await riservaCopertina(ok.admin, { garaId: GARA, userId: UTENTE, stile: "realistico", fonte: "gratis" });
    const inserita = ok.chiamate.find((c) => c.op === "inserimento")?.riga as Record<string, unknown> | undefined;
    atteso("riserva: scrive la riga «in corso» con gara, titolare, stile e fonte", r.stato === "ok" && r.id === "riga-1" && inserita?.gara_id === GARA && inserita.user_id === UTENTE && inserita.stile === "realistico" && inserita.fonte === "gratis" && inserita.stato === "in_corso");
    atteso("riserva senza tabella: «schema_assente»; con altro errore: «errore»", (await riservaCopertina(falsoAdmin({ "gara_copertine:inserimento": { error: NON_ESISTE } }).admin, { garaId: GARA, userId: UTENTE, stile: "stilizzato", fonte: "sviluppo" })).stato === "schema_assente" && (await riservaCopertina(falsoAdmin({ "gara_copertine:inserimento": { error: { code: "23505", message: "dup" } } }).admin, { garaId: GARA, userId: UTENTE, stile: "stilizzato", fonte: "gratis" })).stato === "errore");

    const chiusura = falsoAdmin({});
    await completaCopertina(chiusura.admin, "riga-1", "20261111T100000Z");
    const agg = chiusura.chiamate.find((c) => c.op === "aggiornamento");
    atteso("completa: la riga diventa «pronta» con la marca dei file", (agg?.riga as Record<string, unknown>)?.stato === "pronta" && (agg?.riga as Record<string, unknown>)?.marca === "20261111T100000Z" && agg?.filtri[0][0] === "id" && agg?.filtri[0][1] === "riga-1");
    const annullo = falsoAdmin({});
    await annullaCopertina(annullo.admin, "riga-1");
    atteso("annulla: la riga si cancella (una generazione non riuscita non conta)", annullo.chiamate.some((c) => c.op === "cancellazione" && c.filtri[0][1] === "riga-1"));
    atteso("un errore nel chiudere o cancellare non lancia eccezioni (la generazione non va persa)", await completaCopertina(falsoAdmin({ "gara_copertine:aggiornamento": { error: { message: "x" } } }).admin, "r", "m").then(() => true) && (await annullaCopertina(falsoAdmin({ "gara_copertine:cancellazione": { error: { message: "x" } } }).admin, "r").then(() => true)));
  }

  console.log("--- Migrazione ---");
  {
    const sql = leggi("supabase/migrations/0106_copertine_relazione.sql");
    atteso("la migrazione crea le due tabelle, additiva e idempotente", /create table if not exists public\.omnia_ai_copertina_impostazioni/.test(sql) && /create table if not exists public\.gara_copertine/.test(sql) && !/drop table|drop column|delete from/i.test(sql));
    atteso("impostazioni: spento di base, forma coerente tra modalità, prezzo e limiti", /attivo boolean not null default false/.test(sql) && /modalita in \('gratis', 'pagamento'\)/.test(sql) && /modalita = 'pagamento' and prezzo_centesimi is not null and gare_massime is null and scade_il is null/.test(sql) && /modalita = 'gratis' and prezzo_centesimi is null/.test(sql) && /gare_massime between 1 and 1000/.test(sql) && /prezzo_centesimi between 100 and 100000/.test(sql));
    atteso("registro: stile, stato e fonte vincolati, cancellato con la gara e con il cliente", /stile in \('stilizzato', 'realistico'\)/.test(sql) && /stato in \('in_corso', 'pronta'\)/.test(sql) && /fonte in \('gratis', 'pagamento', 'sviluppo'\)/.test(sql) && /gara_id uuid not null references public\.gare \(id\) on delete cascade/.test(sql) && /user_id uuid not null references public\.users \(id\) on delete cascade/.test(sql));
    atteso("permessi: RLS attiva e nessun permesso ai ruoli utente (solo la chiave di servizio)", (sql.match(/enable row level security/g) ?? []).length === 2 && !/to authenticated|to anon/.test(sql) && /to service_role/.test(sql));
    atteso("le impostazioni non si cancellano (si spegne): nessun delete concesso", /grant select, insert, update on public\.omnia_ai_copertina_impostazioni to service_role/.test(sql));
    atteso("la migrazione spiega come accendere un cliente a mano", /insert into public\.omnia_ai_copertina_impostazioni/.test(sql));
  }

  console.log("--- L'azione che genera ---");
  {
    const azione = leggi("src/app/actions/gara-copertina.ts");
    const generazione = azione.slice(azione.indexOf("export async function generaCopertinaGara"), azione.indexOf("export type DownloadCopertinaState"));
    const ordine = ["richiediAccountAzione()", "accessoNegatoPerAccount(", "normalizzaStile(formData.get(\"stile\"))", "estrazione_stato !== \"completata\"", "documentoId", ".endsWith(\".pdf\")", "leggiContestoCopertina(", "decidi(ctx", "riservaCopertina(", "generaCopertina(", "completaCopertina(", "annullaCopertina("].map((s) => generazione.indexOf(s));
    atteso("ordine: sessione, sola lettura, stile, analisi, documento, impostazioni del cliente, decisione, registro, generazione, chiusura o cancellazione", ordine.every((p, i) => p >= 0 && (i === 0 || p > ordine[i - 1])), JSON.stringify(ordine));
    atteso("l'azione non ha più l'interruttore «solo in locale» né ripieghi sullo stile", !/copertinaAttiva/.test(azione) && !/\?\? "stilizzato"/.test(generazione));
    atteso("le impostazioni si leggono per il TITOLARE (accountId) e mai dal browser", /leggiContestoCopertina\(\{ admin, accountId: contesto\.accountId, garaId: gara\.id \}\)/.test(generazione) && !/formData\.get\("(attivo|modalita|prezzo|gareMassime|scadeIl|fonte)"\)/.test(generazione));
    atteso("la riga si registra con la fonte decisa dal server, non dal browser", /riservaCopertina\(admin, \{ garaId: gara\.id, userId: contesto\.accountId, stile, fonte: diritto\.fonte \}\)/.test(generazione));
    atteso("riuscita: riga chiusa; non riuscita: riga cancellata (non conta)", /if \(esito\.ok\) await completaCopertina\(admin, rigaId, esito\.marca\);\s*else await annullaCopertina\(admin, rigaId\);/.test(generazione));
    atteso("un'eccezione durante la generazione non lascia la riga registrata come fatta", /try \{[\s\S]*await generaCopertina\([\s\S]*\} catch \(err\)[\s\S]*esito = \{ ok: false/.test(generazione));
    atteso("senza la tabella si procede solo in sviluppo locale (fonte «sviluppo»)", /riserva\.stato === "schema_assente" && diritto\.fonte !== "sviluppo"/.test(generazione));
    atteso("errore nel controllo del servizio: l'azione si ferma (nel dubbio non si genera)", /if \(ctx\.errore\) return \{ error:/.test(generazione));
    const scarico = azione.slice(azione.indexOf("export async function scaricaCopertinaGara"));
    atteso("il download non dipende dall'interruttore del servizio: i file sono del cliente", !/decidi\(|leggiContestoCopertina|copertinaAttiva/.test(scarico) && scarico.includes("percorsoCopertinaValido("));
  }

  console.log("--- La pagina della gara e il pannello ---");
  {
    const pagina = leggi("src/app/site-omnia-ai/dashboard/omnia-ai/gare/[id]/page.tsx");
    atteso("il riquadro compare solo con il servizio acceso per il cliente (o con copertine già fatte da scaricare)", /copertinaVisibile\(\{ impostazioni: ctxCopertina\.impostazioni/.test(pagina) && /\|\| elencoCopertine\.length > 0/.test(pagina) && !/copertinaAttiva/.test(pagina));
    atteso("la pagina decide per ogni stile con le stesse regole dell'azione (decidiCopertina) e legge il contesto del titolare", /decidiCopertina\(ctxCopertina, gara\.id, stile\)/.test(pagina) && /leggiContestoCopertina\(\{ admin: adminCopertina, accountId: contesto\.accountId/.test(pagina));
    const pannello = leggi("src/app/site-omnia-ai/dashboard/omnia-ai/gare/[id]/copertina-panel.tsx");
    atteso("la dicitura «Servizio in prova… nessun addebito» è tolta", !/Servizio in prova/.test(pannello) && !/nessun addebito/.test(pannello) && !/prezzo verrà definito/.test(pannello));
    atteso("il pannello scrive che si possono fare fino a 3 generazioni per stile", /fino a <strong>3 generazioni per stile<\/strong>/.test(pannello) && /3 stilizzate e 3 realistiche/.test(pannello));
    atteso("il pannello mostra «N di 3 generazioni fatte» per ogni stile e spegne il pulsante che non può più generare", /generazioni fatte/.test(pannello) && /disabled=\{pending \|\| documenti\.length === 0 \|\| !s\.consentito\}/.test(pannello) && /s\.fatte\} di \{s\.massime\}/.test(pannello));
    atteso("il motivo generale (spento, finito, scaduto, a pagamento) si dice una volta sola, sopra i pulsanti", /motivoGenerale/.test(pannello) && /s\.motivo !== "limite_stile"/.test(pannello));
    atteso("le righe sul periodo gratuito sono mostrate al cliente", /righeGratis\.length > 0/.test(pannello));
  }

  console.log("--- La console ---");
  {
    const azione = leggi("src/app/site-console/azioni/copertina.ts");
    const salva = azione.slice(azione.indexOf("export async function salvaImpostazioniCopertina"));
    atteso("l'azione parte dal controllo dell'amministratore", salva.indexOf("richiediAdminAzione()") > 0 && salva.indexOf("richiediAdminAzione()") < salva.indexOf("validaImpostazioniCopertina("));
    atteso("l'utente si rilegge sul server: dev'essere un cliente, non un amministratore né un Ufficio Gare", /utente\.role !== "cliente"/.test(salva) && /omnia_ai_membri/.test(salva) && /Ufficio Gare/.test(salva));
    atteso("scrive UNA riga per cliente (upsert su user_id) con operatore e data, senza cancellare nulla", /upsert\(/.test(salva) && /onConflict: "user_id"/.test(salva) && /aggiornata_da_email: sessione\.email/.test(salva) && !/\.delete\(/.test(salva));
    atteso("senza la migrazione: errore chiaro, senza scrivere altrove", /schemaAssente\(error\)\) return \{ errore: "Le tabelle della copertina non esistono ancora \(migrazione 0106\)/.test(salva));
    atteso("a pagamento: avvisa subito cosa manca perché il cliente possa pagare (acquisti, chiave Stripe) e che le condizioni sono una bozza", /v\.attivo && v\.modalita === "pagamento"/.test(salva) && /Salvato, ma il cliente per ora NON può pagare/.test(salva) && /NOTA_CONSOLE_CONDIZIONI_COPERTINA/.test(salva));
    atteso("il prezzo non arriva da altro che dal modulo validato (niente ripieghi nascosti)", /v\.prezzoCentesimi/.test(salva) && !/PREZZO_COPERTINA/.test(azione));

    const vista = leggi("src/app/site-console/_componenti/scheda-cliente-vista.tsx");
    atteso("la scheda cliente ha il riquadro, non per gli amministratori, e dice se è un Ufficio Gare", /titolo="Copertina della relazione tecnica"/.test(vista) && /s\.utente\.ruolo !== "admin"/.test(vista.slice(vista.indexOf("Copertina della relazione tecnica: acceso/spento"))));
    atteso("i campi del modulo: servizio, modalità, prezzo, gare gratis, scadenza, nota", ['name="stato"', 'name="modalita"', 'name="prezzo"', 'name="gareMassime"', 'name="scadeIl"', 'name="nota"'].every((c) => vista.includes(c)));
    atteso("la scheda dice quante gare gratis ha usato e quante copertine ha generato", /Gare gratis usate:/.test(vista) && /Copertine generate:/.test(vista));
    atteso("senza la migrazione la scheda lo dice", /migrazione 0106 non ancora eseguita/.test(vista));
    const lettura = leggi("src/lib/console/copertina.ts");
    atteso("la lettura per la console è tollerante alla migrazione mancante", /schemaAssente\(error\)/.test(lettura) && /disponibile: false/.test(lettura));
    const pagina = leggi("src/app/site-console/(app)/utenti/[id]/page.tsx");
    atteso("la pagina della scheda carica le impostazioni del cliente e le passa alla vista", /leggiCopertinaCliente\(id\)/.test(pagina) && /copertina=\{copertina\}/.test(pagina));
    const costi = leggi("src/app/site-console/_componenti/costi-dettaglio-vista.tsx");
    atteso("i costi della copertina hanno un'etichetta leggibile in console (lettura e due stili)", ["copertina_relazione_lettura", "copertina_relazione_stilizzato", "copertina_relazione_realistico"].every((o) => costi.includes(o)));
  }

  if (fallimenti.length) {
    console.error(`\n${fallimenti.length} controlli falliti:\n- ${fallimenti.join("\n- ")}`);
    process.exit(1);
  }
  console.log("\nTutti i controlli sui diritti della copertina sono superati.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
