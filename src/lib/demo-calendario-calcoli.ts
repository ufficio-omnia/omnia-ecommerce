import { normalizzaEmail } from "@/lib/demo-lead-calcoli";

// Prenotazioni delle demo su Google Calendar: regole PURE (nessuna rete, nessun database) per riconoscere le DEMO, trovare chi ha
// prenotato e abbinare la prenotazione al lead salvato dal modulo. La lettura del calendario e le scritture stanno in
// src/lib/demo-calendario-sync.ts; i test in scripts/verifica-demo-tracciamento-omnia-ai.ts.
//
// Cosa NON si presume (documentazione Google Calendar API, letta il 04/11/2026): l'evento di una prenotazione da «Programmazione
// appuntamenti» non ha un tipo suo (eventType è solo default/fromGmail/…) né un campo «chi ha prenotato»: chi prenota compare solo
// tra i partecipanti. Le DEMO si riconoscono quindi dal TITOLO (espressione regolare in configurazione, da confermare con una
// prenotazione di prova) e il lead dall'EMAIL normalizzata. Nell'evento non c'è l'id del lead e non lo si inventa.
//
// Regola d'oro: se l'abbinamento non è certo, NON si abbina e NON parte nessuna conversione: il caso si registra per la verifica a
// mano. Meglio perdere una conversione che attribuirne una sbagliata.

export type PartecipanteCalendario = { email?: string; responseStatus?: string; organizer?: boolean; self?: boolean; resource?: boolean };
export type EventoCalendario = {
  id: string;
  status?: string;
  summary?: string;
  created?: string;
  updated?: string;
  start?: { dateTime?: string; date?: string };
  attendees?: PartecipanteCalendario[];
  organizer?: { email?: string; self?: boolean };
  eventType?: string;
};

export type ConfigurazioneDemoCalendario = {
  // gli eventi il cui titolo corrisponde sono DEMO
  titolo: RegExp;
  // email della squadra (organizzatori, colleghi invitati): non sono mai «chi ha prenotato»
  emailInterne: string[];
  // quanti giorni dopo l'invio del modulo una prenotazione si considera ancora legata a quel lead
  finestraGiorni: number;
};

export const FINESTRA_GIORNI_PREDEFINITA = 30;
// Una prenotazione può esistere pochi minuti PRIMA del lead solo per un piccolo scarto di orologi; di più non è lo stesso percorso.
export const TOLLERANZA_MINUTI_PRIMA_DEL_LEAD = 10;

// Tipi di evento che non sono mai una prenotazione.
const TIPI_ESCLUSI = ["birthday", "focusTime", "outOfOffice", "workingLocation", "fromGmail"];

export function configurazioneDaAmbiente(env: Record<string, string | undefined>): ConfigurazioneDemoCalendario {
  let titolo: RegExp;
  try {
    titolo = new RegExp(env.DEMO_CALENDAR_TITLE_REGEX?.trim() || "demo", "i");
  } catch {
    titolo = /demo/i;
  }
  const giorni = Number(env.DEMO_MATCH_WINDOW_DAYS);
  return {
    titolo,
    emailInterne: (env.DEMO_CALENDAR_INTERNAL_EMAILS ?? "")
      .split(",")
      .map((e) => normalizzaEmail(e))
      .filter((e) => e !== ""),
    finestraGiorni: Number.isFinite(giorni) && giorni >= 1 && giorni <= 365 ? Math.floor(giorni) : FINESTRA_GIORNI_PREDEFINITA,
  };
}

export function eventoDemo(evento: EventoCalendario, config: ConfigurazioneDemoCalendario): boolean {
  if (evento.eventType && TIPI_ESCLUSI.includes(evento.eventType)) return false;
  return config.titolo.test(evento.summary ?? "");
}

function istante(valore: string | undefined): number | null {
  if (!valore) return null;
  const t = Date.parse(valore);
  return Number.isFinite(t) ? t : null;
}

export function inizioEvento(evento: EventoCalendario): string | null {
  const t = istante(evento.start?.dateTime);
  return t === null ? null : new Date(t).toISOString();
}
export function creazioneEvento(evento: EventoCalendario): string | null {
  const t = istante(evento.created);
  return t === null ? null : new Date(t).toISOString();
}

// Chi può aver prenotato: i partecipanti con una email, che non sono l'organizzatore né il calendario stesso né una risorsa né
// della squadra, e che non hanno rifiutato. Email normalizzate, senza doppioni.
export function partecipantiEsterni(evento: EventoCalendario, config: ConfigurazioneDemoCalendario): string[] {
  const interne = new Set(config.emailInterne);
  const proprietario = normalizzaEmail(evento.organizer?.email ?? "");
  const trovati: string[] = [];
  for (const p of evento.attendees ?? []) {
    const email = normalizzaEmail(p.email ?? "");
    if (email === "" || p.self || p.organizer || p.resource || p.responseStatus === "declined") continue;
    if (interne.has(email) || email === proprietario) continue;
    if (!trovati.includes(email)) trovati.push(email);
  }
  return trovati;
}

export type LeadPerAbbinamento = {
  id: string;
  email_norm: string;
  created_at: string;
  booking_status: "pending" | "confirmed" | "cancelled";
  calendar_event_id: string | null;
};

export type MotivoCaso = "nessun_lead" | "piu_lead" | "prenotazione_duplicata" | "fuori_finestra" | "senza_partecipante" | "email_non_valida";

export type EsitoAbbinamento =
  | { tipo: "ignora" } // non è una DEMO
  | { tipo: "cancellato" } // l'evento è stato cancellato (il chiamante guarda se c'è un lead legato)
  | { tipo: "gia_abbinato"; lead: LeadPerAbbinamento }
  | { tipo: "abbinato"; lead: LeadPerAbbinamento; email: string }
  | { tipo: "caso"; motivo: MotivoCaso; email: string | null; nota: string };

const EMAIL_VALIDA = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]{2,}$/;

// Abbina un evento ai lead (quelli con una delle email dei partecipanti, in qualsiasi stato). Regole, in ordine:
//   1. evento cancellato → «cancellato»; non DEMO → «ignora»;
//   2. un lead già legato a QUESTO evento → «gia_abbinato» (l'evento è stato solo modificato);
//   3. nessun partecipante esterno / email malformata → caso;
//   4. candidati = lead «pending» o «cancelled» con una di quelle email, il cui invio del modulo precede la prenotazione (con una
//      piccola tolleranza) di non oltre la finestra: UNO solo → «abbinato»; più d'uno → caso «piu_lead»;
//   5. nessun candidato: se c'è un lead già «confirmed» con un ALTRO evento → «prenotazione_duplicata» (nessuna seconda
//      conversione); se ci sono lead fuori dalla finestra → «fuori_finestra»; altrimenti «nessun_lead».
export function abbinaEvento(evento: EventoCalendario, lead: LeadPerAbbinamento[], config: ConfigurazioneDemoCalendario): EsitoAbbinamento {
  if (evento.status === "cancelled") return { tipo: "cancellato" };
  if (!eventoDemo(evento, config)) return { tipo: "ignora" };

  const legato = lead.find((l) => l.calendar_event_id === evento.id);
  if (legato) return { tipo: "gia_abbinato", lead: legato };

  const email = partecipantiEsterni(evento, config);
  if (email.length === 0) return { tipo: "caso", motivo: "senza_partecipante", email: null, nota: "Nessun partecipante esterno sull'evento." };
  const valide = email.filter((e) => EMAIL_VALIDA.test(e));
  if (valide.length === 0) return { tipo: "caso", motivo: "email_non_valida", email: email[0], nota: "Email del partecipante non valida." };

  const creato = istante(evento.created);
  if (creato === null) return { tipo: "caso", motivo: "fuori_finestra", email: valide[0], nota: "L'evento non ha la data di creazione." };

  const dellePersone = lead.filter((l) => valide.includes(l.email_norm));
  const tolleranza = TOLLERANZA_MINUTI_PRIMA_DEL_LEAD * 60_000;
  const finestra = config.finestraGiorni * 86_400_000;
  const nellaFinestra = (l: LeadPerAbbinamento) => {
    const inviato = Date.parse(l.created_at);
    return Number.isFinite(inviato) && creato >= inviato - tolleranza && creato <= inviato + finestra;
  };

  const candidati = dellePersone.filter((l) => (l.booking_status === "pending" || l.booking_status === "cancelled") && nellaFinestra(l));
  if (candidati.length === 1) return { tipo: "abbinato", lead: candidati[0], email: candidati[0].email_norm };
  if (candidati.length > 1) return { tipo: "caso", motivo: "piu_lead", email: valide[0], nota: `${candidati.length} richieste possibili per la stessa prenotazione.` };

  const prenotato = dellePersone.find((l) => l.booking_status === "confirmed" && l.calendar_event_id && l.calendar_event_id !== evento.id);
  if (prenotato) return { tipo: "caso", motivo: "prenotazione_duplicata", email: prenotato.email_norm, nota: "Questa persona ha già una demo confermata con un altro evento." };
  if (dellePersone.length > 0) return { tipo: "caso", motivo: "fuori_finestra", email: dellePersone[0].email_norm, nota: "La prenotazione non è nella finestra di date della richiesta." };
  return { tipo: "caso", motivo: "nessun_lead", email: valide[0], nota: "Nessuna richiesta dal modulo con questa email." };
}

// Cosa cambia sul lead quando la prenotazione è abbinata (o modificata).
export type AggiornamentoLead = {
  booking_status: "confirmed";
  calendar_event_id: string;
  calendar_id: string;
  booked_at: string;
  booking_starts_at: string | null;
  booking_match_note: string;
};

export function aggiornamentoPerConferma(evento: EventoCalendario, calendarId: string): AggiornamentoLead | null {
  const creato = creazioneEvento(evento);
  if (!creato) return null;
  return {
    booking_status: "confirmed",
    calendar_event_id: evento.id,
    calendar_id: calendarId,
    booked_at: creato,
    booking_starts_at: inizioEvento(evento),
    booking_match_note: "email",
  };
}
