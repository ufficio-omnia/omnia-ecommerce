import { createAdminClient } from "@/lib/supabase/admin";
import { createStripeClient } from "@/lib/stripe";
import { schemaAssente } from "@/lib/omnia-ai-incassi";
import { PIANI, PIANI_ORDINE, type PianoSlug } from "@/lib/omnia-ai-plans";
import { getStripePrezzoAttivo } from "@/lib/omnia-ai-stripe-prices";
import { COLONNE_SCONTO, scontoDaRiga } from "@/lib/omnia-ai-catalogo";
import { giornoRoma, scontoMigliore, statoSconto, type ScontoApplicato, type Sconto, type StatoSconto } from "@/lib/omnia-ai-catalogo-calcoli";

// Letture per la pagina «Piani e prezzi» della console (migrazione 0085): prezzo di listino di
// ogni piano, se coincide con quello attivo su Stripe, sconti con il loro stato e storico delle
// modifiche. Prima della migrazione le tabelle non ci sono: `disponibile: false` e valgono i
// prezzi del codice.

export type StatoStripePiano =
  | { stato: "allineato"; importoCentesimi: number }
  | { stato: "disallineato"; importoCentesimi: number }
  | { stato: "assente" }
  | { stato: "errore" };

export type PianoConsole = {
  slug: PianoSlug;
  nome: string;
  gareIncluse: number;
  listinoCentesimi: number;
  // il prezzo viene da una modifica fatta in console (altrimenti è quello del codice)
  modificato: boolean;
  aggiornatoIl: string | null;
  aggiornatoDa: string | null;
  stripe: StatoStripePiano;
  sconto: ScontoApplicato | null;
};

export type ScontoConsole = Sconto & { stato: StatoSconto; creatoIl: string; creatoDa: string };

export type ModificaPrezzo = { piano: PianoSlug; precedenteCentesimi: number | null; nuovoCentesimi: number; operatore: string; il: string };

export type DatiPrezzi = {
  disponibile: boolean;
  // chiave Stripe di prova o reale: i prezzi creati da qui vanno su QUELL'account
  modalitaStripe: "prova" | "reale" | "sconosciuta";
  piani: PianoConsole[];
  sconti: ScontoConsole[];
  storico: ModificaPrezzo[];
};

function modalita(chiave: string | undefined): DatiPrezzi["modalitaStripe"] {
  if (!chiave) return "sconosciuta";
  if (/^(sk|rk)_test_/.test(chiave)) return "prova";
  if (/^(sk|rk)_live_/.test(chiave)) return "reale";
  return "sconosciuta";
}

export async function leggiPrezziConsole(): Promise<DatiPrezzi> {
  const admin = createAdminClient();
  const oggi = giornoRoma(new Date());

  const [prezzi, sconti, storico] = await Promise.all([
    admin.from("omnia_ai_prezzi_piani").select("piano, prezzo_centesimi, aggiornato_il, aggiornato_da_email").returns<{ piano: string; prezzo_centesimi: number; aggiornato_il: string; aggiornato_da_email: string }[]>(),
    admin
      .from("omnia_ai_sconti")
      .select(`${COLONNE_SCONTO}, creato_il, creato_da_email`)
      .order("creato_il", { ascending: false })
      .limit(100)
      .returns<(Parameters<typeof scontoDaRiga>[0] & { creato_il: string; creato_da_email: string })[]>(),
    admin
      .from("omnia_ai_prezzi_piani_storico")
      .select("piano, prezzo_precedente_centesimi, prezzo_nuovo_centesimi, operatore_email, created_at")
      .order("created_at", { ascending: false })
      .limit(30)
      .returns<{ piano: string; prezzo_precedente_centesimi: number | null; prezzo_nuovo_centesimi: number; operatore_email: string; created_at: string }[]>(),
  ]);

  const disponibile = ![prezzi, sconti, storico].some((q) => q.error && schemaAssente(q.error));
  for (const [nome, q] of [["prezzi", prezzi], ["sconti", sconti], ["storico", storico]] as const) {
    if (q.error && !schemaAssente(q.error)) console.error(`Console: lettura ${nome} dei piani fallita`, q.error.message);
  }

  const righePrezzi = new Map((prezzi.data ?? []).map((r) => [r.piano, r]));
  const scontiLetti: ScontoConsole[] = (sconti.data ?? []).flatMap((r) => {
    const s = scontoDaRiga(r);
    return s ? [{ ...s, stato: statoSconto(s, oggi), creatoIl: r.creato_il, creatoDa: r.creato_da_email }] : [];
  });

  const chiave = process.env.STRIPE_SECRET_KEY_OMNIA_AI;
  const stripe = chiave ? createStripeClient("omnia-ai") : null;

  const piani: PianoConsole[] = await Promise.all(
    PIANI_ORDINE.map(async (slug) => {
      const base = PIANI[slug];
      const riga = righePrezzi.get(slug);
      const listino = riga?.prezzo_centesimi ?? base.prezzoCentesimi;

      let statoStripe: StatoStripePiano = { stato: "errore" };
      if (stripe) {
        try {
          const prezzo = await getStripePrezzoAttivo(stripe, slug);
          const importo = prezzo.unit_amount ?? 0;
          statoStripe = { stato: importo === listino ? "allineato" : "disallineato", importoCentesimi: importo };
        } catch (e) {
          statoStripe = /Nessun prezzo Stripe attivo/.test(e instanceof Error ? e.message : "") ? { stato: "assente" } : { stato: "errore" };
          if (statoStripe.stato === "errore") console.error("Console: lettura del prezzo Stripe fallita", slug, e instanceof Error ? e.message : e);
        }
      }

      return {
        slug,
        nome: base.nome,
        gareIncluse: base.gareIncluse,
        listinoCentesimi: listino,
        modificato: Boolean(riga),
        aggiornatoIl: riga?.aggiornato_il ?? null,
        aggiornatoDa: riga?.aggiornato_da_email ?? null,
        stripe: statoStripe,
        sconto: scontoMigliore(slug, listino, scontiLetti, oggi),
      };
    }),
  );

  return {
    disponibile,
    modalitaStripe: modalita(chiave),
    piani,
    sconti: scontiLetti,
    storico: (storico.data ?? []).flatMap((r) =>
      PIANI_ORDINE.includes(r.piano as PianoSlug) ? [{ piano: r.piano as PianoSlug, precedenteCentesimi: r.prezzo_precedente_centesimi, nuovoCentesimi: r.prezzo_nuovo_centesimi, operatore: r.operatore_email, il: r.created_at }] : [],
    ),
  };
}
