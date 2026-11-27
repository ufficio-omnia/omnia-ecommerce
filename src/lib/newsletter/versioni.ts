import { randomUUID } from "crypto";
import { archivioNewsletter, type ArchivioNewsletter } from "./archivio";
import { normalizzaContenuto } from "./contenuto";
import { ErroreGenerazione, SEZIONI_RIGENERABILI, generaEdizione, generaParte, usoVuoto, type ContestoCosto, type TipoGenerazione, type UsoGenerazione } from "./generazione";
import { STATI_MODIFICABILI, contenutoVuoto, type ChiaveSezione, type ContenutoEdizione, type DestinatariScelti, type Edizione, type Versione } from "./tipi";

// Versioni di un'edizione: generazione, rigenerazione (intera, di una sezione, di una notizia) e ripristino. Stessa
// edizione, stesso numero e stessa data editoriale: cambiano solo le versioni (1, 2, 3…).
//
// Regole:
//  - una sola generazione alla volta per edizione (blocco nel database: doppio clic, due schede, cron);
//  - prima di generare si salvano le modifiche dell'editor e, se il testo attuale non è già una versione, lo si
//    conserva come versione «modifiche manuali»;
//  - se la generazione fallisce il contenuto dell'edizione NON cambia: resta una versione «fallita» con il costo speso;
//  - una rigenerazione parziale cambia solo la sezione o la notizia scelta (il resto, modifiche manuali comprese, resta);
//  - ogni cambio di contenuto di un'edizione approvata o programmata la riporta «in revisione» (trigger della 0141);
//  - mai su edizioni in invio, inviate o con invio parziale.

export type TestoEditor = { oggetto: string; preheader: string; data_edizione: string; contenuto: ContenutoEdizione; destinatari: DestinatariScelti };

export type RichiestaRigenerazione = {
  edizioneId: string;
  tipo: Exclude<TipoGenerazione, "generazione"> | "generazione";
  chiave?: ChiaveSezione;
  indice?: number;
  indicazioni?: string;
  fontiManuali?: string[];
  // testo attuale dell'editor (anche non salvato): si salva prima di generare
  testoEditor?: TestoEditor | null;
  autore: string | null;
  automatica?: boolean;
};

export type EsitoVersione = { ok: true; versione: number; messaggio: string; costoUsd: number } | { ok: false; errore: string; costoUsd: number };

type Generatori = { generaEdizione: typeof generaEdizione; generaParte: typeof generaParte };
const GENERATORI_VERI: Generatori = { generaEdizione, generaParte };

function stessoTesto(e: { oggetto: string; preheader: string; contenuto: ContenutoEdizione }, v: { oggetto: string | null; preheader: string | null; contenuto: ContenutoEdizione | null }): boolean {
  return e.oggetto === (v.oggetto ?? "") && e.preheader === (v.preheader ?? "") && JSON.stringify(normalizzaContenuto(e.contenuto)) === JSON.stringify(normalizzaContenuto(v.contenuto));
}

function vuota(c: ContenutoEdizione): boolean {
  return c.sezioni.every((s) => s.notizie.length === 0) && !c.editoriale.testo.trim();
}

function titoli(c: ContenutoEdizione): string[] {
  return c.sezioni.flatMap((s) => s.notizie.map((n) => n.titolo)).filter(Boolean);
}

// Salva il testo dell'editor (se diverso) e conserva come versione il testo attuale che non lo è ancora.
async function conservaTestoAttuale(a: ArchivioNewsletter, e: Edizione, testo: TestoEditor | null | undefined, autore: string | null): Promise<Edizione> {
  let attuale = e;
  if (testo) {
    const nuovo = { oggetto: testo.oggetto, preheader: testo.preheader, data_edizione: testo.data_edizione, contenuto: normalizzaContenuto(testo.contenuto), destinatari: testo.destinatari };
    const cambiato = !stessoTesto(e, nuovo) || e.data_edizione !== nuovo.data_edizione || JSON.stringify(e.destinatari) !== JSON.stringify(nuovo.destinatari);
    if (cambiato) {
      const salvata = await a.aggiornaEdizione(e.id, nuovo, STATI_MODIFICABILI);
      if (!salvata) throw new Error("L'edizione non è più modificabile (in invio o inviata).");
      attuale = salvata;
    }
  }
  if (vuota(attuale.contenuto) && !attuale.oggetto.trim()) return attuale;
  const versioni = await a.elencoVersioni(attuale.id);
  const ultimaBuona = versioni.find((v) => v.esito === "ok" && v.numero_versione === attuale.versione_attiva) ?? versioni.find((v) => v.esito === "ok");
  if (ultimaBuona && stessoTesto(attuale, ultimaBuona)) return attuale;
  const v = await a.aggiungiVersione(
    {
      edizione_id: attuale.id,
      origine: versioni.length === 0 ? "iniziale" : "modifiche_manuali",
      esito: "ok",
      ambito: {},
      indicazioni: null,
      oggetto: attuale.oggetto,
      preheader: attuale.preheader,
      contenuto: attuale.contenuto,
      generazione_id: null,
      costo_usd: 0,
      input_tokens: null,
      output_tokens: null,
      ricerche_web: null,
      modello: null,
      errore: null,
    },
    autore,
  );
  // il testo attuale ora coincide con questa versione (senza cambiare il contenuto: nessun effetto sull'approvazione)
  return (await a.aggiornaEdizione(attuale.id, { versione_attiva: v.numero_versione }, STATI_MODIFICABILI)) ?? attuale;
}

export async function rigenera(r: RichiestaRigenerazione, a: ArchivioNewsletter = archivioNewsletter(), g: Generatori = GENERATORI_VERI): Promise<EsitoVersione> {
  const e0 = await a.leggiEdizione(r.edizioneId);
  if (!e0) return { ok: false, errore: "Edizione non trovata.", costoUsd: 0 };
  if (!STATI_MODIFICABILI.includes(e0.stato)) return { ok: false, errore: `L'edizione è «${e0.stato}»: non si modifica né si rigenera.`, costoUsd: 0 };
  if ((r.tipo === "rigenerazione_sezione" || r.tipo === "rigenerazione_notizia") && (!r.chiave || !SEZIONI_RIGENERABILI.includes(r.chiave))) {
    return { ok: false, errore: "Questa sezione la scrive la redazione: non si rigenera.", costoUsd: 0 };
  }

  const token = randomUUID();
  if (!(await a.prendiBlocco(e0.id, token, STATI_MODIFICABILI))) {
    return { ok: false, errore: "C'è già una generazione in corso per questa edizione: attendi che finisca (nessuna seconda generazione avviata).", costoUsd: 0 };
  }
  let uso: UsoGenerazione = usoVuoto();
  const generazioneId = randomUUID();
  try {
    const e = await conservaTestoAttuale(a, e0, r.testoEditor, r.autore);
    const prossima = Math.max(0, ...(await a.elencoVersioni(e.id)).map((v) => v.numero_versione)) + 1;
    const contesto: ContestoCosto = { generazioneId, tipo: r.tipo, edizioneId: e.id, numeroEdizione: e.numero, versione: prossima, automatica: r.automatica, registra: (x) => a.registraCosto(x) };

    let nuovo: ContenutoEdizione;
    let oggetto = e.oggetto;
    let preheader = e.preheader;
    let note = "";
    const ambito: Versione["ambito"] = {};

    if (r.tipo === "generazione" || r.tipo === "rigenerazione") {
      const esito = await g.generaEdizione({ dataEdizione: e.data_edizione, fontiManuali: r.fontiManuali, indicazioni: r.indicazioni, titoliPrecedenti: r.tipo === "rigenerazione" ? titoli(e.contenuto) : [], contesto });
      uso = esito.uso;
      // le sezioni scritte dall'AI si sostituiscono; editoriale, OMNIA AI News, chiusura e pulsante restano quelli attuali
      const generate = new Map(esito.contenuto.sezioni.map((s) => [s.chiave, s]));
      const base = vuota(e.contenuto) ? contenutoVuoto() : e.contenuto;
      nuovo = {
        ...base,
        sezioni: base.sezioni.map((s) => (SEZIONI_RIGENERABILI.includes(s.chiave) ? { ...s, notizie: generate.get(s.chiave)?.notizie ?? [], attiva: (generate.get(s.chiave)?.notizie.length ?? 0) > 0 } : s)),
      };
      if (esito.oggetto) oggetto = esito.oggetto;
      if (esito.preheader) preheader = esito.preheader;
      note = [`Ricerche web: ${esito.ricerche}. Fonti scartate: ${esito.fontiScartate}. Notizie tolte: ${esito.notizieScartate}.`, esito.note].filter(Boolean).join("\n");
    } else {
      const k = e.contenuto.sezioni.findIndex((s) => s.chiave === r.chiave);
      if (k < 0) throw new ErroreGenerazione("Sezione non trovata.", uso);
      const sezione = e.contenuto.sezioni[k];
      const notizia = r.tipo === "rigenerazione_notizia" ? sezione.notizie[r.indice ?? -1] : null;
      if (r.tipo === "rigenerazione_notizia" && !notizia) throw new ErroreGenerazione("Notizia non trovata: salva e riprova.", uso);
      const altri = e.contenuto.sezioni.flatMap((s, i) => s.notizie.filter((_, j) => !(i === k && (r.tipo === "rigenerazione_sezione" || j === r.indice))).map((n) => n.titolo));
      const esito = await g.generaParte({ dataEdizione: e.data_edizione, chiave: sezione.chiave, notizia, altriTitoli: altri, indicazioni: r.indicazioni, contesto });
      uso = esito.uso;
      note = esito.note;
      ambito.chiave = sezione.chiave;
      if (notizia) {
        ambito.indice = r.indice;
        ambito.titolo = notizia.titolo;
      }
      nuovo = {
        ...e.contenuto,
        sezioni: e.contenuto.sezioni.map((s, i) =>
          i !== k ? s : notizia ? { ...s, notizie: s.notizie.map((n, j) => (j === r.indice ? esito.notizie[0] : n)) } : { ...s, notizie: esito.notizie, attiva: true },
        ),
      };
    }

    nuovo = normalizzaContenuto(nuovo);
    const v = await a.aggiungiVersione(
      {
        edizione_id: e.id,
        origine: r.tipo,
        esito: "ok",
        ambito,
        indicazioni: r.indicazioni?.trim() || null,
        oggetto,
        preheader,
        contenuto: nuovo,
        generazione_id: generazioneId,
        costo_usd: Math.round(uso.costoUsd * 10000) / 10000,
        input_tokens: uso.inputTokens,
        output_tokens: uso.outputTokens,
        ricerche_web: uso.ricerche,
        modello: uso.modello,
        errore: null,
      },
      r.autore,
    );
    const aggiornata = await a.aggiornaEdizione(e.id, { oggetto, preheader, contenuto: nuovo, versione_attiva: v.numero_versione, note_generazione: note || null }, STATI_MODIFICABILI);
    if (!aggiornata) throw new ErroreGenerazione("L'edizione è cambiata di stato durante la generazione: la versione è nello storico, il testo attuale non è stato toccato.", uso);
    await a.annota(e.id, r.tipo, { versione: v.numero_versione, costo_usd: v.costo_usd, ambito }, r.autore);
    const approvazionePersa = e0.stato === "approvata" || e0.stato === "programmata";
    return {
      ok: true,
      versione: v.numero_versione,
      costoUsd: uso.costoUsd,
      messaggio: `Versione ${v.numero_versione} creata.${approvazionePersa ? " L'approvazione (e l'eventuale programmazione) è stata tolta: va riapprovata." : ""}`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (err instanceof ErroreGenerazione) uso = err.uso;
    // generazione fallita: il contenuto non cambia; resta una versione «fallita» con il costo speso
    try {
      await a.aggiungiVersione(
        {
          edizione_id: e0.id,
          origine: r.tipo,
          esito: "fallita",
          ambito: r.chiave ? { chiave: r.chiave, ...(r.indice !== undefined ? { indice: r.indice } : {}) } : {},
          indicazioni: r.indicazioni?.trim() || null,
          oggetto: null,
          preheader: null,
          contenuto: null,
          generazione_id: generazioneId,
          costo_usd: Math.round(uso.costoUsd * 10000) / 10000,
          input_tokens: uso.inputTokens,
          output_tokens: uso.outputTokens,
          ricerche_web: uso.ricerche,
          modello: uso.modello,
          errore: msg.slice(0, 500),
        },
        r.autore,
      );
      await a.annota(e0.id, `${r.tipo}_fallita`, { errore: msg.slice(0, 300), costo_usd: uso.costoUsd }, r.autore);
    } catch (e2) {
      console.error("Newsletter: versione fallita non registrata", e2 instanceof Error ? e2.message : e2);
    }
    return { ok: false, errore: `Generazione non riuscita: ${msg} Il testo precedente è invariato.`, costoUsd: uso.costoUsd };
  } finally {
    await a.rilasciaBlocco(e0.id, token);
  }
}

// Nuova edizione generata con l'AI (console o processo automatico): prima si crea l'edizione (numero e data), poi la si
// genera come versione 1, così ogni costo, anche di un tentativo fallito, è legato all'edizione.
export async function generaNuovaEdizione(opz: {
  dataEdizione: string;
  fontiManuali?: string[];
  indicazioni?: string;
  autore: string | null;
  automatica?: boolean;
  settimana?: string;
  a?: ArchivioNewsletter;
  g?: Generatori;
}): Promise<{ edizione: Edizione; esito: EsitoVersione }> {
  const a = opz.a ?? archivioNewsletter();
  const edizione = await a.creaEdizione(
    { data_edizione: opz.dataEdizione, contenuto: contenutoVuoto(), origine: opz.automatica ? "ai_automatica" : "ai", note_generazione: "Generazione in corso…", ...(opz.settimana ? { settimana: opz.settimana } : {}) },
    opz.autore,
  );
  const esito = await rigenera({ edizioneId: edizione.id, tipo: "generazione", fontiManuali: opz.fontiManuali, indicazioni: opz.indicazioni, autore: opz.autore, automatica: opz.automatica }, a, opz.g);
  if (!esito.ok) await a.aggiornaEdizione(edizione.id, { note_generazione: `${esito.errore} Puoi rigenerarla o scriverla a mano.` }, STATI_MODIFICABILI);
  return { edizione, esito };
}

// Ripristino di una versione precedente: il suo testo torna il contenuto dell'edizione (prima si conserva il testo
// attuale, se non è già una versione). Stessa regola sull'approvazione.
export async function ripristinaVersione(opz: { edizioneId: string; numero: number; testoEditor?: TestoEditor | null; autore: string | null }, a: ArchivioNewsletter = archivioNewsletter()): Promise<EsitoVersione> {
  const e0 = await a.leggiEdizione(opz.edizioneId);
  if (!e0) return { ok: false, errore: "Edizione non trovata.", costoUsd: 0 };
  if (!STATI_MODIFICABILI.includes(e0.stato)) return { ok: false, errore: `L'edizione è «${e0.stato}»: non si modifica.`, costoUsd: 0 };
  const token = randomUUID();
  if (!(await a.prendiBlocco(e0.id, token, STATI_MODIFICABILI))) return { ok: false, errore: "C'è una generazione in corso: attendi che finisca.", costoUsd: 0 };
  try {
    const e = await conservaTestoAttuale(a, e0, opz.testoEditor, opz.autore);
    const v = (await a.elencoVersioni(e.id)).find((x) => x.numero_versione === opz.numero);
    if (!v || v.esito !== "ok" || !v.contenuto) return { ok: false, errore: "Versione non trovata o senza contenuto (generazione fallita).", costoUsd: 0 };
    const r = await a.aggiornaEdizione(e.id, { oggetto: v.oggetto ?? "", preheader: v.preheader ?? "", contenuto: v.contenuto, versione_attiva: v.numero_versione }, STATI_MODIFICABILI);
    if (!r) return { ok: false, errore: "L'edizione non è più modificabile.", costoUsd: 0 };
    await a.annota(e.id, "ripristino", { versione: v.numero_versione }, opz.autore);
    const persa = e0.stato === "approvata" || e0.stato === "programmata";
    return { ok: true, versione: v.numero_versione, costoUsd: 0, messaggio: `Ripristinata la versione ${v.numero_versione}.${persa ? " L'approvazione è stata tolta: va riapprovata." : ""}` };
  } finally {
    await a.rilasciaBlocco(e0.id, token);
  }
}
