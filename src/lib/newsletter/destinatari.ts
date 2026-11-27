import { createAdminClient } from "@/lib/supabase/admin";
import { schemaAssente } from "@/lib/omnia-ai-incassi";

// Stessa regola di «attivo» di statoAbbonamento (abbonamenti-calcoli.ts della console): abbonamento attivo e periodo
// pagato non scaduto. Ripetuta qui perché i moduli dei siti pubblici non importano moduli della console
// (scripts/verifica-console.ts, punto 2).
function attivo(s: { status: string; current_period_end: string | null }, adesso: Date): boolean {
  return s.status === "attivo" && (s.current_period_end === null || Date.parse(s.current_period_end) > adesso.getTime());
}
import type { DestinatariScelti, Iscritto } from "./tipi";

// Chi riceve un'edizione. Regola di fondo (richiesta del 27/11): l'esistenza di un account o di un abbonamento NON è
// un consenso. Riceve solo chi è nella tabella degli iscritti, con stato «iscritto» e una base giuridica documentata
// (vincolo NOT NULL nel database). «Abbonati attivi» è un FILTRO sugli iscritti, non una fonte di indirizzi.

export type Abbonato = { userId: string; email: string };

export async function abbonatiAttivi(adesso = new Date()): Promise<Abbonato[]> {
  if (process.env.NEWSLETTER_ARCHIVIO === "locale") return [];
  const admin = createAdminClient();
  let r = await admin.from("subscriptions").select("user_id, status, current_period_end, livemode").limit(5000);
  if (r.error && schemaAssente(r.error)) r = (await admin.from("subscriptions").select("user_id, status, current_period_end").limit(5000)) as typeof r;
  if (r.error) throw new Error(`Newsletter, lettura abbonamenti: ${r.error.message}`);
  const ids = new Set<string>();
  for (const s of (r.data ?? []) as { user_id: string; status: string; current_period_end: string | null; livemode?: boolean | null }[]) {
    // abbonamenti di prova (Stripe in test) esclusi: non sono clienti
    if (s.livemode === false) continue;
    if (attivo(s, adesso)) ids.add(s.user_id);
  }
  if (ids.size === 0) return [];
  const u = await admin.from("users").select("id, email").in("id", [...ids]);
  if (u.error) throw new Error(`Newsletter, lettura utenti: ${u.error.message}`);
  return ((u.data ?? []) as { id: string; email: string }[]).map((x) => ({ userId: x.id, email: (x.email ?? "").trim().toLowerCase() })).filter((x) => x.email);
}

export type Destinatario = Iscritto & { gruppo: "abbonato" | "altro" };
export type Esclusione = { email: string; motivo: string };

// Funzione pura: separa gli iscritti tra inclusi ed esclusi secondo la scelta dell'edizione.
export function selezionaDestinatari(iscritti: Iscritto[], abbonati: Abbonato[], scelta: DestinatariScelti): { inclusi: Destinatario[]; esclusi: Esclusione[] } {
  const idAbbonati = new Set(abbonati.map((a) => a.userId));
  const emailAbbonati = new Set(abbonati.map((a) => a.email));
  const inclusi: Destinatario[] = [];
  const esclusi: Esclusione[] = [];
  const visti = new Set<string>();
  for (const i of iscritti) {
    const email = i.email.trim().toLowerCase();
    if (visti.has(email)) continue;
    visti.add(email);
    if (i.stato !== "iscritto") {
      esclusi.push({ email, motivo: i.stato === "in_attesa" ? "in attesa di conferma (doppia conferma)" : i.stato === "disiscritto" ? "disiscritto" : i.stato === "rimbalzato" ? "indirizzo non valido (rimbalzo)" : "ha segnalato spam" });
      continue;
    }
    if (!i.base_giuridica || !i.prova_base || i.prova_base.trim().length < 10) {
      esclusi.push({ email, motivo: "base giuridica non documentata" });
      continue;
    }
    const abbonato = (i.user_id !== null && idAbbonati.has(i.user_id)) || emailAbbonati.has(email);
    if (abbonato && scelta.abbonati_attivi) inclusi.push({ ...i, gruppo: "abbonato" });
    else if (!abbonato && scelta.altri_autorizzati) inclusi.push({ ...i, gruppo: "altro" });
    else esclusi.push({ email, motivo: abbonato ? "gruppo «abbonati attivi» non selezionato" : "gruppo «altri autorizzati» non selezionato" });
  }
  return { inclusi, esclusi };
}

// Abbonati attivi che NON sono ancora tra gli iscritti: la console li mostra come candidati, da aggiungere SOLO
// registrando una base giuridica documentata.
export function candidatiDaAbbonati(iscritti: Iscritto[], abbonati: Abbonato[]): Abbonato[] {
  const presenti = new Set(iscritti.map((i) => i.email.toLowerCase()));
  const idPresenti = new Set(iscritti.map((i) => i.user_id).filter(Boolean));
  return abbonati.filter((a) => !presenti.has(a.email) && !idPresenti.has(a.userId));
}

export function emailValida(email: string): boolean {
  return /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[a-z]{2,}$/i.test(email.trim()) && email.length <= 254;
}

// ───── acquisizione automatica dei clienti ─────

export type ClienteConCondizioni = Abbonato & { accettazioneId: string; versione: number; accettataIl: string };

// Abbonati attivi che hanno accettato Condizioni di abbonamento che includono Tender Weekly (versione ≥ minima). È la
// prova documentata della base giuridica «contratto_abbonamento»: senza quell'accettazione il cliente NON entra.
export async function clientiConCondizioniNewsletter(versioneMinima: number, adesso = new Date()): Promise<ClienteConCondizioni[]> {
  if (process.env.NEWSLETTER_ARCHIVIO === "locale") return [];
  const abbonati = await abbonatiAttivi(adesso);
  if (abbonati.length === 0) return [];
  const admin = createAdminClient();
  const { data: documenti, error: e1 } = await admin.from("legal_documents").select("id, version").eq("document_type", "omnia_ai_condizioni_abbonamento").gte("version", versioneMinima);
  if (e1) throw new Error(`Newsletter, lettura documenti legali: ${e1.message}`);
  const versioni = new Map(((documenti ?? []) as { id: string; version: number }[]).map((d) => [d.id, d.version]));
  if (versioni.size === 0) return [];
  const { data: acc, error: e2 } = await admin
    .from("omnia_ai_legal_acceptances")
    .select("id, user_id, legal_document_id, accepted_at")
    .in("legal_document_id", [...versioni.keys()])
    .in("user_id", abbonati.map((a) => a.userId))
    .order("accepted_at", { ascending: false });
  if (e2) throw new Error(`Newsletter, lettura accettazioni: ${e2.message}`);
  const perUtente = new Map<string, { id: string; legal_document_id: string; accepted_at: string }>();
  for (const r of (acc ?? []) as { id: string; user_id: string; legal_document_id: string; accepted_at: string }[]) if (!perUtente.has(r.user_id)) perUtente.set(r.user_id, r);
  return abbonati.flatMap((a) => {
    const r = perUtente.get(a.userId);
    return r ? [{ ...a, accettazioneId: r.id, versione: versioni.get(r.legal_document_id) ?? versioneMinima, accettataIl: r.accepted_at }] : [];
  });
}

// Funzione pura: quali clienti aggiungere. Un indirizzo già presente (con QUALSIASI stato, disiscritti compresi) non
// si tocca: una disiscrizione resta tale anche se il cliente rinnova l'abbonamento.
export function clientiDaAggiungere(iscritti: Pick<Iscritto, "email" | "user_id">[], clienti: ClienteConCondizioni[]): ClienteConCondizioni[] {
  const email = new Set(iscritti.map((i) => i.email.toLowerCase()));
  const utenti = new Set(iscritti.map((i) => i.user_id).filter(Boolean));
  const visti = new Set<string>();
  return clienti.filter((c) => {
    if (email.has(c.email) || utenti.has(c.userId) || visti.has(c.email)) return false;
    visti.add(c.email);
    return true;
  });
}
