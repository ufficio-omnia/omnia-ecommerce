import { createAdminClient } from "@/lib/supabase/admin";

export type NotificaTipo =
  | "analisi_conclusa"
  | "relazione_generata"
  | "gara_scadenza_7gg"
  | "gara_scadenza_2gg"
  | "gare_piano_esaurite"
  | "rinnovo_3gg"
  | "pagamento_fallito";

// Fire-and-forget come logAiUsage: un fallimento nel generare una
// notifica non deve mai bloccare il flusso reale che l'ha innescata
// (un'analisi riuscita, un pagamento, il cron giornaliero). La
// deduplica è un solo meccanismo per tutti i tipi — l'indice unico
// (user_id, tipo, chiave_dedup) in 0063 — quindi si tenta sempre
// l'insert e un conflitto (23505) è il caso atteso di "notifica già
// generata per questo stesso evento", non un errore da loggare.
export async function creaNotifica(params: {
  userId: string;
  tipo: NotificaTipo;
  garaId: string | null;
  titolo: string;
  corpo: string;
  chiaveDedup: string;
}): Promise<void> {
  try {
    const admin = createAdminClient();
    const { error } = await admin.from("omnia_ai_notifiche").insert({
      user_id: params.userId,
      tipo: params.tipo,
      gara_id: params.garaId,
      titolo: params.titolo,
      corpo: params.corpo,
      chiave_dedup: params.chiaveDedup,
    });

    if (error && error.code !== "23505") {
      console.error("Errore creazione notifica OMNIA AI:", error);
    }
  } catch (err) {
    console.error("Errore creazione notifica OMNIA AI:", err);
  }
}
