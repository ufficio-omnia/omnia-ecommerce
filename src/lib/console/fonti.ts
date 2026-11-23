// Pagina «Fonti» della console (48C §3.5–3.6). Solo server, con il client di servizio, dopo la guardia degli amministratori (pagina).
// Stato calcolato e allarmi: leggiSituazioneFonti di B2 (esecuzioni.ts, K3: stato delle fonti più registro dei giri degli ultimi 30 giorni).
// In più UNA lettura del registro per l'elenco degli ultimi giri di ciascuna fonte (al più 10 per fonte, nessun dato di gare). Nessuna
// scrittura: accendere e spegnere restano le azioni esistenti della console.
import type { SupabaseClient } from "@supabase/supabase-js";
import { GIORNI_REGISTRO_CONSOLE, leggiSituazioneFonti } from "@/lib/radar/esecuzioni";
import { cronAttiviDa } from "@/lib/radar/programmazione-calcoli";
import { COLONNE_ESECUZIONI_ALLARMI, type Allarme, type RigaEsecuzioneLetta, type StatoFonte } from "@/lib/radar/stato-fonti-calcoli";
import type { FonteEsecuzione } from "@/lib/radar/esecuzioni-calcoli";
import { GIRI_PER_FONTE, NOME_FONTE_CONSOLE, giroConsole, giriPerFonte, prossimoGiro, type GiroConsole } from "./fonti-calcoli";

export type FonteConsole = {
  fonte: FonteEsecuzione;
  nome: string;
  stato: StatoFonte;
  attiva: boolean;
  erroriConsecutivi: number;
  ultimoGiro: GiroConsole | null;
  ultimoSuccesso: string | null;
  allarmi: Allarme[];
  giriProgrammati: boolean;
  prossimoGiro: string | null;
  giri: GiroConsole[];
};

export type DatiFontiConsole = {
  adesso: string;
  fonti: FonteConsole[];
  // registro dei giri (0128) assente in questo database: stato dal solo radar_fonti_stato, senza gli allarmi che ne hanno bisogno
  registroAssente: boolean;
  // lettura non riuscita («stato delle fonti: …» = nessuna fonte; «registro dei giri: …» = stato sì, allarmi del registro no)
  errore: string | null;
  // elenco degli ultimi giri non letto (lo stato e gli allarmi restano)
  erroreGiri: string | null;
};

export async function leggiDatiFonti(admin: SupabaseClient, adesso: Date = new Date(), env: Record<string, string | undefined> = process.env): Promise<DatiFontiConsole> {
  const s = await leggiSituazioneFonti(admin, adesso, env);
  let righe: RigaEsecuzioneLetta[] = [];
  let erroreGiri: string | null = null;
  if (!s.registroAssente && !s.errore && s.situazioni.length > 0) {
    const dal = new Date(adesso.getTime() - GIORNI_REGISTRO_CONSOLE * 86_400_000).toISOString();
    const r = await admin
      .from("radar_esecuzioni")
      .select(COLONNE_ESECUZIONI_ALLARMI)
      .gte("iniziato_il", dal)
      .order("iniziato_il", { ascending: false })
      .limit(GIRI_PER_FONTE * 4 * 5)
      .returns<RigaEsecuzioneLetta[]>();
    if (r.error) erroreGiri = `ultimi giri: ${r.error.message}`;
    else righe = r.data ?? [];
  }
  const cron = cronAttiviDa(env);
  return {
    adesso: adesso.toISOString(),
    registroAssente: s.registroAssente,
    errore: s.errore,
    erroreGiri,
    fonti: s.situazioni.map((x) => ({
      fonte: x.fonte,
      nome: NOME_FONTE_CONSOLE[x.fonte] ?? x.fonte,
      stato: x.stato,
      attiva: x.attiva,
      erroriConsecutivi: x.erroriConsecutivi,
      ultimoGiro: x.ultimoGiro ? giroConsole(x.ultimoGiro) : null,
      ultimoSuccesso: x.ultimoSuccesso,
      allarmi: x.allarmi,
      giriProgrammati: cron.has(x.fonte),
      prossimoGiro: prossimoGiro(x.fonte, x.attiva, cron.has(x.fonte), adesso),
      giri: giriPerFonte(righe, x.fonte),
    })),
  };
}
