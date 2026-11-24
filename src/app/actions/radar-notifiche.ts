"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { richiediTitolareAzione } from "@/lib/omnia-ai-account-guardie";
import { richiediOpportunitaAzione } from "@/lib/radar/guardie-opportunita";
import { leggiDirittoRadar } from "@/lib/radar/impostazioni";
import { MESSAGGIO_RADAR_NON_DISPONIBILE, RADICE_OPPORTUNITA } from "@/lib/radar/area-cliente";
import { preferenzeNotificheAttive } from "@/lib/radar/interruttori-b4";
import { CATEGORIE_NOTIFICA } from "@/lib/radar/notifiche/tipi";
import { categorieDaModulo, validaModificaPreferenze } from "@/lib/radar/notifiche-preferenze-calcoli";
import { leggiPersoneDellImpresa, leggiPreferenzePersona, scriviEmailImpresa, scriviPreferenze } from "@/lib/radar/notifiche-preferenze";

// Fase B4 (B1), grado 3 — Azioni della pagina «Notifiche» (RADAR_NOTIFICHE_PREFERENZE: staging o deploy di produzione, interruttori-b4.ts). Decisione dell'utente del
// 19/11 §3 e approvazione definitiva (D-E3, D-E4):
//   - l'interruttore delle email dell'IMPRESA lo cambia solo il titolare dell'impresa;
//   - le preferenze personali: il titolare per tutte le persone della sua impresa; l'Ufficio Gare (con il grado 2 acceso) solo le proprie e
//     solo per spegnere.
// Impresa e autore vengono SEMPRE dalla sessione; dal modulo arrivano solo le categorie e, per il titolare, la persona da modificare (che deve
// essere della sua impresa). Scritture con il client di servizio dopo la guardia. Nessuna email parte da qui.

export type StatoNotifiche = { errore?: string; ok?: boolean; messaggio?: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function salvaEmailImpresa(_stato: StatoNotifiche, formData: FormData): Promise<StatoNotifiche> {
  const guardia = await richiediTitolareAzione();
  if (!guardia.ok) return { errore: guardia.errore };
  if (!preferenzeNotificheAttive(process.env)) return { errore: MESSAGGIO_RADAR_NON_DISPONIBILE };
  const diritto = await leggiDirittoRadar(guardia.contesto.accountId);
  if (!diritto.visibile) return { errore: MESSAGGIO_RADAR_NON_DISPONIBILE };
  const attive = String(formData.get("attive") ?? "") === "si";
  // in sola lettura si possono spegnere, non accendere
  if (attive && !diritto.operativo) return { errore: diritto.messaggioSolaLettura ?? MESSAGGIO_RADAR_NON_DISPONIBILE };

  const admin = createAdminClient();
  const persone = await leggiPersoneDellImpresa(admin, guardia.contesto.accountId);
  if (!persone) return { errore: "Non è stato possibile salvare la scelta." };
  const scritto = await scriviEmailImpresa(admin, persone, attive, guardia.contesto.userId, new Date());
  if (!scritto.ok) return { errore: scritto.tabellaAssente ? "Le notifiche non sono ancora disponibili." : "Non è stato possibile salvare la scelta." };
  revalidatePath(`${RADICE_OPPORTUNITA}/notifiche`);
  return { ok: true, messaggio: attive ? "Avvisi email accesi per l'impresa." : "Avvisi email spenti per l'impresa." };
}

export async function salvaPreferenzeNotifiche(_stato: StatoNotifiche, formData: FormData): Promise<StatoNotifiche> {
  const guardia = await richiediOpportunitaAzione();
  if (!guardia.ok) return { errore: guardia.errore };
  if (!preferenzeNotificheAttive(process.env)) return { errore: MESSAGGIO_RADAR_NON_DISPONIBILE };
  const { contesto } = guardia;
  const diritto = await leggiDirittoRadar(contesto.accountId);
  if (!diritto.visibile) return { errore: MESSAGGIO_RADAR_NON_DISPONIBILE };

  const persona = String(formData.get("persona") ?? "");
  if (!UUID.test(persona)) return { errore: "Persona non valida." };
  const richieste = categorieDaModulo(formData);
  if (!diritto.operativo && CATEGORIE_NOTIFICA.some((c) => richieste[c])) return { errore: diritto.messaggioSolaLettura ?? MESSAGGIO_RADAR_NON_DISPONIBILE };

  const admin = createAdminClient();
  const [persone, attuali] = await Promise.all([leggiPersoneDellImpresa(admin, contesto.accountId), leggiPreferenzePersona(admin, contesto.accountId, persona)]);
  if (!persone || !attuali.ok) return { errore: "Non è stato possibile salvare le preferenze." };
  const esito = validaModificaPreferenze({ chiModifica: { userId: contesto.userId, ruolo: contesto.ruolo }, destinatarioId: persona, persone, attuali: attuali.categorie, richieste });
  if (!esito.ok) return { errore: esito.errore };
  // senza la riga dell'impresa non ci sono preferenze: la crea solo il titolare (email spente); per l'Ufficio Gare non c'è nulla da spegnere
  if (!attuali.esisteImpresa && contesto.ruolo !== "titolare") return { ok: true, messaggio: "Nessuna preferenza da modificare." };

  const scritto = await scriviPreferenze(admin, { impresaId: contesto.accountId, userId: persona, valori: esito.valori, autoreId: contesto.userId, creaImpresa: contesto.ruolo === "titolare", adesso: new Date() });
  if (!scritto.ok) return { errore: scritto.tabellaAssente ? "Le notifiche non sono ancora disponibili." : "Non è stato possibile salvare le preferenze." };
  revalidatePath(`${RADICE_OPPORTUNITA}/notifiche`);
  return { ok: true, messaggio: "Preferenze salvate." };
}
