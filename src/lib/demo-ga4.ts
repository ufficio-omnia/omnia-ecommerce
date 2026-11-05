import type { SupabaseClient } from "@supabase/supabase-js";
import { schemaAssente } from "@/lib/omnia-ai-incassi";
import { consensiVerificati } from "@/lib/demo-consensi-calcoli";
import { leggiConsensi, verificatoreFirma } from "@/lib/demo-consensi";
import { segretoFirmaConsensi } from "@/lib/demo-hash";
import { idRichiesteRiservate } from "@/lib/demo-ga4-riserva";
import { costruisciCorpoGa4, type LeadPerConversione } from "@/lib/demo-conversioni-calcoli";

// Evento GA4 «demo_booking_confirmed» inviato dal SERVER (Measurement Protocol) quando una prenotazione è confermata sul calendario.
// La pagina di conferma sta su un dominio di Google: nessun JavaScript nostro può girare lì, quindi l'evento si manda da qui.
//
// LIMITI da conoscere (vedi la guida): GA4 non deduplica gli eventi del Measurement Protocol, quindi lo si manda UNA volta per
// RICHIESTA (colonna ga4_sent_at) e mai più; il protocollo risponde «2xx» anche a un corpo malformato, quindi in modalità di verifica
// (DEMO_GA4_MP_DEBUG=1) si usa il server di validazione, che spiega gli errori, e non si segna niente come inviato; l'attribuzione
// di questi eventi alle campagne dipende da client_id e session_id raccolti con il consenso: senza, l'evento conta nei rapporti
// GA4 ma non è legato alla campagna. Gli eventi si possono retrodatare al massimo di 72 ore. NON si importa in Google Ads: per Ads
// c'è la conversione dedicata (demo-ads-data-manager.ts), e importare lo stesso evento da GA4 la conterebbe due volte.
//
// Il consenso si legge dal REGISTRO verificabile (demo_consensi) con la firma controllata: una riga alterata a mano non vale.
//
// SPENTO finché DEMO_GA4_MP_ENABLED non è «1» e non ci sono GA4_API_SECRET e l'ID di misurazione.

export const ID_MISURAZIONE_GA4_PREDEFINITO = "G-W551SWPNE4";
export const TENTATIVI_MASSIMI_GA4 = 5;
const TEMPO_MASSIMO_MS = 10_000;

type LeadGa4 = LeadPerConversione & { ga4_attempts: number | null };

export type RisultatoGa4 = {
  abilitato: boolean;
  motivo?: "spento" | "credenziali_mancanti" | "segreto_firma_mancante" | "schema_assente" | "errore_database";
  inviati: number;
  verificati: number;
  errori: number;
  senzaConsenso: number;
  // richieste lasciate stare perché riservate alla prova reale (presenti solo se ce ne sono)
  riservateProva?: number;
};

const VUOTO = { inviati: 0, verificati: 0, errori: 0, senzaConsenso: 0 };

export async function inviaConversioniGa4(
  admin: SupabaseClient,
  env: Record<string, string | undefined>,
  adessoMs: number,
  fetchFn: typeof fetch = fetch,
): Promise<RisultatoGa4> {
  if (env.DEMO_GA4_MP_ENABLED !== "1") return { abilitato: false, motivo: "spento", ...VUOTO };
  const segreto = env.GA4_API_SECRET?.trim();
  const idMisurazione = env.GA4_MEASUREMENT_ID?.trim() || ID_MISURAZIONE_GA4_PREDEFINITO;
  if (!segreto) return { abilitato: false, motivo: "credenziali_mancanti", ...VUOTO };
  const segretoFirma = segretoFirmaConsensi(env);
  if (!segretoFirma) return { abilitato: false, motivo: "segreto_firma_mancante", ...VUOTO };
  const debug = env.DEMO_GA4_MP_DEBUG === "1";

  const { data, error } = await admin
    .from("demo_leads")
    .select("id, email, booking_status, prima_prenotazione_il, created_at, sector, gclid, gbraid, wbraid, ga_client_id, ga_session_id, ga4_sent_at, ga4_attempts, ads_import_status, ads_attempts")
    .eq("booking_status", "confirmed")
    .is("ga4_sent_at", null)
    .eq("attribution_consent", true)
    .not("ga_client_id", "is", null)
    .lt("ga4_attempts", TENTATIVI_MASSIMI_GA4)
    .limit(50);
  if (error) return { abilitato: false, motivo: schemaAssente(error) ? "schema_assente" : "errore_database", ...VUOTO };

  const candidati = (data ?? []) as LeadGa4[];
  const esito: RisultatoGa4 = { abilitato: true, ...VUOTO };
  if (candidati.length === 0) return esito;

  // Una richiesta con una riga nel registro delle prove reali (demo_ga4_prove, migrazione 0099) NON si riprende mai da qui, in nessuno
  // stato e anche con DEMO_GA4_MP_DEBUG spento: la prova l'ha prenotata in modo esclusivo e l'esito lo decide l'amministratore.
  // Se non si riesce a sapere quali sono riservate, ci si ferma (meglio un giro saltato di un possibile doppione).
  const riservate = await idRichiesteRiservate(admin, candidati.map((l) => l.id));
  if (!riservate.ok) return { abilitato: false, motivo: "errore_database", ...VUOTO };
  const leads = candidati.filter((l) => !riservate.ids.has(l.id));
  if (leads.length < candidati.length) esito.riservateProva = candidati.length - leads.length;
  if (leads.length === 0) return esito;

  const letti = await leggiConsensi(admin, leads.map((l) => l.id));
  if (!letti.ok) return { abilitato: false, motivo: "errore_database", ...VUOTO };
  const verifica = verificatoreFirma(segretoFirma);

  const base = debug ? "https://www.google-analytics.com/debug/mp/collect" : "https://www.google-analytics.com/mp/collect";
  // un invio fallito (rete, errore di Google) conta come tentativo: dopo 5 non si riprova più
  const contaTentativoFallito = async (lead: LeadGa4) => {
    esito.errori++;
    await admin.from("demo_leads").update({ ga4_attempts: (lead.ga4_attempts ?? 0) + 1 }).eq("id", lead.id);
  };
  for (const lead of leads) {
    const consensi = consensiVerificati(letti.perRichiesta.get(lead.id) ?? [], verifica);
    const corpo = costruisciCorpoGa4(lead, adessoMs, consensi);
    if (!corpo) {
      // consenso mancante, negato o con firma non valida: questa richiesta non si manderà mai, esce dalla coda (così non occupa i 50 posti)
      if (!debug) await admin.from("demo_leads").update({ ga4_attempts: TENTATIVI_MASSIMI_GA4 }).eq("id", lead.id);
      esito.senzaConsenso++;
      continue;
    }
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
        const verificaGa = (await risposta.json().catch(() => null)) as { validationMessages?: unknown[] } | null;
        if (risposta.ok && Array.isArray(verificaGa?.validationMessages) && verificaGa.validationMessages.length === 0) esito.verificati++;
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
