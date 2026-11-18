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
import { FONTE_REGISTRO, isoDaEsecuzione, pianoGara, statoDaRegistro, type GaraArchivio, type LottoDaRiclassificare, type PianoGara } from "./riclassifica-settori";

const PAGINA = 1000;
export const COLONNE_GARA_ARCHIVIO = "id, chiave, oggetto, cpv_principale, cpv_tutti, settori, metodo_settore, natura_contratto, fonti, aggiornata_il, unita_a";

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
  settoriCambiati: number;
  tracce: number;
  cambiateNelFrattempo: number;
  errori: number;
  classificazioni: EsitoClassificazioni;
};

export async function applicaPiani(db: SupabaseClient, piani: readonly PianoGara[], misure: Misure, adessoIso: string): Promise<EsitoApplica> {
  const esito: EsitoApplica = { gare: 0, settoriCambiati: 0, tracce: 0, cambiateNelFrattempo: 0, errori: 0, classificazioni: { saltata: false, inserite: 0, disattivate: 0, invariate: 0, protette: 0, cambiateNelFrattempo: 0, classificate: 0, fallite: 0 } };
  const consentite: PianoGara[] = [];
  for (const p of piani) {
    if (p.tipo !== "da_scrivere" || !p.ric) continue;
    esito.gare++;
    if (p.cambiaSettori && p.registro) {
      const { prima, dopo } = p.ric;
      const { data, error } = await stessaColonna(db.from("radar_procedure").update({ settori: dopo.settori, metodo_settore: dopo.metodo }).eq("id", p.proceduraId), prima).select("id");
      misure.richiesteDb++;
      if (error) {
        esito.errori++;
        continue;
      }
      if ((data ?? []).length === 0) {
        // la colonna è cambiata dopo la lettura: niente righe né stato, si rifà alla prossima esecuzione
        esito.cambiateNelFrattempo++;
        continue;
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
      esito.settoriCambiati++;
      esito.tracce++;
    }
    consentite.push(p);
  }
  // righe e stato, a blocchi di gare (letture e inserimenti raggruppati)
  for (const b of blocchi(consentite, 100)) {
    const e = await scriviClassificazioni(db, b.map((p) => ({ proceduraId: p.proceduraId, versione: p.ric?.classificazione.versione ?? "", calcolate: p.calcolate })), misure, adessoIso);
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
  const gare = [...new Set([...(tracce ?? []).map((t) => t.procedura_id), ...(nuove ?? []).map((r) => r.procedura_id), ...(chiuse ?? []).map((r) => r.procedura_id)])];
  if (gare.length > massimo) throw new TroppeGare(`${gare.length} gare da ripristinare, più del massimo ${massimo}: nessuna scrittura.`);
  esito.gare = gare.length;
  const toccate = new Set<string>();

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
      esito.colonnaGiaCambiata++;
      continue;
    }
    await db.from("radar_aggiornamenti").upsert(
      { procedura_id: t.procedura_id, tipo: "correzione_dati", campo: "settori_ripristinati", valore_precedente: t.valore_nuovo, valore_nuovo: t.valore_precedente, fonte: FONTE_REGISTRO, id_fonte: `annullato:${t.id_fonte}`.slice(0, 200), nota: "Correzione dei settori annullata: rimessi i settori di prima", notificabile: false },
      { onConflict: "procedura_id,tipo,campo,id_fonte", ignoreDuplicates: true },
    );
    misure.richiesteDb++;
    esito.colonnaRipristinata++;
    toccate.add(t.procedura_id);
  }

  // 2) righe: si chiudono quelle dell'esecuzione; le righe che l'esecuzione aveva chiuso tornano come copie nuove
  const attiveOra = new Map<string, RigaClassificazione[]>();
  for (const b of blocchi(gare, 100)) {
    const { data } = await db.from("radar_classificazioni").select("*").in("procedura_id", b).eq("attiva", true).returns<RigaClassificazione[]>();
    misure.richiesteDb++;
    for (const r of data ?? []) attiveOra.set(r.procedura_id, [...(attiveOra.get(r.procedura_id) ?? []), r]);
  }
  // la copia conserva l'autore della riga di prima (così annullare anche quell'esecuzione la chiude); la nota dice che è un ripristino
  const copia = (r: RigaClassificazione): RigaClassificazione => ({
    ...r,
    id: nuovoId(),
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
      const vecchia = chiuseQui.find((r) => r.settore === s && (nuova ? r.sostituita_da === nuova.id : r.sostituita_da === null)) ?? null;
      // un settore che l'esecuzione aveva solo chiuso: si riporta solo se nel frattempo nessuna riga è attiva (ripetere non duplica)
      if (!nuova && (!vecchia || attive.some((r) => r.settore === s))) continue;
      const ripristinata = vecchia ? copia(vecchia) : null;
      if (nuova) {
        const { data, error } = await db.from("radar_classificazioni").update({ attiva: false, sostituita_il: adessoIso, sostituita_da: ripristinata?.id ?? null }).eq("id", nuova.id).eq("attiva", true).select("id");
        misure.richiesteDb++;
        if (error || (data ?? []).length === 0) {
          esito.errori++;
          continue;
        }
        esito.righeChiuse++;
        toccate.add(id);
      }
      if (ripristinata) {
        const { error } = await db.from("radar_classificazioni").insert(ripristinata);
        misure.richiesteDb++;
        if (error) esito.errori++;
        else {
          esito.righeRipristinate++;
          toccate.add(id);
        }
      }
    }
  }

  // 3) stato: «in attesa» (da classificare di nuovo) per le gare davvero toccate; mai «non pertinente»
  for (const b of blocchi([...toccate], 200)) {
    const { error } = await db.from("radar_classificazioni_stato").upsert(b.map((procedura_id) => ({ procedura_id, stato: "in_attesa", errore: null, aggiornata_il: adessoIso })), { onConflict: "procedura_id" });
    misure.richiesteDb++;
    if (error) esito.errori++;
    else esito.statiInAttesa += b.length;
  }
  return esito;
}
