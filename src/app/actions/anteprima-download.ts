"use server";

import { sendEmail } from "@/lib/email";

const NOTIFICA_EMAIL = "info@omniaitalia.com";
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type AnteprimaDownloadState = { error?: string; success?: boolean };

// Richiesta pubblica, non autenticata (chiunque su
// /offerta-tecnica-gare-appalto-pulizia può inviarla): stesso trattamento
// di src/app/actions/omnia-ai-demo.ts, i campi vanno sempre escaped prima
// di finire nell'HTML dell'email.
function escapeHtml(valore: string): string {
  return valore
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export async function requestAnteprimaDownload(
  _prevState: AnteprimaDownloadState,
  formData: FormData,
): Promise<AnteprimaDownloadState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const azienda = String(formData.get("azienda") ?? "").trim();
  const gara = String(formData.get("gara") ?? "").trim();
  const privacy = formData.get("privacy") === "on";
  const consensoCommerciale = formData.get("consenso_commerciale") === "on";

  if (!email || !privacy) {
    return { error: "Email e presa visione dell'informativa privacy sono obbligatorie." };
  }
  if (!EMAIL_REGEX.test(email)) {
    return { error: "Inserisci un indirizzo email valido." };
  }

  const dataOra = new Date().toLocaleString("it-IT", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "Europe/Rome",
  });

  const righe = [
    ["Email", email],
    ["Azienda", azienda || "—"],
    ["Per quale gara", gara || "—"],
    ["Consenso commerciale", consensoCommerciale ? "Sì" : "No"],
    ["Data e ora", dataOra],
  ];

  await sendEmail({
    to: NOTIFICA_EMAIL,
    subject: `Nuovo download anteprima — Offerta tecnica gare pulizia (${email})`,
    html: `
      <div style="font-family:Arial,sans-serif;background:#F4F1E9;color:#12211D;padding:32px">
        <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid rgba(18,33,29,.16);border-radius:16px;padding:28px">
          <p style="font-weight:700;font-size:16px;color:#14614F;margin:0 0 20px">OMNIA</p>
          <h2 style="margin:0 0 18px;font-size:18px;color:#12211D">Nuovo download anteprima gratuita</h2>
          <p style="margin:0 0 16px;font-size:13px;color:#4A5C58">Pagina: /offerta-tecnica-gare-appalto-pulizia</p>
          <table style="width:100%;border-collapse:collapse;font-size:14px">
            ${righe
              .map(
                ([etichetta, valore]) => `
              <tr>
                <td style="padding:6px 0;color:#4A5C58;width:150px;vertical-align:top">${escapeHtml(etichetta)}</td>
                <td style="padding:6px 0;color:#12211D;white-space:pre-wrap">${escapeHtml(valore)}</td>
              </tr>`,
              )
              .join("")}
          </table>
        </div>
      </div>
    `,
  });

  return { success: true };
}
