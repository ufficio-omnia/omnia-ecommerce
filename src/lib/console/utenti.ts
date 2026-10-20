import { cache } from "react";
import { createAdminClient } from "@/lib/supabase/admin";
import { schemaAssente } from "@/lib/omnia-ai-incassi";
import { statoAbbonamento, type StatoAbbonamento } from "./abbonamenti-calcoli";
import { normalizzaPianoSlug } from "@/lib/omnia-ai-plans";
import { leggiLegameUfficioGare, type LegameUfficioGare } from "./ufficio-gare";
import { leggiPresenze } from "./presenza";
import {
  costruisciRigheUtenti,
  statoProvaAbbonamento,
  statoProvaOrdine,
  type AbbonamentoUtenteDb,
  type AccessoUtente,
  type AccettazioneScheda,
  type AziendaUtenteDb,
  type MembroDb,
  type MessaggioDb,
  type OrdineUtenteDb,
  type RigaUtente,
  type StatoProva,
  type UtenteDb,
} from "./utenti-calcoli";

// Lettura dei dati per la pagina Utenti e la scheda cliente. Tutto con la service
// role: da chiamare solo dopo richiediAdminPagina() / richiediAdminAzione().

const LIMITE = 5000;
const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

type Risposta = { data: unknown; error: { code?: string; message: string } | null };

// ───── Accessi: ultimo accesso e blocco, da Supabase Auth ─────

// L'ultimo accesso sta in auth.users, non in public.users: si legge dall'API di
// amministrazione di Supabase (a pagine di 1000). Se non riesce, l'elenco funziona
// lo stesso e la colonna «Ultimo accesso» resta vuota.
export async function leggiAccessiUtenti(): Promise<{ accessi: Map<string, AccessoUtente>; disponibili: boolean }> {
  const admin = createAdminClient();
  const accessi = new Map<string, AccessoUtente>();
  const adesso = Date.now();
  try {
    for (let pagina = 1; pagina <= 10; pagina++) {
      const { data, error } = await admin.auth.admin.listUsers({ page: pagina, perPage: 1000 });
      if (error) throw error;
      for (const u of data.users) {
        accessi.set(u.id, {
          ultimoAccesso: u.last_sign_in_at ?? null,
          bannato: Boolean(u.banned_until && new Date(u.banned_until).getTime() > adesso),
        });
      }
      if (data.users.length < 1000) break;
    }
    return { accessi, disponibili: true };
  } catch (e) {
    console.error("Console: lettura degli accessi degli utenti fallita", e);
    return { accessi: new Map(), disponibili: false };
  }
}

// ───── Elenco ─────

export type ElencoUtentiLetto =
  | { stato: "errore"; messaggio: string }
  | { stato: "ok"; righe: RigaUtente[]; accessiDisponibili: boolean; presenzaDisponibile: boolean };

export async function leggiElencoUtenti(): Promise<ElencoUtentiLetto> {
  const admin = createAdminClient();
  const baseAbbonamenti = "id, user_id, plan, status, stripe_subscription_id, created_at, current_period_end, cancel_at_period_end";

  let abbonamentiQ: Risposta = await admin.from("subscriptions").select(`${baseAbbonamenti}, livemode`).limit(LIMITE);
  if (schemaAssente(abbonamentiQ.error)) abbonamentiQ = await admin.from("subscriptions").select(baseAbbonamenti).limit(LIMITE);

  // Uffici Gare (migrazione 0092): se la tabella non c'è ancora, nessun utente è un Ufficio Gare.
  const membriQ: Risposta = await admin.from("omnia_ai_membri").select("membro_id, titolare_id, attivo").limit(LIMITE);
  const membriLetti = membriQ.error && !schemaAssente(membriQ.error) ? null : ((membriQ.data ?? []) as MembroDb[]);
  if (membriLetti === null) console.error("Console: lettura degli Uffici Gare fallita", membriQ.error?.message);

  const [utentiQ, aziendeQ, ordiniQ, accOrdiniQ, accAbbQ, creditiQ, messaggiQ, accessi, presenze] = await Promise.all([
    admin.from("users").select("id, email, role, created_at").order("created_at", { ascending: false }).limit(LIMITE),
    admin.from("companies").select("user_id, ragione_sociale, partita_iva, codice_fiscale, buyer_type").limit(LIMITE),
    admin.from("orders").select("id, user_id, status, total_amount, created_at").limit(LIMITE),
    admin.from("legal_acceptances").select("order_id").limit(20000),
    admin.from("omnia_ai_legal_acceptances").select("subscription_id").limit(20000),
    admin.from("credits").select("user_id, balance").limit(LIMITE),
    admin.from("messages").select("user_id, sender, created_at").order("created_at", { ascending: false }).limit(20000),
    leggiAccessiUtenti(),
    // Presenza (migrazione 0094): se la tabella non c'è, l'elenco funziona lo stesso e nessuno risulta mai visto in linea.
    leggiPresenze(),
  ]);

  for (const [nome, q] of [["utenti", utentiQ], ["aziende", aziendeQ], ["ordini", ordiniQ], ["accettazioni degli ordini", accOrdiniQ], ["abbonamenti", abbonamentiQ], ["accettazioni degli abbonamenti", accAbbQ], ["crediti", creditiQ], ["messaggi", messaggiQ]] as const) {
    if (q.error) {
      console.error(`Console: lettura ${nome} fallita`, q.error.message);
      return { stato: "errore", messaggio: `Lettura dei dati non riuscita (${nome}).` };
    }
  }

  const righe = costruisciRigheUtenti(
    {
      utenti: (utentiQ.data ?? []) as UtenteDb[],
      aziende: (aziendeQ.data ?? []) as AziendaUtenteDb[],
      ordini: (ordiniQ.data ?? []) as OrdineUtenteDb[],
      ordiniConAccettazioni: new Set(((accOrdiniQ.data ?? []) as { order_id: string }[]).map((a) => a.order_id)),
      abbonamenti: ((abbonamentiQ.data ?? []) as Partial<AbbonamentoUtenteDb>[]).map((a) => ({ ...a, livemode: a.livemode ?? null })) as AbbonamentoUtenteDb[],
      abbonamentiConAccettazioni: new Set(((accAbbQ.data ?? []) as { subscription_id: string }[]).map((a) => a.subscription_id)),
      crediti: ((creditiQ.data ?? []) as { user_id: string; balance: number }[]).map((c) => ({ user_id: c.user_id, balance: num(c.balance) })),
      messaggi: (messaggiQ.data ?? []) as MessaggioDb[],
      accessi: accessi.accessi,
      membri: membriLetti ?? [],
      presenze: presenze.righe,
    },
    new Date(),
  );

  return { stato: "ok", righe, accessiDisponibili: accessi.disponibili, presenzaDisponibile: presenze.disponibile };
}

// Quante conversazioni aspettano una risposta (l'ultimo messaggio è del cliente):
// serve alla barra laterale, da qualunque pagina. null se non si riesce a leggere.
export const contaMessaggiDaRispondere = cache(async (): Promise<number | null> => {
  const { data, error } = await createAdminClient().from("messages").select("user_id, sender, created_at").order("created_at", { ascending: false }).limit(20000);
  if (error) return null;
  const ultimo = new Map<string, string>();
  for (const m of (data ?? []) as MessaggioDb[]) if (!ultimo.has(m.user_id)) ultimo.set(m.user_id, m.sender);
  return [...ultimo.values()].filter((sender) => sender === "cliente").length;
});

// ───── Scheda cliente ─────

export type OrdineScheda = {
  id: string;
  prodotto: string | null;
  stato: string;
  metodo: string | null;
  importo: number;
  creatoIl: string;
  pagatoIl: string | null;
  fatturaCaricata: boolean;
  accettazioni: AccettazioneScheda[];
  provaAccettazione: StatoProva;
};

export type AbbonamentoScheda = {
  id: string;
  piano: string;
  statoDb: string;
  stato: StatoAbbonamento;
  manuale: boolean;
  prova: boolean;
  stripeId: string | null;
  creatoIl: string;
  finePeriodo: string | null;
  inDisdetta: boolean;
  disdettaRichiestaIl: string | null;
  accettazioni: AccettazioneScheda[];
  provaAccettazione: StatoProva;
};

export type IncassoScheda = { id: string; data: string; tipo: string; lordo: number; prova: boolean; statoFattura: string | null; numeroFattura: string | null };
export type AcquistoCreditiScheda = { id: string; data: string; pacchetto: string; crediti: number; lordo: number; prova: boolean; statoFattura: string | null };
export type RevisioneScheda = { id: string; data: string; garaTitolo: string; pagine: number; lordo: number; maggiorazione: number; prova: boolean; statoFattura: string | null; numeroFattura: string | null };
export type MessaggioScheda = { id: string; mittente: "cliente" | "admin"; testo: string; creatoIl: string };

export type ProfiloScheda = {
  ragione_sociale: string | null;
  partita_iva: string | null;
  codice_fiscale: string | null;
  indirizzo: string | null;
  codice_sdi: string | null;
  pec: string | null;
  buyer_type: string | null;
};

export type SchedaCliente =
  | { stato: "non_trovato" }
  | { stato: "errore"; messaggio: string }
  | {
      stato: "ok";
      utente: { id: string; email: string; ruolo: string; registratoIl: string };
      accesso: { ultimoAccesso: string | null; bannato: boolean; emailConfermataIl: string | null };
      azienda: ProfiloScheda | null;
      ordini: OrdineScheda[];
      abbonamenti: AbbonamentoScheda[];
      saldoCrediti: number;
      acquistiCrediti: AcquistoCreditiScheda[];
      // revisioni umane pagate (migrazione 0089)
      revisioni: RevisioneScheda[];
      incassi: IncassoScheda[];
      messaggi: MessaggioScheda[];
      // la tabella degli incassi / le colonne di stato fattura esistono (migrazioni 0078, 0079)
      incassiDisponibili: boolean;
      // l'ultimo abbonamento è gestito da Stripe: il modulo manuale non vale
      abbonamentoGestitoDaStripe: boolean;
      // Ufficio Gare (migrazione 0092): se questo utente è il titolare che ne ha uno, o è lui stesso un Ufficio Gare
      legameUfficioGare: LegameUfficioGare | null;
      // la lettura del legame non è riuscita (la scheda lo dice, senza far credere che non ce ne sia uno)
      legameUfficioGareNonLetto: boolean;
    };

type AccettazioneDb = {
  order_id?: string;
  subscription_id?: string;
  acceptance_type: string;
  accepted_at: string;
  ip_address: string | null;
  user_agent: string | null;
  legal_document_id: string;
};

type DocumentoDb = { id: string; document_type: string; version: number; effective_date: string; sha256: string };

function costruisciAccettazioni(righe: AccettazioneDb[], chiave: "order_id" | "subscription_id", documenti: Map<string, DocumentoDb>): Map<string, AccettazioneScheda[]> {
  const perChiave = new Map<string, AccettazioneScheda[]>();
  for (const a of [...righe].sort((x, y) => x.accepted_at.localeCompare(y.accepted_at))) {
    const id = a[chiave];
    if (!id) continue;
    const doc = documenti.get(a.legal_document_id);
    const voce: AccettazioneScheda = {
      tipo: a.acceptance_type,
      quando: a.accepted_at,
      ip: a.ip_address,
      userAgent: a.user_agent,
      documento: doc ? { tipo: doc.document_type, versione: doc.version, sha256: doc.sha256, inVigoreDal: doc.effective_date } : null,
    };
    perChiave.set(id, [...(perChiave.get(id) ?? []), voce]);
  }
  return perChiave;
}

export async function leggiScheda(id: string): Promise<SchedaCliente> {
  const admin = createAdminClient();

  const { data: utente, error: erroreUtente } = await admin.from("users").select("id, email, role, created_at").eq("id", id).maybeSingle<UtenteDb>();
  if (erroreUtente) {
    console.error("Console: lettura utente fallita", erroreUtente.message);
    return { stato: "errore", messaggio: "Lettura dell'utente non riuscita." };
  }
  if (!utente) return { stato: "non_trovato" };

  // Con e senza le colonne introdotte dalle migrazioni più recenti (0075, 0078, 0079).
  let ordiniQ: Risposta = await admin
    .from("orders")
    .select("id, status, payment_method, total_amount, created_at, paid_at, products(title), invoices(id)")
    .eq("user_id", id)
    .order("created_at", { ascending: false });
  if (schemaAssente(ordiniQ.error)) {
    ordiniQ = await admin.from("orders").select("id, status, payment_method, total_amount, created_at, products(title), invoices(id)").eq("user_id", id).order("created_at", { ascending: false });
  }

  const baseSub = "id, plan, status, stripe_subscription_id, created_at, current_period_end, cancel_at_period_end";
  let subQ: Risposta = await admin.from("subscriptions").select(`${baseSub}, livemode, disdetta_richiesta_il`).eq("user_id", id).order("created_at", { ascending: false });
  if (schemaAssente(subQ.error)) subQ = await admin.from("subscriptions").select(baseSub).eq("user_id", id).order("created_at", { ascending: false });

  let incassiQ: Risposta = await admin
    .from("omnia_ai_incassi")
    .select("id, tipo, importo_lordo_centesimi, pagato_il, livemode, stato_fattura, numero_fattura")
    .eq("user_id", id)
    .order("pagato_il", { ascending: false })
    .limit(100);
  if (schemaAssente(incassiQ.error) && incassiQ.error?.code !== "PGRST205" && incassiQ.error?.code !== "42P01") {
    incassiQ = await admin.from("omnia_ai_incassi").select("id, tipo, importo_lordo_centesimi, pagato_il, livemode").eq("user_id", id).order("pagato_il", { ascending: false }).limit(100);
  }

  let creditiAcqQ: Risposta = await admin
    .from("omnia_ai_credit_purchases")
    .select("id, pacchetto, crediti, importo_centesimi, stripe_session_id, created_at, stato_fattura")
    .eq("user_id", id)
    .order("created_at", { ascending: false });
  if (schemaAssente(creditiAcqQ.error)) {
    creditiAcqQ = await admin.from("omnia_ai_credit_purchases").select("id, pacchetto, crediti, importo_centesimi, stripe_session_id, created_at").eq("user_id", id).order("created_at", { ascending: false });
  }

  // Revisioni umane pagate del cliente: senza la tabella (migrazione 0089) non ce ne sono.
  const revisioniQ: Risposta = await admin
    .from("omnia_ai_revisioni")
    .select("id, gara_titolo, pagine, maggiorazione_percentuale, prezzo_totale_centesimi, importo_pagato_centesimi, pagata_il, livemode, stato_fattura, numero_fattura")
    .eq("user_id", id)
    .eq("stato", "pagata")
    .order("pagata_il", { ascending: false });

  const [authUtente, aziendaQ, saldoQ, messaggiQ, documentiQ] = await Promise.all([
    admin.auth.admin.getUserById(id),
    admin.from("companies").select("ragione_sociale, partita_iva, codice_fiscale, indirizzo, codice_sdi, pec, buyer_type").eq("user_id", id).maybeSingle<ProfiloScheda>(),
    admin.from("credits").select("balance").eq("user_id", id).maybeSingle<{ balance: number }>(),
    admin.from("messages").select("id, sender, body, created_at").eq("user_id", id).order("created_at", { ascending: true }),
    admin.from("legal_documents").select("id, document_type, version, effective_date, sha256"),
  ]);

  for (const [nome, q] of [["ordini", ordiniQ], ["abbonamenti", subQ], ["acquisti di crediti", creditiAcqQ], ["messaggi", messaggiQ], ["documenti legali", documentiQ], ["azienda", aziendaQ], ["crediti", saldoQ]] as const) {
    if (q.error) {
      console.error(`Console: lettura ${nome} del cliente fallita`, q.error.message);
      return { stato: "errore", messaggio: `Lettura dei dati del cliente non riuscita (${nome}).` };
    }
  }
  const incassiDisponibili = !incassiQ.error;

  type OrdineDb = { id: string; status: string; payment_method: string | null; total_amount: number | string; created_at: string; paid_at?: string | null; products: { title: string } | null; invoices: { id: string } | null };
  type SubDb = { id: string; plan: string; status: string; stripe_subscription_id: string | null; created_at: string; current_period_end: string | null; cancel_at_period_end: boolean | null; livemode?: boolean | null; disdetta_richiesta_il?: string | null };

  const ordiniDb = (ordiniQ.data ?? []) as unknown as OrdineDb[];
  const subDb = (subQ.data ?? []) as SubDb[];

  // Accettazioni legali di ordini e abbonamenti, con il documento (tipo, versione, impronta).
  const documenti = new Map(((documentiQ.data ?? []) as DocumentoDb[]).map((d) => [d.id, d]));
  const [accOrdiniQ, accSubQ] = await Promise.all([
    ordiniDb.length > 0 ? admin.from("legal_acceptances").select("order_id, acceptance_type, accepted_at, ip_address, user_agent, legal_document_id").in("order_id", ordiniDb.map((o) => o.id)) : Promise.resolve({ data: [], error: null }),
    subDb.length > 0 ? admin.from("omnia_ai_legal_acceptances").select("subscription_id, acceptance_type, accepted_at, ip_address, user_agent, legal_document_id").in("subscription_id", subDb.map((s) => s.id)) : Promise.resolve({ data: [], error: null }),
  ]);
  if (accOrdiniQ.error || accSubQ.error) {
    console.error("Console: lettura accettazioni del cliente fallita", accOrdiniQ.error?.message ?? accSubQ.error?.message);
    return { stato: "errore", messaggio: "Lettura delle accettazioni legali non riuscita." };
  }
  const accettazioniOrdini = costruisciAccettazioni((accOrdiniQ.data ?? []) as AccettazioneDb[], "order_id", documenti);
  const accettazioniAbb = costruisciAccettazioni((accSubQ.data ?? []) as AccettazioneDb[], "subscription_id", documenti);

  const adesso = new Date();
  const ordini: OrdineScheda[] = ordiniDb.map((o) => {
    const accettazioni = accettazioniOrdini.get(o.id) ?? [];
    return {
      id: o.id,
      prodotto: o.products?.title ?? null,
      stato: o.status,
      metodo: o.payment_method,
      importo: num(o.total_amount),
      creatoIl: o.created_at,
      pagatoIl: o.paid_at ?? null,
      fatturaCaricata: Boolean(o.invoices),
      accettazioni,
      provaAccettazione: statoProvaOrdine(accettazioni),
    };
  });

  const abbonamenti: AbbonamentoScheda[] = subDb.map((s) => {
    const accettazioni = accettazioniAbb.get(s.id) ?? [];
    const manuale = !s.stripe_subscription_id;
    const stato = statoAbbonamento({ status: s.status, current_period_end: s.current_period_end }, adesso).stato;
    return {
      id: s.id,
      piano: normalizzaPianoSlug(s.plan) ?? s.plan,
      statoDb: s.status,
      stato,
      manuale,
      prova: s.livemode === false,
      stripeId: s.stripe_subscription_id,
      creatoIl: s.created_at,
      finePeriodo: s.current_period_end,
      inDisdetta: stato === "attivo" && Boolean(s.cancel_at_period_end),
      disdettaRichiestaIl: s.disdetta_richiesta_il ?? null,
      accettazioni,
      provaAccettazione: statoProvaAbbonamento(manuale, accettazioni),
    };
  });

  const legame = await leggiLegameUfficioGare(id);

  const auth = authUtente.data?.user;
  return {
    stato: "ok",
    utente: { id: utente.id, email: utente.email, ruolo: utente.role, registratoIl: utente.created_at },
    accesso: {
      ultimoAccesso: auth?.last_sign_in_at ?? null,
      bannato: Boolean(auth?.banned_until && new Date(auth.banned_until).getTime() > adesso.getTime()),
      emailConfermataIl: auth?.email_confirmed_at ?? null,
    },
    azienda: aziendaQ.data ?? null,
    ordini,
    abbonamenti,
    saldoCrediti: num(saldoQ.data?.balance),
    acquistiCrediti: ((creditiAcqQ.data ?? []) as { id: string; pacchetto: string; crediti: number; importo_centesimi: number; stripe_session_id: string | null; created_at: string; stato_fattura?: string | null }[]).map((c) => ({
      id: c.id,
      data: c.created_at,
      pacchetto: c.pacchetto,
      crediti: num(c.crediti),
      lordo: num(c.importo_centesimi) / 100,
      prova: (c.stripe_session_id ?? "").startsWith("cs_test_"),
      statoFattura: c.stato_fattura ?? null,
    })),
    revisioni: revisioniQ.error
      ? []
      : ((revisioniQ.data ?? []) as { id: string; gara_titolo: string; pagine: number; maggiorazione_percentuale: number; prezzo_totale_centesimi: number; importo_pagato_centesimi: number | null; pagata_il: string; livemode: boolean; stato_fattura?: string | null; numero_fattura?: string | null }[]).map((r) => ({
          id: r.id,
          data: r.pagata_il,
          garaTitolo: r.gara_titolo,
          pagine: num(r.pagine),
          lordo: num(r.importo_pagato_centesimi ?? r.prezzo_totale_centesimi) / 100,
          maggiorazione: num(r.maggiorazione_percentuale),
          prova: !r.livemode,
          statoFattura: r.stato_fattura ?? null,
          numeroFattura: r.numero_fattura ?? null,
        })),
    incassi: incassiDisponibili
      ? ((incassiQ.data ?? []) as { id: string; tipo: string; importo_lordo_centesimi: number; pagato_il: string; livemode: boolean; stato_fattura?: string | null; numero_fattura?: string | null }[]).map((i) => ({
          id: i.id,
          data: i.pagato_il,
          tipo: i.tipo,
          lordo: num(i.importo_lordo_centesimi) / 100,
          prova: !i.livemode,
          statoFattura: i.stato_fattura ?? null,
          numeroFattura: i.numero_fattura ?? null,
        }))
      : [],
    messaggi: ((messaggiQ.data ?? []) as { id: string; sender: "cliente" | "admin"; body: string; created_at: string }[]).map((m) => ({ id: m.id, mittente: m.sender, testo: m.body, creatoIl: m.created_at })),
    incassiDisponibili,
    abbonamentoGestitoDaStripe: subDb.length > 0 && Boolean(subDb[0].stripe_subscription_id),
    legameUfficioGare: legame === "errore" ? null : legame,
    legameUfficioGareNonLetto: legame === "errore",
  };
}
