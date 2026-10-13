import { createClient } from "@/lib/supabase/server";
import type { createAdminClient } from "@/lib/supabase/admin";

// Stesso pattern di getCurrentLegalDocuments (src/lib/legal-acceptance.ts):
// "vigente" = versione con la effective_date più recente non successiva
// ad oggi, non il numero di versione più alto — permette di pubblicare in
// anticipo una revisione futura senza che scatti prima della sua data di
// entrata in vigore.
//
// Client di sessione (non admin): legal_documents ha SELECT pubblico via
// RLS, stesso client già usato per lo stesso scopo in
// src/app/(ecommerce)/prodotti/[id]/page.tsx.
//
// Ricade sulla pagina statica se non c'è ancora una riga per questo tipo
// (es. la migrazione 0052 non è stata ancora eseguita): non deve mai
// rompere il rendering della pagina piani o del piè di pagina.
export async function getCurrentOmniaAiCondizioniAbbonamentoUrl(): Promise<string> {
  const fallback = "/condizioni-abbonamento";
  const supabase = await createClient();
  const today = new Date().toISOString().slice(0, 10);

  const { data, error } = await supabase
    .from("legal_documents")
    .select("version")
    .eq("document_type", "omnia_ai_condizioni_abbonamento")
    .lte("effective_date", today)
    .order("effective_date", { ascending: false })
    .limit(1)
    .maybeSingle<{ version: number }>();

  if (error || !data) return fallback;

  return `/documenti-legali/condizioni-abbonamento/${data.version}`;
}

// Versione vigente di un documento di OMNIA AI (con la stessa regola di sopra: la
// effective_date più recente non successiva a oggi) e data da cui è in vigore.
// null se il documento non ha ancora nessuna riga (es. la migrazione 0080 non è
// stata eseguita): chi chiama ricade su un comportamento sicuro, mai su un errore.
export async function getCurrentOmniaAiDocumento(
  tipoDb: string,
): Promise<{ version: number; effectiveDate: string } | null> {
  const supabase = await createClient();
  const today = new Date().toISOString().slice(0, 10);

  const { data, error } = await supabase
    .from("legal_documents")
    .select("version, effective_date")
    .eq("document_type", tipoDb)
    .lte("effective_date", today)
    .order("effective_date", { ascending: false })
    .limit(1)
    .maybeSingle<{ version: number; effective_date: string }>();

  if (error || !data) return null;
  return { version: data.version, effectiveDate: data.effective_date };
}

// Data di entrata in vigore di UNA versione precisa (anche non più vigente): serve a
// mostrare «in vigore dal …» nelle versioni archiviate e nel PDF.
export async function getOmniaAiDocumentoEffectiveDate(
  tipoDb: string,
  version: number,
): Promise<string | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("legal_documents")
    .select("effective_date")
    .eq("document_type", tipoDb)
    .eq("version", version)
    .maybeSingle<{ effective_date: string }>();

  if (error || !data) return null;
  return data.effective_date;
}

// Indirizzo della versione vigente dell'Allegato A, o null se non esiste ancora (prima
// della migrazione 0080): chi lo mostra semplicemente non lo mostra.
export async function getCurrentOmniaAiAllegatoAUrl(): Promise<string | null> {
  const corrente = await getCurrentOmniaAiDocumento("omnia_ai_allegato_a");
  return corrente ? `/documenti-legali/allegato-a/${corrente.version}` : null;
}

export type OmniaAiAcceptanceInput = {
  condizioniEPrivacy: boolean;
  clausoleSpecifiche: boolean;
};

export type OmniaAiLegalDocumentRef = { id: string; version: number };

export type CurrentOmniaAiLegalDocuments = {
  condizioniAbbonamento: OmniaAiLegalDocumentRef;
  privacyPolicy: OmniaAiLegalDocumentRef;
  // atto di nomina a responsabile del trattamento (allegato alle condizioni dalla v2):
  // null finché la migrazione 0080 non l'ha inserito — in quel caso non c'è nulla da
  // mostrare né da registrare, e il checkout resta quello di sempre
  allegatoA: OmniaAiLegalDocumentRef | null;
};

// Mirror di getCurrentLegalDocuments (src/lib/legal-acceptance.ts), ma
// con client admin: usata dentro il checkout (deve BLOCCARE con un
// errore se manca un documento, mai lasciar partire un abbonamento senza
// consenso documentato — a differenza dell'helper URL sopra, che ricade
// su una pagina statica perché lì un fallback silenzioso è accettabile).
export async function getCurrentOmniaAiLegalDocuments(
  admin: ReturnType<typeof createAdminClient>,
): Promise<CurrentOmniaAiLegalDocuments | null> {
  const today = new Date().toISOString().slice(0, 10);

  const { data, error } = await admin
    .from("legal_documents")
    .select("id, document_type, version, effective_date")
    .in("document_type", ["omnia_ai_condizioni_abbonamento", "omnia_ai_privacy_policy", "omnia_ai_allegato_a"])
    .lte("effective_date", today)
    .order("effective_date", { ascending: false })
    .returns<
      { id: string; document_type: string; version: number; effective_date: string }[]
    >();

  if (error || !data) return null;

  const condizioniAbbonamento = data.find(
    (d) => d.document_type === "omnia_ai_condizioni_abbonamento",
  );
  const privacyPolicy = data.find((d) => d.document_type === "omnia_ai_privacy_policy");
  const allegatoA = data.find((d) => d.document_type === "omnia_ai_allegato_a");

  if (!condizioniAbbonamento || !privacyPolicy) return null;

  return {
    condizioniAbbonamento: { id: condizioniAbbonamento.id, version: condizioniAbbonamento.version },
    privacyPolicy: { id: privacyPolicy.id, version: privacyPolicy.version },
    allegatoA: allegatoA ? { id: allegatoA.id, version: allegatoA.version } : null,
  };
}

// Nessun parametro buyerType (a differenza di validateLegalAcceptance):
// OMNIA AI serve chi partecipa a gare d'appalto, è sempre un'azienda, mai
// un consumatore privato — niente clausola di recesso da gestire.
export function validateOmniaAiAcceptance(input: OmniaAiAcceptanceInput): string | null {
  if (!input.condizioniEPrivacy) {
    return "Devi accettare le Condizioni di abbonamento e prendere visione della Privacy policy.";
  }
  // Senza numeri nel messaggio: le clausole da approvare cambiano con la versione delle
  // condizioni (5, 8, 11, 14 nella v1; 5, 8, 10, 12, 15 e Allegato A dalla v2), e la
  // validazione avviene prima di sapere quale versione è in vigore.
  if (!input.clausoleSpecifiche) {
    return "Devi approvare specificamente le clausole indicate delle Condizioni di abbonamento (e l'Allegato A, dove previsto).";
  }
  return null;
}

// Una riga per ogni casella di accettazione spuntata, mirror esatto di
// recordLegalAcceptances: "condizioni_e_privacy" copre due documenti
// (condizioni di abbonamento + privacy), quindi genera due righe; dalla v2 delle
// condizioni se ne aggiungono altre due per l'Allegato A (vedi sotto).
export async function recordOmniaAiLegalAcceptances({
  admin,
  subscriptionId,
  userId,
  documents,
  ip,
  userAgent,
  acceptedAt,
}: {
  admin: ReturnType<typeof createAdminClient>;
  subscriptionId: string;
  userId: string;
  documents: CurrentOmniaAiLegalDocuments;
  ip: string | null;
  userAgent: string | null;
  acceptedAt: string;
}): Promise<{ error?: string }> {
  type Row = {
    subscription_id: string;
    user_id: string;
    acceptance_type: string;
    legal_document_id: string;
    accepted_at: string;
    ip_address: string | null;
    user_agent: string | null;
  };

  const base = {
    subscription_id: subscriptionId,
    user_id: userId,
    accepted_at: acceptedAt,
    ip_address: ip,
    user_agent: userAgent,
  };

  const rows: Row[] = [
    {
      ...base,
      acceptance_type: "condizioni_e_privacy",
      legal_document_id: documents.condizioniAbbonamento.id,
    },
    {
      ...base,
      acceptance_type: "condizioni_e_privacy",
      legal_document_id: documents.privacyPolicy.id,
    },
    {
      ...base,
      acceptance_type: "clausole_specifiche",
      legal_document_id: documents.condizioniAbbonamento.id,
    },
  ];

  // L'Allegato A (atto di nomina a responsabile) è parte integrante delle condizioni:
  // si registra sia come accettato insieme ad esse (prima casella) sia come
  // approvato specificamente (seconda casella, che lo richiama). Due righe in più,
  // ciascuna con l'impronta della versione che il cliente ha davvero visto.
  if (documents.allegatoA) {
    rows.push(
      {
        ...base,
        acceptance_type: "condizioni_e_privacy",
        legal_document_id: documents.allegatoA.id,
      },
      {
        ...base,
        acceptance_type: "clausole_specifiche",
        legal_document_id: documents.allegatoA.id,
      },
    );
  }

  const { error } = await admin.from("omnia_ai_legal_acceptances").insert(rows);

  if (error) {
    // Violazione unique(subscription_id, acceptance_type,
    // legal_document_id): queste tre righe sono scritte una sola volta
    // per abbonamento, un evento webhook rielaborato (retry Stripe, o
    // riprocessato a mano dopo aver risolto un problema di schema) non
    // deve fallire di nuovo se sono già state registrate.
    if (error.code === "23505") {
      return {};
    }
    console.error("Errore registrazione accettazioni legali OMNIA AI:", error);
    return { error: "Errore nella registrazione delle accettazioni." };
  }

  return {};
}
