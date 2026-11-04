import {
  SCOPE_DATA_MANAGER,
  URL_DATA_MANAGER_INGEST,
  URL_DATA_MANAGER_STATO,
  costruisciRichiestaAds,
  interpretaStatoRichiesta,
  type ConfigurazioneAds,
  type LeadPerConversione,
  type RichiestaAds,
} from "@/lib/demo-conversioni-calcoli";
import { configurazioneAdsDaAmbiente } from "@/lib/demo-ads-data-manager";
import { sha256Hex } from "@/lib/demo-hash";
import { credenzialiDaAmbiente, type CredenzialiOAuth } from "@/lib/google-oauth";
import {
  costruisciNote,
  costruisciRiepilogo,
  leggiErroreGoogle,
  mascheraId,
  type AmbienteVerifica,
  type IdProva,
  type ProvaVerifica,
  type RisultatoVerifica,
  type StatoRichiestaVerifica,
} from "@/lib/demo-ads-verifica-calcoli";

// Verifica della Data Manager API di Google Ads in SOLA VALIDAZIONE, con dati INVENTATI. Solo SERVER.
//
// Garanzie (provate dai test in scripts/verifica-data-manager-demo.ts):
//   - ogni richiesta a Google ha `validateOnly: true`: la funzione che invia RIFIUTA di mandare qualunque altra cosa, e la modalità
//     reale dell'ambiente (DEMO_ADS_VALIDATE_ONLY=0) viene ignorata;
//   - nessun database: non si legge né si scrive nessun lead, nessuna tabella; l'identificativo di clic e l'email sono inventati
//     (dominio «.invalid», identificativo marcato TEST_) e non finiscono da nessuna parte;
//   - niente segreti in uscita: né token di accesso, né refresh token, né client secret; gli identificativi dell'account e
//     dell'azione si mostrano mascherati (ultime tre cifre); dagli errori di Google si leggono solo codici e percorsi dei campi;
//   - una sola serie di 4 richieste di validazione e al più una lettura di stato, con un tempo massimo per ognuna.
//
// Cosa NON dimostra: una validazione riuscita non registra né attribuisce nulla (vedi demo-ads-verifica-calcoli.ts).

const URL_TOKEN = "https://oauth2.googleapis.com/token";
const TEMPO_MASSIMO_MS = 15_000;
export const ID_CLIC_SINTETICO = "TEST_VALIDAZIONE_OMNIA_0000000000";
const EMAIL_SINTETICA = "verifica.validazione@omnia-ai.invalid";
const ID_ACCOUNT_SBAGLIATO = "0000000001";

const VUOTO_AMBIENTE: AmbienteVerifica = { importazioneAccesa: false, modalitaConfigurata: "solo_verifica", configurazioneCompleta: false, credenzialiPresenti: false, account: null, azione: null, soloEmailAbilitato: false };

async function conTempoMassimo<T>(fn: (segnale: AbortSignal) => Promise<T>): Promise<T> {
  const controllo = new AbortController();
  const timer = setTimeout(() => controllo.abort(), TEMPO_MASSIMO_MS);
  try {
    return await fn(controllo.signal);
  } finally {
    clearTimeout(timer);
  }
}

// Il token di accesso (mai restituito all'esterno): si tiene solo lo stato della risposta, il codice d'errore di OAuth e se il token
// porta l'ambito della Data Manager API.
async function richiediToken(c: CredenzialiOAuth, fetchFn: typeof fetch): Promise<{ token: string | null; httpStato: number | null; codice: string; scopeDataManager: boolean | null }> {
  try {
    const risposta = await conTempoMassimo((segnale) =>
      fetchFn(URL_TOKEN, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: c.clientId, client_secret: c.clientSecret, refresh_token: c.refreshToken, grant_type: "refresh_token" }),
        signal: segnale,
      }),
    );
    const json = (await risposta.json().catch(() => null)) as { access_token?: unknown; scope?: unknown; error?: unknown } | null;
    if (!risposta.ok) {
      const codice = typeof json?.error === "string" && /^[a-z_]{3,40}$/.test(json.error) ? json.error : `HTTP_${risposta.status}`;
      return { token: null, httpStato: risposta.status, codice, scopeDataManager: null };
    }
    const token = typeof json?.access_token === "string" && json.access_token !== "" ? json.access_token : null;
    const scopeDataManager = typeof json?.scope === "string" ? json.scope.split(/\s+/).includes(SCOPE_DATA_MANAGER) : null;
    return { token, httpStato: risposta.status, codice: token ? "" : "RISPOSTA_SENZA_TOKEN", scopeDataManager };
  } catch {
    return { token: null, httpStato: null, codice: "RETE", scopeDataManager: null };
  }
}

// L'UNICO punto da cui parte una richiesta di scrittura verso Google: rifiuta tutto ciò che non è una validazione.
async function inviaValidazione(richiesta: RichiestaAds, token: string, fetchFn: typeof fetch): Promise<{ httpStato: number | null; json: unknown }> {
  if (richiesta.validateOnly !== true) throw new Error("La verifica rifiuta di inviare una richiesta senza validateOnly = true.");
  try {
    const risposta = await conTempoMassimo((segnale) =>
      fetchFn(URL_DATA_MANAGER_INGEST, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(richiesta), signal: segnale }),
    );
    return { httpStato: risposta.status, json: await risposta.json().catch(() => null) };
  } catch {
    return { httpStato: null, json: null };
  }
}

async function leggiStato(idRichiesta: string, token: string, fetchFn: typeof fetch): Promise<StatoRichiestaVerifica> {
  try {
    const risposta = await conTempoMassimo((segnale) => fetchFn(`${URL_DATA_MANAGER_STATO}?requestId=${encodeURIComponent(idRichiesta)}`, { method: "GET", headers: { Authorization: `Bearer ${token}` }, signal: segnale }));
    const json = await risposta.json().catch(() => null);
    if (!risposta.ok) {
      const errore = leggiErroreGoogle(json);
      return { httpStato: risposta.status, esito: errore.codice || `HTTP_${risposta.status}`, ragioni: errore.ragioni };
    }
    const stato = interpretaStatoRichiesta(json);
    return { httpStato: risposta.status, esito: stato.esito, ragioni: stato.ragioni };
  } catch {
    return { httpStato: null, esito: "RETE", ragioni: [] };
  }
}

function prova(id: IdProva, titolo: string, atteso: ProvaVerifica["atteso"], esito: { httpStato: number | null; json: unknown }): ProvaVerifica {
  const accettata = esito.httpStato !== null && esito.httpStato >= 200 && esito.httpStato < 300;
  const errore = leggiErroreGoogle(esito.json);
  const idRichiesta = (esito.json as { requestId?: unknown } | null)?.requestId;
  return {
    id,
    titolo,
    atteso,
    inviata: true,
    httpStato: esito.httpStato,
    codiceGoogle: accettata ? "" : errore.codice || (esito.httpStato === null ? "RETE" : `HTTP_${esito.httpStato}`),
    campi: accettata ? [] : errore.campi,
    ragioni: accettata ? [] : errore.ragioni,
    accettata,
    requestIdPresente: typeof idRichiesta === "string" && idRichiesta !== "",
    coerente: atteso === "informativa" ? true : atteso === "accettata" ? accettata : !accettata,
  };
}

export async function verificaDataManager(env: Record<string, string | undefined>, fetchFn: typeof fetch = fetch, adessoMs: number = Date.now()): Promise<RisultatoVerifica> {
  const configurazione = configurazioneAdsDaAmbiente(env);
  const credenziali = credenzialiDaAmbiente(env, "GOOGLE_ADS_REFRESH_TOKEN");
  const ambiente: AmbienteVerifica = {
    ...VUOTO_AMBIENTE,
    importazioneAccesa: env.DEMO_ADS_IMPORT_ENABLED === "1",
    modalitaConfigurata: env.DEMO_ADS_VALIDATE_ONLY === "0" ? "reale" : "solo_verifica",
    configurazioneCompleta: configurazione !== null,
    credenzialiPresenti: credenziali !== null,
    account: mascheraId(env.GOOGLE_ADS_CUSTOMER_ID),
    azione: mascheraId(env.GOOGLE_ADS_DEMO_CONVERSION_ACTION_ID),
    soloEmailAbilitato: env.DEMO_ADS_ALLOW_EMAIL_ONLY === "1",
  };
  const nonEseguita = (motivo: NonNullable<RisultatoVerifica["motivo"]>, oauth: RisultatoVerifica["oauth"] = { riuscita: false, httpStato: null, codice: "", scopeDataManager: null }): RisultatoVerifica => ({
    eseguita: false,
    motivo,
    ambiente,
    oauth,
    prove: [],
    statoRichiesta: null,
    riepilogo: null,
    note: costruisciNote(ambiente, [], null),
  });
  if (!configurazione) return nonEseguita("configurazione_incompleta");
  if (!credenziali) return nonEseguita("credenziali_mancanti");

  const t = await richiediToken(credenziali, fetchFn);
  const oauth = { riuscita: t.token !== null, httpStato: t.httpStato, codice: t.codice, scopeDataManager: t.scopeDataManager };
  if (!t.token) return nonEseguita("oauth_fallita", oauth);
  const token = t.token;

  // Dati INVENTATI: nessuna richiesta reale, nessun lead. La modalità reale dell'ambiente si ignora: qui è sempre «solo verifica».
  const reale: ConfigurazioneAds = { ...configurazione, soloVerifica: true };
  const lead = (extra: Partial<LeadPerConversione> = {}): LeadPerConversione => ({
    id: `verifica-${adessoMs}`,
    email: EMAIL_SINTETICA,
    booking_status: "confirmed",
    prima_prenotazione_il: new Date(adessoMs - 5 * 60_000).toISOString(),
    created_at: new Date(adessoMs - 10 * 60_000).toISOString(),
    sector: "Altro",
    gclid: ID_CLIC_SINTETICO,
    gbraid: null,
    wbraid: null,
    ga_client_id: null,
    ga_session_id: null,
    ga4_sent_at: null,
    ads_import_status: "ready",
    ads_attempts: 0,
    ...extra,
  });
  const consensi = { privacy: true, cookie: true, misurazione: true };
  const costruisci = (l: LeadPerConversione, config: ConfigurazioneAds, soloEmail: boolean): RichiestaAds => {
    const r = costruisciRichiestaAds(l, config, adessoMs, sha256Hex, { consentiSoloEmail: soloEmail }, consensi);
    if (!r.ok) throw new Error(`Richiesta sintetica non costruita (${r.motivo}).`);
    return r.richiesta;
  };

  const azioneSbagliata = configurazione.idAzioneConversione === "1000000001" ? "1000000002" : "1000000001";
  const richieste: { id: IdProva; titolo: string; atteso: ProvaVerifica["atteso"]; richiesta: RichiestaAds }[] = [
    { id: "clic", titolo: "Richiesta completa: account e azione veri, identificativo di clic INVENTATO, email inventata", atteso: "accettata", richiesta: costruisci(lead(), reale, false) },
    { id: "email", titolo: "Solo email cifrata inventata (senza clic)", atteso: "informativa", richiesta: costruisci(lead({ gclid: null }), reale, true) },
    { id: "controllo_azione", titolo: "Controllo negativo: stessa richiesta con un'azione di conversione SBAGLIATA (Google deve rifiutarla)", atteso: "rifiutata", richiesta: costruisci(lead(), { ...reale, idAzioneConversione: azioneSbagliata }, false) },
    { id: "controllo_account", titolo: "Controllo negativo: stessa richiesta con un account Google Ads SBAGLIATO (Google deve rifiutarla)", atteso: "rifiutata", richiesta: costruisci(lead(), { ...reale, idCliente: ID_ACCOUNT_SBAGLIATO }, false) },
  ];

  const prove: ProvaVerifica[] = [];
  let idRichiestaClic: string | null = null;
  for (const r of richieste) {
    const esito = await inviaValidazione(r.richiesta, token, fetchFn);
    prove.push(prova(r.id, r.titolo, r.atteso, esito));
    const idRichiesta = (esito.json as { requestId?: unknown } | null)?.requestId;
    if (r.id === "clic" && typeof idRichiesta === "string" && idRichiesta !== "") idRichiestaClic = idRichiesta;
  }

  // lo stato di una richiesta di sola validazione: si legge una volta e si riporta com'è (può non esistere: è normale)
  const statoRichiesta = idRichiestaClic ? await leggiStato(idRichiestaClic, token, fetchFn) : null;
  const riepilogo = costruisciRiepilogo(oauth, prove);
  return { eseguita: true, ambiente, oauth, prove, statoRichiesta, riepilogo, note: costruisciNote(ambiente, prove, riepilogo) };
}
