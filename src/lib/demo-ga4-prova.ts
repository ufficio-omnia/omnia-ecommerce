import type { SupabaseClient } from "@supabase/supabase-js";
import { acquisisciBlocco, rilasciaBlocco } from "@/lib/demo-blocco";
import { consensiVerificati } from "@/lib/demo-consensi-calcoli";
import { leggiConsensi, verificatoreFirma } from "@/lib/demo-consensi";
import { idTransazioneAds } from "@/lib/demo-conversioni-calcoli";
import { ID_MISURAZIONE_GA4_PREDEFINITO } from "@/lib/demo-ga4";
import { riservaInvioGa4, registraEsitoInvio, risolviProvaGa4, type EsitoRisoluzioneDb } from "@/lib/demo-ga4-riserva";
import { segretoFirmaConsensi } from "@/lib/demo-hash";
import { schemaAssente } from "@/lib/omnia-ai-incassi";
import {
  anteprimaEvento,
  emailInProva,
  emailProvaDaAmbiente,
  esitoDaEccezione,
  esitoDaStatoHttp,
  fraseCorretta,
  fraseRisoluzione,
  FRASE_INVIO_PROVA,
  idRichiestaValido,
  motiviNonIdonea,
  statoGateProva,
  type CandidataProva,
  type CodiceEsitoInvio,
  type EsitoInvioProva,
  type EsitoRisoluzione,
  type LeadPerProva,
  type MotivoNonIdonea,
  type MotivoProvaSpenta,
  type StatoGateProva,
  type StatoProvaGa4,
} from "@/lib/demo-ga4-prova-calcoli";

// PROVA REALE dell'evento GA4 «demo_booking_confirmed»: UN evento, per UNA richiesta di prova, su comando dell'amministratore. Questo
// modulo NON controlla chi lo chiama: il controllo admin sta nell'azione (src/app/site-console/azioni/demo-ga4-prova.ts), come prima
// operazione. Regole e motivazioni: demo-ga4-prova-calcoli.ts, demo-ga4-riserva.ts, migrazione 0099 e GUIDA-DEMO-TRACCIAMENTO.md.
//
// Ordine delle operazioni (ogni passo che fallisce FERMA tutto, prima di mandare qualcosa):
//   1. interruttori (GA4 acceso, segreti, email di prova) e frase digitata;
//   2. blocco condiviso con il cron (nessuna esecuzione in parallelo);
//   3. richiesta letta dal database: confermata, email di prova, cookie, client_id, consensi con FIRMA verificata;
//   4. PRENOTAZIONE ESCLUSIVA (INSERT con chiave unica): da qui in poi nessun altro può inviare per questa richiesta;
//   5. UN solo invio all'endpoint di PRODUZIONE (mai quello di validazione), senza ritentativi, con tempo massimo;
//   6. esito registrato (stato «sent_unverified» / «rejected» / «uncertain»): mai «verified» da solo.
// Mai nei risultati, nei log o negli errori: segreto API, indirizzo chiamato (contiene il segreto), email, client_id.

export const URL_GA4_PRODUZIONE = "https://www.google-analytics.com/mp/collect";
export const TEMPO_MASSIMO_INVIO_MS = 10_000;

const COLONNE_LEAD =
  "id, email, booking_status, prima_prenotazione_il, created_at, sector, gclid, gbraid, wbraid, ga_client_id, ga_session_id, ga4_sent_at, ga4_attempts, attribution_consent, ads_import_status, ads_attempts";

type RigaLeadProva = LeadPerProva & { ga4_attempts: number | null };

// ── Preparazione (sola lettura) ──────────────────────────────────────────────────────────────────────────────────────────

export type RisultatoPreparazione =
  | { ok: true; gate: StatoGateProva; candidate: CandidataProva[] }
  | { ok: false; motivo: "schema_assente" | "errore_database" };

const MASSIMO_CANDIDATE = 10;

// Elenca le richieste CONFERMATE con un'email di prova che non hanno ancora una riga nel registro, dicendo per ciascuna se è idonea e
// perché no. Non scrive niente e non chiama nessuno. Se la prova è spenta non legge nemmeno il database.
export async function preparaProvaGa4(admin: SupabaseClient, env: Record<string, string | undefined>, adessoMs: number): Promise<RisultatoPreparazione> {
  const segretoFirma = segretoFirmaConsensi(env);
  const gate = statoGateProva(env, segretoFirma !== null);
  if (!gate.attiva || !segretoFirma) return { ok: true, gate, candidate: [] };
  const lista = emailProvaDaAmbiente(env);

  const gia = await admin.from("demo_ga4_prove").select("lead_id").limit(1000).returns<{ lead_id: string }[]>();
  if (gia.error) return { ok: false, motivo: schemaAssente(gia.error) ? "schema_assente" : "errore_database" };
  const conRiga = new Set((gia.data ?? []).map((x) => x.lead_id));

  const lr = await admin
    .from("demo_leads")
    .select(COLONNE_LEAD)
    .eq("booking_status", "confirmed")
    .in("email_norm", lista)
    .order("created_at", { ascending: false })
    .limit(50)
    .returns<RigaLeadProva[]>();
  if (lr.error) return { ok: false, motivo: "errore_database" };
  const leads = (lr.data ?? []).filter((l) => emailInProva(l.email, lista) && !conRiga.has(l.id)).slice(0, MASSIMO_CANDIDATE);

  const letti = await leggiConsensi(admin, leads.map((l) => l.id));
  if (!letti.ok) return { ok: false, motivo: "errore_database" };
  const verifica = verificatoreFirma(segretoFirma);

  const candidate: CandidataProva[] = leads.map((lead) => {
    const consensi = consensiVerificati(letti.perRichiesta.get(lead.id) ?? [], verifica);
    const motivi = motiviNonIdonea(lead, consensi, lista);
    const anteprima = motivi.length === 0 ? anteprimaEvento(lead, adessoMs, consensi) : null;
    return {
      leadId: lead.id,
      prenotataIl: lead.prima_prenotazione_il,
      settore: lead.sector,
      consensi,
      haClientId: !!lead.ga_client_id,
      haSessionId: !!lead.ga_session_id && /^\d+$/.test(lead.ga_session_id),
      idoneo: motivi.length === 0 && anteprima !== null,
      motivi,
      anteprima: anteprima
        ? {
            timestampEventoIl: new Date(anteprima.timestampEventoMs).toISOString(),
            modalita: anteprima.modalita,
            minutiDallaPrenotazione: anteprima.minutiDallaPrenotazione,
            dentroFinestraRealtime: anteprima.dentroFinestraRealtime,
            adPersonalization: anteprima.corpo.consent.ad_personalization,
            nomeEvento: anteprima.corpo.events[0].name,
            parametri: Object.keys(anteprima.corpo.events[0].params),
          }
        : null,
    };
  });
  return { ok: true, gate, candidate };
}

// ── Invio ────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export type RifiutoProva = "prova_spenta" | "frase_errata" | "id_non_valido" | "occupato" | "non_trovata" | "non_idonea" | "gia_presente" | "schema_assente" | "errore_database";

export type RisultatoInvioProva =
  | { ok: false; motivo: RifiutoProva; mancanti?: MotivoProvaSpenta[]; motiviNonIdonea?: MotivoNonIdonea[]; statoEsistente?: StatoProvaGa4 }
  | {
      // «ok» = l'invio è stato TENTATO (una sola volta). NON significa che Google abbia registrato l'evento: guardare «stato».
      ok: true;
      stato: "sent_unverified" | "rejected" | "uncertain";
      codice: CodiceEsitoInvio;
      httpStato: number | null;
      // false = l'esito non si è potuto scrivere nel registro (la riga resta «reserved» e va risolta a mano)
      esitoRegistrato: boolean;
      timestampEventoIl: string;
      modalitaTimestamp: "prenotazione" | "invio";
    };

export async function inviaProvaGa4(
  admin: SupabaseClient,
  env: Record<string, string | undefined>,
  input: { leadId: unknown; frase: unknown; utenteId: string | null },
  adessoMs: number,
  fetchFn: typeof fetch = fetch,
  tempoMassimoMs: number = TEMPO_MASSIMO_INVIO_MS,
): Promise<RisultatoInvioProva> {
  // 1. interruttori e frase
  const segretoFirma = segretoFirmaConsensi(env);
  const gate = statoGateProva(env, segretoFirma !== null);
  const segreto = env.GA4_API_SECRET?.trim();
  if (!gate.attiva || !segreto || !segretoFirma) return { ok: false, motivo: "prova_spenta", mancanti: gate.mancanti };
  if (!fraseCorretta(input.frase, FRASE_INVIO_PROVA)) return { ok: false, motivo: "frase_errata" };
  if (!idRichiestaValido(input.leadId)) return { ok: false, motivo: "id_non_valido" };
  const leadId = input.leadId;
  const idMisurazione = env.GA4_MEASUREMENT_ID?.trim() || ID_MISURAZIONE_GA4_PREDEFINITO;
  const lista = emailProvaDaAmbiente(env);

  // 2. blocco condiviso con il cron: se c'è un giro in corso si rinuncia (nessuna attesa, nessun ritentativo)
  const blocco = await acquisisciBlocco(admin, adessoMs);
  if (blocco === "occupato") return { ok: false, motivo: "occupato" };
  if (blocco === "non_disponibile") return { ok: false, motivo: "errore_database" };
  try {
    // 3. la richiesta, riletta dal database (non ci si fida di ciò che ha visto la pagina)
    const lr = await admin.from("demo_leads").select(COLONNE_LEAD).eq("id", leadId).maybeSingle<RigaLeadProva>();
    if (lr.error) return { ok: false, motivo: "errore_database" };
    if (!lr.data) return { ok: false, motivo: "non_trovata" };
    const lead = lr.data;

    const letti = await leggiConsensi(admin, [lead.id]);
    if (!letti.ok) return { ok: false, motivo: "errore_database" };
    const consensi = consensiVerificati(letti.perRichiesta.get(lead.id) ?? [], verificatoreFirma(segretoFirma));
    const motivi = motiviNonIdonea(lead, consensi, lista);
    if (motivi.length > 0) return { ok: false, motivo: "non_idonea", motiviNonIdonea: motivi };
    const anteprima = anteprimaEvento(lead, adessoMs, consensi);
    if (!anteprima) return { ok: false, motivo: "non_idonea", motiviNonIdonea: ["consensi_non_validi"] };

    // 4. prenotazione esclusiva: dopo questo punto nessun altro può inviare per questa richiesta
    const timestampEventoIso = new Date(anteprima.timestampEventoMs).toISOString();
    const adessoIso = new Date(adessoMs).toISOString();
    const riserva = await riservaInvioGa4(admin, {
      leadId: lead.id,
      origine: "prova",
      utenteId: input.utenteId,
      transactionId: idTransazioneAds(lead.id),
      idMisurazione,
      timestampEventoIso,
      modalitaTimestamp: anteprima.modalita,
      adessoIso,
    });
    if (!riserva.ok) {
      if (riserva.motivo === "gia_presente") return { ok: false, motivo: "gia_presente", statoEsistente: await statoEsistente(admin, lead.id) };
      return { ok: false, motivo: riserva.motivo };
    }

    // 5. UN solo invio, all'endpoint di PRODUZIONE, senza ritentativi
    const controllo = new AbortController();
    const timer = setTimeout(() => controllo.abort(), tempoMassimoMs);
    let esito: EsitoInvioProva;
    try {
      const risposta = await fetchFn(`${URL_GA4_PRODUZIONE}?measurement_id=${encodeURIComponent(idMisurazione)}&api_secret=${encodeURIComponent(segreto)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(anteprima.corpo),
        signal: controllo.signal,
      });
      esito = esitoDaStatoHttp(risposta.status);
    } catch {
      // niente dettagli dell'errore (il testo di un errore di rete può contenere l'indirizzo, che contiene il segreto)
      esito = esitoDaEccezione(controllo.signal.aborted);
    } finally {
      clearTimeout(timer);
    }

    // 6. l'esito si scrive nel registro; se la scrittura non riesce si riprova UNA volta (è il database, non GA4: nessun doppione)
    let registrato = await registraEsitoInvio(admin, lead.id, esito, adessoIso);
    if (!registrato) registrato = await registraEsitoInvio(admin, lead.id, esito, adessoIso);
    return { ok: true, stato: esito.stato, codice: esito.codice, httpStato: esito.httpStato, esitoRegistrato: registrato, timestampEventoIl: timestampEventoIso, modalitaTimestamp: anteprima.modalita };
  } finally {
    await rilasciaBlocco(admin);
  }
}

async function statoEsistente(admin: SupabaseClient, leadId: string): Promise<StatoProvaGa4 | undefined> {
  const r = await admin.from("demo_ga4_prove").select("stato").eq("lead_id", leadId).maybeSingle<{ stato: StatoProvaGa4 }>();
  return r.error ? undefined : (r.data?.stato ?? undefined);
}

// ── Risoluzione amministrativa ───────────────────────────────────────────────────────────────────────────────────────────

export type RisultatoRisoluzione =
  | { ok: true; da: StatoProvaGa4; a: EsitoRisoluzione }
  | { ok: false; motivo: "frase_errata" | "id_non_valido" | "esito_non_valido" | Exclude<EsitoRisoluzioneDb, { ok: true }>["motivo"]; stato?: StatoProvaGa4 };

// L'amministratore dichiara cosa ha visto in GA4. Frase diversa per ciascuna dichiarazione. Non invia niente a nessuno.
export async function risolviProvaGa4Admin(
  admin: SupabaseClient,
  input: { leadId: unknown; esito: unknown; frase: unknown; utenteId: string | null },
  adessoMs: number,
): Promise<RisultatoRisoluzione> {
  if (input.esito !== "verified" && input.esito !== "not_received") return { ok: false, motivo: "esito_non_valido" };
  const esito: EsitoRisoluzione = input.esito;
  if (!fraseCorretta(input.frase, fraseRisoluzione(esito))) return { ok: false, motivo: "frase_errata" };
  if (!idRichiestaValido(input.leadId)) return { ok: false, motivo: "id_non_valido" };
  const r = await risolviProvaGa4(admin, input.leadId, esito, input.utenteId, adessoMs);
  if (!r.ok) return { ok: false, motivo: r.motivo, stato: r.stato };
  return { ok: true, da: r.da, a: esito };
}
