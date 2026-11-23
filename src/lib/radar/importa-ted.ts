// Un giro di importazione da TED: cron quotidiano (src/app/api/cron/radar-ted), pulsante della console e script locale per lo staging.
// Solo server, chiave di servizio. Non fa nulla se la fonte TED è spenta (radar_fonti_stato.attiva, dalla console) o se le tabelle mancano.
//
// Risorse sotto controllo (richiesta del 16/11/2026):
//   - un solo giro alla volta (blocco con scrittura condizionata su radar_fonti_stato.blocco_fino_a, scade da solo);
//   - tempo massimo e pagine massime per giro; punto di ripresa salvato dopo ogni pagina;
//   - verso TED una richiesta ogni 1,5 s al massimo (fonti/ted.ts);
//   - misure di ogni giro (richieste e tempi verso TED e verso il database) salvate in radar_fonti_stato.conteggi e mostrate in console.
import type { SupabaseClient } from "@supabase/supabase-js";
import { schemaAssente } from "@/lib/omnia-ai-incassi";
import { classificazioniAttive, scrittureRadarConsentite } from "./ambiente";
import { registroConEvidenza } from "./importa-evidenza";
import { vociCpv } from "./settori";
import { AVVISI_PER_PAGINA, leggiBandoTed, leggiEsitoTed, type EsitoTed } from "./fonti/ted-calcoli";
import { leggiPaginaTed } from "./fonti/ted";
import { applicaPaginaBandi, applicaPaginaEsiti, type EsitoPaginaBandi, type EsitoPaginaEsiti, type Misure } from "./importa";
import { cursoreAllAvvio, cursoreDopoPagina, cursoreIniziale, finestraCorrente, giornoIso, serveNuovoRecupero, type CursoreTed } from "./importa-ted-calcoli";
import { erroreDaConservare } from "./lavori-calcoli";
import { datiGiroTed, type OrigineGiro } from "./esecuzioni-calcoli";
import { giroRegistrato, type EsitoRegistro } from "./esecuzioni";
import { eDoppioRichiamo } from "./programmazione-calcoli";

export type TotaliGiro = {
  pagine: number;
  bandi: Omit<EsitoPaginaBandi, "esclusi"> & { esclusi: Record<string, number> };
  esiti: EsitoPaginaEsiti;
  ted: { richieste: number; byte: number; ms: number };
  db: Misure;
};

export type RisultatoImportazioneTed =
  | { eseguita: false; motivo: "ambiente_non_consentito" | "fonte_spenta" | "occupata" | "gia_eseguito" | "schema_assente" | "errore_lettura"; dettaglio?: string }
  // fermata: la fonte è stata spenta dalla console a metà giro e il giro si è fermato alla pagina dopo (K7)
  | { eseguita: true; fase: CursoreTed["fase"]; giroFinito: boolean; fermata: boolean; totali: TotaliGiro; durataMs: number; errore: string | null; cursore: CursoreTed };

// origine: chi lancia il giro (cron, console, script), per il registro dei giri (0128); nuovoIdEsecuzione solo per le prove
export type OpzioniImportazione = { tempoMassimoMs: number; pagineMassime: number; adesso?: () => Date; fetchFn?: typeof fetch; pausaMs?: number; env?: Record<string, string | undefined>; origine?: OrigineGiro; nuovoIdEsecuzione?: () => string };

function totaliVuoti(): TotaliGiro {
  return {
    pagine: 0,
    bandi: { letti: 0, esclusi: {}, invariati: 0, nuove: 0, aggiornate: 0, soloProvenienza: 0, rettifiche: 0, annullate: 0, lotti: 0, cigScartati: 0, aggiunteCollegate: 0, unitePvl: 0, collegateDoppie: 0 },
    esiti: { letti: 0, applicati: 0, senzaBando: 0, invariati: 0, senzaStato: 0 },
    ted: { richieste: 0, byte: 0, ms: 0 },
    db: { richiesteDb: 0, msDb: 0 },
  };
}

function somma(t: TotaliGiro, b: EsitoPaginaBandi | null, e: EsitoPaginaEsiti | null) {
  if (b) {
    for (const k of ["letti", "invariati", "nuove", "aggiornate", "soloProvenienza", "rettifiche", "annullate", "lotti", "cigScartati", "aggiunteCollegate", "unitePvl", "collegateDoppie"] as const) t.bandi[k] += b[k];
    for (const [k, v] of Object.entries(b.esclusi)) t.bandi.esclusi[k] = (t.bandi.esclusi[k] ?? 0) + v;
  }
  if (e) for (const k of ["letti", "applicati", "senzaBando", "invariati", "senzaStato"] as const) t.esiti[k] += e[k];
}

type RigaFonte = { attiva: boolean; ultimo_successo_il: string | null; cursore: unknown; blocco_fino_a: string | null; conteggi: Record<string, unknown> | null };

/** Un giro TED, registrato in radar_esecuzioni (0128): una riga a fine giro, mai dove la fonte non può scrivere (esecuzioni.ts). */
export function eseguiImportazioneTed(admin: SupabaseClient, opzioni: OpzioniImportazione): Promise<RisultatoImportazioneTed & { esecuzione: EsitoRegistro }> {
  return giroRegistrato(admin, "ted", opzioni, (esecuzioneId) => giroTed(admin, opzioni, esecuzioneId), datiGiroTed);
}

async function giroTed(admin: SupabaseClient, opzioni: OpzioniImportazione, esecuzioneId: string): Promise<RisultatoImportazioneTed> {
  // protezione contro le scritture accidentali in produzione (ambiente.ts): prima di qualunque lettura o scrittura
  const permesso = scrittureRadarConsentite("ted", opzioni.env ?? process.env);
  if (!permesso.ok) return { eseguita: false, motivo: "ambiente_non_consentito", dettaglio: permesso.motivo };
  // fase B2b: classificazioni della 0121 nel giro solo con l'interruttore acceso (spento di base)
  const classificazioni = classificazioniAttive(opzioni.env ?? process.env);
  // fase B4: colonne dell'evidenza (0123) nel registro solo con l'interruttore RADAR_REGISTRO_EVIDENZA (spento di base, solo staging)
  const evidenza = registroConEvidenza(opzioni.env ?? process.env);
  const ora = opzioni.adesso ?? (() => new Date());
  const inizio = ora();
  const { data: fonte, error } = await admin.from("radar_fonti_stato").select("attiva, ultimo_successo_il, cursore, blocco_fino_a, conteggi").eq("fonte", "ted").maybeSingle<RigaFonte>();
  if (error) return { eseguita: false, motivo: schemaAssente(error) ? "schema_assente" : "errore_lettura" };
  if (!fonte || !fonte.attiva) return { eseguita: false, motivo: "fonte_spenta" };
  // doppio richiamo (K1, 48C §3.1 punto 7): un giro programmato già riuscito da meno di 45 minuti non riparte (nessuna scrittura, nessuna
  // chiamata alla fonte; la riga «gia_eseguito» va nel registro). Console e script restano ammessi
  if (eDoppioRichiamo(opzioni.origine, fonte.ultimo_successo_il, inizio)) return { eseguita: false, motivo: "gia_eseguito" };

  // blocco: vince una sola esecuzione; scade da solo dopo il tempo massimo più due minuti
  const scadenzaBlocco = new Date(inizio.getTime() + opzioni.tempoMassimoMs + 120_000).toISOString();
  const presa = await admin
    .from("radar_fonti_stato")
    .update({ blocco_fino_a: scadenzaBlocco, ultimo_avvio_il: inizio.toISOString(), aggiornata_il: inizio.toISOString() })
    .eq("fonte", "ted")
    .or(`blocco_fino_a.is.null,blocco_fino_a.lt.${inizio.toISOString()}`)
    .select("fonte");
  if (presa.error) return { eseguita: false, motivo: "errore_lettura" };
  if ((presa.data ?? []).length === 0) return { eseguita: false, motivo: "occupata" };

  const oggi = giornoIso(inizio);
  let cursore = cursoreAllAvvio(fonte.cursore, oggi);
  if (serveNuovoRecupero(cursore, oggi)) cursore = cursoreIniziale(oggi);
  const faseIniziale = cursore.fase;
  const totali = totaliVuoti();
  const cpv = vociCpv().map((v) => v.cpv);
  let errore: string | null = null;
  let fermata = false;

  try {
    while (cursore.inCorso && totali.pagine < opzioni.pagineMassime && ora().getTime() - inizio.getTime() < opzioni.tempoMassimoMs) {
      const finestra = finestraCorrente(cursore);
      const modo = cursore.fase === "recupero" ? "recupero" : "incrementale";
      const pagina = await leggiPaginaTed(cursore.tipo, cpv, finestra.da, finestra.a, cursore.pagina, { fetchFn: opzioni.fetchFn, pausaMs: opzioni.pausaMs });
      totali.ted.richieste++;
      totali.ted.byte += pagina.byte;
      totali.ted.ms += pagina.ms;
      const adesso = ora();
      if (cursore.tipo === "bando") {
        somma(totali, await applicaPaginaBandi(admin, pagina.avvisi.map(leggiBandoTed), modo, adesso, totali.db, { classificazioni, evidenza, esecuzioneId }), null);
      } else {
        somma(totali, null, await applicaPaginaEsiti(admin, pagina.avvisi.map(leggiEsitoTed).filter((e): e is EsitoTed => !!e), modo, adesso, totali.db));
      }
      totali.pagine++;
      const prossimo = cursoreDopoPagina(cursore, pagina.avvisi.length, pagina.totale, AVVISI_PER_PAGINA, oggi);
      // punto di ripresa dopo ogni pagina, SOLO se la fonte è ancora accesa (K7, 48C §3.6): spenta dalla console a metà giro, il giro si
      // ferma qui, senza richieste in più. Il punto salvato resta quello della pagina prima: la pagina appena scritta si rilegge alla
      // riaccensione, senza effetti (le gare già scritte risultano invariate)
      const salvataggio = await admin.from("radar_fonti_stato").update({ cursore: prossimo, aggiornata_il: ora().toISOString() }).eq("fonte", "ted").eq("attiva", true).select("fonte");
      totali.db.richiesteDb++;
      if (salvataggio.error) throw new Error(`salvataggio del punto di ripresa: ${salvataggio.error.message}`);
      if ((salvataggio.data ?? []).length === 0) {
        fermata = true;
        break;
      }
      cursore = prossimo;
    }
  } catch (e) {
    errore = erroreDaConservare(e instanceof Error ? e.message : String(e));
    console.error("Tender Intelligence: importazione TED interrotta", errore);
  }

  const fine = ora();
  const durataMs = fine.getTime() - inizio.getTime();
  const conteggi = {
    ...(fonte.conteggi ?? {}),
    ultimo_giro: { iniziato_il: inizio.toISOString(), durata_ms: durataMs, fase: faseIniziale, giro_finito: !cursore.inCorso, fermata_dalla_console: fermata, ...totali, errore },
  };
  await admin
    .from("radar_fonti_stato")
    .update({
      blocco_fino_a: null,
      conteggi,
      aggiornata_il: fine.toISOString(),
      ...(errore ? { ultimo_errore: errore, ultimo_errore_il: fine.toISOString() } : { ultimo_successo_il: fine.toISOString() }),
      // «avvisi letti fino al giorno X»: conta il giorno, l'ora salvata (mezzogiorno UTC, sempre lo stesso giorno a Roma) non si mostra
      ...(cursore.ultimoGiorno ? { dati_aggiornati_al: `${cursore.ultimoGiorno}T12:00:00Z` } : {}),
    })
    .eq("fonte", "ted");

  return { eseguita: true, fase: faseIniziale, giroFinito: !cursore.inCorso, fermata, totali, durataMs, errore, cursore };
}
