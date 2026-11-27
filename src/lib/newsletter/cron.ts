import { sendEmail } from "@/lib/email";
import { escapeHtml } from "@/lib/html";
import { archivioNewsletter, type ArchivioNewsletter } from "./archivio";
import { generaEdizione } from "./generazione";
import { avviaInvio } from "./invio";
import { dataRoma, generazioneDovuta, settimanaIso } from "./pianificazione";
import { numeroEdizione } from "./template";
import { contenutoVuoto } from "./tipi";

// Un passaggio del processo pianificato (vedi src/app/api/cron/newsletter/route.ts). Gli errori di una parte non
// fermano l'altra; ogni esito finisce nel registro.

export type EsitoPassaggio = { eseguito: true; invii: { edizione: number; esito: string }[]; generazione: string };

export async function eseguiPassaggioNewsletter(adesso: Date, a: ArchivioNewsletter = archivioNewsletter(), genera = generaEdizione): Promise<EsitoPassaggio> {
  const invii: { edizione: number; esito: string }[] = [];
  try {
    for (const e of await a.edizioniDaInviare(adesso)) {
      const r = await avviaInvio(e.id, null, "cron", a);
      invii.push({ edizione: e.numero, esito: r.ok ? "ok" : r.errore.slice(0, 160) });
    }
  } catch (err) {
    invii.push({ edizione: 0, esito: `errore: ${err instanceof Error ? err.message.slice(0, 160) : "sconosciuto"}` });
  }

  let generazione = "non_dovuta";
  try {
    const imp = await a.leggiImpostazioni();
    if (!imp.generazione_automatica) generazione = "spenta";
    else if (generazioneDovuta(imp.giorno_generazione, imp.ora_generazione, adesso)) {
      const settimana = settimanaIso(adesso);
      if (await a.edizioneDellaSettimana(settimana)) generazione = "gia_presente";
      else {
        // prima si «prenota» la settimana (vincolo unico): due passaggi contemporanei non chiamano il modello due volte
        const e = await a.creaEdizione({ data_edizione: dataRoma(adesso), settimana, origine: "ai_automatica", contenuto: contenutoVuoto(), note_generazione: "Generazione automatica in corso…" }, null);
        if (e.note_generazione !== "Generazione automatica in corso…" || e.oggetto) generazione = "gia_presente";
        else {
          try {
            const g = await genera({ dataEdizione: dataRoma(adesso) });
            await a.aggiornaEdizione(
              e.id,
              {
                oggetto: g.oggetto,
                preheader: g.preheader,
                contenuto: g.contenuto,
                note_generazione: [`Generata in automatico. Ricerche web: ${g.ricerche}. Fonti scartate: ${g.fontiScartate}. Notizie tolte: ${g.notizieScartate}.`, g.note].filter(Boolean).join("\n"),
              },
              ["bozza"],
            );
            await a.annota(e.id, "generata_automatica", { ricerche: g.ricerche }, null);
            generazione = "generata";
            await notificaAdmin(a, e.numero, g.oggetto);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            await a.aggiornaEdizione(e.id, { note_generazione: `Generazione automatica NON riuscita: ${msg.slice(0, 400)}. Scrivi l'edizione a mano o rigenerala dalla console.` }, ["bozza"]);
            await a.annota(e.id, "generazione_errore", { errore: msg.slice(0, 400) }, null);
            generazione = "errore";
            await notificaAdmin(a, e.numero, null);
          }
        }
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
