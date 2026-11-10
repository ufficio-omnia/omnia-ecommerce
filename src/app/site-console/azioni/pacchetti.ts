"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { richiediAdminAzione } from "@/lib/console/accesso";
import { MESSAGGIO_CONTROLLO_UFFICIO_GARE_NON_RIUSCITO, MESSAGGIO_E_UN_UFFICIO_GARE, leggiTitolareDelMembro } from "@/lib/console/ufficio-gare";
import { giornoRoma } from "@/lib/omnia-ai-catalogo-calcoli";
import { creaOffertaDedicata, rettificaPacchetti, revocaOffertaDedicata } from "@/lib/pacchetti-servizi";
import { SERVIZI, eServizioPacchetto, validaNuovaOfferta } from "@/lib/pacchetti-servizi-calcoli";

// Pacchetti prepagati di servizi aggiuntivi, dalla console: aggiungere o correggere le unità di un cliente (un regalo è una rettifica positiva con un
// motivo) e creare o revocare le OFFERTE DEDICATE (pacchetti privati, a prezzo e quantità decisi qui, che vede solo quel cliente). Ogni azione parte da
// richiediAdminAzione(). La variazione la fa una funzione SQL (migrazione 0104) che mette il registro e il saldo
// nella stessa transazione e non lascia scendere il saldo sotto zero. Le unità si perdono comunque alla cessazione dell'abbonamento, come i crediti.

export type StatoPacchettiConsole = { errore?: string; ok?: boolean; avviso?: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VARIAZIONE_MASSIMA = 1000;

export async function rettificaPacchettiCliente(_stato: StatoPacchettiConsole, formData: FormData): Promise<StatoPacchettiConsole> {
  const sessione = await richiediAdminAzione();
  if (!sessione) return { errore: "Non autorizzato." };

  const userId = String(formData.get("userId") ?? "");
  if (!UUID.test(userId)) return { errore: "Cliente non valido." };

  const servizio = formData.get("servizio");
  if (!eServizioPacchetto(servizio)) return { errore: "Servizio non valido." };
  if (!SERVIZI[servizio].disponibile) return { errore: `${SERVIZI[servizio].nome} non è ancora disponibile: non ci sono unità da assegnare.` };

  // la variazione è un intero, positivo (aggiunge) o negativo (toglie), mai zero
  const variazioneTesto = String(formData.get("delta") ?? "").trim();
  if (!/^[+-]?\d{1,4}$/.test(variazioneTesto)) return { errore: "Scrivi un numero intero di unità: positivo per aggiungere (es. 2), negativo per togliere (es. -1)." };
  const delta = Number(variazioneTesto);
  if (delta === 0) return { errore: "La variazione non può essere zero." };
  if (Math.abs(delta) > VARIAZIONE_MASSIMA) return { errore: `La variazione non può superare ${VARIAZIONE_MASSIMA} unità.` };

  // il motivo è obbligatorio: resta nel registro dei movimenti insieme a chi ha fatto la rettifica
  const motivo = String(formData.get("motivo") ?? "").trim();
  if (motivo.length < 2) return { errore: "Scrivi il motivo (almeno due caratteri): resta nel registro dei movimenti." };
  if (motivo.length > 300) return { errore: "Il motivo è troppo lungo (massimo 300 caratteri)." };

  const admin = createAdminClient();

  // le unità sono del titolare: a un Ufficio Gare non si assegnano, e se il controllo non riesce non si tocca nulla
  const titolareDelMembro = await leggiTitolareDelMembro(userId, admin);
  if (titolareDelMembro === "errore") return { errore: MESSAGGIO_CONTROLLO_UFFICIO_GARE_NON_RIUSCITO };
  if (titolareDelMembro) return { errore: MESSAGGIO_E_UN_UFFICIO_GARE };

  const { data: utente, error: erroreUtente } = await admin.from("users").select("id").eq("id", userId).maybeSingle<{ id: string }>();
  if (erroreUtente) {
    console.error("Console: lettura del cliente per la rettifica dei pacchetti fallita", erroreUtente.message);
    return { errore: "Lettura del cliente non riuscita." };
  }
  if (!utente) return { errore: "Cliente non trovato." };

  const esito = await rettificaPacchetti(admin, { userId, servizio, delta, motivo, da: sessione.email });
  if (!esito.ok) return { errore: esito.errore };

  // il nuovo saldo si vede nel pannello, che si aggiorna da solo
  revalidatePath("/site-console", "layout");
  return { ok: true };
}

// Crea un'offerta dedicata: «10 piani di lavoro a 450 €, IVA inclusa, fino al 31/12» riservata a UN cliente (il titolare). La vede solo lui (e il suo
// Ufficio Gare, che con «Acquista» avvisa il titolare), si compra una volta sola, e vale solo con la vendita accesa. Qui non si incassa e non si scrive
// a nessuno: l'offerta compare nell'area del cliente. Il servizio è fisso nella pagina ma si riconvalida qui (validaNuovaOfferta).
export async function creaOffertaDedicataCliente(_stato: StatoPacchettiConsole, formData: FormData): Promise<StatoPacchettiConsole> {
  const sessione = await richiediAdminAzione();
  if (!sessione) return { errore: "Non autorizzato." };

  const esito = validaNuovaOfferta(
    {
      email: String(formData.get("email") ?? ""),
      servizio: String(formData.get("servizio") ?? ""),
      quantita: String(formData.get("quantita") ?? ""),
      prezzoEuro: String(formData.get("prezzo") ?? ""),
      scadeIl: String(formData.get("scadeIl") ?? ""),
      nota: String(formData.get("nota") ?? ""),
    },
    giornoRoma(new Date()),
  );
  if (!esito.ok) return { errore: esito.errore };
  const { valori } = esito;

  const admin = createAdminClient();
  const { data: utente, error: erroreUtente } = await admin.from("users").select("id").eq("email", valori.email).maybeSingle<{ id: string }>();
  if (erroreUtente) {
    console.error("Console: lettura del cliente per l'offerta dedicata fallita", erroreUtente.message);
    return { errore: "Lettura del cliente non riuscita." };
  }
  if (!utente) return { errore: "Nessun cliente con questo indirizzo email." };

  // l'offerta è del titolare: a un Ufficio Gare non si dedica nulla, e se il controllo non riesce non si crea nulla
  const titolareDelMembro = await leggiTitolareDelMembro(utente.id, admin);
  if (titolareDelMembro === "errore") return { errore: MESSAGGIO_CONTROLLO_UFFICIO_GARE_NON_RIUSCITO };
  if (titolareDelMembro) return { errore: MESSAGGIO_E_UN_UFFICIO_GARE };

  const creata = await creaOffertaDedicata(admin, { userId: utente.id, valori, daEmail: sessione.email });
  if (!creata.ok) return { errore: creata.errore };

  revalidatePath("/site-console", "layout");
  return { ok: true };
}

// Revoca un'offerta finché è attiva: sparisce subito dall'area del cliente. Una già comprata non si tocca (le unità sono nel suo saldo).
export async function revocaOffertaDedicataCliente(_stato: StatoPacchettiConsole, formData: FormData): Promise<StatoPacchettiConsole> {
  const sessione = await richiediAdminAzione();
  if (!sessione) return { errore: "Non autorizzato." };

  const id = String(formData.get("id") ?? "");
  if (!UUID.test(id)) return { errore: "Offerta non valida." };

  const esito = await revocaOffertaDedicata(createAdminClient(), id, sessione.email);
  if (esito === "errore") return { errore: "Revoca non riuscita. Riprova." };
  if (esito === "non_attiva") return { errore: "L'offerta non è più attiva (già acquistata o revocata): non c'è nulla da revocare." };

  revalidatePath("/site-console", "layout");
  return { ok: true };
}
