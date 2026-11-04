import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { schemaAssente } from "@/lib/omnia-ai-incassi";
import { contattiOrfani, limitiConservazione } from "@/lib/demo-conservazione-calcoli";
import { registraConsensiRichiesta } from "@/lib/demo-consensi";
import { idTransazioneAds } from "@/lib/demo-conversioni-calcoli";
import { sha256Hex } from "@/lib/demo-hash";
import { VERSIONE_CONSENSI_DEMO, normalizzaEmail, type Attribuzione, type DatiModuloDemo } from "@/lib/demo-lead-calcoli";

// Salvataggio delle richieste di demo su Supabase (migrazione 0098). Solo SERVER, con il client a chiave riservata: il browser non ha
// nessun accesso alle tabelle.
//
// TRE identificativi distinti: il CONTATTO (la persona, per email), la RICHIESTA (ogni invio del modulo: riga nuova, mai sovrascritta)
// e la PRENOTAZIONE (un evento del calendario). L'identificativo di transazione delle conversioni deriva dalla richiesta.
//
// Nessuna funzione qui lancia errori verso l'utente: restituiscono un esito. Se il salvataggio non riesce, è il chiamante (l'azione del
// modulo) a decidere cosa fare: prima dell'attivazione (DEMO_LEADS_ATTIVO diverso da «1») il modulo funziona lo stesso e la richiesta
// arriva per email; dopo l'attivazione il visitatore vede un errore recuperabile e il calendario NON si apre.

export const LIMITE_RICHIESTE_PER_IP_ORA = 5;
export const LIMITE_RICHIESTE_PER_EMAIL_GIORNO = 10;

export type EsitoRegistrazione =
  | { esito: "creato"; leadId: string; contattoId: string }
  // lo stesso invio ripetuto (stessa chiave di idempotenza): nessuna richiesta nuova, si restituisce quella già registrata
  | { esito: "gia_registrato"; leadId: string; contattoId: string }
  | { esito: "troppe_richieste" }
  | { esito: "non_salvato"; motivo: "schema_assente" | "errore" };

export type IngressoLead = {
  dati: DatiModuloDemo;
  // chiave di idempotenza dell'invio (la sceglie il modulo nel browser)
  chiave: string;
  attribuzione: Attribuzione;
  // il visitatore ha dichiarato di aver accettato i cookie pubblicitari: solo allora si conservano identificativi di clic, UTM e id di Google Analytics
  consensoCookie: boolean;
  gaClientId: string | null;
  gaSessionId: string | null;
  landingPath: string | null;
  ipHash: string | null;
  segretoFirma: string | null;
  adesso: Date;
};

type ErroreDb = { code?: string; message?: string } | null | undefined;

function nonSalvato(errore: ErroreDb): EsitoRegistrazione {
  const assente = schemaAssente(errore);
  if (!assente) console.error("Richiesta demo: salvataggio non riuscito", errore?.code ?? "sconosciuto");
  return { esito: "non_salvato", motivo: assente ? "schema_assente" : "errore" };
}

async function contaRichieste(admin: SupabaseClient, colonna: "ip_hash" | "email_norm", valore: string, dal: string): Promise<{ n: number } | { errore: ErroreDb }> {
  const { count, error } = await admin.from("demo_leads").select("id", { count: "exact", head: true }).eq(colonna, valore).gte("created_at", dal);
  if (error) return { errore: error };
  return { n: count ?? 0 };
}

// Il contatto della persona: uno per email normalizzata. Se esiste si aggiornano i dati con quelli dell'ultimo invio (lo storico di ciò
// che è stato scritto a ogni invio resta nelle richieste).
async function assicuraContatto(admin: SupabaseClient, ingresso: IngressoLead, emailNorm: string): Promise<{ id: string; creato: boolean } | { errore: ErroreDb }> {
  const adessoIso = ingresso.adesso.toISOString();
  const { dati } = ingresso;
  const campi = { email: dati.email, full_name: dati.nome, company: dati.azienda, phone: dati.telefono, sector: dati.settore, ultima_richiesta_il: adessoIso, updated_at: adessoIso };

  const aggiorna = async (): Promise<{ id: string; creato: boolean } | { errore: ErroreDb } | null> => {
    const trovato = await admin.from("demo_contatti").select("id").eq("email_norm", emailNorm).maybeSingle<{ id: string }>();
    if (trovato.error) return { errore: trovato.error };
    if (!trovato.data) return null;
    const { error } = await admin.from("demo_contatti").update(campi).eq("id", trovato.data.id);
    return error ? { errore: error } : { id: trovato.data.id, creato: false };
  };

  const esistente = await aggiorna();
  if (esistente) return esistente;
  const inserimento = await admin.from("demo_contatti").insert({ email_norm: emailNorm, ...campi }).select("id").maybeSingle<{ id: string }>();
  if (!inserimento.error && inserimento.data) return { id: inserimento.data.id, creato: true };
  if (inserimento.error?.code === "23505") {
    // un altro invio dello stesso indirizzo ha creato il contatto un istante prima: si usa quello
    const dopoCorsa = await aggiorna();
    if (dopoCorsa) return dopoCorsa;
  }
  return { errore: inserimento.error };
}

// Se i consensi di una richiesta mancano (un invio precedente è stato interrotto a metà), si registrano ora.
async function assicuraConsensi(admin: SupabaseClient, leadId: string, ingresso: IngressoLead): Promise<boolean> {
  const { count, error } = await admin.from("demo_consensi").select("id", { count: "exact", head: true }).eq("lead_id", leadId);
  if (error) return false;
  if ((count ?? 0) > 0) return true;
  const esito = await registraConsensiRichiesta(admin, leadId, { adsConsenso: ingresso.dati.adsConsenso, cookieAccettati: ingresso.consensoCookie, ipHash: ingresso.ipHash }, ingresso.adesso, ingresso.segretoFirma);
  return esito.ok;
}

// Registra UN invio del modulo: contatto (nuovo o aggiornato) + richiesta nuova + prova dei consensi. Tutto o niente: se i consensi non
// si salvano la richiesta (e un contatto creato apposta) si tolgono, così non resta mai una richiesta senza la sua prova.
export async function registraLead(admin: SupabaseClient, ingresso: IngressoLead): Promise<EsitoRegistrazione> {
  const { dati, attribuzione, consensoCookie, adesso } = ingresso;
  const emailNorm = normalizzaEmail(dati.email);
  const adessoIso = adesso.toISOString();

  try {
    // 0. lo stesso invio già registrato (doppio clic, nuovo tentativo dopo una risposta persa): niente di nuovo. La stessa chiave con un
    // indirizzo email DIVERSO non è lo stesso invio (la persona ha corretto l'email e riprovato): ha una chiave sua, derivata.
    let chiave = ingresso.chiave;
    const gia = await admin.from("demo_leads").select("id, contatto_id, email_norm").eq("idempotency_key", chiave).maybeSingle<{ id: string; contatto_id: string; email_norm: string }>();
    if (gia.error) return nonSalvato(gia.error);
    let replica = gia.data;
    if (replica && replica.email_norm !== emailNorm) {
      chiave = `${ingresso.chiave.slice(0, 60)}-${sha256Hex(emailNorm).slice(0, 12)}`;
      const derivata = await admin.from("demo_leads").select("id, contatto_id, email_norm").eq("idempotency_key", chiave).maybeSingle<{ id: string; contatto_id: string; email_norm: string }>();
      if (derivata.error) return nonSalvato(derivata.error);
      replica = derivata.data;
    }
    if (replica) {
      if (!(await assicuraConsensi(admin, replica.id, ingresso))) return { esito: "non_salvato", motivo: "errore" };
      return { esito: "gia_registrato", leadId: replica.id, contattoId: replica.contatto_id };
    }

    // 1. limiti anti-abuso (l'indirizzo e l'email, mai in chiaro nei conteggi)
    if (ingresso.ipHash) {
      const r = await contaRichieste(admin, "ip_hash", ingresso.ipHash, new Date(adesso.getTime() - 3_600_000).toISOString());
      if ("errore" in r) return nonSalvato(r.errore);
      if (r.n >= LIMITE_RICHIESTE_PER_IP_ORA) return { esito: "troppe_richieste" };
    }
    const perEmail = await contaRichieste(admin, "email_norm", emailNorm, new Date(adesso.getTime() - 86_400_000).toISOString());
    if ("errore" in perEmail) return nonSalvato(perEmail.errore);
    if (perEmail.n >= LIMITE_RICHIESTE_PER_EMAIL_GIORNO) return { esito: "troppe_richieste" };

    // 2. il contatto
    const contatto = await assicuraContatto(admin, ingresso, emailNorm);
    if ("errore" in contatto) return nonSalvato(contatto.errore);

    // 3. la richiesta (riga nuova: lo storico non si sovrascrive mai)
    const leadId = randomUUID();
    const conAttribuzione = consensoCookie;
    const inserimento = await admin.from("demo_leads").insert({
      id: leadId,
      contatto_id: contatto.id,
      created_at: adessoIso,
      updated_at: adessoIso,
      idempotency_key: chiave,
      full_name: dati.nome,
      company: dati.azienda,
      email: dati.email,
      email_norm: emailNorm,
      phone: dati.telefono,
      sector: dati.settore,
      gclid: conAttribuzione ? (attribuzione.gclid ?? null) : null,
      gbraid: conAttribuzione ? (attribuzione.gbraid ?? null) : null,
      wbraid: conAttribuzione ? (attribuzione.wbraid ?? null) : null,
      utm_source: conAttribuzione ? (attribuzione.utm_source ?? null) : null,
      utm_medium: conAttribuzione ? (attribuzione.utm_medium ?? null) : null,
      utm_campaign: conAttribuzione ? (attribuzione.utm_campaign ?? null) : null,
      utm_content: conAttribuzione ? (attribuzione.utm_content ?? null) : null,
      utm_term: conAttribuzione ? (attribuzione.utm_term ?? null) : null,
      landing_path: conAttribuzione ? ingresso.landingPath : null,
      ga_client_id: conAttribuzione ? ingresso.gaClientId : null,
      ga_session_id: conAttribuzione ? ingresso.gaSessionId : null,
      attribution_consent: consensoCookie,
      privacy_version: VERSIONE_CONSENSI_DEMO,
      privacy_accepted_at: adessoIso,
      ads_measurement_consent: dati.adsConsenso,
      ads_measurement_consent_at: dati.adsConsenso ? adessoIso : null,
      ip_hash: ingresso.ipHash,
      ads_transaction_id: idTransazioneAds(leadId),
    });
    if (inserimento.error) {
      if (inserimento.error.code === "23505") {
        // due invii con la stessa chiave nello stesso istante: vale quello che ha vinto
        const vincitore = await admin.from("demo_leads").select("id, contatto_id").eq("idempotency_key", chiave).maybeSingle<{ id: string; contatto_id: string }>();
        if (!vincitore.error && vincitore.data) {
          if (!(await assicuraConsensi(admin, vincitore.data.id, ingresso))) return { esito: "non_salvato", motivo: "errore" };
          return { esito: "gia_registrato", leadId: vincitore.data.id, contattoId: vincitore.data.contatto_id };
        }
      }
      if (contatto.creato) await togliContattoVuoto(admin, contatto.id);
      return nonSalvato(inserimento.error);
    }

    // 4. la prova dei consensi: senza, la richiesta non resta
    const consensi = await registraConsensiRichiesta(admin, leadId, { adsConsenso: dati.adsConsenso, cookieAccettati: consensoCookie, ipHash: ingresso.ipHash }, adesso, ingresso.segretoFirma);
    if (!consensi.ok) {
      console.error("Richiesta demo: consensi non registrati, richiesta annullata");
      await admin.from("demo_leads").delete().eq("id", leadId);
      if (contatto.creato) await togliContattoVuoto(admin, contatto.id);
      return { esito: "non_salvato", motivo: "errore" };
    }
    return { esito: "creato", leadId, contattoId: contatto.id };
  } catch {
    console.error("Richiesta demo: errore imprevisto nel salvataggio");
    return { esito: "non_salvato", motivo: "errore" };
  }
}

// Toglie un contatto creato per questo invio SOLO se non ha nessuna richiesta (un altro invio potrebbe averne aggiunta una nel frattempo).
async function togliContattoVuoto(admin: SupabaseClient, contattoId: string): Promise<void> {
  try {
    const { count, error } = await admin.from("demo_leads").select("id", { count: "exact", head: true }).eq("contatto_id", contattoId);
    if (!error && (count ?? 0) === 0) await admin.from("demo_contatti").delete().eq("id", contattoId);
  } catch {
    // resta un contatto vuoto: lo toglie la conservazione
  }
}

export type EsitoPurge = { lead: number; contatti: number; casiAperti: number; casiRisolti: number; errore: boolean };

// Conservazione: cancella ciò che ha superato i limiti (vedi demo-conservazione-calcoli.ts). Chiamata ogni giorno dal cron.
export async function eliminaDatiScaduti(admin: SupabaseClient, adesso: Date): Promise<EsitoPurge> {
  const limiti = limitiConservazione(adesso);
  const esito: EsitoPurge = { lead: 0, contatti: 0, casiAperti: 0, casiRisolti: 0, errore: false };
  const passi: { chiave: "lead" | "casiAperti" | "casiRisolti"; esegui: () => Promise<{ count: number | null; error: ErroreDb }> }[] = [
    { chiave: "lead", esegui: async () => await admin.from("demo_leads").delete({ count: "exact" }).in("booking_status", ["pending", "superseded"]).lt("created_at", limiti.pendingPrimaDi) },
    { chiave: "lead", esegui: async () => await admin.from("demo_leads").delete({ count: "exact" }).in("booking_status", ["confirmed", "cancelled"]).lt("created_at", limiti.leadPrimaDi) },
    { chiave: "casiAperti", esegui: async () => await admin.from("demo_calendar_casi").delete({ count: "exact" }).eq("risolto", false).lt("created_at", limiti.casiApertiPrimaDi) },
    { chiave: "casiRisolti", esegui: async () => await admin.from("demo_calendar_casi").delete({ count: "exact" }).eq("risolto", true).lt("created_at", limiti.casiRisoltiPrimaDi) },
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

  // i contatti senza più richieste (la persona non ha altro nel registro)
  try {
    const candidati = await admin.from("demo_contatti").select("id").lt("ultima_richiesta_il", limiti.pendingPrimaDi).limit(500);
    if (candidati.error) {
      if (!schemaAssente(candidati.error)) esito.errore = true;
    } else {
      const ids = ((candidati.data ?? []) as { id: string }[]).map((c) => c.id);
      if (ids.length > 0) {
        const conRichieste = await admin.from("demo_leads").select("contatto_id").in("contatto_id", ids);
        if (conRichieste.error) {
          esito.errore = true;
        } else {
          const orfani = contattiOrfani(ids, ((conRichieste.data ?? []) as { contatto_id: string }[]).map((r) => r.contatto_id));
          if (orfani.length > 0) {
            const { count, error } = await admin.from("demo_contatti").delete({ count: "exact" }).in("id", orfani);
            if (error) esito.errore = true;
            else esito.contatti += count ?? 0;
          }
        }
      }
    }
  } catch {
    esito.errore = true;
  }
  return esito;
}
