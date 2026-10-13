import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import PagamentiVista from "@/components/omnia-ai/pagamenti-vista";
import { costruisciPagamenti, type AbbonamentoCliente, type AcquistoCrediti, type IncassoCliente } from "@/lib/omnia-ai-pagamenti";
import GestisciPagamentoButton from "../abbonamento/gestisci-pagamento-button";

export const metadata: Metadata = { title: "Pagamenti e fatture — OMNIA AI" };

// Colonne che il cliente può leggere (le concede la migrazione 0081): niente note interne
// di fatturazione, niente istantanea dei dati su Stripe, niente identificativi Stripe.
const COLONNE_INCASSO_BASE = "id, tipo, importo_lordo_centesimi, pagato_il, livemode, numero_ricevuta, ricevuta_url, stripe_subscription_id, stato_fattura, numero_fattura, data_fattura";
const COLONNE_CREDITI_BASE = "id, pacchetto, crediti, importo_centesimi, created_at, stato_fattura, numero_fattura, data_fattura";
const FILE = ", fattura_file_path";

type Errore = { code?: string } | null;
// colonna che non esiste ancora (migrazione non eseguita)
const colonnaAssente = (e: Errore) => e?.code === "42703" || e?.code === "PGRST204";

// Tutte le letture passano dalla sessione del cliente: la RLS (policy «solo le mie
// righe») gli restituisce soltanto i suoi pagamenti, e in più si filtra per il suo id.
export default async function PagamentiPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const leggiIncassi = (colonne: string) =>
    supabase.from("omnia_ai_incassi").select(colonne).eq("user_id", user.id).order("pagato_il", { ascending: false }).limit(500).returns<IncassoCliente[]>();
  const leggiCrediti = (colonne: string) =>
    supabase.from("omnia_ai_credit_purchases").select(colonne).eq("user_id", user.id).order("created_at", { ascending: false }).limit(500).returns<AcquistoCrediti[]>();

  let [incassi, crediti] = await Promise.all([leggiIncassi(COLONNE_INCASSO_BASE + FILE), leggiCrediti(COLONNE_CREDITI_BASE + FILE)]);
  // prima della migrazione 0081 manca la colonna del file: si legge senza (nessuna fattura scaricabile)
  if (colonnaAssente(incassi.error)) incassi = await leggiIncassi(COLONNE_INCASSO_BASE);
  if (colonnaAssente(crediti.error)) crediti = await leggiCrediti(COLONNE_CREDITI_BASE);

  const { data: abbonamenti } = await supabase
    .from("subscriptions")
    .select("stripe_subscription_id, plan, status")
    .eq("user_id", user.id)
    .returns<(AbbonamentoCliente & { status: string })[]>();

  // Lo storico dell'abbonamento si legge solo dopo la migrazione 0081 (prima il cliente non
  // aveva nessun permesso di lettura sugli incassi): se manca, lo si dice invece di mostrare
  // un elenco incompleto come se fosse completo.
  const storicoDisponibile = !incassi.error;
  if (incassi.error) console.error("Pagamenti cliente: lettura degli incassi non riuscita", incassi.error.code, incassi.error.message);
  if (crediti.error) console.error("Pagamenti cliente: lettura degli acquisti di crediti non riuscita", crediti.error.code, crediti.error.message);

  const haPortale = (abbonamenti ?? []).some((a) => a.status === "attivo" && a.stripe_subscription_id);

  return (
    <PagamentiVista
      pagamenti={costruisciPagamenti(incassi.data ?? [], crediti.data ?? [], abbonamenti ?? [])}
      storicoAbbonamentoDisponibile={storicoDisponibile}
      portale={haPortale ? <GestisciPagamentoButton etichetta="Apri il portale pagamenti di Stripe" /> : null}
    />
  );
}
