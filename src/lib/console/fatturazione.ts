import { cache } from "react";
import { createAdminClient } from "@/lib/supabase/admin";
import { schemaAssente } from "@/lib/omnia-ai-incassi";
import { inBlocchi, leggiParametriCalcolo, type StatoParametri } from "./costi";
import {
  calcolaImporti,
  descrizioneCrediti,
  descrizioneIncasso,
  giorniDallIncasso,
  risolviDatiFatturazione,
  type ProfiloFatturazione,
  type RigaFatturazione,
  type SnapshotStripe,
  type StatoFattura,
} from "./fatturazione-calcoli";

// Lettura dei dati per la pagina "Da fatturare": gli incassi degli abbonamenti
// OMNIA AI e gli acquisti di crediti, ciascuno con lo stato di fatturazione
// segnato a mano e i dati del cliente per emettere la fattura. Da chiamare solo
// dopo richiediAdminPagina() / richiediAdminAzione().

export type OrdineSenzaFattura = { id: string; email: string | null; prodotto: string | null; lordo: number; creatoIl: string };

export type FatturazioneLetta =
  | { stato: "errore"; messaggio: string }
  | {
      stato: "ok";
      parametri: StatoParametri;
      righe: RigaFatturazione[];
      // le colonne dello stato di fatturazione esistono (migrazione 0079)
      statoDisponibile: boolean;
      // la tabella degli incassi esiste (migrazione 0078)
      incassiDisponibili: boolean;
      // righe di prova non mostrate (se i dati di prova sono nascosti)
      provaNascoste: number;
      ordiniSenzaFattura: { n: number; lordo: number; ultimi: OrdineSenzaFattura[] };
    };

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const COLONNE_INCASSO =
  "id, user_id, stripe_invoice_id, stripe_subscription_id, tipo, importo_lordo_centesimi, imposta_centesimi, imponibile_centesimi, pagato_il, livemode, numero_ricevuta, ricevuta_url, cliente_snapshot";
const COLONNE_CREDITI = "id, user_id, pacchetto, crediti, importo_centesimi, stripe_session_id, created_at";
const COLONNE_STATO = "stato_fattura, numero_fattura, data_fattura, note_fattura";

type DatiStato = { stato_fattura?: StatoFattura; numero_fattura?: string | null; data_fattura?: string | null; note_fattura?: string | null };

type IncassoDb = DatiStato & {
  id: string;
  user_id: string | null;
  stripe_invoice_id: string;
  stripe_subscription_id: string | null;
  tipo: string;
  importo_lordo_centesimi: number;
  imposta_centesimi: number | null;
  imponibile_centesimi: number | null;
  pagato_il: string;
  livemode: boolean;
  numero_ricevuta: string | null;
  ricevuta_url: string | null;
  cliente_snapshot: SnapshotStripe;
};

type CreditiDb = DatiStato & {
  id: string;
  user_id: string;
  pacchetto: string;
  crediti: number;
  importo_centesimi: number;
  stripe_session_id: string | null;
  created_at: string;
};

type Risposta = { data: unknown; error: { code?: string; message: string } | null };

export async function leggiFatturazione(opzioni: { includiProva?: boolean } = {}): Promise<FatturazioneLetta> {
  const includiProva = opzioni.includiProva ?? false;
  const admin = createAdminClient();

  // Prima con le colonne dello stato di fatturazione; se non esistono ancora
  // (migrazione 0079) si legge senza e ogni riga risulta "da fatturare".
  let statoDisponibile = true;
  let incassiQ: Risposta = await admin.from("omnia_ai_incassi").select(`${COLONNE_INCASSO}, ${COLONNE_STATO}`).order("pagato_il", { ascending: false }).limit(2000);
  let creditiQ: Risposta = await admin.from("omnia_ai_credit_purchases").select(`${COLONNE_CREDITI}, ${COLONNE_STATO}`).order("created_at", { ascending: false }).limit(2000);
  if (schemaAssente(incassiQ.error) || schemaAssente(creditiQ.error)) {
    statoDisponibile = false;
    incassiQ = await admin.from("omnia_ai_incassi").select(COLONNE_INCASSO).order("pagato_il", { ascending: false }).limit(2000);
    creditiQ = await admin.from("omnia_ai_credit_purchases").select(COLONNE_CREDITI).order("created_at", { ascending: false }).limit(2000);
  }

  // Senza la tabella degli incassi (0078) restano solo i crediti.
  const incassiDisponibili = !incassiQ.error;
  if (incassiQ.error && !schemaAssente(incassiQ.error)) {
    console.error("Console: lettura incassi per la fatturazione fallita", incassiQ.error.message);
    return { stato: "errore", messaggio: "Lettura degli incassi non riuscita." };
  }
  if (creditiQ.error) {
    console.error("Console: lettura crediti per la fatturazione fallita", creditiQ.error.message);
    return { stato: "errore", messaggio: "Lettura degli acquisti di crediti non riuscita." };
  }

  const incassi = incassiDisponibili ? ((incassiQ.data ?? []) as IncassoDb[]) : [];
  const crediti = (creditiQ.data ?? []) as CreditiDb[];

  const [parametri, abbonamentiQ, ordiniQ] = await Promise.all([
    leggiParametriCalcolo(),
    admin.from("subscriptions").select("stripe_subscription_id, plan").not("stripe_subscription_id", "is", null).limit(5000),
    admin.from("orders").select("id, total_amount, created_at, users!user_id(email), products(title), invoices(id)").eq("status", "pagato").limit(5000),
  ]);

  // Dati di fatturazione: il profilo azienda del cliente, completato da Stripe.
  const idUtenti = [...new Set([...incassi.flatMap((i) => (i.user_id ? [i.user_id] : [])), ...crediti.map((c) => c.user_id)])];
  const [utenti, aziende] = await Promise.all([
    inBlocchi<{ id: string; email: string }>(idUtenti, (b) => admin.from("users").select("id, email").in("id", b)),
    inBlocchi<ProfiloFatturazione & { user_id: string }>(idUtenti, (b) =>
      admin.from("companies").select("user_id, ragione_sociale, partita_iva, codice_fiscale, indirizzo, codice_sdi, pec, buyer_type").in("user_id", b),
    ),
  ]);
  const emailUtente = new Map(utenti.map((u) => [u.id, u.email]));
  const profilo = new Map(aziende.map((a) => [a.user_id, a]));
  const pianoPerAbbonamento = new Map(((abbonamentiQ.data ?? []) as { stripe_subscription_id: string; plan: string }[]).map((a) => [a.stripe_subscription_id, a.plan]));

  // Per i crediti non c'è uno snapshot proprio: si usa quello dell'ultimo
  // incasso dello stesso cliente (il cliente di Stripe è lo stesso).
  const snapshotPerUtente = new Map<string, SnapshotStripe>();
  for (const i of incassi) if (i.user_id && i.cliente_snapshot && !snapshotPerUtente.has(i.user_id)) snapshotPerUtente.set(i.user_id, i.cliente_snapshot);

  const adesso = new Date();
  const righe: RigaFatturazione[] = [];

  const comune = (userId: string | null, snapshot: SnapshotStripe) => {
    const dati = risolviDatiFatturazione(userId ? (profilo.get(userId) ?? null) : null, snapshot, userId ? (emailUtente.get(userId) ?? null) : null);
    return { dati, cliente: dati.ragioneSociale ?? dati.email ?? "(cliente non agganciato)" };
  };
  const statoDi = (r: DatiStato) => ({
    stato: r.stato_fattura ?? ("da_fatturare" as StatoFattura),
    numeroFattura: r.numero_fattura ?? null,
    dataFattura: r.data_fattura ?? null,
    note: r.note_fattura ?? null,
  });

  for (const i of incassi) {
    const { dati, cliente } = comune(i.user_id, i.cliente_snapshot);
    righe.push({
      chiave: `incasso:${i.id}`,
      fonte: "incasso",
      data: i.pagato_il,
      descrizione: descrizioneIncasso(i.tipo, i.stripe_subscription_id ? (pianoPerAbbonamento.get(i.stripe_subscription_id) ?? null) : null),
      userId: i.user_id,
      cliente,
      importi: calcolaImporti(
        num(i.importo_lordo_centesimi) / 100,
        i.imposta_centesimi === null ? null : num(i.imposta_centesimi) / 100,
        i.imponibile_centesimi === null ? null : num(i.imponibile_centesimi) / 100,
        parametri.aliquotaIva,
      ),
      prova: !i.livemode,
      ...statoDi(i),
      numeroRicevuta: i.numero_ricevuta,
      ricevutaUrl: i.ricevuta_url,
      dati,
      giorni: giorniDallIncasso(i.pagato_il, adesso),
      idStripe: i.stripe_invoice_id,
    });
  }

  for (const c of crediti) {
    const { dati, cliente } = comune(c.user_id, snapshotPerUtente.get(c.user_id) ?? null);
    righe.push({
      chiave: `crediti:${c.id}`,
      fonte: "crediti",
      data: c.created_at,
      descrizione: descrizioneCrediti(c.pacchetto, num(c.crediti)),
      userId: c.user_id,
      cliente,
      importi: calcolaImporti(num(c.importo_centesimi) / 100, null, null, parametri.aliquotaIva),
      prova: (c.stripe_session_id ?? "").startsWith("cs_test_"),
      ...statoDi(c),
      numeroRicevuta: null,
      ricevutaUrl: null,
      dati,
      giorni: giorniDallIncasso(c.created_at, adesso),
      idStripe: c.stripe_session_id,
    });
  }

  righe.sort((a, b) => b.data.localeCompare(a.data));
  const visibili = righe.filter((r) => includiProva || !r.prova);

  // Ordini dell'e-commerce pagati senza una fattura caricata: stesso lavoro di
  // fatturazione, ma si carica il PDF dalla pagina Ordini.
  type OrdineDb = { id: string; total_amount: number | string; created_at: string; users: { email: string } | null; products: { title: string } | null; invoices: { id: string } | null };
  const ordiniSenza = ((ordiniQ.error ? [] : (ordiniQ.data ?? [])) as unknown as OrdineDb[]).filter((o) => !o.invoices);
  ordiniSenza.sort((a, b) => b.created_at.localeCompare(a.created_at));

  return {
    stato: "ok",
    parametri,
    righe: visibili,
    statoDisponibile,
    incassiDisponibili,
    provaNascoste: righe.length - visibili.length,
    ordiniSenzaFattura: {
      n: ordiniSenza.length,
      lordo: ordiniSenza.reduce((s, o) => s + num(o.total_amount), 0),
      ultimi: ordiniSenza.slice(0, 8).map((o) => ({ id: o.id, email: o.users?.email ?? null, prodotto: o.products?.title ?? null, lordo: num(o.total_amount), creatoIl: o.created_at })),
    },
  };
}

// Quanti incassi veri aspettano ancora una fattura: serve alla barra laterale e
// alla Home, da qualunque pagina. null se la migrazione 0079 non c'è ancora.
// Una lettura sola per richiesta.
export const contaDaFatturare = cache(async (): Promise<{ n: number; lordo: number } | null> => {
  const admin = createAdminClient();
  const [incassi, crediti] = await Promise.all([
    admin.from("omnia_ai_incassi").select("importo_lordo_centesimi").eq("stato_fattura", "da_fatturare").eq("livemode", true).limit(5000),
    admin.from("omnia_ai_credit_purchases").select("importo_centesimi, stripe_session_id").eq("stato_fattura", "da_fatturare").limit(5000),
  ]);
  // Senza la tabella degli incassi (0078) restano comunque i crediti. Qualunque
  // altro errore, compresa la colonna dello stato che manca (0079), vuol dire che
  // il conteggio non è attendibile: null, e la barra non mostra nulla.
  const tabellaIncassiAssente = incassi.error?.code === "PGRST205" || incassi.error?.code === "42P01";
  if (crediti.error || (incassi.error && !tabellaIncassiAssente)) return null;

  const reali = ((crediti.data ?? []) as { importo_centesimi: number; stripe_session_id: string | null }[]).filter((c) => !(c.stripe_session_id ?? "").startsWith("cs_test_"));
  const incassiReali = incassi.error ? [] : ((incassi.data ?? []) as { importo_lordo_centesimi: number }[]);
  return {
    n: incassiReali.length + reali.length,
    lordo: (incassiReali.reduce((s, i) => s + num(i.importo_lordo_centesimi), 0) + reali.reduce((s, c) => s + num(c.importo_centesimi), 0)) / 100,
  };
});
