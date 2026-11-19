// Fase B4 (B1), grado 2 — Le guardie delle pagine e delle azioni di «Opportunità».
// Di base Opportunità resta del TITOLARE, come in produzione oggi. Con RADAR_UFFICIO_GARE=attivo (solo staging, interruttori-b4.ts) si apre
// anche all'Ufficio Gare ATTIVO dell'impresa (decisione dell'utente del 19/11, §8): cerca, salva, monitora, aggiunge. Il profilo di ricerca e
// le scelte dell'impresa restano del titolare: quelle azioni usano richiediTitolareAzione, mai queste guardie.
// I dati sono sempre dell'impresa: contesto.accountId (mai user.id), e le tabelle riservate filtrano con omnia_ai_titolare_effettivo().
import { richiediAccountAzione, richiediAccountPagina, richiediTitolareAzione, richiediTitolarePagina, type EsitoGuardiaAzione, type SessioneAccount } from "@/lib/omnia-ai-account-guardie";
import { ufficioGareRadarAttivo } from "./interruttori-b4";

/** Pagine di Opportunità: titolare; con il grado 2 acceso anche l'Ufficio Gare attivo (sospeso = nulla, come per le gare). */
export async function richiediOpportunitaPagina(): Promise<SessioneAccount | null> {
  return ufficioGareRadarAttivo(process.env) ? richiediAccountPagina() : richiediTitolarePagina();
}

/** Azioni di Opportunità (salva, monitora, aggiungi a mano): titolare; con il grado 2 acceso anche l'Ufficio Gare attivo. */
export async function richiediOpportunitaAzione(): Promise<EsitoGuardiaAzione> {
  return ufficioGareRadarAttivo(process.env) ? richiediAccountAzione() : richiediTitolareAzione();
}
