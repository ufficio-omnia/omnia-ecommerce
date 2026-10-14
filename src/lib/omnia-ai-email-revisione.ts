import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { EMAIL_UFFICIO, inviaEmailEvento } from "@/lib/omnia-ai-email-eventi";
import { eseguiSenzaBloccare, leggiCliente, linkArea } from "@/lib/omnia-ai-email-webhook";
import { emailClienteRevisioneRicevuta, emailUfficioRevisioneUmana, type AziendaRevisione, type FatturazioneStripe } from "@/lib/omnia-ai-email-revisione-calcoli";
import type { FontePagine } from "@/lib/omnia-ai-revisione-calcoli";

// Le email di una revisione umana appena pagata: all'ufficio (con il Word della relazione in allegato)
// e la conferma al cliente. Chiamata dal webhook di Stripe; mai bloccante, mai doppia (registro delle
// email: stesse chiavi anche se Stripe rimanda l'evento).

export type RigaRevisione = {
  id: string;
  user_id: string | null;
  gara_id: string | null;
  gara_titolo: string;
  file_nome: string;
  file_path: string;
  pagine: number;
  pagine_fonte: FontePagine;
  prezzo_base_centesimi: number;
  maggiorazione_percentuale: number;
  prezzo_totale_centesimi: number;
  scadenza_gara: string | null;
  scadenza_ora: string | null;
  ore_alla_scadenza: number | null;
  referente_nome: string;
  referente_email: string;
  referente_cellulare: string;
  pagata_il: string | null;
  stripe_payment_intent_id: string | null;
  importo_pagato_centesimi: number | null;
};

const testo = (v: unknown): string | null => {
  const s = typeof v === "string" ? v.trim() : "";
  return s === "" ? null : s;
};
const numero = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

// I dati principali del profilo azienda, quali sono: lettura difensiva (la tabella ha molte colonne
// aggiunte nel tempo, e ciò che manca resta vuoto).
export function aziendaDaRiga(riga: Record<string, unknown> | null | undefined): AziendaRevisione | null {
  if (!riga) return null;
  return {
    ragioneSociale: testo(riga.ragione_sociale),
    formaGiuridica: testo(riga.forma_giuridica),
    partitaIva: testo(riga.partita_iva),
    codiceFiscale: testo(riga.codice_fiscale),
    indirizzo: testo(riga.indirizzo),
    codiceSdi: testo(riga.codice_sdi),
    pec: testo(riga.pec),
    numeroDipendenti: numero(riga.numero_dipendenti),
    fatturatoMedioAnnuo: numero(riga.fatturato_medio_annuo),
    certificazioni: testo(riga.certificazioni),
    settoriAttivita: testo(riga.settori_attivita),
    sitoWeb: testo(riga.sito_web),
    telefonoAziendale: testo(riga.telefono_aziendale),
    presentazione: testo(riga.presentazione),
    referenze: testo(riga.referenze),
  };
}

// I dati di fatturazione che Stripe ha raccolto nel pagamento.
export function fatturazioneDaSessione(sessione: Pick<Stripe.Checkout.Session, "customer_details"> | null | undefined): FatturazioneStripe | null {
  const d = sessione?.customer_details;
  if (!d) return null;
  const a = d.address;
  const indirizzo = a ? [a.line1, a.line2, [a.postal_code, a.city].filter(Boolean).join(" "), a.state, a.country].filter((x) => !!x && String(x).trim() !== "").join(", ") : "";
  return {
    nome: testo(d.name) ?? testo(d.business_name),
    email: testo(d.email),
    telefono: testo(d.phone),
    indirizzo: indirizzo || null,
    identificativiFiscali: (d.tax_ids ?? []).map((t) => (t.value ? `${t.type}: ${t.value}` : "")).filter(Boolean),
  };
}

export async function notificaRevisioneUmana({
  admin,
  livemode,
  eventoId,
  revisione,
  sessione,
  pagamentoDoppio = false,
}: {
  admin: SupabaseClient;
  livemode: boolean;
  eventoId: string | null;
  revisione: RigaRevisione;
  pagamentoDoppio?: boolean;
  sessione: Pick<Stripe.Checkout.Session, "customer_details" | "customer_email" | "amount_total"> | null;
}): Promise<void> {
  await eseguiSenzaBloccare("revisione umana", async () => {
    const cliente = await leggiCliente(admin, revisione.user_id, { email: sessione?.customer_details?.email ?? sessione?.customer_email });
    const { data: azienda } = revisione.user_id
      ? await admin.from("companies").select("*").eq("user_id", revisione.user_id).maybeSingle<Record<string, unknown>>()
      : { data: null };
    const importo = revisione.importo_pagato_centesimi ?? sessione?.amount_total ?? revisione.prezzo_totale_centesimi;
    const pagataIl = revisione.pagata_il ? new Date(revisione.pagata_il) : new Date();
    const referente = { nome: revisione.referente_nome, email: revisione.referente_email, cellulare: revisione.referente_cellulare };

    await inviaEmailEvento({
      admin,
      chiave: `rev:${revisione.id}:ufficio`,
      tipo: "revisione_umana_richiesta",
      destinatario: "ufficio",
      a: EMAIL_UFFICIO,
      email: emailUfficioRevisioneUmana({
        prova: !livemode,
        revisioneId: revisione.id,
        cliente,
        azienda: aziendaDaRiga(azienda),
        fatturazione: fatturazioneDaSessione(sessione),
        garaTitolo: revisione.gara_titolo,
        scadenza: revisione.scadenza_gara,
        scadenzaOra: revisione.scadenza_ora,
        oreAllaScadenza: revisione.ore_alla_scadenza,
        pagine: revisione.pagine,
        fontePagine: revisione.pagine_fonte,
        baseCentesimi: revisione.prezzo_base_centesimi,
        maggiorazionePercentuale: revisione.maggiorazione_percentuale,
        importoPagatoCentesimi: importo,
        pagataIl,
        referente,
        fileNome: revisione.file_nome,
        stripePaymentIntentId: revisione.stripe_payment_intent_id,
        pagamentoDoppio,
      }),
      livemode,
      userId: revisione.user_id,
      eventoStripeId: eventoId,
      allegato: { bucket: "gare", path: revisione.file_path, nome: revisione.file_nome },
    });

    if (cliente.email) {
      await inviaEmailEvento({
        admin,
        chiave: `rev:${revisione.id}:cliente`,
        tipo: "revisione_umana_ricevuta",
        destinatario: "cliente",
        a: cliente.email,
        email: emailClienteRevisioneRicevuta({
          prova: !livemode,
          garaTitolo: revisione.gara_titolo,
          importoCentesimi: importo,
          maggiorazionePercentuale: revisione.maggiorazione_percentuale,
          pagataIl,
          referente,
          linkGara: linkArea(revisione.gara_id ? `/dashboard/omnia-ai/gare/${revisione.gara_id}` : "/dashboard/omnia-ai/gare"),
        }),
        livemode,
        userId: revisione.user_id,
        eventoStripeId: eventoId,
      });
    } else {
      console.error("Email evento (revisione umana): email del cliente non disponibile, conferma non inviata", revisione.id);
    }
  });
}
