import { createHash } from "crypto";
import { OMNIA_AI_BASE_URL } from "@/lib/zone";
import { archivioNewsletter, type ArchivioNewsletter } from "./archivio";
import { controllaEdizione } from "./contenuto";
import { abbonatiAttivi, emailValida, selezionaDestinatari } from "./destinatari";
import { DIMENSIONE_LOTTO, inviaLotto, invioRealeConsentito, type MessaggioNewsletter } from "./posta";
import { numeroEdizione, renderNewsletterHtml, renderNewsletterTesto } from "./template";
import type { Edizione, Impostazioni, Invio } from "./tipi";

// Invio di un'edizione: prova (non cambia lo stato), reale (solo edizioni approvate), ripresa dopo un invio parziale.
//
// Contro i doppi invii, tre livelli:
//  1. lo stato passa ad «in_invio» con un aggiornamento CONDIZIONATO (solo da approvata/programmata): due richieste
//     contemporanee (doppio clic, cron + clic) → una sola lo ottiene, l'altra trova lo stato già cambiato;
//  2. le righe degli invii reali hanno un indice unico (edizione, iscritto): accodare due volte non duplica;
//  3. ogni lotto va a Resend con una chiave di idempotenza derivata dalle righe: ripetere lo stesso lotto entro 24 ore
//     restituisce la stessa risposta senza mandare di nuovo.
// Si spedisce solo ciò che è «in_coda»; prima di ogni lotto si ricontrolla che l'iscritto non si sia disiscritto.

export function baseUrlPubblico(): string {
  if (process.env.VERCEL_ENV === "production") return OMNIA_AI_BASE_URL;
  return process.env.NEWSLETTER_URL_PUBBLICO_SVILUPPO || "http://localhost:3000";
}

export function urlDisiscrizione(token: string): string {
  return `${baseUrlPubblico()}/newsletter/disiscrizione?t=${encodeURIComponent(token)}`;
}

function intestazioni(token: string): Record<string, string> {
  return {
    "List-Unsubscribe": `<${baseUrlPubblico()}/api/newsletter/disiscrizione?t=${encodeURIComponent(token)}>, <mailto:info@omniaitalia.com?subject=Disiscrizione%20Tender%20Weekly>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}

function messaggio(e: Edizione, to: string, token: string | null, prova: boolean): MessaggioNewsletter {
  const url = token ? urlDisiscrizione(token) : `${baseUrlPubblico()}/newsletter/disiscrizione`;
  const opz = {
    urlDisiscrizione: url,
    prova,
    motivoRicezione: prova ? "Questa è un'email di prova inviata dalla console di OMNIA AI: non è la newsletter inviata ai lettori." : undefined,
  };
  return {
    to,
    subject: prova ? `[PROVA] ${e.oggetto}` : e.oggetto,
    html: renderNewsletterHtml(e, opz),
    text: renderNewsletterTesto(e, opz),
    headers: token ? intestazioni(token) : {},
    tags: [
      { name: "categoria", value: "newsletter" },
      { name: "edizione", value: numeroEdizione(e.numero) },
      { name: "tipo", value: prova ? "prova" : "reale" },
    ],
  };
}

function mittente(i: Impostazioni) {
  return { nome: i.mittente_nome, email: i.mittente_email, rispondiA: i.rispondi_a || "info@omniaitalia.com" };
}

export type Esito = { ok: true; messaggio: string } | { ok: false; errore: string };

// ───── prova ─────

export const MAX_INDIRIZZI_PROVA = 5;

export async function inviaProva(edizioneId: string, indirizzi: string[], autore: string | null, a: ArchivioNewsletter = archivioNewsletter()): Promise<Esito> {
  const puliti = [...new Set(indirizzi.map((x) => x.trim().toLowerCase()).filter(Boolean))];
  if (puliti.length === 0) return { ok: false, errore: "Indica almeno un indirizzo." };
  if (puliti.length > MAX_INDIRIZZI_PROVA) return { ok: false, errore: `Al massimo ${MAX_INDIRIZZI_PROVA} indirizzi per la prova.` };
  const nonValidi = puliti.filter((x) => !emailValida(x));
  if (nonValidi.length) return { ok: false, errore: `Indirizzi non validi: ${nonValidi.join(", ")}` };
  const e = await a.leggiEdizione(edizioneId);
  if (!e) return { ok: false, errore: "Edizione non trovata." };
  if (!e.oggetto.trim()) return { ok: false, errore: "Scrivi l'oggetto prima di inviare una prova." };
  const imp = await a.leggiImpostazioni();
  // ogni prova è una riga a sé (tipo «prova»): lo stato dell'edizione NON cambia
  const esito = await inviaLotto(
    puliti.map((to) => messaggio(e, to, null, true)),
    mittente(imp),
    `tw-prova-${e.id}-${e.versione}-${createHash("sha256").update(puliti.join(",") + Date.now()).digest("hex").slice(0, 16)}`,
  );
  await a.accodaInvii(puliti.map((email) => ({ edizione_id: e.id, iscritto_id: null, tipo: "prova" as const, email, versione: e.versione, stato: "in_coda" as const })));
  const righe = (await a.inviiDellEdizione(e.id)).filter((r) => r.tipo === "prova" && r.stato === "in_coda" && puliti.includes(r.email));
  for (const r of righe) {
    await a.aggiornaInvio(r.id, esito.ok ? { stato: "inviato", resend_id: esito.ids[puliti.indexOf(r.email)] ?? null, inviato_il: new Date().toISOString() } : { stato: "errore", errore: esito.errore });
  }
  await a.annota(e.id, "prova", { indirizzi: puliti.length, versione: e.versione, simulato: esito.simulato, esito: esito.ok ? "ok" : esito.errore }, autore);
  if (!esito.ok) return { ok: false, errore: esito.errore };
  return { ok: true, messaggio: esito.simulato ? `Prova SIMULATA (ambiente di sviluppo): nessuna email spedita a ${puliti.join(", ")}.` : `Email di prova inviata a ${puliti.join(", ")}.` };
}

// ───── invio reale ─────

export async function anteprimaDestinatari(e: Pick<Edizione, "destinatari">, a: ArchivioNewsletter = archivioNewsletter()) {
  const [iscritti, abbonati] = await Promise.all([a.elencoIscritti(), abbonatiAttivi()]);
  return selezionaDestinatari(iscritti, abbonati, e.destinatari);
}

export async function avviaInvio(edizioneId: string, autore: string | null, origine: "manuale" | "cron", a: ArchivioNewsletter = archivioNewsletter()): Promise<Esito> {
  const e = await a.leggiEdizione(edizioneId);
  if (!e) return { ok: false, errore: "Edizione non trovata." };
  if (!e.approvata_il || (e.stato !== "approvata" && e.stato !== "programmata")) {
    return { ok: false, errore: `L'edizione è «${e.stato}»: si invia solo un'edizione approvata.` };
  }
  const controllo = controllaEdizione(e);
  if (controllo.bloccanti.length) return { ok: false, errore: `Invio bloccato: ${controllo.bloccanti[0]}` };

  // 1. presa dello stato (condizionata): chi arriva secondo non invia
  const presa = await a.aggiornaEdizione(e.id, { stato: "in_invio", invio_iniziato_il: new Date().toISOString() }, ["approvata", "programmata"]);
  if (!presa) return { ok: false, errore: "L'edizione è già in invio o è cambiata nel frattempo: nessun invio ripetuto." };

  try {
    // clienti che hanno accettato le Condizioni con Tender Weekly incluso: acquisiti prima di calcolare i destinatari
    if (a.tipo === "supabase") {
      const { sincronizzaClienti } = await import("./gestione-iscritti");
      await sincronizzaClienti(a).catch((e) => console.error("Newsletter: clienti non acquisiti prima dell'invio", e instanceof Error ? e.message : e));
    }
    const { inclusi, esclusi } = await anteprimaDestinatari(presa, a);
    await a.accodaInvii(inclusi.map((i) => ({ edizione_id: presa.id, iscritto_id: i.id, tipo: "reale" as const, email: i.email, versione: presa.versione, stato: "in_coda" as const })));
    await a.annota(presa.id, "invio_avviato", { origine, destinatari: inclusi.length, esclusi: esclusi.length, versione: presa.versione, reale: invioRealeConsentito() }, autore);
    return await proseguiInvio(presa, autore, a);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await a.aggiornaEdizione(e.id, { stato: "invio_parziale", invio_concluso_il: new Date().toISOString() }, ["in_invio"]);
    await a.annota(e.id, "invio_errore", { errore: msg.slice(0, 500) }, autore);
    return { ok: false, errore: `Invio interrotto: ${msg}. Le email non partite restano in coda: usa «Riprendi invio».` };
  }
}

async function proseguiInvio(e: Edizione, autore: string | null, a: ArchivioNewsletter): Promise<Esito> {
  const imp = await a.leggiImpostazioni();
  const iscritti = new Map((await a.elencoIscritti()).map((i) => [i.id, i]));
  const tutte = await a.inviiDellEdizione(e.id);
  const inCoda = tutte.filter((r) => r.tipo === "reale" && r.stato === "in_coda");
  let inviati = 0;
  let errori = 0;
  let simulato = false;

  for (let k = 0; k < inCoda.length; k += DIMENSIONE_LOTTO) {
    const blocco: { riga: Invio; token: string }[] = [];
    for (const riga of inCoda.slice(k, k + DIMENSIONE_LOTTO)) {
      const i = riga.iscritto_id ? iscritti.get(riga.iscritto_id) : undefined;
      if (!i || i.stato !== "iscritto") {
        await a.aggiornaInvio(riga.id, { stato: "saltato", errore: "non più iscritto al momento dell'invio" });
        continue;
      }
      blocco.push({ riga, token: i.token_disiscrizione });
    }
    if (blocco.length === 0) continue;
    const chiave = `tw-${e.id}-v${e.versione}-${createHash("sha256").update(blocco.map((b) => b.riga.id).join(",")).digest("hex").slice(0, 24)}`;
    const esito = await inviaLotto(
      blocco.map((b) => messaggio(e, b.riga.email, b.token, false)),
      mittente(imp),
      chiave,
    );
    simulato = simulato || esito.simulato;
    const ora = new Date().toISOString();
    for (const [n, b] of blocco.entries()) {
      if (esito.ok) {
        await a.aggiornaInvio(b.riga.id, { stato: "inviato", resend_id: esito.ids[n], inviato_il: ora, errore: null });
        inviati++;
      } else {
        await a.aggiornaInvio(b.riga.id, { stato: "errore", errore: esito.errore.slice(0, 500) });
        errori++;
      }
    }
  }

  const finale = errori > 0 ? "invio_parziale" : "inviata";
  await a.aggiornaEdizione(e.id, { stato: finale, invio_concluso_il: new Date().toISOString() }, ["in_invio"]);
  await a.annota(e.id, "invio_concluso", { inviati, errori, stato: finale, simulato }, autore);
  const prefisso = simulato ? "SIMULAZIONE (ambiente di sviluppo, nessuna email spedita): " : "";
  if (errori > 0) return { ok: false, errore: `${prefisso}${inviati} inviate, ${errori} non partite. Controlla l'errore e usa «Riprendi invio».` };
  return { ok: true, messaggio: `${prefisso}${inviati} email inviate.` };
}

// Ripresa: rimette in coda le righe in errore e riparte. Solo da «invio_parziale» oppure da un «in_invio» fermo da
// più di 15 minuti (funzione interrotta a metà).
export async function riprendiInvio(edizioneId: string, autore: string | null, a: ArchivioNewsletter = archivioNewsletter()): Promise<Esito> {
  const e = await a.leggiEdizione(edizioneId);
  if (!e) return { ok: false, errore: "Edizione non trovata." };
  const ferma = e.stato === "in_invio" && e.invio_iniziato_il && Date.now() - Date.parse(e.invio_iniziato_il) > 15 * 60 * 1000;
  if (e.stato !== "invio_parziale" && !ferma) return { ok: false, errore: "Si riprende solo un invio parziale o un invio fermo da oltre 15 minuti." };
  const presa = await a.aggiornaEdizione(e.id, { stato: "in_invio", invio_iniziato_il: new Date().toISOString() }, [e.stato]);
  if (!presa) return { ok: false, errore: "Lo stato è cambiato nel frattempo." };
  for (const r of await a.inviiDellEdizione(e.id)) {
    if (r.tipo === "reale" && r.stato === "errore") await a.aggiornaInvio(r.id, { stato: "in_coda", errore: null });
  }
  await a.annota(e.id, "invio_ripreso", {}, autore);
  return proseguiInvio(presa, autore, a);
}

// Statistiche di un'edizione dalle righe degli invii reali (gli eventi arrivano dal webhook di Resend).
export function statistiche(invii: Invio[]) {
  const reali = invii.filter((r) => r.tipo === "reale");
  const conta = (f: (r: Invio) => boolean) => reali.filter(f).length;
  return {
    totale: reali.length,
    inCoda: conta((r) => r.stato === "in_coda"),
    inviati: conta((r) => r.stato !== "in_coda" && r.stato !== "errore" && r.stato !== "saltato"),
    consegnati: conta((r) => r.stato === "consegnato" || r.consegnato_il !== null),
    aperti: conta((r) => r.aperto_il !== null),
    cliccati: conta((r) => r.cliccato_il !== null),
    rimbalzati: conta((r) => r.stato === "rimbalzato"),
    spam: conta((r) => r.stato === "segnalato_spam"),
    errori: conta((r) => r.stato === "errore"),
    saltati: conta((r) => r.stato === "saltato"),
    prove: invii.filter((r) => r.tipo === "prova").length,
  };
}
