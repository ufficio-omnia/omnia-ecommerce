import { prossimoTentativo, TENTATIVI_MASSIMI, testoErroreSicuro, type StatoAds } from "@/lib/demo-conversioni-calcoli";

// INVIO REALE a Google Ads (Data Manager API, validateOnly=false): regole PURE (nessuna rete, nessun database, nessuna chiave).
// Qui si decide COSA SIGNIFICA ogni risposta di Google e in quale stato resta una conversione dopo l'invio. Il principio, voluto dal
// titolare: una conversione reale parte UNA volta; se l'esito è INCERTO (rete caduta, tempo scaduto, errore del server di Google,
// risposta senza identificativo) NON si rimanda mai da soli, perché la richiesta potrebbe essere già stata registrata. Si controlla,
// e se serve decide una persona.
//
// Nessuna migrazione: gli stati usano le colonne che già ci sono (demo_leads.ads_import_status, ads_request_id, ads_sent_at,
// ads_last_error, ads_next_attempt_at):
//   «sent» + nessun ads_request_id   = l'invio è stato PRENOTATO prima di chiamare Google; se non c'è l'esito è INCERTO
//   «sent» + ads_request_id          = Google ha ricevuto la richiesta; si aspetta l'elaborazione (requestStatus)
//   «accepted»                       = requestStatus ha risposto SUCCESS
//   «failed» + nessun prossimo       = rifiutata (4xx, o elaborazione fallita): serve una persona
//   «failed» + prossimo tentativo    = solo per la quota superata (429): Google non ha elaborato niente, si può riprovare da soli
// Documentazione letta il 04/11/2026 (events:ingest, requestStatus:retrieve).

// ── Esito della chiamata di invio ────────────────────────────────────────────────────────────────────────────────────────

export type EsitoChiamataAds =
  | { tipo: "inviata"; requestId: string }
  // L'esito non si conosce: Google potrebbe aver registrato la conversione. MAI un nuovo invio automatico.
  | { tipo: "incerta"; codice: string }
  // Google ha detto di no in modo chiaro (richiesta non valida, permessi): niente è stato registrato. Serve una persona.
  | { tipo: "rifiutata"; codice: string }
  // Quota superata, dichiarata da Google (429 con RESOURCE_EXHAUSTED): non ha elaborato la richiesta. L'unico caso in cui il cron può
  // riprovare da solo.
  | { tipo: "non_elaborata"; codice: string };

// Il codice d'errore di Google (es. «INVALID_ARGUMENT»), mai il messaggio libero.
export function codiceErroreGoogle(json: unknown): string {
  const stato = (json as { error?: { status?: unknown } } | null)?.error?.status;
  return typeof stato === "string" && /^[A-Z_]{3,40}$/.test(stato) ? stato : "";
}

// `risposta` è null se la chiamata non ha dato risposta (rete caduta o tempo scaduto).
export function esitoDaRispostaIngest(risposta: { stato: number; json: unknown } | null): EsitoChiamataAds {
  if (!risposta) return { tipo: "incerta", codice: "RETE_O_TIMEOUT" };
  const { stato, json } = risposta;
  if (stato >= 200 && stato < 300) {
    const id = (json as { requestId?: unknown } | null)?.requestId;
    if (typeof id === "string" && id.trim() !== "") return { tipo: "inviata", requestId: id.trim().slice(0, 200) };
    // Google ha risposto «ok» ma senza identificativo: la richiesta potrebbe essere stata registrata e non si potrebbe mai verificare
    return { tipo: "incerta", codice: "RISPOSTA_SENZA_ID_RICHIESTA" };
  }
  const codice = `HTTP_${stato} ${codiceErroreGoogle(json)}`.trim();
  // 429 = «non elaborata, si può riprovare» SOLO se è Google a dirlo in modo esplicito (stato HTTP 429 E codice RESOURCE_EXHAUSTED nel
  // corpo, cioè quota superata). Un 429 senza quel codice (un intermediario, un limitatore di traffico, un corpo non leggibile) è
  // AMBIGUO: non si sa chi ha rifiutato e se la richiesta è arrivata a Google, quindi resta bloccato come ogni esito incerto.
  if (stato === 429) return codiceErroreGoogle(json) === "RESOURCE_EXHAUSTED" ? { tipo: "non_elaborata", codice } : { tipo: "incerta", codice };
  if (stato >= 400 && stato < 500) return { tipo: "rifiutata", codice };
  // 5xx (o qualunque cosa inattesa): il server di Google può aver registrato la richiesta prima di fallire
  return { tipo: "incerta", codice };
}

// Cosa scrivere nella conversione dopo la risposta. `tentativi` = tentativi già contati, prenotazione di questo invio compresa.
// `ritentoAutomatico`: il cron lo permette solo per la quota superata; l'invio manuale mai.
export type AggiornamentoDopoInvio = {
  ads_import_status?: StatoAds;
  ads_request_id?: string;
  ads_sent_at?: string | null;
  ads_next_attempt_at?: string | null;
  ads_last_error: string | null;
};

export function aggiornamentoDopoInvio(esito: EsitoChiamataAds, tentativi: number, adessoMs: number, ritentoAutomatico: boolean): AggiornamentoDopoInvio {
  switch (esito.tipo) {
    case "inviata":
      return { ads_request_id: esito.requestId, ads_last_error: null };
    case "incerta":
      // resta «sent» senza identificativo: il cron non lo riprende mai e la console lo mostra come «esito incerto»
      return { ads_last_error: testoErroreSicuro([`${PREFISSO_ESITO_INCERTO}${esito.codice}`]) };
    case "rifiutata":
      return { ads_import_status: "failed", ads_sent_at: null, ads_next_attempt_at: null, ads_last_error: testoErroreSicuro([esito.codice]) };
    case "non_elaborata":
      return { ads_import_status: "failed", ads_sent_at: null, ads_next_attempt_at: ritentoAutomatico ? prossimoTentativo(tentativi, adessoMs) : null, ads_last_error: testoErroreSicuro([esito.codice]) };
  }
}

export const PREFISSO_ESITO_INCERTO = "ESITO_INCERTO:";

// ── Fasi di una conversione, in parole ───────────────────────────────────────────────────────────────────────────────────

export type FaseAds =
  | "non_ancora"
  | "da_inviare"
  | "in_invio"
  | "incerta"
  | "in_elaborazione"
  | "accettata"
  | "rifiutata"
  | "da_ritentare"
  | "non_inviabile";

export type RigaPerFase = {
  ads_import_status: StatoAds;
  ads_request_id: string | null;
  ads_last_error: string | null;
  ads_sent_at: string | null;
  ads_next_attempt_at: string | null;
};

// Dopo questo tempo un invio «prenotato» senza esito e senza errore registrato è un invio INTERROTTO (la funzione è morta durante la
// chiamata): l'esito è sconosciuto, quindi incerto.
export const MINUTI_INVIO_IN_CORSO = 5;

export function faseAds(r: RigaPerFase, adessoMs: number): FaseAds {
  switch (r.ads_import_status) {
    case "not_ready":
      return "non_ancora";
    case "ready":
    case "validated":
      return "da_inviare";
    case "sent": {
      if (r.ads_request_id) return "in_elaborazione";
      if ((r.ads_last_error ?? "").startsWith(PREFISSO_ESITO_INCERTO)) return "incerta";
      const quando = r.ads_sent_at ? Date.parse(r.ads_sent_at) : NaN;
      return Number.isFinite(quando) && adessoMs - quando < MINUTI_INVIO_IN_CORSO * 60_000 ? "in_invio" : "incerta";
    }
    case "accepted":
      return "accettata";
    case "failed":
      return r.ads_next_attempt_at ? "da_ritentare" : "rifiutata";
    default:
      return "non_inviabile";
  }
}

export const ETICHETTA_FASE_ADS: Record<FaseAds, string> = {
  non_ancora: "in attesa di prenotazione",
  da_inviare: "non ancora inviata a Google",
  in_invio: "invio in corso",
  incerta: "esito incerto",
  in_elaborazione: "inviata, Google la sta elaborando",
  accettata: "accettata da Google",
  rifiutata: "rifiutata o fallita",
  da_ritentare: "quota superata, da ritentare",
  non_inviabile: "non inviabile",
};

export const TONO_FASE_ADS: Record<FaseAds, "neutro" | "ok" | "avviso" | "errore" | "accento"> = {
  non_ancora: "neutro",
  da_inviare: "accento",
  in_invio: "avviso",
  incerta: "errore",
  in_elaborazione: "accento",
  accettata: "ok",
  rifiutata: "errore",
  da_ritentare: "avviso",
  non_inviabile: "neutro",
};

// Cosa fare, in una riga. L'esito incerto non si ritenta mai da soli: la verità è in Google Ads.
export const COSA_FARE_FASE_ADS: Record<FaseAds, string> = {
  non_ancora: "Nessuna prenotazione confermata: niente da fare.",
  da_inviare: "Idonea: si può inviare con l'azione qui sotto, oppure aspettare il cron se la modalità reale è accesa.",
  in_invio: "L'invio è stato prenotato pochi minuti fa: attendi e ricarica.",
  incerta:
    "NON è stata rimandata e non verrà rimandata da sola: Google potrebbe aver registrato la conversione. Controlla in Google Ads (Obiettivi → Conversioni → «OMNIA AI - DEMO prenotata», per data della conversione) se compare. Se compare, è fatta; se dopo 24 ore non compare, decidi tu: la ripresa si fa a mano nel database (guida, sezione «Invio reale»).",
  in_elaborazione: "Google ha ricevuto la richiesta: usa «Controlla l'esito» per leggere requestStatus (SUCCESS = acquisita). Può servire qualche minuto.",
  accettata: "Google ha dichiarato la richiesta elaborata con successo. Verifica anche nei rapporti di Google Ads (può servire qualche ora).",
  rifiutata: "Google ha rifiutato la richiesta o l'elaborazione è fallita: guarda il codice dell'errore. Una volta risolto il motivo si può riprovare con l'azione qui sotto.",
  da_ritentare: "Google ha risposto «quota superata»: non ha elaborato niente. Il cron riprova da solo, oppure si può inviare a mano.",
  non_inviabile: "Non inviabile (manca il consenso, il clic o la prenotazione è annullata).",
};

// ── Data minima della modalità reale (cron) ──────────────────────────────────────────────────────────────────────────────

// DEMO_ADS_REAL_FROM: data e ora (con fuso, es. 2026-11-10T12:00:00Z) da cui il CRON può inviare conversioni vere. Senza una data
// valida il cron in modalità reale NON invia niente: è il freno contro l'invio in blocco di tutto ciò che è «ready» o «validated» da prima
// dell'attivazione. Una data senza ora/fuso non vale (sarebbe ambigua).
const MODELLO_DATA_CON_FUSO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;

export function dataMinimaReale(env: Record<string, string | undefined>): { ms: number; iso: string } | null {
  const testo = env.DEMO_ADS_REAL_FROM?.trim();
  if (!testo || !MODELLO_DATA_CON_FUSO.test(testo)) return null;
  const ms = Date.parse(testo);
  return Number.isFinite(ms) ? { ms, iso: new Date(ms).toISOString() } : null;
}

// Quante conversioni VERE il cron può prenotare in un solo giro (ogni 10 minuti): un tetto contro un invio massiccio imprevisto.
export const LIMITE_INVII_REALI_PER_GIRO = 3;

// ── Invio manuale di una singola richiesta (console) ─────────────────────────────────────────────────────────────────────

export const FRASE_INVIO_ADS = "INVIA 1 CONVERSIONE REALE";
export const abbreviaIdRichiesta = (id: string) => id.slice(0, 8);

// La frase è specifica della richiesta (contiene i primi otto caratteri del suo id): non si può confermare a memoria per un'altra.
export function fraseInvioAds(leadId: string): string {
  return `${FRASE_INVIO_ADS} ${abbreviaIdRichiesta(leadId)}`;
}

export const FRASE_CONTROLLO_ESITO = "CONTROLLA ESITO";

// Stati da cui l'invio manuale può partire: mai da «sent» o «accepted» (già inviata), mai dalle richieste non inviabili.
// «failed» solo senza identificativo di richiesta: in quel caso Google ha detto di no in modo chiaro (o era solo una validazione).
export function inviabileAMano(r: RigaPerFase & { booking_status: string; ads_attempts: number }): boolean {
  if (r.booking_status !== "confirmed") return false;
  if (r.ads_attempts >= TENTATIVI_MASSIMI) return false;
  if (r.ads_import_status === "ready" || r.ads_import_status === "validated") return true;
  return r.ads_import_status === "failed" && !r.ads_request_id;
}

// Perché una richiesta NON si può inviare a mano, guardando solo lo stato (vuoto = si può). Il consenso e il clic si controllano dopo, costruendo la richiesta.
export type MotivoStatoNonInviabile = "non_confermata" | "tentativi_esauriti" | "stato_non_inviabile";
export function motiviStatoNonInviabile(r: RigaPerFase & { booking_status: string; ads_attempts: number }): MotivoStatoNonInviabile[] {
  if (inviabileAMano(r)) return [];
  if (r.booking_status !== "confirmed") return ["non_confermata"];
  if (r.ads_attempts >= TENTATIVI_MASSIMI) return ["tentativi_esauriti"];
  return ["stato_non_inviabile"];
}

export const mascheraIdentificativo = (valore: string) => (valore.length <= 3 ? "•••" : `•••${valore.slice(-3)}`);
