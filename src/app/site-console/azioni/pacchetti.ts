"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { richiediAdminAzione } from "@/lib/console/accesso";
import { MESSAGGIO_CONTROLLO_UFFICIO_GARE_NON_RIUSCITO, MESSAGGIO_E_UN_UFFICIO_GARE, leggiTitolareDelMembro } from "@/lib/console/ufficio-gare";
import { rettificaPacchetti } from "@/lib/pacchetti-servizi";
import { SERVIZI, eServizioPacchetto } from "@/lib/pacchetti-servizi-calcoli";

// Pacchetti prepagati di servizi aggiuntivi, dalla console: aggiungere o correggere le unità di un cliente (un regalo è una rettifica positiva con un
// motivo). Ogni azione parte da richiediAdminAzione(). La variazione la fa una funzione SQL (migrazione 0104) che mette il registro e il saldo
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
