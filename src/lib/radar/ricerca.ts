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
  ordinaCandidati,
  punteggioRilevanza,
  type CandidatoRicerca,
  type DomandaAnalizzata,
  type FiltriRicerca,
  type Punteggio,
} from "./ricerca-calcoli";
import { aggiungiGiorni, giornoIso } from "./importa-ted-calcoli";
import type { StatoProcedura } from "./importa-calcoli";

export const COLONNE_RISULTATO =
  "id, oggetto, oggetto_breve, sa_denominazione, sa_comune, sa_provincia, settori, metodo_settore, scadenza_giorno, scadenza_offerte, scadenza_ora_indicata, data_pubblicazione, valore_stimato, durata_mesi, n_lotti, stato, rettificata, luogo_regioni, tipo_procedura, ultima_rilevazione_il, cpv_principale, unita_a";

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
};

export async function cercaGare(admin: SupabaseClient, filtri: FiltriRicerca, adesso: Date): Promise<RisultatoRicerca> {
  const inizio = Date.now();
  const domanda = analizzaDomanda(filtri.q);
  const vuoto = (errore: boolean): RisultatoRicerca => ({ righe: [], candidati: 0, oltreTetto: false, domanda, pagine: 0, ms: Date.now() - inizio, errore });
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

  // le gare collegate a un'altra (copie nascoste, 0117) non compaiono mai negli elenchi
  let q = admin.from("radar_procedure").select(COLONNE_RISULTATO).is("unita_a", null).order("data_pubblicazione", { ascending: false }).order("id").limit(CANDIDATI_MASSIMI + 1);
  if (idDaCig) q = q.in("id", idDaCig);
  if (domanda.codiceFiscale) q = q.eq("sa_codice_fiscale", domanda.codiceFiscale);
  if (domanda.tsquery) q = q.textSearch("ricerca", domanda.tsquery, { config: "italian" });
  const oggi = giornoIso(adesso);
  if (filtri.stato === "aperte") q = q.eq("stato", "aperta").or(condizioneAperte(oggi, iso));
  else if (filtri.stato === "storico") q = q.or(condizioneStorico(oggi, iso));
  if (filtri.settori.length) q = q.overlaps("settori", filtri.settori);
  if (filtri.regioni.length) q = q.overlaps("luogo_regioni", filtri.regioni);
  if (filtri.importoMin !== null) q = q.gte("valore_stimato", filtri.importoMin);
  if (filtri.importoMax !== null) q = q.lte("valore_stimato", filtri.importoMax);
  if (filtri.scadenzaEntroGiorni !== null) q = q.gte("scadenza_giorno", oggi).lte("scadenza_giorno", aggiungiGiorni(oggi, filtri.scadenzaEntroGiorni));
  if (filtri.pubblicataNegliUltimiGiorni !== null) q = q.gte("data_pubblicazione", aggiungiGiorni(giornoIso(adesso), -filtri.pubblicataNegliUltimiGiorni));
  if (filtri.procedure.length) q = q.in("tipo_procedura", PROCEDURE_RICERCA.filter((p) => filtri.procedure.includes(p.id)).flatMap((p) => [...p.valori]));

  const { data, error } = await q.returns<(RigaRisultato & { valore_stimato: number | string | null })[]>();
  if (error) {
    console.error("Tender Intelligence: ricerca non riuscita", error.message);
    return vuoto(true);
  }
  const righe = (data ?? []).map((r) => ({ ...r, valore_stimato: r.valore_stimato === null ? null : Number(r.valore_stimato) }));
  const oltreTetto = righe.length > CANDIDATI_MASSIMI;
  const candidati = righe.slice(0, CANDIDATI_MASSIMI).map((r) => ({ ...r, punteggio: punteggioRilevanza(r, domanda, filtri, adesso) }));
  const ordinati = ordinaCandidati(candidati, filtri.ordina);
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
  };
}
