// Scrittura nell'archivio delle pagine lette dalla PVL (fase B1-bis, SOLO STAGING): la stessa tabella delle gare di TED, nessun archivio
// separato. Solo server, chiave di servizio.
//
// Dalla fase B2a la PVL è un ADATTATORE della scrittura unica delle fonti (importa-fonti-pagina.ts, la stessa di Sintel e SardegnaCAT):
// qui si prepara ogni avviso nella forma comune e si ricavano le statistiche della PVL come prima. Comportamento invariato (prova di
// equivalenza nel resoconto 12 e verifica-radar-pvl): abbinamento per procedura PVL (idAppalto), poi per avviso TED citato, poi per CIG;
// nessun suggerimento per identificativo della piattaforma né per ente e giorno; nessuna unione per CIG oltre a quella di prima.
import type { SupabaseClient } from "@supabase/supabase-js";
import { cigPvl, confrontaVersioniPvl, type BandoPvl, type EsitoPvl } from "./fonti/pvl-calcoli";
import { blocchi, misura, type Misure } from "./importa";
import { statoDopoEsito, type ModoImportazione, type StatoProcedura } from "./importa-calcoli";
import { aggiungi, rigaDaBandoPvl, type StatistichePvl } from "./importa-pvl-calcoli";
import { applicaPaginaBandiFonte, destinazioniFonte, type BandoUnificabile } from "./importa-fonti-pagina";
import type { VersioneFonte } from "./unione-calcoli";

function versionePvl(b: { meta: { idAvviso: string; giorno: string; data: string; numeroTed: string | null } }): VersioneFonte {
  return { fonte: "pvl", id: b.meta.idAvviso, giorno: b.meta.giorno, istante: b.meta.data, ted: b.meta.numeroTed };
}

export function bandoUnificabilePvl(v: BandoPvl, adesso: Date): BandoUnificabile {
  return {
    fonte: "pvl",
    idAvviso: v.meta.idAvviso,
    idProcedura: v.meta.idAppalto,
    rifTed: v.meta.numeroTed,
    piattaformaId: null,
    versione: versionePvl(v),
    idCambiamento: v.meta.idAvviso,
    riga: rigaDaBandoPvl(v, adesso),
    record: v.record,
    lottiScadenze: v.lottiScadenze,
    lottiDocumenti: v.lottiDocumenti,
    mancanti: v.mancanti,
    tipoAvvisoFonte: v.meta.scheda,
    motivoModifica: v.meta.tipoSostituzione,
    pubblicatoIl: v.meta.giorno,
  };
}

// fase B2b: «classificazioni» = righe e stato della 0121 dentro il giro (interruttore di ambiente.ts, SPENTO di base)
export async function applicaPaginaBandiPvl(admin: SupabaseClient, bandi: BandoPvl[], modo: ModoImportazione, adesso: Date, misure: Misure, stat: StatistichePvl, opzioni: { classificazioni?: boolean; nuovoId?: () => string } = {}): Promise<void> {
  if (bandi.length === 0) return;
  const e = await applicaPaginaBandiFonte(
    admin,
    bandi.map((b) => bandoUnificabilePvl(b, adesso)),
    {
      fonte: "pvl",
      modo,
      adesso,
      misure,
      nascoste: new Set(),
      // ordine di pubblicazione delle versioni PVL (istante, poi identificativo), come prima
      confronta: (a, b) => confrontaVersioniPvl({ data: a.versione.istante as string, idAvviso: a.idAvviso }, { data: b.versione.istante as string, idAvviso: b.idAvviso }),
      collegaPerCig: false,
      proponiEnteGiorno: false,
      classificazioni: opzioni.classificazioni,
      nuovoId: opzioni.nuovoId,
    },
  );
  stat.bandi.invariati += e.invariati;
  stat.bandi.conflitti += e.conflitti;
  for (const g of e.gare) {
    if (g.nuova) {
      // gara entrata ora: nazionale (nessun avviso TED citato) oppure sopra soglia non ancora arrivata da TED
      if (g.avvisiConTed) stat.bandi.nuoveSopraSogliaSenzaTed++;
      else stat.bandi.nuoveNazionali++;
      if (!g.apertaAllImportazione) stat.bandi.scaduteAllImportazione++;
    } else if (g.via === "ted" || (g.via === "cig" && !(g.chiaveIniziale ?? "").startsWith("pvl:"))) stat.bandi.giaPresentiTed++;
    else stat.bandi.nuoveVersioni++;
    if (!g.nuova && g.cambiata) stat.bandi.aggiornate++;
    if (g.suCollegata) stat.bandi.suGaraCollegata++;
    if (g.rettifica) stat.bandi.rettifiche++;
    if (g.annullamento) stat.bandi.annullate++;
    if (g.lottiNonAllineati) stat.bandi.lottiNonAllineati++;
    stat.bandi.cigScartati += g.cigScartati;
    for (const m of g.mancanti) aggiungi(stat.bandi.mancanti, m);
  }
  stat.bandi.lotti += e.lotti;
  stat.bandi.cigAssegnati += e.cigAssegnati;
  stat.bandi.cigScartati += e.cigScartati;
  stat.bandi.aggiunteCollegate += e.aggiunteCollegate;
  stat.bandi.collegateDoppie += e.collegateDoppie;
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
  const dest = await destinazioniFonte(admin, "pvl", nuovi.map((e) => ({ idProcedura: e.meta.idAppalto, rifTed: e.meta.numeroTed, cig: e.cig.map((c) => cigPvl(c)).filter((c): c is string => !!c) })), misure);
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
