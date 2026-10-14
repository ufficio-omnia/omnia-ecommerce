import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { PIANI, normalizzaPianoSlug } from "@/lib/omnia-ai-plans";
import { leggiGareGratuiteConEsito } from "@/lib/omnia-ai-gare-gratuite";
import {
  MESSAGGIO_VERIFICA_GARE_NON_RIUSCITA,
  dirittoDaFonti,
  type DirittoGara,
  type FontiQuota,
} from "@/lib/gara-diritto-calcoli";

// Legge, senza scrivere nulla, da dove verrebbe consumata la prossima gara del cliente: stesse
// regole e stesse query di consumeGaraQuotaIfNeeded (gara-consumo.ts), che resta l'unico punto in
// cui una gara si consuma davvero. Restituisce null se una lettura fallisce: chi chiama non deve
// concedere né negare in base a un dato che non ha.
export async function leggiFontiQuota(client: SupabaseClient, userId: string): Promise<FontiQuota | null> {
  const { data: subscription, error: erroreAbbonamento } = await client
    .from("subscriptions")
    .select("id, plan, current_period_start, current_period_end, created_at")
    .eq("user_id", userId)
    .eq("status", "attivo")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{
      id: string;
      plan: string;
      current_period_start: string | null;
      current_period_end: string | null;
      created_at: string;
    }>();
  if (erroreAbbonamento) return null;

  const abbonamentoAttivo =
    subscription && (!subscription.current_period_end || new Date(subscription.current_period_end).getTime() > Date.now());
  const pianoSlug = abbonamentoAttivo ? normalizzaPianoSlug(subscription.plan) : null;
  const gareIncluse = pianoSlug ? (PIANI[pianoSlug]?.gareIncluse ?? 0) : 0;

  let piano: FontiQuota["piano"] = null;
  if (abbonamentoAttivo && gareIncluse > 0) {
    const inizioPeriodo = subscription.current_period_start ?? subscription.created_at;
    const { count, error } = await client
      .from("gara_consumi")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("tipo", "piano")
      .gte("created_at", inizioPeriodo);
    if (error) return null;
    piano = { gareIncluse, consumate: count ?? 0 };
  }

  const { data: crediti, error: erroreCrediti } = await client
    .from("credits")
    .select("balance")
    .eq("user_id", userId)
    .maybeSingle<{ balance: number }>();
  if (erroreCrediti) return null;

  // Il contatore gratuito conta solo per chi non ha mai avuto un abbonamento (come nel consumo).
  let gratuite: FontiQuota["gratuite"] = null;
  const { count: abbonamentiAvuti, error: erroreAbbonamenti } = await client
    .from("subscriptions")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);
  if (erroreAbbonamenti) return null;
  if ((abbonamentiAvuti ?? 0) === 0) {
    const { gare: contatore, riuscita } = await leggiGareGratuiteConEsito(client, userId);
    if (!riuscita) return null;
    if (contatore) gratuite = { rimanenti: contatore.rimanenti };
  }

  return { piano, crediti: crediti?.balance ?? 0, gratuite };
}

// Il cliente può caricare documenti e usare la chat su QUESTA gara? Sì se la gara ha già
// consumato una gara (da piano, credito o gratuita), se è già stata analizzata (stessa condizione
// con cui il consumo la considera pagata, anche senza la riga nel registro), o se gli resta
// almeno una gara da cui consumarla. Altrimenti no: non è una gara che gli spetta. Va chiamata
// DOPO aver verificato che la gara sia del cliente (la RLS delle azioni lo fa già).
export async function verificaDirittoGara({
  garaId,
  userId,
  client,
}: {
  garaId: string;
  userId: string;
  client?: SupabaseClient;
}): Promise<DirittoGara> {
  const admin = client ?? createAdminClient();
  const nonRiuscita: DirittoGara = {
    consentito: false,
    motivo: "verifica_non_riuscita",
    messaggio: MESSAGGIO_VERIFICA_GARE_NON_RIUSCITA,
  };

  const { data: consumo, error: erroreConsumo } = await admin
    .from("gara_consumi")
    .select("id")
    .eq("gara_id", garaId)
    .maybeSingle<{ id: string }>();
  if (erroreConsumo) return nonRiuscita;
  if (consumo) return { consentito: true, motivo: "gia_consumata" };

  const { data: gara, error: erroreGara } = await admin
    .from("gare")
    .select("estrazione_stato, criteri_valutazione")
    .eq("id", garaId)
    .maybeSingle<{ estrazione_stato: string | null; criteri_valutazione: string | null }>();
  if (erroreGara) return nonRiuscita;
  if (gara?.estrazione_stato === "completata" || !!gara?.criteri_valutazione) {
    return { consentito: true, motivo: "gia_analizzata" };
  }

  const fonti = await leggiFontiQuota(admin, userId);
  if (!fonti) return nonRiuscita;
  return dirittoDaFonti(fonti);
}
