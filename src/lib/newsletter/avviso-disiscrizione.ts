import { sendEmail } from "@/lib/email";
import { escapeHtml } from "@/lib/html";
import { archivioNewsletter, type ArchivioNewsletter } from "./archivio";
import { ETICHETTA_BASE, ETICHETTA_PROVENIENZA, type Iscritto } from "./tipi";

// Avviso all'ufficio per OGNI disiscrizione (richiesta dell'utente del 28/11/2026): indirizzo, motivo, provenienza
// dell'iscritto. Parte solo quando lo stato passa davvero da «iscritto» a «disiscritto» (pulsante della pagina o
// disiscrizione in un clic dei client di posta), mai per un link soltanto aperto né per chi era già disiscritto.
// Destinatario: «Email per le notifiche» delle impostazioni della newsletter (predefinito ufficio@omniaitalia.com).
// Solo sul deploy di produzione: in sviluppo la chiave di Resend in .env.local è quella vera. Un errore dell'avviso
// non annulla mai la disiscrizione.

export const URL_ISCRITTI_CONSOLE = "https://console.omniaitalia.com/newsletter/iscritti?filtro=disiscritti";

const FUSO = "Europe/Rome";

function dataOraRoma(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("it-IT", { timeZone: FUSO, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(d);
}

function dataRomaBreve(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("it-IT", { timeZone: FUSO, day: "2-digit", month: "2-digit", year: "numeric" }).format(d);
}

// Funzione pura: oggetto, HTML e testo dell'avviso.
export function emailAvvisoDisiscrizione(i: Iscritto, motivo: string, quando: string): { subject: string; html: string; text: string } {
  const provenienza = i.provenienza ? ETICHETTA_PROVENIENZA[i.provenienza] : "—";
  const righe: [string, string][] = [
    ["Indirizzo", i.email],
    ["Motivo", motivo || "non indicato"],
    ["Provenienza", provenienza],
  ];
  if (i.nome) righe.push(["Nome", i.nome]);
  if (i.azienda) righe.push(["Azienda", i.azienda]);
  righe.push(
    ["Base dell'iscrizione", ETICHETTA_BASE[i.base_giuridica] ?? i.base_giuridica],
    ["Iscritto dal", dataRomaBreve(i.confermato_il ?? i.base_dal ?? i.creato_il)],
    ["Disiscritto il", dataOraRoma(quando)],
  );
  const subject = `Tender Weekly: disiscrizione di ${i.email}`;
  const html =
    `<p>Un iscritto si è disiscritto da <strong>Tender Weekly</strong>. È già escluso da tutti gli invii successivi.</p>` +
    `<table cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:14px">` +
    righe.map(([k, v]) => `<tr><td style="color:#666;padding-right:16px;vertical-align:top">${escapeHtml(k)}</td><td><strong>${escapeHtml(v)}</strong></td></tr>`).join("") +
    `</table>` +
    `<p>Elenco dei disiscritti nella console: <a href="${URL_ISCRITTI_CONSOLE}">Newsletter → Iscritti</a>.</p>` +
    `<p style="color:#888;font-size:12px">Non reiscriverlo dalla console senza una nuova autorizzazione documentata: può tornare iscritto da solo con il pulsante «iscrivimi di nuovo» del suo link.</p>`;
  const text =
    `Un iscritto si è disiscritto da Tender Weekly. È già escluso da tutti gli invii successivi.\n\n` +
    righe.map(([k, v]) => `${k}: ${v}`).join("\n") +
    `\n\nElenco dei disiscritti nella console: ${URL_ISCRITTI_CONSOLE}\n`;
  return { subject, html, text };
}

export type InviaAvviso = (m: { to: string; subject: string; html: string }) => Promise<boolean>;

export async function avvisaDisiscrizione(
  i: Iscritto,
  motivo: string,
  quando: string,
  a: ArchivioNewsletter = archivioNewsletter(),
  invia: InviaAvviso | null = process.env.VERCEL_ENV === "production" ? (m) => sendEmail({ ...m, from: "OMNIA AI <noreply@omniaitalia.com>" }) : null,
): Promise<"inviato" | "non_inviato" | "saltato"> {
  if (!invia) return "saltato";
  try {
    const imp = await a.leggiImpostazioni();
    const to = (imp.email_notifica_admin || "").trim();
    if (!to) return "saltato";
    const { subject, html } = emailAvvisoDisiscrizione(i, motivo, quando);
    return (await invia({ to, subject, html })) ? "inviato" : "non_inviato";
  } catch (e) {
    console.error("Newsletter: avviso di disiscrizione non inviato", e instanceof Error ? e.message : e);
    return "non_inviato";
  }
}
