import { createHmac, timingSafeEqual } from "crypto";
import { archivioNewsletter, type ArchivioNewsletter } from "./archivio";
import type { Invio, StatoInvio } from "./tipi";

// Webhook di Resend (firmato con Svix). Verifica: HMAC-SHA256 di «id.timestamp.corpo» con il segreto «whsec_…»
// (decodificato da base64), confronto a tempo costante con una delle firme «v1,…» dell'intestazione, timestamp entro
// 5 minuti (niente riuso di vecchie richieste). Senza segreto configurato NESSUNA richiesta è accettata.

const TOLLERANZA_S = 5 * 60;

export function verificaFirmaSvix(corpo: string, h: { id: string | null; timestamp: string | null; firma: string | null }, segreto: string | undefined, adessoS = Math.floor(Date.now() / 1000)): boolean {
  if (!segreto || !h.id || !h.timestamp || !h.firma) return false;
  const ts = Number(h.timestamp);
  if (!Number.isFinite(ts) || Math.abs(adessoS - ts) > TOLLERANZA_S) return false;
  let chiave: Buffer;
  try {
    chiave = Buffer.from(segreto.replace(/^whsec_/, ""), "base64");
  } catch {
    return false;
  }
  if (chiave.length === 0) return false;
  const atteso = createHmac("sha256", chiave).update(`${h.id}.${h.timestamp}.${corpo}`).digest();
  for (const parte of h.firma.split(" ")) {
    const [versione, valore] = parte.split(",");
    if (versione !== "v1" || !valore) continue;
    const ricevuto = Buffer.from(valore, "base64");
    if (ricevuto.length === atteso.length && timingSafeEqual(ricevuto, atteso)) return true;
  }
  return false;
}

// Effetto di un evento sulla riga dell'invio (funzione pura). Lo stato non torna mai «indietro»: una consegna arrivata
// dopo un rimbalzo non lo cancella.
export function applicaEvento(r: Invio, tipo: string, quando: string): Partial<Invio> | null {
  const finale: StatoInvio[] = ["rimbalzato", "segnalato_spam"];
  switch (tipo) {
    case "email.delivered":
      return finale.includes(r.stato) ? { consegnato_il: r.consegnato_il ?? quando } : { stato: "consegnato", consegnato_il: r.consegnato_il ?? quando };
    case "email.delivery_delayed":
      return r.stato === "inviato" ? { stato: "ritardato" } : null;
    case "email.bounced":
      return { stato: "rimbalzato" };
    case "email.complained":
      return { stato: "segnalato_spam" };
    case "email.opened":
      return { aperto_il: r.aperto_il ?? quando };
    case "email.clicked":
      return { cliccato_il: r.cliccato_il ?? quando, clic: r.clic + 1 };
    case "email.failed":
      return { stato: "errore", errore: "rifiutata da Resend dopo l'invio" };
    default:
      return null;
  }
}

export async function gestisciEvento(svixId: string, evento: { type?: string; created_at?: string; data?: { email_id?: string; bounce?: { type?: string } } }, a: ArchivioNewsletter = archivioNewsletter()): Promise<string> {
  const tipo = String(evento.type ?? "");
  const resendId = evento.data?.email_id ?? null;
  // gli eventi delle email transazionali arrivano allo stesso webhook: si ignorano (nessuna riga, nessun dato salvato)
  const invio = resendId ? await a.invioPerResendId(resendId) : null;
  if (!invio) return "ignorato";
  const nuovo = await a.registraEvento({ svix_id: svixId, tipo, resend_id: resendId, invio_id: invio.id, dati: { type: tipo, created_at: evento.created_at ?? null, bounce: evento.data?.bounce?.type ?? null } });
  if (!nuovo) return "già registrato";
  const quando = evento.created_at && !Number.isNaN(Date.parse(evento.created_at)) ? new Date(evento.created_at).toISOString() : new Date().toISOString();
  const patch = applicaEvento(invio, tipo, quando);
  if (patch) await a.aggiornaInvio(invio.id, patch);
  // rimbalzo definitivo o segnalazione spam: l'indirizzo esce dagli invii futuri
  if (invio.iscritto_id && invio.tipo === "reale") {
    const definitivo = tipo === "email.bounced" && (evento.data?.bounce?.type ?? "").toLowerCase() !== "transient";
    if (definitivo) await a.aggiornaIscritto(invio.iscritto_id, { stato: "rimbalzato", motivo_uscita: "rimbalzo definitivo segnalato da Resend" });
    if (tipo === "email.complained") await a.aggiornaIscritto(invio.iscritto_id, { stato: "segnalato_spam", disiscritto_il: quando, motivo_uscita: "segnalazione spam dal client di posta" });
  }
  return "registrato";
}
