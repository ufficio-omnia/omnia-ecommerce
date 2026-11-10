import { createAdminClient } from "@/lib/supabase/admin";
import { createStripeClient } from "@/lib/stripe";
import { PIANI, PIANI_ORDINE, type PianoSlug } from "@/lib/omnia-ai-plans";
import { schemaAssente } from "@/lib/omnia-ai-incassi";
import { lookupKeyDellOfferta } from "@/lib/omnia-ai-stripe-prices";
import { modalitaChiaveStripe, type ModalitaStripe } from "@/lib/omnia-ai-vendita";
import {
  CHIAVE_PREZZO_PIANO_LAVORO,
  CHIAVE_VENDITA_PIANO_LAVORO,
  interpretaInterruttoreVenditaPianoLavoro,
  interpretaPrezzoPianoLavoro,
  PREZZO_PIANO_LAVORO,
} from "@/lib/piano-lavoro-acquisto-calcoli";
import {
  CHIAVE_POLITICA_PROVA,
  chiaveSurplusPianoLavoro,
  interpretaPoliticaProva,
  prezzoConPianoLavoro,
  SURPLUS_PIANO_LAVORO_PREDEFINITO,
  interpretaSurplus,
  statoPrezzoOfferta,
  type PoliticaProva,
  type StatoPrezzoOfferta,
} from "@/lib/piano-lavoro-offerta-calcoli";
import { SERVIZI, interpretaCatalogoPacchetti, type PacchettoCatalogo } from "@/lib/pacchetti-servizi-calcoli";
import { leggiPrezziConsole } from "./prezzi";
import { inBlocchi } from "./costi";
import { leggiOfferteDedicateConsole, type OfferteDedicateConsole } from "./offerte";

// Dati della pagina «Piano di lavoro e pacchetti» della console: la vendita (UN interruttore, per la singola gara e per i pacchetti), il prezzo della
// singola gara, i pacchetti prepagati in vendita (migrazione 0104), le offerte dedicate a un cliente (migrazione 0105), la regola per gli utenti in prova
// e le concessioni gratuite.
// I supplementi mensili per avere il piano di lavoro nell'abbonamento NON si vendono più (decisione del 09/11/2026): restano nel codice
// (leggiPianiAbbonamentoConsole, usata solo dall'azione «Allinea i prezzi su Stripe») ma non sono più in pagina né legati alla vendita.
// Da chiamare solo dopo richiediAdminPagina() / richiediAdminAzione().

export type PianoLavoroPianoConsole = {
  slug: PianoSlug;
  nome: string;
  listinoCentesimi: number;
  surplusCentesimi: number;
  surplusModificato: boolean;
  // listino + supplemento: l'importo che il prezzo Stripe dell'offerta deve avere
  attesoCentesimi: number;
  stripe: { stato: StatoPrezzoOfferta | "errore"; importoCentesimi: number | null };
};

export type ConcessioneConsole = {
  id: string;
  utente: string;
  tipo: "tutte" | "gara";
  garaTitolo: string | null;
  gareMassime: number | null;
  gareUsate: number;
  scadeIl: string | null;
  motivo: string;
  attiva: boolean;
  creataIl: string;
  creataDa: string;
  revocataIl: string | null;
  revocataDa: string | null;
};

export type DatiPianoLavoroConsole = {
  modalitaStripe: ModalitaStripe;
  interruttore: boolean;
  prezzoSingoloCentesimi: number;
  prezzoSingoloModificato: boolean;
  politicaProva: PoliticaProva;
  // pacchetti prepagati in vendita adesso (quelli della console, o quelli di partenza se non ne ha mai salvati)
  pacchetti: PacchettoCatalogo[];
  pacchettiDiPartenza: boolean;
  // false = manca la migrazione 0104 (acquisti, saldi e movimenti dei pacchetti): senza, i pacchetti non si possono né vendere né usare
  pacchettiDisponibili: boolean;
  // unità ancora da usare, in tutti i saldi dei clienti (null = non leggibili)
  unitaResidue: number | null;
  // false = manca la migrazione 0101 (concessioni gratuite)
  concessioniDisponibili: boolean;
  concessioni: ConcessioneConsole[];
  // offerte dedicate a un cliente (migrazione 0105); disponibile=false = manca la migrazione
  offerte: OfferteDedicateConsole;
};

// L'elenco salvato dalla console è un JSON valido (anche «[]» o uguale a quello di partenza)? Allora è una scelta della console, non il valore di partenza.
function elencoSalvatoValido(valore: string | undefined): boolean {
  if (valore === undefined) return false;
  try {
    return Array.isArray(JSON.parse(valore));
  } catch {
    return false;
  }
}

async function leggiImpostazioni(chiavi: string[]): Promise<Map<string, string>> {
  const { data, error } = await createAdminClient().from("console_impostazioni").select("chiave, valore").in("chiave", chiavi).returns<{ chiave: string; valore: string }[]>();
  if (error) {
    console.error("Console: lettura delle impostazioni del piano di lavoro fallita", error.message);
    return new Map();
  }
  return new Map((data ?? []).map((r) => [r.chiave, r.valore]));
}

// I prezzi dell'abbonamento con il piano di lavoro (listino + supplemento) e il loro stato su Stripe. NON è più nella pagina: serve solo all'azione
// «Allinea i prezzi su Stripe», che resta nel codice. Una lettura sola di Stripe per i tre piani.
export async function leggiPianiAbbonamentoConsole(): Promise<PianoLavoroPianoConsole[]> {
  const modalitaStripe = modalitaChiaveStripe(process.env.STRIPE_SECRET_KEY_OMNIA_AI);
  const [impostazioni, prezzi] = await Promise.all([leggiImpostazioni(PIANI_ORDINE.map(chiaveSurplusPianoLavoro)), leggiPrezziConsole()]);

  // I prezzi Stripe dell'offerta con il piano di lavoro: una lettura sola per i tre piani.
  const importoStripe = new Map<string, number | null>();
  let stripeLetto = false;
  if (modalitaStripe !== "sconosciuta") {
    try {
      const attivi = await createStripeClient("omnia-ai").prices.list({ lookup_keys: PIANI_ORDINE.map((p) => lookupKeyDellOfferta(p, true)), active: true, limit: 10 });
      for (const p of attivi.data) if (p.lookup_key) importoStripe.set(p.lookup_key, p.unit_amount);
      stripeLetto = true;
    } catch (e) {
      console.error("Console: lettura dei prezzi Stripe del piano di lavoro fallita", e instanceof Error ? e.message : e);
    }
  }

  return PIANI_ORDINE.map((slug) => {
    const listino = prezzi.piani.find((p) => p.slug === slug)?.listinoCentesimi ?? PIANI[slug].prezzoCentesimi;
    const salvato = impostazioni.get(chiaveSurplusPianoLavoro(slug));
    const surplus = interpretaSurplus(salvato, slug);
    const atteso = prezzoConPianoLavoro(listino, surplus);
    const importo = importoStripe.get(lookupKeyDellOfferta(slug, true)) ?? null;
    return {
      slug,
      nome: PIANI[slug].nome,
      listinoCentesimi: listino,
      surplusCentesimi: surplus,
      surplusModificato: surplus !== SURPLUS_PIANO_LAVORO_PREDEFINITO[slug],
      attesoCentesimi: atteso,
      stripe: stripeLetto ? { stato: statoPrezzoOfferta(atteso, importo), importoCentesimi: importo } : { stato: "errore", importoCentesimi: null },
    };
  });
}

export async function leggiPianoLavoroConsole(): Promise<DatiPianoLavoroConsole> {
  const admin = createAdminClient();
  const impostazioni = await leggiImpostazioni([CHIAVE_VENDITA_PIANO_LAVORO, CHIAVE_PREZZO_PIANO_LAVORO, CHIAVE_POLITICA_PROVA, SERVIZI.piano_lavoro.chiaveCatalogo]);
  const modalitaStripe = modalitaChiaveStripe(process.env.STRIPE_SECRET_KEY_OMNIA_AI);

  const prezzoSalvato = impostazioni.get(CHIAVE_PREZZO_PIANO_LAVORO);
  const prezzoSingolo = interpretaPrezzoPianoLavoro(prezzoSalvato);

  // I pacchetti: l'elenco in vendita e, se la migrazione 0104 c'è, quante unità i clienti hanno ancora da usare.
  const salvato = impostazioni.get(SERVIZI.piano_lavoro.chiaveCatalogo);
  const pacchetti = interpretaCatalogoPacchetti("piano_lavoro", salvato);
  const saldiQ = await admin.from("omnia_ai_pacchetti_saldi").select("saldo").eq("servizio", "piano_lavoro").limit(5000).returns<{ saldo: number }[]>();
  const pacchettiDisponibili = !saldiQ.error;
  if (saldiQ.error && !schemaAssente(saldiQ.error)) console.error("Console: lettura dei saldi dei pacchetti fallita", saldiQ.error.message);

  // Le concessioni: senza la migrazione 0101 non ci sono.
  const concessioniQ = await admin
    .from("omnia_ai_piano_lavoro_concessioni")
    .select("id, user_id, tipo, gara_titolo, gare_massime, scade_il, motivo, attiva, creata_il, creata_da_email, revocata_il, revocata_da_email")
    .order("creata_il", { ascending: false })
    .limit(300)
    .returns<
      { id: string; user_id: string; tipo: "tutte" | "gara"; gara_titolo: string | null; gare_massime: number | null; scade_il: string | null; motivo: string; attiva: boolean; creata_il: string; creata_da_email: string; revocata_il: string | null; revocata_da_email: string | null }[]
    >();
  const concessioniDisponibili = !concessioniQ.error;
  if (concessioniQ.error && !schemaAssente(concessioniQ.error)) console.error("Console: lettura delle concessioni fallita", concessioniQ.error.message);
  const righe = concessioniQ.error ? [] : (concessioniQ.data ?? []);

  // Le offerte dedicate: senza la migrazione 0105 non ci sono (la pagina lo dice, senza errori).
  const offerte = await leggiOfferteDedicateConsole({ limite: 200 });

  let emailUtente = new Map<string, string>();
  const usate = new Map<string, Set<string>>();
  if (righe.length > 0) {
    try {
      const utenti = await inBlocchi<{ id: string; email: string }>([...new Set(righe.map((r) => r.user_id))], (b) => admin.from("users").select("id, email").in("id", b));
      emailUtente = new Map(utenti.map((u) => [u.id, u.email]));
      const piani = await admin
        .from("gara_piani_lavoro")
        .select("gara_id, concessione_id")
        .in("concessione_id", righe.map((r) => r.id))
        .in("stato", ["in_corso", "pronto"])
        .returns<{ gara_id: string; concessione_id: string }[]>();
      for (const p of piani.error ? [] : (piani.data ?? [])) {
        const gare = usate.get(p.concessione_id) ?? new Set<string>();
        gare.add(p.gara_id);
        usate.set(p.concessione_id, gare);
      }
    } catch (e) {
      console.error("Console: lettura dei clienti delle concessioni fallita", e instanceof Error ? e.message : e);
    }
  }

  return {
    modalitaStripe,
    interruttore: interpretaInterruttoreVenditaPianoLavoro(impostazioni.get(CHIAVE_VENDITA_PIANO_LAVORO)),
    prezzoSingoloCentesimi: prezzoSingolo,
    prezzoSingoloModificato: prezzoSingolo !== PREZZO_PIANO_LAVORO.predefinitoCentesimi,
    politicaProva: interpretaPoliticaProva(impostazioni.get(CHIAVE_POLITICA_PROVA)),
    pacchetti,
    // «di partenza» = nessun elenco salvato, o illeggibile: si vendono i pacchetti del codice
    pacchettiDiPartenza: !elencoSalvatoValido(salvato),
    pacchettiDisponibili,
    unitaResidue: saldiQ.error ? null : (saldiQ.data ?? []).reduce((somma, r) => somma + Math.max(0, Number(r.saldo) || 0), 0),
    concessioniDisponibili,
    offerte,
    concessioni: righe.map((r) => ({
      id: r.id,
      utente: emailUtente.get(r.user_id) ?? "(cliente non trovato)",
      tipo: r.tipo,
      garaTitolo: r.gara_titolo,
      gareMassime: r.gare_massime,
      gareUsate: usate.get(r.id)?.size ?? 0,
      scadeIl: r.scade_il,
      motivo: r.motivo,
      attiva: r.attiva,
      creataIl: r.creata_il,
      creataDa: r.creata_da_email,
      revocataIl: r.revocata_il,
      revocataDa: r.revocata_da_email,
    })),
  };
}

// Il cliente a cui dare una concessione, cercato per email: il titolare di un account OMNIA AI (non un Ufficio Gare) con le sue gare.
export type ClienteConcessione = { id: string; email: string; gare: { id: string; titolo: string }[] };
export type RicercaCliente = { stato: "trovato"; cliente: ClienteConcessione } | { stato: "non_trovato" } | { stato: "ufficio_gare" } | { stato: "errore" };

export async function cercaClientePerConcessione(emailRaw: string): Promise<RicercaCliente> {
  const email = emailRaw.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { stato: "non_trovato" };
  const admin = createAdminClient();
  const { data: utente, error } = await admin.from("users").select("id, email").eq("email", email).maybeSingle<{ id: string; email: string }>();
  if (error) {
    console.error("Console: ricerca del cliente per la concessione fallita", error.message);
    return { stato: "errore" };
  }
  if (!utente) return { stato: "non_trovato" };

  // un Ufficio Gare non è un titolare: la concessione va data al titolare, che è quello che ne ha il diritto
  const { data: membro, error: erroreMembro } = await admin.from("omnia_ai_membri").select("titolare_id").eq("membro_id", utente.id).maybeSingle<{ titolare_id: string }>();
  if (erroreMembro && !schemaAssente(erroreMembro)) {
    console.error("Console: verifica del ruolo del cliente fallita", erroreMembro.message);
    return { stato: "errore" };
  }
  if (membro) return { stato: "ufficio_gare" };

  const { data: gare, error: erroreGare } = await admin.from("gare").select("id, titolo").eq("user_id", utente.id).order("created_at", { ascending: false }).limit(200).returns<{ id: string; titolo: string }[]>();
  if (erroreGare) {
    console.error("Console: lettura delle gare del cliente fallita", erroreGare.message);
    return { stato: "errore" };
  }
  return { stato: "trovato", cliente: { id: utente.id, email: utente.email, gare: gare ?? [] } };
}
