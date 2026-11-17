// Scrittura nell'archivio dei bandi delle fonti regionali e delle piattaforme (fase B2a: Sintel, SardegnaCAT): ADATTATORE della scrittura
// unica delle fonti (importa-fonti-pagina.ts, la stessa della PVL). Nessun archivio, motore o sistema di unione paralleli. Solo server.
//
// Rispetto alla PVL: la procedura è un solo avviso aggiornato sul posto (id_fonte = id_procedura_fonte = identificativo della procedura);
// lo stesso CIG su un'altra gara è la stessa gara pubblicata due volte e si unisce (identificativo ufficiale); l'identificativo della
// piattaforma e la coppia ente + giorno di scadenza danno SOLO suggerimenti da confermare in console (decisione dell'utente del 17/11).
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Misure } from "./importa";
import type { ModoImportazione } from "./importa-calcoli";
import { applicaPaginaBandiFonte, type BandoUnificabile } from "./importa-fonti-pagina";
import { conta, rigaDaBandoRegionale, type BandoRegionale, type FonteRegionale, type StatisticheRegionali } from "./importa-regionali-calcoli";
import { confrontaVersioni } from "./unione-calcoli";

export type OpzioniPaginaRegionale = { fonte: FonteRegionale; modo: ModoImportazione; adesso: Date; misure: Misure; stat: StatisticheRegionali; nascoste: ReadonlySet<string>; proponi: boolean };

export function bandoUnificabileRegionale(b: BandoRegionale, adesso: Date): BandoUnificabile {
  return {
    fonte: b.fonte,
    idAvviso: b.idProcedura,
    idProcedura: b.idProcedura,
    rifTed: null,
    piattaformaId: b.piattaformaId,
    versione: b.versione,
    idCambiamento: b.idCambiamento,
    riga: rigaDaBandoRegionale(b, adesso),
    record: b.record,
    lottiScadenze: b.lottiScadenze,
    lottiDocumenti: b.lottiDocumenti,
    mancanti: b.mancanti,
    tipoAvvisoFonte: b.tipoAvvisoFonte?.slice(0, 60) ?? null,
    motivoModifica: null,
    pubblicatoIl: b.pubblicatoIl,
  };
}

export async function applicaPaginaBandiRegionali(admin: SupabaseClient, bandi: readonly BandoRegionale[], o: OpzioniPaginaRegionale): Promise<void> {
  const { stat } = o;
  const e = await applicaPaginaBandiFonte(
    admin,
    bandi.filter((b) => b.fonte === o.fonte).map((b) => bandoUnificabileRegionale(b, o.adesso)),
    { fonte: o.fonte, modo: o.modo, adesso: o.adesso, misure: o.misure, nascoste: o.nascoste, confronta: (a, b) => confrontaVersioni(a.versione, b.versione), collegaPerCig: true, proponiEnteGiorno: o.proponi },
  );
  stat.invariati += e.invariati;
  stat.conflitti += e.conflitti;
  for (const g of e.gare) {
    stat.nonApplicateNascosta += g.nonApplicati;
    if (g.avvisi === 0) continue;
    if (g.nuova) stat.nuove++;
    else {
      conta(stat.suGaraEsistente, g.via);
      if (g.cambiata) stat.aggiornate++;
    }
    if (g.suCollegata) stat.suGaraCollegata++;
    if (g.rettifica) stat.rettifiche++;
    if (g.annullamento) stat.annullate++;
    stat.cigScartati += g.cigScartati;
    for (const m of g.mancanti) conta(stat.mancanti, m);
  }
  stat.lotti += e.lotti;
  stat.cigAssegnati += e.cigAssegnati;
  stat.cigScartati += e.cigScartati;
  stat.aggiunteCollegate += e.aggiunteCollegate;
  stat.collegateDoppie += e.collegateDoppie;
  stat.proposte += e.proposte;
  stat.ambiguita += e.ambiguita;
}
