// Letture e scritture dello script UNICO di riclassificazione e popolamento della 0121 (fase B2b, 17/11/2026). Solo server, chiave di
// servizio; il calcolo sta in riclassifica-settori.ts (puro). Provato su database in memoria da scripts/verifica-radar-popolamento.ts.
//
//   - leggiArchivio: tutte le gare con i lotti, le classificazioni ATTIVE e lo stato, a pagine (sola lettura);
//   - «aggiornata_il» della gara NON si tocca (decisione dell'utente sul pacchetto 16, punti 8 e 11): una gara vecchia riclassificata non
//     deve sembrare nuova né aggiornata; l'orario del cambio sta nel registro (rilevato_il) e nelle righe della 0121 (valida_dal);
//   - applicaPiani: per ogni gara, se la colonna «settori» cambia, scrittura CONDIZIONATA (solo se i settori sono ancora quelli letti) più la
//     traccia nel registro (mai notificabile; se la traccia non si scrive la colonna torna com'era); poi righe e stato con
//     scriviClassificazioni (disattivazioni condizionate, inserimenti, «classificata» o «fallita»). Nessuna cancellazione;
//   - annullaEsecuzione: RIPRISTINO controllato di un'esecuzione: la colonna torna ai settori di prima (condizionato ai settori scritti),
//     le righe dell'esecuzione si chiudono, le righe che aveva chiuso tornano come righe NUOVE (lo storico resta intero), lo stato torna «in
//     attesa». Ripetere l'annullamento non scrive nulla.
import type { SupabaseClient } from "@supabase/supabase-js";
import { schemaAssente } from "@/lib/omnia-ai-incassi";
import { blocchi, type Misure } from "./importa";
import { scriviClassificazioni, type EsitoClassificazioni } from "./classificazioni";
import type { RigaClassificazione, RigaStato } from "./classificazioni-calcoli";
import { FONTE_REGISTRO, colonnaDaRigheAttive, isoDaEsecuzione, pianoGara, statoDaRegistro, tracciaRiallineamento, type GaraArchivio, type LottoDaRiclassificare, type PianoGara, type StatoSettori } from "./riclassifica-settori";

const PAGINA = 1000;
export const COLONNE_GARA_ARCHIVIO = "id, chiave, oggetto, descrizione, cpv_principale, cpv_tutti, settori, metodo_settore, natura_contratto, fonti, aggiornata_il, unita_a";

async function tutte<T>(db: SupabaseClient, tabella: string, colonne: string, ordine: string, misure: Misure, soloAttive = false): Promise<{ righe: T[]; assente: boolean }> {
  const righe: T[] = [];
  for (let da = 0; ; da += PAGINA) {
    const q = soloAttive ? db.from(tabella).select(colonne).eq("attiva", true) : db.from(tabella).select(colonne);
    const { data, error } = await q.order(ordine).range(da, da + PAGINA - 1).returns<T[]>();
    misure.richiesteDb++;
    if (error) {
      if (schemaAssente(error)) return { righe: [], assente: true };
      throw new Error(`${tabella}: ${error.message}`);
    }
    righe.push(...(data ?? []));
    if ((data ?? []).length < PAGINA) return { righe, assente: false };
  }
}

export type ArchivioLetto = {
  gare: GaraArchivio[];
  lotti: Map<string, LottoDaRiclassificare[]>;
  nLotti: number;
  attive: Map<string, RigaClassificazione[]>;
  stati: Map<string, RigaStato>;
  // le tabelle della 0121 esistono (se no: prova possibile, applicazione no)
  tabelle0121: boolean;
};

export async function leggiArchivio(db: SupabaseClient, misure: Misure): Promise<ArchivioLetto> {
  const gare = (await tutte<GaraArchivio>(db, "radar_procedure", COLONNE_GARA_ARCHIVIO, "id", misure)).righe;
  const lottiLetti = (await tutte<LottoDaRiclassificare & { procedura_id: string }>(db, "radar_lotti", "id, procedura_id, numero_lotto, oggetto, cpv_principale, cpv_tutti", "id", misure)).righe;
  const lotti = new Map<string, LottoDaRiclassificare[]>();
  // ordine stabile dei lotti (numero del lotto), come li legge la scheda
  for (const l of [...lottiLetti].sort((a, b) => String((a as { numero_lotto?: string }).numero_lotto ?? "").localeCompare(String((b as { numero_lotto?: string }).numero_lotto ?? "")))) {
    lotti.set(l.procedura_id, [...(lotti.get(l.procedura_id) ?? []), { oggetto: l.oggetto, cpv_principale: l.cpv_principale, cpv_tutti: l.cpv_tutti }]);
  }
  const cl = await tutte<RigaClassificazione>(db, "radar_classificazioni", "*", "id", misure, true);
  const st = await tutte<RigaStato>(db, "radar_classificazioni_stato", "*", "procedura_id", misure);
  const attive = new Map<string, RigaClassificazione[]>();
  for (const r of cl.righe) attive.set(r.procedura_id, [...(attive.get(r.procedura_id) ?? []), r]);
  const stati = new Map(st.righe.map((s) => [s.procedura_id, s]));
  return { gare, lotti, nLotti: lottiLetti.length, attive, stati, tabelle0121: !cl.assente && !st.assente };
}

export function pianiDaArchivio(a: ArchivioLetto, esecuzione: string, adessoIso: string, nuovoId: () => string): PianoGara[] {
  return a.gare.map((gara) => pianoGara({ gara, lotti: a.lotti.get(gara.id) ?? [], attive: a.attive.get(gara.id) ?? [], stato: a.stati.get(gara.id) ?? null, esecuzione, adessoIso, nuovoId }));
}

// Scrittura condizionata alla colonna com'è stata letta: settori uguali (contiene E contenuto, l'ordine non conta) e stesso metodo.
type Filtrabile<Q> = { contains: (c: string, v: string[]) => Q; containedBy: (c: string, v: string[]) => Q; eq: (c: string, v: string) => Q; is: (c: string, v: null) => Q };
function stessaColonna<Q extends Filtrabile<Q>>(q: Q, colonna: { settori: string[]; metodo: string | null }): Q {
  const s = q.contains("settori", colonna.settori).containedBy("settori", colonna.settori);
  return colonna.metodo === null ? s.is("metodo_settore", null) : s.eq("metodo_settore", colonna.metodo);
}

export type EsitoApplica = {
  gare: number;
  // gare già completate da questa stessa esecuzione (ripresa dopo un'interruzione): nessuna scrittura
  giaCompletate: number;
  settoriCambiati: number;
  // colonna già scritta da questa esecuzione prima dell'interruzione: si completa la traccia (senza doppioni)
  colonneRiprese: number;
  tracce: number;
  cambiateNelFrattempo: number;
  errori: number;
  classificazioni: EsitoClassificazioni;
};

// ───── recupero sicuro (pacchetto 16, punto 11) ─────
//
// ORDINE DELLE SCRITTURE, gara per gara: 1) colonna «settori» e metodo, condizionata alla colonna letta; 2) traccia nel registro, con la
// chiave che contiene l'esecuzione (ignoreDuplicates); poi, a blocchi di 100 gare: 3) chiusura delle righe vecchie (condizionata ad
// «attiva»); 4) inserimento delle righe nuove (id decisi nel piano); 5) stato «classificata» con l'istante dell'esecuzione. Lo stato è
// l'ULTIMA scrittura della gara: se c'è, con l'istante di questa esecuzione, la gara è completa.
//
// Il piano (colonna di prima, traccia, righe con i loro id, istante) si salva in un DIARIO prima di ogni scrittura. Se l'esecuzione si
// interrompe (rete, timeout, arresto), la ripresa rilegge lo STESSO diario: le gare complete si saltano; una colonna già scritta da questa
// esecuzione si riconosce (è già quella «dopo») e si completa la traccia; le righe uguali a quelle attive non si reinseriscono; nessun
// registro scritto in anticipo (la traccia segue sempre la colonna), nessun doppione. Stato finale identico a un'esecuzione senza interruzioni.
export type Diario = { formato: 1; esecuzione: string; adessoIso: string; versione: string; piani: PianoGara[] };

export function diarioDaPiani(piani: readonly PianoGara[], esecuzione: string, adessoIso: string, versione: string): Diario {
  return { formato: 1, esecuzione, adessoIso, versione, piani: piani.filter((p) => p.tipo === "da_scrivere") };
}

const stessiSettoriColonna = (a: readonly string[] | null, b: readonly string[]) => [...(a ?? [])].sort().join() === [...b].sort().join();

export async function applicaPiani(db: SupabaseClient, piani: readonly PianoGara[], misure: Misure, adessoIso: string): Promise<EsitoApplica> {
  const esito: EsitoApplica = { gare: 0, giaCompletate: 0, settoriCambiati: 0, colonneRiprese: 0, tracce: 0, cambiateNelFrattempo: 0, errori: 0, classificazioni: { saltata: false, inserite: 0, disattivate: 0, invariate: 0, protette: 0, cambiateNelFrattempo: 0, classificate: 0, fallite: 0 } };
  const daFare = piani.filter((p) => p.tipo === "da_scrivere" && !!p.ric);
  // gare già completate da QUESTA esecuzione (stato classificato con lo stesso istante): ripresa dopo un'interruzione, nessuna scrittura
  const complete = new Set<string>();
  for (const b of blocchi(daFare.map((p) => p.proceduraId), 100)) {
    const { data, error } = await db.from("radar_classificazioni_stato").select("procedura_id, stato, classificata_il").in("procedura_id", b).returns<{ procedura_id: string; stato: string; classificata_il: string | null }[]>();
    misure.richiesteDb++;
    if (error) {
      if (schemaAssente(error)) break;
      throw new Error(`stato delle classificazioni: ${error.message}`);
    }
    for (const s of data ?? []) if (s.stato === "classificata" && s.classificata_il && Date.parse(s.classificata_il) === Date.parse(adessoIso)) complete.add(s.procedura_id);
  }
  const consentite: PianoGara[] = [];
  for (const p of daFare) {
    if (!p.ric) continue;
    esito.gare++;
    if (complete.has(p.proceduraId)) {
      esito.giaCompletate++;
      continue;
    }
    if (p.cambiaSettori && p.registro) {
      const { prima, dopo } = p.ric;
      const { data, error } = await stessaColonna(db.from("radar_procedure").update({ settori: dopo.settori, metodo_settore: dopo.metodo }).eq("id", p.proceduraId), prima).select("id");
      misure.richiesteDb++;
      if (error) {
        esito.errori++;
        continue;
      }
      if ((data ?? []).length === 0) {
        // nessuna riga con la colonna di prima: o l'ha già scritta questa esecuzione prima di interrompersi (si completa la traccia), o è
        // cambiata dopo la lettura (niente righe né stato, si rifà alla prossima esecuzione)
        const { data: ora, error: eOra } = await db.from("radar_procedure").select("settori, metodo_settore").eq("id", p.proceduraId).maybeSingle<{ settori: string[] | null; metodo_settore: string | null }>();
        misure.richiesteDb++;
        // pacchetto 16, punto 5: una lettura non riuscita è un ERRORE (si ferma e si rilancia lo stesso comando), mai «cambiata nel frattempo»
        if (eOra) throw new Error(`colonna della gara ${p.proceduraId}: ${eOra.message}`);
        if (!ora || !stessiSettoriColonna(ora.settori, dopo.settori) || (ora.metodo_settore ?? null) !== (dopo.metodo ?? null)) {
          esito.cambiateNelFrattempo++;
          continue;
        }
        esito.colonneRiprese++;
      }
      const { error: e2 } = await db.from("radar_aggiornamenti").upsert(p.registro, { onConflict: "procedura_id,tipo,campo,id_fonte", ignoreDuplicates: true });
      misure.richiesteDb++;
      if (e2) {
        // senza traccia la correzione non resta: la colonna torna com'era (stessa scrittura condizionata)
        await stessaColonna(db.from("radar_procedure").update({ settori: prima.settori, metodo_settore: prima.metodo }).eq("id", p.proceduraId), dopo);
        misure.richiesteDb++;
        esito.errori++;
        continue;
      }
      if ((data ?? []).length > 0) esito.settoriCambiati++;
      esito.tracce++;
    }
    consentite.push(p);
  }
  // righe e stato, a blocchi di gare (letture e inserimenti raggruppati)
  for (const b of blocchi(consentite, 100)) {
    const e = await scriviClassificazioni(db, b.map((p) => ({ proceduraId: p.proceduraId, versione: p.ric?.classificazione.versione ?? "", calcolate: p.calcolate, casiDaVerificare: p.ric?.classificazione.daVerificare ?? null })), misure, adessoIso);
    if (e.saltata) {
      esito.classificazioni.saltata = true;
      break;
    }
    for (const k of ["inserite", "disattivate", "invariate", "protette", "cambiateNelFrattempo", "classificate", "fallite"] as const) esito.classificazioni[k] += e[k];
  }
  return esito;
}

export type EsitoAnnulla = {
  gare: number;
  colonnaRipristinata: number;
  colonnaGiaCambiata: number;
  righeChiuse: number;
  righeRipristinate: number;
  statiInAttesa: number;
  tracceIlleggibili: number;
  errori: number;
};

export class TroppeGare extends Error {}

/** Ripristino controllato di un'esecuzione (vedi in testa). Si ferma SENZA scrivere se le gare coinvolte sono più di «massimo». */
export async function annullaEsecuzione(db: SupabaseClient, esecuzione: string, massimo: number, misure: Misure, adessoIso: string, nuovoId: () => string): Promise<EsitoAnnulla> {
  const istante = isoDaEsecuzione(esecuzione);
  if (!istante) throw new Error(`Esecuzione non valida: ${esecuzione}`);
  const esito: EsitoAnnulla = { gare: 0, colonnaRipristinata: 0, colonnaGiaCambiata: 0, righeChiuse: 0, righeRipristinate: 0, statiInAttesa: 0, tracceIlleggibili: 0, errori: 0 };
  const autore = `riclassificazione:${esecuzione}`;
  const { data: tracce, error: e1 } = await db
    .from("radar_aggiornamenti")
    .select("procedura_id, valore_precedente, valore_nuovo, id_fonte")
    .eq("tipo", "correzione_dati")
    .eq("campo", "settori")
    .eq("fonte", FONTE_REGISTRO)
    .like("id_fonte", `%:${esecuzione}`)
    .returns<{ procedura_id: string; valore_precedente: string | null; valore_nuovo: string | null; id_fonte: string }[]>();
  misure.richiesteDb++;
  if (e1) throw new Error(`registro: ${e1.message}`);
  const { data: nuove, error: e2 } = await db.from("radar_classificazioni").select("*").eq("autore", autore).eq("attiva", true).returns<RigaClassificazione[]>();
  misure.richiesteDb++;
  if (e2) throw new Error(`classificazioni dell'esecuzione: ${e2.message}`);
  // righe chiuse da questa esecuzione (stesso istante): sono quelle da riportare
  const { data: chiuse, error: e3 } = await db.from("radar_classificazioni").select("*").eq("sostituita_il", istante).eq("attiva", false).returns<RigaClassificazione[]>();
  misure.richiesteDb++;
  if (e3) throw new Error(`classificazioni chiuse dall'esecuzione: ${e3.message}`);
  // gare ancora classificate da questa esecuzione (anche se le loro righe sono già state chiuse da un annullamento interrotto)
  const { data: classificateQui, error: e4 } = await db.from("radar_classificazioni_stato").select("procedura_id").eq("stato", "classificata").eq("classificata_il", istante).returns<{ procedura_id: string }[]>();
  misure.richiesteDb++;
  if (e4) throw new Error(`stato delle classificazioni: ${e4.message}`);
  const gare = [...new Set([...(tracce ?? []).map((t) => t.procedura_id), ...(nuove ?? []).map((r) => r.procedura_id), ...(chiuse ?? []).map((r) => r.procedura_id), ...(classificateQui ?? []).map((r) => r.procedura_id)])];
  if (gare.length > massimo) throw new TroppeGare(`${gare.length} gare da ripristinare, più del massimo ${massimo}: nessuna scrittura.`);
  esito.gare = gare.length;

  // 1) colonna «settori»: torna ai settori di prima solo se è ancora quella scritta dall'esecuzione
  for (const t of tracce ?? []) {
    const prima = statoDaRegistro(t.valore_precedente);
    const dopo = statoDaRegistro(t.valore_nuovo);
    if (!prima || !dopo) {
      esito.tracceIlleggibili++;
      continue;
    }
    const { data, error } = await stessaColonna(db.from("radar_procedure").update({ settori: prima.settori, metodo_settore: prima.metodo }).eq("id", t.procedura_id), dopo).select("id");
    misure.richiesteDb++;
    if (error) {
      esito.errori++;
      continue;
    }
    if ((data ?? []).length === 0) {
      // già rimessa da un annullamento interrotto (si completa la traccia, senza doppioni), oppure cambiata da altri (non si tocca)
      const { data: ora, error: eOra } = await db.from("radar_procedure").select("settori, metodo_settore").eq("id", t.procedura_id).maybeSingle<{ settori: string[] | null; metodo_settore: string | null }>();
      misure.richiesteDb++;
      // pacchetto 16, punto 5: un errore di lettura ferma l'annullamento (si rilancia lo stesso comando, che è sicuro)
      if (eOra) throw new Error(`colonna della gara ${t.procedura_id}: ${eOra.message}`);
      if (!ora || !stessiSettoriColonna(ora.settori, prima.settori) || (ora.metodo_settore ?? null) !== (prima.metodo ?? null)) {
        esito.colonnaGiaCambiata++;
        continue;
      }
    }
    const { error: eTraccia } = await db.from("radar_aggiornamenti").upsert(
      { procedura_id: t.procedura_id, tipo: "correzione_dati", campo: "settori_ripristinati", valore_precedente: t.valore_nuovo, valore_nuovo: t.valore_precedente, fonte: FONTE_REGISTRO, id_fonte: `annullato:${t.id_fonte}`.slice(0, 200), nota: "Correzione dei settori annullata: rimessi i settori di prima", notificabile: false },
      { onConflict: "procedura_id,tipo,campo,id_fonte", ignoreDuplicates: true },
    );
    misure.richiesteDb++;
    // pacchetto 16, punto 5: senza la traccia l'annullamento è incompleto e va segnalato (rilanciandolo, la traccia si completa)
    if (eTraccia) esito.errori++;
    esito.colonnaRipristinata++;
  }

  // 2) righe: si chiudono quelle dell'esecuzione; le righe che l'esecuzione aveva chiuso tornano come copie nuove
  const attiveOra = new Map<string, RigaClassificazione[]>();
  for (const b of blocchi(gare, 100)) {
    const { data, error: eAttive } = await db.from("radar_classificazioni").select("*").in("procedura_id", b).eq("attiva", true).returns<RigaClassificazione[]>();
    misure.richiesteDb++;
    if (eAttive) throw new Error(`classificazioni attive: ${eAttive.message}`);
    for (const r of data ?? []) attiveOra.set(r.procedura_id, [...(attiveOra.get(r.procedura_id) ?? []), r]);
  }
  // righe dell'esecuzione GIÀ chiuse (da un annullamento interrotto): la copia da riportare riusa l'id che avevano indicato
  const { data: chiuseProprie, error: eChiuse } = await db.from("radar_classificazioni").select("id, procedura_id, settore, sostituita_da").eq("autore", autore).eq("attiva", false).returns<{ id: string; procedura_id: string; settore: string; sostituita_da: string | null }[]>();
  misure.richiesteDb++;
  if (eChiuse) throw new Error(`classificazioni già chiuse dall'esecuzione: ${eChiuse.message}`);
  // copie già riportate da QUESTO annullamento (la nota lo dice): non si riportano mai una seconda volta, anche se poi qualcuno le ha chiuse
  const { data: copieFatte, error: eCopie } = await db.from("radar_classificazioni").select("procedura_id, settore").like("nota", `%(annullata l'esecuzione ${esecuzione}).`).returns<{ procedura_id: string; settore: string }[]>();
  misure.richiesteDb++;
  if (eCopie) throw new Error(`copie già riportate: ${eCopie.message}`);
  const giaRiportate = new Set((copieFatte ?? []).map((r) => `${r.procedura_id}|${r.settore}`));
  // la copia conserva l'autore della riga di prima (così annullare anche quell'esecuzione la chiude); la nota dice che è un ripristino
  const copia = (r: RigaClassificazione, id?: string | null): RigaClassificazione => ({
    ...r,
    id: id ?? nuovoId(),
    origine: r.origine === "amministratore" ? "amministratore" : "riclassificazione",
    nota: r.origine === "amministratore" ? r.nota : `Ripristino della classificazione precedente (annullata l'esecuzione ${esecuzione}).`,
    autore: r.autore,
    attiva: true,
    valida_dal: adessoIso,
    sostituita_il: null,
    sostituita_da: null,
  });
  for (const id of gare) {
    const attive = attiveOra.get(id) ?? [];
    const proprie = attive.filter((r) => r.autore === autore);
    const chiuseQui = (chiuse ?? []).filter((r) => r.procedura_id === id);
    const settori = [...new Set([...proprie.map((r) => r.settore), ...chiuseQui.map((r) => r.settore)])];
    for (const s of settori) {
      const nuova = proprie.find((r) => r.settore === s) ?? null;
      // la riga che l'esecuzione aveva chiuso per questo settore (una sola: una riga attiva per gara e settore)
      const fatta = giaRiportate.has(`${id}|${s}`);
      const vecchia = fatta ? null : (chiuseQui.find((r) => r.settore === s) ?? null);
      // senza la riga dell'esecuzione attiva si riporta la vecchia solo se non è già stata riportata e nessuna riga è attiva per il settore
      if (!nuova && (!vecchia || attive.some((r) => r.settore === s))) continue;
      const giaIndicata = (chiuseProprie ?? []).find((r) => r.procedura_id === id && r.settore === s && r.sostituita_da)?.sostituita_da ?? null;
      const ripristinata = vecchia ? copia(vecchia, nuova ? null : giaIndicata) : null;
      if (nuova) {
        const { data, error } = await db.from("radar_classificazioni").update({ attiva: false, sostituita_il: adessoIso, sostituita_da: ripristinata?.id ?? null }).eq("id", nuova.id).eq("attiva", true).select("id");
        misure.richiesteDb++;
        if (error || (data ?? []).length === 0) {
          esito.errori++;
          continue;
        }
        esito.righeChiuse++;
      }
      if (ripristinata) {
        const { error } = await db.from("radar_classificazioni").insert(ripristinata);
        misure.richiesteDb++;
        if (error) esito.errori++;
        else esito.righeRipristinate++;
      }
    }
  }

  // 3) stato: «in attesa» (da classificare di nuovo) per le gare ancora classificate DA QUESTA esecuzione (stesso istante); mai «non
  //    pertinente». Ripetere (anche dopo un'interruzione) non scrive più nulla: lo stato non è più quello dell'esecuzione
  const daRimettere: string[] = [];
  for (const b of blocchi(gare, 100)) {
    const { data, error: eStati } = await db.from("radar_classificazioni_stato").select("procedura_id, stato, classificata_il").in("procedura_id", b).returns<{ procedura_id: string; stato: string; classificata_il: string | null }[]>();
    misure.richiesteDb++;
    if (eStati) throw new Error(`stato delle classificazioni: ${eStati.message}`);
    for (const s of data ?? []) if (s.stato === "classificata" && s.classificata_il && Date.parse(s.classificata_il) === Date.parse(istante)) daRimettere.push(s.procedura_id);
  }
  for (const b of blocchi(daRimettere, 200)) {
    const { error } = await db.from("radar_classificazioni_stato").upsert(b.map((procedura_id) => ({ procedura_id, stato: "in_attesa", errore: null, aggiornata_il: adessoIso })), { onConflict: "procedura_id" });
    misure.richiesteDb++;
    if (error) esito.errori++;
    else esito.statiInAttesa += b.length;
  }
  return esito;
}

// ───── riallineamento della colonna di UNA gara dopo una decisione dell'amministratore (console S4, 49C §4.2) ─────

export type EsitoRiallineamento =
  | { esito: "invariata"; colonna: StatoSettori }
  | { esito: "aggiornata"; prima: StatoSettori; dopo: StatoSettori }
  | { esito: "cambiata_nel_frattempo" | "gara_assente" }
  | { esito: "errore"; errore: string };

/**
 * Riallinea la colonna «settori» (e il metodo) di UNA gara alle sue righe ATTIVE della 0121, decisioni dell'amministratore comprese, con la
 * stessa regola del popolamento (colonnaDaRigheAttive): una gara decisa A o B entra subito nei filtri per settore, senza aspettare una
 * riclassificazione. Si chiama DOPO aver scritto la decisione (decisioneAmministratore). Letture: la gara e le sue righe attive; scrittura:
 * al più la colonna, condizionata a com'era letta (se intanto è cambiata non si tocca), più UNA traccia nel registro (correzione_dati, mai
 * notificabile). Se la traccia non si scrive, la colonna torna com'era: nessun cambio della colonna senza traccia. Non lancia eccezioni.
 */
export async function riallineaSettoriGara(db: SupabaseClient, proceduraId: string, adessoIso: string = new Date().toISOString()): Promise<EsitoRiallineamento> {
  try {
    const g = await db.from("radar_procedure").select("id, settori, metodo_settore").eq("id", proceduraId).maybeSingle<{ id: string; settori: string[] | null; metodo_settore: string | null }>();
    if (g.error) return { esito: "errore", errore: `gara: ${g.error.message}` };
    if (!g.data) return { esito: "gara_assente" };
    const righe = await db.from("radar_classificazioni").select("settore, rilevanza, attiva, da").eq("procedura_id", proceduraId).eq("attiva", true).returns<Pick<RigaClassificazione, "settore" | "rilevanza" | "attiva" | "da">[]>();
    if (righe.error) return { esito: "errore", errore: `righe: ${righe.error.message}` };
    const prima: StatoSettori = { settori: [...(g.data.settori ?? [])], metodo: g.data.metodo_settore ?? null };
    const calcolata = colonnaDaRigheAttive(righe.data ?? [], prima);
    if (!calcolata.cambia) return { esito: "invariata", colonna: prima };
    const dopo: StatoSettori = { settori: calcolata.settori, metodo: calcolata.metodo };
    const w = await stessaColonna(db.from("radar_procedure").update({ settori: dopo.settori, metodo_settore: dopo.metodo }).eq("id", proceduraId), prima).select("id");
    if (w.error) return { esito: "errore", errore: `colonna: ${w.error.message}` };
    if ((w.data ?? []).length === 0) return { esito: "cambiata_nel_frattempo" };
    const t = await db.from("radar_aggiornamenti").upsert(tracciaRiallineamento(proceduraId, prima, dopo, adessoIso), { onConflict: "procedura_id,tipo,campo,id_fonte", ignoreDuplicates: true });
    if (t.error) {
      await stessaColonna(db.from("radar_procedure").update({ settori: prima.settori, metodo_settore: prima.metodo }).eq("id", proceduraId), dopo);
      return { esito: "errore", errore: `traccia: ${t.error.message} (colonna rimessa com'era)` };
    }
    return { esito: "aggiornata", prima, dopo };
  } catch (e) {
    return { esito: "errore", errore: e instanceof Error ? e.message : String(e) };
  }
}
