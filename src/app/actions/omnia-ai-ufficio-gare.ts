"use server";

import { randomBytes } from "crypto";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { getRequestMeta } from "@/lib/legal-acceptance";
import { getOmniaAiRequestOrigin } from "@/lib/omnia-ai-request";
import { requireOmniaAiWriteAccess } from "@/lib/omnia-ai-access";
import { richiediTitolareAzione } from "@/lib/omnia-ai-account-guardie";
import { leggiUfficioGare, mandaLinkPasswordUfficioGare } from "@/lib/omnia-ai-ufficio-gare";
import { rinvioLinkPermesso, validaInvitoUfficioGare } from "@/lib/omnia-ai-account-calcoli";

// Il titolare crea e gestisce il SUO Ufficio Gare. Ogni azione parte da richiediTitolareAzione (l'Ufficio Gare
// non può usarle) e lavora sempre sull'Ufficio Gare del titolare loggato: l'identificativo dell'Ufficio Gare
// non arriva mai dalla richiesta, si ricava dal database partendo dal titolare.

export type UfficioGareState = { error?: string; success?: string; avviso?: string };

const PAGINA = "/dashboard/omnia-ai/ufficio-gare";

const MESSAGGIO_NON_DISPONIBILE = "L'Ufficio Gare non è ancora disponibile. Riprova più tardi o contattaci.";
const MESSAGGIO_LETTURA_NON_RIUSCITA = "Non riesco a leggere l'Ufficio Gare in questo momento. Riprova tra qualche istante.";
// Volutamente generico: non dice se l'indirizzo appartiene già a un altro account (non si deve poter scoprire chi è cliente).
const MESSAGGIO_EMAIL_NON_UTILIZZABILE = "Questo indirizzo non può essere usato: scegline un altro.";
// «ban» a vita per sospendere (100 anni): l'accesso e il rinnovo della sessione si bloccano subito, anche se il browser ha ancora una sessione aperta.
const DURATA_SOSPENSIONE = "876000h";

export async function creaUfficioGare(_prev: UfficioGareState, formData: FormData): Promise<UfficioGareState> {
  const guardia = await richiediTitolareAzione();
  if (!guardia.ok) return { error: guardia.errore };
  const { user, contesto } = guardia;

  const esito = validaInvitoUfficioGare({
    email: String(formData.get("email") ?? ""),
    emailTitolare: user.email,
    consenso: formData.get("consenso") === "on",
  });
  if (!esito.ok) return { error: esito.errore };
  const email = esito.email;

  const admin = createAdminClient();

  // Con l'abbonamento non attivo (sola lettura o cessato) non si aggiungono persone: prima lo si riattiva.
  const accessoNegato = await requireOmniaAiWriteAccess(contesto.accountId, admin);
  if (accessoNegato) return { error: accessoNegato };

  const lettura = await leggiUfficioGare(contesto.accountId, admin);
  if (lettura.esito === "schema_assente") return { error: MESSAGGIO_NON_DISPONIBILE };
  if (lettura.esito === "errore") return { error: MESSAGGIO_LETTURA_NON_RIUSCITA };
  if (lettura.esito === "presente") return { error: "Hai già un Ufficio Gare: se vuoi cambiarlo, rimuovilo prima e creane uno nuovo." };

  const { data: esistente, error: erroreUtente } = await admin.from("users").select("id").eq("email", email).maybeSingle<{ id: string }>();
  if (erroreUtente) {
    console.error("Ufficio Gare: controllo dell'indirizzo non riuscito", erroreUtente.message);
    return { error: "Creazione non riuscita. Riprova tra qualche istante." };
  }
  if (esistente) return { error: MESSAGGIO_EMAIL_NON_UTILIZZABILE };

  // La password iniziale è casuale e non la conosce nessuno: la sceglie la persona dal link ricevuto per email.
  const casuale = `${randomBytes(32).toString("base64url")}Aa1!`;
  const { data: creato, error: erroreCreazione } = await admin.auth.admin.createUser({ email, password: casuale, email_confirm: true });
  if (erroreCreazione || !creato.user) {
    console.error("Ufficio Gare: creazione utente fallita", erroreCreazione?.message);
    return { error: /already|registered|exists/i.test(erroreCreazione?.message ?? "") ? MESSAGGIO_EMAIL_NON_UTILIZZABILE : "Creazione non riuscita. Riprova tra qualche istante." };
  }
  const membroId = creato.user.id;

  // Da qui, se un passo fallisce l'utente appena creato si cancella: mai un account a metà.
  const annulla = async (messaggio: string): Promise<UfficioGareState> => {
    const { error } = await admin.auth.admin.deleteUser(membroId);
    if (error) console.error("Ufficio Gare: rimozione dell'utente appena creato fallita", membroId, error.message);
    return { error: `${messaggio} Nessun accesso è stato creato.` };
  };

  const meta = await getRequestMeta();
  const { error: erroreLegame } = await admin.from("omnia_ai_membri").insert({
    membro_id: membroId,
    titolare_id: contesto.accountId,
    ruolo: "ufficio_gare",
    consenso_ip: meta.ip,
    consenso_user_agent: meta.userAgent?.slice(0, 300) ?? null,
  });
  if (erroreLegame) {
    console.error("Ufficio Gare: registrazione del legame fallita", erroreLegame.code, erroreLegame.message);
    return annulla(erroreLegame.code === "23505" ? "Hai già un Ufficio Gare." : "Registrazione non riuscita.");
  }

  const inviata = await mandaLinkPasswordUfficioGare({
    admin,
    emailUfficioGare: email,
    titolareId: contesto.accountId,
    emailTitolare: user.email ?? null,
    origine: await getOmniaAiRequestOrigin(),
  });

  revalidatePath(PAGINA);
  if (!inviata) {
    return { success: `Accesso creato per ${email}.`, avviso: "L'email con il link NON è partita: premi «Rinvia il link» per riprovare." };
  }
  return { success: `Accesso creato. Abbiamo inviato a ${email} il link per scegliere la password.` };
}

export async function rinviaLinkUfficioGare(): Promise<UfficioGareState> {
  const guardia = await richiediTitolareAzione();
  if (!guardia.ok) return { error: guardia.errore };
  const { user, contesto } = guardia;
  const admin = createAdminClient();

  const lettura = await leggiUfficioGare(contesto.accountId, admin);
  if (lettura.esito === "schema_assente") return { error: MESSAGGIO_NON_DISPONIBILE };
  if (lettura.esito === "errore") return { error: MESSAGGIO_LETTURA_NON_RIUSCITA };
  if (lettura.esito === "assente") return { error: "Non hai un Ufficio Gare." };
  const { ufficio } = lettura;

  const permesso = rinvioLinkPermesso({ stato: ufficio.stato, invitoInviatoIl: ufficio.invitoInviatoIl, adesso: new Date() });
  if (!permesso.ok) return { error: permesso.errore };

  // Prima si registra l'invio (così due clic ravvicinati non mandano due email), poi si manda.
  const { error: erroreAggiornamento } = await admin
    .from("omnia_ai_membri")
    .update({ invito_inviato_il: new Date().toISOString() })
    .eq("membro_id", ufficio.membroId)
    .eq("titolare_id", contesto.accountId);
  if (erroreAggiornamento) {
    console.error("Ufficio Gare: invito_inviato_il non aggiornato", erroreAggiornamento.message);
    return { error: "Rinvio non riuscito. Riprova tra qualche istante." };
  }

  const inviata = await mandaLinkPasswordUfficioGare({
    admin,
    emailUfficioGare: ufficio.email,
    titolareId: contesto.accountId,
    emailTitolare: user.email ?? null,
    origine: await getOmniaAiRequestOrigin(),
  });

  revalidatePath(PAGINA);
  if (!inviata) return { error: "L'email non è partita. Riprova tra un minuto." };
  return { success: `Link rinviato a ${ufficio.email}.` };
}

export async function sospendiUfficioGare(): Promise<UfficioGareState> {
  const guardia = await richiediTitolareAzione();
  if (!guardia.ok) return { error: guardia.errore };
  const { contesto } = guardia;
  const admin = createAdminClient();

  const lettura = await leggiUfficioGare(contesto.accountId, admin);
  if (lettura.esito === "schema_assente") return { error: MESSAGGIO_NON_DISPONIBILE };
  if (lettura.esito === "errore") return { error: MESSAGGIO_LETTURA_NON_RIUSCITA };
  if (lettura.esito === "assente") return { error: "Non hai un Ufficio Gare." };
  const { ufficio } = lettura;

  // Prima il segno nel database (da subito l'Ufficio Gare non vede più nulla), poi il blocco dell'accesso.
  const { error } = await admin.from("omnia_ai_membri").update({ attivo: false }).eq("membro_id", ufficio.membroId).eq("titolare_id", contesto.accountId);
  if (error) {
    console.error("Ufficio Gare: sospensione non riuscita", error.message);
    return { error: "Sospensione non riuscita. Riprova tra qualche istante." };
  }
  const { error: erroreBlocco } = await admin.auth.admin.updateUserById(ufficio.membroId, { ban_duration: DURATA_SOSPENSIONE });
  if (erroreBlocco) console.error("Ufficio Gare: blocco dell'accesso non riuscito", erroreBlocco.message);

  revalidatePath(PAGINA);
  return erroreBlocco
    ? { success: "Accesso sospeso: l'Ufficio Gare non vede più nulla.", avviso: "Il blocco del login non è riuscito; il resto è in vigore. Se vuoi, riprova." }
    : { success: "Accesso sospeso: l'Ufficio Gare non può più entrare." };
}

export async function riattivaUfficioGare(): Promise<UfficioGareState> {
  const guardia = await richiediTitolareAzione();
  if (!guardia.ok) return { error: guardia.errore };
  const { contesto } = guardia;
  const admin = createAdminClient();

  const lettura = await leggiUfficioGare(contesto.accountId, admin);
  if (lettura.esito === "schema_assente") return { error: MESSAGGIO_NON_DISPONIBILE };
  if (lettura.esito === "errore") return { error: MESSAGGIO_LETTURA_NON_RIUSCITA };
  if (lettura.esito === "assente") return { error: "Non hai un Ufficio Gare." };
  const { ufficio } = lettura;

  // Prima si toglie il blocco del login, poi si riapre l'accesso ai dati: mai un accesso aperto con il login ancora chiuso a metà.
  const { error: erroreBlocco } = await admin.auth.admin.updateUserById(ufficio.membroId, { ban_duration: "none" });
  if (erroreBlocco) {
    console.error("Ufficio Gare: sblocco dell'accesso non riuscito", erroreBlocco.message);
    return { error: "Riattivazione non riuscita. Riprova tra qualche istante." };
  }
  const { error } = await admin.from("omnia_ai_membri").update({ attivo: true }).eq("membro_id", ufficio.membroId).eq("titolare_id", contesto.accountId);
  if (error) {
    console.error("Ufficio Gare: riattivazione non riuscita", error.message);
    return { error: "Riattivazione non riuscita. Riprova tra qualche istante." };
  }

  revalidatePath(PAGINA);
  return { success: "Accesso riattivato." };
}

// Toglie l'Ufficio Gare: l'utente viene eliminato (e con lui la sua conversazione col supporto). Le gare, i
// documenti e le relazioni restano: sono dell'azienda, non suoi.
export async function rimuoviUfficioGare(): Promise<UfficioGareState> {
  const guardia = await richiediTitolareAzione();
  if (!guardia.ok) return { error: guardia.errore };
  const { contesto } = guardia;
  const admin = createAdminClient();

  const lettura = await leggiUfficioGare(contesto.accountId, admin);
  if (lettura.esito === "schema_assente") return { error: MESSAGGIO_NON_DISPONIBILE };
  if (lettura.esito === "errore") return { error: MESSAGGIO_LETTURA_NON_RIUSCITA };
  if (lettura.esito === "assente") return { error: "Non hai un Ufficio Gare." };

  // Si chiude prima l'accesso ai dati, così anche una sessione ancora aperta non vede più nulla se l'eliminazione si ferma a metà.
  const { error: erroreSospensione } = await admin.from("omnia_ai_membri").update({ attivo: false }).eq("membro_id", lettura.ufficio.membroId).eq("titolare_id", contesto.accountId);
  if (erroreSospensione) {
    console.error("Ufficio Gare: chiusura dell'accesso prima della rimozione non riuscita", erroreSospensione.message);
    return { error: "Rimozione non riuscita. Riprova tra qualche istante." };
  }

  const { error } = await admin.auth.admin.deleteUser(lettura.ufficio.membroId);
  if (error) {
    console.error("Ufficio Gare: eliminazione dell'utente non riuscita", error.message);
    revalidatePath(PAGINA);
    return { error: "Rimozione non riuscita: l'accesso resta sospeso. Riprova tra qualche istante." };
  }

  revalidatePath(PAGINA);
  return { success: "Ufficio Gare rimosso. Le gare e i documenti restano della tua azienda." };
}
