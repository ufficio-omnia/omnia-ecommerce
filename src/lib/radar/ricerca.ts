// Ricerca nell'archivio pubblico (solo server, chiave di servizio, dopo le guardie). Una query con i filtri e la ricerca testuale in italiano
// sulla colonna indicizzata; rilevanza e ordinamento si calcolano sul risultato (ricerca-calcoli.ts). Nessuna chiamata a fonti esterne né
// a modelli durante la ricerca.
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CANDIDATI_MASSIMI,
  PROCEDURE_RICERCA,
  RISULTATI_PER_PAGINA,
  analizzaDomanda,
  condizioneAperte,
  condizioneStorico,
  coerenteConFiltroSettori,
  ordinaCandidati,
  punteggioRilevanza,
  type CandidatoRicerca,
  type DomandaAnalizzata,
  type FiltriRicerca,
  type Punteggio,
} from "./ricerca-calcoli";
import { aggiungiGiorni, giornoIso } from "./importa-ted-calcoli";
import type { StatoProcedura } from "./importa-calcoli";
import { fontiNascosteAiClienti, fontiVisibiliDa } from "./fonti-nascoste";
import { CLASSIFICAZIONI_ELENCO, COLONNA_RIGHE_ATTIVE, classificazioneDaRiga, rilevanzaPerRicerca, type ConClassificazioni } from "./classificazioni-lettura";

export const COLONNE_RISULTATO =
  "id, oggetto, oggetto_breve, sa_denominazione, sa_comune, sa_provincia, settori, metodo_settore, scadenza_giorno, scadenza_offerte, scadenza_ora_indicata, data_pubblicazione, valore_stimato, durata_mesi, n_lotti, stato, rettificata, luogo_regioni, tipo_procedura, ultima_rilevazione_il, cpv_principale, unita_a";

/** Fase B3: le colonne di un elenco di gare; con le classificazioni accese anche stato e righe attive della 0121, nella STESSA richiesta. */
export function colonneElenco(classificazioni: boolean): string {
  return classificazioni ? `${COLONNE_RISULTATO}, ${CLASSIFICAZIONI_ELENCO}` : COLONNE_RISULTATO;
}

/** Fase B3: da una riga letta con colonneElenco(true) alla riga con la rilevanza (le colonne incorporate non si passano oltre). */
export function conRilevanza<T extends CandidatoRicerca>(r: T & ConClassificazioni): T {
  const { classificazione_stato, classificazioni, ...resto } = r;
  return { ...(resto as unknown as T), rilevanza: rilevanzaPerRicerca(classificazioneDaRiga({ classificazione_stato, classificazioni })) };
}

export type RigaRisultato = CandidatoRicerca & {
  sa_comune: string | null;
  sa_provincia: string | null;
  scadenza_ora_indicata: boolean;
  durata_mesi: number | null;
  n_lotti: number | null;
  stato: StatoProcedura;
  luogo_regioni: string[];
  tipo_procedura: string | null;
  ultima_rilevazione_il: string;
  cpv_principale: string | null;
  // gara che resta, se questa è collegata a un'altra (0117)
  unita_a: string | null;
};

export type RisultatoRicerca = {
  righe: (RigaRisultato & { punteggio: Punteggio })[];
  candidati: number;
  oltreTetto: boolean;
  domanda: DomandaAnalizzata;
  pagine: number;
  ms: number;
  errore: boolean;
  // fase B3: se le classificazioni sono state lette davvero (accese e tabelle disponibili), e quante gare il controllo di coerenza ha tolto
  classificazioni: boolean;
  scartatePerCoerenza: number;
};

// Fase B2b (pacchetto 16, punto 7): con le classificazioni accese (ambiente.ts, SPENTE di base) punteggio, ordinamento ed etichette
// distinguono le gare pertinenti (A) dalle correlate (B); spente, la ricerca è quella di prima.
export async function cercaGare(admin: SupabaseClient, filtri: FiltriRicerca, adesso: Date, opzioni: { classificazioni?: boolean } = {}): Promise<RisultatoRicerca> {
  const inizio = Date.now();
  const domanda = analizzaDomanda(filtri.q);
  const vuoto = (errore: boolean): RisultatoRicerca => ({ righe: [], candidati: 0, oltreTetto: false, domanda, pagine: 0, ms: Date.now() - inizio, errore, classificazioni: false, scartatePerCoerenza: 0 });
  const iso = adesso.toISOString();

  let idDaCig: string[] | null = null;
  if (domanda.cig) {
    const { data, error } = await admin.from("radar_lotti").select("procedura_id").eq("cig", domanda.cig).returns<{ procedura_id: string }[]>();
    if (error) return vuoto(true);
    idDaCig = [...new Set((data ?? []).map((r) => r.procedura_id))];
    if (idDaCig.length === 0) return vuoto(false);
    // un CIG di una gara collegata a un'altra (0117) porta alla gara che resta
    const { data: collegate } = await admin.from("radar_procedure").select("id, unita_a").in("id", idDaCig).not("unita_a", "is", null).returns<{ id: string; unita_a: string }[]>();
    if ((collegate ?? []).length) idDaCig = [...new Set(idDaCig.map((id) => collegate?.find((c) => c.id === id)?.unita_a ?? id))];
  }

  // le gare collegate a un'altra (copie nascoste, 0117) non compaiono mai negli elenchi; né quelle che hanno SOLO fonti non ancora mostrabili
  // ai clienti (0120: SardegnaCAT finché manca il parere legale)
  const visibili = fontiVisibiliDa(await fontiNascosteAiClienti());
  const oggi = giornoIso(adesso);
  // fase B3: con le classificazioni accese, stato e righe attive della 0121 arrivano nella STESSA richiesta (nessuna lettura in più)
  const interroga = (conClassificazioni: boolean) => {
    let q = admin.from("radar_procedure").select(colonneElenco(conClassificazioni)).is("unita_a", null).overlaps("fonti", visibili).order("data_pubblicazione", { ascending: false }).order("id").limit(CANDIDATI_MASSIMI + 1);
    if (conClassificazioni) q = q.eq(COLONNA_RIGHE_ATTIVE, true);
    if (idDaCig) q = q.in("id", idDaCig);
    if (domanda.codiceFiscale) q = q.eq("sa_codice_fiscale", domanda.codiceFiscale);
    if (domanda.tsquery) q = q.textSearch("ricerca", domanda.tsquery, { config: "italian" });
    if (filtri.stato === "aperte") q = q.eq("stato", "aperta").or(condizioneAperte(oggi, iso));
    else if (filtri.stato === "storico") q = q.or(condizioneStorico(oggi, iso));
    if (filtri.settori.length) q = q.overlaps("settori", filtri.settori);
    if (filtri.regioni.length) q = q.overlaps("luogo_regioni", filtri.regioni);
    if (filtri.importoMin !== null) q = q.gte("valore_stimato", filtri.importoMin);
    if (filtri.importoMax !== null) q = q.lte("valore_stimato", filtri.importoMax);
    if (filtri.scadenzaEntroGiorni !== null) q = q.gte("scadenza_giorno", oggi).lte("scadenza_giorno", aggiungiGiorni(oggi, filtri.scadenzaEntroGiorni));
    if (filtri.pubblicataNegliUltimiGiorni !== null) q = q.gte("data_pubblicazione", aggiungiGiorni(giornoIso(adesso), -filtri.pubblicataNegliUltimiGiorni));
    if (filtri.procedure.length) q = q.in("tipo_procedura", PROCEDURE_RICERCA.filter((p) => filtri.procedure.includes(p.id)).flatMap((p) => [...p.valori]));
    return q.returns<(RigaRisultato & ConClassificazioni & { valore_stimato: number | string | null })[]>();
  };

  let classificazioni = opzioni.classificazioni === true;
  let { data, error } = await interroga(classificazioni);
  if (error && classificazioni) {
    // tabelle della 0121 assenti o non leggibili: la ricerca resta quella di prima (una richiesta in più solo in questo caso)
    console.error("Tender Intelligence: classificazioni non leggibili, ricerca senza", error.message);
    classificazioni = false;
    ({ data, error } = await interroga(false));
  }
  if (error) {
    console.error("Tender Intelligence: ricerca non riuscita", error.message);
    return vuoto(true);
  }
  const righe = (data ?? []).map((r) => {
    const conValore = { ...r, valore_stimato: r.valore_stimato === null ? null : Number(r.valore_stimato) };
    return classificazioni ? conRilevanza(conValore) : conValore;
  });
  const oltreTetto = righe.length > CANDIDATI_MASSIMI;
  const letti = righe.slice(0, CANDIDATI_MASSIMI);
  const primi = classificazioni ? letti.filter((r) => coerenteConFiltroSettori(r, filtri)) : letti;
  const scartatePerCoerenza = letti.length - primi.length;
  if (scartatePerCoerenza > 0) console.error(`Tender Intelligence: ${scartatePerCoerenza} gare con la colonna «settori» non coerente con le classificazioni`);
  const candidati = primi.map((c) => ({ ...c, punteggio: punteggioRilevanza(c, domanda, filtri, adesso) }));
  const ordinati = ordinaCandidati(candidati, filtri.ordina, filtri);
  const pagine = Math.max(1, Math.ceil(ordinati.length / RISULTATI_PER_PAGINA));
  const pagina = Math.min(filtri.pagina, pagine);
  return {
    righe: ordinati.slice((pagina - 1) * RISULTATI_PER_PAGINA, pagina * RISULTATI_PER_PAGINA),
    candidati: ordinati.length,
    oltreTetto,
    domanda,
    pagine,
    ms: Date.now() - inizio,
    errore: false,
    classificazioni,
    scartatePerCoerenza,
  };
}
