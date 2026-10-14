import type { SupabaseClient } from "@supabase/supabase-js";
import { schemaAssente } from "@/lib/omnia-ai-incassi";

// Letture della revisione umana, condivise dalla pagina della gara, dalla pagina di acquisto e dall'azione
// che avvia il pagamento: la STESSA risposta per tutte e tre, così quello che il cliente vede è quello che
// il server poi controlla.

export type GaraRevisione = { id: string; titolo: string; scadenza: string | null; limite_pagine_totale: number | null };

export type RelazioneFinale = { messaggioId: string; fileNome: string; filePath: string; pagineStimate: number | null; creataIl: string };

export type RichiestaRevisione = {
  id: string;
  stato: "in_attesa_pagamento" | "pagata";
  pagata_il: string | null;
  creata_il: string;
  gara_titolo: string;
  pagine: number;
  prezzo_totale_centesimi: number;
  maggiorazione_percentuale: number;
  referente_nome: string;
  referente_email: string;
  referente_cellulare: string;
  importo_pagato_centesimi: number | null;
};

export type ContestoRevisione = {
  gara: GaraRevisione;
  // l'ultima relazione tecnica FINALE della gara (con tutti i criteri); null se non è ancora stata composta
  relazione: RelazioneFinale | null;
  // la richiesta già PAGATA per questa relazione, se c'è
  pagata: RichiestaRevisione | null;
};

const COLONNE_RICHIESTA = "id, stato, pagata_il, creata_il, gara_titolo, pagine, prezzo_totale_centesimi, maggiorazione_percentuale, referente_nome, referente_email, referente_cellulare, importo_pagato_centesimi";

// `supabase` è il client dell'utente (la RLS garantisce che la gara sia sua), `admin` quello di servizio.
export async function leggiContestoRevisione({
  supabase,
  admin,
  userId,
  garaId,
}: {
  supabase: SupabaseClient;
  admin: SupabaseClient;
  userId: string;
  garaId: string;
}): Promise<ContestoRevisione | null> {
  const { data: gara } = await supabase
    .from("gare")
    .select("id, titolo, scadenza, limite_pagine_totale")
    .eq("id", garaId)
    .maybeSingle<GaraRevisione>();
  if (!gara) return null;

  // Colonna della migrazione 0088: se non c'è ancora, la relazione finale non si riconosce e il pulsante non compare.
  const { data: messaggio, error: erroreMessaggio } = await supabase
    .from("gara_messaggi")
    .select("id, file_nome, file_path, pagine_stimate, created_at")
    .eq("gara_id", garaId)
    .eq("relazione_finale", true)
    .not("file_path", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string; file_nome: string | null; file_path: string | null; pagine_stimate: number | null; created_at: string }>();
  if (erroreMessaggio && !schemaAssente(erroreMessaggio)) console.error("Revisione umana: lettura della relazione finale non riuscita", erroreMessaggio.message);

  const relazione: RelazioneFinale | null =
    messaggio?.file_path && messaggio.file_nome
      ? { messaggioId: messaggio.id, fileNome: messaggio.file_nome, filePath: messaggio.file_path, pagineStimate: messaggio.pagine_stimate, creataIl: messaggio.created_at }
      : null;

  let pagata: RichiestaRevisione | null = null;
  if (relazione) {
    const { data, error } = await admin
      .from("omnia_ai_revisioni")
      .select(COLONNE_RICHIESTA)
      .eq("user_id", userId)
      .eq("messaggio_id", relazione.messaggioId)
      .eq("stato", "pagata")
      .maybeSingle<RichiestaRevisione>();
    if (error && !schemaAssente(error)) console.error("Revisione umana: lettura della richiesta non riuscita", error.message);
    pagata = data ?? null;
  }

  return { gara, relazione, pagata };
}

// Una richiesta del cliente per id (pagina di ritorno da Stripe).
export async function leggiRichiestaRevisione(admin: SupabaseClient, userId: string, id: string): Promise<RichiestaRevisione | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data, error } = await admin.from("omnia_ai_revisioni").select(COLONNE_RICHIESTA).eq("id", id).eq("user_id", userId).maybeSingle<RichiestaRevisione>();
  if (error && !schemaAssente(error)) console.error("Revisione umana: lettura della richiesta non riuscita", error.message);
  return data ?? null;
}
