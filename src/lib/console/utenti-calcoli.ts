import { PIANI, normalizzaPianoSlug } from "@/lib/omnia-ai-plans";
import { statoAbbonamento, type StatoAbbonamento } from "./abbonamenti-calcoli";
import type { AbbonamentoRiga } from "./costi-calcoli";

// Calcoli puri (nessun database) per la pagina Utenti e la scheda cliente.
//
// COSA SI VEDE. Per ogni utente: ordini dell'e-commerce, abbonamento OMNIA AI,
// crediti, messaggi e, soprattutto, le ACCETTAZIONI LEGALI registrate: ogni
// ordine deve averne (condizioni di vendita e privacy accettate dal cliente,
// con data, ora, IP e versione del documento) e ogni abbonamento AI pure. Un
// ordine o un abbonamento senza accettazioni NON si nasconde: si segnala, perché
// vuol dire che precede la registrazione delle prove (migrazioni 0033 e 0057) o
// che è stato creato a mano.

export const ETICHETTA_DOCUMENTO: Record<string, string> = {
  privacy_policy: "Privacy policy",
  cookie_policy: "Cookie policy",
  condizioni_vendita: "Condizioni generali di vendita",
  omnia_ai_privacy_policy: "Privacy policy OMNIA AI",
  omnia_ai_cookie_policy: "Cookie policy OMNIA AI",
  omnia_ai_condizioni_abbonamento: "Condizioni di abbonamento OMNIA AI",
  omnia_ai_allegato_a: "Allegato A — nomina a responsabile del trattamento",
};

export const ETICHETTA_ACCETTAZIONE: Record<string, string> = {
  condizioni_e_privacy: "Condizioni e privacy",
  esecuzione_immediata_recesso: "Esecuzione immediata (rinuncia al recesso)",
  clausole_specifiche: "Clausole specifiche (approvazione espressa)",
};

export function etichettaDocumento(tipo: string): string {
  return ETICHETTA_DOCUMENTO[tipo] ?? tipo;
}

export function etichettaAccettazione(tipo: string): string {
  return ETICHETTA_ACCETTAZIONE[tipo] ?? tipo;
}

// L'anonimizzazione (src/app/site-console/azioni/utenti.ts) sostituisce l'email con
// un indirizzo del dominio riservato ".invalid".
export function eAnonimizzato(email: string | null): boolean {
  return Boolean(email && /^cliente-anonimizzato-.+@omniaitalia\.invalid$/.test(email));
}

// ───── Abbonamenti Stripe da annullare prima di eliminare o anonimizzare ─────
//
// Eliminare o anonimizzare un utente dal database NON annulla il suo abbonamento su
// Stripe: se è vero (live) il cliente continuerebbe a essere addebitato. La console non
// chiama Stripe: rifiuta, e l'abbonamento si annulla da Stripe.
//
// Blocca ogni riga con un abbonamento Stripe, di cui non si sa che sia di PROVA
// (livemode diverso da false: vero, oppure nullo = sconosciuto), e non annullata. Quelle
// di prova non bloccano. Lo stato nel database può essere indietro rispetto a Stripe
// (es. un «scaduto» con un pagamento in nuovo tentativo): solo «annullato» sblocca,
// ogni altro stato blocca, e nel dubbio si rifiuta.
export type AbbonamentoDaControllare = { plan: string; status: string; stripe_subscription_id: string | null; livemode: boolean | null };

export function abbonamentiDaAnnullareSuStripe<T extends AbbonamentoDaControllare>(righe: T[]): T[] {
  return righe.filter((r) => Boolean(r.stripe_subscription_id) && r.livemode !== false && r.status !== "annullato");
}

// Il messaggio per l'admin: quale piano e dove si annulla. `verbo` è l'azione rifiutata
// all'infinito («eliminare», «anonimizzare»).
export function messaggioAbbonamentoDaAnnullare(righe: AbbonamentoDaControllare[], verbo: string): string {
  const piani = righe.map((r) => {
    const slug = normalizzaPianoSlug(r.plan);
    return slug ? `«${PIANI[slug].nome}»` : `«${r.plan}»`;
  });
  const elenco = [...new Set(piani)].join(", ");
  const soggetto = righe.length === 1 ? `ha un abbonamento OMNIA AI ${elenco} non annullato` : `ha ${righe.length} abbonamenti OMNIA AI non annullati (${elenco})`;
  return `Questo cliente ${soggetto} su Stripe: annullalo prima da Stripe, poi potrai ${verbo} l'account. Altrimenti il cliente continuerebbe a essere addebitato. L'account non è stato toccato.`;
}

// ───── Elenco ─────

export type UtenteDb = { id: string; email: string; role: string; created_at: string };
export type AziendaUtenteDb = { user_id: string; ragione_sociale: string | null; partita_iva: string | null; codice_fiscale: string | null; buyer_type: string | null };
export type OrdineUtenteDb = { id: string; user_id: string; status: string; total_amount: number | string; created_at: string };
export type AbbonamentoUtenteDb = AbbonamentoRiga & { id: string; user_id: string; livemode: boolean | null };
export type MessaggioDb = { user_id: string; sender: string; created_at: string };
export type AccessoUtente = { ultimoAccesso: string | null; bannato: boolean };

export type DatiElencoUtenti = {
  utenti: UtenteDb[];
  aziende: AziendaUtenteDb[];
  ordini: OrdineUtenteDb[];
  // id degli ordini che hanno almeno una accettazione registrata
  ordiniConAccettazioni: Set<string>;
  abbonamenti: AbbonamentoUtenteDb[];
  // id degli abbonamenti che hanno almeno una accettazione registrata
  abbonamentiConAccettazioni: Set<string>;
  crediti: { user_id: string; balance: number }[];
  messaggi: MessaggioDb[];
  accessi: Map<string, AccessoUtente>;
};

export type RigaUtente = {
  id: string;
  email: string;
  ruolo: string;
  registratoIl: string;
  ultimoAccesso: string | null;
  bannato: boolean;
  anonimizzato: boolean;
  azienda: string | null;
  tipoCliente: "azienda" | "consumatore" | null;
  ordini: { totale: number; pagati: number; pagatoLordo: number; senzaAccettazioni: number };
  abbonamento: null | {
    piano: string;
    stato: StatoAbbonamento;
    inDisdetta: boolean;
    // l'ultima riga è creata a mano: nessun abbonamento Stripe
    manuale: boolean;
    prova: boolean;
    righe: number;
  };
  // righe di abbonamento con Stripe e senza accettazioni
  abbonamentiSenzaAccettazioni: number;
  saldoCrediti: number;
  // ordini + abbonamenti senza prova di accettazione
  accettazioniMancanti: number;
  // l'ultimo messaggio della conversazione è del cliente
  daRispondere: boolean;
};

export function costruisciRigheUtenti(dati: DatiElencoUtenti, adesso: Date): RigaUtente[] {
  const aziende = new Map(dati.aziende.map((a) => [a.user_id, a]));
  const saldi = new Map(dati.crediti.map((c) => [c.user_id, c.balance]));

  const ordiniPerUtente = new Map<string, OrdineUtenteDb[]>();
  for (const o of dati.ordini) ordiniPerUtente.set(o.user_id, [...(ordiniPerUtente.get(o.user_id) ?? []), o]);

  const abbPerUtente = new Map<string, AbbonamentoUtenteDb[]>();
  for (const a of dati.abbonamenti) abbPerUtente.set(a.user_id, [...(abbPerUtente.get(a.user_id) ?? []), a]);

  // ultimo messaggio di ogni conversazione
  const ultimoMessaggio = new Map<string, MessaggioDb>();
  for (const m of dati.messaggi) {
    const attuale = ultimoMessaggio.get(m.user_id);
    if (!attuale || m.created_at > attuale.created_at) ultimoMessaggio.set(m.user_id, m);
  }

  return dati.utenti.map((u) => {
    const ordini = ordiniPerUtente.get(u.id) ?? [];
    const pagati = ordini.filter((o) => o.status === "pagato");
    const abbonamenti = [...(abbPerUtente.get(u.id) ?? [])].sort((a, b) => a.created_at.localeCompare(b.created_at));
    const ultima = abbonamenti[abbonamenti.length - 1];
    const azienda = aziende.get(u.id);
    const accesso = dati.accessi.get(u.id);

    const ordiniSenza = ordini.filter((o) => !dati.ordiniConAccettazioni.has(o.id)).length;
    // un abbonamento creato a mano non ha un checkout, quindi nessuna accettazione da cercare
    const abbSenza = abbonamenti.filter((a) => a.stripe_subscription_id && !dati.abbonamentiConAccettazioni.has(a.id)).length;
    const piano = ultima ? normalizzaPianoSlug(ultima.plan) : null;

    return {
      id: u.id,
      email: u.email,
      ruolo: u.role,
      registratoIl: u.created_at,
      ultimoAccesso: accesso?.ultimoAccesso ?? null,
      bannato: accesso?.bannato ?? false,
      anonimizzato: eAnonimizzato(u.email),
      azienda: azienda?.ragione_sociale ?? null,
      tipoCliente: azienda?.buyer_type === "consumatore" ? "consumatore" : azienda?.buyer_type === "azienda" ? "azienda" : null,
      ordini: {
        totale: ordini.length,
        pagati: pagati.length,
        pagatoLordo: pagati.reduce((s, o) => s + Number(o.total_amount), 0),
        senzaAccettazioni: ordiniSenza,
      },
      abbonamento: ultima
        ? {
            piano: piano ?? ultima.plan,
            stato: statoAbbonamento(ultima, adesso).stato,
            inDisdetta: statoAbbonamento(ultima, adesso).stato === "attivo" && Boolean(ultima.cancel_at_period_end),
            manuale: !ultima.stripe_subscription_id,
            prova: ultima.livemode === false,
            righe: abbonamenti.length,
          }
        : null,
      abbonamentiSenzaAccettazioni: abbSenza,
      saldoCrediti: saldi.get(u.id) ?? 0,
      accettazioniMancanti: ordiniSenza + abbSenza,
      daRispondere: ultimoMessaggio.get(u.id)?.sender === "cliente",
    };
  });
}

export type TipoUtente = "tutti" | "ecommerce" | "omnia_ai" | "da_rispondere" | "senza_accettazioni" | "admin" | "senza_attivita";

export const TIPI_UTENTE: { valore: TipoUtente; etichetta: string }[] = [
  { valore: "tutti", etichetta: "Tutti" },
  { valore: "ecommerce", etichetta: "Con ordini" },
  { valore: "omnia_ai", etichetta: "Con abbonamento AI" },
  { valore: "da_rispondere", etichetta: "Da rispondere" },
  { valore: "senza_accettazioni", etichetta: "Senza accettazioni" },
  { valore: "senza_attivita", etichetta: "Senza attività" },
  { valore: "admin", etichetta: "Admin" },
];

export function leggiTipoUtente(valore: string | undefined): TipoUtente {
  return TIPI_UTENTE.some((t) => t.valore === valore) ? (valore as TipoUtente) : "tutti";
}

const corrisponde: Record<TipoUtente, (r: RigaUtente) => boolean> = {
  tutti: () => true,
  ecommerce: (r) => r.ordini.totale > 0,
  omnia_ai: (r) => r.abbonamento !== null,
  da_rispondere: (r) => r.daRispondere,
  senza_accettazioni: (r) => r.accettazioniMancanti > 0,
  senza_attivita: (r) => r.ordini.totale === 0 && r.abbonamento === null && r.ruolo !== "admin",
  admin: (r) => r.ruolo === "admin",
};

export function conteggiPerTipo(righe: RigaUtente[]): Record<TipoUtente, number> {
  const conteggi = {} as Record<TipoUtente, number>;
  for (const t of TIPI_UTENTE) conteggi[t.valore] = righe.filter(corrisponde[t.valore]).length;
  return conteggi;
}

// Ricerca per testo (email, ragione sociale, id) e per tipo.
export function filtraUtenti(righe: RigaUtente[], tipo: TipoUtente, testo: string): RigaUtente[] {
  const cerca = testo.trim().toLowerCase();
  return righe.filter((r) => {
    if (!corrisponde[tipo](r)) return false;
    if (!cerca) return true;
    return r.email.toLowerCase().includes(cerca) || (r.azienda ?? "").toLowerCase().includes(cerca) || r.id.toLowerCase().startsWith(cerca);
  });
}

export type OrdineUtenti = "registrazione" | "accesso" | "email";

export function leggiOrdineUtenti(valore: string | undefined): OrdineUtenti {
  return valore === "accesso" || valore === "email" ? valore : "registrazione";
}

// registrazione e accesso: dal più recente (chi non ha mai acceduto in fondo); email: alfabetico.
export function ordinaUtenti(righe: RigaUtente[], ordine: OrdineUtenti): RigaUtente[] {
  const confronta = (a: RigaUtente, b: RigaUtente): number => {
    if (ordine === "email") return a.email.localeCompare(b.email, "it");
    if (ordine === "accesso") return (b.ultimoAccesso ?? "").localeCompare(a.ultimoAccesso ?? "") || b.registratoIl.localeCompare(a.registratoIl);
    return b.registratoIl.localeCompare(a.registratoIl);
  };
  return [...righe].sort(confronta);
}

// ───── Scheda: accettazioni ───

export type AccettazioneScheda = {
  tipo: string;
  quando: string;
  ip: string | null;
  userAgent: string | null;
  documento: { tipo: string; versione: number; sha256: string; inVigoreDal: string } | null;
};

export type StatoProva = "registrata" | "mancante" | "non_prevista";

// L'ordine deve sempre avere accettazioni. Un abbonamento con Stripe pure; uno
// creato a mano non ha un checkout e quindi non ne ha: «non prevista», non «mancante».
export function statoProvaOrdine(accettazioni: AccettazioneScheda[]): StatoProva {
  return accettazioni.length > 0 ? "registrata" : "mancante";
}

export function statoProvaAbbonamento(manuale: boolean, accettazioni: AccettazioneScheda[]): StatoProva {
  if (accettazioni.length > 0) return "registrata";
  return manuale ? "non_prevista" : "mancante";
}

// Un paragrafo per ogni accettazione, in una riga: serve alla copia/CSV e ai test.
export function descriviAccettazione(a: AccettazioneScheda): string {
  const doc = a.documento ? `${etichettaDocumento(a.documento.tipo)} v${a.documento.versione}` : "documento non trovato";
  return `${etichettaAccettazione(a.tipo)} · ${doc}`;
}
