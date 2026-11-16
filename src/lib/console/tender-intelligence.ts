// Dati della pagina «Tender Intelligence» della console (fase A: sola lettura). Stato del modulo, fonti con copertura e limiti, archivio,
// coda dei lavori e utilizzi degli ultimi 30 giorni. Da chiamare solo dopo richiediAdminPagina(). Tollera le migrazioni 0109–0111 non
// eseguite: in quel caso lo dice, senza errori.
import { createAdminClient } from "@/lib/supabase/admin";
import { schemaAssente } from "@/lib/omnia-ai-incassi";
import { FONTI_RADAR, type DescrizioneFonte } from "@/lib/radar/fonti/tipi";
import { leggiParametriRadar } from "@/lib/radar/impostazioni";
import { AZIONI_RADAR, type AzioneRadar, type ParametriRadar } from "@/lib/radar/diritto-calcoli";
import { STATI_LAVORO, type StatoLavoro } from "@/lib/radar/lavori-calcoli";

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
  procedure: number | null;
  procedureAperte: number | null;
  aggiudicazioni: number | null;
  coda: Record<StatoLavoro, number> | null;
  clientiAbilitati: number | null;
  utilizzi30Giorni: UtilizzoAzione[] | null;
  // fase B1 (migrazione 0112): giro di importazione, imprese abilitate, registro delle modifiche
  ted: { fase: string | null; recuperoCompletatoIl: string | null; ultimoGiorno: string | null; ultimoGiro: UltimoGiroTed | null } | null;
  imprese: { email: string; attivo: boolean; aggiornataIl: string; aggiornataDa: string }[] | null;
  registro: { oggetto: string; clienteEmail: string | null; prima: string | null; dopo: string | null; autore: string; il: string }[] | null;
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
    return { schemaPresente, parametri, fonti, procedure: null, procedureAperte: null, aggiudicazioni: null, coda: null, clientiAbilitati: null, utilizzi30Giorni: null, ted: null, imprese: null, registro: null };
  }

  // conteggio con un filtro di uguaglianza facoltativo; null = conteggio non riuscito
  const conta = async (tabella: string, colonnaId: string, filtro?: [string, string | boolean]): Promise<number | null> => {
    const base = admin.from(tabella).select(colonnaId, { count: "exact", head: true });
    const { count, error } = await (filtro ? base.eq(filtro[0], filtro[1]) : base);
    return error ? null : (count ?? 0);
  };

  const adesso = new Date().toISOString();
  const dal = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const [procedure, procedureAperte, aggiudicazioni, clientiAbilitati, statiCoda, utilizzi, statoTed, impostazioni, registroRaw] = await Promise.all([
    conta("radar_procedure", "id"),
    // aperte davvero: stato «aperta» e scadenza assente o futura
    (async () => {
      const { count, error } = await admin.from("radar_procedure").select("id", { count: "exact", head: true }).eq("stato", "aperta").or(`scadenza_offerte.is.null,scadenza_offerte.gt.${adesso}`);
      return error ? null : (count ?? 0);
    })(),
    conta("radar_aggiudicazioni", "id"),
    conta("omnia_ai_radar_impostazioni", "user_id", ["attivo", true]),
    Promise.all(STATI_LAVORO.map((s) => conta("radar_lavori", "id", ["stato", s]))),
    admin.from("omnia_ai_radar_utilizzi").select("azione, crediti, costo_ai_stimato").gte("creato_il", dal).limit(20_000).returns<{ azione: string; crediti: number | null; costo_ai_stimato: number | string | null }[]>(),
    admin.from("radar_fonti_stato").select("cursore, conteggi").eq("fonte", "ted").maybeSingle<{ cursore: Record<string, unknown> | null; conteggi: Record<string, unknown> | null }>(),
    admin.from("omnia_ai_radar_impostazioni").select("user_id, attivo, aggiornata_il, aggiornata_da_email").order("aggiornata_il", { ascending: false }).limit(200).returns<{ user_id: string; attivo: boolean; aggiornata_il: string; aggiornata_da_email: string }[]>(),
    admin.from("radar_console_registro").select("oggetto, cliente_id, valore_precedente, valore_nuovo, autore_email, creato_il").order("creato_il", { ascending: false }).limit(30).returns<{ oggetto: string; cliente_id: string | null; valore_precedente: string | null; valore_nuovo: string | null; autore_email: string; creato_il: string }[]>(),
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
    schemaPresente,
    parametri,
    fonti,
    procedure,
    procedureAperte,
    aggiudicazioni,
    coda,
    clientiAbilitati,
    utilizzi30Giorni: utilizzi.error ? null : riepilogaUtilizzi(utilizzi.data ?? []),
  };
}
