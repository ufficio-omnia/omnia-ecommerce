// Collegamento reversibile delle gare doppie nell'archivio (fase B1-bis, migrazione 0117). Solo server, chiave di servizio.
// Le regole stanno in collegamenti-calcoli.ts. Si chiama dopo ogni pagina importata (TED o PVL) con i numeri degli avvisi TED appena
// scritti: due letture per pagina, una scrittura e due righe di registro solo quando c'è davvero un doppione (raro).
import type { SupabaseClient } from "@supabase/supabase-js";
import { blocchi, misura, type Misure } from "./importa";
import { decidiCollegamento, type GaraCollegabile } from "./collegamenti-calcoli";

export type EsitoCollegamenti = { collegate: number; saltate: Record<string, number> };

export async function collegaDoppioniPerAvvisoTed(admin: SupabaseClient, numeriTed: readonly string[], iso: string, misure: Misure): Promise<EsitoCollegamenti> {
  const esito: EsitoCollegamenti = { collegate: 0, saltate: {} };
  const numeri = [...new Set(numeriTed.filter(Boolean))];
  if (numeri.length === 0) return esito;

  // gare che contengono l'avviso TED e gare che lo citano dalla PVL
  const garaTed = new Map<string, string>();
  const citate: { numero: string; procedura_id: string }[] = [];
  for (const b of blocchi(numeri, 100)) {
    const [ted, pvl] = await Promise.all([
      misura(misure, "avvisi TED per i doppioni", () => admin.from("radar_procedure_fonti").select("id_fonte, procedura_id").eq("fonte", "ted").in("id_fonte", b).returns<{ id_fonte: string; procedura_id: string }[]>()),
      misura(misure, "citazioni PVL per i doppioni", () => admin.from("radar_procedure_fonti").select("rif_ted, procedura_id").eq("fonte", "pvl").in("rif_ted", b).returns<{ rif_ted: string; procedura_id: string }[]>()),
    ]);
    for (const r of ted.data ?? []) garaTed.set(r.id_fonte, r.procedura_id);
    for (const r of pvl.data ?? []) citate.push({ numero: r.rif_ted, procedura_id: r.procedura_id });
  }
  const coppie = [...new Map(citate.filter((c) => garaTed.has(c.numero) && garaTed.get(c.numero) !== c.procedura_id).map((c) => [`${garaTed.get(c.numero)}|${c.procedura_id}`, c])).values()];
  if (coppie.length === 0) return esito;

  const ids = [...new Set(coppie.flatMap((c) => [c.procedura_id, garaTed.get(c.numero) as string]))];
  const gare = new Map<string, GaraCollegabile>();
  for (const b of blocchi(ids, 100)) {
    const { data } = await misura(misure, "gare dei doppioni", () => admin.from("radar_procedure").select("id, chiave, unita_a, unita_esclusa_con").in("id", b).returns<GaraCollegabile[]>());
    for (const g of data ?? []) gare.set(g.id, g);
  }

  for (const c of coppie) {
    const d = decidiCollegamento(c.numero, gare.get(garaTed.get(c.numero) as string) ?? null, gare.get(c.procedura_id) ?? null);
    if (!d.collega) {
      esito.saltate[d.motivo] = (esito.saltate[d.motivo] ?? 0) + 1;
      continue;
    }
    // scrittura condizionata: solo se nel frattempo nessuno l'ha già collegata
    const { data: fatte } = await misura(misure, "collegamento della gara doppia", () =>
      admin.from("radar_procedure").update({ unita_a: d.resta, unita_il: iso, unita_motivo: d.motivo, aggiornata_il: iso }).eq("id", d.assorbita).is("unita_a", null).select("id"),
    );
    if ((fatte ?? []).length === 0) {
      esito.saltate.gia_collegata = (esito.saltate.gia_collegata ?? 0) + 1;
      continue;
    }
    // tracciato su entrambe le gare (mai notificabile: non è una novità della gara)
    await misura(misure, "registro del collegamento", () =>
      admin.from("radar_aggiornamenti").upsert(
        [
          { procedura_id: d.assorbita, tipo: "correzione_dati", campo: "collegata_a", valore_precedente: null, valore_nuovo: d.resta, fonte: "ted", id_fonte: c.numero, nota: d.motivo, notificabile: false },
          { procedura_id: d.resta, tipo: "correzione_dati", campo: "collegata_da", valore_precedente: null, valore_nuovo: d.assorbita, fonte: "ted", id_fonte: c.numero, nota: d.motivo, notificabile: false },
        ],
        { onConflict: "procedura_id,tipo,campo,id_fonte", ignoreDuplicates: true },
      ),
    );
    gare.set(d.assorbita, { ...(gare.get(d.assorbita) as GaraCollegabile), unita_a: d.resta });
    esito.collegate++;
  }
  return esito;
}

export type EsitoScollegamento = { ok: true; resta: string } | { ok: false; motivo: "non_collegata" | "errore" };

// Annulla un collegamento (solo dalla console, dopo la guardia dell'amministratore, che registra anche nel registro della console): la gara
// torna visibile e il collegamento con quella gara non si rifà più da solo. Nulla si cancella.
export async function scollegaGara(admin: SupabaseClient, assorbitaId: string, iso: string): Promise<EsitoScollegamento> {
  const { data: g, error } = await admin.from("radar_procedure").select("id, unita_a, unita_esclusa_con").eq("id", assorbitaId).maybeSingle<{ id: string; unita_a: string | null; unita_esclusa_con: string[] | null }>();
  if (error) return { ok: false, motivo: "errore" };
  if (!g?.unita_a) return { ok: false, motivo: "non_collegata" };
  const resta = g.unita_a;
  const esclusa = [...new Set([...(g.unita_esclusa_con ?? []), resta])];
  const { data: fatte, error: e2 } = await admin
    .from("radar_procedure")
    .update({ unita_a: null, unita_il: null, unita_motivo: null, unita_esclusa_con: esclusa, aggiornata_il: iso })
    .eq("id", assorbitaId)
    .eq("unita_a", resta)
    .select("id");
  if (e2) return { ok: false, motivo: "errore" };
  if ((fatte ?? []).length === 0) return { ok: false, motivo: "non_collegata" };
  const idFonte = `annullato:${iso}`;
  await admin.from("radar_aggiornamenti").upsert(
    [
      { procedura_id: assorbitaId, tipo: "correzione_dati", campo: "collegamento_annullato", valore_precedente: resta, valore_nuovo: null, fonte: "manuale", id_fonte: idFonte, nota: "Collegamento annullato dalla console", notificabile: false },
      { procedura_id: resta, tipo: "correzione_dati", campo: "collegamento_annullato", valore_precedente: assorbitaId, valore_nuovo: null, fonte: "manuale", id_fonte: idFonte, nota: "Collegamento annullato dalla console", notificabile: false },
    ],
    { onConflict: "procedura_id,tipo,campo,id_fonte", ignoreDuplicates: true },
  );
  return { ok: true, resta };
}
