const FROM = "OMNIA <noreply@omniaitalia.com>";
export const ADMIN_EMAIL = "ufficio@omniaitalia.com";

export async function sendEmail({
  to,
  subject,
  html,
  from,
  attachments,
}: {
  to: string;
  subject: string;
  html: string;
  // Allegati (contenuto in base64): per esempio il Word della relazione tecnica nella richiesta di
  // revisione umana. Il servizio di posta accetta fino a 40 MB in totale.
  attachments?: { filename: string; content: string }[];
  // Stesso dominio verificato su Resend (omniaitalia.com), solo il nome
  // visualizzato cambia — serve per le email a marchio OMNIA AI (es.
  // richieste demo), che non devono apparire come "OMNIA" e-commerce.
  from?: string;
}): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    console.error("RESEND_API_KEY non configurata: email non inviata.", subject);
    return false;
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: from ?? FROM, to: [to], subject, html, ...(attachments && attachments.length > 0 ? { attachments } : {}) }),
  });

  if (!res.ok) {
    console.error("Errore invio email:", await res.text());
    return false;
  }

  return true;
}
