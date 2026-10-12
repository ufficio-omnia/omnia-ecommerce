import { createAdminClient } from "@/lib/supabase/admin";
import { TARIFFE } from "@/lib/ai-pricing";
import { schemaAssente } from "@/lib/omnia-ai-incassi";
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
      // da dove viene il ricavo da abbonamento: incassi registrati, oppure listino (tabella incassi non ancora creata)
      fonteRicavo: "incassi" | "listino";
      includiProva: boolean;
      // ricavi di PROVA (Stripe in test) del periodo: esclusi dal ricavo se non richiesti, inclusi se richiesti
      ricaviProva: { voci: number; lordo: number };
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

export async function leggiCosti(periodo: Periodo, opzioni: { includiProva?: boolean } = {}): Promise<CostiLetti> {
  const includiProva = opzioni.includiProva ?? false;
  const admin = createAdminClient();
  const intervallo = { p_da: periodo.daIso, p_a: periodo.aIso };

  const [costiRpc, gareRpc, modelliRpc, abbonamentiQ, acquistiQ, incassiQ, parametri] = await Promise.all([
    admin.rpc("console_costi_per_cliente", intervallo),
    admin.rpc("console_gare_consumate", intervallo),
    admin.rpc("console_modelli_in_uso", intervallo),
    admin
      .from("subscriptions")
      .select("user_id, plan, status, stripe_subscription_id, created_at, current_period_end, cancel_at_period_end")
      .limit(5000),
    admin
      .from("omnia_ai_credit_purchases")
      .select("user_id, importo_centesimi, stripe_session_id")
      .gte("created_at", periodo.daIso)
      .lt("created_at", periodo.aIso)
      .limit(5000),
    admin
      .from("omnia_ai_incassi")
      .select("user_id, stripe_subscription_id, importo_lordo_centesimi, livemode")
      .gte("pagato_il", periodo.daIso)
      .lt("pagato_il", periodo.aIso)
      .limit(5000),
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

  // Acquisti di crediti: quelli con sessione Stripe "cs_test_" sono di prova.
  const acquistiTutti = ((acquistiQ.data ?? []) as { user_id: string; importo_centesimi: number; stripe_session_id: string | null }[]).map((a) => ({
    user_id: a.user_id,
    importo_centesimi: num(a.importo_centesimi),
    prova: (a.stripe_session_id ?? "").startsWith("cs_test_"),
  }));
  const acquisti = acquistiTutti.filter((a) => includiProva || !a.prova);
  const ricaviProva = {
    voci: acquistiTutti.filter((a) => a.prova).length,
    lordo: acquistiTutti.filter((a) => a.prova).reduce((s, a) => s + a.importo_centesimi / 100, 0),
  };

  // Incassi degli abbonamenti: la fonte del ricavo, se la tabella esiste (migrazione 0078).
  // Un incasso senza utente (evento arrivato prima della subscription) si attribuisce
  // tramite l'abbonamento Stripe a cui appartiene.
  let incassiAbbonamento: { user_id: string; importo: number }[] | undefined;
  if (!incassiQ.error) {
    const utenteDaAbbonamento = new Map(abbonamenti.filter((a) => a.stripe_subscription_id).map((a) => [a.stripe_subscription_id as string, a.user_id]));
    const incassi = (incassiQ.data ?? []) as { user_id: string | null; stripe_subscription_id: string | null; importo_lordo_centesimi: number; livemode: boolean }[];
    incassiAbbonamento = [];
    for (const i of incassi) {
      const importo = num(i.importo_lordo_centesimi) / 100;
      if (!i.livemode) {
        ricaviProva.voci++;
        ricaviProva.lordo += importo;
        if (!includiProva) continue;
      }
      const utente = i.user_id ?? (i.stripe_subscription_id ? utenteDaAbbonamento.get(i.stripe_subscription_id) : undefined);
      if (utente) incassiAbbonamento.push({ user_id: utente, importo });
    }
  } else if (!schemaAssente(incassiQ.error)) {
    console.error("Console: lettura incassi fallita", incassiQ.error.message);
    return { stato: "errore", messaggio: "Lettura dei dati non riuscita (incassi)." };
  }

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
    { costi, gare, abbonamenti, acquisti, identita, incassiAbbonamento },
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
    fonteRicavo: incassiAbbonamento ? "incassi" : "listino",
    includiProva,
    ricaviProva,
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
      fonteRicavo: "incassi" | "listino";
      includiProva: boolean;
    };

// userId nullo = costi senza cliente (piattaforma e non attribuiti).
export async function leggiDettaglioCliente(userId: string | null, periodo: Periodo, opzioni: { includiProva?: boolean } = {}): Promise<DettaglioCliente> {
  const costi = await leggiCosti(periodo, opzioni);
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
    fonteRicavo: costi.fonteRicavo,
    includiProva: costi.includiProva,
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
