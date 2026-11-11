import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import PagamentiVista from "@/components/omnia-ai/pagamenti-vista";
import { costruisciPagamenti, type AbbonamentoCliente, type AcquistoCrediti, type CopertinaClientePagamento, type IncassoCliente, type PacchettoCliente, type PianoLavoroCliente, type RevisioneCliente } from "@/lib/omnia-ai-pagamenti";
import GestisciPagamentoButton from "../abbonamento/gestisci-pagamento-button";
import { richiediTitolarePagina } from "@/lib/omnia-ai-account-guardie";

export const metadata: Metadata = { title: "Pagamenti e fatture — OMNIA AI" };

// Colonne che il cliente può leggere (le concede la migrazione 0081): niente note interne
// di fatturazione, niente istantanea dei dati su Stripe, niente identificativi Stripe.
const COLONNE_INCASSO_BASE = "id, tipo, importo_lordo_centesimi, pagato_il, livemode, numero_ricevuta, ricevuta_url, stripe_subscription_id, stato_fattura, numero_fattura, data_fattura";
const COLONNE_CREDITI_BASE = "id, pacchetto, crediti, importo_centesimi, created_at, stato_fattura, numero_fattura, data_fattura";
const FILE = ", fattura_file_path";
// revisioni umane pagate (migrazione 0089): le colonne le concede la stessa migrazione
const COLONNE_REVISIONE = "id, gara_titolo, pagine, maggiorazione_percentuale, prezzo_totale_centesimi, importo_pagato_centesimi, pagata_il, livemode, stato_fattura, numero_fattura, data_fattura, fattura_file_path";
// acquisti singoli del piano di lavoro pagati (migrazione 0097): le colonne le concede la stessa migrazione
const COLONNE_PIANO_LAVORO = "id, gara_titolo, prezzo_centesimi, importo_pagato_centesimi, pagata_il, livemode, stato_fattura, numero_fattura, data_fattura, fattura_file_path";
// pacchetti di servizi aggiuntivi pagati (migrazione 0104): le colonne le concede la stessa migrazione
const COLONNE_PACCHETTO = "id, servizio, quantita, prezzo_centesimi, importo_pagato_centesimi, pagata_il, livemode, stato_fattura, numero_fattura, data_fattura, fattura_file_path";
// copertine della relazione tecnica pagate (migrazione 0107): le colonne le concede la stessa migrazione
const COLONNE_COPERTINA = "id, gara_titolo, prezzo_centesimi, importo_pagato_centesimi, pagata_il, livemode, stato_fattura, numero_fattura, data_fattura, fattura_file_path";

type Errore = { code?: string } | null;
// colonna che non esiste ancora (migrazione non eseguita)
const colonnaAssente = (e: Errore) => e?.code === "42703" || e?.code === "PGRST204";

// Tutte le letture passano dalla sessione del cliente: la RLS (policy «solo le mie
// righe») gli restituisce soltanto i suoi pagamenti, e in più si filtra per il suo id.
export default async function PagamentiPage() {
  const supabase = await createClient();
  // Solo il titolare: l'Ufficio Gare non vede questa pagina (la barra laterale non la mostra, il controllo vero è qui).
  const sessione = await richiediTitolarePagina();
  if (!sessione) return null;
  const { user } = sessione;

  const leggiIncassi = (colonne: string) =>
    supabase.from("omnia_ai_incassi").select(colonne).eq("user_id", user.id).order("pagato_il", { ascending: false }).limit(500).returns<IncassoCliente[]>();
  const leggiCrediti = (colonne: string) =>
    supabase.from("omnia_ai_credit_purchases").select(colonne).eq("user_id", user.id).order("created_at", { ascending: false }).limit(500).returns<AcquistoCrediti[]>();

  // prima della migrazione 0089 la tabella non esiste: nessuna revisione, e il resto della pagina funziona
  const leggiRevisioni = supabase
    .from("omnia_ai_revisioni")
    .select(COLONNE_REVISIONE)
    .eq("user_id", user.id)
    .eq("stato", "pagata")
    .order("pagata_il", { ascending: false })
    .limit(200)
    .returns<RevisioneCliente[]>();

  // prima della migrazione 0097 la tabella non esiste: nessun piano di lavoro acquistato, e il resto della pagina funziona
  const leggiPianiLavoro = supabase
    .from("omnia_ai_piani_lavoro_acquisti")
    .select(COLONNE_PIANO_LAVORO)
    .eq("user_id", user.id)
    .eq("stato", "pagata")
    .order("pagata_il", { ascending: false })
    .limit(200)
    .returns<PianoLavoroCliente[]>();

  // prima della migrazione 0104 la tabella non esiste: nessun pacchetto acquistato, e il resto della pagina funziona
  const leggiPacchetti = supabase
    .from("omnia_ai_pacchetti_acquisti")
    .select(COLONNE_PACCHETTO)
    .eq("user_id", user.id)
    .eq("stato", "pagata")
    .order("pagata_il", { ascending: false })
    .limit(200)
    .returns<PacchettoCliente[]>();

  // prima della migrazione 0107 la tabella non esiste: nessuna copertina acquistata, e il resto della pagina funziona
  const leggiCopertine = supabase
    .from("omnia_ai_copertine_acquisti")
    .select(COLONNE_COPERTINA)
    .eq("user_id", user.id)
    .eq("stato", "pagata")
    .order("pagata_il", { ascending: false })
    .limit(200)
    .returns<CopertinaClientePagamento[]>();

  const [incassiIniziali, creditiIniziali, revisioni, pianiLavoro, pacchetti, copertine] = await Promise.all([leggiIncassi(COLONNE_INCASSO_BASE + FILE), leggiCrediti(COLONNE_CREDITI_BASE + FILE), leggiRevisioni, leggiPianiLavoro, leggiPacchetti, leggiCopertine]);
  let incassi = incassiIniziali;
  let crediti = creditiIniziali;
  if (revisioni.error) console.error("Pagamenti cliente: lettura delle revisioni umane non riuscita (migrazione 0089?)", revisioni.error.code, revisioni.error.message);
  if (pianiLavoro.error) console.error("Pagamenti cliente: lettura dei piani di lavoro acquistati non riuscita (migrazione 0097?)", pianiLavoro.error.code, pianiLavoro.error.message);
  if (pacchetti.error) console.error("Pagamenti cliente: lettura dei pacchetti acquistati non riuscita (migrazione 0104?)", pacchetti.error.code, pacchetti.error.message);
  if (copertine.error) console.error("Pagamenti cliente: lettura delle copertine acquistate non riuscita (migrazione 0107?)", copertine.error.code, copertine.error.message);
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
      pagamenti={costruisciPagamenti(incassi.data ?? [], crediti.data ?? [], abbonamenti ?? [], revisioni.error ? [] : (revisioni.data ?? []), pianiLavoro.error ? [] : (pianiLavoro.data ?? []), pacchetti.error ? [] : (pacchetti.data ?? []), copertine.error ? [] : (copertine.data ?? []))}
      storicoAbbonamentoDisponibile={storicoDisponibile}
      portale={haPortale ? <GestisciPagamentoButton etichetta="Apri il portale pagamenti di Stripe" /> : null}
    />
  );
}
