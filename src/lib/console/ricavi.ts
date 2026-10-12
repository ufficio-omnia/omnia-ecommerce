import { createAdminClient } from "@/lib/supabase/admin";
import { schemaAssente } from "@/lib/omnia-ai-incassi";
import { leggiIdentita, leggiParametriCalcolo, type StatoParametri } from "./costi";
import type { Periodo } from "./periodo";
import { aggregaRicavi, type RiepilogoRicavi, type VoceRicavo } from "./ricavi-calcoli";

// Lettura dei dati per la pagina Ricavi: ordini pagati dell'e-commerce, incassi
// degli abbonamenti OMNIA AI e crediti acquistati, per dominio e per mese. Da
// chiamare solo dopo richiediAdminPagina(). I calcoli stanno in ricavi-calcoli.ts.

export type IncassoElenco = {
  id: string;
  pagatoIl: string;
  tipo: string;
  lordo: number;
  // email dell'utente, o il nome/email raccolti da Stripe se l'utente non è ancora agganciato
  cliente: string;
  prova: boolean;
  ricevutaUrl: string | null;
};

export type RicaviLetti =
  | { stato: "errore"; messaggio: string }
  | {
      stato: "ok";
      parametri: StatoParametri;
      riepilogo: RiepilogoRicavi;
      // la tabella omnia_ai_incassi esiste (migrazione 0078)
      incassiDisponibili: boolean;
      // la colonna orders.paid_at esiste (migrazione 0075)
      dataPagamentoDisponibile: boolean;
      ultimiIncassi: IncassoElenco[];
    };

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

type Snapshot = { nome?: string | null; email?: string | null } | null;

export async function leggiRicavi(periodo: Periodo, opzioni: { includiProva?: boolean } = {}): Promise<RicaviLetti> {
  const includiProva = opzioni.includiProva ?? false;
  const admin = createAdminClient();

  // Ordini pagati: la data è quella della conferma del pagamento (paid_at).
  let dataPagamentoDisponibile = true;
  let ordiniQ: { data: unknown; error: { code?: string; message: string } | null } = await admin
    .from("orders")
    .select("id, total_amount, created_at, paid_at, payment_method")
    .eq("status", "pagato")
    .limit(5000);
  if (ordiniQ.error && schemaAssente(ordiniQ.error)) {
    dataPagamentoDisponibile = false;
    ordiniQ = await admin.from("orders").select("id, total_amount, created_at, payment_method").eq("status", "pagato").limit(5000);
  }

  const [incassiQ, creditiQ, parametri] = await Promise.all([
    admin
      .from("omnia_ai_incassi")
      .select("id, user_id, tipo, importo_lordo_centesimi, imposta_centesimi, pagato_il, livemode, ricevuta_url, cliente_snapshot")
      .gte("pagato_il", periodo.daIso)
      .lt("pagato_il", periodo.aIso)
      .order("pagato_il", { ascending: false })
      .limit(5000),
    admin.from("omnia_ai_credit_purchases").select("importo_centesimi, stripe_session_id, created_at").gte("created_at", periodo.daIso).lt("created_at", periodo.aIso).limit(5000),
    leggiParametriCalcolo(),
  ]);

  if (ordiniQ.error) {
    console.error("Console: lettura ordini per i ricavi fallita", ordiniQ.error.message);
    return { stato: "errore", messaggio: "Lettura degli ordini non riuscita." };
  }
  if (creditiQ.error) {
    console.error("Console: lettura crediti per i ricavi fallita", creditiQ.error.message);
    return { stato: "errore", messaggio: "Lettura degli acquisti di crediti non riuscita." };
  }
  const incassiDisponibili = !incassiQ.error;
  if (incassiQ.error && !schemaAssente(incassiQ.error)) {
    console.error("Console: lettura incassi per i ricavi fallita", incassiQ.error.message);
    return { stato: "errore", messaggio: "Lettura degli incassi non riuscita." };
  }

  const voci: VoceRicavo[] = [];

  for (const o of (ordiniQ.data ?? []) as { total_amount: number | string; created_at: string; paid_at?: string | null; payment_method: string | null }[]) {
    voci.push({
      dominio: "ecommerce",
      fonte: "ordine",
      data: o.paid_at ?? o.created_at,
      lordo: num(o.total_amount),
      impostaStripe: null,
      prova: false,
      // un pagamento con carta è già confermato alla creazione: la data dell'ordine è quella giusta
      dataApprossimata: !o.paid_at && o.payment_method === "bonifico",
    });
  }

  const incassi = (incassiQ.data ?? []) as {
    id: string;
    user_id: string | null;
    tipo: string;
    importo_lordo_centesimi: number;
    imposta_centesimi: number | null;
    pagato_il: string;
    livemode: boolean;
    ricevuta_url: string | null;
    cliente_snapshot: Snapshot;
  }[];
  for (const i of incassi) {
    voci.push({
      dominio: "omnia_ai",
      fonte: "abbonamento",
      data: i.pagato_il,
      lordo: num(i.importo_lordo_centesimi) / 100,
      impostaStripe: i.imposta_centesimi === null ? null : num(i.imposta_centesimi) / 100,
      prova: !i.livemode,
      dataApprossimata: false,
    });
  }

  for (const c of (creditiQ.data ?? []) as { importo_centesimi: number; stripe_session_id: string | null; created_at: string }[]) {
    voci.push({
      dominio: "omnia_ai",
      fonte: "crediti",
      data: c.created_at,
      lordo: num(c.importo_centesimi) / 100,
      impostaStripe: null,
      prova: (c.stripe_session_id ?? "").startsWith("cs_test_"),
      dataApprossimata: false,
    });
  }

  // Elenco degli incassi più recenti, per confrontarli con la dashboard di Stripe.
  const identita = await leggiIdentita(incassi.slice(0, 15).flatMap((i) => (i.user_id ? [i.user_id] : [])));
  const ultimiIncassi: IncassoElenco[] = incassi
    .filter((i) => i.livemode || includiProva)
    .slice(0, 15)
    .map((i) => ({
      id: i.id,
      pagatoIl: i.pagato_il,
      tipo: i.tipo,
      lordo: num(i.importo_lordo_centesimi) / 100,
      cliente: (i.user_id ? identita.get(i.user_id)?.email : null) ?? i.cliente_snapshot?.email ?? i.cliente_snapshot?.nome ?? "(cliente non agganciato)",
      prova: !i.livemode,
      ricevutaUrl: i.ricevuta_url,
    }));

  return {
    stato: "ok",
    parametri,
    riepilogo: aggregaRicavi(voci, periodo, parametri.aliquotaIva, includiProva),
    incassiDisponibili,
    dataPagamentoDisponibile,
    ultimiIncassi,
  };
}
