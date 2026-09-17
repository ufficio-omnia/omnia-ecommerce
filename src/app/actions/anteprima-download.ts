"use server";

import { after } from "next/server";
import { sendEmail } from "@/lib/email";
import { createAdminClient } from "@/lib/supabase/admin";

const NOTIFICA_EMAIL = "info@omniaitalia.com";
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Bucket "documents" già esistente (privato, solo admin in scrittura via
// migrazione 0003): il PDF anteprima condivide lo stesso bucket dei file
// venduti sotto un path dedicato, invece di crearne uno nuovo per un solo
// file. Nessuna policy di lettura: l'unico accesso è il signed URL
// generato qui sotto con la service role key, dopo la validazione.
const BUCKET = "documents";
const OBJECT_PATH = "lead-magnets/offerta-tecnica-pulizia-anteprima.pdf";
const DOWNLOAD_FILENAME = "Offerta-tecnica-anteprima-OMNIA.pdf";
const SIGNED_URL_TTL_SECONDS = 300;

export type AnteprimaDownloadState = {
  error?: string;
  success?: boolean;
  downloadUrl?: string;
};

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

  // Il signed URL si genera SOLO qui, dopo la validazione: è l'unico modo
  // in cui il file diventa raggiungibile, per il tempo limitato indicato
  // da SIGNED_URL_TTL_SECONDS. { download } forza Content-Disposition:
  // attachment (altrimenti Supabase apre il PDF nel browser invece di
  // scaricarlo, sostituendo la pagina corrente).
  const admin = createAdminClient();
  const { data: signed, error: signError } = await admin.storage
    .from(BUCKET)
    .createSignedUrl(OBJECT_PATH, SIGNED_URL_TTL_SECONDS, { download: DOWNLOAD_FILENAME });

  if (signError || !signed) {
    console.error("anteprima-download: generazione signed URL fallita", signError);
    return { error: "Errore nella preparazione del download. Riprova tra poco." };
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

  // L'utente non deve aspettare Resend per ottenere il link di download:
  // after() pianifica l'invio dopo che la risposta è già partita verso il
  // browser (garantito da Next/Vercel a differenza di un semplice "fire
  // and forget", che rischierebbe di essere interrotto a metà non appena
  // la funzione ritorna). Prima l'email veniva atteso con `await` qui
  // sopra: se Resend era lento, restava bloccato anche il download.
  after(() =>
    sendEmail({
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
    }),
  );

  return { success: true, downloadUrl: signed.signedUrl };
}
