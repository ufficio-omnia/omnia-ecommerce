// Un giro di importazione dalla PVL di ANAC (fase B1-bis, SOLO STAGING): pulsante della console, script dello staging e, quando sarà
// autorizzato, i giri programmati (src/app/api/cron/radar-pvl). Solo server, chiave di servizio, nessun modello AI.
//
// Non fa nulla se: il database non è lo staging (ambiente.ts), la fonte PVL è spenta o sospesa (radar_fonti_stato.attiva, dalla console),
// le tabelle mancano, un altro giro è in corso. Risorse sotto controllo:
//   - un solo giro alla volta (blocco con scrittura condizionata, scade da solo);
//   - verso la PVL: pausa tra le richieste, tempo massimo, tetto di richieste per giro, sospensione su 401/403/429 o risposta anomala;
//   - punto di ripresa salvato dopo ogni pagina; tutte le scritture sono idempotenti (impronte e chiavi);
//   - misure del giro (richieste e tempi verso la PVL e verso il database) salvate in radar_fonti_stato.conteggi e mostrate in console.
// Un errore della PVL non tocca TED né la ricerca: il giro si chiude, la fonte PVL resta con il suo errore, il resto continua.
import type { SupabaseClient } from "@supabase/supabase-js";
import { schemaAssente } from "@/lib/omnia-ai-incassi";
import { classificazioniAttive, scrittureRadarConsentite } from "./ambiente";
import { registroConEvidenza } from "./importa-evidenza";
import { cpvRicercaPvl, leggiAvvisoPvl, limitiPvl, limitiPvlDaRighe, type BandoPvl, type EsitoPvl, type LimitiPvl } from "./fonti/pvl-calcoli";
import { ErrorePvl, SessionePvl } from "./fonti/pvl";
import type { Misure } from "./importa";
import { applicaEsitiPvl, applicaPaginaBandiPvl } from "./importa-pvl-pagina";
import { aggiungi, conteggioAnomalo, cursoreDopoPagina, cursoreFinestra, cursoreIncrementale, statistichePvlVuote, type CursorePvl, type StatistichePvl } from "./importa-pvl-calcoli";
import { giornoIso } from "./importa-ted-calcoli";
import { erroreDaConservare } from "./lavori-calcoli";
import { datiGiroPvl, type OrigineGiro } from "./esecuzioni-calcoli";
import { giroRegistrato, type EsitoRegistro } from "./esecuzioni";

export type RisultatoImportazionePvl =
  | { eseguita: false; motivo: "ambiente_non_consentito" | "fonte_spenta" | "occupata" | "schema_assente" | "errore_lettura"; dettaglio?: string }
  // fermata: la fonte è stata spenta dalla console a metà giro e il giro si è fermato alla pagina dopo (K7)
  | { eseguita: true; modo: CursorePvl["modo"]; giroFinito: boolean; sospesa: boolean; fermata: boolean; statistiche: StatistichePvl & { db: Misure }; durataMs: number; errore: string | null; cursore: CursorePvl };

export type OpzioniImportazionePvl = {
  modo: "finestra" | "incrementale";
  // solo per la finestra controllata (giorni AAAA-MM-GG, compresi)
  da?: string;
  a?: string;
  tempoMassimoMs: number;
  limiti?: Partial<LimitiPvl>;
  adesso?: () => Date;
  fetchFn?: typeof fetch;
  env?: Record<string, string | undefined>;
  // chi lancia il giro (cron, console, script), per il registro dei giri (0128); nuovoIdEsecuzione solo per le prove
  origine?: OrigineGiro;
  nuovoIdEsecuzione?: () => string;
};

type RigaFonte = { attiva: boolean; cursore: unknown; blocco_fino_a: string | null; conteggi: Record<string, unknown> | null };

/** Un giro PVL, registrato in radar_esecuzioni (0128): una riga a fine giro, mai dove la fonte non può scrivere (esecuzioni.ts). */
export function eseguiImportazionePvl(admin: SupabaseClient, opzioni: OpzioniImportazionePvl): Promise<RisultatoImportazionePvl & { esecuzione: EsitoRegistro }> {
  return giroRegistrato(admin, "pvl", opzioni, (esecuzioneId) => giroPvl(admin, opzioni, esecuzioneId), datiGiroPvl);
}

async function giroPvl(admin: SupabaseClient, opzioni: OpzioniImportazionePvl, esecuzioneId: string): Promise<RisultatoImportazionePvl> {
  const permesso = scrittureRadarConsentite("pvl", opzioni.env ?? process.env);
  if (!permesso.ok) return { eseguita: false, motivo: "ambiente_non_consentito", dettaglio: permesso.motivo };
  // fase B2b: classificazioni della 0121 nel giro solo con l'interruttore acceso (spento di base)
  const classificazioni = classificazioniAttive(opzioni.env ?? process.env);
  // fase B4: fotografie, rilevamento delle modifiche PVL ed evidenza nel registro solo con l'interruttore RADAR_REGISTRO_EVIDENZA (spento)
  const evidenza = registroConEvidenza(opzioni.env ?? process.env);

  const ora = opzioni.adesso ?? (() => new Date());
  const inizio = ora();
  const { data: fonte, error } = await admin.from("radar_fonti_stato").select("attiva, cursore, blocco_fino_a, conteggi").eq("fonte", "pvl").maybeSingle<RigaFonte>();
  if (error) return { eseguita: false, motivo: schemaAssente(error) ? "schema_assente" : "errore_lettura" };
  if (!fonte || !fonte.attiva) return { eseguita: false, motivo: "fonte_spenta" };

  const scadenzaBlocco = new Date(inizio.getTime() + opzioni.tempoMassimoMs + 120_000).toISOString();
  const presa = await admin
    .from("radar_fonti_stato")
    .update({ blocco_fino_a: scadenzaBlocco, ultimo_avvio_il: inizio.toISOString(), aggiornata_il: inizio.toISOString() })
    .eq("fonte", "pvl")
    .or(`blocco_fino_a.is.null,blocco_fino_a.lt.${inizio.toISOString()}`)
    .select("fonte");
  if (presa.error) return { eseguita: false, motivo: "errore_lettura" };
  if ((presa.data ?? []).length === 0) return { eseguita: false, motivo: "occupata" };

  const oggi = giornoIso(inizio);
  let cursore: CursorePvl;
  try {
    cursore = opzioni.modo === "finestra" ? cursoreFinestra(opzioni.da ?? oggi, opzioni.a ?? oggi, fonte.cursore) : cursoreIncrementale(fonte.cursore, oggi);
  } catch (e) {
    await admin.from("radar_fonti_stato").update({ blocco_fino_a: null }).eq("fonte", "pvl");
    return { eseguita: false, motivo: "errore_lettura", dettaglio: e instanceof Error ? e.message : String(e) };
  }
  // una finestra controllata riprende il proprio punto se è la stessa finestra interrotta
  const salvato = fonte.cursore as Partial<CursorePvl> | null;
  if (opzioni.modo === "finestra" && salvato?.inCorso && salvato.modo === "finestra" && salvato.da === cursore.da && salvato.a === cursore.a && typeof salvato.token === "string") {
    cursore = { ...cursore, token: salvato.token, pagine: Number(salvato.pagine) || 0 };
  }

  // limiti di cortesia: quelli della console (entro gli intervalli ammessi), poi quelli passati dallo script per una prova più prudente
  const { data: righeLimiti } = await admin.from("console_impostazioni").select("chiave, valore").like("chiave", "radar_pvl_%").returns<{ chiave: string; valore: string }[]>();
  const limiti = limitiPvl({ ...limitiPvlDaRighe(righeLimiti), ...(opzioni.limiti ?? {}) });
  const sessione = new SessionePvl(limiti, opzioni.fetchFn);
  const stat = statistichePvlVuote();
  const db: Misure = { richiesteDb: 0, msDb: 0 };
  const cpv = cpvRicercaPvl();
  const modoImportazione = cursore.modo === "incrementale" ? "incrementale" : "recupero";
  let errore: string | null = null;
  let sospesa = false;
  let fermata = false;

  try {
    while (cursore.inCorso && ora().getTime() - inizio.getTime() < opzioni.tempoMassimoMs) {
      const pagina = await sessione.leggiPagina({ da: cursore.da, a: cursore.a, cpv, token: cursore.token });
      if (stat.pvl.conteggioDichiarato === null) stat.pvl.conteggioDichiarato = pagina.count;
      if (conteggioAnomalo(pagina.count, cursore)) throw new ErrorePvl(`Numero di avvisi anomalo (${pagina.count}) per la finestra ${cursore.da} – ${cursore.a}: connettore sospeso finché non si verifica`, 200, true);
      const letti = pagina.content.map(leggiAvvisoPvl);
      // il «tipo» dell'avviso (rettifica dichiarata) sta solo nell'avviso grezzo: serve alla fotografia della versione (fase B4)
      const grezzi = new Map<string, unknown>();
      if (evidenza) pagina.content.forEach((g, i) => { const l = letti[i]; if (l.tipo === "bando") grezzi.set(l.meta.idAvviso, g); });
      stat.avvisi.letti += letti.length;
      const bandi: BandoPvl[] = [];
      const esiti: EsitoPvl[] = [];
      for (const l of letti) {
        if (l.meta) {
          aggiungi(stat.avvisi.perScheda, l.meta.scheda);
          if (l.meta.sostituitoDa || l.meta.tipoSostituzione) aggiungi(stat.avvisi.sostituiti, l.meta.tipoSostituzione ?? "senza_tipo");
          if (!l.meta.attivo) stat.avvisi.nonAttivi++;
        }
        if (l.tipo === "bando") bandi.push(l);
        else if (l.tipo === "esito") esiti.push(l);
        else aggiungi(stat.avvisi.esclusi, l.motivo);
      }
      stat.avvisi.bandi += bandi.length;
      stat.avvisi.esiti += esiti.length;
      const adesso = ora();
      await applicaPaginaBandiPvl(admin, bandi, modoImportazione, adesso, db, stat, { classificazioni, evidenza, grezzi, esecuzioneId });
      await applicaEsitiPvl(admin, esiti, modoImportazione, adesso, db, stat);
      // ultima pagina anche secondo il conteggio dichiarato (attendibile sotto i mille risultati): nessuna richiesta in più alla fonte
      const ultimaPerConteggio = pagina.count !== null && pagina.count < 1000 && (cursore.pagine + 1) * limiti.avvisiPerPagina >= pagina.count;
      const prossimo = cursoreDopoPagina(cursore, pagina.content.length, ultimaPerConteggio ? null : pagina.token, limiti.avvisiPerPagina);
      // punto di ripresa dopo ogni pagina, SOLO se la fonte è ancora accesa (K7, 48C §3.6): spenta dalla console a metà giro, il giro si
      // ferma qui, senza richieste in più. Il punto salvato resta quello della pagina prima: la pagina appena scritta si rilegge alla
      // riaccensione, senza effetti (le gare già scritte risultano invariate)
      const salvataggio = await admin.from("radar_fonti_stato").update({ cursore: prossimo, aggiornata_il: ora().toISOString() }).eq("fonte", "pvl").eq("attiva", true).select("fonte");
      db.richiesteDb++;
      if (salvataggio.error) throw new Error(`salvataggio del punto di ripresa: ${salvataggio.error.message}`);
      if ((salvataggio.data ?? []).length === 0) {
        fermata = true;
        break;
      }
      cursore = prossimo;
    }
  } catch (e) {
    if (e instanceof ErrorePvl && e.tetto) {
      errore = null;
    } else {
      errore = erroreDaConservare(e instanceof Error ? e.message : String(e));
      sospesa = e instanceof ErrorePvl && e.sospendi;
      console.error("Tender Intelligence: importazione PVL interrotta", errore);
    }
  }

  stat.pvl.richieste = sessione.richieste;
  stat.pvl.byte = sessione.byte;
  stat.pvl.ms = sessione.ms;
  for (const r of sessione.registro) aggiungi(stat.pvl.risposte, r.stato === null ? "rete" : String(r.stato));

  const fine = ora();
  const durataMs = fine.getTime() - inizio.getTime();
  const conteggi = {
    ...(fonte.conteggi ?? {}),
    ...(sospesa ? { sospensione: { il: fine.toISOString(), motivo: errore } } : {}),
    ultimo_giro: { iniziato_il: inizio.toISOString(), durata_ms: durataMs, modo: cursore.modo, finestra: { da: cursore.da, a: cursore.a }, giro_finito: !cursore.inCorso, fermata_dalla_console: fermata, limiti, ...stat, db, errore },
  };
  await admin
    .from("radar_fonti_stato")
    .update({
      blocco_fino_a: null,
      conteggi,
      aggiornata_il: fine.toISOString(),
      ...(sospesa ? { attiva: false } : {}),
      ...(errore ? { ultimo_errore: errore, ultimo_errore_il: fine.toISOString() } : { ultimo_successo_il: fine.toISOString() }),
      ...(cursore.ultimoGiorno ? { dati_aggiornati_al: `${cursore.ultimoGiorno}T12:00:00Z` } : {}),
    })
    .eq("fonte", "pvl");

  return { eseguita: true, modo: cursore.modo, giroFinito: !cursore.inCorso, sospesa, fermata, statistiche: { ...stat, db }, durataMs, errore, cursore };
}
