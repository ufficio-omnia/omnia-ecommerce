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
import { aggiungi, conteggioAnomalo, misuraPerCodicePvl, statistichePvlVuote, type StatistichePvl } from "./importa-pvl-calcoli";
import {
  CONTEGGIO_ATTENDIBILE,
  RICHIESTE_RECUPERO_PER_GIRO,
  allarmiCursorePvl,
  bloccoDaLeggere,
  conFinestra,
  conIncrementale,
  cursorePvlDaSalvato,
  dopoPaginaFinestra,
  dopoPaginaIncrementale,
  dopoPaginaRecupero,
  giorniNeiBuchi,
  giorniObiettivoResidui,
  type CursorePvlV2,
  type EsitoPaginaRecupero,
  type LetturaPvl,
} from "./importa-pvl-cursore";
import { giornoIso } from "./importa-ted-calcoli";
import { erroreDaConservare } from "./lavori-calcoli";
import { datiGiroPvl, type OrigineGiro } from "./esecuzioni-calcoli";
import { giroRegistrato, type EsitoRegistro } from "./esecuzioni";
import { eDoppioRichiamo } from "./programmazione-calcoli";
import { userAgentFonti } from "./fonti/user-agent";

export type RisultatoImportazionePvl =
  | { eseguita: false; motivo: "ambiente_non_consentito" | "contatto_mancante" | "fonte_spenta" | "occupata" | "gia_eseguito" | "schema_assente" | "errore_lettura"; dettaglio?: string }
  // fermata: la fonte è stata spenta dalla console a metà giro e il giro si è fermato alla pagina dopo (K7)
  // letta: la finestra principale del giro (incrementale o controllata) e le pagine lette; recupero e allarmi: K4 (cursore v2)
  | {
      eseguita: true;
      modo: "finestra" | "incrementale";
      giroFinito: boolean;
      sospesa: boolean;
      fermata: boolean;
      statistiche: StatistichePvl & { db: Misure };
      durataMs: number;
      errore: string | null;
      cursore: CursorePvlV2;
      letta: { da: string; a: string; pagine: number } | null;
      recupero: StatisticheRecuperoPvl;
      allarmi: string[];
    };

export type StatisticheRecuperoPvl = {
  richieste: number;
  blocchi: { da: string; a: string; esito: EsitoPaginaRecupero; letti: number; dichiarati: number | null }[];
  giorniBuchi: number;
  giorniObiettivo: number;
  fermo: boolean;
};

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

type RigaFonte = { attiva: boolean; ultimo_successo_il: string | null; cursore: unknown; blocco_fino_a: string | null; conteggi: Record<string, unknown> | null };

/** Un giro PVL, registrato in radar_esecuzioni (0128): una riga a fine giro, mai dove la fonte non può scrivere (esecuzioni.ts). */
export function eseguiImportazionePvl(admin: SupabaseClient, opzioni: OpzioniImportazionePvl): Promise<RisultatoImportazionePvl & { esecuzione: EsitoRegistro }> {
  return giroRegistrato(admin, "pvl", opzioni, (esecuzioneId) => giroPvl(admin, opzioni, esecuzioneId), datiGiroPvl);
}

async function giroPvl(admin: SupabaseClient, opzioni: OpzioniImportazionePvl, esecuzioneId: string): Promise<RisultatoImportazionePvl> {
  const permesso = scrittureRadarConsentite("pvl", opzioni.env ?? process.env);
  if (!permesso.ok) return { eseguita: false, motivo: "ambiente_non_consentito", dettaglio: permesso.motivo };
  // K9 (L7): User-Agent con il contatto reale (RADAR_CONTATTO_FONTI); fuori dallo staging, senza contatto valido, il giro non parte. Il
  // motivo dice che cosa manca, mai il valore del contatto
  const ua = userAgentFonti(opzioni.env ?? process.env);
  if (!ua.ok) return { eseguita: false, motivo: "contatto_mancante", dettaglio: ua.motivo };
  // fase B2b: classificazioni della 0121 nel giro solo con l'interruttore acceso (spento di base)
  const classificazioni = classificazioniAttive(opzioni.env ?? process.env);
  // fase B4: fotografie, rilevamento delle modifiche PVL ed evidenza nel registro solo con l'interruttore RADAR_REGISTRO_EVIDENZA (spento)
  const evidenza = registroConEvidenza(opzioni.env ?? process.env);

  const ora = opzioni.adesso ?? (() => new Date());
  const inizio = ora();
  const { data: fonte, error } = await admin.from("radar_fonti_stato").select("attiva, ultimo_successo_il, cursore, blocco_fino_a, conteggi").eq("fonte", "pvl").maybeSingle<RigaFonte>();
  if (error) return { eseguita: false, motivo: schemaAssente(error) ? "schema_assente" : "errore_lettura" };
  if (!fonte || !fonte.attiva) return { eseguita: false, motivo: "fonte_spenta" };
  // doppio richiamo (K1, 48C §3.1 punto 7): un giro programmato già riuscito da meno di 45 minuti non riparte (nessuna scrittura, nessuna
  // chiamata alla fonte; la riga «gia_eseguito» va nel registro). Console e script restano ammessi
  if (eDoppioRichiamo(opzioni.origine, fonte.ultimo_successo_il, inizio)) return { eseguita: false, motivo: "gia_eseguito" };

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
  const modo = opzioni.modo;
  let cursore: CursorePvlV2;
  // un fermo scoperto in questo giro (periodo entrato nei buchi): l'allarme va nel registro anche se il recupero lo chiude subito
  let nuovoBuco = false;
  try {
    // cursore v2 (K4): un cursore v1 salvato si converte senza perdere l'ultimo giorno letto né la lettura a metà
    const base = cursorePvlDaSalvato(fonte.cursore, oggi);
    cursore = modo === "finestra" ? conFinestra(base, opzioni.da ?? oggi, opzioni.a ?? oggi) : conIncrementale(base, oggi, inizio.toISOString());
    nuovoBuco = giorniNeiBuchi(cursore) > giorniNeiBuchi(base);
  } catch (e) {
    await admin.from("radar_fonti_stato").update({ blocco_fino_a: null }).eq("fonte", "pvl");
    return { eseguita: false, motivo: "errore_lettura", dettaglio: e instanceof Error ? e.message : String(e) };
  }
  // la lettura principale del giro: l'incrementale (sempre per prima) o la finestra controllata
  const principale = (): LetturaPvl | null => (modo === "finestra" ? cursore.finestra : cursore.incrementale);
  const iniziale = principale();
  const letta = iniziale ? { da: iniziale.da, a: iniziale.a, pagine: 0 } : null;

  // limiti di cortesia: quelli della console (entro gli intervalli ammessi), poi quelli passati dallo script per una prova più prudente
  const { data: righeLimiti } = await admin.from("console_impostazioni").select("chiave, valore").like("chiave", "radar_pvl_%").returns<{ chiave: string; valore: string }[]>();
  const limiti = limitiPvl({ ...limitiPvlDaRighe(righeLimiti), ...(opzioni.limiti ?? {}) });
  const sessione = new SessionePvl(limiti, opzioni.fetchFn, undefined, ua.valore);
  const stat = statistichePvlVuote();
  const db: Misure = { richiesteDb: 0, msDb: 0 };
  const cpv = cpvRicercaPvl();
  const recupero: StatisticheRecuperoPvl = { richieste: 0, blocchi: [], giorniBuchi: 0, giorniObiettivo: 0, fermo: false };
  let errore: string | null = null;
  let sospesa = false;
  let fermata = false;

  // una pagina: lettura dalla PVL (con il controllo del conteggio), scrittura nell'archivio; restituisce quello che serve al cursore
  const leggiEScrivi = async (l: LetturaPvl, modoImportazione: "incrementale" | "recupero") => {
    const pagina = await sessione.leggiPagina({ da: l.da, a: l.a, cpv, token: l.token });
    if (stat.pvl.conteggioDichiarato === null) stat.pvl.conteggioDichiarato = pagina.count;
    if (conteggioAnomalo(pagina.count, l)) throw new ErrorePvl(`Numero di avvisi anomalo (${pagina.count}) per la finestra ${l.da} – ${l.a}: connettore sospeso finché non si verifica`, 200, true);
    const letti = pagina.content.map(leggiAvvisoPvl);
    // C2 (49C, R2): misura per codice dell'elenco di ricerca, nel registro dei giri
    misuraPerCodicePvl(stat.avvisi, pagina.content as Record<string, unknown>[], letti);
    // il «tipo» dell'avviso (rettifica dichiarata) sta solo nell'avviso grezzo: serve alla fotografia della versione (fase B4)
    const grezzi = new Map<string, unknown>();
    if (evidenza) pagina.content.forEach((g, i) => { const x = letti[i]; if (x.tipo === "bando") grezzi.set(x.meta.idAvviso, g); });
    stat.avvisi.letti += letti.length;
    const bandi: BandoPvl[] = [];
    const esiti: EsitoPvl[] = [];
    for (const x of letti) {
      if (x.meta) {
        aggiungi(stat.avvisi.perScheda, x.meta.scheda);
        if (x.meta.sostituitoDa || x.meta.tipoSostituzione) aggiungi(stat.avvisi.sostituiti, x.meta.tipoSostituzione ?? "senza_tipo");
        if (!x.meta.attivo) stat.avvisi.nonAttivi++;
      }
      if (x.tipo === "bando") bandi.push(x);
      else if (x.tipo === "esito") esiti.push(x);
      else aggiungi(stat.avvisi.esclusi, x.motivo);
    }
    stat.avvisi.bandi += bandi.length;
    stat.avvisi.esiti += esiti.length;
    const adesso = ora();
    await applicaPaginaBandiPvl(admin, bandi, modoImportazione, adesso, db, stat, { classificazioni, evidenza, grezzi, esecuzioneId });
    await applicaEsitiPvl(admin, esiti, modoImportazione, adesso, db, stat);
    // ultima pagina anche secondo il conteggio dichiarato (attendibile sotto i mille risultati): nessuna richiesta in più alla fonte
    const ultimaPerConteggio = pagina.count !== null && pagina.count < CONTEGGIO_ATTENDIBILE && (l.pagine + 1) * limiti.avvisiPerPagina >= pagina.count;
    return { letti: pagina.content.length, dichiarati: pagina.count, token: ultimaPerConteggio ? null : pagina.token };
  };
  // punto di ripresa dopo ogni pagina, SOLO se la fonte è ancora accesa (K7, 48C §3.6): spenta dalla console a metà giro, il giro si
  // ferma qui, senza richieste in più. Il punto salvato resta quello della pagina prima: la pagina appena scritta si rilegge alla
  // riaccensione, senza effetti (le gare già scritte risultano invariate)
  const salva = async (prossimo: CursorePvlV2): Promise<boolean> => {
    const salvataggio = await admin.from("radar_fonti_stato").update({ cursore: prossimo, aggiornata_il: ora().toISOString() }).eq("fonte", "pvl").eq("attiva", true).select("fonte");
    db.richiesteDb++;
    if (salvataggio.error) throw new Error(`salvataggio del punto di ripresa: ${salvataggio.error.message}`);
    if ((salvataggio.data ?? []).length === 0) {
      fermata = true;
      return false;
    }
    cursore = prossimo;
    return true;
  };
  const neltempo = () => ora().getTime() - inizio.getTime() < opzioni.tempoMassimoMs;

  try {
    // 1. la lettura principale, pagina per pagina
    for (let l = principale(); l && neltempo(); l = principale()) {
      const p = await leggiEScrivi(l, modo === "incrementale" ? "incrementale" : "recupero");
      if (letta) letta.pagine++;
      const prossimo = modo === "finestra" ? dopoPaginaFinestra(cursore, p.letti, p.dichiarati, p.token, limiti.avvisiPerPagina) : dopoPaginaIncrementale(cursore, p.letti, p.dichiarati, p.token, limiti.avvisiPerPagina);
      if (!(await salva(prossimo))) break;
    }
    // 2. recupero (prima i buchi, poi l'obiettivo dei 90 giorni, dal più recente): solo dopo un incrementale FINITO, al massimo 5 richieste
    //    per giro e mai oltre il tetto di richieste del giro (L1, 48C §3.3)
    while (modo === "incrementale" && !fermata && !cursore.incrementale && recupero.richieste < RICHIESTE_RECUPERO_PER_GIRO && sessione.richieste < limiti.richiesteMassime && neltempo()) {
      const blocco = bloccoDaLeggere(cursore);
      if (!blocco) break;
      const p = await leggiEScrivi(blocco, "recupero");
      recupero.richieste++;
      const { cursore: prossimo, esito, bloccoLetto } = dopoPaginaRecupero(cursore, blocco, p.letti, p.dichiarati, p.token, limiti.avvisiPerPagina, ora().toISOString());
      if (!(await salva(prossimo))) break;
      if (bloccoLetto || esito === "dimezzato") recupero.blocchi.push({ da: blocco.da, a: blocco.a, esito, letti: bloccoLetto?.letti ?? p.letti, dichiarati: bloccoLetto?.dichiarati ?? p.dichiarati });
      // un blocco incompleto si ritenta al giro dopo; un recupero fermo aspetta un'azione esplicita
      if (esito === "incompleto" || esito === "fermo") break;
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
  recupero.giorniBuchi = giorniNeiBuchi(cursore);
  recupero.giorniObiettivo = giorniObiettivoResidui(cursore);
  recupero.fermo = cursore.recupero.fermo !== null;
  const allarmi = [...new Set([...allarmiCursorePvl(cursore), ...(nuovoBuco ? ["buco_in_recupero"] : [])])];
  // giro finito = la lettura principale è arrivata in fondo (il recupero è lavoro di fondo, non conta)
  const giroFinito = principale() === null;

  const fine = ora();
  const durataMs = fine.getTime() - inizio.getTime();
  const conteggi = {
    ...(fonte.conteggi ?? {}),
    ...(sospesa ? { sospensione: { il: fine.toISOString(), motivo: errore } } : {}),
    ultimo_giro: { iniziato_il: inizio.toISOString(), durata_ms: durataMs, modo, finestra: letta, giro_finito: giroFinito, fermata_dalla_console: fermata, recupero, allarmi, limiti, ...stat, db, errore },
  };
  await admin
    .from("radar_fonti_stato")
    .update({
      blocco_fino_a: null,
      conteggi,
      aggiornata_il: fine.toISOString(),
      ...(sospesa ? { attiva: false } : {}),
      // S3 (48C §3.3): un giro fermato dal tetto o dal tempo è «ok» ma incompleto; l'ultimo successo si aggiorna solo a giro FINITO
      ...(errore ? { ultimo_errore: errore, ultimo_errore_il: fine.toISOString() } : giroFinito ? { ultimo_successo_il: fine.toISOString() } : {}),
      ...(cursore.ultimoGiorno ? { dati_aggiornati_al: `${cursore.ultimoGiorno}T12:00:00Z` } : {}),
    })
    .eq("fonte", "pvl");

  return { eseguita: true, modo, giroFinito, sospesa, fermata, statistiche: { ...stat, db }, durataMs, errore, cursore, letta, recupero, allarmi };
}
