// Collegamento reversibile delle gare doppie nell'archivio (fase B1-bis, migrazione 0117; tutte le fonti dalla fase B2a). Solo server,
// chiave di servizio. Le regole stanno in collegamenti-calcoli.ts. È l'UNICO sistema di unione dell'archivio (decisione dell'utente del
// 17/11/2026): TED, PVL, Sintel, SardegnaCAT e le fonti future passano tutte da qui.
//
//   - collegaGare: unione AUTOMATICA di coppie riconosciute da un identificativo ufficiale (CIG, numero TED, identificativo della procedura
//     sulla piattaforma); niente catene né cicli; le gare già collegate a quella assorbita passano alla gara che resta; tutto nel registro;
//   - collegaDoppioniPerAvvisoTed: il caso della B1-bis (rettifica PVL letta prima del bando TED), ora sopra collegaGare;
//   - proponiCollegamenti / confermaProposta / rifiutaProposta: corrispondenze PROBABILI, solo suggerimenti verificabili nel registro
//     (radar_aggiornamenti, campo «collegamento_proposto»): diventano un'unione solo se un amministratore le conferma;
//   - scollegaGara: annullamento dalla console; il collegamento non si rifà da solo.
import type { SupabaseClient } from "@supabase/supabase-js";
import { blocchi, misura, type Misure } from "./importa";
import { decidiUnione, idProposta, idTraccia, restaInFondo, type GaraUnibile } from "./collegamenti-calcoli";

export type EsitoCollegamenti = { collegate: number; spostate: number; saltate: Record<string, number> };

export type RichiestaCollegamento = { a: string; b: string; motivo: string; traccia: string; fonte: string; restaPreferita?: string | null };

const COLONNE_GARA = "id, chiave, unita_a, unita_esclusa_con, fonti, prima_rilevazione_il";

async function leggiGare(admin: SupabaseClient, ids: readonly string[], misure: Misure): Promise<Map<string, GaraUnibile>> {
  const gare = new Map<string, GaraUnibile>();
  let daLeggere = [...new Set(ids)];
  // si legge anche la gara che resta di ogni gara già collegata (fino in fondo alla catena, che normalmente è di un solo passaggio)
  for (let giro = 0; giro < 5 && daLeggere.length > 0; giro++) {
    for (const b of blocchi(daLeggere, 100)) {
      const { data } = await misura(misure, "gare da collegare", () => admin.from("radar_procedure").select(COLONNE_GARA).in("id", b).returns<GaraUnibile[]>());
      for (const g of data ?? []) gare.set(g.id, g);
    }
    daLeggere = [...new Set([...gare.values()].map((g) => g.unita_a).filter((x): x is string => !!x && !gare.has(x)))];
  }
  return gare;
}

export async function collegaGare(admin: SupabaseClient, richieste: readonly RichiestaCollegamento[], iso: string, misure: Misure): Promise<EsitoCollegamenti> {
  const esito: EsitoCollegamenti = { collegate: 0, spostate: 0, saltate: {} };
  if (richieste.length === 0) return esito;
  const gare = await leggiGare(admin, richieste.flatMap((r) => [r.a, r.b, ...(r.restaPreferita ? [r.restaPreferita] : [])]), misure);

  for (const r of richieste) {
    const d = decidiUnione(r.a, r.b, gare, r.motivo, r.restaPreferita ?? null);
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
    const traccia = idTraccia(r.traccia, d.assorbita);
    const righe: Record<string, unknown>[] = [
      { procedura_id: d.assorbita, tipo: "correzione_dati", campo: "collegata_a", valore_precedente: null, valore_nuovo: d.resta, fonte: r.fonte, id_fonte: traccia, nota: d.motivo, notificabile: false },
      { procedura_id: d.resta, tipo: "correzione_dati", campo: "collegata_da", valore_precedente: null, valore_nuovo: d.assorbita, fonte: r.fonte, id_fonte: traccia, nota: d.motivo, notificabile: false },
    ];
    // niente catene: le gare che erano collegate a quella assorbita passano alla gara che resta (ognuna con la sua traccia)
    const { data: figlie } = await misura(misure, "gare collegate alla gara assorbita", () =>
      admin.from("radar_procedure").update({ unita_a: d.resta, unita_il: iso, aggiornata_il: iso }).eq("unita_a", d.assorbita).select("id").returns<{ id: string }[]>(),
    );
    for (const f of figlie ?? []) {
      esito.spostate++;
      const tf = idTraccia(r.traccia, f.id);
      righe.push(
        { procedura_id: f.id, tipo: "correzione_dati", campo: "collegata_a", valore_precedente: d.assorbita, valore_nuovo: d.resta, fonte: r.fonte, id_fonte: tf, nota: "La gara a cui era collegata è stata a sua volta unita a questa", notificabile: false },
        { procedura_id: d.resta, tipo: "correzione_dati", campo: "collegata_da", valore_precedente: null, valore_nuovo: f.id, fonte: r.fonte, id_fonte: tf, nota: "Passata dalla gara assorbita", notificabile: false },
      );
      const g = gare.get(f.id);
      if (g) gare.set(f.id, { ...g, unita_a: d.resta });
    }
    await misura(misure, "registro del collegamento", () => admin.from("radar_aggiornamenti").upsert(righe, { onConflict: "procedura_id,tipo,campo,id_fonte", ignoreDuplicates: true }));
    gare.set(d.assorbita, { ...(gare.get(d.assorbita) as GaraUnibile), unita_a: d.resta });
    esito.collegate++;
  }
  return esito;
}

export async function collegaDoppioniPerAvvisoTed(admin: SupabaseClient, numeriTed: readonly string[], iso: string, misure: Misure): Promise<EsitoCollegamenti> {
  const numeri = [...new Set(numeriTed.filter(Boolean))];
  if (numeri.length === 0) return { collegate: 0, spostate: 0, saltate: {} };

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
  // resta la gara che contiene l'avviso TED (regola della B1-bis)
  return collegaGare(
    admin,
    coppie.map((c) => {
      const t = garaTed.get(c.numero) as string;
      return { a: t, b: c.procedura_id, motivo: `stesso avviso TED ${c.numero}, citato dalla PVL e letto da TED`, traccia: c.numero, fonte: "ted", restaPreferita: t };
    }),
    iso,
    misure,
  );
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

// ───── suggerimenti (corrispondenze probabili): mai unioni automatiche ─────

export type Proposta = { a: string; b: string; motivo: string; fonte: string };

// Registra i suggerimenti nuovi (una riga per gara, stessa chiave in qualunque ordine). Non propone coppie già unite, già annullate a mano o
// già proposte.
export async function proponiCollegamenti(admin: SupabaseClient, proposte: readonly Proposta[], iso: string, misure: Misure): Promise<{ proposte: number; saltate: number }> {
  if (proposte.length === 0) return { proposte: 0, saltate: 0 };
  const gare = await leggiGare(admin, proposte.flatMap((p) => [p.a, p.b]), misure);
  const righe: Record<string, unknown>[] = [];
  let saltate = 0;
  for (const p of proposte) {
    const ra = restaInFondo(p.a, gare);
    const rb = restaInFondo(p.b, gare);
    const a = ra ? gare.get(ra) : undefined;
    const b = rb ? gare.get(rb) : undefined;
    if (!a || !b || a.id === b.id || (a.unita_esclusa_con ?? []).includes(b.id) || (b.unita_esclusa_con ?? []).includes(a.id)) {
      saltate++;
      continue;
    }
    const chiave = idProposta(a.id, b.id);
    righe.push(
      { procedura_id: a.id, tipo: "correzione_dati", campo: "collegamento_proposto", valore_precedente: null, valore_nuovo: b.id, fonte: p.fonte, id_fonte: chiave, nota: p.motivo.slice(0, 1000), notificabile: false },
      { procedura_id: b.id, tipo: "correzione_dati", campo: "collegamento_proposto", valore_precedente: null, valore_nuovo: a.id, fonte: p.fonte, id_fonte: chiave, nota: p.motivo.slice(0, 1000), notificabile: false },
    );
  }
  for (const b of blocchi(righe, 200)) {
    await misura(misure, "registro dei suggerimenti", () => admin.from("radar_aggiornamenti").upsert(b, { onConflict: "procedura_id,tipo,campo,id_fonte", ignoreDuplicates: true }));
  }
  return { proposte: righe.length / 2, saltate };
}

async function decidiProposta(admin: SupabaseClient, a: string, b: string, esito: "confermata" | "rifiutata", nota: string, iso: string): Promise<void> {
  const chiave = idProposta(a, b);
  await admin.from("radar_aggiornamenti").upsert(
    [a, b].map((id) => ({ procedura_id: id, tipo: "correzione_dati", campo: "collegamento_proposta_decisa", valore_precedente: null, valore_nuovo: esito, fonte: "manuale", id_fonte: chiave, nota: nota.slice(0, 1000), notificabile: false })),
    { onConflict: "procedura_id,tipo,campo,id_fonte", ignoreDuplicates: true },
  );
  void iso;
}

// Conferma di un amministratore: si esegue l'unione della 0117 (stesse regole di quella automatica).
export async function confermaProposta(admin: SupabaseClient, a: string, b: string, chi: string, iso: string, misure: Misure): Promise<EsitoCollegamenti> {
  const e = await collegaGare(admin, [{ a, b, motivo: `suggerimento confermato in console (${chi})`, traccia: idProposta(a, b), fonte: "manuale" }], iso, misure);
  if (e.collegate > 0) await decidiProposta(admin, a, b, "confermata", `Confermato da ${chi}`, iso);
  return e;
}

// Rifiuto: le due gare non si propongono e non si uniscono più tra loro (stessa regola dell'annullamento a mano).
export async function rifiutaProposta(admin: SupabaseClient, a: string, b: string, chi: string, iso: string): Promise<boolean> {
  const { data } = await admin.from("radar_procedure").select("id, unita_esclusa_con").in("id", [a, b]).returns<{ id: string; unita_esclusa_con: string[] | null }[]>();
  const g = new Map((data ?? []).map((r) => [r.id, r.unita_esclusa_con ?? []]));
  if (!g.has(a) || !g.has(b)) return false;
  await admin.from("radar_procedure").update({ unita_esclusa_con: [...new Set([...(g.get(a) ?? []), b])], aggiornata_il: iso }).eq("id", a);
  await admin.from("radar_procedure").update({ unita_esclusa_con: [...new Set([...(g.get(b) ?? []), a])], aggiornata_il: iso }).eq("id", b);
  await decidiProposta(admin, a, b, "rifiutata", `Rifiutato da ${chi}`, iso);
  return true;
}

// Suggerimenti ancora da decidere (per la console): proposti, non decisi, non già uniti.
export type PropostaAperta = { a: string; b: string; motivo: string; proposta_il: string };

export async function leggiProposteAperte(admin: SupabaseClient, limite = 50): Promise<PropostaAperta[]> {
  const [{ data: proposte }, { data: decise }] = await Promise.all([
    admin.from("radar_aggiornamenti").select("procedura_id, valore_nuovo, id_fonte, nota, rilevato_il").eq("campo", "collegamento_proposto").order("rilevato_il", { ascending: false }).limit(limite * 2).returns<{ procedura_id: string; valore_nuovo: string; id_fonte: string; nota: string | null; rilevato_il: string }[]>(),
    admin.from("radar_aggiornamenti").select("id_fonte").eq("campo", "collegamento_proposta_decisa").limit(1000).returns<{ id_fonte: string }[]>(),
  ]);
  const decisi = new Set((decise ?? []).map((d) => d.id_fonte));
  const viste = new Set<string>();
  const out: PropostaAperta[] = [];
  for (const p of proposte ?? []) {
    if (decisi.has(p.id_fonte) || viste.has(p.id_fonte)) continue;
    viste.add(p.id_fonte);
    out.push({ a: p.procedura_id, b: p.valore_nuovo, motivo: p.nota ?? "", proposta_il: p.rilevato_il });
  }
  if (out.length === 0) return out;
  const ids = [...new Set(out.flatMap((p) => [p.a, p.b]))];
  const { data: gare } = await admin.from("radar_procedure").select("id, unita_a").in("id", ids).returns<{ id: string; unita_a: string | null }[]>();
  const unite = new Map((gare ?? []).map((g) => [g.id, g.unita_a]));
  return out.filter((p) => unite.get(p.a) !== p.b && unite.get(p.b) !== p.a).slice(0, limite);
}
