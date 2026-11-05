import { normalizzaEmail } from "@/lib/demo-lead-calcoli";

// Prenotazioni delle demo su Google Calendar: regole PURE (nessuna rete, nessun database) per riconoscere le DEMO, trovare chi ha
// prenotato e abbinare la prenotazione alla RICHIESTA salvata dal modulo. La lettura del calendario e le scritture stanno in
// src/lib/demo-calendario-sync.ts; i test in scripts/verifica-demo-tracciamento-omnia-ai.ts e scripts/verifica-demo-abbinamento-omnia-ai.ts.
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
// CHI HA PRENOTATO (correzione del 05/11/2026, dal test reale): tra i partecipanti si tolgono PRIMA tutti gli account della squadra —
// il calendario stesso, l'organizzatore, le risorse, le email della squadra e i DOMINI interni (predefinito omniaitalia.com; i domini di
// posta pubblici come gmail.com non possono mai essere «interni») — e SOLO tra gli esterni rimasti si cerca chi ha una richiesta. Non
// si assume mai che il primo esterno sia il cliente: il prenotante è chi ha una richiesta dal modulo; se più PERSONE diverse hanno una
// richiesta per lo stesso evento, l'abbinamento non è certo e non si registra nessuna conversione.
// Più richieste della STESSA persona: la richiesta annullata di un percorso precedente non confonde un percorso nuovo. Se c'è una
// richiesta ancora senza prenotazione, creata DOPO l'ultima annullata, la nuova prenotazione appartiene a quella (le annullate restano
// com'erano); se non c'è, la prenotazione riprende l'ultima annullata.
//
// Regola d'oro: se l'abbinamento non è certo, NON si abbina e NON parte nessuna conversione: il caso si registra per la verifica a
// mano. Meglio perdere una conversione che attribuirne una sbagliata.

export type PartecipanteCalendario = { email?: string; responseStatus?: string; organizer?: boolean; self?: boolean; resource?: boolean; optional?: boolean };
export type EventoCalendario = {
  id: string;
  status?: string;
  summary?: string;
  created?: string;
  updated?: string;
  start?: { dateTime?: string; date?: string };
  attendees?: PartecipanteCalendario[];
  organizer?: { email?: string; self?: boolean };
  creator?: { email?: string; self?: boolean };
  eventType?: string;
};

export type ConfigurazioneDemoCalendario = {
  // gli eventi il cui titolo corrisponde sono DEMO
  titolo: RegExp;
  // email della squadra (organizzatori, colleghi invitati): non sono mai «chi ha prenotato»
  emailInterne: string[];
  // domini della squadra (es. omniaitalia.com): ogni indirizzo di questi domini è un account interno
  dominiInterni: string[];
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

export const DOMINI_INTERNI_PREDEFINITI = ["omniaitalia.com"];
// Domini di posta PUBBLICI: non possono mai essere dichiarati «interni» (escluderebbero dalla ricerca tutti i clienti che li usano).
export const DOMINI_POSTA_PUBBLICI = [
  "gmail.com", "googlemail.com", "outlook.com", "outlook.it", "hotmail.com", "hotmail.it", "live.com", "live.it", "msn.com", "yahoo.com", "yahoo.it", "ymail.com",
  "icloud.com", "me.com", "libero.it", "virgilio.it", "tiscali.it", "alice.it", "tin.it", "fastwebnet.it", "email.it", "pec.it", "legalmail.it", "aruba.it", "protonmail.com", "proton.me",
];

export function dominiInterniDaAmbiente(valore: string | undefined): string[] {
  const grezzo = (valore ?? "").trim() === "" ? DOMINI_INTERNI_PREDEFINITI : (valore ?? "").split(",");
  const risultato: string[] = [];
  for (const d of grezzo) {
    const dominio = d.trim().toLowerCase().replace(/^@/, "");
    if (!/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/.test(dominio)) continue;
    if (DOMINI_POSTA_PUBBLICI.includes(dominio) || risultato.includes(dominio)) continue;
    risultato.push(dominio);
  }
  return risultato;
}

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
    dominiInterni: dominiInterniDaAmbiente(env.DEMO_CALENDAR_INTERNAL_DOMAINS),
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

// ── Chi sono i partecipanti ─────────────────────────────────────────────────────────────────────────────────────────────

export type RuoloPartecipante = "calendario" | "organizzatore" | "risorsa" | "squadra" | "dominio_interno" | "esterno";
export type PartecipanteClassificato = { email: string; ruolo: RuoloPartecipante; opzionale: boolean; risposta: string | null; rifiutato: boolean };

export function dominioDi(email: string): string {
  const chiocciola = email.lastIndexOf("@");
  return chiocciola < 0 ? "" : email.slice(chiocciola + 1);
}
export function haDominioInterno(email: string, config: ConfigurazioneDemoCalendario): boolean {
  const dominio = dominioDi(email);
  return dominio !== "" && config.dominiInterni.some((d) => dominio === d || dominio.endsWith(`.${d}`));
}

// Ogni partecipante con un'email, con il suo ruolo, in ordine, senza doppioni (email normalizzate). Il ruolo «esterno» è l'UNICO che può
// essere il prenotante; tutti gli altri sono la squadra o il calendario stesso.
export function classificaPartecipanti(evento: EventoCalendario, config: ConfigurazioneDemoCalendario): PartecipanteClassificato[] {
  const interne = new Set(config.emailInterne);
  const proprietario = normalizzaEmail(evento.organizer?.email ?? "");
  const creatoreCalendario = evento.creator?.self ? normalizzaEmail(evento.creator.email ?? "") : "";
  const visti = new Set<string>();
  const risultato: PartecipanteClassificato[] = [];
  for (const p of evento.attendees ?? []) {
    const email = normalizzaEmail(p.email ?? "");
    if (email === "" || visti.has(email)) continue;
    visti.add(email);
    let ruolo: RuoloPartecipante = "esterno";
    if (p.self || (creatoreCalendario !== "" && email === creatoreCalendario)) ruolo = "calendario";
    else if (p.organizer || (proprietario !== "" && email === proprietario)) ruolo = "organizzatore";
    else if (p.resource) ruolo = "risorsa";
    else if (interne.has(email)) ruolo = "squadra";
    else if (haDominioInterno(email, config)) ruolo = "dominio_interno";
    risultato.push({ email, ruolo, opzionale: p.optional === true, risposta: p.responseStatus ?? null, rifiutato: p.responseStatus === "declined" });
  }
  return risultato;
}

// Chi può aver prenotato: gli esterni che NON hanno rifiutato. Email normalizzate, senza doppioni.
export function partecipantiEsterni(evento: EventoCalendario, config: ConfigurazioneDemoCalendario): string[] {
  return classificaPartecipanti(evento, config)
    .filter((p) => p.ruolo === "esterno" && !p.rifiutato)
    .map((p) => p.email);
}

// Chi ha prenotato ha rifiutato l'invito: per Google equivale ad annullare la prenotazione. Vale solo se TUTTI gli esterni hanno rifiutato.
export function tuttiGliEsterniHannoRifiutato(evento: EventoCalendario, config: ConfigurazioneDemoCalendario): boolean {
  const esterni = classificaPartecipanti(evento, config).filter((p) => p.ruolo === "esterno");
  return esterni.length > 0 && esterni.every((p) => p.rifiutato);
}

export type RichiestaPerAbbinamento = {
  id: string;
  email_norm: string;
  created_at: string;
  booking_status: "pending" | "confirmed" | "cancelled" | "superseded";
  // la conversione di questa richiesta è già partita (inviata o accettata da Google): non si ritira più
  conversione_inviata?: boolean;
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

const piuRecenteDi = (lista: RichiestaPerAbbinamento[]): RichiestaPerAbbinamento =>
  [...lista].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || b.id.localeCompare(a.id))[0];

// Tra le richieste candidate decide quale (se una sola, con certezza) appartiene alla prenotazione.
function sceglieRichiesta(candidati: RichiestaPerAbbinamento[], config: ConfigurazioneDemoCalendario): EsitoAbbinamento {
  const persone = new Set(candidati.map((c) => c.email_norm));
  const piuRecente = piuRecenteDi(candidati);
  const caso = (motivo: MotivoCaso, nota: string): EsitoAbbinamento => ({ tipo: "caso", motivo, email: piuRecente.email_norm, nota });

  // persone DIVERSE con una richiesta per lo stesso evento: non è certo chi ha prenotato
  if (persone.size > 1) return caso("piu_lead", `Richieste di ${persone.size} persone diverse per la stessa prenotazione.`);
  if (candidati.length === 1) return { tipo: "abbinato", richiesta: candidati[0], email: candidati[0].email_norm, sostituite: [] };
  if (config.multiRichiesta === "manuale") return caso("piu_lead", `${candidati.length} richieste della stessa persona (modalità manuale).`);

  // una sola persona con più richieste
  const pendenti = candidati.filter((c) => c.booking_status === "pending");
  const annullate = candidati.filter((c) => c.booking_status === "cancelled");
  let scelte = candidati;
  if (pendenti.length > 0 && annullate.length > 0) {
    if (Date.parse(piuRecenteDi(pendenti).created_at) > Date.parse(piuRecenteDi(annullate).created_at)) {
      // un percorso NUOVO è cominciato dopo l'ultima prenotazione annullata: la nuova prenotazione è di quello; le annullate restano come sono
      if (annullate.some((a) => a.conversione_inviata)) return caso("prenotazione_duplicata", "Per questa persona è già partita una conversione di una prenotazione poi annullata: la nuova prenotazione va verificata a mano.");
      scelte = pendenti;
    } else {
      return caso("piu_lead", "Una richiesta annullata è più recente di quelle ancora senza prenotazione: non è certo a quale appartenga la nuova prenotazione.");
    }
  }
  if (scelte.length === 1) return { tipo: "abbinato", richiesta: scelte[0], email: scelte[0].email_norm, sostituite: [] };

  // più richieste dello stesso percorso (entro 24 ore): vale la più recente, le altre ancora senza prenotazione restano nello storico come sostituite
  const ordinate = [...scelte].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || b.id.localeCompare(a.id));
  if (Date.parse(ordinate[0].created_at) - Date.parse(ordinate[ordinate.length - 1].created_at) <= ORE_STESSO_PERCORSO * 3_600_000) {
    return { tipo: "abbinato", richiesta: ordinate[0], email: ordinate[0].email_norm, sostituite: ordinate.slice(1).filter((r) => r.booking_status === "pending").map((r) => r.id) };
  }
  return caso("piu_lead", `${scelte.length} richieste della stessa persona a più di ${ORE_STESSO_PERCORSO} ore l'una dall'altra.`);
}

// Abbina un evento. Regole, in ordine:
//   1. evento cancellato → «cancellato» (se c'è una prenotazione nota con quell'id si annulla; altrimenti non c'è niente da fare);
//   2. una prenotazione già nota con QUESTO id: si annulla se gli esterni hanno rifiutato, si riattiva se era annullata, si aggiorna
//      l'orario se è stato spostato; il titolo non conta più (rinominare l'evento non annulla la prenotazione);
//   3. non DEMO → «ignora»;
//   4. nessun partecipante esterno (tolta la squadra) → caso, salvo che abbiano tutti rifiutato (→ «cancellato», niente da annullare);
//   5. candidati = richieste «pending» o «cancelled» delle email degli ESTERNI, inviate prima della prenotazione (con una piccola
//      tolleranza) e non oltre la finestra: se è certo di chi sono → «abbinato», altrimenti caso (vedi sceglieRichiesta);
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
    return { tipo: "caso", motivo: "senza_partecipante", email: null, nota: "Nessun partecipante esterno sull'evento (solo la squadra o il calendario stesso)." };
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
  if (candidati.length > 0) return sceglieRichiesta(candidati, config);

  const prenotata = dellePersone.find((r) => r.booking_status === "confirmed");
  if (prenotata) return { tipo: "caso", motivo: "prenotazione_duplicata", email: prenotata.email_norm, nota: "Questa persona ha già una demo confermata con un altro evento." };
  if (dellePersone.length > 0) return { tipo: "caso", motivo: "fuori_finestra", email: dellePersone[0].email_norm, nota: "La prenotazione non è nella finestra di date della richiesta." };
  return { tipo: "caso", motivo: "nessun_lead", email: valide[0], nota: "Nessuna richiesta dal modulo con l'email dei partecipanti esterni." };
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
