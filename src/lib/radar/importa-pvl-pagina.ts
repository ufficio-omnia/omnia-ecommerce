// Scrittura nell'archivio delle pagine lette dalla PVL (fase B1-bis, SOLO STAGING): la stessa tabella delle gare di TED, nessun archivio
// separato. Solo server, chiave di servizio. Le regole stanno in unione-calcoli.ts e importa-pvl-calcoli.ts; qui solo letture e scritture,
// a blocchi.
//
// Abbinamento di un avviso PVL a una gara già in archivio, in quest'ordine (mai il solo codice fiscale dell'ente):
//   1) stessa procedura PVL (idAppalto) già letta con un altro avviso;
//   2) numero dell'avviso TED citato dalla PVL, già letto da TED;
//   3) CIG dei lotti, già presenti in archivio (tutti sulla stessa gara: CIG su gare diverse = conflitto, l'avviso non si applica).
// Altrimenti la gara è nuova («pvl:<idAppalto>»). Per pagina: poche letture a blocchi, poi le scritture (gare, lotti, provenienza,
// cambiamenti, collegamento delle gare aggiunte a mano).
import type { SupabaseClient } from "@supabase/supabase-js";
import { cigPvl, confrontaVersioniPvl, type BandoPvl, type EsitoPvl } from "./fonti/pvl-calcoli";
import { COLONNE_RIGA, blocchi, collegaAggiunte, misura, rigaDaScrivere, type Misure } from "./importa";
import { collegaDoppioniPerAvvisoTed } from "./collegamenti";
import { aperta, notificabile, statoDopoEsito, type ModoImportazione, type RigaProcedura, type StatoProcedura } from "./importa-calcoli";
import { aggiungi, rigaDaBandoPvl, type StatistichePvl } from "./importa-pvl-calcoli";
import { unisciLotti, unisciVersione, type LottoUnito, type ProvenienzaCampi, type VersioneFonte } from "./unione-calcoli";

type RigaDb = RigaProcedura & { id: string; valore_stimato: number | string | null; provenienza_campi: ProvenienzaCampi | null; unita_a: string | null };

const COLONNE_LOTTO = "procedura_id, numero_lotto, cig, oggetto, cpv_principale, cpv_tutti, valore_stimato, durata_mesi, scadenza_giorno, scadenza_offerte, scadenza_ora_indicata, scadenza_fonte, url_documenti";
type LottoDb = LottoUnito & { procedura_id: string; valore_stimato: number | string | null };

function versionePvl(b: { meta: { idAvviso: string; giorno: string; data: string; numeroTed: string | null } }): VersioneFonte {
  return { fonte: "pvl", id: b.meta.idAvviso, giorno: b.meta.giorno, istante: b.meta.data, ted: b.meta.numeroTed };
}

// Dove va ogni avviso: id della gara esistente, oppure null (gara nuova). «conflitto» = CIG su gare diverse.
type Destinazione = { proceduraId: string | null; via: "appalto" | "ted" | "cig" | "nuova"; conflitto: boolean; tedPresente: boolean };

async function destinazioni(admin: SupabaseClient, avvisi: { meta: { idAppalto: string; numeroTed: string | null }; cig: string[] }[], misure: Misure): Promise<Map<string, Destinazione>> {
  const perAppalto = new Map<string, string>();
  const perTed = new Map<string, string>();
  const perCig = new Map<string, string>();
  const appalti = [...new Set(avvisi.map((a) => a.meta.idAppalto))];
  for (const b of blocchi(appalti, 100)) {
    const { data } = await misura(misure, "lettura delle procedure PVL già note", () =>
      admin.from("radar_procedure_fonti").select("id_procedura_fonte, procedura_id").eq("fonte", "pvl").in("id_procedura_fonte", b).returns<{ id_procedura_fonte: string; procedura_id: string }[]>(),
    );
    for (const r of data ?? []) perAppalto.set(r.id_procedura_fonte, r.procedura_id);
  }
  const numeri = [...new Set(avvisi.map((a) => a.meta.numeroTed).filter((n): n is string => !!n))];
  for (const b of blocchi(numeri, 100)) {
    const { data } = await misura(misure, "lettura degli avvisi TED citati", () => admin.from("radar_procedure_fonti").select("id_fonte, procedura_id").eq("fonte", "ted").in("id_fonte", b).returns<{ id_fonte: string; procedura_id: string }[]>());
    for (const r of data ?? []) perTed.set(r.id_fonte, r.procedura_id);
  }
  const cig = [...new Set(avvisi.flatMap((a) => a.cig))];
  for (const b of blocchi(cig, 150)) {
    const { data } = await misura(misure, "lettura dei CIG già in archivio", () => admin.from("radar_lotti").select("cig, procedura_id").in("cig", b).returns<{ cig: string; procedura_id: string }[]>());
    for (const r of data ?? []) perCig.set(r.cig, r.procedura_id);
  }

  const out = new Map<string, Destinazione>();
  for (const a of avvisi) {
    const daCig = [...new Set(a.cig.map((c) => perCig.get(c)).filter((x): x is string => !!x))];
    const tedPresente = !!a.meta.numeroTed && perTed.has(a.meta.numeroTed);
    const viaAppalto = perAppalto.get(a.meta.idAppalto) ?? null;
    const viaTed = a.meta.numeroTed ? (perTed.get(a.meta.numeroTed) ?? null) : null;
    const candidati = [viaAppalto, viaTed, ...daCig].filter((x): x is string => !!x);
    const conflitto = new Set(candidati).size > 1;
    if (viaAppalto) out.set(a.meta.idAppalto, { proceduraId: viaAppalto, via: "appalto", conflitto, tedPresente });
    else if (viaTed) out.set(a.meta.idAppalto, { proceduraId: viaTed, via: "ted", conflitto, tedPresente });
    else if (daCig.length === 1) out.set(a.meta.idAppalto, { proceduraId: daCig[0], via: "cig", conflitto, tedPresente });
    else out.set(a.meta.idAppalto, { proceduraId: null, via: "nuova", conflitto: daCig.length > 1, tedPresente });
  }
  return out;
}

export async function applicaPaginaBandiPvl(admin: SupabaseClient, bandi: BandoPvl[], modo: ModoImportazione, adesso: Date, misure: Misure, stat: StatistichePvl): Promise<void> {
  if (bandi.length === 0) return;
  const iso = adesso.toISOString();

  // 1) avvisi già letti con la stessa impronta: nessuna scrittura
  const impronte = new Map<string, string | null>();
  for (const b of blocchi([...new Set(bandi.map((v) => v.meta.idAvviso))], 100)) {
    const { data } = await misura(misure, "lettura della provenienza PVL", () => admin.from("radar_procedure_fonti").select("id_fonte, impronta").eq("fonte", "pvl").in("id_fonte", b).returns<{ id_fonte: string; impronta: string | null }[]>());
    for (const r of data ?? []) impronte.set(r.id_fonte, r.impronta);
  }
  const daApplicare = bandi.filter((v) => impronte.get(v.meta.idAvviso) !== v.record.impronta);
  stat.bandi.invariati += bandi.length - daApplicare.length;
  if (daApplicare.length === 0) return;

  // 2) dove va ogni avviso, e le gare già in archivio
  const dest = await destinazioni(admin, daApplicare.map((v) => ({ meta: v.meta, cig: v.record.lotti.map((l) => l.cig).filter((c): c is string => !!c) })), misure);
  const idsEsistenti = [...new Set([...dest.values()].map((d) => d.proceduraId).filter((x): x is string => !!x))];
  const esistenti = new Map<string, RigaDb>();
  for (const b of blocchi(idsEsistenti, 80)) {
    const { data } = await misura(misure, "lettura delle gare da unire", () => admin.from("radar_procedure").select(`${COLONNE_RIGA}, provenienza_campi, unita_a`).in("id", b).returns<RigaDb[]>());
    for (const r of data ?? []) esistenti.set(r.id, { ...r, valore_stimato: r.valore_stimato === null ? null : Number(r.valore_stimato) });
  }
  const lottiEsistenti = new Map<string, LottoUnito[]>();
  for (const b of blocchi(idsEsistenti, 80)) {
    const { data } = await misura(misure, "lettura dei lotti da unire", () => admin.from("radar_lotti").select(COLONNE_LOTTO).in("procedura_id", b).returns<LottoDb[]>());
    for (const l of data ?? []) {
      const v = lottiEsistenti.get(l.procedura_id) ?? [];
      v.push({ ...l, valore_stimato: l.valore_stimato === null ? null : Number(l.valore_stimato), cpv_tutti: l.cpv_tutti ?? [] });
      lottiEsistenti.set(l.procedura_id, v);
    }
  }

  // 3) unione, versione per versione (in ordine di pubblicazione), per gara
  type Stato = {
    chiaveGruppo: string;
    proceduraId: string | null;
    iniziale: RigaDb | null;
    riga: RigaProcedura | null;
    provenienza: ProvenienzaCampi | null;
    lotti: LottoUnito[];
    avvisi: BandoPvl[];
    cambiamenti: { tipo: string; campo: string | null; prima: string | null; dopo: string | null; idFonte: string }[];
    cambiata: boolean;
    destinazione: Destinazione;
    lottiNonAllineati: boolean;
    cigScartati: number;
  };
  const stati = new Map<string, Stato>();
  for (const v of [...daApplicare].sort((a, b) => confrontaVersioniPvl(a.meta, b.meta))) {
    const d = dest.get(v.meta.idAppalto) as Destinazione;
    if (d.conflitto) {
      stat.bandi.conflitti++;
      // CIG o riferimenti che puntano a gare diverse: non si unisce a caso (si applica solo se la gara è sicura per appalto o numero TED)
      if (d.via !== "appalto" && d.via !== "ted") continue;
    }
    const chiaveGruppo = d.proceduraId ?? `nuova:${v.meta.idAppalto}`;
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
      cambiamenti: [],
      cambiata: false,
      destinazione: d,
      lottiNonAllineati: false,
      cigScartati: 0,
    };
    s.avvisi.push(v);
    const nuova = rigaDaBandoPvl(v, adesso);
    const u = unisciVersione(s.riga, s.provenienza, nuova, versionePvl(v), iso);
    if (u.campiPresi.length > 0 || u.ultima || !s.riga) s.cambiata = true;
    s.cambiamenti.push(...u.cambiamenti.map((c) => ({ ...c, idFonte: v.meta.idAvviso })));
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
    const ul = unisciLotti(s.lotti, lottiNuovi, "pvl", u.ultima);
    s.lotti = ul.lotti;
    s.cigScartati += ul.cigScartati;
    if (!ul.allineati) s.lottiNonAllineati = true;
    stati.set(chiaveGruppo, s);
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
    const r = s.riga as RigaProcedura;
    const d = s.destinazione;
    if (!s.iniziale) {
      // gara entrata ora: nazionale (nessun avviso TED citato) oppure sopra soglia non ancora arrivata da TED
      if (s.avvisi.some((a) => a.meta.numeroTed)) stat.bandi.nuoveSopraSogliaSenzaTed++;
      else stat.bandi.nuoveNazionali++;
      if (!aperta(r.stato, { giorno: r.scadenza_giorno, iso: r.scadenza_offerte }, adesso)) stat.bandi.scaduteAllImportazione++;
    } else if (d.via === "ted" || (d.via === "cig" && !s.iniziale.chiave.startsWith("pvl:"))) stat.bandi.giaPresentiTed++;
    else stat.bandi.nuoveVersioni++;
    if (s.iniziale && s.cambiata) stat.bandi.aggiornate++;
    if (s.iniziale?.unita_a) stat.bandi.suGaraCollegata++;
    if (s.cambiamenti.some((c) => c.tipo === "rettifica" || c.tipo === "proroga")) stat.bandi.rettifiche++;
    if (s.cambiamenti.some((c) => c.tipo === "annullamento")) stat.bandi.annullate++;
    if (s.lottiNonAllineati) stat.bandi.lottiNonAllineati++;
    stat.bandi.cigScartati += s.cigScartati;
    for (const a of s.avvisi) for (const m of a.mancanti) aggiungi(stat.bandi.mancanti, m);
  }

  // 5) lotti: unione per numero; un CIG già usato da un'ALTRA gara non si assegna
  const righeLotti = [...stati.values()].flatMap((s) => {
    const id = ids.get(s.chiaveGruppo);
    if (!id || (s.lottiNonAllineati && s.iniziale)) return [];
    return s.lotti.map((l) => ({ ...l, procedura_id: id, aggiornato_il: iso }));
  });
  const cig = [...new Set(righeLotti.map((l) => l.cig).filter((c): c is string => !!c))];
  const prima = new Map<string, string>();
  for (const b of blocchi(cig, 150)) {
    const { data } = await misura(misure, "controllo dei CIG", () => admin.from("radar_lotti").select("cig, procedura_id").in("cig", b).returns<{ cig: string; procedura_id: string }[]>());
    for (const r of data ?? []) prima.set(r.cig, r.procedura_id);
  }
  for (const l of righeLotti) {
    if (l.cig && prima.has(l.cig) && prima.get(l.cig) !== l.procedura_id) {
      l.cig = null;
      stat.bandi.cigScartati++;
    } else if (l.cig && !prima.has(l.cig)) stat.bandi.cigAssegnati++;
  }
  for (const b of blocchi(righeLotti, 200)) {
    await misura(misure, "scrittura dei lotti", () => admin.from("radar_lotti").upsert(b, { onConflict: "procedura_id,numero_lotto" }));
  }
  stat.bandi.lotti += righeLotti.length;

  // 6) provenienza di ogni avviso letto, con la procedura PVL e il riferimento TED (servono all'abbinamento, anche al rovescio da TED)
  const righeProvenienza = [...stati.values()].flatMap((s) => {
    const id = ids.get(s.chiaveGruppo);
    return id
      ? s.avvisi.map((v) => ({
          procedura_id: id,
          fonte: "pvl",
          id_fonte: v.meta.idAvviso,
          url: v.record.urlAvviso,
          impronta: v.record.impronta,
          pubblicato_il: v.meta.giorno,
          versione: null,
          tipo_avviso: v.meta.scheda,
          motivo_modifica: v.meta.tipoSostituzione,
          id_procedura_fonte: v.meta.idAppalto,
          rif_ted: v.meta.numeroTed,
          aggiornato_il: iso,
        }))
      : [];
  });
  for (const b of blocchi(righeProvenienza, 200)) {
    await misura(misure, "scrittura della provenienza PVL", () => admin.from("radar_procedure_fonti").upsert(b, { onConflict: "fonte,id_fonte" }));
  }

  // 7) cambiamenti: «nuova» solo per le gare entrate ora (mai quando la PVL si aggiunge a una gara di TED: niente notifiche doppie)
  const righeAggiornamenti = [...stati.values()].flatMap((s) => {
    const id = ids.get(s.chiaveGruppo);
    if (!id || !s.riga) return [];
    const r = s.riga;
    const sc = { giorno: r.scadenza_giorno, iso: r.scadenza_offerte };
    const eraAperta = s.iniziale ? aperta(s.iniziale.stato as StatoProcedura, { giorno: s.iniziale.scadenza_giorno, iso: s.iniziale.scadenza_offerte }, adesso) : false;
    const righe: Record<string, unknown>[] = [];
    if (!s.iniziale) righe.push({ procedura_id: id, tipo: "nuova", campo: null, valore_precedente: null, valore_nuovo: null, fonte: "pvl", id_fonte: s.avvisi[0].meta.idAvviso, notificabile: notificabile(modo, r.stato, sc, adesso) });
    for (const c of s.cambiamenti) {
      righe.push({
        procedura_id: id,
        tipo: c.tipo,
        campo: c.campo,
        valore_precedente: c.prima?.slice(0, 2000) ?? null,
        valore_nuovo: c.dopo?.slice(0, 2000) ?? null,
        fonte: "pvl",
        id_fonte: c.idFonte,
        // una gara collegata a un'altra è una copia nascosta: le novità arrivano a chi la segue dalla gara che resta, mai due volte
        notificabile: modo === "incrementale" && !s.iniziale?.unita_a && (eraAperta || aperta(r.stato, sc, adesso)),
      });
    }
    return righe;
  });
  for (const b of blocchi(righeAggiornamenti, 200)) {
    await misura(misure, "registro dei cambiamenti", () => admin.from("radar_aggiornamenti").upsert(b, { onConflict: "procedura_id,tipo,campo,id_fonte", ignoreDuplicates: true }));
  }

  // 8) gare aggiunte a mano con lo stesso CIG: si collegano alla gara pubblica
  stat.bandi.aggiunteCollegate += await collegaAggiunte(admin, righeLotti, iso, misure);

  // 9) gare doppie riconosciute ora (avviso TED citato qui e già letto da TED in un'altra gara): collegamento reversibile (0117)
  const numeri = [...stati.values()].flatMap((s) => s.avvisi.map((a) => a.meta.numeroTed)).filter((n): n is string => !!n);
  stat.bandi.collegateDoppie += (await collegaDoppioniPerAvvisoTed(admin, numeri, iso, misure)).collegate;
}

// Esiti PVL (aggiudicazioni, mancate aggiudicazioni): cambiano SOLO lo stato di una gara già in archivio, trovata per procedura PVL, numero
// TED o CIG. Nessun nome di aggiudicatario viene letto o salvato (decisione D6: fase D).
export async function applicaEsitiPvl(admin: SupabaseClient, esiti: EsitoPvl[], modo: ModoImportazione, adesso: Date, misure: Misure, stat: StatistichePvl): Promise<void> {
  stat.esiti.letti += esiti.length;
  if (esiti.length === 0) return;
  const iso = adesso.toISOString();
  const impronta = (e: EsitoPvl) => `esito:${e.stato}:${e.cig.join(",")}`;
  const gia = new Map<string, string | null>();
  for (const b of blocchi(esiti.map((e) => e.meta.idAvviso), 100)) {
    const { data } = await misura(misure, "lettura della provenienza degli esiti PVL", () => admin.from("radar_procedure_fonti").select("id_fonte, impronta").eq("fonte", "pvl").in("id_fonte", b).returns<{ id_fonte: string; impronta: string | null }[]>());
    for (const r of data ?? []) gia.set(r.id_fonte, r.impronta);
  }
  const nuovi = esiti.filter((e) => gia.get(e.meta.idAvviso) !== impronta(e));
  stat.esiti.invariati += esiti.length - nuovi.length;
  if (nuovi.length === 0) return;
  const dest = await destinazioni(admin, nuovi.map((e) => ({ meta: e.meta, cig: e.cig.map((c) => cigPvl(c)).filter((c): c is string => !!c) })), misure);
  const ids = [...new Set([...dest.values()].map((d) => d.proceduraId).filter((x): x is string => !!x))];
  const stati = new Map<string, StatoProcedura>();
  for (const b of blocchi(ids, 100)) {
    const { data } = await misura(misure, "lettura delle gare per gli esiti PVL", () => admin.from("radar_procedure").select("id, stato").in("id", b).returns<{ id: string; stato: StatoProcedura }[]>());
    for (const r of data ?? []) stati.set(r.id, r.stato);
  }
  const cambi = new Map<string, { prima: StatoProcedura; dopo: StatoProcedura; idFonte: string }>();
  const provenienza: Record<string, unknown>[] = [];
  for (const e of [...nuovi].sort((a, b) => confrontaVersioniPvl(a.meta, b.meta))) {
    const d = dest.get(e.meta.idAppalto);
    const id = d && !d.conflitto ? d.proceduraId : null;
    if (!id || !stati.has(id)) {
      stat.esiti.senzaGara++;
      continue;
    }
    provenienza.push({ procedura_id: id, fonte: "pvl", id_fonte: e.meta.idAvviso, url: null, impronta: impronta(e), pubblicato_il: e.meta.giorno, versione: null, tipo_avviso: e.meta.scheda, motivo_modifica: null, id_procedura_fonte: e.meta.idAppalto, rif_ted: e.meta.numeroTed, aggiornato_il: iso });
    const attuale = cambi.get(id)?.dopo ?? (stati.get(id) as StatoProcedura);
    const dopo = statoDopoEsito(attuale, e.stato);
    if (dopo) cambi.set(id, { prima: cambi.get(id)?.prima ?? (stati.get(id) as StatoProcedura), dopo, idFonte: e.meta.idAvviso });
  }
  for (const stato of ["aggiudicata", "chiusa_senza_aggiudicazione"] as const) {
    const idsStato = [...cambi.entries()].filter(([, c]) => c.dopo === stato).map(([id]) => id);
    for (const b of blocchi(idsStato, 100)) {
      await misura(misure, "stato dopo l'esito PVL", () => admin.from("radar_procedure").update({ stato, ultima_rilevazione_il: iso, aggiornata_il: iso }).in("id", b));
    }
  }
  stat.esiti.applicati += cambi.size;
  for (const b of blocchi(provenienza, 200)) {
    await misura(misure, "provenienza degli esiti PVL", () => admin.from("radar_procedure_fonti").upsert(b, { onConflict: "fonte,id_fonte" }));
  }
  const righe = [...cambi.entries()].map(([id, c]) => ({ procedura_id: id, tipo: "esito", campo: "stato", valore_precedente: c.prima, valore_nuovo: c.dopo, fonte: "pvl", id_fonte: c.idFonte, notificabile: modo === "incrementale" }));
  for (const b of blocchi(righe, 200)) {
    await misura(misure, "registro degli esiti PVL", () => admin.from("radar_aggiornamenti").upsert(b, { onConflict: "procedura_id,tipo,campo,id_fonte", ignoreDuplicates: true }));
  }
}
