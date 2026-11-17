// Scrittura nell'archivio dei bandi delle fonti regionali e delle piattaforme (fase B2a: Sintel, SardegnaCAT). Stessa tabella, stesso
// motore di unione (unione-calcoli.ts) e stesso sistema di collegamento (collegamenti.ts, migrazione 0117) di TED e PVL: nessun archivio,
// nessun motore e nessuna fusione paralleli. Solo server, chiave di servizio. Letture e scritture a blocchi.
//
// Abbinamento di un bando a una gara già in archivio, in quest'ordine (mai il solo titolo, mai il solo ente):
//   1) stessa procedura della stessa fonte già letta;
//   2) stesso identificativo della procedura sulla piattaforma (piattaforma_id: per esempio la gara TED che ha i documenti su SardegnaCAT);
//   3) CIG dei lotti già presenti (tutti sulla stessa gara).
// Ogni gara trovata si risolve nella gara che resta (0117), così rettifiche e proroghe arrivano sempre alla gara che il cliente vede.
// Se le chiavi esatte portano a due gare diverse, quelle due sono la stessa gara: si collegano (unione automatica con identificativo
// ufficiale). Le corrispondenze probabili (stesso ente e stesso giorno di scadenza) diventano SOLO suggerimenti per la console.
// Fonte nascosta ai clienti (SardegnaCAT finché manca il parere legale): i suoi dati non entrano in una gara che ha già una fonte visibile;
// resta la provenienza, e la versione si riapplica quando la fonte diventa visibile.
import type { SupabaseClient } from "@supabase/supabase-js";
import { COLONNE_RIGA, blocchi, collegaAggiunte, misura, rigaDaScrivere, type Misure } from "./importa";
import { collegaGare, proponiCollegamenti, type Proposta, type RichiestaCollegamento } from "./collegamenti";
import { aperta, notificabile, type ModoImportazione, type RigaProcedura, type StatoProcedura } from "./importa-calcoli";
import { conta, improntaNonApplicata, rigaDaBandoRegionale, type BandoRegionale, type FonteRegionale, type StatisticheRegionali } from "./importa-regionali-calcoli";
import { confrontaVersioni, unisciLotti, unisciVersione, type LottoUnito, type ProvenienzaCampi } from "./unione-calcoli";

type RigaDb = RigaProcedura & { id: string; valore_stimato: number | string | null; valore_base: number | string | null; provenienza_campi: ProvenienzaCampi | null; unita_a: string | null; fonti: string[] | null };

const COLONNE_LOTTO = "procedura_id, numero_lotto, cig, oggetto, cpv_principale, cpv_tutti, valore_stimato, durata_mesi, scadenza_giorno, scadenza_offerte, scadenza_ora_indicata, scadenza_fonte, url_documenti";
type LottoDb = LottoUnito & { procedura_id: string; valore_stimato: number | string | null };

const numero = (v: number | string | null) => (v === null ? null : Number(v));

type Destinazione = { proceduraId: string | null; via: "procedura" | "piattaforma" | "cig" | "nuova"; suCollegata: boolean; altre: { id: string; motivo: string }[] };

export type OpzioniPaginaRegionale = { fonte: FonteRegionale; modo: ModoImportazione; adesso: Date; misure: Misure; stat: StatisticheRegionali; nascoste: ReadonlySet<string>; proponi: boolean };

async function destinazioni(admin: SupabaseClient, fonte: FonteRegionale, bandi: readonly BandoRegionale[], misure: Misure): Promise<Map<string, Destinazione>> {
  const perProcedura = new Map<string, string>();
  for (const b of blocchi([...new Set(bandi.map((x) => x.idProcedura))], 100)) {
    const { data } = await misura(misure, "procedure già lette", () => admin.from("radar_procedure_fonti").select("id_procedura_fonte, procedura_id").eq("fonte", fonte).in("id_procedura_fonte", b).returns<{ id_procedura_fonte: string; procedura_id: string }[]>());
    for (const r of data ?? []) perProcedura.set(r.id_procedura_fonte, r.procedura_id);
  }
  const perPiattaforma = new Map<string, { id: string; unita_a: string | null; fonti: string[] | null; chiave: string }[]>();
  for (const b of blocchi([...new Set(bandi.map((x) => x.piattaformaId).filter((x): x is string => !!x))], 100)) {
    const { data } = await misura(misure, "gare con lo stesso identificativo della piattaforma", () => admin.from("radar_procedure").select("id, chiave, unita_a, fonti, piattaforma_id").in("piattaforma_id", b).returns<{ id: string; chiave: string; unita_a: string | null; fonti: string[] | null; piattaforma_id: string }[]>());
    for (const r of data ?? []) perPiattaforma.set(r.piattaforma_id, [...(perPiattaforma.get(r.piattaforma_id) ?? []), r]);
  }
  const perCig = new Map<string, string>();
  for (const b of blocchi([...new Set(bandi.flatMap((x) => x.record.lotti.map((l) => l.cig)).filter((c): c is string => !!c))], 150)) {
    const { data } = await misura(misure, "CIG già in archivio", () => admin.from("radar_lotti").select("cig, procedura_id").in("cig", b).returns<{ cig: string; procedura_id: string }[]>());
    for (const r of data ?? []) perCig.set(r.cig, r.procedura_id);
  }
  // ogni gara trovata → la gara che resta (0117): una gara assorbita non riceve più novità
  const trovate = [...new Set([...perProcedura.values(), ...[...perPiattaforma.values()].flat().map((g) => g.id), ...perCig.values()])];
  const resta = new Map<string, string>();
  for (const b of blocchi(trovate, 100)) {
    const { data } = await misura(misure, "gare collegate tra le destinazioni", () => admin.from("radar_procedure").select("id, unita_a").in("id", b).not("unita_a", "is", null).returns<{ id: string; unita_a: string }[]>());
    for (const r of data ?? []) resta.set(r.id, r.unita_a);
  }
  const risolvi = (id: string) => resta.get(id) ?? id;

  const out = new Map<string, Destinazione>();
  for (const x of bandi) {
    const grezzi = [perProcedura.get(x.idProcedura) ?? null, ...(x.piattaformaId ? (perPiattaforma.get(x.piattaformaId) ?? []).map((g) => g.id) : []), ...x.record.lotti.map((l) => (l.cig ? (perCig.get(l.cig) ?? null) : null))].filter((v): v is string => !!v);
    const suCollegata = grezzi.some((id) => resta.has(id));
    const viaProcedura = perProcedura.has(x.idProcedura) ? risolvi(perProcedura.get(x.idProcedura) as string) : null;
    // tra più gare con lo stesso identificativo della piattaforma si preferisce quella con TED o PVL (le altre si collegano a lei)
    const conPiattaforma = x.piattaformaId ? (perPiattaforma.get(x.piattaformaId) ?? []).map((g) => ({ ...g, id: risolvi(g.id) })) : [];
    const ordinate = [...new Map(conPiattaforma.map((g) => [g.id, g])).values()].sort((a, b) => peso(b) - peso(a) || a.id.localeCompare(b.id));
    const viaPiattaforma = ordinate[0]?.id ?? null;
    const daCig = [...new Set(x.record.lotti.map((l) => (l.cig ? perCig.get(l.cig) : undefined)).filter((v): v is string => !!v).map(risolvi))];
    const scelta = viaProcedura ?? viaPiattaforma ?? (daCig.length === 1 ? daCig[0] : null);
    const via: Destinazione["via"] = viaProcedura ? "procedura" : viaPiattaforma ? "piattaforma" : scelta ? "cig" : "nuova";
    // le altre gare raggiunte con una chiave ESATTA sono la stessa gara: si collegheranno alla destinazione
    const altre: { id: string; motivo: string }[] = [];
    for (const g of ordinate) if (scelta && g.id !== scelta) altre.push({ id: g.id, motivo: `stesso identificativo della procedura sulla piattaforma (${x.piattaformaId})` });
    for (const id of daCig) if (scelta && id !== scelta) altre.push({ id, motivo: "stesso CIG di un lotto" });
    out.set(x.idProcedura, { proceduraId: scelta, via, suCollegata, altre });
  }
  return out;
}

function peso(g: { fonti: string[] | null; chiave: string }): number {
  const f = new Set(g.fonti && g.fonti.length > 0 ? g.fonti : [g.chiave.split(":")[0]]);
  return f.has("ted") ? 3 : f.has("pvl") ? 2 : 1;
}

export async function applicaPaginaBandiRegionali(admin: SupabaseClient, bandi: readonly BandoRegionale[], o: OpzioniPaginaRegionale): Promise<void> {
  const { fonte, modo, adesso, misure, stat, nascoste } = o;
  const propri = bandi.filter((b) => b.fonte === fonte);
  if (propri.length === 0) return;
  const iso = adesso.toISOString();
  const nascosta = nascoste.has(fonte);

  // 1) procedure già lette con lo stesso contenuto: nessuna scrittura
  const impronte = new Map<string, string | null>();
  for (const b of blocchi([...new Set(propri.map((v) => v.idProcedura))], 100)) {
    const { data } = await misura(misure, "lettura della provenienza", () => admin.from("radar_procedure_fonti").select("id_fonte, impronta").eq("fonte", fonte).in("id_fonte", b).returns<{ id_fonte: string; impronta: string | null }[]>());
    for (const r of data ?? []) impronte.set(r.id_fonte, r.impronta);
  }
  const daApplicare = propri.filter((v) => {
    const gia = impronte.get(v.idProcedura);
    return gia !== v.record.impronta && !(nascosta && gia === improntaNonApplicata(v.record.impronta));
  });
  stat.invariati += propri.length - daApplicare.length;
  if (daApplicare.length === 0) return;

  // 2) destinazioni e gare già in archivio
  const dest = await destinazioni(admin, fonte, daApplicare, misure);
  const idsEsistenti = [...new Set([...dest.values()].map((d) => d.proceduraId).filter((x): x is string => !!x))];
  const esistenti = new Map<string, RigaDb>();
  for (const b of blocchi(idsEsistenti, 80)) {
    const { data } = await misura(misure, "lettura delle gare da unire", () => admin.from("radar_procedure").select(`${COLONNE_RIGA}, provenienza_campi, unita_a, fonti`).in("id", b).returns<RigaDb[]>());
    for (const r of data ?? []) esistenti.set(r.id, { ...r, valore_stimato: numero(r.valore_stimato), valore_base: numero(r.valore_base) });
  }
  const lottiEsistenti = new Map<string, LottoUnito[]>();
  for (const b of blocchi(idsEsistenti, 80)) {
    const { data } = await misura(misure, "lettura dei lotti da unire", () => admin.from("radar_lotti").select(COLONNE_LOTTO).in("procedura_id", b).returns<LottoDb[]>());
    for (const l of data ?? []) lottiEsistenti.set(l.procedura_id, [...(lottiEsistenti.get(l.procedura_id) ?? []), { ...l, valore_stimato: numero(l.valore_stimato), cpv_tutti: l.cpv_tutti ?? [] }]);
  }
  const visibile = (r: RigaDb) => (r.fonti && r.fonti.length > 0 ? r.fonti : [r.chiave.split(":")[0]]).some((f) => !nascoste.has(f));

  // 3) unione, versione per versione, per gara
  type Stato = {
    chiaveGruppo: string;
    proceduraId: string | null;
    iniziale: RigaDb | null;
    riga: RigaProcedura | null;
    provenienza: ProvenienzaCampi | null;
    lotti: LottoUnito[];
    bandi: BandoRegionale[];
    nonApplicati: BandoRegionale[];
    cambiamenti: { tipo: string; campo: string | null; prima: string | null; dopo: string | null; idFonte: string }[];
    cambiata: boolean;
    destinazione: Destinazione;
    lottiNonAllineati: boolean;
    cigScartati: number;
  };
  const stati = new Map<string, Stato>();
  for (const v of [...daApplicare].sort((a, b) => confrontaVersioni(a.versione, b.versione))) {
    const d = dest.get(v.idProcedura) as Destinazione;
    const chiaveGruppo = d.proceduraId ?? `nuova:${v.piattaformaId ?? v.idProcedura}`;
    const iniziale = d.proceduraId ? (esistenti.get(d.proceduraId) ?? null) : null;
    if (d.proceduraId && !iniziale) continue;
    const s: Stato = stati.get(chiaveGruppo) ?? {
      chiaveGruppo,
      proceduraId: d.proceduraId,
      iniziale,
      riga: iniziale,
      provenienza: iniziale?.provenienza_campi ?? null,
      lotti: d.proceduraId ? (lottiEsistenti.get(d.proceduraId) ?? []) : [],
      bandi: [],
      nonApplicati: [],
      cambiamenti: [],
      cambiata: false,
      destinazione: d,
      lottiNonAllineati: false,
      cigScartati: 0,
    };
    // fonte nascosta su una gara già visibile ai clienti: solo provenienza, nessun dato nella gara mostrata
    if (nascosta && iniziale && visibile(iniziale)) {
      s.nonApplicati.push(v);
      stati.set(chiaveGruppo, s);
      continue;
    }
    s.bandi.push(v);
    const u = unisciVersione(s.riga, s.provenienza, rigaDaBandoRegionale(v, adesso), v.versione, iso);
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
    if (s.bandi.length === 0) continue;
    if (!s.iniziale) stat.nuove++;
    else {
      conta(stat.suGaraEsistente, s.destinazione.via);
      if (s.cambiata) stat.aggiornate++;
    }
    if (s.destinazione.suCollegata) stat.suGaraCollegata++;
    if (s.cambiamenti.some((c) => c.tipo === "rettifica" || c.tipo === "proroga")) stat.rettifiche++;
    if (s.cambiamenti.some((c) => c.tipo === "annullamento")) stat.annullate++;
    stat.cigScartati += s.cigScartati;
    for (const v of s.bandi) for (const m of v.mancanti) conta(stat.mancanti, m);
  }
  stat.nonApplicateNascosta += [...stati.values()].reduce((n, s) => n + s.nonApplicati.length, 0);

  // 5) lotti: unione per numero; un CIG già usato da un'ALTRA gara non si assegna (e quella gara è la stessa: si collega al punto 9)
  const collegamenti: RichiestaCollegamento[] = [];
  const righeLotti = [...stati.values()].flatMap((s) => {
    const id = ids.get(s.chiaveGruppo);
    if (!id || s.bandi.length === 0 || (s.lottiNonAllineati && s.iniziale)) return [];
    return s.lotti.map((l) => ({ ...l, procedura_id: id, aggiornato_il: iso }));
  });
  const prima = new Map<string, string>();
  for (const b of blocchi([...new Set(righeLotti.map((l) => l.cig).filter((c): c is string => !!c))], 150)) {
    const { data } = await misura(misure, "controllo dei CIG", () => admin.from("radar_lotti").select("cig, procedura_id").in("cig", b).returns<{ cig: string; procedura_id: string }[]>());
    for (const r of data ?? []) prima.set(r.cig, r.procedura_id);
  }
  for (const l of righeLotti) {
    const occupante = l.cig ? prima.get(l.cig) : undefined;
    if (l.cig && occupante && occupante !== l.procedura_id) {
      collegamenti.push({ a: l.procedura_id, b: occupante, motivo: `stesso CIG ${l.cig}`, traccia: `cig:${l.cig}`, fonte });
      stat.cigScartati++;
      l.cig = null;
    } else if (l.cig && !occupante) stat.cigAssegnati++;
  }
  for (const b of blocchi(righeLotti, 200)) {
    await misura(misure, "scrittura dei lotti", () => admin.from("radar_lotti").upsert(b, { onConflict: "procedura_id,numero_lotto" }));
  }
  stat.lotti += righeLotti.length;

  // 6) provenienza: una riga per procedura, aggiornata sul posto (impronta «nascosta:» se i dati non sono entrati nella gara)
  const righeProvenienza = [...stati.values()].flatMap((s) => {
    const id = ids.get(s.chiaveGruppo);
    if (!id) return [];
    const riga = (v: BandoRegionale, applicato: boolean) => ({
      procedura_id: id,
      fonte,
      id_fonte: v.idProcedura,
      url: v.record.urlAvviso,
      impronta: applicato ? v.record.impronta : improntaNonApplicata(v.record.impronta),
      pubblicato_il: v.pubblicatoIl,
      versione: null,
      tipo_avviso: v.tipoAvvisoFonte?.slice(0, 60) ?? null,
      motivo_modifica: null,
      id_procedura_fonte: v.idProcedura,
      rif_ted: null,
      aggiornato_il: iso,
    });
    return [...s.bandi.map((v) => riga(v, true)), ...s.nonApplicati.map((v) => riga(v, false))];
  });
  for (const b of blocchi([...new Map(righeProvenienza.map((r) => [r.id_fonte, r])).values()], 200)) {
    await misura(misure, "scrittura della provenienza", () => admin.from("radar_procedure_fonti").upsert(b, { onConflict: "fonte,id_fonte" }));
  }

  // 7) cambiamenti: «nuova» solo per le gare entrate ora; notifiche mai da una fonte nascosta né su una gara collegata a un'altra
  const righeAggiornamenti = [...stati.values()].flatMap((s) => {
    const id = ids.get(s.chiaveGruppo);
    if (!id || !s.riga || s.bandi.length === 0) return [];
    const r = s.riga;
    const sc = { giorno: r.scadenza_giorno, iso: r.scadenza_offerte };
    const eraAperta = s.iniziale ? aperta(s.iniziale.stato as StatoProcedura, { giorno: s.iniziale.scadenza_giorno, iso: s.iniziale.scadenza_offerte }, adesso) : false;
    const righe: Record<string, unknown>[] = [];
    if (!s.iniziale) righe.push({ procedura_id: id, tipo: "nuova", campo: null, valore_precedente: null, valore_nuovo: null, fonte, id_fonte: s.bandi[0].idCambiamento, notificabile: !nascosta && notificabile(modo, r.stato, sc, adesso) });
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
    return righe;
  });
  for (const b of blocchi(righeAggiornamenti, 200)) {
    await misura(misure, "registro dei cambiamenti", () => admin.from("radar_aggiornamenti").upsert(b, { onConflict: "procedura_id,tipo,campo,id_fonte", ignoreDuplicates: true }));
  }

  // 8) gare aggiunte a mano con lo stesso CIG: si collegano alla gara pubblica
  stat.aggiunteCollegate += await collegaAggiunte(admin, righeLotti, iso, misure);

  // 9) unione AUTOMATICA delle gare riconosciute uguali da una chiave esatta (identificativo della piattaforma, CIG)
  for (const s of stati.values()) {
    const id = ids.get(s.chiaveGruppo);
    if (!id) continue;
    for (const a of s.destinazione.altre) collegamenti.push({ a: id, b: a.id, motivo: a.motivo, traccia: `piattaforma:${s.bandi[0]?.piattaformaId ?? s.nonApplicati[0]?.piattaformaId ?? id}`, fonte });
  }
  if (collegamenti.length > 0) stat.collegateDoppie += (await collegaGare(admin, collegamenti, iso, misure)).collegate;

  // 10) SUGGERIMENTI (mai unioni automatiche): gare nuove di questa fonte con lo stesso ente e lo stesso giorno di scadenza di UNA sola gara
  // di un'altra fonte, e viceversa (regola S9: la conferma è di un amministratore, in console)
  if (o.proponi) {
    const nuove = [...stati.values()].filter((s) => !s.iniziale && s.riga?.sa_codice_fiscale && s.riga.scadenza_giorno).map((s) => ({ id: ids.get(s.chiaveGruppo) as string, cf: s.riga!.sa_codice_fiscale as string, giorno: s.riga!.scadenza_giorno as string })).filter((x) => !!x.id);
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
      const proposte: Proposta[] = [];
      for (const n of nuove) {
        const g = gruppi.get(chiaveDi(n.cf, n.giorno)) ?? [];
        const dellaFonte = g.filter((c) => (c.fonti && c.fonti.length > 0 ? c.fonti : [c.chiave.split(":")[0]]).includes(fonte));
        const altre = g.filter((c) => !dellaFonte.includes(c));
        // un solo candidato per parte (regola S9): con due gare dello stesso ente nello stesso giorno non si propone nulla
        if (dellaFonte.length === 1 && altre.length === 1) proposte.push({ a: n.id, b: altre[0].id, motivo: `Stesso ente (codice fiscale ${n.cf}) e stesso giorno di scadenza (${n.giorno}), un solo candidato per parte: da verificare`, fonte });
      }
      stat.proposte += (await proponiCollegamenti(admin, proposte, iso, misure)).proposte;
    }
  }
}
