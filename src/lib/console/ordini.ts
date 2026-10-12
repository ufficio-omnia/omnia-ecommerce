import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email";
import { BASE_URL } from "@/lib/zone";
import { scadenzaBonifico, type ScadenzaBonifico } from "./giorni-lavorativi";

// Ordini e bonifici della console. Le letture usano la service role e vanno
// chiamate solo dopo richiediAdminPagina()/richiediAdminAzione(); la conferma
// di un bonifico è condivisa con il vecchio pannello admin dell'e-commerce
// (src/app/actions/admin.ts) finché quello esiste, così la data e l'autore
// della conferma si registrano da qualunque parte arrivi.

type RelazioneUtente = { email: string } | null;
type RelazioneProdotto = { title: string } | null;

function escapeHtml(valore: string): string {
  return valore.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// La colonna non esiste ancora perché la migrazione 0075 non è stata eseguita.
function colonnaAssente(error: { code?: string; message?: string } | null, frammento: string): boolean {
  if (!error) return false;
  return error.code === "PGRST204" || error.code === "42703" || (error.message ?? "").includes(frammento);
}

// La causale che il cliente ha visto nelle istruzioni del bonifico
// (src/app/actions/checkout.ts): "Ordine" + i primi otto caratteri dell'id.
export function causaleOrdine(orderId: string): string {
  return `Ordine ${orderId.slice(0, 8)}`;
}

// ───── Bonifici in attesa ─────

export type BonificoInAttesa = {
  id: string;
  causale: string;
  userId: string;
  email: string | null;
  ragioneSociale: string | null;
  prodotto: string | null;
  // IVA inclusa, già scontato
  importo: number;
  creatoIl: string;
} & ScadenzaBonifico;

export type RiepilogoBonifici = {
  // dal più vecchio, cioè dal più urgente
  righe: BonificoInAttesa[];
  totale: number;
  importoTotale: number;
  scaduti: number;
  inScadenza: number;
  errore?: string;
};

type RigaBonificoDb = {
  id: string;
  user_id: string;
  total_amount: number | string;
  created_at: string;
  users: RelazioneUtente;
  products: RelazioneProdotto;
};

// Una lettura sola per richiesta: la barra laterale (conteggio), la Panoramica
// e la pagina Bonifici la riusano senza interrogare tre volte il database.
export const leggiBonificiInAttesa = cache(async (): Promise<RiepilogoBonifici> => {
  const vuoto: RiepilogoBonifici = { righe: [], totale: 0, importoTotale: 0, scaduti: 0, inScadenza: 0 };
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("orders")
    .select("id, user_id, total_amount, created_at, users!user_id(email), products(title)")
    .eq("status", "in_attesa")
    .eq("payment_method", "bonifico")
    .order("created_at", { ascending: true });

  if (error) {
    console.error("Console: lettura bonifici in attesa fallita", error.message);
    return { ...vuoto, errore: "Impossibile leggere gli ordini." };
  }

  const ordini = (data ?? []) as unknown as RigaBonificoDb[];

  // Il bonifico arriva intestato all'azienda: la ragione sociale aiuta a riconoscerlo sull'estratto conto.
  const ragioniSociali = new Map<string, string | null>();
  const utenti = [...new Set(ordini.map((o) => o.user_id))];
  if (utenti.length > 0) {
    const { data: aziende } = await admin.from("companies").select("user_id, ragione_sociale").in("user_id", utenti);
    for (const a of (aziende ?? []) as { user_id: string; ragione_sociale: string | null }[]) {
      ragioniSociali.set(a.user_id, a.ragione_sociale);
    }
  }

  const oggi = new Date();
  const righe: BonificoInAttesa[] = ordini.map((o) => ({
    id: o.id,
    causale: causaleOrdine(o.id),
    userId: o.user_id,
    email: o.users?.email ?? null,
    ragioneSociale: ragioniSociali.get(o.user_id) ?? null,
    prodotto: o.products?.title ?? null,
    importo: Number(o.total_amount),
    creatoIl: o.created_at,
    ...scadenzaBonifico(new Date(o.created_at), oggi),
  }));

  return {
    righe,
    totale: righe.length,
    importoTotale: righe.reduce((somma, r) => somma + r.importo, 0),
    scaduti: righe.filter((r) => r.stato === "scaduto").length,
    inScadenza: righe.filter((r) => r.stato === "in_scadenza").length,
  };
});

// ───── Conferma di un bonifico ─────

export type EsitoConferma =
  | { ok: true; emailInviata: boolean; dataRegistrata: boolean }
  | { ok: false; errore: string };

// Segna pagato un ordine con bonifico e avvisa il cliente. Si può confermare
// una volta sola: l'aggiornamento è condizionato allo stato "in_attesa", quindi
// un secondo clic (o un'altra scheda aperta) non rimanda l'email né sovrascrive
// la data di conferma. Il client e l'invio email sono parametri solo per le
// prove automatiche.
export async function confermaPagamentoBonifico(
  admin: SupabaseClient,
  { orderId, adminId }: { orderId: string; adminId: string | null },
  inviaEmail: typeof sendEmail = sendEmail,
): Promise<EsitoConferma> {
  const { data: ordine, error: letturaErrore } = await admin
    .from("orders")
    .select("id, status, payment_method, users!user_id(email), products(title)")
    .eq("id", orderId)
    .maybeSingle();

  if (letturaErrore) {
    console.error("Console: lettura ordine da confermare fallita", letturaErrore.message);
    return { ok: false, errore: "Errore nella lettura dell'ordine." };
  }
  if (!ordine) return { ok: false, errore: "Ordine non trovato." };

  const dati = ordine as unknown as {
    status: string;
    payment_method: string | null;
    users: RelazioneUtente;
    products: RelazioneProdotto;
  };

  if (dati.payment_method !== "bonifico") {
    return { ok: false, errore: "Non è un ordine con bonifico: i pagamenti con carta si confermano da soli." };
  }
  if (dati.status !== "in_attesa") return { ok: false, errore: "Ordine già confermato." };

  let dataRegistrata = true;
  let risposta = await admin
    .from("orders")
    .update({ status: "pagato", paid_at: new Date().toISOString(), paid_by: adminId })
    .eq("id", orderId)
    .eq("status", "in_attesa")
    .select("id");

  // Migrazione 0075 non ancora eseguita: si conferma comunque, senza data e autore.
  if (risposta.error && colonnaAssente(risposta.error, "paid_")) {
    dataRegistrata = false;
    risposta = await admin.from("orders").update({ status: "pagato" }).eq("id", orderId).eq("status", "in_attesa").select("id");
  }

  if (risposta.error) {
    console.error("Console: conferma bonifico fallita", risposta.error.message);
    return { ok: false, errore: "Errore nell'aggiornamento dell'ordine." };
  }
  if (!risposta.data || risposta.data.length === 0) return { ok: false, errore: "Ordine già confermato." };

  let emailInviata = false;
  if (dati.users?.email) {
    emailInviata = await inviaEmail({
      to: dati.users.email,
      subject: "Il tuo documento è pronto per il download",
      html: `<p>Il pagamento del tuo ordine è stato confermato.</p><p>Il documento <strong>${escapeHtml(dati.products?.title ?? "")}</strong> è ora disponibile nella tua area riservata.</p><p><a href="${BASE_URL}/dashboard">Vai alla dashboard</a></p>`,
    });
  }

  return { ok: true, emailInviata, dataRegistrata };
}

// ───── Elenco ordini ─────

export type StatoOrdine = "in_attesa" | "pagato" | "bonifico_in_attesa";

export type RigaOrdine = {
  id: string;
  userId: string;
  email: string | null;
  prodotto: string | null;
  stato: StatoOrdine;
  metodo: "carta" | "bonifico" | null;
  importo: number;
  creatoIl: string;
  pagatoIl: string | null;
  fatturaCaricata: boolean;
};

export type ElencoOrdini = {
  righe: RigaOrdine[];
  // false se la colonna paid_at non esiste ancora (migrazione 0075 da eseguire)
  dataPagamentoDisponibile: boolean;
  // true se ci sono più ordini di quanti ne mostra l'elenco
  troncato: boolean;
  errore?: string;
};

export type FiltroStato = "tutti" | "in_attesa" | "pagato";

export function leggiFiltroStato(valore: string | undefined): FiltroStato {
  return valore === "in_attesa" || valore === "pagato" ? valore : "tutti";
}

// Filtro dell'elenco per stato e per testo libero (id dell'ordine, email o prodotto).
export function filtraOrdini(righe: RigaOrdine[], stato: FiltroStato, testo: string): RigaOrdine[] {
  const cerca = testo.trim().toLowerCase();
  return righe.filter((r) => {
    if (stato === "in_attesa" && r.stato === "pagato") return false;
    if (stato === "pagato" && r.stato !== "pagato") return false;
    if (!cerca) return true;
    return (
      r.id.toLowerCase().startsWith(cerca) ||
      (r.email ?? "").toLowerCase().includes(cerca) ||
      (r.prodotto ?? "").toLowerCase().includes(cerca)
    );
  });
}

const LIMITE_ORDINI = 500;

type RigaOrdineDb = {
  id: string;
  user_id: string;
  status: StatoOrdine;
  payment_method: "carta" | "bonifico" | null;
  total_amount: number | string;
  created_at: string;
  paid_at?: string | null;
  users: RelazioneUtente;
  products: RelazioneProdotto;
  invoices: { id: string } | null;
};

export const leggiOrdini = cache(async (): Promise<ElencoOrdini> => {
  const admin = createAdminClient();
  const colonne = "id, user_id, status, payment_method, total_amount, created_at, users!user_id(email), products(title), invoices(id)";

  let dataPagamentoDisponibile = true;
  // Tipo largo di proposito: la seconda lettura (senza paid_at) ha una forma diversa dalla prima.
  let risposta: { data: unknown; error: { code?: string; message: string } | null } = await admin
    .from("orders")
    .select(`${colonne}, paid_at`)
    .order("created_at", { ascending: false })
    .limit(LIMITE_ORDINI + 1);

  if (risposta.error && colonnaAssente(risposta.error, "paid_at")) {
    dataPagamentoDisponibile = false;
    risposta = await admin.from("orders").select(colonne).order("created_at", { ascending: false }).limit(LIMITE_ORDINI + 1);
  }

  if (risposta.error) {
    console.error("Console: lettura ordini fallita", risposta.error.message);
    return { righe: [], dataPagamentoDisponibile, troncato: false, errore: "Impossibile leggere gli ordini." };
  }

  const ordini = (risposta.data ?? []) as unknown as RigaOrdineDb[];
  return {
    righe: ordini.slice(0, LIMITE_ORDINI).map((o) => ({
      id: o.id,
      userId: o.user_id,
      email: o.users?.email ?? null,
      prodotto: o.products?.title ?? null,
      stato: o.status,
      metodo: o.payment_method,
      importo: Number(o.total_amount),
      creatoIl: o.created_at,
      pagatoIl: o.paid_at ?? null,
      fatturaCaricata: Boolean(o.invoices),
    })),
    dataPagamentoDisponibile,
    troncato: ordini.length > LIMITE_ORDINI,
  };
});
