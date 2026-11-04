import type { SupabaseClient } from "@supabase/supabase-js";
import { schemaAssente } from "@/lib/omnia-ai-incassi";
import { limitiConservazione } from "@/lib/demo-conservazione-calcoli";
import { VERSIONE_CONSENSI_DEMO, haAttribuzione, normalizzaEmail, type Attribuzione, type DatiModuloDemo } from "@/lib/demo-lead-calcoli";

// Salvataggio delle richieste di demo su Supabase (tabella demo_leads, migrazione 0098). Solo SERVER, con il client a chiave
// riservata: il browser non ha nessun accesso alla tabella. Nessuna funzione qui lancia errori verso l'utente: se il salvataggio non
// riesce (tabella non ancora creata, database fuori uso) il modulo funziona lo stesso e la richiesta arriva per email all'ufficio.

export const LIMITE_RICHIESTE_PER_IP_ORA = 5;

export type EsitoRegistrazione =
  | { esito: "creato"; id: string }
  | { esito: "aggiornato"; id: string }
  | { esito: "troppe_richieste" }
  | { esito: "non_salvato" };

export type IngressoLead = {
  dati: DatiModuloDemo;
  attribuzione: Attribuzione;
  // il visitatore ha accettato i cookie pubblicitari: solo allora si conservano identificativi di clic, UTM e id di Google Analytics
  consensoCookie: boolean;
  gaClientId: string | null;
  gaSessionId: string | null;
  landingPath: string | null;
  ipHash: string | null;
  adesso: Date;
};

// Un nuovo invio con la stessa email, mentre la richiesta precedente non ha ancora prenotato, AGGIORNA quella (e ne rinnova la data:
// la finestra di abbinamento con la prenotazione parte dall'ultimo invio). Niente doppioni, niente conteggi gonfiati.
export async function registraLead(admin: SupabaseClient, ingresso: IngressoLead): Promise<EsitoRegistrazione> {
  const { dati, attribuzione, consensoCookie, adesso } = ingresso;
  const emailNorm = normalizzaEmail(dati.email);

  try {
    if (ingresso.ipHash) {
      const dallUnOraFa = new Date(adesso.getTime() - 3_600_000).toISOString();
      const { count, error } = await admin
        .from("demo_leads")
        .select("id", { count: "exact", head: true })
        .eq("ip_hash", ingresso.ipHash)
        .gte("created_at", dallUnOraFa);
      if (error) {
        if (!schemaAssente(error)) console.error("Richiesta demo: conteggio per limite non riuscito", error.code);
        return { esito: "non_salvato" };
      }
      if ((count ?? 0) >= LIMITE_RICHIESTE_PER_IP_ORA) return { esito: "troppe_richieste" };
    }

    const conAttribuzione = consensoCookie && haAttribuzione(attribuzione);
    const adessoIso = adesso.toISOString();
    const riga = {
      full_name: dati.nome,
      company: dati.azienda,
      email: dati.email,
      email_norm: emailNorm,
      phone: dati.telefono,
      sector: dati.settore,
      gclid: consensoCookie ? (attribuzione.gclid ?? null) : null,
      gbraid: consensoCookie ? (attribuzione.gbraid ?? null) : null,
      wbraid: consensoCookie ? (attribuzione.wbraid ?? null) : null,
      utm_source: consensoCookie ? (attribuzione.utm_source ?? null) : null,
      utm_medium: consensoCookie ? (attribuzione.utm_medium ?? null) : null,
      utm_campaign: consensoCookie ? (attribuzione.utm_campaign ?? null) : null,
      utm_content: consensoCookie ? (attribuzione.utm_content ?? null) : null,
      utm_term: consensoCookie ? (attribuzione.utm_term ?? null) : null,
      landing_path: consensoCookie ? ingresso.landingPath : null,
      ga_client_id: consensoCookie ? ingresso.gaClientId : null,
      ga_session_id: consensoCookie ? ingresso.gaSessionId : null,
      attribution_consent: consensoCookie,
      privacy_version: VERSIONE_CONSENSI_DEMO,
      privacy_accepted_at: adessoIso,
      ads_measurement_consent: dati.adsConsenso,
      ads_measurement_consent_at: dati.adsConsenso ? adessoIso : null,
      ip_hash: ingresso.ipHash,
    };

    const inserimento = await admin.from("demo_leads").insert(riga).select("id").maybeSingle<{ id: string }>();
    if (!inserimento.error && inserimento.data) return { esito: "creato", id: inserimento.data.id };

    if (inserimento.error?.code === "23505") {
      // già c'è una richiesta «pending» con questa email: si aggiorna (senza cancellare l'attribuzione già raccolta se questa volta manca)
      const aggiornamento: Record<string, unknown> = { ...riga, created_at: adessoIso };
      if (!conAttribuzione) {
        for (const campo of ["gclid", "gbraid", "wbraid", "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "landing_path", "ga_client_id", "ga_session_id"]) {
          delete aggiornamento[campo];
        }
        if (!consensoCookie) delete aggiornamento.attribution_consent;
      }
      const { data, error } = await admin
        .from("demo_leads")
        .update(aggiornamento)
        .eq("email_norm", emailNorm)
        .eq("booking_status", "pending")
        .select("id")
        .maybeSingle<{ id: string }>();
      if (!error && data) return { esito: "aggiornato", id: data.id };
      console.error("Richiesta demo: aggiornamento non riuscito", error?.code ?? "nessuna riga");
      return { esito: "non_salvato" };
    }

    if (!schemaAssente(inserimento.error)) console.error("Richiesta demo: salvataggio non riuscito", inserimento.error?.code);
    return { esito: "non_salvato" };
  } catch {
    console.error("Richiesta demo: errore imprevisto nel salvataggio");
    return { esito: "non_salvato" };
  }
}

export type EsitoPurge = { lead: number; casiAperti: number; casiRisolti: number; errore: boolean };

// Conservazione: cancella ciò che ha superato i limiti (vedi demo-conservazione-calcoli.ts). Chiamata ogni giorno dal cron.
export async function eliminaDatiScaduti(admin: SupabaseClient, adesso: Date): Promise<EsitoPurge> {
  const limiti = limitiConservazione(adesso);
  const esito: EsitoPurge = { lead: 0, casiAperti: 0, casiRisolti: 0, errore: false };
  const passi: { chiave: "lead" | "casiAperti" | "casiRisolti"; esegui: () => Promise<{ count: number | null; error: { code?: string } | null }> }[] = [
    { chiave: "lead", esegui: async () => (await admin.from("demo_leads").delete({ count: "exact" }).eq("booking_status", "pending").lt("created_at", limiti.pendingPrimaDi)) },
    { chiave: "lead", esegui: async () => (await admin.from("demo_leads").delete({ count: "exact" }).in("booking_status", ["confirmed", "cancelled"]).lt("created_at", limiti.leadPrimaDi)) },
    { chiave: "casiAperti", esegui: async () => (await admin.from("demo_calendar_casi").delete({ count: "exact" }).eq("risolto", false).lt("created_at", limiti.casiApertiPrimaDi)) },
    { chiave: "casiRisolti", esegui: async () => (await admin.from("demo_calendar_casi").delete({ count: "exact" }).eq("risolto", true).lt("created_at", limiti.casiRisoltiPrimaDi)) },
  ];
  for (const passo of passi) {
    try {
      const { count, error } = await passo.esegui();
      if (error) {
        if (!schemaAssente(error)) {
          esito.errore = true;
          console.error("Conservazione demo: cancellazione non riuscita", error.code);
        }
        continue;
      }
      esito[passo.chiave] += count ?? 0;
    } catch {
      esito.errore = true;
    }
  }
  return esito;
}
