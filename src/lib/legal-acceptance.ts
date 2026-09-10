import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";

export type BuyerType = "azienda" | "consumatore";

export type AcceptanceInput = {
  condizioniEPrivacy: boolean;
  esecuzioneImmediata: boolean;
  clausoleSpecifiche: boolean;
};

export type LegalDocumentRef = { id: string; version: number };

export type CurrentLegalDocuments = {
  condizioniVendita: LegalDocumentRef;
  privacyPolicy: LegalDocumentRef;
};

// Legge IP e user agent dalla richiesta corrente lato server: mai
// fidarsi di un valore inviato dal client per questo scopo.
export async function getRequestMeta(): Promise<{
  ip: string | null;
  userAgent: string | null;
}> {
  const h = await headers();
  const forwardedFor = h.get("x-forwarded-for");
  const ip = forwardedFor
    ? forwardedFor.split(",")[0].trim()
    : (h.get("x-real-ip") ?? null);
  return { ip, userAgent: h.get("user-agent") };
}

// Il pulsante di pagamento è disabilitato nel browser finché le caselle
// richieste non sono spuntate, ma un client può essere aggirato: questo
// controllo server-side è quello che conta davvero.
export function validateLegalAcceptance(
  buyerType: BuyerType,
  input: AcceptanceInput,
): string | null {
  if (!input.condizioniEPrivacy) {
    return "Devi accettare le Condizioni di vendita e prendere visione della Privacy policy.";
  }
  if (buyerType === "consumatore" && !input.esecuzioneImmediata) {
    return "Devi confermare la richiesta di esecuzione immediata e la conseguente rinuncia al recesso.";
  }
  if (!input.clausoleSpecifiche) {
    return "Devi approvare specificamente le clausole 7, 8, 11 e 14 delle Condizioni di vendita.";
  }
  return null;
}

// Recupera la versione più recente di ciascun documento: le
// accettazioni vanno sempre registrate contro l'ultima versione in
// vigore al momento dell'ordine, mai una versione fissa nel codice.
export async function getCurrentLegalDocuments(
  admin: ReturnType<typeof createAdminClient>,
): Promise<CurrentLegalDocuments | null> {
  // "Vigente" = versione con la effective_date più recente non successiva
  // ad oggi, non semplicemente il numero di versione più alto: permette
  // di pubblicare in anticipo una revisione futura senza che scatti
  // prima della sua data di entrata in vigore. Usa l'indice
  // (document_type, effective_date desc) definito nella migrazione.
  const today = new Date().toISOString().slice(0, 10);

  const { data, error } = await admin
    .from("legal_documents")
    .select("id, document_type, version, effective_date")
    .in("document_type", ["condizioni_vendita", "privacy_policy"])
    .lte("effective_date", today)
    .order("effective_date", { ascending: false })
    .returns<
      { id: string; document_type: string; version: number; effective_date: string }[]
    >();

  if (error || !data) return null;

  const condizioniVendita = data.find(
    (d) => d.document_type === "condizioni_vendita",
  );
  const privacyPolicy = data.find((d) => d.document_type === "privacy_policy");

  if (!condizioniVendita || !privacyPolicy) return null;

  return {
    condizioniVendita: { id: condizioniVendita.id, version: condizioniVendita.version },
    privacyPolicy: { id: privacyPolicy.id, version: privacyPolicy.version },
  };
}

// Una riga per ogni casella di accettazione spuntata (mai una riga sola
// per ordine): "condizioni_e_privacy" copre due documenti, quindi
// genera due righe, ciascuna provata individualmente. Va chiamata nella
// stessa operazione che crea l'ordine (bonifico: subito; carta: nel
// webhook Stripe, che è dove l'ordine carta viene davvero creato).
export async function recordLegalAcceptances({
  admin,
  orderId,
  userId,
  buyerType,
  input,
  documents,
  ip,
  userAgent,
  acceptedAt,
}: {
  admin: ReturnType<typeof createAdminClient>;
  orderId: string;
  userId: string;
  buyerType: BuyerType;
  input: AcceptanceInput;
  documents: CurrentLegalDocuments;
  ip: string | null;
  userAgent: string | null;
  acceptedAt: string;
}): Promise<{ error?: string }> {
  type Row = {
    order_id: string;
    user_id: string;
    acceptance_type: string;
    legal_document_id: string;
    accepted_at: string;
    ip_address: string | null;
    user_agent: string | null;
  };

  const base = {
    order_id: orderId,
    user_id: userId,
    accepted_at: acceptedAt,
    ip_address: ip,
    user_agent: userAgent,
  };

  const rows: Row[] = [
    {
      ...base,
      acceptance_type: "condizioni_e_privacy",
      legal_document_id: documents.condizioniVendita.id,
    },
    {
      ...base,
      acceptance_type: "condizioni_e_privacy",
      legal_document_id: documents.privacyPolicy.id,
    },
    {
      ...base,
      acceptance_type: "clausole_specifiche",
      legal_document_id: documents.condizioniVendita.id,
    },
  ];

  if (buyerType === "consumatore" && input.esecuzioneImmediata) {
    rows.push({
      ...base,
      acceptance_type: "esecuzione_immediata_recesso",
      legal_document_id: documents.condizioniVendita.id,
    });
  }

  const { error } = await admin.from("legal_acceptances").insert(rows);

  if (error) {
    console.error("Errore registrazione accettazioni legali:", error);
    return { error: "Errore nella registrazione delle accettazioni." };
  }

  return {};
}
