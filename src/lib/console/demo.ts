import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { schemaAssente } from "@/lib/omnia-ai-incassi";
import type { StatoAds } from "@/lib/demo-conversioni-calcoli";
import { leggiProveGa4 } from "@/lib/demo-ga4-riserva";
import { segretoFirmaConsensi } from "@/lib/demo-hash";
import { statoGateProva, type RigaProvaGa4, type StatoGateProva } from "@/lib/demo-ga4-prova-calcoli";
import { STATI_ADS, riepilogoAds, riepilogoGa4, riepilogoRichieste, statoIntegrazioni, type RiepilogoAds, type RiepilogoGa4, type RiepilogoRichieste, type RigaRichiestaDemo, type StatoIntegrazioni, type StatoRichiesta, type StatoSync } from "./demo-calcoli";
import type { Periodo } from "./periodo";

// Letture della sezione DEMO della console (tabelle della migrazione 0098). Solo la console le usa, sempre dopo il controllo admin della
// pagina. Prima della migrazione le tabelle non ci sono: si risponde «tabella_assente» invece di un errore, e la pagina lo dice. Nessuna
// scrittura: la sezione si limita a mostrare (i casi da verificare si risolvono a mano, dal database).

const LIMITE_RICHIESTE = 500;
const LIMITE_PRENOTAZIONI = 200;
const LIMITE_CASI = 100;
const LIMITE_ERRORI = 30;
const LIMITE_STATO_GLOBALE = 5000;

type RigaLeadDb = {
  id: string;
  created_at: string;
  full_name: string;
  company: string;
  email: string;
  sector: string;
  booking_status: StatoRichiesta;
  prima_prenotazione_il: string | null;
  gclid: string | null;
  gbraid: string | null;
  wbraid: string | null;
  utm_source: string | null;
  utm_campaign: string | null;
  ga_client_id: string | null;
  ga4_sent_at: string | null;
  ga4_attempts: number | null;
  ads_import_status: StatoAds;
  ads_attempts: number | null;
  ads_next_attempt_at: string | null;
  ads_sent_at: string | null;
  ads_last_error: string | null;
};

const COLONNE_LEAD =
  "id, created_at, full_name, company, email, sector, booking_status, prima_prenotazione_il, gclid, gbraid, wbraid, utm_source, utm_campaign, ga_client_id, ga4_sent_at, ga4_attempts, ads_import_status, ads_attempts, ads_next_attempt_at, ads_sent_at, ads_last_error";

function inRiga(r: RigaLeadDb): RigaRichiestaDemo {
  return {
    id: r.id,
    creataIl: r.created_at,
    nome: r.full_name,
    azienda: r.company,
    email: r.email,
    settore: r.sector,
    stato: r.booking_status,
    primaPrenotazioneIl: r.prima_prenotazione_il,
    conClic: !!(r.gclid || r.gbraid || r.wbraid),
    utmSource: r.utm_source,
    utmCampaign: r.utm_campaign,
    haClientId: !!r.ga_client_id,
    ga4InviatoIl: r.ga4_sent_at,
    ga4Tentativi: r.ga4_attempts ?? 0,
    statoAds: (STATI_ADS as string[]).includes(r.ads_import_status) ? r.ads_import_status : "not_ready",
    adsTentativi: r.ads_attempts ?? 0,
    adsErrore: r.ads_last_error,
    adsInviatoIl: r.ads_sent_at,
    adsProssimoTentativo: r.ads_next_attempt_at,
  };
}

export type RigaPrenotazioneDemo = {
  id: string;
  richiestaId: string;
  azienda: string | null;
  email: string | null;
  stato: "confirmed" | "cancelled";
  prenotataIl: string;
  inizio: string | null;
  inizioOriginale: string | null;
  riprogrammataIl: string | null;
  annullataIl: string | null;
};

export type RigaCasoDemo = { id: string; creatoIl: string; motivo: string; email: string | null; eventoCreatoIl: string | null; eventoInizio: string | null; nota: string | null };

export type DatiDemo = {
  richieste: RigaRichiestaDemo[];
  troncato: boolean;
  riepilogo: RiepilogoRichieste;
  prenotazioni: RigaPrenotazioneDemo[];
  casi: RigaCasoDemo[];
  // Google Ads e GA4 sull'insieme di TUTTE le richieste confermate (lo stato delle importazioni non dipende dal periodo scelto)
  ads: RiepilogoAds;
  ga4: RiepilogoGa4;
  confermateTotali: number;
  erroriAds: RigaRichiestaDemo[];
  sync: StatoSync;
  integrazioni: StatoIntegrazioni;
  // Prova reale dell'evento GA4 (migrazione 0099): interruttori, registro delle prove. Se la tabella non c'è ancora, la sezione lo dice
  // e non permette di inviare; il resto della pagina funziona lo stesso.
  provaGa4: { gate: StatoGateProva; tabella: "ok" | "assente" | "errore"; prove: RigaProvaGa4[] };
};

export type RisultatoDemo = { stato: "ok"; dati: DatiDemo } | { stato: "tabella_assente" } | { stato: "errore"; messaggio: string };

type ErroreDb = { code?: string; message?: string } | null;

// `admin` e `env` si possono sostituire nei test (database finto, ambiente finto).
export async function leggiDemo(
  periodo: Pick<Periodo, "daIso" | "aIso">,
  admin: SupabaseClient = createAdminClient(),
  env: Record<string, string | undefined> = process.env,
  adesso: Date = new Date(),
): Promise<RisultatoDemo> {
  let assente = false;
  let guasto = false;
  const verifica = (errore: ErroreDb, cosa: string): boolean => {
    if (!errore) return true;
    if (schemaAssente(errore)) assente = true;
    else {
      guasto = true;
      console.error("Console DEMO: lettura non riuscita", cosa, errore.code ?? "sconosciuto");
    }
    return false;
  };

  // 1. richieste del periodo
  const rr = await admin.from("demo_leads").select(COLONNE_LEAD).gte("created_at", periodo.daIso).lt("created_at", periodo.aIso).order("created_at", { ascending: false }).limit(LIMITE_RICHIESTE + 1).returns<RigaLeadDb[]>();
  if (!verifica(rr.error, "richieste")) return assente ? { stato: "tabella_assente" } : { stato: "errore", messaggio: "Lettura delle richieste non riuscita." };
  const tutteLeRichieste = (rr.data ?? []).map(inRiga);
  const richieste = tutteLeRichieste.slice(0, LIMITE_RICHIESTE);

  // 2. prenotazioni fatte nel periodo, con chi le ha prenotate
  const pr = await admin
    .from("demo_prenotazioni")
    .select("id, lead_id, stato, booked_at, starts_at, starts_at_originale, riprogrammata_il, cancelled_at")
    .gte("booked_at", periodo.daIso)
    .lt("booked_at", periodo.aIso)
    .order("booked_at", { ascending: false })
    .limit(LIMITE_PRENOTAZIONI)
    .returns<{ id: string; lead_id: string; stato: "confirmed" | "cancelled"; booked_at: string; starts_at: string | null; starts_at_originale: string | null; riprogrammata_il: string | null; cancelled_at: string | null }[]>();
  verifica(pr.error, "prenotazioni");
  const righePren = pr.data ?? [];
  const idRichieste = [...new Set(righePren.map((p) => p.lead_id))];
  const chi = new Map<string, { company: string; email: string }>();
  for (const r of richieste) chi.set(r.id, { company: r.azienda, email: r.email });
  const mancanti = idRichieste.filter((id) => !chi.has(id));
  if (mancanti.length > 0) {
    const lr = await admin.from("demo_leads").select("id, company, email").in("id", mancanti).returns<{ id: string; company: string; email: string }[]>();
    if (verifica(lr.error, "richieste delle prenotazioni")) for (const l of lr.data ?? []) chi.set(l.id, { company: l.company, email: l.email });
  }
  const prenotazioni: RigaPrenotazioneDemo[] = righePren.map((p) => ({
    id: p.id,
    richiestaId: p.lead_id,
    azienda: chi.get(p.lead_id)?.company ?? null,
    email: chi.get(p.lead_id)?.email ?? null,
    stato: p.stato,
    prenotataIl: p.booked_at,
    inizio: p.starts_at,
    inizioOriginale: p.starts_at_originale,
    riprogrammataIl: p.riprogrammata_il,
    annullataIl: p.cancelled_at,
  }));

  // 3. casi da verificare (aperti, di qualunque periodo: finché non si risolvono restano un problema)
  const cr = await admin
    .from("demo_calendar_casi")
    .select("id, created_at, motivo, attendee_email_norm, event_created_at, event_starts_at, note")
    .eq("risolto", false)
    .order("created_at", { ascending: false })
    .limit(LIMITE_CASI)
    .returns<{ id: string; created_at: string; motivo: string; attendee_email_norm: string | null; event_created_at: string | null; event_starts_at: string | null; note: string | null }[]>();
  verifica(cr.error, "casi");
  const casi: RigaCasoDemo[] = (cr.data ?? []).map((c) => ({ id: c.id, creatoIl: c.created_at, motivo: c.motivo, email: c.attendee_email_norm, eventoCreatoIl: c.event_created_at, eventoInizio: c.event_starts_at, nota: c.note }));

  // 4. stato globale di Google Ads e GA4 (tutte le richieste confermate)
  const gr = await admin
    .from("demo_leads")
    .select(COLONNE_LEAD)
    .eq("booking_status", "confirmed")
    .order("created_at", { ascending: false })
    .limit(LIMITE_STATO_GLOBALE)
    .returns<RigaLeadDb[]>();
  verifica(gr.error, "stato globale");
  const confermate = (gr.data ?? []).map(inRiga);

  // 5. richieste con un errore di importazione Ads (di qualunque periodo)
  const er = await admin.from("demo_leads").select(COLONNE_LEAD).not("ads_last_error", "is", null).order("updated_at", { ascending: false }).limit(LIMITE_ERRORI).returns<RigaLeadDb[]>();
  verifica(er.error, "errori Ads");

  // 6. stato della sincronizzazione
  const sr = await admin.from("demo_sync_stato").select("last_run_at, last_success_at, last_error, lock_until").eq("id", 1).maybeSingle<{ last_run_at: string | null; last_success_at: string | null; last_error: string | null; lock_until: string | null }>();
  verifica(sr.error, "stato sincronizzazione");
  const sync: StatoSync = sr.data ? { ultimaEsecuzioneIl: sr.data.last_run_at, ultimoSuccessoIl: sr.data.last_success_at, ultimoErrore: sr.data.last_error, bloccoFinoA: sr.data.lock_until } : null;

  // 7. prove reali di GA4 (tabella della migrazione 0099): se manca NON è un errore della pagina, la sezione lo dice
  const letturaProve = await leggiProveGa4(admin, adesso.getTime());
  const prove = letturaProve.stato === "ok" ? letturaProve.righe : [];
  if (letturaProve.stato === "errore") console.error("Console DEMO: lettura non riuscita", "prove GA4");
  const idRiservati = new Set(prove.map((p) => p.leadId));

  if (assente) return { stato: "tabella_assente" };
  if (guasto) return { stato: "errore", messaggio: "Lettura dei dati DEMO non riuscita." };

  return {
    stato: "ok",
    dati: {
      richieste,
      troncato: tutteLeRichieste.length > LIMITE_RICHIESTE,
      riepilogo: riepilogoRichieste(richieste),
      prenotazioni,
      casi,
      ads: riepilogoAds(confermate),
      ga4: riepilogoGa4(confermate, idRiservati),
      confermateTotali: confermate.length,
      erroriAds: (er.data ?? []).map(inRiga),
      sync,
      integrazioni: statoIntegrazioni(env),
      provaGa4: { gate: statoGateProva(env, segretoFirmaConsensi(env) !== null), tabella: letturaProve.stato === "ok" ? "ok" : letturaProve.stato === "tabella_assente" ? "assente" : "errore", prove },
    },
  };
}
