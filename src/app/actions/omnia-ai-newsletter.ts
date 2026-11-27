"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { hashIp } from "@/lib/demo-hash";
import { NOME_CAMPO_TRAPPOLA } from "@/lib/demo-lead-calcoli";
import { confermaIscrizione, richiediIscrizione } from "@/lib/newsletter/iscrizioni";
import { verificaFormUmano } from "@/lib/turnstile";

// Iscrizione pubblica a Tender Weekly (omnia-ai.it). Ordine: campo trappola → verifica anti-bot Turnstile (stessa
// infrastruttura dei moduli di demo e accesso) → indirizzo e consenso → limite di frequenza per impronta dell'IP →
// doppia conferma. La risposta positiva è la stessa per un indirizzo nuovo, già iscritto o bloccato.

export type StatoIscrizione = { ok?: boolean; errore?: string };

export async function iscrivitiTenderWeekly(_s: StatoIscrizione, formData: FormData): Promise<StatoIscrizione> {
  // un robot che compila il campo nascosto riceve la stessa risposta di un umano, senza che succeda nulla
  if (String(formData.get(NOME_CAMPO_TRAPPOLA) ?? "").trim()) return { ok: true };
  const umano = await verificaFormUmano(formData);
  if (!umano.ok) return { errore: umano.errore };

  const intestazioni = await headers();
  const ip = (intestazioni.get("x-forwarded-for") ?? "").split(",")[0].trim();
  const segreto = process.env.DEMO_LEADS_HASH_SECRET?.trim() || process.env.CRON_SECRET?.trim();
  const ipHash = ip && segreto ? hashIp(ip, segreto) : null;

  try {
    const esito = await richiediIscrizione({
      email: String(formData.get("email") ?? ""),
      consenso: formData.get("consenso") === "1",
      ipHash,
      userAgent: intestazioni.get("user-agent"),
    });
    if (esito.ok) return { ok: true };
    if (esito.motivo === "email_non_valida") return { errore: "Controlla l'indirizzo email: non sembra valido." };
    if (esito.motivo === "consenso_mancante") return { errore: "Per iscriverti serve il consenso a ricevere la newsletter." };
    return { errore: "Hai inviato molte richieste ravvicinate. Riprova tra un'ora." };
  } catch (e) {
    console.error("Tender Weekly: iscrizione non registrata", e instanceof Error ? e.message : e);
    return { errore: "Non siamo riusciti a registrare la richiesta. Riprova tra qualche minuto oppure scrivici a info@omniaitalia.com." };
  }
}

// Conferma dal link dell'email (POST dal pulsante della pagina di conferma: aprire il link non basta).
export async function confermaTenderWeekly(formData: FormData) {
  const token = String(formData.get("t") ?? "");
  if (!/^[a-f0-9]{48}$/.test(token)) redirect("/newsletter/conferma?esito=non_valido");
  let destinazione = "/newsletter/conferma?esito=non_valido";
  try {
    const r = await confermaIscrizione(token);
    destinazione = r.ok ? `/newsletter/conferma?esito=ok&il=${encodeURIComponent(r.prossimoInvio.toISOString())}` : `/newsletter/conferma?esito=${r.motivo}`;
  } catch (e) {
    console.error("Tender Weekly: conferma non registrata", e instanceof Error ? e.message : e);
    destinazione = "/newsletter/conferma?esito=errore";
  }
  redirect(destinazione);
}
