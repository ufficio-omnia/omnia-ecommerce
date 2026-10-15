import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ErroreContestoAccount, risolviContestoAccount, type ContestoAccount } from "@/lib/omnia-ai-account";
import {
  MESSAGGIO_UFFICIO_GARE_NON_AUTORIZZATO,
  MESSAGGIO_UFFICIO_GARE_SOSPESO,
  MESSAGGIO_UFFICIO_GARE_VERIFICA_NON_RIUSCITA,
  RADICE_AREA,
} from "@/lib/omnia-ai-account-calcoli";

// Le guardie dell'area riservata di OMNIA AI. Regola: ogni pagina e ogni azione AMMINISTRATIVA (abbonamento,
// pagamenti, fatture, profilo azienda, documenti, impostazioni, acquisti) parte da una di queste due guardie del
// titolare, perché l'Ufficio Gare non deve poterle usare nemmeno scrivendo l'indirizzo a mano o richiamando
// l'azione da fuori. La barra laterale che nasconde le voci è solo cortesia: il controllo vero è qui.
// Le pagine e le azioni del LAVORO DI GARA (aperte a entrambi) usano invece leggiSessioneAccount.
// Lo scritto sotto è provato da scripts/verifica-ufficio-gare-omnia-ai.ts, che scorre ogni pagina e ogni azione.

export type SessioneAccount = { user: User; contesto: ContestoAccount };

// Chi è loggato e di che account è. null = nessuna sessione. Solleva ErroreContestoAccount se il ruolo non si
// riesce a verificare (mai «titolare» per difetto).
export async function leggiSessioneAccount(): Promise<SessioneAccount | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  // La chiave di servizio, non la sessione dell'utente: la ricerca del ruolo non deve dipendere dalle regole di accesso.
  const contesto = await risolviContestoAccount(user.id, createAdminClient());
  return { user, contesto };
}

export type EsitoGuardiaAzione = { ok: true; user: User; contesto: ContestoAccount } | { ok: false; errore: string };

// Per le azioni amministrative: solo il titolare. L'errore è un testo da mostrare, mai un'eccezione.
export async function richiediTitolareAzione(): Promise<EsitoGuardiaAzione> {
  let sessione: SessioneAccount | null;
  try {
    sessione = await leggiSessioneAccount();
  } catch (e) {
    if (e instanceof ErroreContestoAccount) return { ok: false, errore: MESSAGGIO_UFFICIO_GARE_VERIFICA_NON_RIUSCITA };
    throw e;
  }
  if (!sessione) return { ok: false, errore: "Sessione scaduta, ricarica la pagina." };
  if (sessione.contesto.ruolo !== "titolare") return { ok: false, errore: MESSAGGIO_UFFICIO_GARE_NON_AUTORIZZATO };
  return { ok: true, user: sessione.user, contesto: sessione.contesto };
}

// Per le pagine amministrative: senza sessione porta al login, all'Ufficio Gare alla dashboard (l'unica pagina
// che gli spetta insieme alle gare). null se il ruolo non si riesce a verificare: la pagina mostra un invito a riprovare.
export async function richiediTitolarePagina(): Promise<SessioneAccount | null> {
  let sessione: SessioneAccount | null;
  try {
    sessione = await leggiSessioneAccount();
  } catch (e) {
    if (e instanceof ErroreContestoAccount) return null;
    throw e;
  }
  if (!sessione) redirect("/login");
  if (sessione.contesto.ruolo !== "titolare") redirect(RADICE_AREA);
  return sessione;
}

// ───── il lavoro di gara: aperto al titolare e all'Ufficio Gare ─────
//
// Chi lavora sulle gare (gare, documenti, chat, analisi, relazione, download) può essere il titolare o il suo
// Ufficio Gare. In entrambi i casi i dati sono del TITOLARE: da qui in poi il codice usa contesto.accountId
// (mai user.id) per ogni dato dell'azienda. Un Ufficio Gare sospeso non lavora su nulla.

// Per le azioni del lavoro di gara. L'errore è un testo da mostrare, mai un'eccezione.
export async function richiediAccountAzione(): Promise<EsitoGuardiaAzione> {
  let sessione: SessioneAccount | null;
  try {
    sessione = await leggiSessioneAccount();
  } catch (e) {
    if (e instanceof ErroreContestoAccount) return { ok: false, errore: MESSAGGIO_UFFICIO_GARE_VERIFICA_NON_RIUSCITA };
    throw e;
  }
  if (!sessione) return { ok: false, errore: "Sessione scaduta, ricarica la pagina." };
  if (sessione.contesto.sospeso) return { ok: false, errore: MESSAGGIO_UFFICIO_GARE_SOSPESO };
  return { ok: true, user: sessione.user, contesto: sessione.contesto };
}

// Per le pagine del lavoro di gara: senza sessione porta al login; null se il ruolo non si riesce a verificare o
// l'Ufficio Gare è sospeso (la pagina non mostra nulla: il riquadro che spiega il perché lo mette il layout).
export async function richiediAccountPagina(): Promise<SessioneAccount | null> {
  let sessione: SessioneAccount | null;
  try {
    sessione = await leggiSessioneAccount();
  } catch (e) {
    if (e instanceof ErroreContestoAccount) return null;
    throw e;
  }
  if (!sessione) redirect("/login");
  if (sessione.contesto.sospeso) return null;
  return sessione;
}
