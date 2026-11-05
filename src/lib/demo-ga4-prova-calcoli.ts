import { normalizzaEmail } from "@/lib/demo-lead-calcoli";
import { costruisciCorpoGa4, type CorpoGa4, type LeadPerConversione } from "@/lib/demo-conversioni-calcoli";
import type { ConsensiVerificati } from "@/lib/demo-consensi-calcoli";

// PROVA REALE dell'evento GA4 «demo_booking_confirmed»: regole PURE (nessuna rete, nessun database, nessun segreto). L'invio vero sta in
// src/lib/demo-ga4-prova.ts; la prenotazione esclusiva (riutilizzabile dal cron) in src/lib/demo-ga4-riserva.ts; la tabella è
// supabase/migrations/0099_demo_ga4_prove.sql; i test sono in scripts/verifica-demo-ga4-prova-omnia-ai.ts.
//
// Idea: un'azione dell'amministratore manda UN evento per UNA richiesta di prova, dopo averla PRENOTATA in modo esclusivo (una riga con
// chiave unica). GA4 non toglie i doppioni e il Measurement Protocol risponde «2xx» anche a un corpo malformato: per questo si sceglie
// «al massimo una volta» invece di «almeno una volta», non si ritenta mai da soli e una risposta positiva NON è la prova che l'evento
// sia in Analytics (quella arriva solo da una verifica dell'amministratore nei rapporti).

// ── Stati ────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export const STATI_PROVA_GA4 = ["reserved", "sent_unverified", "uncertain", "rejected", "verified", "not_received"] as const;
export type StatoProvaGa4 = (typeof STATI_PROVA_GA4)[number];

// Stati da cui l'amministratore può uscire dichiarando cosa ha visto in GA4. «reserved» solo se è passato abbastanza tempo da escludere
// che l'invio sia ancora in corso (vedi MINUTI_RISERVA_SCADUTA).
export const STATI_DA_RISOLVERE: readonly StatoProvaGa4[] = ["sent_unverified", "uncertain", "rejected"];
export const STATI_FINALI_PROVA: readonly StatoProvaGa4[] = ["verified", "not_received"];

// Oltre questo tempo una riga ancora «reserved» è una riserva INTERROTTA (la funzione è morta prima di registrare l'esito). Coincide con
// la durata del blocco condiviso con il cron (DURATA_BLOCCO_MS = 5 minuti): dopo, nessuna esecuzione può ancora essere in corso.
export const MINUTI_RISERVA_SCADUTA = 5;

export type TonoProva = "neutro" | "ok" | "avviso" | "errore" | "accento";

export const ETICHETTA_STATO_PROVA: Record<StatoProvaGa4, string> = {
  reserved: "prenotata (esito non registrato)",
  sent_unverified: "inviata, NON ancora verificata",
  uncertain: "esito incerto",
  rejected: "rifiutata da Google",
  verified: "verificata in GA4",
  not_received: "non risulta in GA4",
};

export const TONO_STATO_PROVA: Record<StatoProvaGa4, TonoProva> = {
  reserved: "avviso",
  sent_unverified: "accento",
  uncertain: "avviso",
  rejected: "errore",
  verified: "ok",
  not_received: "errore",
};

export const COSA_FARE_STATO_PROVA: Record<StatoProvaGa4, string> = {
  reserved: "L'invio è stato prenotato ma l'esito non risulta registrato. Se sono passati più di 5 minuti l'esecuzione si è interrotta: controlla in GA4 se l'evento c'è e dichiaralo qui sotto.",
  sent_unverified: "Google ha risposto positivamente, ma una risposta positiva non prova che l'evento sia stato registrato. Cerca «demo_booking_confirmed» in GA4 (Realtime entro 30 minuti, rapporti dopo alcune ore) e dichiara cosa vedi.",
  uncertain: "Non si sa se l'evento sia arrivato. Controlla in GA4 prima di fare altro e dichiara cosa vedi. Non si può rimandare per la stessa richiesta.",
  rejected: "Google ha rifiutato la richiesta (errore 4xx): di norma l'evento non è stato registrato. Controlla in GA4 e dichiara cosa vedi.",
  verified: "Evento visto in GA4. Prova conclusa.",
  not_received: "Evento NON visto in GA4. Prova conclusa: per riprovare serve una nuova prenotazione di prova (è un'altra richiesta).",
};

// ── Frasi di conferma digitate ───────────────────────────────────────────────────────────────────────────────────────────

export const FRASE_INVIO_PROVA = "INVIA 1 EVENTO REALE";
export const FRASE_EVENTO_PRESENTE = "CONFERMO EVENTO PRESENTE IN GA4";
export const FRASE_EVENTO_ASSENTE = "CONFERMO EVENTO ASSENTE IN GA4";

export type EsitoRisoluzione = "verified" | "not_received";

export function fraseRisoluzione(esito: EsitoRisoluzione): string {
  return esito === "verified" ? FRASE_EVENTO_PRESENTE : FRASE_EVENTO_ASSENTE;
}

// La frase si confronta INTERA e identica (maiuscole comprese): spazi ai bordi e doppi spazi non contano, nient'altro.
export function fraseCorretta(digitata: unknown, attesa: string): boolean {
  return typeof digitata === "string" && digitata.trim().replace(/\s+/g, " ") === attesa;
}

const MODELLO_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function idRichiestaValido(valore: unknown): valore is string {
  return typeof valore === "string" && MODELLO_UUID.test(valore);
}

// ── Interruttori: cosa serve perché la prova sia attiva ──────────────────────────────────────────────────────────────────

export type MotivoProvaSpenta = "ga4_spento" | "segreto_api_mancante" | "segreto_firma_mancante" | "email_prova_mancante";

export const TESTO_PROVA_SPENTA: Record<MotivoProvaSpenta, string> = {
  ga4_spento: "L'invio a GA4 è spento (DEMO_GA4_MP_ENABLED non è «1»).",
  segreto_api_mancante: "Manca il segreto API di GA4 (GA4_API_SECRET).",
  segreto_firma_mancante: "Manca il segreto per verificare la firma dei consensi.",
  email_prova_mancante: "Nessuna email di prova configurata (DEMO_GA4_PROVA_EMAIL su Vercel): finché non c'è, la prova è spenta.",
};

// Le email di prova: una o più, separate da virgola, punto e virgola o spazio; minuscole; solo ciò che ha la forma di un indirizzo.
export function emailProvaDaAmbiente(env: Record<string, string | undefined>): string[] {
  const grezzo = env.DEMO_GA4_PROVA_EMAIL ?? "";
  const viste = new Set<string>();
  for (const pezzo of grezzo.split(/[\s,;]+/)) {
    const email = normalizzaEmail(pezzo);
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) viste.add(email);
  }
  return [...viste];
}

export function emailInProva(email: string, lista: readonly string[]): boolean {
  return lista.includes(normalizzaEmail(email));
}

export type StatoGateProva = { attiva: boolean; mancanti: MotivoProvaSpenta[]; emailDiProva: number };

// L'invio reale della prova è indipendente da DEMO_GA4_MP_DEBUG (che riguarda solo il cron) ma richiede che GA4 sia acceso, che ci siano
// i segreti e che sia stata configurata almeno una email di prova. Senza email di prova NESSUNA richiesta può essere usata.
// `haSegretoFirma` = segretoFirmaConsensi(env) !== null: lo passa il chiamante (sul server) perché questo file deve poter finire anche
// nel codice del browser (etichette e frasi) e non può importare il modulo che usa la crittografia.
export function statoGateProva(env: Record<string, string | undefined>, haSegretoFirma: boolean): StatoGateProva {
  const mancanti: MotivoProvaSpenta[] = [];
  if (env.DEMO_GA4_MP_ENABLED !== "1") mancanti.push("ga4_spento");
  if (!env.GA4_API_SECRET?.trim()) mancanti.push("segreto_api_mancante");
  if (!haSegretoFirma) mancanti.push("segreto_firma_mancante");
  const emailDiProva = emailProvaDaAmbiente(env).length;
  if (emailDiProva === 0) mancanti.push("email_prova_mancante");
  return { attiva: mancanti.length === 0, mancanti, emailDiProva };
}

// ── Idoneità di una richiesta ────────────────────────────────────────────────────────────────────────────────────────────

export type LeadPerProva = LeadPerConversione & { attribution_consent: boolean | null };

export type MotivoNonIdonea =
  | "non_confermata"
  | "senza_data_prenotazione"
  | "email_non_di_prova"
  | "senza_client_id"
  | "cookie_non_accettati"
  | "consensi_non_validi"
  | "gia_inviata";

export const TESTO_NON_IDONEA: Record<MotivoNonIdonea, string> = {
  non_confermata: "la prenotazione non è confermata sul calendario",
  senza_data_prenotazione: "manca la data della prenotazione",
  email_non_di_prova: "l'email non è tra quelle di prova",
  senza_client_id: "manca il client_id di GA4 (cookie non accettati o non letti)",
  cookie_non_accettati: "i cookie pubblicitari non risultano accettati",
  consensi_non_validi: "consensi mancanti, negati o con firma non valida nel registro",
  gia_inviata: "l'evento risulta già inviato",
};

// Tutte le ragioni per cui una richiesta NON si può usare per la prova (elenco vuoto = idonea). `consensi` deve venire dal registro con la
// firma verificata (consensiVerificati + verificatoreFirma), mai dalle colonne riassuntive.
export function motiviNonIdonea(lead: LeadPerProva, consensi: ConsensiVerificati, listaProva: readonly string[]): MotivoNonIdonea[] {
  const motivi: MotivoNonIdonea[] = [];
  if (lead.booking_status !== "confirmed") motivi.push("non_confermata");
  if (!lead.prima_prenotazione_il) motivi.push("senza_data_prenotazione");
  if (!emailInProva(lead.email, listaProva)) motivi.push("email_non_di_prova");
  if (!lead.ga_client_id) motivi.push("senza_client_id");
  if (lead.attribution_consent !== true) motivi.push("cookie_non_accettati");
  if (!consensi.privacy || !consensi.cookie) motivi.push("consensi_non_validi");
  if (lead.ga4_sent_at !== null) motivi.push("gia_inviata");
  return motivi;
}

export type AnteprimaEvento = {
  corpo: CorpoGa4;
  timestampEventoMs: number;
  // «prenotazione» = l'evento porta l'ora della prenotazione (dentro le 72 ore); «invio» = porta l'ora dell'invio
  modalita: "prenotazione" | "invio";
  minutiDallaPrenotazione: number;
  // Realtime di GA4 mostra gli ultimi 30 minuti; non è documentato se guardi l'ora dell'evento o quella di ricezione
  dentroFinestraRealtime: boolean;
};

// Il corpo che verrebbe inviato, costruito dalla STESSA funzione del cron (stesso payload di produzione), più cosa serve a mostrarlo.
export function anteprimaEvento(lead: LeadPerProva, adessoMs: number, consensi: ConsensiVerificati): AnteprimaEvento | null {
  const corpo = costruisciCorpoGa4(lead, adessoMs, consensi);
  if (!corpo || !lead.prima_prenotazione_il) return null;
  const prenotataMs = Date.parse(lead.prima_prenotazione_il);
  const timestampEventoMs = corpo.timestamp_micros / 1000;
  const minuti = Math.floor((adessoMs - prenotataMs) / 60_000);
  return {
    corpo,
    timestampEventoMs,
    modalita: timestampEventoMs === prenotataMs ? "prenotazione" : "invio",
    minutiDallaPrenotazione: minuti,
    dentroFinestraRealtime: Math.floor((adessoMs - timestampEventoMs) / 60_000) <= 30,
  };
}

// ── Esito dell'invio ─────────────────────────────────────────────────────────────────────────────────────────────────────

export type CodiceEsitoInvio = "http_2xx" | "http_4xx" | "http_altro" | "timeout" | "rete";
export type EsitoInvioProva = { stato: "sent_unverified" | "rejected" | "uncertain"; codice: CodiceEsitoInvio; httpStato: number | null };

// 2xx → inviata ma NON verificata; 4xx → rifiutata (il richiedente ha sbagliato: di norma non è stata registrata); qualunque altra
// risposta (5xx, 3xx…) → incerta, perché Google può aver registrato l'evento e fallito dopo.
export function esitoDaStatoHttp(stato: number): EsitoInvioProva {
  if (stato >= 200 && stato < 300) return { stato: "sent_unverified", codice: "http_2xx", httpStato: stato };
  if (stato >= 400 && stato < 500) return { stato: "rejected", codice: "http_4xx", httpStato: stato };
  return { stato: "uncertain", codice: "http_altro", httpStato: stato };
}

// Nessuna risposta (tempo scaduto o errore di rete): l'evento può essere partito comunque. Mai un nuovo tentativo da soli.
export function esitoDaEccezione(tempoScaduto: boolean): EsitoInvioProva {
  return { stato: "uncertain", codice: tempoScaduto ? "timeout" : "rete", httpStato: null };
}

// ── Transizioni (le stesse del trigger del database) ─────────────────────────────────────────────────────────────────────

export function transizioneAmmessa(da: StatoProvaGa4, a: StatoProvaGa4): boolean {
  if (da === "reserved") return a !== "reserved";
  if (da === "sent_unverified" || da === "uncertain" || da === "rejected") return a === "verified" || a === "not_received";
  return false;
}

// Una riga si può risolvere a mano se è in uno stato «da risolvere», oppure se è una riserva rimasta senza esito da abbastanza tempo.
export function risolvibile(stato: StatoProvaGa4, riservataIl: string, adessoMs: number): boolean {
  if (STATI_DA_RISOLVERE.includes(stato)) return true;
  if (stato !== "reserved") return false;
  const dal = Date.parse(riservataIl);
  return Number.isFinite(dal) && adessoMs - dal >= MINUTI_RISERVA_SCADUTA * 60_000;
}

// ── Forme che attraversano server e pagina (solo esiti, mai segreti, mai email) ──────────────────────────────────────────

export type RigaProvaGa4 = {
  leadId: string;
  origine: "prova" | "cron";
  stato: StatoProvaGa4;
  riservataIl: string;
  inviataIl: string | null;
  esitoCodice: CodiceEsitoInvio | null;
  httpStato: number | null;
  timestampEventoIl: string;
  modalitaTimestamp: "prenotazione" | "invio";
  idMisurazione: string;
  risoltaIl: string | null;
  // vero se l'amministratore può dichiarare ora cosa ha visto in GA4
  risolvibile: boolean;
};

export type CandidataProva = {
  leadId: string;
  prenotataIl: string | null;
  settore: string;
  consensi: ConsensiVerificati;
  haClientId: boolean;
  haSessionId: boolean;
  idoneo: boolean;
  motivi: MotivoNonIdonea[];
  // solo se idonea
  anteprima: { timestampEventoIl: string; modalita: "prenotazione" | "invio"; minutiDallaPrenotazione: number; dentroFinestraRealtime: boolean; adPersonalization: "GRANTED" | "DENIED"; nomeEvento: string; parametri: string[] } | null;
};
