// Verifica della Data Manager API di Google Ads in SOLA VALIDAZIONE: regole PURE (nessuna rete, nessun database, nessun segreto) per
// interpretare le risposte di Google, nascondere gli identificativi e riassumere l'esito. L'invio vero sta in demo-ads-verifica.ts.
//
// Cosa dimostra una validazione riuscita (validateOnly = true) e cosa NO:
//   - SÌ: Google ha accettato le credenziali, ha riconosciuto l'account e l'azione di conversione, e ha trovato la richiesta ben formata;
//   - NO: non registra nulla e non attribuisce nulla a una campagna. L'attribuzione vera esiste solo con l'invio reale di un
//     identificativo di clic (gclid) vero, ricevuto da un annuncio, entro la finestra di conversione.
// Per questo la verifica include CONTROLLI NEGATIVI (stessa richiesta con un'azione o un account sbagliati, che Google deve rifiutare):
// se il controllo viene accettato, la validazione non distingue e la prova non vale per quel punto.

export type IdProva = "clic" | "email" | "controllo_azione" | "controllo_account";

export type ProvaVerifica = {
  id: IdProva;
  titolo: string;
  // «accettata»: ci si aspetta che Google la accetti; «rifiutata»: è un controllo negativo; «informativa»: l'esito si riporta e basta
  atteso: "accettata" | "rifiutata" | "informativa";
  inviata: boolean;
  httpStato: number | null;
  // solo codici di Google (INVALID_ARGUMENT, PERMISSION_DENIED…), mai messaggi liberi
  codiceGoogle: string;
  // percorsi dei campi contestati da Google (nessun valore), es. «destinations[0].productDestinationId»
  campi: string[];
  ragioni: string[];
  accettata: boolean;
  requestIdPresente: boolean;
  // l'esito è quello atteso (per le prove «informative» è sempre vero)
  coerente: boolean;
};

export type StatoRichiestaVerifica = { httpStato: number | null; esito: string; ragioni: string[] };

export type Riepilogo = {
  autenticazione: "ok" | "fallita";
  permessi: "ok" | "negati" | "non_verificabile";
  account: "riconosciuto" | "non_riconosciuto" | "non_distinguibile" | "non_provato";
  azione: "riconosciuta" | "non_riconosciuta" | "non_distinguibile" | "non_provata";
  schema: "valido" | "non_valido" | "non_provato";
  // sempre «nessuna»: ogni richiesta della verifica ha validateOnly = true (si rifiuta di inviare altro)
  conversioniRegistrate: "nessuna";
};

export type AmbienteVerifica = {
  importazioneAccesa: boolean;
  modalitaConfigurata: "solo_verifica" | "reale";
  configurazioneCompleta: boolean;
  credenzialiPresenti: boolean;
  // identificativi MASCHERATI (solo le ultime tre cifre), mai in chiaro
  account: string | null;
  azione: string | null;
  soloEmailAbilitato: boolean;
};

export type RisultatoVerifica = {
  eseguita: boolean;
  motivo?: "configurazione_incompleta" | "credenziali_mancanti" | "oauth_fallita";
  ambiente: AmbienteVerifica;
  oauth: { riuscita: boolean; httpStato: number | null; codice: string; scopeDataManager: boolean | null };
  prove: ProvaVerifica[];
  statoRichiesta: StatoRichiestaVerifica | null;
  riepilogo: Riepilogo | null;
  note: string[];
};

// 1234567890 → •••••••890
export function mascheraId(id: string | null | undefined): string | null {
  const pulito = (id ?? "").replace(/\D/g, "");
  if (pulito.length === 0) return null;
  return `${"•".repeat(Math.max(0, pulito.length - 3))}${pulito.slice(-3)}`;
}

function unici(lista: string[]): string[] {
  return [...new Set(lista)];
}

// Dal corpo di un errore di Google: SOLO il codice di stato, i motivi in maiuscolo e i percorsi dei campi. Nessun messaggio libero
// (potrebbe riportare identificativi o valori inviati).
export function leggiErroreGoogle(json: unknown): { codice: string; ragioni: string[]; campi: string[] } {
  const errore = (json as { error?: { status?: unknown; details?: unknown } } | null)?.error;
  const codice = typeof errore?.status === "string" && /^[A-Z_]{3,40}$/.test(errore.status) ? errore.status : "";
  const ragioni: string[] = [];
  const campi: string[] = [];
  for (const dettaglio of Array.isArray(errore?.details) ? (errore.details as unknown[]) : []) {
    const d = dettaglio as { reason?: unknown; fieldViolations?: unknown };
    if (typeof d?.reason === "string" && /^[A-Z0-9_]{1,80}$/.test(d.reason)) ragioni.push(d.reason);
    for (const v of Array.isArray(d?.fieldViolations) ? (d.fieldViolations as unknown[]) : []) {
      const campo = (v as { field?: unknown })?.field;
      if (typeof campo === "string" && /^[A-Za-z0-9_.[\]]{1,120}$/.test(campo)) campi.push(campo);
    }
  }
  return { codice, ragioni: unici(ragioni), campi: unici(campi) };
}

// A quale parte della richiesta si riferiscono i campi contestati.
export function classificaCampi(campi: string[]): { account: boolean; azione: boolean; altri: boolean } {
  let account = false;
  let azione = false;
  let altri = false;
  for (const c of campi) {
    if (/productDestinationId|product_destination_id/i.test(c)) azione = true;
    else if (/operatingAccount|operating_account|loginAccount|login_account|accountId|account_id|destinations/i.test(c)) account = true;
    else altri = true;
  }
  return { account, azione, altri };
}

// Il riepilogo sui sei punti richiesti, dalle prove fatte.
export function costruisciRiepilogo(oauth: RisultatoVerifica["oauth"], prove: ProvaVerifica[]): Riepilogo {
  const prova = (id: IdProva) => prove.find((p) => p.id === id);
  const p1 = prova("clic");
  const ctrlAzione = prova("controllo_azione");
  const ctrlAccount = prova("controllo_account");

  const base: Riepilogo = { autenticazione: oauth.riuscita ? "ok" : "fallita", permessi: "non_verificabile", account: "non_provato", azione: "non_provata", schema: "non_provato", conversioniRegistrate: "nessuna" };
  if (!oauth.riuscita || !p1 || !p1.inviata) return base;

  const negati = p1.httpStato === 401 || p1.httpStato === 403 || p1.codiceGoogle === "PERMISSION_DENIED" || p1.codiceGoogle === "UNAUTHENTICATED" || oauth.scopeDataManager === false;
  const permessi: Riepilogo["permessi"] = negati ? "negati" : p1.httpStato === null ? "non_verificabile" : "ok";
  const classe = classificaCampi(p1.campi);

  let schema: Riepilogo["schema"] = "non_provato";
  if (p1.accettata) schema = "valido";
  else if (classe.altri || (p1.codiceGoogle === "INVALID_ARGUMENT" && !classe.account && !classe.azione && p1.campi.length === 0)) schema = "non_valido";

  let account: Riepilogo["account"] = "non_provato";
  if (p1.accettata) {
    if (ctrlAccount?.inviata) account = ctrlAccount.accettata ? "non_distinguibile" : "riconosciuto";
  } else if (classe.account || (p1.codiceGoogle === "PERMISSION_DENIED" && !classe.azione)) {
    account = "non_riconosciuto";
  }

  let azione: Riepilogo["azione"] = "non_provata";
  if (p1.accettata) {
    if (ctrlAzione?.inviata) azione = ctrlAzione.accettata ? "non_distinguibile" : "riconosciuta";
  } else if (classe.azione) {
    azione = "non_riconosciuta";
  }

  return { ...base, permessi, schema, account, azione };
}

// Le spiegazioni da mostrare accanto ai numeri: cosa significa questo esito e cosa NON significa.
export function costruisciNote(ambiente: AmbienteVerifica, prove: ProvaVerifica[], riepilogo: Riepilogo | null): string[] {
  const note: string[] = [];
  note.push("Ogni richiesta di questa verifica è di SOLA VALIDAZIONE (validateOnly = true): Google la controlla e non registra nulla. Nessun lead reale è stato letto né modificato, nessun dato è stato scritto nel database.");
  note.push("Una validazione riuscita NON è un'attribuzione pubblicitaria. L'attribuzione a una campagna esiste solo con l'invio REALE di un identificativo di clic (gclid) vero, arrivato da un annuncio, entro la finestra di conversione: comparirà in Google Ads → Obiettivi → Conversioni → «OMNIA AI - DEMO prenotata», anche dopo alcune ore.");
  if (!ambiente.importazioneAccesa) note.push("In questa installazione DEMO_ADS_IMPORT_ENABLED non è «1»: il cron non invia nulla a Google. La verifica è indipendente e funziona lo stesso.");
  if (ambiente.modalitaConfigurata === "reale") note.push("ATTENZIONE: in questa installazione DEMO_ADS_VALIDATE_ONLY=0, cioè l'importazione REALE è accesa. Questa verifica resta comunque in sola validazione; per tornare in sicurezza imposta DEMO_ADS_VALIDATE_ONLY=1 (o toglila) e rilancia il deploy.");
  else note.push("In questa installazione la modalità configurata è «solo verifica» (DEMO_ADS_VALIDATE_ONLY diverso da «0»).");
  if (riepilogo?.account === "non_distinguibile") note.push("Il controllo con un account sbagliato è stato ACCETTATO da Google: la validazione non controlla l'account, quindi il riconoscimento dell'account NON è provato da questa verifica.");
  if (riepilogo?.azione === "non_distinguibile") note.push("Il controllo con un'azione di conversione sbagliata è stato ACCETTATO da Google: la validazione non controlla l'azione, quindi il riconoscimento dell'azione NON è provato da questa verifica (si vedrà solo con il primo invio reale).");
  const email = prove.find((p) => p.id === "email");
  if (email?.inviata) {
    note.push(email.accettata ? "Google accetta anche l'invio con la sola email cifrata (serve solo se accendi DEMO_ADS_ALLOW_EMAIL_ONLY)." : `L'invio con la sola email cifrata è stato rifiutato${email.codiceGoogle ? ` (${email.codiceGoogle})` : ""}: lascia spento DEMO_ADS_ALLOW_EMAIL_ONLY.`);
  }
  return note;
}
