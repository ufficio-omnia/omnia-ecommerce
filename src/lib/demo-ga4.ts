import type { SupabaseClient } from "@supabase/supabase-js";
import { schemaAssente } from "@/lib/omnia-ai-incassi";
import { costruisciCorpoGa4, type LeadPerConversione } from "@/lib/demo-conversioni-calcoli";

// Evento GA4 «demo_booking_confirmed» inviato dal SERVER (Measurement Protocol) quando una prenotazione è confermata sul calendario.
// La pagina di conferma sta su un dominio di Google: nessun JavaScript nostro può girare lì, quindi l'evento si manda da qui.
//
// LIMITI da conoscere (vedi la guida): GA4 non deduplica gli eventi del Measurement Protocol, quindi lo si manda UNA volta (colonna
// ga4_sent_at) e mai più; il protocollo risponde «2xx» anche a un corpo malformato, quindi in modalità di verifica
// (DEMO_GA4_MP_DEBUG=1) si usa il server di validazione, che spiega gli errori, e non si segna niente come inviato; l'attribuzione
// di questi eventi alle campagne dipende da client_id e session_id raccolti con il consenso: senza, l'evento conta nei rapporti
// GA4 ma non è legato alla campagna. Gli eventi si possono retrodatare al massimo di 72 ore. NON si importa in Google Ads: per Ads
// c'è la conversione dedicata (demo-ads-data-manager.ts), e importare lo stesso evento da GA4 la conterebbe due volte.
//
// SPENTO finché DEMO_GA4_MP_ENABLED non è «1» e non ci sono GA4_API_SECRET e l'ID di misurazione.

export const ID_MISURAZIONE_GA4_PREDEFINITO = "G-W551SWPNE4";
const TENTATIVI_MASSIMI_GA4 = 5;
const TEMPO_MASSIMO_MS = 10_000;

type LeadGa4 = LeadPerConversione & { ga4_attempts: number | null };

export type RisultatoGa4 = { abilitato: boolean; motivo?: "spento" | "credenziali_mancanti" | "schema_assente" | "errore_database"; inviati: number; verificati: number; errori: number };

export async function inviaConversioniGa4(
  admin: SupabaseClient,
  env: Record<string, string | undefined>,
  adessoMs: number,
  fetchFn: typeof fetch = fetch,
): Promise<RisultatoGa4> {
  if (env.DEMO_GA4_MP_ENABLED !== "1") return { abilitato: false, motivo: "spento", inviati: 0, verificati: 0, errori: 0 };
  const segreto = env.GA4_API_SECRET?.trim();
  const idMisurazione = env.GA4_MEASUREMENT_ID?.trim() || ID_MISURAZIONE_GA4_PREDEFINITO;
  if (!segreto) return { abilitato: false, motivo: "credenziali_mancanti", inviati: 0, verificati: 0, errori: 0 };
  const debug = env.DEMO_GA4_MP_DEBUG === "1";

  const { data, error } = await admin
    .from("demo_leads")
    .select("id, email, booking_status, booked_at, created_at, sector, gclid, gbraid, wbraid, attribution_consent, ads_measurement_consent, ga_client_id, ga_session_id, ga4_sent_at, ga4_attempts, ads_import_status, ads_attempts")
    .eq("booking_status", "confirmed")
    .is("ga4_sent_at", null)
    .eq("attribution_consent", true)
    .not("ga_client_id", "is", null)
    .lt("ga4_attempts", TENTATIVI_MASSIMI_GA4)
    .limit(50);
  if (error) return { abilitato: false, motivo: schemaAssente(error) ? "schema_assente" : "errore_database", inviati: 0, verificati: 0, errori: 0 };

  const esito: RisultatoGa4 = { abilitato: true, inviati: 0, verificati: 0, errori: 0 };
  const base = debug ? "https://www.google-analytics.com/debug/mp/collect" : "https://www.google-analytics.com/mp/collect";
  // un invio fallito (rete, errore di Google) conta come tentativo: dopo 5 non si riprova più
  const contaTentativoFallito = async (lead: LeadGa4) => {
    esito.errori++;
    await admin.from("demo_leads").update({ ga4_attempts: (lead.ga4_attempts ?? 0) + 1 }).eq("id", lead.id);
  };
  for (const lead of (data ?? []) as LeadGa4[]) {
    const corpo = costruisciCorpoGa4(lead, adessoMs);
    if (!corpo) continue;
    const controllo = new AbortController();
    const timer = setTimeout(() => controllo.abort(), TEMPO_MASSIMO_MS);
    try {
      const risposta = await fetchFn(`${base}?measurement_id=${encodeURIComponent(idMisurazione)}&api_secret=${encodeURIComponent(segreto)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(corpo),
        signal: controllo.signal,
      });
      if (debug) {
        // il server di validazione risponde con l'elenco degli errori (vuoto = corpo valido): non si segna come inviato
        const verifica = (await risposta.json().catch(() => null)) as { validationMessages?: unknown[] } | null;
        if (risposta.ok && Array.isArray(verifica?.validationMessages) && verifica.validationMessages.length === 0) esito.verificati++;
        else esito.errori++;
        continue;
      }
      if (risposta.status >= 200 && risposta.status < 300) {
        const { error: erroreScrittura } = await admin.from("demo_leads").update({ ga4_sent_at: new Date(adessoMs).toISOString() }).eq("id", lead.id).is("ga4_sent_at", null);
        if (erroreScrittura) esito.errori++;
        else esito.inviati++;
      } else {
        await contaTentativoFallito(lead);
      }
    } catch {
      await contaTentativoFallito(lead);
    } finally {
      clearTimeout(timer);
    }
  }
  return esito;
}
