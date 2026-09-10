"use server";

import { sendEmail, ADMIN_EMAIL } from "@/lib/email";

export type DemoRequestState = { error?: string; success?: string };

// Richiesta pubblica, non autenticata: chiunque su omnia-ai.it può
// inviarla, quindi a differenza dei messaggi clienti (già loggati,
// src/app/actions/messages.ts) i campi vanno sempre trattati come input
// non fidato — via escapeHtml prima di finire nell'email.
function escapeHtml(valore: string): string {
  return valore
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function requestDemo(
  _prevState: DemoRequestState,
  formData: FormData,
): Promise<DemoRequestState> {
  const nome = String(formData.get("nome") ?? "").trim();
  const azienda = String(formData.get("azienda") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const telefono = String(formData.get("telefono") ?? "").trim();
  const settore = String(formData.get("settore") ?? "").trim();
  const bando = String(formData.get("bando") ?? "").trim();

  if (!nome || !azienda || !email) {
    return { error: "Nome, azienda ed email sono obbligatori." };
  }
  if (!EMAIL_REGEX.test(email)) {
    return { error: "Inserisci un indirizzo email valido." };
  }

  const righe = [
    ["Nome", nome],
    ["Azienda", azienda],
    ["Email", email],
    ["Telefono", telefono || "—"],
    ["Settore", settore || "—"],
  ];

  await sendEmail({
    to: ADMIN_EMAIL,
    from: "OMNIA AI <noreply@omniaitalia.com>",
    subject: `Richiesta demo OMNIA AI — ${azienda}`,
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
                <td style="padding:6px 0;color:#8B8AA8;width:110px;vertical-align:top">${escapeHtml(etichetta)}</td>
                <td style="padding:6px 0;color:#E9E7F4">${escapeHtml(valore)}</td>
              </tr>`,
              )
              .join("")}
          </table>
          ${
            bando
              ? `<p style="margin:20px 0 0;color:#8B8AA8;font-size:13px">Bando di interesse</p>
                 <p style="margin:6px 0 0;color:#E9E7F4;font-size:14px;white-space:pre-wrap">${escapeHtml(bando)}</p>`
              : ""
          }
        </div>
      </div>
    `,
  });

  return { success: "Richiesta inviata. Ti risponderemo entro 24 ore." };
}
