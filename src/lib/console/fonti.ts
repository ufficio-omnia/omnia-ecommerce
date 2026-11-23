// Pagina «Fonti» della console (48C §3.5–3.6). Solo server, con il client di servizio, dopo la guardia degli amministratori (pagina).
// Stato calcolato e allarmi: leggiSituazioneFonti di B2 (esecuzioni.ts, K3: stato delle fonti più registro dei giri degli ultimi 30 giorni).
// In più UNA lettura del registro per l'elenco degli ultimi giri di ciascuna fonte (al più 10 per fonte, nessun dato di gare). Nessuna
// scrittura: accendere e spegnere restano le azioni esistenti della console.
import type { SupabaseClient } from "@supabase/supabase-js";
import { GIORNI_REGISTRO_CONSOLE, leggiSituazioneFonti } from "@/lib/radar/esecuzioni";
import { COLONNE_ESECUZIONI_ALLARMI, type Allarme, type RigaEsecuzioneLetta, type StatoFonte } from "@/lib/radar/stato-fonti-calcoli";
import type { FonteEsecuzione } from "@/lib/radar/esecuzioni-calcoli";
import { cursorePvlV2Valido } from "@/lib/radar/importa-pvl-cursore";
import {
  GIRI_PER_FONTE,
  NOME_FONTE_CONSOLE,
  giroConsole,
  giriPerFonte,
  giriProgrammatiFonte,
  mostraRipresaRecupero,
  prossimoGiro,
  type GiriProgrammatiConsole,
  type GiroConsole,
  type RipresaRecuperoConsole,
} from "./fonti-calcoli";

export type FonteConsole = {
  fonte: FonteEsecuzione;
  nome: string;
  stato: StatoFonte;
  attiva: boolean;
  erroriConsecutivi: number;
  ultimoGiro: GiroConsole | null;
  ultimoSuccesso: string | null;
  allarmi: Allarme[];
  // orari, interruttori e righe cron dei giri programmati (programmazione-calcoli.ts, K1)
  giriProgrammati: GiriProgrammatiConsole;
  prossimoGiro: string | null;
  giri: GiroConsole[];
  // solo PVL con l'allarme «blocco_incompleto»: il recupero fermo e il pulsante «Riprendi il recupero»; altrimenti null
  ripresaRecupero: RipresaRecuperoConsole | null;
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
  // il blocco fermo della PVL: una lettura del cursore SOLO con l'allarme «blocco_incompleto» (nessun dato di gare)
  let ripresa: RipresaRecuperoConsole | null = null;
  if (s.situazioni.some((x) => mostraRipresaRecupero(x.fonte, x.allarmi))) {
    const r = await admin.from("radar_fonti_stato").select("cursore").eq("fonte", "pvl").maybeSingle<{ cursore: unknown }>();
    if (r.error) ripresa = { stato: "non_letto", errore: r.error.message };
    else {
      const fermo = cursorePvlV2Valido(r.data?.cursore)?.recupero.fermo ?? null;
      ripresa = fermo ? { stato: "fermo", blocco: { il: fermo.il, da: fermo.da, a: fermo.a } } : { stato: "gia_ripreso" };
    }
  }
  return {
    adesso: adesso.toISOString(),
    registroAssente: s.registroAssente,
    errore: s.errore,
    erroreGiri,
    fonti: s.situazioni.map((x) => {
      const giri = giriProgrammatiFonte(x.fonte, env, adesso);
      return {
        fonte: x.fonte,
        nome: NOME_FONTE_CONSOLE[x.fonte] ?? x.fonte,
        stato: x.stato,
        attiva: x.attiva,
        erroriConsecutivi: x.erroriConsecutivi,
        ultimoGiro: x.ultimoGiro ? giroConsole(x.ultimoGiro) : null,
        ultimoSuccesso: x.ultimoSuccesso,
        allarmi: x.allarmi,
        giriProgrammati: giri,
        prossimoGiro: prossimoGiro(x.fonte, x.attiva, giri.attivi, adesso),
        giri: giriPerFonte(righe, x.fonte),
        ripresaRecupero: mostraRipresaRecupero(x.fonte, x.allarmi) ? ripresa : null,
      };
    }),
  };
}
