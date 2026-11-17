// Scrittura delle classificazioni per settore (radar_classificazioni, migrazione 0121 — PROGETTO non applicato). Solo server, chiave di
// servizio. Provata su database in memoria da scripts/verifica-radar-0121.ts; NON collegata agli importatori finché l'utente non approva la
// 0121: senza la tabella non fa nulla («saltata»).
//
// Ordine delle scritture, per il vincolo «una sola riga attiva per gara e settore»: prima si disattiva la riga vecchia (scrittura
// condizionata: se nel frattempo qualcuno l'ha già cambiata non si tocca e la nuova non si inserisce), poi si inserisce la nuova. Se
// l'inserimento fallisse dopo la disattivazione, il settore resterebbe senza riga attiva fino al calcolo successivo, che la reinserisce.
// Nessuna cancellazione; la colonna «settori» della gara non si tocca mai.
import type { SupabaseClient } from "@supabase/supabase-js";
import { schemaAssente } from "@/lib/omnia-ai-incassi";
import { blocchi, misura, type Misure } from "./importa";
import { aggiornamentoClassificazioni, type RigaClassificazione } from "./classificazioni-calcoli";

export type EsitoClassificazioni = { saltata: boolean; inserite: number; disattivate: number; invariate: number; protette: number; cambiateNelFrattempo: number };

export async function scriviClassificazioni(admin: SupabaseClient, voci: readonly { proceduraId: string; calcolate: readonly RigaClassificazione[] }[], misure: Misure, adessoIso: string): Promise<EsitoClassificazioni> {
  const esito: EsitoClassificazioni = { saltata: false, inserite: 0, disattivate: 0, invariate: 0, protette: 0, cambiateNelFrattempo: 0 };
  if (voci.length === 0) return esito;
  const attive = new Map<string, RigaClassificazione[]>();
  for (const b of blocchi([...new Set(voci.map((v) => v.proceduraId))], 100)) {
    const { data, error } = await admin.from("radar_classificazioni").select("*").in("procedura_id", b).eq("attiva", true).returns<RigaClassificazione[]>();
    misure.richiesteDb++;
    if (error) {
      // 0121 non applicata: nessuna scrittura (gli importatori continuano come prima)
      if (schemaAssente(error)) return { ...esito, saltata: true };
      throw new Error(`lettura delle classificazioni: ${error.message}`);
    }
    for (const r of data ?? []) attive.set(r.procedura_id, [...(attive.get(r.procedura_id) ?? []), r]);
  }
  const daInserire: RigaClassificazione[] = [];
  for (const v of voci) {
    const a = aggiornamentoClassificazioni(attive.get(v.proceduraId) ?? [], v.calcolate, adessoIso);
    esito.invariate += a.invariate;
    esito.protette += a.protette.length;
    const bloccate = new Set<string>();
    for (const d of a.disattiva) {
      const { data } = await misura(misure, "disattivazione di una classificazione", () =>
        admin.from("radar_classificazioni").update({ attiva: false, sostituita_il: d.sostituita_il, sostituita_da: d.sostituita_da }).eq("id", d.id).eq("attiva", true).select("id"),
      );
      if ((data ?? []).length === 0) {
        esito.cambiateNelFrattempo++;
        if (d.sostituita_da) bloccate.add(d.sostituita_da);
      } else esito.disattivate++;
    }
    daInserire.push(...a.inserisci.filter((n) => !bloccate.has(n.id)));
  }
  for (const b of blocchi(daInserire, 200)) {
    await misura(misure, "scrittura delle classificazioni", () => admin.from("radar_classificazioni").insert(b));
    esito.inserite += b.length;
  }
  return esito;
}
