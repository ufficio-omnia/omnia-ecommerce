// UNICA scrittura nell'archivio delle gare lette dalle fonti nazionali e regionali (PVL di ANAC, Sintel, SardegnaCAT e le fonti future): la
// stessa tabella, lo stesso motore di unione (unione-calcoli.ts) e lo stesso sistema di collegamento (collegamenti.ts, 0117) di TED. Nata
// dalla scrittura della PVL (fase B1-bis), resa generica in B2a: la PVL e le fonti regionali sono ADATTATORI che preparano i bandi in questa
// forma (importa-pvl-pagina.ts, importa-regionali-pagina.ts). Solo server, chiave di servizio. Letture e scritture a blocchi.
//
// Abbinamento di un bando a una gara già in archivio, in quest'ordine (mai il solo titolo, mai il solo ente):
//   1) stessa procedura della stessa fonte già letta (id_procedura_fonte);
//   2) numero dell'avviso TED citato dalla fonte (rif_ted, oggi solo la PVL), già letto da TED;
//   3) CIG dei lotti già presenti (tutti sulla stessa gara: CIG su gare diverse = conflitto, il bando non si applica a caso).
// Ogni gara trovata si risolve nella gara che resta (0117), così rettifiche e proroghe arrivano sempre alla gara che il cliente vede.
// Unioni AUTOMATICHE solo con identificativi ufficiali (CIG, numero TED). L'identificativo della procedura sulla piattaforma (piattaforma_id)
// e la coppia ente + giorno di scadenza danno SOLO suggerimenti, da confermare in console (decisione dell'utente del 17/11/2026).
// Fonte nascosta ai clienti: i suoi dati non entrano in una gara che ha già una fonte visibile; resta la provenienza (impronta «nascosta:»),
// e la versione si riapplica quando la fonte diventa visibile.
// Classificazione (classificazione-unita.ts): i settori restano l'unione delle fonti; quando una fonte si unisce a una gara che ne ha già
// un'altra, il classificatore unico confronta la fonte, la gara di prima e i dati uniti, e segnala le ambiguità (mai risolte da sole).
// Fase B2b, SOLO con l'interruttore acceso (opzione «classificazioni», spenta): la colonna «settori» diventa quella delle righe della 0121
// (classificazioni-importazione.ts), il cambio su una gara esistente si traccia nel registro, e righe e stato si scrivono dentro questo
// stesso giro (nessuna lettura periodica nuova).
import type { SupabaseClient } from "@supabase/supabase-js";
import { ambiguitaTraFonti, classificaPerArchivio, rigaSegnalazioneClassificazione, type AmbiguitaClassificazione } from "./classificazione-unita";
import { scriviClassificazioni, type EsitoClassificazioni } from "./classificazioni";
import { cambiaColonna, classificaImportazione, righeImportate, rigaRegistroImportazione, type ClassificazioneImportata } from "./classificazioni-importazione";
import { fontiDellaGara } from "./fonti-gara-calcoli";
import { COLONNE_RIGA, blocchi, collegaAggiunte, misura, rigaDaScrivere, type Misure } from "./importa";
import { collegaDoppioniPerAvvisoTed, collegaGare, proponiCollegamenti, type Proposta, type RichiestaCollegamento } from "./collegamenti";
import { aperta, notificabile, type ModoImportazione, type RigaProcedura, type StatoProcedura } from "./importa-calcoli";
import type { ScadenzaTed } from "./fonti/ted-calcoli";
import type { RecordProcedura } from "./fonti/tipi";
import { eFonteUnita, unisciLotti, unisciVersione, type FonteUnita, type LottoUnito, type ProvenienzaCampi, type VersioneFonte } from "./unione-calcoli";

export type BandoUnificabile = {
  fonte: Exclude<FonteUnita, "ted">;
  // identificativo dell'avviso nella fonte (id_fonte della provenienza: PVL = idAvviso; piattaforme = la procedura, aggiornata sul posto)
  idAvviso: string;
  // identificativo della procedura nella fonte (id_procedura_fonte)
  idProcedura: string;
  // numero dell'avviso TED citato (solo PVL)
  rifTed: string | null;
  // identificativo della procedura sulla piattaforma di gara: solo per i SUGGERIMENTI (mai unione automatica)
  piattaformaId: string | null;
  versione: VersioneFonte;
  // identificativo dei cambiamenti nel registro (PVL = l'avviso; piattaforme = «<procedura>@<versione>»)
  idCambiamento: string;
  riga: RigaProcedura;
  record: RecordProcedura;
  lottiScadenze: (ScadenzaTed | null)[];
  lottiDocumenti: (string | null)[];
  mancanti: string[];
  tipoAvvisoFonte: string | null;
  motivoModifica: string | null;
  pubblicatoIl: string | null;
};

export type OpzioniPaginaFonte = {
  fonte: BandoUnificabile["fonte"];
  modo: ModoImportazione;
  adesso: Date;
  misure: Misure;
  nascoste: ReadonlySet<string>;
  // ordine di applicazione delle versioni (dalla più vecchia)
  confronta: (a: BandoUnificabile, b: BandoUnificabile) => number;
  // CIG trovati su un'altra gara (stessa gara pubblicata due volte): si uniscono (identificativo ufficiale)
  collegaPerCig: boolean;
  // suggerimenti per stesso ente e stesso giorno di scadenza (regola S9)
  proponiEnteGiorno: boolean;
  // fase B2b: classificazioni della 0121 tenute dentro il giro (interruttore di ambiente.ts, SPENTO di base)
  classificazioni?: boolean;
  nuovoId?: () => string;
};

type Via = "procedura" | "ted" | "cig" | "nuova";
type Destinazione = { proceduraId: string | null; via: Via; conflitto: boolean; tedPresente: boolean; suCollegata: boolean };

// Che cosa è successo a ogni gara toccata (gli adattatori ne ricavano le loro statistiche, come prima).
export type EsitoGaraFonte = {
  nuova: boolean;
  via: Via;
  chiaveIniziale: string | null;
  avvisiConTed: boolean;
  cambiata: boolean;
  suCollegata: boolean;
  rettifica: boolean;
  annullamento: boolean;
  lottiNonAllineati: boolean;
  cigScartati: number;
  apertaAllImportazione: boolean;
  avvisi: number;
  nonApplicati: number;
  mancanti: string[];
};

export type EsitoPaginaFonte = {
  invariati: number;
  conflitti: number;
  gare: EsitoGaraFonte[];
  lotti: number;
  cigAssegnati: number;
  cigScartati: number;
  aggiunteCollegate: number;
  collegateDoppie: number;
  proposte: number;
  // classificazioni diverse tra le fonti della stessa gara, segnalate all'amministratore (classificazione-unita.ts)
  ambiguita: number;
  // fase B2b (solo con l'interruttore acceso): righe e stato della 0121; null se spento o non scritte
  classificazioni: EsitoClassificazioni | null;
  classificazioniErrore: string | null;
};

type RigaDb = RigaProcedura & { id: string; valore_stimato: number | string | null; valore_base: number | string | null; provenienza_campi: ProvenienzaCampi | null; unita_a: string | null; fonti: string[] | null };

const COLONNE_LOTTO = "procedura_id, numero_lotto, cig, oggetto, cpv_principale, cpv_tutti, valore_stimato, durata_mesi, scadenza_giorno, scadenza_offerte, scadenza_ora_indicata, scadenza_fonte, url_documenti";
type LottoDb = LottoUnito & { procedura_id: string; valore_stimato: number | string | null };

const numero = (v: number | string | null | undefined) => (v === null || v === undefined ? null : Number(v));

// Dove va ogni bando (per procedura della fonte). Usata anche dagli esiti della PVL.
export async function destinazioniFonte(
  admin: SupabaseClient,
  fonte: BandoUnificabile["fonte"],
  avvisi: readonly { idProcedura: string; rifTed: string | null; cig: string[] }[],
  misure: Misure,
): Promise<Map<string, Destinazione>> {
  const perProcedura = new Map<string, string>();
  for (const b of blocchi([...new Set(avvisi.map((a) => a.idProcedura))], 100)) {
    const { data } = await misura(misure, "lettura delle procedure già note", () =>
      admin.from("radar_procedure_fonti").select("id_procedura_fonte, procedura_id").eq("fonte", fonte).in("id_procedura_fonte", b).returns<{ id_procedura_fonte: string; procedura_id: string }[]>(),
    );
    for (const r of data ?? []) perProcedura.set(r.id_procedura_fonte, r.procedura_id);
  }
  const perTed = new Map<string, string>();
  const numeri = [...new Set(avvisi.map((a) => a.rifTed).filter((n): n is string => !!n))];
  for (const b of blocchi(numeri, 100)) {
    const { data } = await misura(misure, "lettura degli avvisi TED citati", () => admin.from("radar_procedure_fonti").select("id_fonte, procedura_id").eq("fonte", "ted").in("id_fonte", b).returns<{ id_fonte: string; procedura_id: string }[]>());
    for (const r of data ?? []) perTed.set(r.id_fonte, r.procedura_id);
  }
  const perCig = new Map<string, string>();
  for (const b of blocchi([...new Set(avvisi.flatMap((a) => a.cig))], 150)) {
    const { data } = await misura(misure, "lettura dei CIG già in archivio", () => admin.from("radar_lotti").select("cig, procedura_id").in("cig", b).returns<{ cig: string; procedura_id: string }[]>());
    for (const r of data ?? []) perCig.set(r.cig, r.procedura_id);
  }

  // gare collegate a un'altra (0117): ogni candidato si risolve nella gara che resta, PRIMA di cercare conflitti, così una nuova versione
  // della procedura (es. una proroga pubblicata solo su questa fonte) aggiorna la gara che il cliente vede, con le sue notifiche
  const trovate = [...new Set([...perProcedura.values(), ...perTed.values(), ...perCig.values()])];
  const resta = new Map<string, string>();
  for (const b of blocchi(trovate, 100)) {
    const { data } = await misura(misure, "gare collegate tra le destinazioni", () => admin.from("radar_procedure").select("id, unita_a").in("id", b).not("unita_a", "is", null).returns<{ id: string; unita_a: string }[]>());
    for (const r of data ?? []) resta.set(r.id, r.unita_a);
  }
  const risolvi = (id: string | null) => (id ? (resta.get(id) ?? id) : null);

  const out = new Map<string, Destinazione>();
  for (const a of avvisi) {
    const grezzi = [perProcedura.get(a.idProcedura) ?? null, a.rifTed ? (perTed.get(a.rifTed) ?? null) : null, ...a.cig.map((c) => perCig.get(c) ?? null)];
    const suCollegata = grezzi.some((id) => !!id && resta.has(id));
    const daCig = [...new Set(a.cig.map((c) => risolvi(perCig.get(c) ?? null)).filter((x): x is string => !!x))];
    const tedPresente = !!a.rifTed && perTed.has(a.rifTed);
    const viaProcedura = risolvi(perProcedura.get(a.idProcedura) ?? null);
    const viaTed = a.rifTed ? risolvi(perTed.get(a.rifTed) ?? null) : null;
    const candidati = [viaProcedura, viaTed, ...daCig].filter((x): x is string => !!x);
    const conflitto = new Set(candidati).size > 1;
    if (viaProcedura) out.set(a.idProcedura, { proceduraId: viaProcedura, via: "procedura", conflitto, tedPresente, suCollegata });
    else if (viaTed) out.set(a.idProcedura, { proceduraId: viaTed, via: "ted", conflitto, tedPresente, suCollegata });
    else if (daCig.length === 1) out.set(a.idProcedura, { proceduraId: daCig[0], via: "cig", conflitto, tedPresente, suCollegata });
    else out.set(a.idProcedura, { proceduraId: null, via: "nuova", conflitto: daCig.length > 1, tedPresente, suCollegata });
  }
  return out;
}

export async function applicaPaginaBandiFonte(admin: SupabaseClient, bandi: readonly BandoUnificabile[], o: OpzioniPaginaFonte): Promise<EsitoPaginaFonte> {
  const esito: EsitoPaginaFonte = { invariati: 0, conflitti: 0, gare: [], lotti: 0, cigAssegnati: 0, cigScartati: 0, aggiunteCollegate: 0, collegateDoppie: 0, proposte: 0, ambiguita: 0, classificazioni: null, classificazioniErrore: null };
  const { fonte, modo, adesso, misure, nascoste } = o;
  const propri = bandi.filter((b) => b.fonte === fonte);
  if (propri.length === 0) return esito;
  const iso = adesso.toISOString();
  const nascosta = nascoste.has(fonte);

  // 1) avvisi già letti con la stessa impronta (o già registrati come non applicati perché la fonte è nascosta): nessuna scrittura
  const impronte = new Map<string, string | null>();
  for (const b of blocchi([...new Set(propri.map((v) => v.idAvviso))], 100)) {
    const { data } = await misura(misure, "lettura della provenienza", () => admin.from("radar_procedure_fonti").select("id_fonte, impronta").eq("fonte", fonte).in("id_fonte", b).returns<{ id_fonte: string; impronta: string | null }[]>());
    for (const r of data ?? []) impronte.set(r.id_fonte, r.impronta);
  }
  const daApplicare = propri.filter((v) => {
    const gia = impronte.get(v.idAvviso);
    return gia !== v.record.impronta && !(nascosta && gia === improntaNonApplicata(v.record.impronta));
  });
  esito.invariati = propri.length - daApplicare.length;
  if (daApplicare.length === 0) return esito;

  // 2) dove va ogni avviso, e le gare già in archivio
  const dest = await destinazioniFonte(admin, fonte, daApplicare.map((v) => ({ idProcedura: v.idProcedura, rifTed: v.rifTed, cig: v.record.lotti.map((l) => l.cig).filter((c): c is string => !!c) })), misure);
  const idsEsistenti = [...new Set([...dest.values()].map((d) => d.proceduraId).filter((x): x is string => !!x))];
  const esistenti = new Map<string, RigaDb>();
  for (const b of blocchi(idsEsistenti, 80)) {
    const { data } = await misura(misure, "lettura delle gare da unire", () => admin.from("radar_procedure").select(`${COLONNE_RIGA}, provenienza_campi, unita_a, fonti`).in("id", b).returns<RigaDb[]>());
    for (const r of data ?? []) esistenti.set(r.id, { ...r, valore_stimato: numero(r.valore_stimato), valore_base: numero(r.valore_base) });
  }
  const lottiEsistenti = new Map<string, LottoUnito[]>();
  for (const b of blocchi(idsEsistenti, 80)) {
    const { data } = await misura(misure, "lettura dei lotti da unire", () => admin.from("radar_lotti").select(COLONNE_LOTTO).in("procedura_id", b).returns<LottoDb[]>());
    for (const l of data ?? []) {
      const v = lottiEsistenti.get(l.procedura_id) ?? [];
      v.push({ ...l, valore_stimato: numero(l.valore_stimato), cpv_tutti: l.cpv_tutti ?? [] });
      lottiEsistenti.set(l.procedura_id, v);
    }
  }
  const visibile = (r: RigaDb) => (r.fonti && r.fonti.length > 0 ? r.fonti : [r.chiave.split(":")[0]]).some((f) => !nascoste.has(f));

  // 3) unione, versione per versione (in ordine), per gara
  type Stato = {
    chiaveGruppo: string;
    proceduraId: string | null;
    iniziale: RigaDb | null;
    riga: RigaProcedura | null;
    provenienza: ProvenienzaCampi | null;
    lotti: LottoUnito[];
    avvisi: BandoUnificabile[];
    nonApplicati: BandoUnificabile[];
    cambiamenti: { tipo: string; campo: string | null; prima: string | null; dopo: string | null; idFonte: string }[];
    cambiata: boolean;
    destinazione: Destinazione;
    lottiNonAllineati: boolean;
    cigScartati: number;
    ambiguita: Map<string, AmbiguitaClassificazione>;
    // fase B2b: i lotti della gara prima di questa pagina, l'ultima versione letta dalla fonte, la classificazione calcolata
    lottiPrima: LottoUnito[];
    ultimaVersione: { riga: RigaProcedura; lotti: LottoUnito[] } | null;
    classificazione: ClassificazioneImportata | null;
  };
  const stati = new Map<string, Stato>();
  for (const v of [...daApplicare].sort(o.confronta)) {
    const d = dest.get(v.idProcedura) as Destinazione;
    if (d.conflitto) {
      esito.conflitti++;
      // CIG o riferimenti che puntano a gare diverse: non si unisce a caso (si applica solo se la gara è sicura per procedura o numero TED)
      if (d.via !== "procedura" && d.via !== "ted") continue;
    }
    const chiaveGruppo = d.proceduraId ?? `nuova:${v.idProcedura}`;
    const iniziale = d.proceduraId ? (esistenti.get(d.proceduraId) ?? null) : null;
    if (d.proceduraId && !iniziale) continue;
    const s: Stato = stati.get(chiaveGruppo) ?? {
      chiaveGruppo,
      proceduraId: d.proceduraId,
      iniziale,
      riga: iniziale,
      provenienza: iniziale?.provenienza_campi ?? null,
      lotti: d.proceduraId ? (lottiEsistenti.get(d.proceduraId) ?? []) : [],
      avvisi: [],
      nonApplicati: [],
      cambiamenti: [],
      cambiata: false,
      destinazione: d,
      lottiNonAllineati: false,
      cigScartati: 0,
      ambiguita: new Map(),
      lottiPrima: d.proceduraId ? (lottiEsistenti.get(d.proceduraId) ?? []) : [],
      ultimaVersione: null,
      classificazione: null,
    };
    // fonte nascosta su una gara già visibile ai clienti: solo provenienza, nessun dato nella gara mostrata
    if (nascosta && iniziale && visibile(iniziale)) {
      s.nonApplicati.push(v);
      stati.set(chiaveGruppo, s);
      continue;
    }
    s.avvisi.push(v);
    const rigaPrima = s.riga;
    const provenienzaPrima = s.provenienza;
    const lottiPrima = s.lotti;
    const u = unisciVersione(s.riga, s.provenienza, v.riga, v.versione, iso);
    if (u.campiPresi.length > 0 || u.ultima || !s.riga) s.cambiata = true;
    s.cambiamenti.push(...u.cambiamenti.map((c) => ({ ...c, idFonte: v.idCambiamento })));
    s.riga = u.riga;
    s.provenienza = u.provenienza;
    const lottiNuovi: LottoUnito[] = v.record.lotti.map((l, i) => ({
      numero_lotto: l.numero as string,
      cig: l.cig,
      oggetto: l.oggetto,
      cpv_principale: l.cpvPrincipale,
      cpv_tutti: l.cpvTutti,
      valore_stimato: l.valoreStimato,
      durata_mesi: l.durataMesi,
      scadenza_giorno: v.lottiScadenze[i]?.giorno ?? null,
      scadenza_offerte: v.lottiScadenze[i]?.iso ?? null,
      scadenza_ora_indicata: v.lottiScadenze[i]?.oraIndicata ?? false,
      scadenza_fonte: v.lottiScadenze[i]?.fonte ?? null,
      url_documenti: v.lottiDocumenti[i] ?? null,
    }));
    const ul = unisciLotti(s.lotti, lottiNuovi, fonte, u.ultima);
    s.lotti = ul.lotti;
    s.cigScartati += ul.cigScartati;
    if (!ul.allineati) s.lottiNonAllineati = true;
    s.ultimaVersione = { riga: v.riga, lotti: lottiNuovi };
    // classificatore unico: solo se la gara aveva già un'altra fonte (una gara di una sola fonte si comporta come sempre)
    if (rigaPrima) {
      const amb = ambiguitaTraFonti({
        fonte,
        altreFonti: [...fontiDellaGara(rigaPrima.chiave, provenienzaPrima), ...(s.iniziale?.fonti ?? []).filter(eFonteUnita)],
        daFonte: classificaPerArchivio(v.riga, lottiNuovi),
        altre: classificaPerArchivio(rigaPrima, lottiPrima),
        unita: classificaPerArchivio(u.riga, ul.lotti),
      });
      if (amb) s.ambiguita.set(amb.chiave, amb);
    }
    stati.set(chiaveGruppo, s);
  }

  // 3bis) fase B2b, SOLO con l'interruttore acceso: classificazione sui dati uniti con i lotti che resteranno in archivio; la colonna
  //       «settori» diventa quella delle righe (se cambia, la gara si riscrive)
  if (o.classificazioni) {
    for (const s of stati.values()) {
      if (!s.riga || s.avvisi.length === 0 || !s.ultimaVersione) continue;
      const lottiFinali = s.lottiNonAllineati && s.iniziale ? s.lottiPrima : s.lotti;
      const ci = classificaImportazione({
        dati: s.riga,
        lotti: lottiFinali,
        fonte,
        versioneFonte: { dati: s.ultimaVersione.riga, lotti: s.ultimaVersione.lotti },
        prima: s.iniziale ? { dati: s.iniziale, lotti: s.lottiPrima, fonti: [...fontiDellaGara(s.iniziale.chiave, s.iniziale.provenienza_campi), ...(s.iniziale.fonti ?? [])] } : null,
      });
      s.classificazione = ci;
      if (cambiaColonna(s.riga, ci)) {
        // un cambio dovuto solo alla classificazione non tocca «aggiornata_il» (pacchetto 16, punto 11)
        s.riga = { ...s.riga, settori: ci.settori, metodo_settore: ci.metodo ?? s.riga.metodo_settore };
        s.cambiata = true;
      }
    }
  }

  // 4) gare nuove o cambiate
  const daScrivere = [...stati.values()].filter((s) => s.cambiata && s.riga);
  const ids = new Map<string, string>();
  for (const s of stati.values()) if (s.proceduraId) ids.set(s.chiaveGruppo, s.proceduraId);
  for (const b of blocchi(daScrivere, 100)) {
    const { data } = await misura(misure, "scrittura delle gare", () =>
      admin
        .from("radar_procedure")
        .upsert(
          b.map((s) => rigaDaScrivere(s.riga as RigaProcedura, s.provenienza)),
          { onConflict: "chiave" },
        )
        .select("id, chiave")
        .returns<{ id: string; chiave: string }[]>(),
    );
    const perChiave = new Map((data ?? []).map((r) => [r.chiave, r.id]));
    for (const s of b) {
      const id = perChiave.get((s.riga as RigaProcedura).chiave);
      if (id) ids.set(s.chiaveGruppo, id);
    }
  }
  for (const s of stati.values()) {
    const r = s.riga;
    esito.gare.push({
      nuova: !s.iniziale,
      via: s.destinazione.via,
      chiaveIniziale: s.iniziale?.chiave ?? null,
      avvisiConTed: s.avvisi.some((a) => !!a.rifTed),
      cambiata: s.cambiata,
      suCollegata: s.destinazione.suCollegata,
      rettifica: s.cambiamenti.some((c) => c.tipo === "rettifica" || c.tipo === "proroga"),
      annullamento: s.cambiamenti.some((c) => c.tipo === "annullamento"),
      lottiNonAllineati: s.lottiNonAllineati,
      cigScartati: s.cigScartati,
      apertaAllImportazione: r ? aperta(r.stato, { giorno: r.scadenza_giorno, iso: r.scadenza_offerte }, adesso) : false,
      avvisi: s.avvisi.length,
      nonApplicati: s.nonApplicati.length,
      mancanti: s.avvisi.flatMap((a) => a.mancanti),
    });
  }

  // 5) lotti: unione per numero; un CIG già usato da un'ALTRA gara non si assegna (con le fonti regionali quella gara è la stessa: si unisce)
  const collegamenti: RichiestaCollegamento[] = [];
  const righeLotti = [...stati.values()].flatMap((s) => {
    const id = ids.get(s.chiaveGruppo);
    if (!id || s.avvisi.length === 0 || (s.lottiNonAllineati && s.iniziale)) return [];
    return s.lotti.map((l) => ({ ...l, procedura_id: id, aggiornato_il: iso }));
  });
  const cig = [...new Set(righeLotti.map((l) => l.cig).filter((c): c is string => !!c))];
  const prima = new Map<string, string>();
  for (const b of blocchi(cig, 150)) {
    const { data } = await misura(misure, "controllo dei CIG", () => admin.from("radar_lotti").select("cig, procedura_id").in("cig", b).returns<{ cig: string; procedura_id: string }[]>());
    for (const r of data ?? []) prima.set(r.cig, r.procedura_id);
  }
  // un CIG che sta già sulla copia collegata a questa gara (0117) resta lì: la scheda della gara che resta lo mostra; non è un conflitto
  const occupanti = [...new Set(righeLotti.filter((l) => l.cig && prima.has(l.cig) && prima.get(l.cig) !== l.procedura_id).map((l) => prima.get(l.cig as string) as string))];
  const restaDi = new Map<string, string>();
  for (const b of blocchi(occupanti, 100)) {
    const { data } = await misura(misure, "CIG sulle gare collegate", () => admin.from("radar_procedure").select("id, unita_a").in("id", b).not("unita_a", "is", null).returns<{ id: string; unita_a: string }[]>());
    for (const r of data ?? []) restaDi.set(r.id, r.unita_a);
  }
  for (const l of righeLotti) {
    if (l.cig && prima.has(l.cig) && prima.get(l.cig) !== l.procedura_id) {
      const occupante = prima.get(l.cig) as string;
      if (restaDi.get(occupante) !== l.procedura_id) {
        esito.cigScartati++;
        if (o.collegaPerCig) collegamenti.push({ a: l.procedura_id, b: occupante, motivo: `stesso CIG ${l.cig}`, traccia: `cig:${l.cig}`, fonte });
      }
      l.cig = null;
    } else if (l.cig && !prima.has(l.cig)) esito.cigAssegnati++;
  }
  for (const b of blocchi(righeLotti, 200)) {
    await misura(misure, "scrittura dei lotti", () => admin.from("radar_lotti").upsert(b, { onConflict: "procedura_id,numero_lotto" }));
  }
  esito.lotti += righeLotti.length;

  // 6) provenienza di ogni avviso letto, con la procedura della fonte e il riferimento TED (servono all'abbinamento, anche al rovescio da TED)
  const righeProvenienza = [...stati.values()].flatMap((s) => {
    const id = ids.get(s.chiaveGruppo);
    if (!id) return [];
    const riga = (v: BandoUnificabile, applicato: boolean) => ({
      procedura_id: id,
      fonte,
      id_fonte: v.idAvviso,
      url: v.record.urlAvviso,
      impronta: applicato ? v.record.impronta : improntaNonApplicata(v.record.impronta),
      pubblicato_il: v.pubblicatoIl,
      versione: null,
      tipo_avviso: v.tipoAvvisoFonte,
      motivo_modifica: v.motivoModifica,
      id_procedura_fonte: v.idProcedura,
      rif_ted: v.rifTed,
      aggiornato_il: iso,
    });
    return [...s.avvisi.map((v) => riga(v, true)), ...s.nonApplicati.map((v) => riga(v, false))];
  });
  // un avviso aggiornato sul posto (piattaforme) può comparire due volte nella stessa pagina: vale l'ultimo
  for (const b of blocchi([...new Map(righeProvenienza.map((r) => [r.id_fonte, r])).values()], 200)) {
    await misura(misure, "scrittura della provenienza", () => admin.from("radar_procedure_fonti").upsert(b, { onConflict: "fonte,id_fonte" }));
  }

  // 7) cambiamenti: «nuova» solo per le gare entrate ora (mai quando la fonte si aggiunge a una gara esistente: niente notifiche doppie);
  // mai notifiche da una fonte nascosta né su una gara collegata a un'altra
  const righeAggiornamenti = [...stati.values()].flatMap((s) => {
    const id = ids.get(s.chiaveGruppo);
    if (!id || !s.riga || s.avvisi.length === 0) return [];
    const r = s.riga;
    const sc = { giorno: r.scadenza_giorno, iso: r.scadenza_offerte };
    const eraAperta = s.iniziale ? aperta(s.iniziale.stato as StatoProcedura, { giorno: s.iniziale.scadenza_giorno, iso: s.iniziale.scadenza_offerte }, adesso) : false;
    const righe: Record<string, unknown>[] = [];
    if (!s.iniziale) righe.push({ procedura_id: id, tipo: "nuova", campo: null, valore_precedente: null, valore_nuovo: null, fonte, id_fonte: s.avvisi[0].idCambiamento, notificabile: !nascosta && notificabile(modo, r.stato, sc, adesso) });
    for (const c of s.cambiamenti) {
      righe.push({
        procedura_id: id,
        tipo: c.tipo,
        campo: c.campo,
        valore_precedente: c.prima?.slice(0, 2000) ?? null,
        valore_nuovo: c.dopo?.slice(0, 2000) ?? null,
        fonte,
        id_fonte: c.idFonte,
        notificabile: !nascosta && modo === "incrementale" && !s.iniziale?.unita_a && (eraAperta || aperta(r.stato, sc, adesso)),
      });
    }
    // classificazioni diverse tra le fonti: segnalazione per l'amministratore, mai notificabile, mai mostrata ai clienti
    for (const a of s.ambiguita.values()) righe.push(rigaSegnalazioneClassificazione(id, a));
    esito.ambiguita += s.ambiguita.size;
    // fase B2b: il cambio della colonna «settori» di una gara che esisteva già (mai notificabile)
    if (s.classificazione && s.iniziale) {
      const traccia = rigaRegistroImportazione(id, { settori: [...s.iniziale.settori], metodo: s.iniziale.metodo_settore }, s.classificazione, fonte, s.avvisi[s.avvisi.length - 1].idCambiamento);
      if (traccia) righe.push(traccia);
    }
    return righe;
  });
  for (const b of blocchi(righeAggiornamenti, 200)) {
    await misura(misure, "registro dei cambiamenti", () => admin.from("radar_aggiornamenti").upsert(b, { onConflict: "procedura_id,tipo,campo,id_fonte", ignoreDuplicates: true }));
  }

  // 7bis) fase B2b, SOLO con l'interruttore acceso: righe della 0121 e stato, dentro questo giro. Un errore qui non ferma l'importazione:
  //       la gara resta com'era nella 0121 e lo script unico la ritrova (aggiornata dopo l'ultima classificazione)
  if (o.classificazioni) {
    const nuovoId = o.nuovoId ?? (() => crypto.randomUUID());
    const voci = [...stati.values()].flatMap((s) => {
      const id = ids.get(s.chiaveGruppo);
      if (!id || !s.classificazione) return [];
      const fonti = [...(s.iniziale ? [...fontiDellaGara(s.iniziale.chiave, s.iniziale.provenienza_campi), ...(s.iniziale.fonti ?? [])] : []), fonte];
      return [{ proceduraId: id, versione: s.classificazione.unita.versione, calcolate: righeImportate(s.classificazione, { proceduraId: id, fonti, fonte, adessoIso: iso, nuovoId }) }];
    });
    try {
      esito.classificazioni = await scriviClassificazioni(admin, voci, misure, iso);
    } catch (e) {
      esito.classificazioniErrore = e instanceof Error ? e.message : String(e);
      console.warn(`Classificazioni non scritte (${fonte}): ${esito.classificazioniErrore}`);
    }
  }

  // 8) gare aggiunte a mano con lo stesso CIG: si collegano alla gara pubblica
  esito.aggiunteCollegate += await collegaAggiunte(admin, righeLotti, iso, misure);

  // 9) unioni AUTOMATICHE con identificativi ufficiali: avviso TED citato qui e già letto da TED in un'altra gara; CIG su due gare
  const numeriTed = [...stati.values()].flatMap((s) => s.avvisi.map((a) => a.rifTed)).filter((n): n is string => !!n);
  esito.collegateDoppie += (await collegaDoppioniPerAvvisoTed(admin, numeriTed, iso, misure)).collegate;
  if (collegamenti.length > 0) esito.collegateDoppie += (await collegaGare(admin, collegamenti, iso, misure)).collegate;

  // 10) SUGGERIMENTI (mai unioni automatiche): stesso identificativo della piattaforma; stesso ente e stesso giorno (S9)
  const proposte: Proposta[] = [];
  const conPiattaforma = [...stati.values()].flatMap((s) => {
    const id = ids.get(s.chiaveGruppo);
    const pid = [...s.avvisi, ...s.nonApplicati].map((a) => a.piattaformaId).find((p) => !!p);
    return id && pid ? [{ id, pid }] : [];
  });
  if (conPiattaforma.length > 0) {
    const altre: { id: string; piattaforma_id: string; unita_a: string | null }[] = [];
    for (const b of blocchi([...new Set(conPiattaforma.map((c) => c.pid))], 100)) {
      const { data } = await misura(misure, "gare con lo stesso identificativo della piattaforma", () => admin.from("radar_procedure").select("id, piattaforma_id, unita_a").in("piattaforma_id", b).returns<typeof altre>());
      altre.push(...(data ?? []));
    }
    for (const c of conPiattaforma) {
      for (const g of altre.filter((x) => x.piattaforma_id === c.pid && x.id !== c.id && x.unita_a !== c.id)) {
        proposte.push({ a: c.id, b: g.id, motivo: `Stesso identificativo della procedura sulla piattaforma (${c.pid}) nel collegamento ufficiale ai documenti: numero tecnico della piattaforma, da verificare`, fonte });
      }
    }
  }
  if (o.proponiEnteGiorno) {
    const nuove = [...stati.values()].filter((s) => !s.iniziale && s.riga?.sa_codice_fiscale && s.riga.scadenza_giorno && ids.get(s.chiaveGruppo)).map((s) => ({ id: ids.get(s.chiaveGruppo) as string, cf: s.riga!.sa_codice_fiscale as string, giorno: s.riga!.scadenza_giorno as string }));
    if (nuove.length > 0) {
      const candidati: { id: string; chiave: string; sa_codice_fiscale: string; scadenza_giorno: string; fonti: string[] | null }[] = [];
      for (const b of blocchi([...new Set(nuove.map((n) => n.cf))], 80)) {
        const { data } = await misura(misure, "gare dello stesso ente per i suggerimenti", () =>
          admin.from("radar_procedure").select("id, chiave, sa_codice_fiscale, scadenza_giorno, fonti").in("sa_codice_fiscale", b).in("scadenza_giorno", [...new Set(nuove.map((n) => n.giorno))]).is("unita_a", null).returns<typeof candidati>(),
        );
        candidati.push(...(data ?? []));
      }
      const chiaveDi = (cf: string, g: string) => `${cf}|${g}`;
      const gruppi = new Map<string, typeof candidati>();
      for (const c of candidati) gruppi.set(chiaveDi(c.sa_codice_fiscale, c.scadenza_giorno), [...(gruppi.get(chiaveDi(c.sa_codice_fiscale, c.scadenza_giorno)) ?? []), c]);
      for (const n of nuove) {
        const g = gruppi.get(chiaveDi(n.cf, n.giorno)) ?? [];
        const dellaFonte = g.filter((c) => (c.fonti && c.fonti.length > 0 ? c.fonti : [c.chiave.split(":")[0]]).includes(fonte));
        const altre = g.filter((c) => !dellaFonte.includes(c));
        // un solo candidato per parte (regola S9): con due gare dello stesso ente nello stesso giorno non si propone nulla
        if (dellaFonte.length === 1 && altre.length === 1) proposte.push({ a: n.id, b: altre[0].id, motivo: `Stesso ente (codice fiscale ${n.cf}) e stesso giorno di scadenza (${n.giorno}), un solo candidato per parte: da verificare`, fonte });
      }
    }
  }
  if (proposte.length > 0) esito.proposte += (await proponiCollegamenti(admin, proposte, iso, misure)).proposte;
  return esito;
}

// Impronta salvata nella provenienza quando la fonte è NASCOSTA ai clienti e la gara ha già una fonte visibile.
export function improntaNonApplicata(impronta: string): string {
  return `nascosta:${impronta}`;
}
