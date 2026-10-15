"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email";
import { BASE_URL } from "@/lib/zone";
import { PIANI, normalizzaPianoSlug } from "@/lib/omnia-ai-plans";
import { richiediAdminAzione } from "@/lib/console/accesso";
import { testoPerEmail } from "@/lib/html";
import { aggiungiGiorni, mezzanotteRoma } from "@/lib/console/periodo";
import { abbonamentiDaAnnullareSuStripe, eAnonimizzato, messaggioAbbonamentoDaAnnullare } from "@/lib/console/utenti-calcoli";
import { schemaAssente } from "@/lib/omnia-ai-incassi";
import { MESSAGGIO_CONTROLLO_UFFICIO_GARE_NON_RIUSCITO, MESSAGGIO_E_UN_UFFICIO_GARE, leggiMembroDelTitolare, leggiTitolareDelMembro } from "@/lib/console/ufficio-gare";

// Azioni sulla scheda cliente: rispondere, abbonamento a mano, eliminare e anonimizzare.
// Ognuna parte da richiediAdminAzione(). Spostate dal vecchio pannello admin
// dell'e-commerce, con qualche protezione in più (vedi i commenti di ciascuna).

export type StatoAzioneUtente = { errore?: string; ok?: boolean; avviso?: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GIORNO = /^\d{4}-\d{2}-\d{2}$/;
const STATI_ABBONAMENTO = ["attivo", "scaduto", "annullato"];
const LUNGHEZZA_MASSIMA_MESSAGGIO = 4000;

function ricarica() {
  revalidatePath("/site-console", "layout");
}

// ───── Risposta al cliente ─────

export async function rispondiAlCliente(_stato: StatoAzioneUtente, formData: FormData): Promise<StatoAzioneUtente> {
  const sessione = await richiediAdminAzione();
  if (!sessione) return { errore: "Non autorizzato." };

  const userId = String(formData.get("userId") ?? "");
  const testo = String(formData.get("body") ?? "").trim();
  if (!UUID.test(userId)) return { errore: "Utente non valido." };
  if (!testo) return { errore: "Scrivi un messaggio prima di inviare." };
  if (testo.length > LUNGHEZZA_MASSIMA_MESSAGGIO) return { errore: `Il messaggio è troppo lungo (massimo ${LUNGHEZZA_MASSIMA_MESSAGGIO} caratteri).` };

  const admin = createAdminClient();
  const { data: cliente } = await admin.from("users").select("email").eq("id", userId).maybeSingle<{ email: string }>();
  if (!cliente) return { errore: "Utente non trovato." };
  if (eAnonimizzato(cliente.email)) return { errore: "L'account è anonimizzato: non c'è nessuno a cui rispondere." };

  const { error } = await admin.from("messages").insert({ user_id: userId, sender: "admin", body: testo });
  if (error) {
    console.error("Console: invio risposta al cliente fallito", error.message);
    return { errore: "Errore nell'invio del messaggio." };
  }

  // Il testo si neutralizza (era inserito grezzo nelle email del vecchio pannello).
  const inviata = await sendEmail({
    to: cliente.email,
    subject: "Nuova risposta da OMNIA",
    html: `<p>Hai ricevuto una risposta alla tua richiesta:</p><p>${testoPerEmail(testo)}</p><p><a href="${BASE_URL}/dashboard/messaggi">Vai alla conversazione</a></p>`,
  });

  ricarica();
  return inviata ? { ok: true } : { ok: true, avviso: "Messaggio salvato, ma l'email di avviso al cliente NON è partita: lo troverà comunque nella sua area riservata." };
}

// ───── Abbonamento a mano ─────

// Fine di una giornata a Roma: «valido fino al 31/12» vuol dire fino alla mezzanotte
// che chiude il 31, non fino all'inizio di quel giorno.
function fineGiornata(giorno: string): string {
  return mezzanotteRoma(aggiungiGiorni(giorno, 1)).toISOString();
}

// Crea o aggiorna l'abbonamento di un cliente SENZA passare da Stripe (es. un
// accordo commerciale, una prova concessa). Modifica solo una riga creata a mano:
// se l'ultimo abbonamento è gestito da Stripe (il cliente paga con carta) il
// modulo non vale, perché cambiarne stato o scadenza dal database lo farebbe
// divergere da quello che Stripe addebita davvero.
export async function impostaAbbonamentoManuale(_stato: StatoAzioneUtente, formData: FormData): Promise<StatoAzioneUtente> {
  const sessione = await richiediAdminAzione();
  if (!sessione) return { errore: "Non autorizzato." };

  const userId = String(formData.get("userId") ?? "");
  const piano = normalizzaPianoSlug(String(formData.get("plan") ?? ""));
  const stato = String(formData.get("status") ?? "");
  const fine = String(formData.get("currentPeriodEnd") ?? "").trim();

  if (!UUID.test(userId)) return { errore: "Utente non valido." };
  if (!piano || !(piano in PIANI)) return { errore: "Scegli uno dei piani del catalogo." };
  if (!STATI_ABBONAMENTO.includes(stato)) return { errore: "Stato non valido." };
  if (fine !== "" && (!GIORNO.test(fine) || Number.isNaN(Date.parse(`${fine}T00:00:00Z`)))) return { errore: "Data di scadenza non valida." };

  const admin = createAdminClient();
  const { data: utente } = await admin.from("users").select("id").eq("id", userId).maybeSingle();
  if (!utente) return { errore: "Utente non trovato." };

  // Un Ufficio Gare non ha un abbonamento suo (lavora su quello del titolare): crearne uno a suo nome lo farebbe diventare un secondo cliente.
  const titolareDelMembro = await leggiTitolareDelMembro(userId, admin);
  if (titolareDelMembro === "errore") return { errore: MESSAGGIO_CONTROLLO_UFFICIO_GARE_NON_RIUSCITO };
  if (titolareDelMembro) return { errore: MESSAGGIO_E_UN_UFFICIO_GARE };

  const { data: ultima } = await admin
    .from("subscriptions")
    .select("id, stripe_subscription_id")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string; stripe_subscription_id: string | null }>();

  if (ultima?.stripe_subscription_id) {
    return { errore: "L'abbonamento di questo cliente è gestito da Stripe: modificalo da Stripe, non da qui." };
  }

  const valori = { user_id: userId, plan: piano, status: stato, current_period_end: fine === "" ? null : fineGiornata(fine) };
  const { error } = ultima ? await admin.from("subscriptions").update(valori).eq("id", ultima.id) : await admin.from("subscriptions").insert(valori);
  if (error) {
    console.error("Console: salvataggio abbonamento a mano fallito", error.message);
    return { errore: "Errore nel salvataggio dell'abbonamento." };
  }

  ricarica();
  return { ok: true };
}

// ───── Eliminazione e anonimizzazione ─────

type Bersaglio = { id: string; email: string; role: string };

// Controlli comuni: utente valido, non sé stessi, non un altro admin.
async function leggiBersaglio(userId: string, sessioneId: string, verbo: string): Promise<Bersaglio | string> {
  if (!UUID.test(userId)) return "Utente non valido.";
  if (userId === sessioneId) return `Non puoi ${verbo} il tuo stesso account.`;
  const { data } = await createAdminClient().from("users").select("id, email, role").eq("id", userId).maybeSingle<Bersaglio>();
  if (!data) return "Utente non trovato.";
  if (data.role === "admin") return `Non puoi ${verbo} un altro amministratore da qui.`;
  return data;
}

// Rifiuta (restituisce il messaggio) se l'utente ha un abbonamento Stripe non annullato
// e non di prova: eliminare o anonimizzare dal database non lo annulla su Stripe e il
// cliente continuerebbe a pagare. La console non chiama Stripe: l'abbonamento si annulla
// da Stripe e poi si torna qui. Da chiamare PRIMA di qualunque scrittura.
async function controllaAbbonamentiStripe(userId: string, verbo: string): Promise<string | null> {
  const admin = createAdminClient();
  const base = "plan, status, stripe_subscription_id";
  const lettura = (colonne: string) => admin.from("subscriptions").select(colonne).eq("user_id", userId).not("stripe_subscription_id", "is", null);

  type Riga = { plan: string; status: string; stripe_subscription_id: string | null; livemode?: boolean | null };
  let risposta = await lettura(`${base}, livemode`);
  let colonnaDisponibile = true;
  if (schemaAssente(risposta.error)) {
    // migrazione 0078 non eseguita: non si sa quali siano di prova, e nel dubbio si rifiuta
    colonnaDisponibile = false;
    risposta = await lettura(base);
  }
  if (risposta.error) {
    console.error("Console: controllo degli abbonamenti Stripe fallito", risposta.error.message);
    return "Controllo dell'abbonamento Stripe non riuscito: l'account non è stato toccato.";
  }

  const righe = ((risposta.data ?? []) as unknown as Riga[]).map((r) => ({ ...r, livemode: colonnaDisponibile ? (r.livemode ?? null) : null }));
  const daAnnullare = abbonamentiDaAnnullareSuStripe(righe);
  return daAnnullare.length > 0 ? messaggioAbbonamentoDaAnnullare(daAnnullare, verbo) : null;
}

// Elimina l'account e a cascata ordini e fatture. In più rispetto al vecchio
// pannello: rifiuta se ha un abbonamento Stripe non annullato (vedi
// controllaAbbonamentiStripe) e se ci sono DATI CONTABILI veri (ordini pagati,
// incassi di abbonamenti reali, crediti acquistati davvero), che si cancellerebbero
// a cascata insieme all'utente e che vanno conservati: in quel caso si anonimizza.
export async function eliminaUtente(_stato: StatoAzioneUtente, formData: FormData): Promise<StatoAzioneUtente> {
  const sessione = await richiediAdminAzione();
  if (!sessione) return { errore: "Non autorizzato." };

  const bersaglio = await leggiBersaglio(String(formData.get("userId") ?? ""), sessione.userId, "eliminare");
  if (typeof bersaglio === "string") return { errore: bersaglio };

  const abbonamentoStripe = await controllaAbbonamentiStripe(bersaglio.id, "eliminare");
  if (abbonamentoStripe) return { errore: abbonamentoStripe };

  const admin = createAdminClient();

  // L'Ufficio Gare di questo cliente (se c'è) va eliminato insieme a lui: la cascata del database toglie il legame ma
  // NON l'utente, che resterebbe in giro come un account orfano. Lo si cerca PRIMA (dopo, il legame non c'è più).
  const membroDelTitolare = await leggiMembroDelTitolare(bersaglio.id, admin);
  if (membroDelTitolare === "errore") return { errore: MESSAGGIO_CONTROLLO_UFFICIO_GARE_NON_RIUSCITO };

  const [ordiniPagati, incassiReali, creditiReali, revisioniReali] = await Promise.all([
    admin.from("orders").select("id", { count: "exact", head: true }).eq("user_id", bersaglio.id).eq("status", "pagato"),
    admin.from("omnia_ai_incassi").select("id", { count: "exact", head: true }).eq("user_id", bersaglio.id).eq("livemode", true),
    admin.from("omnia_ai_credit_purchases").select("id", { count: "exact", head: true }).eq("user_id", bersaglio.id).not("stripe_session_id", "like", "cs_test_%"),
    admin.from("omnia_ai_revisioni").select("id", { count: "exact", head: true }).eq("user_id", bersaglio.id).eq("stato", "pagata").eq("livemode", true),
  ]);
  // la tabella degli incassi può non esistere ancora: in quel caso non c'è nulla da proteggere lì
  const conteggio = (ordiniPagati.count ?? 0) + (incassiReali.error ? 0 : (incassiReali.count ?? 0)) + (creditiReali.error ? 0 : (creditiReali.count ?? 0)) + (revisioniReali.error ? 0 : (revisioniReali.count ?? 0));
  if (ordiniPagati.error) return { errore: "Controllo dei dati contabili non riuscito: l'account non è stato toccato." };
  if (conteggio > 0) {
    return { errore: "Questo cliente ha ordini pagati o incassi registrati: eliminarlo cancellerebbe anche quei dati contabili, che vanno conservati. Usa «Anonimizza»." };
  }

  // I file delle fatture stanno nello storage: la cascata del database non li toglie.
  const { data: ordini } = await admin.from("orders").select("invoices(file_path)").eq("user_id", bersaglio.id);
  const percorsi = ((ordini ?? []) as unknown as { invoices: { file_path: string } | null }[]).map((o) => o.invoices?.file_path).filter((p): p is string => Boolean(p));

  const { error } = await admin.auth.admin.deleteUser(bersaglio.id);
  if (error) {
    console.error("Console: eliminazione utente fallita", error.message);
    // le accettazioni contrattuali bloccano la cascata di proposito (on delete restrict)
    if (/foreign key|violat/i.test(error.message)) {
      return { errore: "Impossibile eliminare: il cliente ha accettazioni contrattuali registrate, che per obbligo di legge non si cancellano. Usa «Anonimizza»." };
    }
    return { errore: "Errore nell'eliminazione dell'utente." };
  }

  if (percorsi.length > 0) await admin.storage.from("invoices").remove(percorsi);

  // Solo ora che il titolare è stato eliminato si toglie il suo Ufficio Gare (se il titolare non si fosse potuto eliminare, non si tocca nulla).
  if (membroDelTitolare) {
    const { error: erroreMembro } = await admin.auth.admin.deleteUser(membroDelTitolare);
    if (erroreMembro) {
      console.error("Console: eliminazione dell'Ufficio Gare del cliente eliminato fallita", membroDelTitolare, erroreMembro.message);
      ricarica();
      return { errore: `Il cliente è stato eliminato, ma il suo Ufficio Gare (id ${membroDelTitolare}) NO: eliminalo dall'elenco utenti.` };
    }
  }

  ricarica();
  redirect("/utenti?esito=eliminato");
}

// Alternativa all'eliminazione per chi ha dati che vanno conservati: l'account diventa
// irriconoscibile (email sostituita con un indirizzo ".invalid", password casuale, accesso
// bloccato, dati di fatturazione tolti) ma ordini, fatture e accettazioni restano.
export async function anonimizzaUtente(_stato: StatoAzioneUtente, formData: FormData): Promise<StatoAzioneUtente> {
  const sessione = await richiediAdminAzione();
  if (!sessione) return { errore: "Non autorizzato." };

  const bersaglio = await leggiBersaglio(String(formData.get("userId") ?? ""), sessione.userId, "anonimizzare");
  if (typeof bersaglio === "string") return { errore: bersaglio };
  if (eAnonimizzato(bersaglio.email)) return { errore: "L'account è già anonimizzato." };

  const abbonamentoStripe = await controllaAbbonamentiStripe(bersaglio.id, "anonimizzare");
  if (abbonamentoStripe) return { errore: abbonamentoStripe };

  const admin = createAdminClient();

  // Anche qui l'Ufficio Gare del cliente non deve restare con l'accesso ai dati di un account anonimizzato.
  const membroDelTitolare = await leggiMembroDelTitolare(bersaglio.id, admin);
  if (membroDelTitolare === "errore") return { errore: MESSAGGIO_CONTROLLO_UFFICIO_GARE_NON_RIUSCITO };

  const emailAnonima = `cliente-anonimizzato-${bersaglio.id.slice(0, 8)}@omniaitalia.invalid`;

  const { error: erroreAuth } = await admin.auth.admin.updateUserById(bersaglio.id, {
    email: emailAnonima,
    password: `${randomUUID()}${randomUUID()}`,
    email_confirm: true,
    ban_duration: "876000h",
    user_metadata: {},
  });
  if (erroreAuth) {
    console.error("Console: anonimizzazione dell'account fallita", erroreAuth.message);
    return { errore: "Errore nell'anonimizzazione dell'account." };
  }

  const { error: erroreProfilo } = await admin.from("users").update({ email: emailAnonima }).eq("id", bersaglio.id);
  if (erroreProfilo) {
    console.error("Console: anonimizzazione del profilo fallita", erroreProfilo.message);
    return { errore: "Errore nell'anonimizzazione del profilo." };
  }

  // Ragione sociale, partita IVA o codice fiscale, indirizzo, SDI e PEC sono l'unico
  // dato identificativo oltre all'email. Ordini, fatture e accettazioni restano.
  const { error: erroreAzienda } = await admin.from("companies").delete().eq("user_id", bersaglio.id);
  if (erroreAzienda) {
    console.error("Console: rimozione dei dati di fatturazione fallita", erroreAzienda.message);
    return { errore: "Errore nella rimozione dei dati di fatturazione." };
  }

  if (membroDelTitolare) {
    const { error: erroreMembro } = await admin.auth.admin.deleteUser(membroDelTitolare);
    if (erroreMembro) {
      console.error("Console: eliminazione dell'Ufficio Gare del cliente anonimizzato fallita", membroDelTitolare, erroreMembro.message);
      ricarica();
      return { errore: `Il cliente è stato anonimizzato, ma il suo Ufficio Gare (id ${membroDelTitolare}) NON è stato eliminato: eliminalo dall'elenco utenti.` };
    }
  }

  ricarica();
  redirect("/utenti?esito=anonimizzato");
}
