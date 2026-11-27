import { randomBytes } from "crypto";
import { archivioNewsletter, type ArchivioNewsletter } from "./archivio";
import { emailValida } from "./destinatari";
import { baseUrlPubblico } from "./invio";
import { prossimaScadenza } from "./pianificazione";
import { inviaLotto } from "./posta";
import { LOGO_URL } from "./template";
import { GIORNI_SETTIMANA, TESTO_CONSENSO_NEWSLETTER, VERSIONE_INFORMATIVA_NEWSLETTER, type Iscritto } from "./tipi";

// Iscrizione pubblica a Tender Weekly da omnia-ai.it, con DOPPIA CONFERMA (double opt-in):
//  1. il visitatore lascia l'indirizzo e spunta il consenso → riga «in_attesa» con testo del consenso, versione
//     dell'informativa, impronta dell'IP (mai l'IP) e browser; parte un'email con il link di conferma;
//  2. il link apre una pagina con il pulsante «Conferma» (un antivirus che apre il link non conferma nulla) → la riga
//     diventa «iscritto» con base giuridica «consenso» e la prova completa (richiesta + conferma, con le date).
// Finché non conferma, l'indirizzo NON riceve la newsletter. La risposta sul sito è sempre la stessa, che l'indirizzo
// sia nuovo, già iscritto o bloccato: non si rivela a nessuno chi è iscritto.

export const RICHIESTE_PER_ORA_PER_IP = 5;
export const ATTESA_TRA_CONFERME_MS = 10 * 60 * 1000;
export const CONFERME_MASSIME = 5;
export const VALIDITA_CONFERMA_MS = 7 * 24 * 60 * 60 * 1000;

export type EsitoRichiesta = { ok: true } | { ok: false; motivo: "email_non_valida" | "consenso_mancante" | "troppe_richieste" };

function gettone(): string {
  return randomBytes(24).toString("hex");
}

export function urlConferma(token: string): string {
  return `${baseUrlPubblico()}/newsletter/conferma?t=${encodeURIComponent(token)}`;
}

function esc(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function emailConferma(url: string): { subject: string; html: string; text: string } {
  const subject = "Conferma la tua iscrizione a Tender Weekly";
  const html = `<!DOCTYPE html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light"><title>${subject}</title></head>
<body style="margin:0;padding:0;background-color:#eeedf5;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#eeedf5"><tr><td align="center" style="padding:24px 10px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background-color:#ffffff;border-radius:12px;overflow:hidden;">
<tr><td bgcolor="#0b0a16" style="background-color:#0b0a16;padding:26px 32px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td><img src="${LOGO_URL}" width="30" height="30" alt="OMNIA AI" style="display:block;border:0;border-radius:6px;"></td>
<td style="padding-left:10px;font-family:'Montserrat',Helvetica,Arial,sans-serif;font-size:14px;font-weight:800;letter-spacing:2px;color:#ffffff;">OMNIA&nbsp;AI &middot; TENDER WEEKLY</td></tr></table>
</td></tr>
<tr><td style="padding:32px;font-family:'Inter',Helvetica,Arial,sans-serif;color:#38365a;font-size:16px;line-height:1.6;">
<h1 style="margin:0 0 14px 0;font-family:'Montserrat',Helvetica,Arial,sans-serif;font-size:24px;line-height:1.25;font-weight:800;color:#1b1930;">Ancora un clic per iscriverti</h1>
<p style="margin:0 0 20px 0;text-align:justify;">Hai chiesto di ricevere Tender Weekly, la newsletter settimanale di OMNIA AI sul mondo degli appalti pubblici. Per completare l'iscrizione conferma il tuo indirizzo:</p>
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="#5b4bd0" style="background-color:#5b4bd0;border-radius:6px;">
<a href="${esc(url)}" target="_blank" style="display:inline-block;padding:14px 28px;font-family:'Montserrat',Helvetica,Arial,sans-serif;font-size:15px;font-weight:800;color:#ffffff;text-decoration:none;">Conferma l'iscrizione&nbsp;&rarr;</a>
</td></tr></table>
<p style="margin:22px 0 0 0;font-size:13px;color:#5d5b78;text-align:justify;">Il link vale 7 giorni. Se non hai chiesto tu l'iscrizione, ignora questa email: senza conferma non riceverai nulla.</p>
</td></tr>
<tr><td bgcolor="#0b0a16" style="background-color:#0b0a16;padding:20px 32px;font-family:'Inter',Helvetica,Arial,sans-serif;font-size:12px;line-height:1.6;color:#a9a6c4;">
OMNIA AI è un prodotto di Omnia Consulting SRLS &middot; P.IVA 02957590819 &middot; <a href="https://omnia-ai.it/privacy" style="color:#e9e7f4;">Privacy</a>
</td></tr></table>
</td></tr></table></body></html>`;
  const text = `Ancora un clic per iscriverti a Tender Weekly\n\nHai chiesto di ricevere Tender Weekly, la newsletter settimanale di OMNIA AI sul mondo degli appalti pubblici.\nConferma l'iscrizione da questo link (vale 7 giorni):\n${url}\n\nSe non hai chiesto tu l'iscrizione, ignora questa email: senza conferma non riceverai nulla.\n\nOMNIA AI è un prodotto di Omnia Consulting SRLS · P.IVA 02957590819 · https://omnia-ai.it/privacy`;
  return { subject, html, text };
}

async function inviaConferma(a: ArchivioNewsletter, i: Pick<Iscritto, "id" | "email">, token: string): Promise<void> {
  const imp = await a.leggiImpostazioni();
  const m = emailConferma(urlConferma(token));
  const esito = await inviaLotto(
    [{ to: i.email, subject: m.subject, html: m.html, text: m.text, headers: {}, tags: [{ name: "categoria", value: "conferma_iscrizione" }] }],
    { nome: imp.mittente_nome, email: imp.mittente_email, rispondiA: imp.rispondi_a || "info@omniaitalia.com" },
    `tw-conferma-${token}-${Date.now()}`,
  );
  // il registro conta le email di conferma (volumi di Resend nell'area dei costi); nessun indirizzo nel dettaglio
  await a.annota(null, "email_conferma", { iscritto: i.id, simulato: esito.simulato, esito: esito.ok ? "ok" : "errore" }, null);
}

export async function richiediIscrizione(
  d: { email: string; consenso: boolean; ipHash: string | null; userAgent: string | null; adesso?: Date },
  a: ArchivioNewsletter = archivioNewsletter(),
): Promise<EsitoRichiesta> {
  const adesso = d.adesso ?? new Date();
  const email = d.email.trim().toLowerCase();
  if (!emailValida(email)) return { ok: false, motivo: "email_non_valida" };
  if (!d.consenso) return { ok: false, motivo: "consenso_mancante" };
  if (d.ipHash) {
    const recenti = await a.contaRichiesteRecenti(d.ipHash, new Date(adesso.getTime() - 60 * 60 * 1000).toISOString());
    if (recenti >= RICHIESTE_PER_ORA_PER_IP) return { ok: false, motivo: "troppe_richieste" };
  }
  await a.annota(null, "richiesta_iscrizione", { ip_hash: d.ipHash }, null);

  const consenso = {
    consenso_testo: TESTO_CONSENSO_NEWSLETTER,
    informativa_versione: VERSIONE_INFORMATIVA_NEWSLETTER,
    consenso_ip_hash: d.ipHash,
    consenso_user_agent: (d.userAgent ?? "").slice(0, 300) || null,
  };
  const esistente = await a.iscrittoPerEmail(email);

  if (!esistente) {
    const token = gettone();
    const nuovo = await a.aggiungiIscritto(
      {
        email,
        nome: null,
        user_id: null,
        categoria: "altro",
        stato: "in_attesa",
        base_giuridica: "consenso",
        prova_base: `Richiesta dal sito omnia-ai.it il ${adesso.toISOString()}: in attesa della conferma dall'email (doppia conferma).`,
        base_dal: adesso.toISOString().slice(0, 10),
        provenienza: "sito",
        ...consenso,
        conferma_token: token,
        conferma_inviata_il: adesso.toISOString(),
        conferme_inviate: 1,
      },
      null,
    );
    await inviaConferma(a, nuovo, token);
    return { ok: true };
  }

  if (esistente.stato === "in_attesa") {
    // nuovo invio solo dopo una pausa e fino a un massimo: nessuno può usare il modulo per bombardare una casella
    const ultima = esistente.conferma_inviata_il ? Date.parse(esistente.conferma_inviata_il) : 0;
    if (adesso.getTime() - ultima >= ATTESA_TRA_CONFERME_MS && (esistente.conferme_inviate ?? 0) < CONFERME_MASSIME) {
      const token = gettone();
      await a.aggiornaIscritto(esistente.id, { ...consenso, conferma_token: token, conferma_inviata_il: adesso.toISOString(), conferme_inviate: (esistente.conferme_inviate ?? 0) + 1 });
      await inviaConferma(a, esistente, token);
    }
    return { ok: true };
  }

  if (esistente.stato === "disiscritto") {
    // una nuova iscrizione dopo una disiscrizione è un NUOVO consenso: si riparte dalla doppia conferma
    const token = gettone();
    await a.aggiornaIscritto(esistente.id, {
      stato: "in_attesa",
      ...consenso,
      provenienza: esistente.provenienza ?? "sito",
      conferma_token: token,
      conferma_inviata_il: adesso.toISOString(),
      conferme_inviate: 1,
    });
    await inviaConferma(a, esistente, token);
    return { ok: true };
  }

  // già iscritto, indirizzo che rimbalza o che ha segnalato spam: nessuna email, stessa risposta
  return { ok: true };
}

export type EsitoConferma = { ok: true; prossimoInvio: Date; giornoInvio: string; giaConfermato: boolean } | { ok: false; motivo: "non_valido" | "scaduto" };

export async function confermaIscrizione(token: string, a: ArchivioNewsletter = archivioNewsletter(), adesso = new Date()): Promise<EsitoConferma> {
  const imp = await a.leggiImpostazioni();
  const giornoInvio = GIORNI_SETTIMANA[imp.giorno_invio];
  const prossimoInvio = prossimaScadenza(imp.giorno_invio, imp.ora_invio, adesso);
  const i = await a.iscrittoPerConferma(token);
  if (!i || i.stato !== "in_attesa") return { ok: false, motivo: "non_valido" };
  if (i.conferma_inviata_il && adesso.getTime() - Date.parse(i.conferma_inviata_il) > VALIDITA_CONFERMA_MS) return { ok: false, motivo: "scaduto" };
  await a.aggiornaIscritto(i.id, {
    stato: "iscritto",
    base_giuridica: "consenso",
    prova_base: `Doppia conferma: richiesta dal sito omnia-ai.it il ${i.conferma_inviata_il ?? "?"} con il consenso «${(i.consenso_testo ?? "").slice(0, 120)}…» (${i.informativa_versione ?? "informativa"}; impronta IP ${i.consenso_ip_hash ? i.consenso_ip_hash.slice(0, 12) : "n.d."}), confermata dal link inviato all'indirizzo il ${adesso.toISOString()}.`,
    base_dal: adesso.toISOString().slice(0, 10),
    confermato_il: adesso.toISOString(),
    conferma_token: null,
    disiscritto_il: null,
    motivo_uscita: null,
  });
  await a.annota(null, "iscrizione_confermata", { iscritto: i.id }, null);
  return { ok: true, prossimoInvio, giornoInvio, giaConfermato: false };
}

// Pulizia promessa dall'informativa: le iscrizioni dal sito mai confermate si cancellano dopo 30 giorni. Chi era già stato
// iscritto (confermato o disiscritto in passato) e ha chiesto di nuovo senza confermare torna «disiscritto»: la prova della
// disiscrizione precedente non si perde. Un indirizzo che ha confermato non è mai toccato.
export const GIORNI_PULIZIA_NON_CONFERMATI = 30;

export async function pulisciNonConfermati(a: ArchivioNewsletter = archivioNewsletter(), adesso = new Date()): Promise<{ cancellati: number; tornatiDisiscritti: number }> {
  const limite = adesso.getTime() - GIORNI_PULIZIA_NON_CONFERMATI * 86400000;
  let cancellati = 0;
  let tornatiDisiscritti = 0;
  for (const i of await a.elencoIscritti()) {
    if (i.stato !== "in_attesa" || !i.conferma_inviata_il || Date.parse(i.conferma_inviata_il) > limite) continue;
    if (i.disiscritto_il || i.confermato_il) {
      await a.aggiornaIscritto(i.id, { stato: "disiscritto", conferma_token: null, motivo_uscita: i.motivo_uscita ?? "nuova richiesta di iscrizione non confermata" });
      tornatiDisiscritti++;
    } else {
      await a.eliminaIscritto(i.id);
      cancellati++;
    }
  }
  if (cancellati || tornatiDisiscritti) await a.annota(null, "pulizia_non_confermati", { cancellati, tornatiDisiscritti }, null);
  return { cancellati, tornatiDisiscritti };
}
