// Dati della pagina «Tender Intelligence» della console (fase A: sola lettura). Stato del modulo, fonti con copertura e limiti, archivio,
// coda dei lavori e utilizzi degli ultimi 30 giorni. Da chiamare solo dopo richiediAdminPagina(). Tollera le migrazioni 0109–0111 non
// eseguite: in quel caso lo dice, senza errori.
import { createAdminClient } from "@/lib/supabase/admin";
import { schemaAssente } from "@/lib/omnia-ai-incassi";
import { FONTI_RADAR, type DescrizioneFonte } from "@/lib/radar/fonti/tipi";
import { leggiParametriRadar } from "@/lib/radar/impostazioni";
import { AZIONI_RADAR, type AzioneRadar, type ParametriRadar } from "@/lib/radar/diritto-calcoli";
import { STATI_LAVORO, type StatoLavoro } from "@/lib/radar/lavori-calcoli";
import { condizioneAperte } from "@/lib/radar/ricerca-calcoli";
import { giornoIso } from "@/lib/radar/importa-ted-calcoli";
import { ambienteDb, scrittureRadarConsentite } from "@/lib/radar/ambiente";
import { limitiPvlDaRighe, type LimitiPvl } from "@/lib/radar/fonti/pvl-calcoli";
import { CRON_PVL_PROPOSTO, ORE_GIRI_PVL, prossimoGiroPvl, type StatistichePvl } from "@/lib/radar/importa-pvl-calcoli";
import { FONTI_REGIONALI, type FonteRegionale, type StatisticheRegionali } from "@/lib/radar/importa-regionali-calcoli";
import { leggiProposteAperte } from "@/lib/radar/collegamenti";

export type StatoFonteDb = {
  attiva: boolean;
  ultimo_successo_il: string | null;
  ultimo_errore: string | null;
  ultimo_errore_il: string | null;
  dati_aggiornati_al: string | null;
};

export type UtilizzoAzione = { azione: AzioneRadar; numero: number; crediti: number; costoAi: number };

export type DatiTenderIntelligenceConsole = {
  // false = migrazioni 0109–0111 non eseguite in questo database
  schemaPresente: boolean;
  parametri: ParametriRadar;
  fonti: (DescrizioneFonte & { db: StatoFonteDb | null })[];
  // gare come le vede il cliente: senza le copie collegate a un'altra gara (0117), come Cerca e scheda
  procedure: number | null;
  procedureAperte: number | null;
  // copie collegate a un'altra gara (0117): restano nel database, mostrate a parte
  gareCollegate: number | null;
  aggiudicazioni: number | null;
  coda: Record<StatoLavoro, number> | null;
  clientiAbilitati: number | null;
  utilizzi30Giorni: UtilizzoAzione[] | null;
  // fase B1 (migrazione 0112): giro di importazione, imprese abilitate, registro delle modifiche
  ted: { fase: string | null; recuperoCompletatoIl: string | null; ultimoGiorno: string | null; ultimoGiro: UltimoGiroTed | null } | null;
  imprese: { email: string; attivo: boolean; aggiornataIl: string; aggiornataDa: string }[] | null;
  registro: { oggetto: string; clienteEmail: string | null; prima: string | null; dopo: string | null; autore: string; il: string }[] | null;
  // fase B1-bis (migrazioni 0115-0116): connettore PVL, solo staging
  pvl: DatiPvlConsole | null;
  // fase B2a (migrazione 0120): fonti regionali (Sintel, SardegnaCAT) e suggerimenti di unione da verificare
  regionali: DatiRegionaliConsole | null;
};

export type UltimoGiroPvl = StatistichePvl & {
  iniziato_il: string;
  durata_ms: number;
  modo: "finestra" | "incrementale";
  finestra: { da: string; a: string };
  giro_finito: boolean;
  limiti: LimitiPvl;
  db: { richiesteDb: number; msDb: number };
  errore: string | null;
};

export type DatiPvlConsole = {
  // l'accensione è consentita solo sullo staging (guardia nel codice)
  accensioneConsentita: boolean;
  ambiente: "produzione" | "staging" | "sconosciuto";
  sospensione: { il: string; motivo: string | null } | null;
  inCorso: boolean;
  ultimoGiorno: string | null;
  ultimoGiro: UltimoGiroPvl | null;
  limiti: LimitiPvl;
  giriProgrammati: { attivi: boolean; orari: string; cronProposto: string; prossimo: string };
  archivio: { avvisi: number | null; gareNateDallaPvl: number | null; avvisiCheCitanoTed: number | null; cambiamentiPvl: number | null };
  // gare doppie collegate in modo reversibile (0117): le più recenti, con la gara che resta
  collegamenti: { totale: number; elenco: { id: string; titolo: string; resta: string; il: string | null; motivo: string | null }[] } | null;
};

export type UltimoGiroTed = {
  iniziato_il: string;
  durata_ms: number;
  fase: string;
  giro_finito: boolean;
  pagine: number;
  errore: string | null;
  bandi: { letti: number; nuove: number; aggiornate: number; rettifiche: number; annullate: number; invariati: number; esclusi: Record<string, number> };
  esiti: { letti: number; applicati: number; senzaBando: number };
  ted: { richieste: number; byte: number; ms: number };
  db: { richiesteDb: number; msDb: number };
};

export function riepilogaUtilizzi(righe: readonly { azione: string; crediti: number | null; costo_ai_stimato: number | string | null }[]): UtilizzoAzione[] {
  return AZIONI_RADAR.map((azione) => {
    const sue = righe.filter((r) => r.azione === azione);
    return {
      azione,
      numero: sue.length,
      crediti: sue.reduce((s, r) => s + (r.crediti ?? 0), 0),
      costoAi: sue.reduce((s, r) => s + (Number(r.costo_ai_stimato) || 0), 0),
    };
  });
}

export async function leggiDatiTenderIntelligence(): Promise<DatiTenderIntelligenceConsole> {
  const admin = createAdminClient();
  const parametri = await leggiParametriRadar(admin);

  // Presenza dello schema con una lettura vera (un conteggio «head» risponde anche per tabelle che non esistono).
  const { data: righeFonti, error: erroreFonti } = await admin
    .from("radar_fonti_stato")
    .select("fonte, attiva, ultimo_successo_il, ultimo_errore, ultimo_errore_il, dati_aggiornati_al")
    .limit(50)
    .returns<(StatoFonteDb & { fonte: string })[]>();
  const schemaPresente = !erroreFonti;
  if (erroreFonti && !schemaAssente(erroreFonti)) console.error("Console Tender Intelligence: lettura delle fonti non riuscita", erroreFonti.message);

  const fonti = FONTI_RADAR.map((f) => {
    const r = (righeFonti ?? []).find((x) => x.fonte === f.id);
    return { ...f, db: r ? { attiva: r.attiva, ultimo_successo_il: r.ultimo_successo_il, ultimo_errore: r.ultimo_errore, ultimo_errore_il: r.ultimo_errore_il, dati_aggiornati_al: r.dati_aggiornati_al } : null };
  });

  if (!schemaPresente) {
    return { schemaPresente, parametri, fonti, procedure: null, procedureAperte: null, gareCollegate: null, aggiudicazioni: null, coda: null, clientiAbilitati: null, utilizzi30Giorni: null, ted: null, imprese: null, registro: null, pvl: null, regionali: null };
  }

  // conteggio con un filtro di uguaglianza facoltativo; null = conteggio non riuscito
  const conta = async (tabella: string, colonnaId: string, filtro?: [string, string | boolean]): Promise<number | null> => {
    const base = admin.from(tabella).select(colonnaId, { count: "exact", head: true });
    const { count, error } = await (filtro ? base.eq(filtro[0], filtro[1]) : base);
    return error ? null : (count ?? 0);
  };

  const adesso = new Date().toISOString();
  const dal = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const [procedure, procedureAperte, gareCollegate, aggiudicazioni, clientiAbilitati, statiCoda, utilizzi, statoTed, impostazioni, registroRaw, pvl, regionali] = await Promise.all([
    // senza le copie collegate (0117)
    (async () => {
      const { count, error } = await admin.from("radar_procedure").select("id", { count: "exact", head: true }).is("unita_a", null);
      return error ? null : (count ?? 0);
    })(),
    // aperte davvero: stato «aperta» e scadenza assente o futura
    (async () => {
      const { count, error } = await admin.from("radar_procedure").select("id", { count: "exact", head: true }).is("unita_a", null).eq("stato", "aperta").or(condizioneAperte(giornoIso(new Date(adesso)), adesso));
      return error ? null : (count ?? 0);
    })(),
    (async () => {
      const { count, error } = await admin.from("radar_procedure").select("id", { count: "exact", head: true }).not("unita_a", "is", null);
      return error ? null : (count ?? 0);
    })(),
    conta("radar_aggiudicazioni", "id"),
    conta("omnia_ai_radar_impostazioni", "user_id", ["attivo", true]),
    Promise.all(STATI_LAVORO.map((s) => conta("radar_lavori", "id", ["stato", s]))),
    admin.from("omnia_ai_radar_utilizzi").select("azione, crediti, costo_ai_stimato").gte("creato_il", dal).limit(20_000).returns<{ azione: string; crediti: number | null; costo_ai_stimato: number | string | null }[]>(),
    admin.from("radar_fonti_stato").select("cursore, conteggi").eq("fonte", "ted").maybeSingle<{ cursore: Record<string, unknown> | null; conteggi: Record<string, unknown> | null }>(),
    admin.from("omnia_ai_radar_impostazioni").select("user_id, attivo, aggiornata_il, aggiornata_da_email").order("aggiornata_il", { ascending: false }).limit(200).returns<{ user_id: string; attivo: boolean; aggiornata_il: string; aggiornata_da_email: string }[]>(),
    admin.from("radar_console_registro").select("oggetto, cliente_id, valore_precedente, valore_nuovo, autore_email, creato_il").order("creato_il", { ascending: false }).limit(30).returns<{ oggetto: string; cliente_id: string | null; valore_precedente: string | null; valore_nuovo: string | null; autore_email: string; creato_il: string }[]>(),
    leggiDatiPvl(admin),
    leggiDatiRegionali(admin),
  ]);

  // email delle imprese (abilitate e citate nel registro), lette in una volta sola
  const idUtenti = [...new Set([...(impostazioni.data ?? []).map((r) => r.user_id), ...(registroRaw.data ?? []).map((r) => r.cliente_id).filter((x): x is string => !!x)])];
  const { data: utenti } = idUtenti.length ? await admin.from("users").select("id, email").in("id", idUtenti).returns<{ id: string; email: string }[]>() : { data: [] as { id: string; email: string }[] };
  const emailDi = new Map((utenti ?? []).map((u) => [u.id, u.email]));

  const cursore = statoTed.data?.cursore ?? null;
  const ultimoGiro = (statoTed.data?.conteggi?.ultimo_giro as UltimoGiroTed | undefined) ?? null;
  const coda = statiCoda.some((n) => n === null) ? null : (Object.fromEntries(STATI_LAVORO.map((s, i) => [s, statiCoda[i] as number])) as Record<StatoLavoro, number>);
  return {
    ted: statoTed.error
      ? null
      : {
          fase: typeof cursore?.fase === "string" ? (cursore.inCorso === false ? "sincronizzazione (in attesa del prossimo giro)" : cursore.fase === "recupero" ? "recupero dello storico in corso" : "sincronizzazione in corso") : null,
          recuperoCompletatoIl: typeof cursore?.recuperoCompletatoIl === "string" ? cursore.recuperoCompletatoIl : null,
          ultimoGiorno: typeof cursore?.ultimoGiorno === "string" ? cursore.ultimoGiorno : null,
          ultimoGiro,
        },
    imprese: impostazioni.error ? null : (impostazioni.data ?? []).map((r) => ({ email: emailDi.get(r.user_id) ?? "(utente non trovato)", attivo: r.attivo, aggiornataIl: r.aggiornata_il, aggiornataDa: r.aggiornata_da_email })),
    registro: registroRaw.error ? null : (registroRaw.data ?? []).map((r) => ({ oggetto: r.oggetto, clienteEmail: r.cliente_id ? (emailDi.get(r.cliente_id) ?? "(utente non trovato)") : null, prima: r.valore_precedente, dopo: r.valore_nuovo, autore: r.autore_email, il: r.creato_il })),
    pvl,
    regionali,
    schemaPresente,
    parametri,
    fonti,
    procedure,
    procedureAperte,
    gareCollegate,
    aggiudicazioni,
    coda,
    clientiAbilitati,
    utilizzi30Giorni: utilizzi.error ? null : riepilogaUtilizzi(utilizzi.data ?? []),
  };
}

// Stato del connettore PVL per la console: riga della fonte, limiti, conteggi dell'archivio (solo conteggi «head», nessuna scansione).
// null = migrazione 0115 non eseguita in questo database.
async function leggiDatiPvl(admin: ReturnType<typeof createAdminClient>): Promise<DatiPvlConsole | null> {
  const { data: riga, error } = await admin.from("radar_fonti_stato").select("cursore, conteggi").eq("fonte", "pvl").maybeSingle<{ cursore: Record<string, unknown> | null; conteggi: Record<string, unknown> | null }>();
  if (error || !riga) return null;
  const conta = async (f: (q: ReturnType<ReturnType<typeof admin.from>["select"]>) => PromiseLike<{ count: number | null; error: unknown }>, tabella: string): Promise<number | null> => {
    const { count, error: e } = await f(admin.from(tabella).select("id", { count: "exact", head: true }));
    return e ? null : (count ?? 0);
  };
  const [righeLimiti, avvisi, gareNateDallaPvl, avvisiCheCitanoTed, cambiamentiPvl, collegateRaw] = await Promise.all([
    admin.from("console_impostazioni").select("chiave, valore").like("chiave", "radar_pvl_%").returns<{ chiave: string; valore: string }[]>(),
    conta((q) => q.eq("fonte", "pvl"), "radar_procedure_fonti"),
    conta((q) => q.like("chiave", "pvl:%"), "radar_procedure"),
    conta((q) => q.eq("fonte", "pvl").not("rif_ted", "is", null), "radar_procedure_fonti"),
    conta((q) => q.eq("fonte", "pvl").in("tipo", ["rettifica", "proroga", "annullamento", "esito"]), "radar_aggiornamenti"),
    admin
      .from("radar_procedure")
      .select("id, oggetto_breve, oggetto, unita_a, unita_il, unita_motivo", { count: "exact" })
      .not("unita_a", "is", null)
      .order("unita_il", { ascending: false })
      .limit(20)
      .returns<{ id: string; oggetto_breve: string | null; oggetto: string; unita_a: string; unita_il: string | null; unita_motivo: string | null }[]>(),
  ]);
  const cursore = riga.cursore ?? null;
  const sospensione = riga.conteggi?.sospensione as { il: string; motivo: string | null } | undefined;
  const ambiente = ambienteDb(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const attivi = process.env.RADAR_PVL_CRON === "attivo";
  return {
    accensioneConsentita: scrittureRadarConsentite("pvl", process.env).ok,
    ambiente,
    sospensione: sospensione ?? null,
    inCorso: cursore?.inCorso === true,
    ultimoGiorno: typeof cursore?.ultimoGiorno === "string" ? cursore.ultimoGiorno : null,
    ultimoGiro: (riga.conteggi?.ultimo_giro as UltimoGiroPvl | undefined) ?? null,
    limiti: limitiPvlDaRighe(righeLimiti.data ?? []),
    giriProgrammati: { attivi, orari: ORE_GIRI_PVL.map((o) => `${o}:00`).join(", "), cronProposto: CRON_PVL_PROPOSTO, prossimo: prossimoGiroPvl(new Date()).toISOString() },
    archivio: { avvisi, gareNateDallaPvl, avvisiCheCitanoTed, cambiamentiPvl },
    collegamenti: collegateRaw.error
      ? null
      : { totale: collegateRaw.count ?? 0, elenco: (collegateRaw.data ?? []).map((r) => ({ id: r.id, titolo: r.oggetto_breve ?? r.oggetto, resta: r.unita_a, il: r.unita_il, motivo: r.unita_motivo })) },
  };
}

// ───── fase B2a: fonti regionali e suggerimenti di unione ─────

export type DatiFonteRegionaleConsole = {
  fonte: FonteRegionale;
  attiva: boolean;
  nascosta: boolean;
  accensioneConsentita: boolean;
  sospensione: { il: string; motivo: string | null } | null;
  ultimoSuccesso: string | null;
  datiAl: string | null;
  ultimoGiro: (StatisticheRegionali & { iniziato_il: string; durata_ms: number; invariata_alla_fonte: boolean; fonte: { richieste: number; byte: number; ms: number }; errore: string | null }) | null;
  procedure: number | null;
};

// le prove delle due gare, affiancate: l'amministratore decide su dati visibili, non sul solo numero
export type ProvaGaraConsole = { id: string; titolo: string; ente: string | null; codiceFiscale: string | null; scadenzaGiorno: string | null; scadenzaIstante: string | null; importo: number | null; tipoImporto: "valore stimato" | "base d'asta" | null; collegamento: string | null; fonti: string[] };
export type PropostaConsole = { a: ProvaGaraConsole; b: ProvaGaraConsole; motivo: string; il: string };

export type DatiRegionaliConsole = { fonti: DatiFonteRegionaleConsole[]; proposte: PropostaConsole[] | null; giriProgrammati: boolean };

async function leggiDatiRegionali(admin: ReturnType<typeof createAdminClient>): Promise<DatiRegionaliConsole | null> {
  const { data: righe, error } = await admin
    .from("radar_fonti_stato")
    .select("fonte, attiva, nascosta_ai_clienti, conteggi, ultimo_successo_il, dati_aggiornati_al")
    .in("fonte", [...FONTI_REGIONALI])
    .returns<{ fonte: FonteRegionale; attiva: boolean; nascosta_ai_clienti: boolean; conteggi: Record<string, unknown> | null; ultimo_successo_il: string | null; dati_aggiornati_al: string | null }[]>();
  // senza la 0120 la sezione non si mostra
  if (error) return null;
  const conteggi = await Promise.all(
    FONTI_REGIONALI.map(async (f) => {
      const { count, error: e } = await admin.from("radar_procedure_fonti").select("id_fonte", { count: "exact", head: true }).eq("fonte", f);
      return e ? null : (count ?? 0);
    }),
  );
  let proposte: PropostaConsole[] | null = null;
  try {
    const aperte = await leggiProposteAperte(admin, 30);
    const ids = [...new Set(aperte.flatMap((p) => [p.a, p.b]))];
    type RigaProva = { id: string; oggetto_breve: string | null; oggetto: string; sa_denominazione: string | null; sa_codice_fiscale: string | null; scadenza_giorno: string | null; scadenza_offerte: string | null; valore_stimato: number | string | null; valore_base: number | string | null; url_avviso: string | null; url_documenti: string | null; fonti: string[] | null; chiave: string };
    const { data: gare } = ids.length
      ? await admin.from("radar_procedure").select("id, oggetto_breve, oggetto, sa_denominazione, sa_codice_fiscale, scadenza_giorno, scadenza_offerte, valore_stimato, valore_base, url_avviso, url_documenti, fonti, chiave").in("id", ids).returns<RigaProva[]>()
      : { data: [] as RigaProva[] };
    const perId = new Map((gare ?? []).map((g) => [g.id, g]));
    const prova = (id: string): ProvaGaraConsole => {
      const g = perId.get(id);
      const stimato = g?.valore_stimato === null || g?.valore_stimato === undefined ? null : Number(g.valore_stimato);
      const base = g?.valore_base === null || g?.valore_base === undefined ? null : Number(g.valore_base);
      return {
        id,
        titolo: g ? (g.oggetto_breve ?? g.oggetto) : id,
        ente: g?.sa_denominazione ?? null,
        codiceFiscale: g?.sa_codice_fiscale ?? null,
        scadenzaGiorno: g?.scadenza_giorno ?? null,
        scadenzaIstante: g?.scadenza_offerte ?? null,
        importo: stimato ?? base,
        tipoImporto: stimato !== null ? "valore stimato" : base !== null ? "base d'asta" : null,
        collegamento: g?.url_documenti ?? g?.url_avviso ?? null,
        fonti: g ? (g.fonti && g.fonti.length > 0 ? g.fonti : [g.chiave.split(":")[0]]) : [],
      };
    };
    proposte = aperte.map((p) => ({ a: prova(p.a), b: prova(p.b), motivo: p.motivo, il: p.proposta_il }));
  } catch {
    proposte = null;
  }
  return {
    fonti: FONTI_REGIONALI.map((f, i) => {
      const r = (righe ?? []).find((x) => x.fonte === f);
      return {
        fonte: f,
        attiva: r?.attiva === true,
        nascosta: r?.nascosta_ai_clienti !== false,
        accensioneConsentita: scrittureRadarConsentite(f, process.env).ok,
        sospensione: (r?.conteggi?.sospensione as { il: string; motivo: string | null } | undefined) ?? null,
        ultimoSuccesso: r?.ultimo_successo_il ?? null,
        datiAl: r?.dati_aggiornati_al ?? null,
        ultimoGiro: (r?.conteggi?.ultimo_giro as DatiFonteRegionaleConsole["ultimoGiro"] | undefined) ?? null,
        procedure: conteggi[i],
      };
    }),
    proposte,
    giriProgrammati: process.env.RADAR_REGIONALI_CRON === "attivo",
  };
}
