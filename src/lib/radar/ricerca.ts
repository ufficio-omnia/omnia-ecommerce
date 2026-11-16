// Ricerca nell'archivio pubblico (solo server, chiave di servizio, dopo le guardie). Una query con i filtri e la ricerca testuale in italiano
// sulla colonna indicizzata; rilevanza e ordinamento si calcolano sul risultato (ricerca-calcoli.ts). Nessuna chiamata a fonti esterne né
// a modelli durante la ricerca.
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CANDIDATI_MASSIMI,
  PROCEDURE_RICERCA,
  RISULTATI_PER_PAGINA,
  analizzaDomanda,
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
  "id, oggetto, oggetto_breve, sa_denominazione, sa_comune, sa_provincia, settori, metodo_settore, scadenza_offerte, scadenza_ora_indicata, data_pubblicazione, valore_stimato, durata_mesi, n_lotti, stato, rettificata, luogo_regioni, tipo_procedura, ultima_rilevazione_il, cpv_principale";

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
  }

  let q = admin.from("radar_procedure").select(COLONNE_RISULTATO).order("data_pubblicazione", { ascending: false }).order("id").limit(CANDIDATI_MASSIMI + 1);
  if (idDaCig) q = q.in("id", idDaCig);
  if (domanda.codiceFiscale) q = q.eq("sa_codice_fiscale", domanda.codiceFiscale);
  if (domanda.tsquery) q = q.textSearch("ricerca", domanda.tsquery, { config: "italian" });
  if (filtri.stato === "aperte") q = q.eq("stato", "aperta").or(`scadenza_offerte.is.null,scadenza_offerte.gt.${iso}`);
  else if (filtri.stato === "storico") q = q.or(`stato.neq.aperta,scadenza_offerte.lte.${iso}`);
  if (filtri.settori.length) q = q.overlaps("settori", filtri.settori);
  if (filtri.regioni.length) q = q.overlaps("luogo_regioni", filtri.regioni);
  if (filtri.importoMin !== null) q = q.gte("valore_stimato", filtri.importoMin);
  if (filtri.importoMax !== null) q = q.lte("valore_stimato", filtri.importoMax);
  if (filtri.scadenzaEntroGiorni !== null) q = q.gte("scadenza_offerte", iso).lte("scadenza_offerte", new Date(adesso.getTime() + filtri.scadenzaEntroGiorni * 86_400_000).toISOString());
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
