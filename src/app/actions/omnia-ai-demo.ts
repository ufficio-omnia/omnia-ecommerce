"use server";

import { headers } from "next/headers";
import { sendEmail, ADMIN_EMAIL } from "@/lib/email";
import { verificaFormUmano } from "@/lib/turnstile";
import { createAdminClient } from "@/lib/supabase/admin";
import { hashIp } from "@/lib/demo-hash";
import { registraLead } from "@/lib/demo-leads";
import {
  NOME_CAMPO_TRAPPOLA,
  clientIdDaCookieGa,
  pulisciAttribuzione,
  sessionIdDaCookieGa,
  validaModuloDemo,
  type CampoModulo,
} from "@/lib/demo-lead-calcoli";

// Richiesta pubblica, non autenticata: chiunque su omnia-ai.it può inviarla, quindi tutti i campi sono input non fidato (validati
// qui di nuovo con la stessa funzione del browser, ed escapati prima di finire nell'email).
//
// Passi, in quest'ordine: campo trappola (un robot lo compila: finge successo e non salva nulla) → validazione → anti-bot
// Turnstile → limite di richieste per indirizzo (hash, mai l'IP) → salvataggio del lead «pending» su Supabase (con deduplicazione
// per email) → email di avviso all'ufficio. Se il salvataggio non riesce (tabella non ancora creata, database fuori uso) la
// richiesta arriva comunque per email e il visitatore apre il calendario lo stesso: una demo non si perde per un guasto nostro.
//
// NON registra nessuna conversione: la prenotazione si conferma solo quando compare sul calendario (sincronizzazione periodica).
export type EsitoRichiestaDemo = { ok: true } | { ok: false; errore: string; errori?: Partial<Record<CampoModulo, string>> };

function escapeHtml(valore: string): string {
  return valore
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const CAMPI_TESTO = ["nome", "azienda", "email", "telefono", "settore"] as const;

export async function inviaRichiestaDemo(formData: FormData): Promise<EsitoRichiestaDemo> {
  // 1. robot: il campo trappola è nascosto alle persone
  if (String(formData.get(NOME_CAMPO_TRAPPOLA) ?? "").trim() !== "") return { ok: true };

  // 2. validazione (la stessa del browser)
  const grezzo: Record<string, unknown> = { privacy: formData.get("privacy"), adsConsenso: formData.get("adsConsenso") };
  for (const campo of CAMPI_TESTO) grezzo[campo] = formData.get(campo);
  const esito = validaModuloDemo(grezzo);
  if (!esito.ok) return { ok: false, errore: "Controlla i campi evidenziati.", errori: esito.errori };
  const dati = esito.dati;

  // 3. anti-bot
  const verifica = await verificaFormUmano(formData);
  if (!verifica.ok) return { ok: false, errore: verifica.errore };

  // 4. attribuzione pubblicitaria: input non fidato, ridotto ai campi noti e ben formati; si conserva solo se il browser dichiara
  // che i cookie pubblicitari sono stati accettati (il server non può verificarlo: lo dichiara il modulo, che lo legge dal banner)
  const consensoCookie = formData.get("cookie_ok") === "1";
  let attribuzione = {};
  try {
    attribuzione = pulisciAttribuzione(JSON.parse(String(formData.get("attribuzione") ?? "{}")));
  } catch {
    attribuzione = {};
  }
  const gaClientId = clientIdDaCookieGa(String(formData.get("ga_cookie") ?? ""));
  const gaSessionId = sessionIdDaCookieGa(String(formData.get("ga_sessione") ?? ""));
  const percorso = String(formData.get("percorso") ?? "");
  const landingPath = /^\/[A-Za-z0-9\-_/]{0,150}$/.test(percorso) ? percorso : null;

  // 5. indirizzo: solo un hash con segreto (mai l'IP)
  const intestazioni = await headers();
  const ip = (intestazioni.get("x-forwarded-for") ?? "").split(",")[0].trim();
  const segreto = process.env.DEMO_LEADS_HASH_SECRET?.trim() || process.env.CRON_SECRET?.trim();
  const ipHash = ip && segreto ? hashIp(ip, segreto) : null;

  // 6. salvataggio
  const salvataggio = await registraLead(createAdminClient(), { dati, attribuzione, consensoCookie, gaClientId, gaSessionId, landingPath, ipHash, adesso: new Date() });
  if (salvataggio.esito === "troppe_richieste") {
    return { ok: false, errore: "Hai inviato molte richieste ravvicinate. Riprova tra un'ora oppure scrivici a info@omniaitalia.com." };
  }

  // 7. avviso all'ufficio (come prima; in più dice se la richiesta è stata salvata)
  const righe = [
    ["Nome", dati.nome],
    ["Azienda", dati.azienda],
    ["Email", dati.email],
    ["Telefono", dati.telefono],
    ["Settore", dati.settore],
    ["Salvata nel registro", salvataggio.esito === "non_salvato" ? "NO (da inserire a mano)" : salvataggio.esito === "aggiornato" ? "sì (aggiornata)" : "sì"],
  ];
  await sendEmail({
    to: ADMIN_EMAIL,
    from: "OMNIA AI <noreply@omniaitalia.com>",
    subject: `Richiesta demo OMNIA AI — ${dati.azienda}`,
    html: `
      <div style="font-family:'Space Grotesk',Arial,sans-serif;background:#050509;color:#E9E7F4;padding:32px">
        <div style="max-width:560px;margin:0 auto;background:rgba(255,255,255,.04);border:1px solid rgba(150,140,255,.16);border-radius:16px;padding:28px">
          <p style="font-family:Arial,sans-serif;font-weight:800;font-size:17px;color:#8B7FE8;margin:0 0 20px">OMNIA AI</p>
          <h2 style="margin:0 0 18px;font-size:18px;color:#E9E7F4">Nuova richiesta demo</h2>
          <table style="width:100%;border-collapse:collapse;font-size:14px">
            ${righe
              .map(
                ([etichetta, valore]) => `
              <tr>
                <td style="padding:6px 0;color:#8B8AA8;width:150px;vertical-align:top">${escapeHtml(etichetta)}</td>
                <td style="padding:6px 0;color:#E9E7F4">${escapeHtml(valore)}</td>
              </tr>`,
              )
              .join("")}
          </table>
          <p style="margin:20px 0 0;color:#8B8AA8;font-size:13px">Ha aperto il calendario per scegliere l'orario: la demo è confermata solo quando compare la prenotazione sul calendario.</p>
        </div>
      </div>
    `,
  });

  return { ok: true };
}
