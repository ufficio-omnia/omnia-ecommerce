import type { SupabaseClient } from "@supabase/supabase-js";
import { schemaAssente } from "@/lib/omnia-ai-incassi";
import { credenzialiDaAmbiente, ottieniTokenAccesso } from "@/lib/google-oauth";
import { abbinaEvento, classificaPartecipanti, configurazioneDaAmbiente, creazioneEvento, eventoDemo, haDominioInterno, inizioEvento, type EventoCalendario, type RuoloPartecipante } from "@/lib/demo-calendario-calcoli";
import { leggiEvento } from "@/lib/demo-calendario-sync";
import { normalizzaEmail } from "@/lib/demo-lead-calcoli";

// DIAGNOSI in SOLA LETTURA degli eventi del calendario dei «casi da verificare» (solo l'amministratore, dalla console). Serve a capire
// com'è fatto davvero un evento della Programmazione appuntamenti: chi è l'organizzatore, il creatore, chi sono gli ospiti, se hanno
// risposto, quali campi esistono, e perché l'abbinamento non è certo.
//
// PRIVACY: nel risultato NON compare nessuna email, nessun nome, nessun titolo, nessun id di evento o di richiesta. Ogni persona è «ospite
// 1», «ospite 2»…; di ciascuna si dice solo il ruolo, la risposta e QUANTE richieste dal modulo ha. Dell'evento si riportano i NOMI dei
// campi presenti (non i valori). Legge il calendario con il solo ambito calendar.readonly e il database con sole SELECT: non scrive
// niente, non rielabora niente, non invia niente a nessuno.

export type OspiteDiagnosi = {
  ospite: number;
  ruolo: RuoloPartecipante;
  risposta: string | null;
  opzionale: boolean;
  richiesteTotali: number;
  richiesteCandidate: number;
};

export type RichiestaCandidataDiagnosi = { ospite: number; stato: string; minutiPrimaDellEvento: number; conversioneInviata: boolean };

export type DiagnosiEvento = {
  numero: number;
  trovato: boolean;
  motivoCaso: string;
  casoVistoIl: string;
  campiPresenti: string[];
  stato: string | null;
  tipoEvento: string | null;
  titoloDemo: boolean;
  creatoIl: string | null;
  inizioIl: string | null;
  organizzatore: { presente: boolean; haEmail: boolean; interno: boolean; self: boolean };
  // il creatore è spesso l'indizio migliore di chi ha prenotato: si riporta se è presente, se è interno e se è anche tra gli ospiti
  creatore: { presente: boolean; haEmail: boolean; interno: boolean; self: boolean; ancheOspite: boolean };
  ospiti: OspiteDiagnosi[];
  richiesteCandidate: RichiestaCandidataDiagnosi[];
  esitoConLeRegoleDiOra: { tipo: string; motivo?: string; nota?: string };
};

export type RisultatoDiagnosi =
  | { eseguita: true; eventi: DiagnosiEvento[]; casiAperti: number }
  | { eseguita: false; motivo: "credenziali_mancanti" | "token_non_ottenuto" | "schema_assente" | "errore_database" };

const LIMITE_EVENTI = 5;

type RigaRichiesta = { id: string; email_norm: string; created_at: string; booking_status: "pending" | "confirmed" | "cancelled" | "superseded"; ads_import_status: string };

export async function diagnosticaCasiAperti(admin: SupabaseClient, env: Record<string, string | undefined>, fetchFn: typeof fetch = fetch): Promise<RisultatoDiagnosi> {
  const credenziali = credenzialiDaAmbiente(env, "GOOGLE_CALENDAR_REFRESH_TOKEN");
  if (!credenziali) return { eseguita: false, motivo: "credenziali_mancanti" };

  const { data: casi, error } = await admin
    .from("demo_calendar_casi")
    .select("calendar_id, calendar_event_id, motivo, created_at")
    .eq("risolto", false)
    .order("created_at", { ascending: false })
    .limit(LIMITE_EVENTI);
  if (error) return { eseguita: false, motivo: schemaAssente(error) ? "schema_assente" : "errore_database" };
  const elenco = (casi ?? []) as { calendar_id: string; calendar_event_id: string; motivo: string; created_at: string }[];
  if (elenco.length === 0) return { eseguita: true, eventi: [], casiAperti: 0 };

  const token = await ottieniTokenAccesso(credenziali, fetchFn);
  if (!token) return { eseguita: false, motivo: "token_non_ottenuto" };

  const config = configurazioneDaAmbiente(env);
  const eventi: DiagnosiEvento[] = [];
  let numero = 0;
  for (const caso of elenco) {
    numero++;
    const base = { numero, motivoCaso: caso.motivo, casoVistoIl: caso.created_at };
    const evento = await leggiEvento(caso.calendar_id, caso.calendar_event_id, token, fetchFn);
    if (!evento) {
      eventi.push({
        ...base,
        trovato: false,
        campiPresenti: [],
        stato: null,
        tipoEvento: null,
        titoloDemo: false,
        creatoIl: null,
        inizioIl: null,
        organizzatore: { presente: false, haEmail: false, interno: false, self: false },
        creatore: { presente: false, haEmail: false, interno: false, self: false, ancheOspite: false },
        ospiti: [],
        richiesteCandidate: [],
        esitoConLeRegoleDiOra: { tipo: "evento_non_letto" },
      });
      continue;
    }
    eventi.push(await descriviEvento(admin, evento, config, base));
  }
  return { eseguita: true, eventi, casiAperti: elenco.length };
}

async function descriviEvento(admin: SupabaseClient, evento: EventoCalendario, config: ReturnType<typeof configurazioneDaAmbiente>, base: { numero: number; motivoCaso: string; casoVistoIl: string }): Promise<DiagnosiEvento> {
  const classificati = classificaPartecipanti(evento, config);
  const emails = classificati.map((p) => p.email);
  const { data } = emails.length > 0 ? await admin.from("demo_leads").select("id, email_norm, created_at, booking_status, ads_import_status").in("email_norm", emails) : { data: [] };
  const richieste = ((data ?? []) as RigaRichiesta[]).slice();
  const indice = new Map(emails.map((e, i) => [e, i + 1]));
  const creato = creazioneEvento(evento);
  const creatoMs = creato ? Date.parse(creato) : null;
  const tolleranza = 10 * 60_000;
  const finestra = config.finestraGiorni * 86_400_000;
  const candidata = (r: RigaRichiesta) => (r.booking_status === "pending" || r.booking_status === "cancelled") && creatoMs !== null && creatoMs >= Date.parse(r.created_at) - tolleranza && creatoMs <= Date.parse(r.created_at) + finestra;

  const esterniChePossonoAverPrenotato = new Set(classificati.filter((p) => p.ruolo === "esterno" && !p.rifiutato).map((p) => p.email));
  const ospiti: OspiteDiagnosi[] = classificati.map((p) => ({
    ospite: indice.get(p.email) ?? 0,
    ruolo: p.ruolo,
    risposta: p.risposta,
    opzionale: p.opzionale,
    richiesteTotali: richieste.filter((r) => r.email_norm === p.email).length,
    richiesteCandidate: esterniChePossonoAverPrenotato.has(p.email) ? richieste.filter((r) => r.email_norm === p.email && candidata(r)).length : 0,
  }));
  const richiesteCandidate: RichiestaCandidataDiagnosi[] = richieste
    .filter((r) => esterniChePossonoAverPrenotato.has(r.email_norm) && candidata(r))
    .map((r) => ({ ospite: indice.get(r.email_norm) ?? 0, stato: r.booking_status, minutiPrimaDellEvento: creatoMs === null ? 0 : Math.round((creatoMs - Date.parse(r.created_at)) / 60_000), conversioneInviata: r.ads_import_status === "sent" || r.ads_import_status === "accepted" }))
    .sort((a, b) => a.minutiPrimaDellEvento - b.minutiPrimaDellEvento);

  const esito = abbinaEvento(evento, { prenotazioneNota: null, richieste: richieste.map((r) => ({ id: r.id, email_norm: r.email_norm, created_at: r.created_at, booking_status: r.booking_status, conversione_inviata: r.ads_import_status === "sent" || r.ads_import_status === "accepted" })) }, config);
  const mailCreatore = normalizzaEmail(evento.creator?.email ?? "");
  const mailOrganizzatore = normalizzaEmail(evento.organizer?.email ?? "");
  return {
    ...base,
    trovato: true,
    campiPresenti: Object.keys(evento).sort().slice(0, 60),
    stato: evento.status ?? null,
    tipoEvento: evento.eventType ?? null,
    titoloDemo: eventoDemo(evento, config),
    creatoIl: creato,
    inizioIl: inizioEvento(evento),
    organizzatore: { presente: !!evento.organizer, haEmail: mailOrganizzatore !== "", interno: mailOrganizzatore !== "" && (config.emailInterne.includes(mailOrganizzatore) || haDominioInterno(mailOrganizzatore, config) || evento.organizer?.self === true), self: evento.organizer?.self === true },
    creatore: { presente: !!evento.creator, haEmail: mailCreatore !== "", interno: mailCreatore !== "" && (config.emailInterne.includes(mailCreatore) || haDominioInterno(mailCreatore, config) || evento.creator?.self === true), self: evento.creator?.self === true, ancheOspite: mailCreatore !== "" && emails.includes(mailCreatore) },
    ospiti,
    richiesteCandidate,
    esitoConLeRegoleDiOra: esito.tipo === "caso" ? { tipo: "caso", motivo: esito.motivo, nota: esito.nota } : esito.tipo === "abbinato" ? { tipo: "abbinato", nota: esito.sostituite.length > 0 ? `${esito.sostituite.length} richieste sostituite` : undefined } : { tipo: esito.tipo },
  };
}
