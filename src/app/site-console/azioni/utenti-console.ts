"use server";

import { randomBytes } from "crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { richiediAdminAzione } from "@/lib/console/accesso";
import { MESSAGGIO_PASSWORD_GIA_CONSEGNATA, resetPasswordPermesso, statoPasswordCliente, testoEmailResetPassword, validaNuovoUtente } from "@/lib/console/utenti-console-calcoli";
import type { StatoAzione } from "./ordini";
import { sendEmail } from "@/lib/email";
import { escapeHtml } from "@/lib/html";
import { OMNIA_AI_BASE_URL } from "@/lib/zone";
import { applicaVariazione } from "@/lib/omnia-ai-gare-gratuite";
import { schemaAssente } from "@/lib/omnia-ai-incassi";

// Clienti creati dalla console e gare gratuite (migrazione 0084). Ogni azione parte da
// richiediAdminAzione(). La password iniziale la sceglie l'amministratore e passa SOLO da qui
// a Supabase Auth (che ne conserva l'impronta): non viene scritta in nessuna tabella né nel log.

export type StatoUtenteConsole = { errore?: string; ok?: boolean; avviso?: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function creaUtenteDaConsole(_stato: StatoUtenteConsole, formData: FormData): Promise<StatoUtenteConsole> {
  const sessione = await richiediAdminAzione();
  if (!sessione) return { errore: "Non autorizzato." };

  const esito = validaNuovoUtente({
    email: String(formData.get("email") ?? ""),
    password: String(formData.get("password") ?? ""),
    gare: String(formData.get("gare") ?? ""),
  });
  if (!esito.ok) return { errore: esito.errore };
  const { email, password, gare } = esito.valori;

  const admin = createAdminClient();

  // Le tabelle della migrazione 0084 si controllano PRIMA di creare l'utente: crearlo e poi
  // scoprire che manca dove registrarlo lascerebbe un account a metà.
  const sonda = await admin.from("omnia_ai_utenti_console").select("user_id", { count: "exact", head: true });
  if (sonda.error) {
    if (schemaAssente(sonda.error)) return { errore: "Le tabelle per gli utenti creati dalla console non esistono ancora (migrazione 0084): nessun utente creato." };
    console.error("Console: controllo tabelle utenti_console fallito", sonda.error.message);
    return { errore: "Controllo preliminare non riuscito: nessun utente creato." };
  }

  const { data: esistente } = await admin.from("users").select("id").eq("email", email).maybeSingle<{ id: string }>();
  if (esistente) return { errore: "Esiste già un utente con questa email." };

  // email_confirm: l'indirizzo lo indica l'amministratore, non serve il link di conferma
  const { data: creato, error: erroreCreazione } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (erroreCreazione || !creato.user) {
    console.error("Console: creazione utente fallita", erroreCreazione?.message);
    return { errore: /already|registered|exists/i.test(erroreCreazione?.message ?? "") ? "Esiste già un utente con questa email." : "Creazione dell'utente non riuscita." };
  }
  const id = creato.user.id;

  // La riga in public.users la crea un trigger sull'inserimento in auth.users. Da qui in poi,
  // se un passo fallisce, l'utente appena creato si cancella: mai un account a metà.
  const annulla = async (messaggio: string) => {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) console.error("Console: rimozione dell'utente appena creato fallita", id, error.message);
    return { errore: messaggio + (error ? " ATTENZIONE: l'utente appena creato non si è cancellato da solo, controlla l'elenco utenti." : " L'utente non è stato creato.") };
  };

  const { error: erroreGestione } = await admin.from("omnia_ai_utenti_console").insert({ user_id: id, creato_da_email: sessione.email });
  if (erroreGestione) {
    console.error("Console: registrazione utente creato da console fallita", erroreGestione.message);
    return annulla("Registrazione dell'utente non riuscita.");
  }

  if (gare > 0) {
    const { error: erroreGare } = await admin.from("omnia_ai_gare_gratuite").insert({ user_id: id, assegnate: gare, usate: 0 });
    if (erroreGare) {
      console.error("Console: assegnazione gare gratuite fallita", erroreGare.message);
      return annulla("Assegnazione delle gare gratuite non riuscita.");
    }
    const { error: erroreLog } = await admin.from("omnia_ai_gare_gratuite_log").insert({ user_id: id, delta: gare, motivo: "Assegnate alla creazione dell'utente", operatore_email: sessione.email });
    if (erroreLog) console.error("Console: registro gare gratuite non scritto", erroreLog.message);
  }

  revalidatePath("/site-console", "layout");
  redirect(`/utenti/${id}?esito=utente_creato`);
}

// Assegna (delta > 0) o toglie (delta < 0) gare gratuite a un cliente che non ha mai avuto un
// abbonamento. Non si scende sotto le gare già usate. Ogni variazione lascia una riga nel registro.
export async function modificaGareGratuite(_stato: StatoUtenteConsole, formData: FormData): Promise<StatoUtenteConsole> {
  const sessione = await richiediAdminAzione();
  if (!sessione) return { errore: "Non autorizzato." };

  const userId = String(formData.get("userId") ?? "");
  if (!UUID.test(userId)) return { errore: "Utente non valido." };
  const delta = Number(String(formData.get("delta") ?? "").trim());
  const motivo = String(formData.get("motivo") ?? "").trim().slice(0, 300);

  const admin = createAdminClient();

  const { data: utente } = await admin.from("users").select("id, role").eq("id", userId).maybeSingle<{ id: string; role: string }>();
  if (!utente) return { errore: "Utente non trovato." };
  if (utente.role === "admin") return { errore: "È un amministratore: non ha gare gratuite." };

  const { count: abbonamenti } = await admin.from("subscriptions").select("id", { count: "exact", head: true }).eq("user_id", userId);
  if ((abbonamenti ?? 0) > 0) return { errore: "Questo cliente ha avuto un abbonamento: le gare gratuite servono solo alla prova, prima del primo abbonamento." };

  const { data: attuale, error: erroreLettura } = await admin.from("omnia_ai_gare_gratuite").select("assegnate, usate").eq("user_id", userId).maybeSingle<{ assegnate: number; usate: number }>();
  if (erroreLettura) {
    if (schemaAssente(erroreLettura)) return { errore: "Le tabelle delle gare gratuite non esistono ancora (migrazione 0084)." };
    console.error("Console: lettura gare gratuite fallita", erroreLettura.message);
    return { errore: "Lettura delle gare gratuite non riuscita." };
  }

  const variazione = applicaVariazione(attuale, delta);
  if ("errore" in variazione) return { errore: variazione.errore };

  // Guardia contro due modifiche contemporanee: l'aggiornamento vale solo se il contatore è ancora quello letto.
  const adesso = new Date().toISOString();
  if (attuale) {
    const { data: aggiornate, error } = await admin
      .from("omnia_ai_gare_gratuite")
      .update({ assegnate: variazione.assegnate, aggiornato_il: adesso })
      .eq("user_id", userId)
      .eq("assegnate", attuale.assegnate)
      .eq("usate", attuale.usate)
      .select("user_id");
    if (error) {
      console.error("Console: aggiornamento gare gratuite fallito", error.message);
      return { errore: "Aggiornamento non riuscito." };
    }
    if (!aggiornate || aggiornate.length === 0) return { errore: "Il contatore è cambiato nel frattempo (il cliente ha appena usato una gara?): ricarica la pagina e riprova." };
  } else {
    const { error } = await admin.from("omnia_ai_gare_gratuite").insert({ user_id: userId, assegnate: variazione.assegnate, usate: 0 });
    if (error) {
      console.error("Console: assegnazione gare gratuite fallita", error.message);
      return { errore: "Assegnazione non riuscita." };
    }
  }

  const { error: erroreLog } = await admin.from("omnia_ai_gare_gratuite_log").insert({ user_id: userId, delta, motivo: motivo === "" ? null : motivo, operatore_email: sessione.email });
  if (erroreLog) console.error("Console: registro gare gratuite non scritto", erroreLog.message);

  revalidatePath("/site-console", "layout");
  return { ok: true, ...(erroreLog ? { avviso: "Modifica fatta, ma il movimento non è stato scritto nel registro." } : {}) };
}

// ───── Reset della password e consegna al cliente ─────
//
// L'unica azione che la console ha sulla password di un cliente creato da lei: azzera la password
// iniziale (la sostituisce con una casuale che nessuno conosce, nemmeno il server la conserva) e
// manda al cliente un'email con il link per sceglierne una sua. Si può ripetere (per rinviare
// l'email) finché il cliente non ha scelto la sua password; da quel momento il server rifiuta, qualunque
// cosa mostri l'interfaccia. Il link non viene mai mostrato né scritto nel log: va solo nell'email.
export async function resetPasswordCliente(_stato: StatoAzione, formData: FormData): Promise<StatoAzione> {
  const sessione = await richiediAdminAzione();
  if (!sessione) return { errore: "Non autorizzato." };

  const userId = String(formData.get("userId") ?? "");
  if (!UUID.test(userId)) return { errore: "Utente non valido." };

  const admin = createAdminClient();

  const { data: utente } = await admin.from("users").select("id, email, role").eq("id", userId).maybeSingle<{ id: string; email: string; role: string }>();
  if (!utente) return { errore: "Utente non trovato." };
  if (utente.role !== "cliente") return { errore: "La password si azzera solo ai clienti." };

  const { data: riga, error: erroreRiga } = await admin
    .from("omnia_ai_utenti_console")
    .select("reset_richiesto_il, password_consegnata_il")
    .eq("user_id", userId)
    .maybeSingle<{ reset_richiesto_il: string | null; password_consegnata_il: string | null }>();
  if (erroreRiga) {
    if (schemaAssente(erroreRiga)) return { errore: "Le tabelle degli utenti creati dalla console non esistono ancora (migrazione 0084)." };
    console.error("Console: lettura utente da console fallita", erroreRiga.message);
    return { errore: "Lettura non riuscita." };
  }
  if (!riga) return { errore: "Questo cliente non è stato creato dalla console: non puoi azzerargli la password da qui." };

  // Il controllo che conta: sul server, non sul pulsante.
  const stato = statoPasswordCliente({ resetRichiestoIl: riga.reset_richiesto_il, passwordConsegnataIl: riga.password_consegnata_il });
  if (!resetPasswordPermesso(stato)) return { errore: MESSAGGIO_PASSWORD_GIA_CONSEGNATA };

  // 1) La password iniziale smette di funzionare: ne prende il posto una casuale, mai mostrata né salvata.
  //    Si fa PRIMA di generare il link, così nessuna operazione sull'utente può invalidarlo.
  const casuale = `${randomBytes(32).toString("base64url")}Aa1!`;
  const { error: errorePassword } = await admin.auth.admin.updateUserById(userId, { password: casuale });
  if (errorePassword) {
    console.error("Console: azzeramento della password fallito", errorePassword.message);
    return { errore: "Non sono riuscito ad azzerare la password: non è cambiato nulla." };
  }

  // 2) Link per scegliere la nuova password: stesso meccanismo dell'attivazione dell'account
  //    (token_hash verificato dalla pagina /attiva-account), mai un link che passa dalla console.
  const { data: link, error: erroreLink } = await admin.auth.admin.generateLink({ type: "magiclink", email: utente.email });
  const token = link?.properties?.hashed_token;
  if (erroreLink || !token) {
    console.error("Console: generazione del link di scelta password fallita", erroreLink?.message);
    return { errore: "La password iniziale è stata azzerata ma il link non è stato generato: premi di nuovo «Reset password» per riprovare." };
  }
  const url = `${OMNIA_AI_BASE_URL}/attiva-account?token_hash=${encodeURIComponent(token)}&type=magiclink&next=${encodeURIComponent("/imposta-password")}`;

  const { error: erroreAggiornamento } = await admin.from("omnia_ai_utenti_console").update({ reset_richiesto_il: new Date().toISOString() }).eq("user_id", userId);
  if (erroreAggiornamento) console.error("Console: reset_richiesto_il non registrato", erroreAggiornamento.message);

  // 3) L'email al cliente.
  const email = testoEmailResetPassword(url, escapeHtml);
  const inviata = await sendEmail({ to: utente.email, from: "OMNIA AI <noreply@omniaitalia.com>", subject: email.oggetto, html: email.html });

  revalidatePath("/site-console", "layout");
  if (!inviata) return { errore: "La password è stata azzerata ma l'email NON è partita: premi di nuovo «Reset password» per rinviarla." };
  return {};
}
