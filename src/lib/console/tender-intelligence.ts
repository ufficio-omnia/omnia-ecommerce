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
    return { schemaPresente, parametri, fonti, procedure: null, procedureAperte: null, aggiudicazioni: null, coda: null, clientiAbilitati: null, utilizzi30Giorni: null };
  }

  // conteggio con un filtro di uguaglianza facoltativo; null = conteggio non riuscito
  const conta = async (tabella: string, colonnaId: string, filtro?: [string, string | boolean]): Promise<number | null> => {
    const base = admin.from(tabella).select(colonnaId, { count: "exact", head: true });
    const { count, error } = await (filtro ? base.eq(filtro[0], filtro[1]) : base);
    return error ? null : (count ?? 0);
  };

  const dal = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const [procedure, procedureAperte, aggiudicazioni, clientiAbilitati, statiCoda, utilizzi] = await Promise.all([
    conta("radar_procedure", "id"),
    conta("radar_procedure", "id", ["stato", "aperta"]),
    conta("radar_aggiudicazioni", "id"),
    conta("omnia_ai_radar_impostazioni", "user_id", ["attivo", true]),
    Promise.all(STATI_LAVORO.map((s) => conta("radar_lavori", "id", ["stato", s]))),
    admin.from("omnia_ai_radar_utilizzi").select("azione, crediti, costo_ai_stimato").gte("creato_il", dal).limit(20_000).returns<{ azione: string; crediti: number | null; costo_ai_stimato: number | string | null }[]>(),
  ]);

  const coda = statiCoda.some((n) => n === null) ? null : (Object.fromEntries(STATI_LAVORO.map((s, i) => [s, statiCoda[i] as number])) as Record<StatoLavoro, number>);
  return {
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
