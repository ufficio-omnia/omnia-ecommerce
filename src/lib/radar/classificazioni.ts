// Scrittura delle classificazioni per settore e del loro STATO (radar_classificazioni e radar_classificazioni_stato, migrazione 0121,
// applicata sullo staging il 17/11/2026). Solo server, chiave di servizio. Provata su database in memoria (verifica-radar-0121.ts e
// verifica-radar-popolamento.ts). Usata dallo script unico di popolamento e, fase B2b, dagli importatori SOLO con l'interruttore acceso
// (ambiente.ts, spento): senza le tabelle non fa nulla («saltata»).
//
// Rilevanza settoriale, NON ammissibilità dell'impresa (vedi classificazioni-calcoli.ts).
//
// Per ogni gara:
//   1. le righe calcolate si controllano con le stesse regole della 0121 (motivi uno per regola e mai vuoti, forma, nota piena): una riga
//      non valida non si scrive e la gara va in stato «fallita» con l'errore (le righe attive precedenti restano);
//   2. per il vincolo «una sola riga attiva per gara e settore» prima si disattiva la riga vecchia (scrittura condizionata: se nel frattempo
//      qualcuno l'ha già cambiata non si tocca e la nuova non si inserisce), poi si inserisce la nuova;
//   3. lo stato diventa «classificata» (con la versione delle regole) solo se tutto è andato a buon fine, altrimenti «fallita».
// Nessuna cancellazione; la colonna «settori» della gara non si tocca mai. Una gara senza stato resta «non classificata», mai «non
// pertinente».
import type { SupabaseClient } from "@supabase/supabase-js";
import { schemaAssente } from "@/lib/omnia-ai-incassi";
import { blocchi, misura, type Misure } from "./importa";
import { aggiornamentoClassificazioni, erroriRiga, statoDopoTentativo, type RigaClassificazione, type RigaStato } from "./classificazioni-calcoli";

export type EsitoClassificazioni = { saltata: boolean; inserite: number; disattivate: number; invariate: number; protette: number; cambiateNelFrattempo: number; classificate: number; fallite: number };

export async function scriviClassificazioni(
  admin: SupabaseClient,
  voci: readonly { proceduraId: string; versione: string; calcolate: readonly RigaClassificazione[] }[],
  misure: Misure,
  adessoIso: string,
): Promise<EsitoClassificazioni> {
  const esito: EsitoClassificazioni = { saltata: false, inserite: 0, disattivate: 0, invariate: 0, protette: 0, cambiateNelFrattempo: 0, classificate: 0, fallite: 0 };
  if (voci.length === 0) return esito;
  const ids = [...new Set(voci.map((v) => v.proceduraId))];
  const attive = new Map<string, RigaClassificazione[]>();
  const stati = new Map<string, RigaStato>();
  for (const b of blocchi(ids, 100)) {
    const { data, error } = await admin.from("radar_classificazioni").select("*").in("procedura_id", b).eq("attiva", true).returns<RigaClassificazione[]>();
    misure.richiesteDb++;
    if (error) {
      // 0121 non applicata: nessuna scrittura (gli importatori continuano come prima)
      if (schemaAssente(error)) return { ...esito, saltata: true };
      throw new Error(`lettura delle classificazioni: ${error.message}`);
    }
    for (const r of data ?? []) attive.set(r.procedura_id, [...(attive.get(r.procedura_id) ?? []), r]);
    const { data: st, error: e2 } = await admin.from("radar_classificazioni_stato").select("*").in("procedura_id", b).returns<RigaStato[]>();
    misure.richiesteDb++;
    if (e2) {
      if (schemaAssente(e2)) return { ...esito, saltata: true };
      throw new Error(`lettura dello stato delle classificazioni: ${e2.message}`);
    }
    for (const s of st ?? []) stati.set(s.procedura_id, s);
  }

  const nuoviStati: RigaStato[] = [];
  // gare pronte per l'inserimento, con le loro righe (fase B2b: gli inserimenti si raggruppano tra più gare, poi lo stato)
  const pronte: { v: (typeof voci)[number]; prima: RigaStato | null; righe: RigaClassificazione[] }[] = [];
  const fallita = (v: (typeof voci)[number], prima: RigaStato | null, errore: string) => {
    nuoviStati.push(statoDopoTentativo(prima, { ok: false, errore }, v.proceduraId, adessoIso));
    esito.fallite++;
  };
  for (const v of voci) {
    const prima = stati.get(v.proceduraId) ?? null;
    // 1) controlli della 0121, nel codice
    const errori = v.calcolate.flatMap((r) => erroriRiga(r).map((e) => `${r.settore}: ${e}`));
    if (errori.length > 0) {
      fallita(v, prima, `Righe non valide: ${errori.join("; ")}`);
      continue;
    }
    const a = aggiornamentoClassificazioni(attive.get(v.proceduraId) ?? [], v.calcolate, adessoIso);
    esito.invariate += a.invariate;
    esito.protette += a.protette.length;
    try {
      // 2) disattivazioni condizionate (prima delle nuove righe: una sola riga attiva per gara e settore)
      let bloccata = false;
      for (const d of a.disattiva) {
        const { data } = await misura(misure, "disattivazione di una classificazione", () =>
          admin.from("radar_classificazioni").update({ attiva: false, sostituita_il: d.sostituita_il, sostituita_da: d.sostituita_da }).eq("id", d.id).eq("attiva", true).select("id"),
        );
        if ((data ?? []).length === 0) {
          esito.cambiateNelFrattempo++;
          if (d.sostituita_da) bloccata = true;
        } else esito.disattivate++;
      }
      // classificata solo se nulla è stato bloccato da una modifica concorrente
      if (bloccata) fallita(v, prima, "Classificazione cambiata nel frattempo: da rifare");
      else pronte.push({ v, prima, righe: a.inserisci });
    } catch (e) {
      fallita(v, prima, e instanceof Error ? e.message : String(e));
    }
  }
  // 3) inserimenti a blocchi di circa 200 righe (le righe di una gara stanno sempre nello stesso blocco); se un blocco non passa, gara per
  //    gara, così una gara con un problema non ferma le altre
  const gruppi: (typeof pronte)[] = [];
  let corrente: typeof pronte = [];
  let n = 0;
  for (const p of pronte) {
    if (n > 0 && n + p.righe.length > 200) {
      gruppi.push(corrente);
      corrente = [];
      n = 0;
    }
    corrente.push(p);
    n += p.righe.length;
  }
  if (corrente.length) gruppi.push(corrente);
  const riuscita = (p: (typeof pronte)[number]) => {
    nuoviStati.push(statoDopoTentativo(p.prima, { ok: true, versione: p.v.versione }, p.v.proceduraId, adessoIso));
    esito.classificate++;
  };
  for (const g of gruppi) {
    const righe = g.flatMap((p) => p.righe);
    if (righe.length === 0) {
      g.forEach(riuscita);
      continue;
    }
    const { error } = await admin.from("radar_classificazioni").insert(righe);
    misure.richiesteDb++;
    if (!error) {
      esito.inserite += righe.length;
      g.forEach(riuscita);
      continue;
    }
    for (const p of g) {
      if (p.righe.length === 0) {
        riuscita(p);
        continue;
      }
      const { error: e1 } = await admin.from("radar_classificazioni").insert(p.righe);
      misure.richiesteDb++;
      if (e1) fallita(p.v, p.prima, `scrittura delle classificazioni: ${e1.message}`);
      else {
        esito.inserite += p.righe.length;
        riuscita(p);
      }
    }
  }
  for (const b of blocchi(nuoviStati, 200)) {
    await misura(misure, "stato delle classificazioni", () => admin.from("radar_classificazioni_stato").upsert(b, { onConflict: "procedura_id" }));
  }
  return esito;
}

/**
 * Fase B2b (pacchetto 16, punto 7): la rilevanza per settore e lo stato delle gare di una ricerca, per distinguere le pertinenti (A) dalle
 * correlate (B). Due letture per blocco di 100 gare, SOLO con le classificazioni accese; tabelle assenti o errore = mappa vuota (la ricerca
 * resta come prima). Gare senza stato: assenti dalla mappa (mai «non pertinenti»).
 */
export async function leggiRilevanze(admin: SupabaseClient, ids: readonly string[]): Promise<Map<string, { stato: RigaStato["stato"]; perSettore: Partial<Record<string, "A" | "B" | "C">> }>> {
  const out = new Map<string, { stato: RigaStato["stato"]; perSettore: Partial<Record<string, "A" | "B" | "C">> }>();
  for (const b of blocchi([...new Set(ids)], 100)) {
    const [st, cl] = await Promise.all([
      admin.from("radar_classificazioni_stato").select("procedura_id, stato").in("procedura_id", b).returns<{ procedura_id: string; stato: RigaStato["stato"] }[]>(),
      admin.from("radar_classificazioni").select("procedura_id, settore, rilevanza").in("procedura_id", b).eq("attiva", true).returns<{ procedura_id: string; settore: string; rilevanza: "A" | "B" | "C" }[]>(),
    ]);
    if (st.error || cl.error) return new Map();
    for (const s of st.data ?? []) out.set(s.procedura_id, { stato: s.stato, perSettore: {} });
    for (const r of cl.data ?? []) {
      const g = out.get(r.procedura_id);
      if (g) g.perSettore[r.settore] = r.rilevanza;
    }
  }
  return out;
}

/** Gare nuove o cambiate da riclassificare: stato «in_attesa» (la versione e la data dell'ultima classificazione riuscita restano). */
export async function segnaInAttesa(admin: SupabaseClient, ids: readonly string[], misure: Misure, adessoIso: string): Promise<{ saltata: boolean; segnate: number }> {
  let segnate = 0;
  for (const b of blocchi([...new Set(ids)], 200)) {
    const { error } = await admin.from("radar_classificazioni_stato").upsert(b.map((procedura_id) => ({ procedura_id, stato: "in_attesa", errore: null, aggiornata_il: adessoIso })), { onConflict: "procedura_id" });
    misure.richiesteDb++;
    if (error) {
      if (schemaAssente(error)) return { saltata: true, segnate };
      throw new Error(`stato in attesa: ${error.message}`);
    }
    segnate += b.length;
  }
  return { saltata: false, segnate };
}
