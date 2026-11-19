"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { richiediTitolareAzione } from "@/lib/omnia-ai-account-guardie";
import { leggiDirittoRadar } from "@/lib/radar/impostazioni";
import { MESSAGGIO_RADAR_NON_DISPONIBILE, RADICE_OPPORTUNITA } from "@/lib/radar/area-cliente";
import { perTeAttivo } from "@/lib/radar/interruttori-b4";
import { inputProfiloDaModulo, validaProfiloRadar } from "@/lib/radar/profilo-calcoli";
import { scriviProfiloRadar } from "@/lib/radar/profilo";

// Fase B4 (B1), grado 1 — Salvataggio del profilo di ricerca. SOLO il titolare dell'impresa (decisione dell'utente del 19/11: l'Ufficio Gare
// vede il profilo ma non lo modifica). Prima cosa la guardia del titolare, poi l'interruttore RADAR_PER_TE (solo staging) e il diritto al modulo;
// l'impresa e l'autore vengono dalla sessione, mai dal modulo. Scrittura con la chiave di servizio (la 0122 non dà scritture ai clienti).

export type StatoProfiloRadar = { errore?: string; ok?: boolean; messaggio?: string };

export async function salvaProfiloRadar(_stato: StatoProfiloRadar, formData: FormData): Promise<StatoProfiloRadar> {
  const guardia = await richiediTitolareAzione();
  if (!guardia.ok) return { errore: guardia.errore };
  if (!perTeAttivo(process.env)) return { errore: MESSAGGIO_RADAR_NON_DISPONIBILE };
  const diritto = await leggiDirittoRadar(guardia.contesto.accountId);
  if (!diritto.visibile) return { errore: MESSAGGIO_RADAR_NON_DISPONIBILE };
  if (!diritto.operativo) return { errore: diritto.messaggioSolaLettura ?? MESSAGGIO_RADAR_NON_DISPONIBILE };

  const esito = validaProfiloRadar(inputProfiloDaModulo(formData));
  if (!esito.ok) return { errore: esito.errore };

  const scritto = await scriviProfiloRadar(createAdminClient(), esito.valori, guardia.contesto.accountId, guardia.contesto.userId, new Date());
  if (!scritto.ok) return { errore: scritto.tabellaAssente ? "Il profilo di ricerca non è ancora disponibile." : "Non è stato possibile salvare il profilo." };

  revalidatePath(`${RADICE_OPPORTUNITA}/per-te`);
  revalidatePath(`${RADICE_OPPORTUNITA}/profilo`);
  return { ok: true, messaggio: ["Profilo salvato.", ...esito.avvisi].join(" ") };
}
