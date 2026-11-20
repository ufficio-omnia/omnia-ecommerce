// Scrittura nell'archivio pubblico delle pagine lette da TED: procedure, lotti, provenienza, cambiamenti. Solo server, chiave di servizio.
// Le regole stanno in importa-calcoli.ts e unione-calcoli.ts; qui solo le letture e le scritture, a blocchi (poche richieste per pagina).
//
// Per pagina: 1 lettura della provenienza (avvisi già letti con la stessa impronta = nessuna scrittura), 1 lettura delle procedure,
// 1 scrittura delle procedure cambiate, 1-2 per i lotti, 1 per la provenienza, 1 per i cambiamenti, 1 per collegare le gare aggiunte a mano.
//
// Fase B1-bis (PVL, solo staging): la stessa gara può essere arrivata PRIMA dalla PVL («pvl:<idAppalto>», con il numero dell'avviso TED
// citato in radar_procedure_fonti.rif_ted). TED allora si unisce a quella gara invece di crearne un'altra (2 letture in più, solo per gli
// avvisi non trovati per chiave); i lotti di quelle gare si uniscono senza cancellare CIG e documenti portati dalla PVL.
import type { SupabaseClient } from "@supabase/supabase-js";
import { eEsclusione, impronta, type BandoTed, type EsclusioneTed, type EsitoTed, chiaveProceduraTed } from "./fonti/ted-calcoli";
import { notificabile, piuRecente, rigaDaBando, statoDopoEsito, aperta, type Cambiamento, type ModoImportazione, type RigaProcedura, type StatoProcedura } from "./importa-calcoli";
import { unisciLotti, unisciVersione, type LottoUnito, type ProvenienzaCampi, type VersioneFonte } from "./unione-calcoli";
import { collegaDoppioniPerAvvisoTed } from "./collegamenti";
import { ambiguitaTraFonti, classificaPerArchivio, rigaSegnalazioneClassificazione } from "./classificazione-unita";
import { fontiDellaGara } from "./fonti-gara-calcoli";
import { scriviClassificazioni, type EsitoClassificazioni } from "./classificazioni";
import { cambiaColonna, classificaImportazione, lottiDopoScrittura, righeImportate, rigaRegistroImportazione, type ClassificazioneImportata } from "./classificazioni-importazione";
import { evidenzaDellaRiga, type AvvisoDellaModifica, type RigaRegistro } from "./importa-evidenza";

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
  // gare già arrivate dalla PVL a cui TED si è unito (nessuna gara doppia)
  unitePvl: number;
  // gare doppie riconosciute dopo e collegate in modo reversibile (0117)
  collegateDoppie: number;
  // fase B2b (solo con l'interruttore acceso): righe e stato della 0121; null se spento o non scritte
  classificazioni?: EsitoClassificazioni | null;
  classificazioniErrore?: string | null;
};

// Fase B2b: classificazioni della 0121 tenute dentro il giro TED (interruttore di ambiente.ts, SPENTO di base).
// fase B4: «evidenza» = colonne della 0123 nel registro (importa-evidenza.ts, interruttore RADAR_REGISTRO_EVIDENZA, SPENTO di base)
export type OpzioniPaginaTed = { classificazioni?: boolean; nuovoId?: () => string; evidenza?: boolean; esecuzioneId?: string | null };

export type EsitoPaginaEsiti = { letti: number; applicati: number; senzaBando: number; invariati: number; senzaStato: number };

export const COLONNE_RIGA =
  "id, chiave, oggetto, oggetto_breve, descrizione, sa_codice_fiscale, sa_denominazione, sa_comune, sa_provincia, sa_regione, codice_nuts, luogo_regioni, ente_tipo, tipo_avviso, tipo_procedura, criterio_aggiudicazione, natura_contratto, settori_speciali, data_pubblicazione, scadenza_giorno, scadenza_offerte, scadenza_ora_indicata, scadenza_fonte, valore_stimato, durata_mesi, n_lotti, stato, rettificata, url_avviso, url_documenti, piattaforma_host, cpv_principale, cpv_tutti, settori, metodo_settore, ultima_versione_il, ultima_versione_id, ultima_rilevazione_il, aggiornata_il, valore_base, piattaforma_id, tipo_opportunita, partecipazione";

const COLONNE_LOTTO = "procedura_id, numero_lotto, cig, oggetto, cpv_principale, cpv_tutti, valore_stimato, durata_mesi, scadenza_giorno, scadenza_offerte, scadenza_ora_indicata, scadenza_fonte, url_documenti";

const COLONNE_SCRITTE = COLONNE_RIGA.split(",")
  .map((c) => c.trim())
  .filter((c) => c !== "id") as (keyof RigaProcedura)[];

// La riga da scrivere: SOLO le colonne della gara più la provenienza per campo. Mai «id» né altri campi letti dal database: in un upsert a
// blocchi le righe devono avere tutte le stesse colonne (una gara nuova senza «id» accanto a una esistente con «id» farebbe fallire il blocco).
export function rigaDaScrivere(r: RigaProcedura, provenienza: ProvenienzaCampi | null): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const c of COLONNE_SCRITTE) out[c] = r[c];
  out.provenienza_campi = provenienza ?? {};
  return out;
}

class ErroreDb extends Error {}

export async function misura<T extends { error: { message: string } | null }>(misure: Misure, passo: string, f: () => PromiseLike<T>): Promise<T> {
  const inizio = Date.now();
  const r = await f();
  misure.richiesteDb++;
  misure.msDb += Date.now() - inizio;
  if (r.error) throw new ErroreDb(`${passo}: ${r.error.message}`);
  return r;
}

export function blocchi<T>(v: readonly T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < v.length; i += n) out.push(v.slice(i, i + n));
  return out;
}

type RigaDb = RigaProcedura & { id: string; valore_stimato: number | string | null; provenienza_campi?: ProvenienzaCampi | null; unita_a?: string | null };
type RigaArchivio = RigaProcedura & { id: string; provenienza_campi: ProvenienzaCampi | null; unita_a?: string | null };

// Gare collegate a un'altra (0117): ogni gara trovata si risolve nella gara che resta, come nella scrittura unica (importa-fonti-pagina.ts,
// rilievo C1), così una nuova versione o un esito TED arriva alla gara che il cliente vede. Le unioni non creano catene (collegamenti.ts);
// per prudenza si scende al massimo di 3 passi. Una lettura per passo, e solo se qualche gara trovata è collegata (di solito nessuna).
// Restituisce: id della gara trovata → gara che resta.
export async function gareCheRestano<T extends { id: string; unita_a?: string | null }>(
  admin: SupabaseClient,
  trovate: readonly T[],
  colonne: string,
  normalizza: (r: Record<string, unknown>) => T,
  misure: Misure,
): Promise<Map<string, T>> {
  const out = new Map<string, T>();
  let daRisolvere = trovate.filter((r) => !!r.unita_a).map((r) => ({ origine: r.id, verso: r.unita_a as string }));
  for (let passo = 0; passo < 3 && daRisolvere.length > 0; passo++) {
    const perId = new Map<string, T>();
    for (const b of blocchi([...new Set(daRisolvere.map((d) => d.verso))], 80)) {
      const { data } = await misura(misure, "gare che restano dopo un collegamento", () => admin.from("radar_procedure").select(colonne).in("id", b).returns<Record<string, unknown>[]>());
      for (const r of data ?? []) perId.set(String(r.id), normalizza(r));
    }
    const ancora: { origine: string; verso: string }[] = [];
    for (const d of daRisolvere) {
      const r = perId.get(d.verso);
      if (!r) continue;
      out.set(d.origine, r);
      if (r.unita_a) ancora.push({ origine: d.origine, verso: r.unita_a });
    }
    daRisolvere = ancora;
  }
  return out;
}

function normalizzaRiga(r: RigaDb): RigaArchivio {
  return { ...r, valore_stimato: r.valore_stimato === null ? null : Number(r.valore_stimato), provenienza_campi: r.provenienza_campi ?? null };
}

function confronta(a: { data: string; numero: string }, b: { data: string; numero: string }): number {
  if (piuRecente(a, b)) return 1;
  if (piuRecente(b, a)) return -1;
  return 0;
}

function versioneTed(v: BandoTed): VersioneFonte {
  return { fonte: "ted", id: v.meta.numero, giorno: v.meta.data, istante: null, ted: v.meta.numero };
}

// La gara ha già dati di un'altra fonte (PVL)? Solo allora servono le regole di unione dei lotti.
function haAltreFonti(r: RigaArchivio | null): boolean {
  if (!r) return false;
  if (r.chiave.startsWith("pvl:")) return true;
  return Object.values(r.provenienza_campi ?? {}).some((p) => p && p.f !== "ted");
}

// I lotti di un avviso TED nella forma dell'archivio (solo i lotti con il numero).
function lottiDaBandoTed(b: BandoTed): LottoUnito[] {
  return b.record.lotti
    .map((l, i) => ({ l, i }))
    .filter(({ l }) => !!l.numero)
    .map(({ l, i }) => ({
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
    }));
}

export async function applicaPaginaBandi(admin: SupabaseClient, avvisi: (BandoTed | EsclusioneTed)[], modo: ModoImportazione, adesso: Date, misure: Misure, opzioni: OpzioniPaginaTed = {}): Promise<EsitoPaginaBandi> {
  const esito: EsitoPaginaBandi = { letti: avvisi.length, esclusi: {}, invariati: 0, nuove: 0, aggiornate: 0, soloProvenienza: 0, rettifiche: 0, annullate: 0, lotti: 0, cigScartati: 0, aggiunteCollegate: 0, unitePvl: 0, collegateDoppie: 0 };
  const validi: BandoTed[] = [];
  for (const a of avvisi) {
    if (eEsclusione(a)) esito.esclusi[a.motivo] = (esito.esclusi[a.motivo] ?? 0) + 1;
    else validi.push(a);
  }
  if (validi.length === 0) return esito;
  const iso = adesso.toISOString();

  // 1) avvisi già letti con la stessa impronta: nessuna scrittura
  const impronte = new Map<string, string | null>();
  for (const b of blocchi([...new Set(validi.map((v) => v.meta.numero))], 100)) {
    const { data } = await misura(misure, "lettura della provenienza", () => admin.from("radar_procedure_fonti").select("id_fonte, impronta").eq("fonte", "ted").in("id_fonte", b).returns<{ id_fonte: string; impronta: string | null }[]>());
    for (const r of data ?? []) impronte.set(r.id_fonte, r.impronta);
  }
  const daApplicare = validi.filter((v) => impronte.get(v.meta.numero) !== v.record.impronta);
  esito.invariati = validi.length - daApplicare.length;
  if (daApplicare.length === 0) return esito;

  // 2) procedure già in archivio: per chiave TED; per gli avvisi non trovati, una gara arrivata prima dalla PVL che cita lo stesso avviso TED
  const chiavi = [...new Set(daApplicare.map((v) => v.record.chiaveProcedura))];
  const esistenti = new Map<string, RigaArchivio>();
  for (const b of blocchi(chiavi, 80)) {
    const { data } = await misura(misure, "lettura delle procedure", () => admin.from("radar_procedure").select(`${COLONNE_RIGA}, provenienza_campi, unita_a`).in("chiave", b).returns<RigaDb[]>());
    for (const r of data ?? []) esistenti.set(r.chiave, normalizzaRiga(r));
  }
  const senzaGara = daApplicare.filter((v) => !esistenti.has(v.record.chiaveProcedura));
  if (senzaGara.length > 0) {
    // a) la stessa procedura TED già unita a una gara con un'altra chiave (gara nata dalla PVL): una rettifica TED con un numero nuovo
    const perProcedura = new Map<string, string>();
    for (const b of blocchi([...new Set(senzaGara.map((v) => v.meta.procedureId))], 100)) {
      const { data } = await misura(misure, "lettura delle procedure TED già unite", () => admin.from("radar_procedure_fonti").select("id_procedura_fonte, procedura_id").eq("fonte", "ted").in("id_procedura_fonte", b).returns<{ id_procedura_fonte: string; procedura_id: string }[]>());
      for (const r of data ?? []) perProcedura.set(r.id_procedura_fonte, r.procedura_id);
    }
    // b) l'avviso TED citato da un avviso PVL già letto
    const perTed = new Map<string, string>();
    const daCercare = [...new Set(senzaGara.filter((v) => !perProcedura.has(v.meta.procedureId)).map((v) => v.meta.numero))];
    for (const b of blocchi(daCercare, 100)) {
      const { data } = await misura(misure, "lettura delle gare già arrivate dalla PVL", () => admin.from("radar_procedure_fonti").select("rif_ted, procedura_id").eq("fonte", "pvl").in("rif_ted", b).returns<{ rif_ted: string; procedura_id: string }[]>());
      for (const r of data ?? []) perTed.set(r.rif_ted, r.procedura_id);
    }
    const garaDi = (v: BandoTed) => perProcedura.get(v.meta.procedureId) ?? perTed.get(v.meta.numero);
    const ids = [...new Set(senzaGara.map(garaDi).filter((x): x is string => !!x))];
    const perId = new Map<string, RigaArchivio>();
    for (const b of blocchi(ids, 80)) {
      const { data } = await misura(misure, "lettura delle gare PVL da unire", () => admin.from("radar_procedure").select(`${COLONNE_RIGA}, provenienza_campi, unita_a`).in("id", b).returns<RigaDb[]>());
      for (const r of data ?? []) perId.set(r.id, normalizzaRiga(r));
    }
    for (const v of senzaGara) {
      const id = garaDi(v);
      const r = id ? perId.get(id) : undefined;
      // la chiave TED della procedura punta alla gara già esistente (che conserva la sua chiave)
      if (r) esistenti.set(v.record.chiaveProcedura, r);
    }
  }
  // 2bis) gare collegate a un'altra (0117): la versione va alla gara che resta (che conserva la sua chiave)
  const restaDi = await gareCheRestano(admin, [...esistenti.values()], `${COLONNE_RIGA}, provenienza_campi, unita_a`, (r) => normalizzaRiga(r as RigaDb), misure);
  const risolte = new Set<string>();
  for (const [k, r] of esistenti) {
    const resta = restaDi.get(r.id);
    if (resta) {
      esistenti.set(k, resta);
      risolte.add(k);
    }
  }

  type Stato = {
    iniziale: RigaArchivio | null;
    riga: RigaProcedura | null;
    provenienza: ProvenienzaCampi | null;
    cambiata: boolean;
    bando: BandoTed | null;
    ultimaApplicata: boolean;
    cambiamenti: (Cambiamento & { idFonte: string })[];
    avvisi: BandoTed[];
    // la gara è stata raggiunta passando da una gara collegata: i lotti si uniscono a quelli della gara che resta, non si sovrascrivono
    risolta: boolean;
  };
  const stati = new Map<string, Stato>();
  for (const v of [...daApplicare].sort((a, b) => confronta(a.meta, b.meta))) {
    const iniziale = esistenti.get(v.record.chiaveProcedura) ?? null;
    // una sola unione per gara: due procedure TED che arrivano alla stessa gara (per esempio la gara che resta) si uniscono in sequenza
    const chiave = iniziale?.chiave ?? v.record.chiaveProcedura;
    const s = stati.get(chiave) ?? { iniziale, riga: iniziale, provenienza: iniziale?.provenienza_campi ?? null, cambiata: false, bando: null, ultimaApplicata: false, cambiamenti: [], avvisi: [], risolta: false };
    if (risolte.has(v.record.chiaveProcedura)) s.risolta = true;
    s.avvisi.push(v);
    // stesse regole di prima per le gare di sola fonte TED (unisciVersione le rispetta); regole di unione se c'è anche la PVL
    const u = unisciVersione(s.riga, s.provenienza, rigaDaBando(v, null, adesso), versioneTed(v), iso);
    const toccata = !s.riga || u.ultima || u.campiPresi.length > 0;
    if (toccata) {
      s.riga = u.riga;
      s.provenienza = u.provenienza;
      s.cambiata = true;
      if (u.ultima || !s.bando) s.bando = v;
      if (u.ultima) s.ultimaApplicata = true;
      s.cambiamenti.push(...u.cambiamenti.map((c) => ({ ...c, idFonte: v.meta.numero })));
      // fase B4 (26B §6.2 punto 6), solo con l'evidenza: un avviso UFFICIALE di modifica (codice del motivo) su una gara già in archivio
      // che non cambia nessun campo confrontato diventa una riga «rettifica» con campo «avviso» (l'email rimanda all'avviso, senza supporre)
      if (opzioni.evidenza && iniziale && u.ultima && v.meta.motivoModifica && v.meta.motivoModifica !== "cancel" && u.cambiamenti.length === 0) {
        s.cambiamenti.push({ tipo: "rettifica", campo: "avviso", prima: null, dopo: null, idFonte: v.meta.numero });
      }
    }
    stati.set(chiave, s);
  }

  // 2ter) fase B2b, SOLO con l'interruttore acceso: classificazione sui dati uniti con i lotti che resteranno in archivio (una lettura dei
  //       lotti delle gare esistenti, riusata per l'unione dei lotti); la colonna «settori» diventa quella delle righe
  const classificazioni = new Map<Stato, ClassificazioneImportata>();
  const lottiPrima = new Map<string, LottoUnito[]>();
  if (opzioni.classificazioni) {
    const toccate = [...stati.values()].filter((s) => s.cambiata && s.riga && s.bando);
    for (const b of blocchi([...new Set(toccate.map((s) => s.iniziale?.id).filter((x): x is string => !!x))], 80)) {
      const { data } = await misura(misure, "lettura dei lotti da classificare", () => admin.from("radar_lotti").select(COLONNE_LOTTO).in("procedura_id", b).returns<(LottoUnito & { procedura_id: string; valore_stimato: number | string | null })[]>());
      for (const l of data ?? []) lottiPrima.set(l.procedura_id, [...(lottiPrima.get(l.procedura_id) ?? []), { ...l, valore_stimato: l.valore_stimato === null ? null : Number(l.valore_stimato), cpv_tutti: l.cpv_tutti ?? [] }]);
    }
    for (const s of toccate) {
      const nuovi = lottiDaBandoTed(s.bando as BandoTed);
      const prima = s.iniziale ? (lottiPrima.get(s.iniziale.id) ?? []) : [];
      const lottiFinali = !s.iniziale ? nuovi : haAltreFonti(s.iniziale) || s.risolta ? unisciLotti(prima, nuovi, "ted", s.ultimaApplicata).lotti : lottiDopoScrittura(prima, nuovi);
      const ci = classificaImportazione({
        dati: s.riga as RigaProcedura,
        lotti: lottiFinali,
        fonte: "ted",
        versioneFonte: { dati: rigaDaBando(s.bando as BandoTed, null, adesso), lotti: nuovi },
        prima: s.iniziale ? { dati: s.iniziale, lotti: prima, fonti: fontiDellaGara(s.iniziale.chiave, s.iniziale.provenienza_campi) } : null,
      });
      classificazioni.set(s, ci);
      if (cambiaColonna(s.riga as RigaProcedura, ci)) s.riga = { ...(s.riga as RigaProcedura), settori: ci.settori, metodo_settore: ci.metodo ?? (s.riga as RigaProcedura).metodo_settore };
    }
  }

  // 3) procedure nuove o cambiate
  const daScrivere = [...stati.values()].filter((s) => s.cambiata && s.riga);
  const ids = new Map<string, string>([...esistenti.values()].map((r) => [r.chiave, r.id]));
  for (const b of blocchi(daScrivere, 100)) {
    const { data } = await misura(misure, "scrittura delle procedure", () =>
      admin
        .from("radar_procedure")
        .upsert(
          b.map((s) => rigaDaScrivere(s.riga as RigaProcedura, s.provenienza)),
          { onConflict: "chiave" },
        )
        .select("id, chiave")
        .returns<{ id: string; chiave: string }[]>(),
    );
    for (const r of data ?? []) ids.set(r.chiave, r.id);
  }
  for (const s of daScrivere) {
    if (s.iniziale) esito.aggiornate++;
    else esito.nuove++;
    if (s.iniziale && haAltreFonti(s.iniziale)) esito.unitePvl++;
    if (s.cambiamenti.some((c) => c.tipo === "rettifica" || c.tipo === "proroga")) esito.rettifiche++;
    if (s.cambiamenti.some((c) => c.tipo === "annullamento")) esito.annullate++;
  }
  esito.soloProvenienza = [...stati.values()].filter((s) => !s.cambiata).length;

  // 4) lotti delle versioni applicate (chiave: procedura + numero del lotto). Un CIG già usato da un'ALTRA procedura non si assegna.
  //    Nelle gare che hanno anche la PVL i lotti si uniscono (CIG e documenti della PVL restano).
  const conPvl = daScrivere.filter((s) => haAltreFonti(s.iniziale) || s.risolta);
  const lottiPvl = new Map<string, LottoUnito[]>();
  const idsPvl = conPvl.map((s) => s.iniziale?.id).filter((x): x is string => !!x);
  // con l'interruttore acceso i lotti sono già stati letti (2ter): nessuna lettura in più
  if (opzioni.classificazioni) for (const id of idsPvl) lottiPvl.set(id, lottiPrima.get(id) ?? []);
  for (const b of opzioni.classificazioni ? [] : blocchi(idsPvl, 80)) {
    const { data } = await misura(misure, "lettura dei lotti da unire", () => admin.from("radar_lotti").select(COLONNE_LOTTO).in("procedura_id", b).returns<(LottoUnito & { procedura_id: string; valore_stimato: number | string | null })[]>());
    for (const l of data ?? []) {
      const v = lottiPvl.get(l.procedura_id) ?? [];
      v.push({ ...l, valore_stimato: l.valore_stimato === null ? null : Number(l.valore_stimato), cpv_tutti: l.cpv_tutti ?? [] });
      lottiPvl.set(l.procedura_id, v);
    }
  }
  // classificatore unico (classificazione-unita.ts): sulle gare che hanno anche un'altra fonte si confrontano TED, la gara di prima e i dati
  // uniti; le differenze si segnalano all'amministratore (i settori restano l'unione delle fonti, come prima)
  const segnalazioni: Record<string, unknown>[] = [];
  const righeLotti = daScrivere.flatMap((s) => {
    const id = ids.get(s.riga!.chiave);
    const b = s.bando!;
    if (!id) return [];
    const nuovi = lottiDaBandoTed(b);
    if (haAltreFonti(s.iniziale) || s.risolta) {
      const u = unisciLotti(lottiPvl.get(id) ?? [], nuovi, "ted", s.ultimaApplicata);
      esito.cigScartati += u.cigScartati;
      const prima = s.iniziale as RigaArchivio;
      const amb = ambiguitaTraFonti({
        fonte: "ted",
        altreFonti: fontiDellaGara(prima.chiave, prima.provenienza_campi),
        daFonte: classificaPerArchivio(rigaDaBando(b, null, adesso), nuovi),
        altre: classificaPerArchivio(prima, lottiPvl.get(id) ?? []),
        unita: classificaPerArchivio(s.riga as RigaProcedura, u.lotti),
      });
      if (amb) segnalazioni.push(rigaSegnalazioneClassificazione(id, amb));
      return u.lotti.map((l) => ({ ...l, procedura_id: id, aggiornato_il: iso }));
    }
    return nuovi.map((l) => ({ ...l, procedura_id: id, aggiornato_il: iso }));
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

  // 5) provenienza di ogni avviso letto (anche di quelli più vecchi della versione in archivio), con l'identificativo della procedura TED
  const righeProvenienza = [...stati.values()].flatMap((s) => {
    const id = s.riga ? ids.get(s.riga.chiave) : undefined;
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
          id_procedura_fonte: v.meta.procedureId,
          aggiornato_il: iso,
        }))
      : [];
  });
  for (const b of blocchi(righeProvenienza, 200)) {
    await misura(misure, "scrittura della provenienza", () => admin.from("radar_procedure_fonti").upsert(b, { onConflict: "fonte,id_fonte" }));
  }

  // 6) cambiamenti: «nuova» per le gare entrate ora (mai quando TED si unisce a una gara già arrivata dalla PVL), poi rettifiche, proroghe,
  //    annullamenti. Notificabili solo in sincronizzazione e su gare aperte.
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
        // mai su una gara collegata a un'altra: la notifica è della gara che resta
        notificabile: modo === "incrementale" && !prima?.unita_a && (eraAperta || aperta(r.stato, scadenzaOra, adesso)),
      });
    }
    // fase B2b: il cambio della colonna «settori» di una gara che esisteva già (mai notificabile)
    const ci = classificazioni.get(s);
    if (ci && prima) {
      const traccia = rigaRegistroImportazione(id, { settori: [...prima.settori], metodo: prima.metodo_settore }, ci, "ted", s.bando!.meta.numero);
      if (traccia) righe.push(traccia);
    }
    return righe;
  });
  // classificazioni diverse tra le fonti: mai notificabili, mai mostrate ai clienti
  righeAggiornamenti.push(...segnalazioni);
  // fase B4 (0123), solo con l'evidenza: le colonne dell'avviso su OGNI riga di questa scrittura (stesse colonne per tutte; notifica_email
  // vero solo per modifiche verificate e notificabili: importa-evidenza.ts)
  if (opzioni.evidenza) {
    const perNumero = new Map<string, BandoTed>();
    const precedente = new Map<string, string | null>();
    for (const s of stati.values()) {
      for (const v of s.avvisi) perNumero.set(v.meta.numero, v);
      const id = s.riga ? ids.get(s.riga.chiave) : undefined;
      if (id) precedente.set(id, s.iniziale?.ultima_versione_id ?? null);
    }
    for (let i = 0; i < righeAggiornamenti.length; i++) {
      const r = righeAggiornamenti[i] as RigaRegistro & { procedura_id: string; id_fonte: string | null };
      const v = r.id_fonte ? perNumero.get(r.id_fonte) : undefined;
      const avviso: AvvisoDellaModifica = {
        fonte: "ted",
        idAvviso: String(r.id_fonte ?? ""),
        idAvvisoPrecedente: precedente.get(r.procedura_id) ?? null,
        url: v?.record.urlAvviso ?? null,
        pubblicatoIl: v?.meta.data ?? null,
        versione: v?.meta.versione ?? null,
        tipo: v?.meta.tipo || null,
        avvisoTed: v ? v.meta.numero : null,
        dichiarazione: v?.meta.motivoModifica ?? null,
      };
      righeAggiornamenti[i] = { ...righeAggiornamenti[i], ...evidenzaDellaRiga({ ...r, fonte: "ted" }, avviso, opzioni.esecuzioneId ?? null) };
    }
  }
  for (const b of blocchi(righeAggiornamenti, 200)) {
    await misura(misure, "registro dei cambiamenti", () => admin.from("radar_aggiornamenti").upsert(b, { onConflict: "procedura_id,tipo,campo,id_fonte", ignoreDuplicates: true }));
  }

  // 6bis) fase B2b, SOLO con l'interruttore acceso: righe della 0121 e stato, dentro questo giro. Un errore qui non ferma l'importazione
  if (opzioni.classificazioni) {
    const nuovoId = opzioni.nuovoId ?? (() => crypto.randomUUID());
    const voci = daScrivere.flatMap((s) => {
      const id = ids.get(s.riga!.chiave);
      const ci = classificazioni.get(s);
      if (!id || !ci) return [];
      const fonti = [...(s.iniziale ? fontiDellaGara(s.iniziale.chiave, s.iniziale.provenienza_campi) : []), "ted"];
      return [{ proceduraId: id, versione: ci.unita.versione, calcolate: righeImportate(ci, { proceduraId: id, fonti, fonte: "ted", adessoIso: iso, nuovoId }) }];
    });
    try {
      esito.classificazioni = await scriviClassificazioni(admin, voci, misure, iso);
    } catch (e) {
      esito.classificazioniErrore = e instanceof Error ? e.message : String(e);
      console.warn(`Classificazioni non scritte (ted): ${esito.classificazioniErrore}`);
    }
  }

  // 7) gare aggiunte a mano con lo stesso CIG: si collegano alla gara pubblica (tabella riservata, scritta solo dal server)
  esito.aggiunteCollegate += await collegaAggiunte(admin, righeLotti, iso, misure);

  // 8) gare doppie (es. rettifica PVL letta prima del bando TED): collegamento reversibile, tracciato, senza cancellare nulla (0117)
  esito.collegateDoppie += (await collegaDoppioniPerAvvisoTed(admin, daApplicare.map((v) => v.meta.numero), iso, misure)).collegate;

  return esito;
}

// Collega alle gare pubbliche le gare aggiunte a mano dalle imprese con lo stesso CIG: UNA lettura per blocco di CIG, poi una scrittura
// solo per i CIG davvero in attesa (di solito nessuno). Prima: una scrittura per ogni CIG letto.
export async function collegaAggiunte(admin: SupabaseClient, lotti: readonly { cig: string | null; procedura_id: string }[], iso: string, misure: Misure): Promise<number> {
  const perCig = new Map<string, string>();
  for (const l of lotti) if (l.cig) perCig.set(l.cig, l.procedura_id);
  if (perCig.size === 0) return 0;
  const inAttesa = new Set<string>();
  for (const b of blocchi([...perCig.keys()], 150)) {
    const { data } = await misura(misure, "gare aggiunte in attesa", () => admin.from("omnia_ai_radar_gare_aggiunte").select("cig").in("cig", b).is("procedura_id", null).returns<{ cig: string }[]>());
    for (const r of data ?? []) inAttesa.add(r.cig);
  }
  let collegate = 0;
  for (const c of inAttesa) {
    const { data } = await misura(misure, "collegamento delle gare aggiunte", () =>
      admin.from("omnia_ai_radar_gare_aggiunte").update({ procedura_id: perCig.get(c), collegata_il: iso, aggiornata_il: iso }).eq("cig", c).is("procedura_id", null).select("id"),
    );
    collegate += (data ?? []).length;
  }
  return collegate;
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

  const procedure = new Map<string, { id: string; stato: StatoProcedura; unita_a?: string | null }>();
  for (const b of blocchi([...new Set(nuovi.map((e) => chiaveProceduraTed(e.meta.procedureId)))], 80)) {
    const { data } = await misura(misure, "lettura delle procedure per gli esiti", () => admin.from("radar_procedure").select("id, chiave, stato, unita_a").in("chiave", b).returns<{ id: string; chiave: string; stato: StatoProcedura; unita_a: string | null }[]>());
    for (const r of data ?? []) procedure.set(r.chiave, { id: r.id, stato: r.stato, unita_a: r.unita_a });
  }
  // gare arrivate prima dalla PVL e poi unite a TED: si trovano con l'identificativo della procedura TED salvato nella provenienza
  const mancanti = [...new Set(nuovi.map((e) => e.meta.procedureId).filter((p) => !procedure.has(chiaveProceduraTed(p))))];
  if (mancanti.length > 0) {
    const perProc = new Map<string, string>();
    for (const b of blocchi(mancanti, 100)) {
      const { data } = await misura(misure, "lettura delle gare unite per gli esiti", () => admin.from("radar_procedure_fonti").select("id_procedura_fonte, procedura_id").eq("fonte", "ted").in("id_procedura_fonte", b).returns<{ id_procedura_fonte: string; procedura_id: string }[]>());
      for (const r of data ?? []) perProc.set(r.id_procedura_fonte, r.procedura_id);
    }
    const ids = [...new Set(perProc.values())];
    for (const b of blocchi(ids, 100)) {
      const { data } = await misura(misure, "lettura dello stato delle gare unite", () => admin.from("radar_procedure").select("id, stato, unita_a").in("id", b).returns<{ id: string; stato: StatoProcedura; unita_a: string | null }[]>());
      const stati = new Map((data ?? []).map((r) => [r.id, r]));
      for (const [proc, id] of perProc) {
        const r = stati.get(id);
        if (r) procedure.set(chiaveProceduraTed(proc), { id, stato: r.stato, unita_a: r.unita_a });
      }
    }
  }
  // gare collegate a un'altra (0117): l'esito va alla gara che resta (come la versione nuova del bando)
  const restaEsiti = await gareCheRestano(admin, [...procedure.values()], "id, stato, unita_a", (r) => ({ id: String(r.id), stato: r.stato as StatoProcedura, unita_a: (r.unita_a as string | null) ?? null }), misure);
  for (const [k, p] of procedure) {
    const resta = restaEsiti.get(p.id);
    if (resta) procedure.set(k, resta);
  }
  const ancoraCollegate = new Set([...procedure.values()].filter((p) => !!p.unita_a).map((p) => p.id));

  const cambi = new Map<string, { id: string; prima: StatoProcedura; dopo: StatoProcedura; idFonte: string }>();
  const provenienza: Record<string, unknown>[] = [];
  for (const e of [...nuovi].sort((a, b) => confronta(a.meta, b.meta))) {
    const p = procedure.get(chiaveProceduraTed(e.meta.procedureId));
    if (!p) {
      esito.senzaBando++;
      continue;
    }
    provenienza.push({ procedura_id: p.id, fonte: "ted", id_fonte: e.meta.numero, url: `https://ted.europa.eu/it/notice/-/detail/${e.meta.numero}`, impronta: improntaEsito(e), pubblicato_il: e.meta.data, versione: e.meta.versione, tipo_avviso: e.meta.tipo || null, motivo_modifica: e.meta.motivoModifica, id_procedura_fonte: e.meta.procedureId, aggiornato_il: adesso.toISOString() });
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
  const righe = [...cambi.values()].map((c) => ({ procedura_id: c.id, tipo: "esito", campo: "stato", valore_precedente: c.prima, valore_nuovo: c.dopo, fonte: "ted", id_fonte: c.idFonte, notificabile: modo === "incrementale" && !ancoraCollegate.has(c.id) }));
  for (const b of blocchi(righe, 200)) {
    await misura(misure, "registro degli esiti", () => admin.from("radar_aggiornamenti").upsert(b, { onConflict: "procedura_id,tipo,campo,id_fonte", ignoreDuplicates: true }));
  }
  return esito;
}

export { ErroreDb };
