import { createAdminClient } from "@/lib/supabase/admin";
import { TARIFFE } from "@/lib/ai-pricing";
import {
  assemblaClienti,
  type AbbonamentoRiga,
  type CostiNonAttribuiti,
  type CostoClienteDb,
  type GareConsumateDb,
  type Identita,
  type ParametriDiCalcolo,
  type RigaCliente,
  type TotaliCosti,
} from "./costi-calcoli";
import type { Periodo } from "./periodo";

// Lettura dei dati per la pagina Costi. Le somme le fanno le funzioni SQL della
// migrazione 0077 (solo service role); qui si leggono i risultati, si
// completano con anagrafica, abbonamenti e acquisti di crediti, e si passano ai
// calcoli puri di costi-calcoli.ts. Da chiamare solo dopo richiediAdminPagina().

export const IVA_PREDEFINITA = 22;

export type StatoParametri = ParametriDiCalcolo & {
  // false se la tabella console_impostazioni non esiste ancora (migrazione 0077)
  tabellaDisponibile: boolean;
};

type Errore = { code?: string; message: string } | null;

function funzioneAssente(errore: Errore): boolean {
  return Boolean(errore && (errore.code === "PGRST202" || /Could not find the function|does not exist/i.test(errore.message)));
}

export async function leggiParametriCalcolo(): Promise<StatoParametri> {
  const { data, error } = await createAdminClient().from("console_impostazioni").select("chiave, valore");
  if (error) return { cambioUsdEur: null, aliquotaIva: IVA_PREDEFINITA, tabellaDisponibile: false };

  const valori = new Map((data ?? []).map((r: { chiave: string; valore: string }) => [r.chiave, r.valore]));
  const cambio = Number(valori.get("cambio_usd_eur"));
  const iva = Number(valori.get("aliquota_iva"));
  return {
    cambioUsdEur: valori.has("cambio_usd_eur") && Number.isFinite(cambio) && cambio > 0 ? cambio : null,
    aliquotaIva: valori.has("aliquota_iva") && Number.isFinite(iva) && iva >= 0 ? iva : IVA_PREDEFINITA,
    tabellaDisponibile: true,
  };
}

export type ModelloInUso = {
  provider: string;
  model: string;
  operazioni: number;
  operazioniSenzaCosto: number;
  costoUsd: number;
  // dollari per milione di token (input, output) da src/lib/ai-pricing.ts; null = il modello non ha tariffa
  tariffa: { input: number; output: number } | null;
};

export type CostiLetti =
  | { stato: "funzioni_mancanti" }
  | { stato: "errore"; messaggio: string }
  | {
      stato: "ok";
      parametri: StatoParametri;
      righe: RigaCliente[];
      nonAttribuiti: CostiNonAttribuiti[];
      totali: TotaliCosti;
      modelli: ModelloInUso[];
      // righe di abbonamento create a mano (senza Stripe) e con piano fuori catalogo: non generano ricavo
      abbonamentiManuali: number;
      abbonamentiPianoSconosciuto: number;
    };

const PEZZO = 100;

async function inBlocchi<T>(ids: string[], leggi: (blocco: string[]) => PromiseLike<{ data: T[] | null; error: Errore }>): Promise<T[]> {
  const risultato: T[] = [];
  for (let i = 0; i < ids.length; i += PEZZO) {
    const { data, error } = await leggi(ids.slice(i, i + PEZZO));
    if (error) throw new Error(error.message);
    risultato.push(...(data ?? []));
  }
  return risultato;
}

export async function leggiIdentita(ids: string[]): Promise<Map<string, Identita>> {
  const admin = createAdminClient();
  const unici = [...new Set(ids)];
  const [utenti, aziende] = await Promise.all([
    inBlocchi<{ id: string; email: string }>(unici, (b) => admin.from("users").select("id, email").in("id", b)),
    inBlocchi<{ user_id: string; ragione_sociale: string | null }>(unici, (b) => admin.from("companies").select("user_id, ragione_sociale").in("user_id", b)),
  ]);
  const mappa = new Map<string, Identita>();
  for (const u of utenti) mappa.set(u.id, { email: u.email, ragioneSociale: null });
  for (const a of aziende) {
    const attuale = mappa.get(a.user_id);
    if (attuale) attuale.ragioneSociale = a.ragione_sociale;
  }
  return mappa;
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export async function leggiCosti(periodo: Periodo): Promise<CostiLetti> {
  const admin = createAdminClient();
  const intervallo = { p_da: periodo.daIso, p_a: periodo.aIso };

  const [costiRpc, gareRpc, modelliRpc, abbonamentiQ, acquistiQ, parametri] = await Promise.all([
    admin.rpc("console_costi_per_cliente", intervallo),
    admin.rpc("console_gare_consumate", intervallo),
    admin.rpc("console_modelli_in_uso", intervallo),
    admin
      .from("subscriptions")
      .select("user_id, plan, status, stripe_subscription_id, created_at, current_period_end, cancel_at_period_end")
      .limit(5000),
    admin.from("omnia_ai_credit_purchases").select("user_id, importo_centesimi").gte("created_at", periodo.daIso).lt("created_at", periodo.aIso).limit(5000),
    leggiParametriCalcolo(),
  ]);

  if (funzioneAssente(costiRpc.error) || funzioneAssente(gareRpc.error) || funzioneAssente(modelliRpc.error)) {
    return { stato: "funzioni_mancanti" };
  }
  for (const [nome, q] of [["costi", costiRpc], ["gare", gareRpc], ["modelli", modelliRpc], ["abbonamenti", abbonamentiQ], ["acquisti", acquistiQ]] as const) {
    if (q.error) {
      console.error(`Console: lettura ${nome} fallita`, q.error.message);
      return { stato: "errore", messaggio: `Lettura dei dati non riuscita (${nome}).` };
    }
  }

  const costi: CostoClienteDb[] = ((costiRpc.data ?? []) as Record<string, unknown>[]).map((r) => ({
    user_id: (r.user_id as string | null) ?? null,
    categoria: r.categoria as CostoClienteDb["categoria"],
    operazioni: num(r.operazioni),
    operazioni_senza_costo: num(r.operazioni_senza_costo),
    costo_usd: num(r.costo_usd),
    input_token: num(r.input_token),
    output_token: num(r.output_token),
  }));
  const gare: GareConsumateDb[] = ((gareRpc.data ?? []) as Record<string, unknown>[]).map((r) => ({
    user_id: r.user_id as string,
    gare_piano: num(r.gare_piano),
    gare_credito: num(r.gare_credito),
  }));
  const abbonamenti = (abbonamentiQ.data ?? []) as (AbbonamentoRiga & { user_id: string })[];
  const acquisti = ((acquistiQ.data ?? []) as { user_id: string; importo_centesimi: number }[]).map((a) => ({ user_id: a.user_id, importo_centesimi: num(a.importo_centesimi) }));

  const idCoinvolti = [
    ...costi.filter((c) => c.user_id).map((c) => c.user_id as string),
    ...gare.map((g) => g.user_id),
    ...abbonamenti.map((a) => a.user_id),
    ...acquisti.map((a) => a.user_id),
  ];

  let identita: Map<string, Identita>;
  try {
    identita = await leggiIdentita(idCoinvolti);
  } catch (e) {
    console.error("Console: lettura anagrafica fallita", e);
    return { stato: "errore", messaggio: "Lettura dell'anagrafica dei clienti non riuscita." };
  }

  const { righe, nonAttribuiti, totali } = assemblaClienti(
    { costi, gare, abbonamenti, acquisti, identita },
    parametri,
    periodo,
    new Date(),
  );

  const modelli: ModelloInUso[] = ((modelliRpc.data ?? []) as Record<string, unknown>[]).map((r) => ({
    provider: String(r.provider),
    model: String(r.model),
    operazioni: num(r.operazioni),
    operazioniSenzaCosto: num(r.operazioni_senza_costo),
    costoUsd: num(r.costo_usd),
    tariffa: TARIFFE[String(r.model)] ? { input: TARIFFE[String(r.model)].inputPerMilione, output: TARIFFE[String(r.model)].outputPerMilione } : null,
  }));

  return {
    stato: "ok",
    parametri,
    righe,
    nonAttribuiti,
    totali,
    modelli,
    abbonamentiManuali: abbonamenti.filter((a) => !a.stripe_subscription_id).length,
    abbonamentiPianoSconosciuto: abbonamenti.filter((a) => a.stripe_subscription_id && !["starter", "professional", "enterprise"].includes(a.plan.trim().toLowerCase())).length,
  };
}

// ───── Dettaglio di un cliente ─────

export type OperazioneCosto = {
  operazione: string;
  provider: string;
  model: string;
  chiamate: number;
  senzaCosto: number;
  inputToken: number;
  outputToken: number;
  costoUsd: number;
};

export type GaraConsumata = { titolo: string | null; tipo: "piano" | "credito"; creatoIl: string };

export type DettaglioCliente =
  | { stato: "funzioni_mancanti" }
  | { stato: "errore"; messaggio: string }
  | {
      stato: "ok";
      parametri: StatoParametri;
      identita: Identita;
      riga: RigaCliente | null;
      operazioni: OperazioneCosto[];
      gare: GaraConsumata[];
    };

// userId nullo = costi senza cliente (piattaforma e non attribuiti).
export async function leggiDettaglioCliente(userId: string | null, periodo: Periodo): Promise<DettaglioCliente> {
  const costi = await leggiCosti(periodo);
  if (costi.stato !== "ok") return costi;

  const admin = createAdminClient();
  const [operazioniRpc, gareQ, identita] = await Promise.all([
    admin.rpc("console_costi_per_operazione", { p_da: periodo.daIso, p_a: periodo.aIso, p_user: userId }),
    userId
      ? admin
          .from("gara_consumi")
          .select("gara_titolo, tipo, created_at")
          .eq("user_id", userId)
          .gte("created_at", periodo.daIso)
          .lt("created_at", periodo.aIso)
          .order("created_at", { ascending: false })
          .limit(200)
      : Promise.resolve({ data: [] as unknown[], error: null }),
    userId ? leggiIdentita([userId]) : Promise.resolve(new Map<string, Identita>()),
  ]);

  if (operazioniRpc.error || gareQ.error) {
    console.error("Console: lettura dettaglio cliente fallita", operazioniRpc.error?.message ?? gareQ.error?.message);
    return { stato: "errore", messaggio: "Lettura del dettaglio non riuscita." };
  }

  return {
    stato: "ok",
    parametri: costi.parametri,
    identita: (userId ? identita.get(userId) : undefined) ?? { email: null, ragioneSociale: null },
    riga: userId ? (costi.righe.find((r) => r.userId === userId) ?? null) : null,
    operazioni: ((operazioniRpc.data ?? []) as Record<string, unknown>[]).map((r) => ({
      operazione: String(r.operazione),
      provider: String(r.provider),
      model: String(r.model),
      chiamate: num(r.chiamate),
      senzaCosto: num(r.senza_costo),
      inputToken: num(r.input_token),
      outputToken: num(r.output_token),
      costoUsd: num(r.costo_usd),
    })),
    gare: ((gareQ.data ?? []) as { gara_titolo: string | null; tipo: "piano" | "credito"; created_at: string }[]).map((g) => ({
      titolo: g.gara_titolo,
      tipo: g.tipo,
      creatoIl: g.created_at,
    })),
  };
}
