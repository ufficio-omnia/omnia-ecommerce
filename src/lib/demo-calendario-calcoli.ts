import { normalizzaEmail } from "@/lib/demo-lead-calcoli";

// Prenotazioni delle demo su Google Calendar: regole PURE (nessuna rete, nessun database) per riconoscere le DEMO, trovare chi ha
// prenotato e abbinare la prenotazione alla RICHIESTA salvata dal modulo. La lettura del calendario e le scritture stanno in
// src/lib/demo-calendario-sync.ts; i test in scripts/verifica-demo-tracciamento-omnia-ai.ts.
//
// Cosa NON si presume (documentazione Google Calendar API e guida «Programmazione appuntamenti», lette il 04/11/2026):
//   - l'evento di una prenotazione NON ha un tipo suo (eventType è solo default/fromGmail/…) né un campo «chi ha prenotato»: chi
//     prenota compare solo tra i partecipanti. Le DEMO si riconoscono dal TITOLO (espressione regolare in configurazione, da
//     confermare con una prenotazione di prova) e la persona dall'EMAIL normalizzata. Nell'evento non c'è l'id della richiesta e non
//     lo si inventa;
//   - ANNULLAMENTO: chi ha prenotato lo annulla dall'email di conferma, oppure rifiuta l'invito («RSVP no»): l'evento sparisce dal
//     calendario (status «cancelled») oppure resta con il partecipante «declined»: si trattano entrambi come annullati. Un evento
//     cancellato può arrivare con pochissimi campi (l'id e lo stato): per annullare basta l'id, che si cerca tra le prenotazioni note;
//   - RIPROGRAMMAZIONE: Google non descrive uno spostamento fatto dall'invitato su una programmazione nativa. Si gestiscono i due casi
//     possibili: evento SPOSTATO (stesso id, cambia l'inizio) → si aggiorna l'orario; evento annullato e prenotato di nuovo (id nuovo) →
//     la seconda prenotazione si lega alla stessa richiesta (non si conta una seconda conversione).
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
  // quanti giorni dopo l'invio del modulo una prenotazione si considera ancora legata a quella richiesta
  finestraGiorni: number;
  // più richieste pendenti della stessa persona: «ultima» = vale la più recente se sono tutte nella stessa giornata; «manuale» = sempre a mano
  multiRichiesta: "ultima" | "manuale";
};

export const FINESTRA_GIORNI_PREDEFINITA = 30;
// Una prenotazione può esistere pochi minuti PRIMA della richiesta solo per un piccolo scarto di orologi; di più non è lo stesso percorso.
export const TOLLERANZA_MINUTI_PRIMA_DEL_LEAD = 10;
// Più richieste della stessa persona entro questo intervallo sono lo stesso «percorso» (un doppio invio, un secondo tentativo).
export const ORE_STESSO_PERCORSO = 24;

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
    multiRichiesta: env.DEMO_MULTI_RICHIESTA?.trim() === "manuale" ? "manuale" : "ultima",
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

// I partecipanti che possono aver prenotato, ANCHE chi ha rifiutato: con un email, non organizzatore, non il calendario stesso, non una
// risorsa, non della squadra. Email normalizzate, senza doppioni.
function esterniConRifiuti(evento: EventoCalendario, config: ConfigurazioneDemoCalendario): PartecipanteCalendario[] {
  const interne = new Set(config.emailInterne);
  const proprietario = normalizzaEmail(evento.organizer?.email ?? "");
  const visti = new Set<string>();
  const risultato: PartecipanteCalendario[] = [];
  for (const p of evento.attendees ?? []) {
    const email = normalizzaEmail(p.email ?? "");
    if (email === "" || p.self || p.organizer || p.resource) continue;
    if (interne.has(email) || email === proprietario) continue;
    if (visti.has(email)) continue;
    visti.add(email);
    risultato.push(p);
  }
  return risultato;
}

// Chi può aver prenotato: gli esterni che NON hanno rifiutato.
export function partecipantiEsterni(evento: EventoCalendario, config: ConfigurazioneDemoCalendario): string[] {
  return esterniConRifiuti(evento, config)
    .filter((p) => p.responseStatus !== "declined")
    .map((p) => normalizzaEmail(p.email ?? ""));
}

// Chi ha prenotato ha rifiutato l'invito: per Google equivale ad annullare la prenotazione. Vale solo se TUTTI gli esterni hanno rifiutato.
export function tuttiGliEsterniHannoRifiutato(evento: EventoCalendario, config: ConfigurazioneDemoCalendario): boolean {
  const esterni = esterniConRifiuti(evento, config);
  return esterni.length > 0 && esterni.every((p) => p.responseStatus === "declined");
}

export type RichiestaPerAbbinamento = {
  id: string;
  email_norm: string;
  created_at: string;
  booking_status: "pending" | "confirmed" | "cancelled" | "superseded";
};

// Una prenotazione già conosciuta (riga di demo_prenotazioni), cercata per id dell'evento.
export type PrenotazioneNota = {
  id: string;
  lead_id: string;
  stato: "confirmed" | "cancelled";
  starts_at: string | null;
  starts_at_originale: string | null;
};

export type ContestoAbbinamento = {
  prenotazioneNota: PrenotazioneNota | null;
  // le richieste (in qualunque stato) delle email dei partecipanti
  richieste: RichiestaPerAbbinamento[];
};

export type MotivoCaso = "nessun_lead" | "piu_lead" | "prenotazione_duplicata" | "fuori_finestra" | "senza_partecipante" | "email_non_valida";

export type EsitoAbbinamento =
  | { tipo: "ignora" } // non è una DEMO (o non riguarda nessuna prenotazione nota)
  | { tipo: "cancellato"; prenotazione: PrenotazioneNota | null } // evento cancellato, o con tutti gli esterni che hanno rifiutato
  | { tipo: "prenotazione_nota"; prenotazione: PrenotazioneNota; nuovoInizio: string | null; riattivata: boolean }
  | { tipo: "abbinato"; richiesta: RichiestaPerAbbinamento; email: string; sostituite: string[] }
  | { tipo: "caso"; motivo: MotivoCaso; email: string | null; nota: string };

const EMAIL_VALIDA = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]{2,}$/;

// Abbina un evento. Regole, in ordine:
//   1. evento cancellato → «cancellato» (se c'è una prenotazione nota con quell'id si annulla; altrimenti non c'è niente da fare);
//   2. una prenotazione già nota con QUESTO id: si annulla se gli esterni hanno rifiutato, si riattiva se era annullata, si aggiorna
//      l'orario se è stato spostato; il titolo non conta più (rinominare l'evento non annulla la prenotazione);
//   3. non DEMO → «ignora»;
//   4. nessun partecipante esterno → caso, salvo che abbiano tutti rifiutato (→ «cancellato», niente da annullare);
//   5. candidati = richieste «pending» o «cancelled» delle email dei partecipanti, inviate prima della prenotazione (con una piccola
//      tolleranza) e non oltre la finestra: UNA sola → «abbinato». Più d'una della stessa persona: se sono tutte entro lo stesso
//      percorso (24 ore) vale la più recente e le altre diventano «sostituite» (restano nello storico); altrimenti caso «piu_lead»;
//   6. nessun candidato: una richiesta già confermata con un ALTRO evento → «prenotazione_duplicata» (nessuna seconda conversione); richieste
//      fuori dalla finestra → «fuori_finestra»; altrimenti «nessun_lead».
export function abbinaEvento(evento: EventoCalendario, contesto: ContestoAbbinamento, config: ConfigurazioneDemoCalendario): EsitoAbbinamento {
  const nota = contesto.prenotazioneNota;
  if (evento.status === "cancelled") return { tipo: "cancellato", prenotazione: nota };

  if (nota) {
    if (tuttiGliEsterniHannoRifiutato(evento, config)) return { tipo: "cancellato", prenotazione: nota };
    const inizio = inizioEvento(evento);
    return {
      tipo: "prenotazione_nota",
      prenotazione: nota,
      nuovoInizio: inizio && inizio !== nota.starts_at ? inizio : null,
      riattivata: nota.stato === "cancelled",
    };
  }

  if (!eventoDemo(evento, config)) return { tipo: "ignora" };

  const email = partecipantiEsterni(evento, config);
  if (email.length === 0) {
    if (tuttiGliEsterniHannoRifiutato(evento, config)) return { tipo: "cancellato", prenotazione: null };
    return { tipo: "caso", motivo: "senza_partecipante", email: null, nota: "Nessun partecipante esterno sull'evento." };
  }
  const valide = email.filter((e) => EMAIL_VALIDA.test(e));
  if (valide.length === 0) return { tipo: "caso", motivo: "email_non_valida", email: email[0], nota: "Email del partecipante non valida." };

  const creato = istante(evento.created);
  if (creato === null) return { tipo: "caso", motivo: "fuori_finestra", email: valide[0], nota: "L'evento non ha la data di creazione." };

  const dellePersone = contesto.richieste.filter((r) => valide.includes(r.email_norm));
  const tolleranza = TOLLERANZA_MINUTI_PRIMA_DEL_LEAD * 60_000;
  const finestra = config.finestraGiorni * 86_400_000;
  const nellaFinestra = (r: RichiestaPerAbbinamento) => {
    const inviata = Date.parse(r.created_at);
    return Number.isFinite(inviata) && creato >= inviata - tolleranza && creato <= inviata + finestra;
  };

  const candidati = dellePersone.filter((r) => (r.booking_status === "pending" || r.booking_status === "cancelled") && nellaFinestra(r));
  if (candidati.length === 1) return { tipo: "abbinato", richiesta: candidati[0], email: candidati[0].email_norm, sostituite: [] };
  if (candidati.length > 1) {
    const emailDistinte = new Set(candidati.map((c) => c.email_norm));
    if (emailDistinte.size === 1 && config.multiRichiesta === "ultima") {
      const ordinate = [...candidati].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || b.id.localeCompare(a.id));
      const piuRecente = ordinate[0];
      const piuVecchia = ordinate[ordinate.length - 1];
      if (Date.parse(piuRecente.created_at) - Date.parse(piuVecchia.created_at) <= ORE_STESSO_PERCORSO * 3_600_000) {
        return { tipo: "abbinato", richiesta: piuRecente, email: piuRecente.email_norm, sostituite: ordinate.slice(1).filter((r) => r.booking_status === "pending").map((r) => r.id) };
      }
    }
    return { tipo: "caso", motivo: "piu_lead", email: valide[0], nota: `${candidati.length} richieste possibili per la stessa prenotazione.` };
  }

  const prenotata = dellePersone.find((r) => r.booking_status === "confirmed");
  if (prenotata) return { tipo: "caso", motivo: "prenotazione_duplicata", email: prenotata.email_norm, nota: "Questa persona ha già una demo confermata con un altro evento." };
  if (dellePersone.length > 0) return { tipo: "caso", motivo: "fuori_finestra", email: dellePersone[0].email_norm, nota: "La prenotazione non è nella finestra di date della richiesta." };
  return { tipo: "caso", motivo: "nessun_lead", email: valide[0], nota: "Nessuna richiesta dal modulo con questa email." };
}

// La riga di demo_prenotazioni per una prenotazione abbinata. Senza la data di creazione dell'evento non si può confermare.
export type NuovaPrenotazione = {
  lead_id: string;
  calendar_id: string;
  calendar_event_id: string;
  stato: "confirmed";
  booked_at: string;
  starts_at: string | null;
  starts_at_originale: string | null;
  match_note: string;
};

export function nuovaPrenotazioneDaEvento(evento: EventoCalendario, calendarId: string, leadId: string, nota: string): NuovaPrenotazione | null {
  const creato = creazioneEvento(evento);
  if (!creato) return null;
  const inizio = inizioEvento(evento);
  return { lead_id: leadId, calendar_id: calendarId, calendar_event_id: evento.id, stato: "confirmed", booked_at: creato, starts_at: inizio, starts_at_originale: inizio, match_note: nota };
}

// L'ordine di elaborazione di un gruppo di eventi: prima le CANCELLAZIONI (liberano la richiesta), poi gli altri dal più vecchio al più
// recente per data di creazione: così «annullata e prenotata di nuovo» nello stesso gruppo non finisce tra i casi da verificare.
export function ordinaEventiPerElaborazione(eventi: EventoCalendario[]): EventoCalendario[] {
  const peso = (e: EventoCalendario) => (e.status === "cancelled" ? 0 : 1);
  return [...eventi].sort((a, b) => peso(a) - peso(b) || (istante(a.created) ?? 0) - (istante(b.created) ?? 0) || a.id.localeCompare(b.id));
}
