const FROM = "OMNIA <noreply@omniaitalia.com>";
export const ADMIN_EMAIL = "ufficio@omniaitalia.com";

export async function sendEmail({
  to,
  subject,
  html,
  from,
}: {
  to: string;
  subject: string;
  html: string;
  // Stesso dominio verificato su Resend (omniaitalia.com), solo il nome
  // visualizzato cambia — serve per le email a marchio OMNIA AI (es.
  // richieste demo), che non devono apparire come "OMNIA" e-commerce.
  from?: string;
}) {
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    console.error("RESEND_API_KEY non configurata: email non inviata.", subject);
    return;
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: from ?? FROM, to: [to], subject, html }),
  });

  if (!res.ok) {
    console.error("Errore invio email:", await res.text());
  }
}
