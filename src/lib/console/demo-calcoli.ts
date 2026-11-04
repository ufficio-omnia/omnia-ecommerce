import { configurazioneAdsDaAmbiente } from "@/lib/demo-ads-data-manager";
import type { StatoAds } from "@/lib/demo-conversioni-calcoli";
import { segretoFirmaConsensi } from "@/lib/demo-hash";
import { credenzialiDaAmbiente } from "@/lib/google-oauth";

// Sezione DEMO della console: regole PURE (nessun database, nessuna rete) per riassumere le richieste di demo, le prenotazioni, i casi da
// verificare e lo stato delle integrazioni con GA4 e Google Ads. Le letture stanno in demo.ts; la pagina in site-console/(app)/demo.
// Nessun valore segreto passa di qui: lo stato delle integrazioni è fatto di «sì/no» e di modalità, mai di chiavi.

export type StatoRichiesta = "pending" | "confirmed" | "cancelled" | "superseded";

export type RigaRichiestaDemo = {
  id: string;
  creataIl: string;
  nome: string;
  azienda: string;
  email: string;
  settore: string;
  stato: StatoRichiesta;
  primaPrenotazioneIl: string | null;
  // c'è un identificativo di clic pubblicitario (il valore non si mostra mai)
  conClic: boolean;
  utmSource: string | null;
  utmCampaign: string | null;
  haClientId: boolean;
  ga4InviatoIl: string | null;
  ga4Tentativi: number;
  statoAds: StatoAds;
  adsTentativi: number;
  adsErrore: string | null;
  adsInviatoIl: string | null;
  adsProssimoTentativo: string | null;
};

export type RiepilogoRichieste = {
  ricevute: number;
  persone: number;
  inAttesa: number;
  confermate: number;
  annullate: number;
  sostituite: number;
  conClic: number;
  // confermate / (ricevute − sostituite): le richieste sostituite non contano (la persona ne ha fatta una più recente); null se non ce ne sono
  tassoConferma: number | null;
};

export function riepilogoRichieste(righe: RigaRichiestaDemo[]): RiepilogoRichieste {
  const conta = (s: StatoRichiesta) => righe.filter((r) => r.stato === s).length;
  const sostituite = conta("superseded");
  const valide = righe.length - sostituite;
  const confermate = conta("confirmed");
  return {
    ricevute: righe.length,
    persone: new Set(righe.map((r) => r.email.trim().toLowerCase())).size,
    inAttesa: conta("pending"),
    confermate,
    annullate: conta("cancelled"),
    sostituite,
    conClic: righe.filter((r) => r.conClic).length,
    tassoConferma: valide > 0 ? confermate / valide : null,
  };
}

export const STATI_ADS: StatoAds[] = ["not_ready", "ready", "validated", "sent", "accepted", "failed", "skipped_no_consent", "skipped_no_identifier", "skipped_cancelled"];

export const ETICHETTA_STATO_ADS: Record<StatoAds, string> = {
  not_ready: "in attesa di prenotazione",
  ready: "pronta da inviare",
  validated: "verificata (solo verifica)",
  sent: "inviata, in elaborazione",
  accepted: "accettata da Google",
  failed: "in errore",
  skipped_no_consent: "non inviata: manca il consenso",
  skipped_no_identifier: "non inviata: nessun identificativo di clic",
  skipped_cancelled: "non inviata: prenotazione annullata",
};

export type Tono = "neutro" | "ok" | "avviso" | "errore" | "accento";
export const TONO_STATO_ADS: Record<StatoAds, Tono> = {
  not_ready: "neutro",
  ready: "accento",
  validated: "avviso",
  sent: "accento",
  accepted: "ok",
  failed: "errore",
  skipped_no_consent: "neutro",
  skipped_no_identifier: "neutro",
  skipped_cancelled: "neutro",
};

export type RiepilogoAds = {
  perStato: Record<StatoAds, number>;
  pronte: number;
  verificate: number;
  inviate: number;
  accettate: number;
  fallite: number;
  saltate: number;
  // da guardare a mano: in errore
  daControllare: number;
};

export function riepilogoAds(righe: { statoAds: StatoAds }[]): RiepilogoAds {
  const perStato = Object.fromEntries(STATI_ADS.map((s) => [s, 0])) as Record<StatoAds, number>;
  for (const r of righe) if (r.statoAds in perStato) perStato[r.statoAds]++;
  return {
    perStato,
    pronte: perStato.ready,
    verificate: perStato.validated,
    inviate: perStato.sent,
    accettate: perStato.accepted,
    fallite: perStato.failed,
    saltate: perStato.skipped_no_consent + perStato.skipped_no_identifier + perStato.skipped_cancelled,
    daControllare: perStato.failed,
  };
}

export const TENTATIVI_MASSIMI_GA4 = 5;

export type RiepilogoGa4 = { inviati: number; inAttesa: number; nonInviabili: number };

// Solo le richieste CONFERMATE contano per GA4: inviato = ga4_sent_at; in attesa = c'è il client_id e restano tentativi; non inviabile =
// manca il client_id (cookie non accettati) o si sono esauriti i tentativi.
export function riepilogoGa4(righe: { stato: StatoRichiesta; ga4InviatoIl: string | null; ga4Tentativi: number; haClientId: boolean }[]): RiepilogoGa4 {
  const confermate = righe.filter((r) => r.stato === "confirmed");
  const inviati = confermate.filter((r) => r.ga4InviatoIl !== null).length;
  const daInviare = confermate.filter((r) => r.ga4InviatoIl === null);
  const inAttesa = daInviare.filter((r) => r.haClientId && r.ga4Tentativi < TENTATIVI_MASSIMI_GA4).length;
  return { inviati, inAttesa, nonInviabili: daInviare.length - inAttesa };
}

// ── Casi da verificare del calendario ────────────────────────────────────────────────────────────────────────────────────

export const ETICHETTA_MOTIVO_CASO: Record<string, string> = {
  nessun_lead: "Nessuna richiesta con questa email",
  piu_lead: "Più richieste possibili",
  prenotazione_duplicata: "Seconda prenotazione della stessa persona",
  fuori_finestra: "Fuori dalla finestra di date",
  senza_partecipante: "Nessun partecipante esterno",
  email_non_valida: "Email del partecipante non valida",
};

// Cosa fare, in una riga: nessuno dei casi parte da solo, e nessuna conversione viene inviata finché non lo si risolve a mano.
export const COSA_FARE_CASO: Record<string, string> = {
  nessun_lead: "La persona ha prenotato senza passare dal modulo (o con un'altra email). Se la riconosci, la conversione non si può attribuire: lascia così.",
  piu_lead: "Ci sono più richieste possibili per la stessa prenotazione: l'abbinamento non è certo, quindi non conta come conversione.",
  prenotazione_duplicata: "La persona aveva già una demo confermata: la seconda prenotazione non conta come seconda conversione.",
  fuori_finestra: "La prenotazione è fuori dalla finestra di date della richiesta (o l'evento non ha la data di creazione).",
  senza_partecipante: "L'evento ha solo persone della squadra: controlla chi ha prenotato.",
  email_non_valida: "L'email del partecipante non è valida: controlla l'evento sul calendario.",
};

export function etichettaMotivoCaso(motivo: string): string {
  return ETICHETTA_MOTIVO_CASO[motivo] ?? motivo;
}

// ── Integrazioni: cosa è acceso, senza mai mostrare un valore segreto ────────────────────────────────────────────────────

export type StatoIntegrazioni = {
  richieste: { attive: boolean; segretoFirma: boolean };
  calendario: { acceso: boolean; credenziali: boolean; idCalendario: boolean };
  ga4: { acceso: boolean; segretoApi: boolean; soloVerifica: boolean };
  ads: { acceso: boolean; configurazione: boolean; credenziali: boolean; modalita: "solo_verifica" | "reale"; soloEmail: boolean };
};

const impostata = (v: string | undefined) => (v ?? "").trim() !== "";

export function statoIntegrazioni(env: Record<string, string | undefined>): StatoIntegrazioni {
  return {
    richieste: { attive: env.DEMO_LEADS_ATTIVO === "1", segretoFirma: segretoFirmaConsensi(env) !== null },
    calendario: { acceso: env.DEMO_CALENDAR_SYNC_ENABLED === "1", credenziali: credenzialiDaAmbiente(env, "GOOGLE_CALENDAR_REFRESH_TOKEN") !== null, idCalendario: impostata(env.GOOGLE_CALENDAR_ID) },
    ga4: { acceso: env.DEMO_GA4_MP_ENABLED === "1", segretoApi: impostata(env.GA4_API_SECRET), soloVerifica: env.DEMO_GA4_MP_DEBUG === "1" },
    ads: {
      acceso: env.DEMO_ADS_IMPORT_ENABLED === "1",
      configurazione: configurazioneAdsDaAmbiente(env) !== null,
      credenziali: credenzialiDaAmbiente(env, "GOOGLE_ADS_REFRESH_TOKEN") !== null,
      modalita: env.DEMO_ADS_VALIDATE_ONLY === "0" ? "reale" : "solo_verifica",
      soloEmail: env.DEMO_ADS_ALLOW_EMAIL_ONLY === "1",
    },
  };
}

// Gli avvisi da mostrare in cima: ciò che è spento o incompleto, in parole semplici.
export function avvisiIntegrazioni(s: StatoIntegrazioni): { tono: "avviso" | "errore"; testo: string }[] {
  const avvisi: { tono: "avviso" | "errore"; testo: string }[] = [];
  if (!s.richieste.attive) avvisi.push({ tono: "avviso", testo: "Registrazione delle richieste SPENTA (DEMO_LEADS_ATTIVO): le richieste arrivano solo per email all'ufficio e non si possono misurare." });
  if (s.richieste.attive && !s.richieste.segretoFirma) avvisi.push({ tono: "errore", testo: "Manca il segreto per firmare i consensi: a sistema attivo il modulo restituisce un errore e nessuna richiesta si registra." });
  if (s.calendario.acceso && (!s.calendario.credenziali || !s.calendario.idCalendario)) avvisi.push({ tono: "errore", testo: "Sincronizzazione del calendario accesa ma credenziali o ID del calendario mancanti: non parte." });
  if (s.ga4.acceso && !s.ga4.segretoApi) avvisi.push({ tono: "errore", testo: "Invio a GA4 acceso ma manca il segreto API di GA4: non parte." });
  if (s.ga4.acceso && s.ga4.soloVerifica) avvisi.push({ tono: "avviso", testo: "GA4 in modalità di verifica (debug): gli eventi si controllano ma non si registrano." });
  if (s.ads.acceso && (!s.ads.configurazione || !s.ads.credenziali)) avvisi.push({ tono: "errore", testo: "Importazione Google Ads accesa ma account, azione di conversione o credenziali mancanti: non parte." });
  if (s.ads.acceso && s.ads.configurazione && s.ads.credenziali && s.ads.modalita === "solo_verifica") avvisi.push({ tono: "avviso", testo: "Google Ads in SOLA VERIFICA: Google controlla le richieste ma non registra nessuna conversione." });
  if (s.ads.acceso && s.ads.modalita === "reale") avvisi.push({ tono: "avviso", testo: "Google Ads in modalità REALE: le conversioni vengono registrate sull'account." });
  return avvisi;
}

export type StatoSync = { ultimaEsecuzioneIl: string | null; ultimoSuccessoIl: string | null; ultimoErrore: string | null; bloccoFinoA: string | null } | null;

// Quando la sincronizzazione è considerata ferma: il cron gira ogni 10 minuti, quindi oltre mezz'ora senza esecuzioni è anomalo.
export const MINUTI_SINCRONIZZAZIONE_FERMA = 30;

export type SintesiSync = { tono: Tono; testo: string };

export function sintesiSincronizzazione(acceso: boolean, stato: StatoSync, adesso: Date): SintesiSync {
  if (!acceso) return { tono: "neutro", testo: "spenta" };
  if (!stato || !stato.ultimaEsecuzioneIl) return { tono: "avviso", testo: "accesa ma non ancora eseguita" };
  const minuti = Math.floor((adesso.getTime() - Date.parse(stato.ultimaEsecuzioneIl)) / 60_000);
  if (stato.ultimoErrore) return { tono: "errore", testo: `ultima esecuzione con errore (${stato.ultimoErrore})` };
  if (minuti > MINUTI_SINCRONIZZAZIONE_FERMA) return { tono: "errore", testo: `ferma da ${minuti} minuti` };
  return { tono: "ok", testo: "in funzione" };
}
