import { sendEmail } from "@/lib/email";
import { escapeHtml } from "@/lib/html";
import { archivioNewsletter, type ArchivioNewsletter } from "./archivio";
import { avviaInvio } from "./invio";
import { dataRoma, generazioneDovuta, settimanaIso } from "./pianificazione";
import { numeroEdizione } from "./template";
import { generaNuovaEdizione } from "./versioni";

// Un passaggio del processo pianificato (vedi src/app/api/cron/newsletter/route.ts). Gli errori di una parte non
// fermano l'altra; ogni esito finisce nel registro.

export type EsitoPassaggio = { eseguito: true; invii: { edizione: number; esito: string }[]; generazione: string };

export async function eseguiPassaggioNewsletter(adesso: Date, a: ArchivioNewsletter = archivioNewsletter(), generatori?: Parameters<typeof generaNuovaEdizione>[0]["g"]): Promise<EsitoPassaggio> {
  const invii: { edizione: number; esito: string }[] = [];
  try {
    for (const e of await a.edizioniDaInviare(adesso)) {
      const r = await avviaInvio(e.id, null, "cron", a);
      invii.push({ edizione: e.numero, esito: r.ok ? "ok" : r.errore.slice(0, 160) });
    }
  } catch (err) {
    invii.push({ edizione: 0, esito: `errore: ${err instanceof Error ? err.message.slice(0, 160) : "sconosciuto"}` });
  }

  // pulizia delle iscrizioni dal sito mai confermate (30 giorni), a ogni passaggio: una lettura sola se non c'è nulla
  try {
    const { pulisciNonConfermati } = await import("./iscrizioni");
    await pulisciNonConfermati(a, adesso);
  } catch (err) {
    console.error("Newsletter: pulizia non riuscita", err instanceof Error ? err.message : err);
  }

  let generazione = "non_dovuta";
  try {
    const imp = await a.leggiImpostazioni();
    if (!imp.generazione_automatica) generazione = "spenta";
    else if (generazioneDovuta(imp.giorno_generazione, imp.ora_generazione, adesso)) {
      const settimana = settimanaIso(adesso);
      if (await a.edizioneDellaSettimana(settimana)) generazione = "gia_presente";
      else {
        // l'edizione nasce con la settimana (vincolo unico: due passaggi contemporanei non ne creano due) e la generazione
        // ne diventa la versione 1; un fallimento lascia l'edizione vuota, la versione «fallita» e il costo speso
        const { edizione, esito } = await generaNuovaEdizione({ dataEdizione: dataRoma(adesso), settimana, autore: null, automatica: true, a, g: generatori });
        generazione = esito.ok ? "generata" : "errore";
        await notificaAdmin(a, edizione.numero, esito.ok ? (await a.leggiEdizione(edizione.id))?.oggetto ?? "" : null);
      }
    }
  } catch (err) {
    generazione = `errore: ${err instanceof Error ? err.message.slice(0, 160) : "sconosciuto"}`;
  }
  return { eseguito: true, invii, generazione };
}

async function notificaAdmin(a: ArchivioNewsletter, numero: number, oggetto: string | null) {
  // solo sul deploy di produzione: in sviluppo la chiave di Resend in .env.local è quella vera
  if (process.env.VERCEL_ENV !== "production") return;
  const imp = await a.leggiImpostazioni();
  const titolo = oggetto ? `Tender Weekly n. ${numeroEdizione(numero)}: bozza pronta da rivedere` : `Tender Weekly n. ${numeroEdizione(numero)}: generazione non riuscita`;
  await sendEmail({
    to: imp.email_notifica_admin,
    from: "OMNIA AI <noreply@omniaitalia.com>",
    subject: titolo,
    html: `<p>${escapeHtml(titolo)}.</p>${oggetto ? `<p>Oggetto proposto: <strong>${escapeHtml(oggetto)}</strong></p>` : ""}<p>Apri la console amministrativa, sezione <strong>Newsletter &amp; Comunicazioni</strong>, per rileggerla, inviare la prova e approvarla. Senza approvazione non parte nulla.</p>`,
  });
}
