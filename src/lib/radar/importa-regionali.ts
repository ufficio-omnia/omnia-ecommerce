// Un giro di importazione di una fonte regionale o di una piattaforma (fase B2a: Sintel, SardegnaCAT), con le stesse regole del giro PVL:
// stessa riga di stato (radar_fonti_stato), stesso blocco contro i giri in parallelo (rispetta il semaforo del coordinamento: un blocco
// attivo = «occupata», nessuna scrittura), stessa sospensione automatica, stesse misure. Solo server, chiave di servizio.
//
// Non fa nulla se: il database non è lo staging (ambiente.ts), la fonte è spenta o sospesa (console), il blocco è attivo.
//   - Sintel: prima i metadati (data dell'ultimo caricamento): se è quella già importata il giro finisce lì; altrimenti le righe con scadenza
//     da oggi in poi, normalizzate e scritte con il motore di unione unico; la data letta diventa il punto di ripresa;
//   - SardegnaCAT: una lettura del feed pubblicato; le procedure con lo stesso contenuto non scrivono nulla (impronta).
// Le procedure che spariscono dalla fonte NON si cancellano mai (nessuna cancellazione automatica dall'archivio).
import type { SupabaseClient } from "@supabase/supabase-js";
import { classificazioniAttive, scrittureRadarConsentite } from "./ambiente";
import { registroConEvidenza } from "./importa-evidenza";
import { ErroreFonte, SessioneFonte, limitiValidi, type LimitiFonte } from "./fonti/sessione-fonte";
import { LIMITI_SINTEL_INTERVALLI, LIMITI_SINTEL_PREDEFINITI, leggiRigheSintel } from "./fonti/sintel-calcoli";
import { LettoreSintel } from "./fonti/sintel";
import { ISTANZE_AFLINK, LIMITI_AFLINK_INTERVALLI, LIMITI_AFLINK_PREDEFINITI, bucoPossibileFeed, leggiElementiAflink, pubblicazionePiuVecchiaAflink } from "./fonti/aflink-calcoli";
import { LettoreAflink } from "./fonti/aflink";
import { LIMITI_INTERCENTER_INTERVALLI, LIMITI_INTERCENTER_PREDEFINITI, leggiElementiIntercenter } from "./fonti/intercenter-calcoli";
import { LettoreIntercenter } from "./fonti/intercenter";
import { LIMITI_TUTTOGARE_INTERVALLI, LIMITI_TUTTOGARE_PREDEFINITI, aggiornaCursoreTuttoGare, cursoreTuttoGare, istanzeAttiveTuttoGare, leggiGaraTuttoGare, type CursoreTuttoGare } from "./fonti/tuttogare-calcoli";
import { LettoreTuttoGare } from "./fonti/tuttogare";
import { giornoDiRoma } from "./fonti/ted-calcoli";
import type { Misure } from "./importa";
import { applicaPaginaBandiRegionali } from "./importa-regionali-pagina";
import { bandoDaAflink, bandoDaIntercenter, bandoDaSintel, bandoDaTuttoGare, conta, statisticheRegionaliVuote, type BandoRegionale, type FonteRegionale, type StatisticheRegionali } from "./importa-regionali-calcoli";
import { datiGiroRegionale, type OrigineGiro } from "./esecuzioni-calcoli";
import { giroRegistrato, type EsitoRegistro } from "./esecuzioni";
import { eDoppioRichiamo } from "./programmazione-calcoli";
import { userAgentFonti } from "./fonti/user-agent";

export type RisultatoImportazioneRegionale =
  | { eseguita: false; motivo: "ambiente_non_consentito" | "contatto_mancante" | "fonte_spenta" | "occupata" | "gia_eseguito" | "schema_assente" | "errore_lettura"; dettaglio?: string }
  // giroFinito: tutti i bandi letti sono stati scritti entro il tempo massimo (K6); dichiarati: il conteggio di Sintel (null altrove o se
  // illeggibile); allarmi: conteggio_diverso (Sintel), buco_possibile (feed di SardegnaCAT)
  | {
      eseguita: true;
      fonte: FonteRegionale;
      invariataAllaFonte: boolean;
      sospesa: boolean;
      giroFinito: boolean;
      dichiarati: number | null;
      allarmi: string[];
      statistiche: StatisticheRegionali & { fonte: { richieste: number; byte: number; ms: number }; db: Misure };
      durataMs: number;
      errore: string | null;
    };

// origine: chi lancia il giro (cron, console, script), per il registro dei giri (0128); nuovoIdEsecuzione solo per le prove
export type OpzioniImportazioneRegionale = { tempoMassimoMs?: number; adesso?: () => Date; fetchFn?: typeof fetch; limiti?: Partial<LimitiFonte>; env?: Record<string, string | undefined>; origine?: OrigineGiro; nuovoIdEsecuzione?: () => string };

type RigaFonte = { attiva: boolean; ultimo_successo_il: string | null; cursore: unknown; blocco_fino_a: string | null; conteggi: Record<string, unknown> | null };

// Tempo massimo di un giro regionale se chi lo lancia non lo dice (le rotte cron passano 2 minuti). Il blocco contro i giri in parallelo
// dura il tempo massimo più 2 minuti, come per TED e PVL (K6, 48C S6: prima era fisso a 10 minuti, anche per giri più lunghi)
export const TEMPO_MASSIMO_REGIONALI_MS = 120_000;
export const MARGINE_BLOCCO_MS = 120_000;
const PAGINE_MASSIME_SINTEL = 4;

function schemaAssente(e: { message: string; code?: string }): boolean {
  return e.code === "42703" || e.code === "PGRST204" || /column .* does not exist|nascosta_ai_clienti/.test(e.message);
}

/**
 * Un giro di Sintel, SardegnaCAT o SATER, registrato in radar_esecuzioni (0128): una riga a fine giro, mai dove la fonte non può scrivere.
 * SATER (Fase 2): la riga si scrive solo dopo la 0134, che estende il vincolo della 0128; prima la scrittura non riesce senza fermare nulla.
 * TuttoGare (Fase 2, in costruzione) allo stesso modo con la 0135 PROPOSTA (FONTI_REGISTRO; non in console né negli allarmi).
 */
export function eseguiImportazioneRegionale(admin: SupabaseClient, fonte: FonteRegionale, opzioni: OpzioniImportazioneRegionale = {}): Promise<RisultatoImportazioneRegionale & { esecuzione: EsitoRegistro }> {
  return giroRegistrato(admin, fonte, opzioni, (esecuzioneId) => giroRegionale(admin, fonte, opzioni, esecuzioneId), datiGiroRegionale);
}

async function giroRegionale(admin: SupabaseClient, fonte: FonteRegionale, opzioni: OpzioniImportazioneRegionale, esecuzioneId: string): Promise<RisultatoImportazioneRegionale> {
  const permesso = scrittureRadarConsentite(fonte, opzioni.env ?? process.env);
  if (!permesso.ok) return { eseguita: false, motivo: "ambiente_non_consentito", dettaglio: permesso.motivo };
  // K9 (L7): User-Agent con il contatto reale (RADAR_CONTATTO_FONTI); fuori dallo staging, senza contatto valido, il giro non parte. Il
  // motivo dice che cosa manca, mai il valore del contatto
  const ua = userAgentFonti(opzioni.env ?? process.env);
  if (!ua.ok) return { eseguita: false, motivo: "contatto_mancante", dettaglio: ua.motivo };
  // fase B2b: classificazioni della 0121 nel giro solo con l'interruttore acceso (spento di base)
  const classificazioni = classificazioniAttive(opzioni.env ?? process.env);
  // fase B4: colonne dell'evidenza (0123) nel registro solo con l'interruttore RADAR_REGISTRO_EVIDENZA (spento di base, solo staging)
  const evidenza = registroConEvidenza(opzioni.env ?? process.env);
  const ora = opzioni.adesso ?? (() => new Date());
  const inizio = ora();

  const { data: righe, error } = await admin.from("radar_fonti_stato").select("fonte, attiva, ultimo_successo_il, cursore, blocco_fino_a, conteggi, nascosta_ai_clienti").returns<(RigaFonte & { fonte: string; nascosta_ai_clienti: boolean })[]>();
  if (error) return { eseguita: false, motivo: schemaAssente(error) ? "schema_assente" : "errore_lettura" };
  const riga = (righe ?? []).find((r) => r.fonte === fonte);
  if (!riga || !riga.attiva) return { eseguita: false, motivo: "fonte_spenta" };
  // doppio richiamo (K1, 48C §3.1 punto 7): un giro programmato già riuscito da meno di 45 minuti non riparte (nessuna scrittura, nessuna
  // chiamata alla fonte; la riga «gia_eseguito» va nel registro). Console e script restano ammessi
  if (eDoppioRichiamo(opzioni.origine, riga.ultimo_successo_il, inizio)) return { eseguita: false, motivo: "gia_eseguito" };
  const nascoste = new Set((righe ?? []).filter((r) => r.nascosta_ai_clienti).map((r) => r.fonte));

  // blocco: solo se libero o scaduto (il semaforo del coordinamento resta chiuso finché il lanciatore autorizzato non lo apre); dura il
  // tempo massimo del giro più un margine
  const tempoMassimoMs = opzioni.tempoMassimoMs ?? TEMPO_MASSIMO_REGIONALI_MS;
  const presa = await admin
    .from("radar_fonti_stato")
    .update({ blocco_fino_a: new Date(inizio.getTime() + tempoMassimoMs + MARGINE_BLOCCO_MS).toISOString(), ultimo_avvio_il: inizio.toISOString(), aggiornata_il: inizio.toISOString() })
    .eq("fonte", fonte)
    .or(`blocco_fino_a.is.null,blocco_fino_a.lt.${inizio.toISOString()}`)
    .select("fonte");
  if (presa.error) return { eseguita: false, motivo: "errore_lettura" };
  if ((presa.data ?? []).length === 0) return { eseguita: false, motivo: "occupata" };

  const stat = statisticheRegionaliVuote();
  const misure: Misure = { richiesteDb: 0, msDb: 0 };
  const oggi = giornoDiRoma(inizio);
  const salvato = (riga.cursore ?? {}) as { datiDel?: string };
  let cursore: Record<string, unknown> = { ...salvato };
  let invariataAllaFonte = false;
  let sospesa = false;
  let errore: string | null = null;
  const limiti =
    fonte === "sintel"
      ? limitiValidi(opzioni.limiti, LIMITI_SINTEL_PREDEFINITI, LIMITI_SINTEL_INTERVALLI)
      : fonte === "sater"
        ? limitiValidi(opzioni.limiti, LIMITI_INTERCENTER_PREDEFINITI, LIMITI_INTERCENTER_INTERVALLI)
        : fonte === "tuttogare"
          ? limitiValidi(opzioni.limiti, LIMITI_TUTTOGARE_PREDEFINITI, LIMITI_TUTTOGARE_INTERVALLI)
          : limitiValidi(opzioni.limiti, LIMITI_AFLINK_PREDEFINITI, LIMITI_AFLINK_INTERVALLI);
  const sessione = new SessioneFonte(fonte === "sintel" ? "Sintel" : fonte === "tuttogare" ? "TuttoGare" : ISTANZE_AFLINK[fonte].nome, limiti, opzioni.fetchFn, undefined, ua.valore);
  // TuttoGare: il cursore nuovo (gare lette per istanza) si salva solo a giro finito, quando i bandi letti sono scritti
  let cursoreTuttoGareNuovo: CursoreTuttoGare | null = null;
  let datiDel: string | null = null;
  // K6: giro scritto per intero entro il tempo massimo; righe di Sintel uguali al conteggio della fonte; allarmi del giro
  let giroFinito = true;
  let completoAllaFonte = true;
  let dichiarati: number | null = null;
  const allarmi: string[] = [];

  try {
    let bandi: BandoRegionale[] = [];
    if (fonte === "sintel") {
      const lettore = new LettoreSintel(sessione);
      datiDel = await lettore.dataAggiornamento();
      if (datiDel && salvato.datiDel === datiDel) invariataAllaFonte = true;
      else {
        const { righe: righeSintel, completo } = await lettore.leggiDaGiorno(oggi, PAGINE_MASSIME_SINTEL);
        if (!completo) throw new ErroreFonte(`Sintel: più di ${PAGINE_MASSIME_SINTEL} pagine di righe con scadenza futura: connettore sospeso finché non si verifica`, 200, true);
        // completezza (K6): le righe lette devono essere quante ne conta la fonte con lo stesso filtro (una richiesta in più, dentro il tetto
        // del giro). Se no: allarme, si scrive quello che c'è, ma la data dei dati NON avanza e il giro dopo rilegge tutto
        dichiarati = await lettore.contaDaGiorno(oggi);
        if (dichiarati !== righeSintel.length) {
          completoAllaFonte = false;
          allarmi.push("conteggio_diverso");
        }
        const { procedure, righeScartate } = leggiRigheSintel(righeSintel, oggi);
        if (righeScartate > 0) conta(stat.esclusi, "riga_senza_identificativo", righeScartate);
        stat.letti += procedure.length;
        for (const p of procedure) {
          if (p.tipo === "esclusione") conta(stat.esclusi, p.motivo === "esclusa_per_oggetto" && p.regole?.length ? `esclusa_per_oggetto:${p.regole.join("+")}` : p.motivo);
          else {
            const b = bandoDaSintel(p, oggi);
            if (b) bandi.push(b);
            else conta(stat.esclusi, "riservata");
          }
        }
      }
    } else if (fonte === "sater") {
      // SATER (Fase 2): API del portale Intercent-ER, 3 cartelle. Un elenco più corto di quanto dichiara: allarme, si scrive quello che c'è
      // (mai pagine indovinate). La stessa procedura in due cartelle si legge una volta sola (la prima nell'ordine delle cartelle)
      const { cartelle } = await new LettoreIntercenter(sessione).leggiCartelle();
      const visti = new Set<string>();
      for (const { cartella, elementi, totaleDichiarato } of cartelle) {
        if (totaleDichiarato !== null && totaleDichiarato > elementi.length && !allarmi.includes("conteggio_diverso")) allarmi.push("conteggio_diverso");
        const letti = leggiElementiIntercenter(cartella, elementi, inizio);
        stat.letti += letti.length;
        for (const p of letti) {
          if (p.tipo === "esclusione") conta(stat.esclusi, p.motivo === "esclusa_per_oggetto" && p.regole?.length ? `esclusa_per_oggetto:${p.regole.join("+")}` : p.motivo);
          else if (visti.has(p.meta.idPiattaforma)) conta(stat.esclusi, "doppione_tra_cartelle");
          else {
            visti.add(p.meta.idPiattaforma);
            const b = bandoDaIntercenter(p, oggi);
            if (b) bandi.push(b);
            else conta(stat.esclusi, "riservata");
          }
        }
      }
    } else if (fonte === "tuttogare") {
      // TuttoGare (Fase 2, in costruzione): istanze dell'anagrafica, home + dettagli delle gare nuove o cambiate (tuttogare.ts). Un'istanza
      // non leggibile (rete, 5xx, reindirizzamento) non ferma le altre: allarme; una sospensione (401/403/429, formato) ferma tutto il giro
      const prima = cursoreTuttoGare((riga.cursore as { tuttogare?: unknown } | null)?.tuttogare);
      const letto = await new LettoreTuttoGare(sessione).leggiIstanze(istanzeAttiveTuttoGare(), prima, oggi);
      if (letto.errori.length > 0) allarmi.push("istanza_non_letta");
      if (letto.rimandati > 0) allarmi.push("dettagli_rimandati");
      for (const l of letto.istanze) {
        conta(stat.esclusi, "affidamento", l.esclusiDallaRiga.length);
        stat.letti += l.esclusiDallaRiga.length + l.dettagli.length;
        for (const { codice, dettaglio } of l.dettagli) {
          const p = leggiGaraTuttoGare(l.istanza, codice, dettaglio, inizio);
          if (p.tipo === "esclusione") conta(stat.esclusi, p.motivo === "esclusa_per_oggetto" && p.regole?.length ? `esclusa_per_oggetto:${p.regole.join("+")}` : p.motivo);
          else {
            const b = bandoDaTuttoGare(p, oggi);
            if (b) bandi.push(b);
            else conta(stat.esclusi, "riservata");
          }
        }
      }
      if (letto.errori.length > 0 && letto.istanze.length === 0) errore = `TuttoGare: nessuna istanza letta (${letto.errori.map((e) => e.host).join(", ").slice(0, 600)})`;
      cursoreTuttoGareNuovo = aggiornaCursoreTuttoGare(prima, letto.istanze.map((l) => ({ host: l.istanza.host, righe: l.righe, trattati: l.trattati })), oggi);
    } else {
      const feed = await new LettoreAflink(fonte, sessione).leggiFeed();
      // feed «scivolato» (K6): l'avviso più vecchio è più recente dell'ultimo giro riuscito → qualcosa può essere uscito dal feed
      if (bucoPossibileFeed(pubblicazionePiuVecchiaAflink(feed.elementi), riga.ultimo_successo_il ? giornoDiRoma(new Date(riga.ultimo_successo_il)) : null)) allarmi.push("buco_possibile");
      const letti = leggiElementiAflink(fonte, feed.elementi, inizio);
      stat.letti += letti.length;
      for (const p of letti) {
        if (p.tipo === "esclusione") conta(stat.esclusi, p.motivo === "esclusa_per_oggetto" && p.regole?.length ? `esclusa_per_oggetto:${p.regole.join("+")}` : p.motivo);
        else {
          const b = bandoDaAflink(p, oggi);
          if (b) bandi.push(b);
          else conta(stat.esclusi, "riservata");
        }
      }
    }
    // la scrittura usa il motore di unione unico; a blocchi di 200 bandi, entro il tempo massimo del giro (oltre: il giro si ferma, non è
    // finito e la data dei dati non avanza: il giro dopo rilegge; le scritture fatte sono idempotenti)
    for (let i = 0; i < bandi.length; i += 200) {
      if (ora().getTime() - inizio.getTime() >= tempoMassimoMs) {
        giroFinito = false;
        break;
      }
      await applicaPaginaBandiRegionali(admin, bandi.slice(i, i + 200), { fonte, modo: "incrementale", adesso: inizio, misure, stat, nascoste, proponi: fonte === "sintel", classificazioni, evidenza, esecuzioneId });
    }
    bandi = [];
    if (datiDel && giroFinito && completoAllaFonte) cursore = { ...cursore, datiDel };
    if (cursoreTuttoGareNuovo && giroFinito) cursore = { ...cursore, tuttogare: cursoreTuttoGareNuovo };
  } catch (e) {
    errore = e instanceof Error ? e.message.slice(0, 900) : String(e).slice(0, 900);
    sospesa = e instanceof ErroreFonte && e.sospendi;
  }

  const fine = ora();
  const durataMs = fine.getTime() - inizio.getTime();
  const conteggi = {
    ...(riga.conteggi ?? {}),
    ...(sospesa ? { sospensione: { il: fine.toISOString(), motivo: errore } } : {}),
    ultimo_giro: { iniziato_il: inizio.toISOString(), durata_ms: durataMs, invariata_alla_fonte: invariataAllaFonte, giro_finito: giroFinito, dichiarati, allarmi, limiti, ...stat, fonte: { richieste: sessione.richieste, byte: sessione.byte, ms: sessione.ms }, db: misure, errore },
  };
  await admin
    .from("radar_fonti_stato")
    .update({
      blocco_fino_a: null,
      conteggi,
      cursore,
      aggiornata_il: fine.toISOString(),
      // come per la PVL (S3): l'ultimo successo solo a giro finito; la data dei dati solo se il giro è finito e completo alla fonte
      ...(errore ? { ultimo_errore: errore, ultimo_errore_il: fine.toISOString() } : giroFinito ? { ultimo_successo_il: fine.toISOString(), ...(datiDel && completoAllaFonte ? { dati_aggiornati_al: datiDel } : {}) } : {}),
      ...(sospesa ? { attiva: false } : {}),
    })
    .eq("fonte", fonte);

  return { eseguita: true, fonte, invariataAllaFonte, sospesa, giroFinito, dichiarati, allarmi, statistiche: { ...stat, fonte: { richieste: sessione.richieste, byte: sessione.byte, ms: sessione.ms }, db: misure }, durataMs, errore };
}
