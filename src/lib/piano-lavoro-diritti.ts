import type { SupabaseClient } from "@supabase/supabase-js";
import { getOmniaAiAccessState, type OmniaAiAccessState } from "@/lib/omnia-ai-access";
import { giornoRoma } from "@/lib/omnia-ai-catalogo-calcoli";
import { schemaAssente } from "@/lib/omnia-ai-incassi";
import { leggiAcquistoPagato } from "@/lib/piano-lavoro-acquisto";
import { leggiStatoPacchettoGara } from "@/lib/pacchetti-servizi";
import { CHIAVE_POLITICA_PROVA, interpretaPoliticaProva, scegliConcessione, type PoliticaProva, type RigaConcessione } from "@/lib/piano-lavoro-offerta-calcoli";
import type { ContestoDirittoPiano } from "@/lib/piano-lavoro-gara-calcoli";

// Da dove può venire il diritto a generare il piano di lavoro di UNA gara: lettura (lato server) di tutto ciò che serve alla regola pura
// valutaDirittoPiano. È l'unico punto che lo fa: lo usano la pagina della gara, l'azione che genera e quella che acquista, così quello che
// il cliente vede è quello che il server controlla.
//
// Tutto è tollerante alle migrazioni non eseguite (0097 acquisti, 0101 abbonamento e concessioni, 0104 pacchetti): ciò che manca = nessun diritto da lì.

export type DirittiPianoLavoro = Pick<ContestoDirittoPiano, "concessioneId" | "abbonamentoCopreGara" | "provaGratuita" | "acquistoPagato"> & {
  // pacchetto prepagato (migrazione 0104): le unità residue e se questa gara ha già consumato la sua
  pacchettoSaldo: number;
  pacchettoGaraConsumata: boolean;
  // l'account è in prova e la console ha deciso che per lui il piano di lavoro non è disponibile (nemmeno da comprare)
  provaBloccata: boolean;
  inProva: boolean;
};

async function leggiPoliticaProva(admin: SupabaseClient): Promise<PoliticaProva> {
  try {
    const { data, error } = await admin.from("console_impostazioni").select("valore").eq("chiave", CHIAVE_POLITICA_PROVA).maybeSingle<{ valore: string }>();
    return error ? "acquisto" : interpretaPoliticaProva(data?.valore);
  } catch {
    return "acquisto";
  }
}

// L'abbonamento attivo include il piano di lavoro E questa gara è una gara del PIANO (ha consumato una gara del piano, non un credito):
// il piano di lavoro dell'abbonamento copre solo quelle.
async function abbonamentoCopreLaGara(admin: SupabaseClient, accountId: string, garaId: string): Promise<boolean> {
  const { data: consumo } = await admin
    .from("gara_consumi")
    .select("tipo")
    .eq("gara_id", garaId)
    .eq("user_id", accountId)
    .maybeSingle<{ tipo: string }>();
  if (consumo?.tipo !== "piano") return false;

  const { data: abbonamento, error } = await admin
    .from("subscriptions")
    .select("piano_lavoro, current_period_end")
    .eq("user_id", accountId)
    .eq("status", "attivo")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ piano_lavoro: boolean | null; current_period_end: string | null }>();
  if (error) {
    if (!schemaAssente(error)) console.error("Piano di lavoro: lettura dell'abbonamento non riuscita", error.message);
    return false;
  }
  if (!abbonamento || abbonamento.piano_lavoro !== true) return false;
  return !abbonamento.current_period_end || new Date(abbonamento.current_period_end).getTime() > Date.now();
}

// La concessione della console che copre questa gara, se c'è (quella per la singola gara prima, poi quelle per tutte).
async function concessioneCheCopreLaGara(admin: SupabaseClient, accountId: string, garaId: string): Promise<string | null> {
  const { data, error } = await admin
    .from("omnia_ai_piano_lavoro_concessioni")
    .select("id, tipo, gara_id, gare_massime, scade_il, attiva")
    .eq("user_id", accountId)
    .eq("attiva", true)
    .order("creata_il", { ascending: true })
    .returns<RigaConcessione[]>();
  if (error) {
    if (!schemaAssente(error)) console.error("Piano di lavoro: lettura delle concessioni non riuscita", error.message);
    return null;
  }
  const righe = data ?? [];
  if (righe.length === 0) return null;

  // le gare che hanno già un piano (generato o in corso) grazie a ciascuna concessione con un numero massimo
  const conLimite = righe.filter((r) => r.tipo === "tutte" && r.gare_massime !== null).map((r) => r.id);
  const gareUsate: Record<string, string[]> = {};
  if (conLimite.length > 0) {
    const { data: usate, error: erroreUsate } = await admin
      .from("gara_piani_lavoro")
      .select("gara_id, concessione_id")
      .in("concessione_id", conLimite)
      .in("stato", ["in_corso", "pronto"])
      .returns<{ gara_id: string; concessione_id: string }[]>();
    if (erroreUsate) {
      console.error("Piano di lavoro: conteggio delle gare concesse non riuscito", erroreUsate.message);
      return null;
    }
    for (const u of usate ?? []) {
      const gare = (gareUsate[u.concessione_id] ??= []);
      if (!gare.includes(u.gara_id)) gare.push(u.gara_id);
    }
  }
  return scegliConcessione(righe, garaId, giornoRoma(new Date()), gareUsate)?.id ?? null;
}

export async function leggiDirittiPianoLavoro({
  admin,
  accountId,
  garaId,
  statoAccesso,
}: {
  admin: SupabaseClient;
  accountId: string;
  garaId: string;
  // la pagina della gara lo ha già letto
  statoAccesso?: OmniaAiAccessState;
}): Promise<DirittiPianoLavoro> {
  const stato = statoAccesso ?? (await getOmniaAiAccessState(accountId, admin));
  const inProva = stato.stato === "prova";
  const [acquistoPagato, abbonamentoCopreGara, concessioneId, politica, pacchetto] = await Promise.all([
    leggiAcquistoPagato(admin, accountId, garaId),
    abbonamentoCopreLaGara(admin, accountId, garaId),
    concessioneCheCopreLaGara(admin, accountId, garaId),
    inProva ? leggiPoliticaProva(admin) : Promise.resolve<PoliticaProva>("acquisto"),
    leggiStatoPacchettoGara(admin, accountId, "piano_lavoro", garaId),
  ]);
  return {
    acquistoPagato,
    pacchettoSaldo: pacchetto.saldo,
    pacchettoGaraConsumata: pacchetto.garaGiaConsumata,
    abbonamentoCopreGara,
    concessioneId,
    provaGratuita: inProva && politica === "gratis",
    provaBloccata: inProva && politica === "bloccato",
    inProva,
  };
}
