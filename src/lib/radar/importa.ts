// Scrittura nell'archivio pubblico delle pagine lette da TED: procedure, lotti, provenienza, cambiamenti. Solo server, chiave di servizio.
// Le regole stanno in importa-calcoli.ts; qui solo le letture e le scritture, a blocchi (poche richieste per pagina di 250 avvisi).
//
// Per pagina: 1 lettura della provenienza (avvisi già letti con la stessa impronta = nessuna scrittura), 1 lettura delle procedure,
// 1 scrittura delle procedure cambiate, 1-2 per i lotti, 1 per la provenienza, 1 per i cambiamenti, 1 per collegare le gare aggiunte a mano.
import type { SupabaseClient } from "@supabase/supabase-js";
import { eEsclusione, impronta, type BandoTed, type EsclusioneTed, type EsitoTed, chiaveProceduraTed } from "./fonti/ted-calcoli";
import {
  cambiamentiTraVersioni,
  notificabile,
  piuRecente,
  rigaDaBando,
  statoDopoEsito,
  aperta,
  type Cambiamento,
  type ModoImportazione,
  type RigaProcedura,
  type StatoProcedura,
} from "./importa-calcoli";

export type Misure = { richiesteDb: number; msDb: number };

export type EsitoPaginaBandi = {
  letti: number;
  esclusi: Record<string, number>;
  invariati: number;
  nuove: number;
  aggiornate: number;
  soloProvenienza: number;
  rettifiche: number;
  annullate: number;
  lotti: number;
  cigScartati: number;
  aggiunteCollegate: number;
};

export type EsitoPaginaEsiti = { letti: number; applicati: number; senzaBando: number; invariati: number; senzaStato: number };

const COLONNE_RIGA =
  "id, chiave, oggetto, oggetto_breve, descrizione, sa_codice_fiscale, sa_denominazione, sa_comune, sa_provincia, sa_regione, codice_nuts, luogo_regioni, ente_tipo, tipo_avviso, tipo_procedura, criterio_aggiudicazione, natura_contratto, settori_speciali, data_pubblicazione, scadenza_giorno, scadenza_offerte, scadenza_ora_indicata, scadenza_fonte, valore_stimato, durata_mesi, n_lotti, stato, rettificata, url_avviso, url_documenti, piattaforma_host, cpv_principale, cpv_tutti, settori, metodo_settore, ultima_versione_il, ultima_versione_id, ultima_rilevazione_il, aggiornata_il";

class ErroreDb extends Error {}

async function misura<T extends { error: { message: string } | null }>(misure: Misure, passo: string, f: () => PromiseLike<T>): Promise<T> {
  const inizio = Date.now();
  const r = await f();
  misure.richiesteDb++;
  misure.msDb += Date.now() - inizio;
  if (r.error) throw new ErroreDb(`${passo}: ${r.error.message}`);
  return r;
}

function blocchi<T>(v: readonly T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < v.length; i += n) out.push(v.slice(i, i + n));
  return out;
}

type RigaDb = RigaProcedura & { id: string; valore_stimato: number | string | null };

function normalizzaRiga(r: RigaDb): RigaProcedura & { id: string } {
  return { ...r, valore_stimato: r.valore_stimato === null ? null : Number(r.valore_stimato) };
}

function confronta(a: { data: string; numero: string }, b: { data: string; numero: string }): number {
  if (piuRecente(a, b)) return 1;
  if (piuRecente(b, a)) return -1;
  return 0;
}

export async function applicaPaginaBandi(admin: SupabaseClient, avvisi: (BandoTed | EsclusioneTed)[], modo: ModoImportazione, adesso: Date, misure: Misure): Promise<EsitoPaginaBandi> {
  const esito: EsitoPaginaBandi = { letti: avvisi.length, esclusi: {}, invariati: 0, nuove: 0, aggiornate: 0, soloProvenienza: 0, rettifiche: 0, annullate: 0, lotti: 0, cigScartati: 0, aggiunteCollegate: 0 };
  const validi: BandoTed[] = [];
  for (const a of avvisi) {
    if (eEsclusione(a)) esito.esclusi[a.motivo] = (esito.esclusi[a.motivo] ?? 0) + 1;
    else validi.push(a);
  }
  if (validi.length === 0) return esito;

  // 1) avvisi già letti con la stessa impronta: nessuna scrittura
  const impronte = new Map<string, string | null>();
  for (const b of blocchi([...new Set(validi.map((v) => v.meta.numero))], 100)) {
    const { data } = await misura(misure, "lettura della provenienza", () => admin.from("radar_procedure_fonti").select("id_fonte, impronta").eq("fonte", "ted").in("id_fonte", b).returns<{ id_fonte: string; impronta: string | null }[]>());
    for (const r of data ?? []) impronte.set(r.id_fonte, r.impronta);
  }
  const daApplicare = validi.filter((v) => impronte.get(v.meta.numero) !== v.record.impronta);
  esito.invariati = validi.length - daApplicare.length;
  if (daApplicare.length === 0) return esito;

  // 2) procedure già in archivio
  const chiavi = [...new Set(daApplicare.map((v) => v.record.chiaveProcedura))];
  const esistenti = new Map<string, RigaProcedura & { id: string }>();
  for (const b of blocchi(chiavi, 80)) {
    const { data } = await misura(misure, "lettura delle procedure", () => admin.from("radar_procedure").select(COLONNE_RIGA).in("chiave", b).returns<RigaDb[]>());
    for (const r of data ?? []) esistenti.set(r.chiave, normalizzaRiga(r));
  }

  type Stato = { iniziale: (RigaProcedura & { id: string }) | null; riga: RigaProcedura | null; cambiata: boolean; bando: BandoTed | null; cambiamenti: (Cambiamento & { idFonte: string })[]; avvisi: BandoTed[] };
  const stati = new Map<string, Stato>();
  for (const v of [...daApplicare].sort((a, b) => confronta(a.meta, b.meta))) {
    const chiave = v.record.chiaveProcedura;
    const iniziale = esistenti.get(chiave) ?? null;
    const s = stati.get(chiave) ?? { iniziale, riga: iniziale, cambiata: false, bando: null, cambiamenti: [], avvisi: [] };
    s.avvisi.push(v);
    const attuale = s.riga ? { data: s.riga.ultima_versione_il, numero: s.riga.ultima_versione_id } : null;
    if (piuRecente(v.meta, attuale)) {
      const nuova = rigaDaBando(v, s.riga, adesso);
      if (s.riga) {
        const cc = cambiamentiTraVersioni(s.riga, nuova);
        if (cc.length > 0) {
          nuova.rettificata = true;
          s.cambiamenti.push(...cc.map((c) => ({ ...c, idFonte: v.meta.numero })));
        }
      }
      s.riga = nuova;
      s.cambiata = true;
      s.bando = v;
    }
    stati.set(chiave, s);
  }

  // 3) procedure nuove o cambiate
  const daScrivere = [...stati.values()].filter((s) => s.cambiata && s.riga);
  const ids = new Map<string, string>([...esistenti.values()].map((r) => [r.chiave, r.id]));
  for (const b of blocchi(daScrivere, 100)) {
    const { data } = await misura(misure, "scrittura delle procedure", () =>
      admin.from("radar_procedure").upsert(b.map((s) => s.riga as RigaProcedura), { onConflict: "chiave" }).select("id, chiave").returns<{ id: string; chiave: string }[]>(),
    );
    for (const r of data ?? []) ids.set(r.chiave, r.id);
  }
  for (const s of daScrivere) {
    if (s.iniziale) esito.aggiornate++;
    else esito.nuove++;
    if (s.cambiamenti.some((c) => c.tipo === "rettifica" || c.tipo === "proroga")) esito.rettifiche++;
    if (s.cambiamenti.some((c) => c.tipo === "annullamento")) esito.annullate++;
  }
  esito.soloProvenienza = [...stati.values()].filter((s) => !s.cambiata).length;

  // 4) lotti delle versioni applicate (chiave: procedura + numero del lotto). Un CIG già usato da un'ALTRA procedura non si assegna.
  const righeLotti = daScrivere.flatMap((s) => {
    const id = ids.get(s.riga!.chiave);
    const b = s.bando!;
    if (!id) return [];
    return b.record.lotti
      .filter((l) => !!l.numero)
      .map((l, i) => ({
        procedura_id: id,
        numero_lotto: l.numero as string,
        cig: l.cig,
        oggetto: l.oggetto,
        cpv_principale: l.cpvPrincipale,
        cpv_tutti: l.cpvTutti,
        valore_stimato: l.valoreStimato,
        durata_mesi: l.durataMesi,
        scadenza_giorno: b.lottiScadenze[i]?.giorno ?? null,
        scadenza_offerte: b.lottiScadenze[i]?.iso ?? null,
        scadenza_ora_indicata: b.lottiScadenze[i]?.oraIndicata ?? false,
        scadenza_fonte: b.lottiScadenze[i]?.fonte ?? null,
        url_documenti: b.lottiDocumenti[i] ?? null,
        aggiornato_il: adesso.toISOString(),
      }));
  });
  const cig = [...new Set(righeLotti.map((l) => l.cig).filter((c): c is string => !!c))];
  if (cig.length > 0) {
    const { data } = await misura(misure, "controllo dei CIG", () => admin.from("radar_lotti").select("cig, procedura_id").in("cig", cig).returns<{ cig: string; procedura_id: string }[]>());
    const occupati = new Map((data ?? []).map((r) => [r.cig, r.procedura_id]));
    for (const l of righeLotti) {
      if (l.cig && occupati.has(l.cig) && occupati.get(l.cig) !== l.procedura_id) {
        l.cig = null;
        esito.cigScartati++;
      }
    }
  }
  for (const b of blocchi(righeLotti, 200)) {
    await misura(misure, "scrittura dei lotti", () => admin.from("radar_lotti").upsert(b, { onConflict: "procedura_id,numero_lotto" }));
  }
  esito.lotti = righeLotti.length;

  // 5) provenienza di ogni avviso letto (anche di quelli più vecchi della versione in archivio)
  const righeProvenienza = [...stati.values()].flatMap((s) => {
    const id = ids.get(s.avvisi[0].record.chiaveProcedura);
    return id
      ? s.avvisi.map((v) => ({
          procedura_id: id,
          fonte: "ted",
          id_fonte: v.meta.numero,
          url: v.record.urlAvviso,
          impronta: v.record.impronta,
          pubblicato_il: v.meta.data,
          versione: v.meta.versione,
          tipo_avviso: v.meta.tipo || null,
          motivo_modifica: v.meta.motivoModifica,
          aggiornato_il: adesso.toISOString(),
        }))
      : [];
  });
  for (const b of blocchi(righeProvenienza, 200)) {
    await misura(misure, "scrittura della provenienza", () => admin.from("radar_procedure_fonti").upsert(b, { onConflict: "fonte,id_fonte" }));
  }

  // 6) cambiamenti: «nuova» per le gare entrate ora, poi rettifiche, proroghe, annullamenti. Notificabili solo in sincronizzazione e su gare aperte.
  const righeAggiornamenti = daScrivere.flatMap((s) => {
    const id = ids.get(s.riga!.chiave);
    if (!id) return [];
    const r = s.riga!;
    const prima = s.iniziale;
    const scadenzaOra = { giorno: r.scadenza_giorno, iso: r.scadenza_offerte };
    const eraAperta = prima ? aperta(prima.stato as StatoProcedura, { giorno: prima.scadenza_giorno, iso: prima.scadenza_offerte }, adesso) : false;
    const righe: Record<string, unknown>[] = [];
    if (!prima) righe.push({ procedura_id: id, tipo: "nuova", campo: null, valore_precedente: null, valore_nuovo: null, fonte: "ted", id_fonte: s.bando!.meta.numero, notificabile: notificabile(modo, r.stato, scadenzaOra, adesso) });
    for (const c of s.cambiamenti) {
      righe.push({
        procedura_id: id,
        tipo: c.tipo,
        campo: c.campo,
        valore_precedente: c.prima?.slice(0, 2000) ?? null,
        valore_nuovo: c.dopo?.slice(0, 2000) ?? null,
        fonte: "ted",
        id_fonte: c.idFonte,
        notificabile: modo === "incrementale" && (eraAperta || aperta(r.stato, scadenzaOra, adesso)),
      });
    }
    return righe;
  });
  for (const b of blocchi(righeAggiornamenti, 200)) {
    await misura(misure, "registro dei cambiamenti", () => admin.from("radar_aggiornamenti").upsert(b, { onConflict: "procedura_id,tipo,campo,id_fonte", ignoreDuplicates: true }));
  }

  // 7) gare aggiunte a mano con lo stesso CIG: si collegano alla gara pubblica (tabella riservata, scritta solo dal server)
  const cigAssegnati = righeLotti.filter((l) => l.cig).map((l) => ({ cig: l.cig as string, procedura_id: l.procedura_id }));
  for (const { cig: c, procedura_id } of cigAssegnati) {
    const { data } = await misura(misure, "collegamento delle gare aggiunte", () =>
      admin.from("omnia_ai_radar_gare_aggiunte").update({ procedura_id, collegata_il: adesso.toISOString(), aggiornata_il: adesso.toISOString() }).eq("cig", c).is("procedura_id", null).select("id"),
    );
    esito.aggiunteCollegate += (data ?? []).length;
  }

  return esito;
}

export async function applicaPaginaEsiti(admin: SupabaseClient, esiti: EsitoTed[], modo: ModoImportazione, adesso: Date, misure: Misure): Promise<EsitoPaginaEsiti> {
  const esito: EsitoPaginaEsiti = { letti: esiti.length, applicati: 0, senzaBando: 0, invariati: 0, senzaStato: 0 };
  const conStato = esiti.filter((e) => e.stato !== null);
  esito.senzaStato = esiti.length - conStato.length;
  if (conStato.length === 0) return esito;

  const improntaEsito = (e: EsitoTed) => impronta({ stato: e.stato, lotti: e.lotti, procedura: e.meta.procedureId });
  const impronte = new Map<string, string | null>();
  for (const b of blocchi([...new Set(conStato.map((e) => e.meta.numero))], 100)) {
    const { data } = await misura(misure, "lettura della provenienza degli esiti", () => admin.from("radar_procedure_fonti").select("id_fonte, impronta").eq("fonte", "ted").in("id_fonte", b).returns<{ id_fonte: string; impronta: string | null }[]>());
    for (const r of data ?? []) impronte.set(r.id_fonte, r.impronta);
  }
  const nuovi = conStato.filter((e) => impronte.get(e.meta.numero) !== improntaEsito(e));
  esito.invariati = conStato.length - nuovi.length;
  if (nuovi.length === 0) return esito;

  const procedure = new Map<string, { id: string; stato: StatoProcedura }>();
  for (const b of blocchi([...new Set(nuovi.map((e) => chiaveProceduraTed(e.meta.procedureId)))], 80)) {
    const { data } = await misura(misure, "lettura delle procedure per gli esiti", () => admin.from("radar_procedure").select("id, chiave, stato").in("chiave", b).returns<{ id: string; chiave: string; stato: StatoProcedura }[]>());
    for (const r of data ?? []) procedure.set(r.chiave, { id: r.id, stato: r.stato });
  }

  const cambi = new Map<string, { id: string; prima: StatoProcedura; dopo: StatoProcedura; idFonte: string }>();
  const provenienza: Record<string, unknown>[] = [];
  for (const e of [...nuovi].sort((a, b) => confronta(a.meta, b.meta))) {
    const p = procedure.get(chiaveProceduraTed(e.meta.procedureId));
    if (!p) {
      esito.senzaBando++;
      continue;
    }
    provenienza.push({ procedura_id: p.id, fonte: "ted", id_fonte: e.meta.numero, url: `https://ted.europa.eu/it/notice/-/detail/${e.meta.numero}`, impronta: improntaEsito(e), pubblicato_il: e.meta.data, versione: e.meta.versione, tipo_avviso: e.meta.tipo || null, motivo_modifica: e.meta.motivoModifica, aggiornato_il: adesso.toISOString() });
    const attuale = cambi.get(p.id)?.dopo ?? p.stato;
    const dopo = statoDopoEsito(attuale, e.stato);
    if (dopo) cambi.set(p.id, { id: p.id, prima: cambi.get(p.id)?.prima ?? p.stato, dopo, idFonte: e.meta.numero });
  }

  for (const stato of ["aggiudicata", "chiusa_senza_aggiudicazione"] as const) {
    const idsStato = [...cambi.values()].filter((c) => c.dopo === stato).map((c) => c.id);
    for (const b of blocchi(idsStato, 100)) {
      await misura(misure, "stato dopo l'esito", () => admin.from("radar_procedure").update({ stato, ultima_rilevazione_il: adesso.toISOString(), aggiornata_il: adesso.toISOString() }).in("id", b));
    }
  }
  esito.applicati = cambi.size;
  for (const b of blocchi(provenienza, 200)) {
    await misura(misure, "provenienza degli esiti", () => admin.from("radar_procedure_fonti").upsert(b, { onConflict: "fonte,id_fonte" }));
  }
  const righe = [...cambi.values()].map((c) => ({ procedura_id: c.id, tipo: "esito", campo: "stato", valore_precedente: c.prima, valore_nuovo: c.dopo, fonte: "ted", id_fonte: c.idFonte, notificabile: modo === "incrementale" }));
  for (const b of blocchi(righe, 200)) {
    await misura(misure, "registro degli esiti", () => admin.from("radar_aggiornamenti").upsert(b, { onConflict: "procedura_id,tipo,campo,id_fonte", ignoreDuplicates: true }));
  }
  return esito;
}

export { ErroreDb };
