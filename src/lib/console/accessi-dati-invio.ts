import { sendEmail } from "@/lib/email";
import { MITTENTE_OMNIA_AI } from "@/lib/omnia-ai-email-eventi";
import { nomeFilePdfEstratto } from "./accessi-dati-calcoli";
import { emailClienteEstrattoAccessi, type AccessoPerEmail } from "./accessi-dati-email-calcoli";
import { leggiEstratto } from "./accessi-dati-estratto";
import { creaPdfEstrattoAccessi } from "./accessi-dati-pdf";

// Manda al cliente l'estratto del registro degli accessi (PDF allegato). Lo stesso estratto della pagina della console: stesse
// righe (leggiEstratto), stessi testi. Non lancia mai errori: dice com'è andata, e chi chiama lo mostra all'amministratore.
// L'accesso è già registrato prima di arrivare qui: un invio non riuscito non tocca il registro, si ripete dalla pagina
// dell'estratto («Invia al cliente»).

export type EsitoInvioEstratto = { ok: true; a: string } | { ok: false; motivo: string };

function giornoItaliano(giorno: string | null): string | null {
  if (!giorno) return null;
  const [anno, mese, g] = giorno.split("-");
  return `${g}/${mese}/${anno}`;
}

export async function inviaEstrattoAccessi(d: {
  clienteId: string;
  dal?: string | null;
  al?: string | null;
  operatore: string;
  occasione: "nuovo_accesso" | "su_richiesta";
  accesso?: AccessoPerEmail | null;
}): Promise<EsitoInvioEstratto> {
  try {
    const estratto = await leggiEstratto(d.clienteId, d.dal ?? null, d.al ?? null);
    if (estratto.stato !== "ok") return { ok: false, motivo: estratto.stato === "errore" ? estratto.messaggio : "registro non leggibile" };
    const destinatario = estratto.cliente.email;
    if (!destinatario) return { ok: false, motivo: "il cliente non ha più un'email (account eliminato?)" };

    const emessoIl = new Date();
    const pdf = await creaPdfEstrattoAccessi({
      cliente: estratto.cliente,
      righe: estratto.righe,
      periodo: { da: giornoItaliano(d.dal ?? null), a: giornoItaliano(d.al ?? null) },
      emessoIl,
      operatore: d.operatore,
    });
    const email = emailClienteEstrattoAccessi({ occasione: d.occasione, accesso: d.accesso });
    const inviata = await sendEmail({
      to: destinatario,
      from: MITTENTE_OMNIA_AI,
      subject: email.oggetto,
      html: email.html,
      attachments: [{ filename: nomeFilePdfEstratto(emessoIl), content: Buffer.from(pdf).toString("base64") }],
    });
    return inviata ? { ok: true, a: destinatario } : { ok: false, motivo: "il servizio di posta non ha accettato l'email" };
  } catch (e) {
    console.error("Estratto accessi: invio al cliente non riuscito", e instanceof Error ? e.message : e);
    return { ok: false, motivo: "errore imprevisto nella preparazione del PDF o dell'email" };
  }
}
