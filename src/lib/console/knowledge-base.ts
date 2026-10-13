import { createAdminClient } from "@/lib/supabase/admin";
import { providerConfigurati } from "./stato-sistema";

// Lettura della knowledge base di OMNIA AI per la pagina omonima. Service role: da
// chiamare solo dopo richiediAdminPagina().

// Un documento «in elaborazione» da più di così è quasi certamente rimasto a metà
// (l'elaborazione è sincrona e ha un tetto di durata): lo si segnala, perché da solo
// non cambia più stato.
export const MINUTI_ELABORAZIONE_SOSPETTA = 15;

export type DocumentoKnowledgeBase = {
  id: string;
  nomeFile: string;
  stato: "in_elaborazione" | "pronto" | "errore" | string;
  creatoIl: string;
  notaStile: string | null;
  strutturaTitoli: string | null;
  // primi due pezzi del testo anonimizzato indicizzato; null per i documenti non pronti
  anteprima: string | null;
  minutiInElaborazione: number | null;
  immagini: number;
};

export type KnowledgeBaseLetta =
  | {
      stato: "ok";
      documenti: DocumentoKnowledgeBase[];
      // chiavi dei modelli che la pipeline usa e che in questo ambiente non ci sono
      chiaviMancanti: string[];
    }
  | { stato: "errore"; messaggio: string };

const CHIAVI_NECESSARIE = [
  { provider: "anthropic", etichetta: "ANTHROPIC_API_KEY (anonimizzazione e note di stile)" },
  { provider: "voyage", etichetta: "VOYAGE_API_KEY (indicizzazione)" },
];

export async function leggiKnowledgeBase(): Promise<KnowledgeBaseLetta> {
  const admin = createAdminClient();
  const documentiQ = await admin
    .from("knowledge_base_documenti")
    .select("id, nome_file, stato, created_at, nota_stile, struttura_titoli")
    .order("created_at", { ascending: false })
    .limit(2000);
  if (documentiQ.error) {
    console.error("Console: lettura della knowledge base fallita", documentiQ.error.message);
    return { stato: "errore", messaggio: "Lettura della knowledge base non riuscita." };
  }

  const documenti = (documentiQ.data ?? []) as { id: string; nome_file: string; stato: string; created_at: string; nota_stile: string | null; struttura_titoli: string | null }[];
  const pronti = documenti.filter((d) => d.stato === "pronto").map((d) => d.id);

  const [chunksQ, immaginiQ] = await Promise.all([
    pronti.length > 0
      ? admin.from("knowledge_base_chunks").select("documento_id, chunk_index, contenuto").in("documento_id", pronti).lt("chunk_index", 2).order("chunk_index", { ascending: true }).limit(5000)
      : Promise.resolve({ data: [], error: null }),
    admin.from("knowledge_base_immagini").select("documento_id").limit(20000),
  ]);
  if (chunksQ.error) console.error("Console: lettura delle anteprime della knowledge base fallita", chunksQ.error.message);

  const anteprime = new Map<string, string>();
  for (const c of (chunksQ.data ?? []) as { documento_id: string; contenuto: string }[]) {
    anteprime.set(c.documento_id, `${anteprime.get(c.documento_id) ?? ""} ${c.contenuto}`.trim());
  }
  const immaginiPerDocumento = new Map<string, number>();
  for (const i of (immaginiQ.data ?? []) as { documento_id: string }[]) immaginiPerDocumento.set(i.documento_id, (immaginiPerDocumento.get(i.documento_id) ?? 0) + 1);

  const adesso = Date.now();
  const presenti = new Set(providerConfigurati().map((p) => p.provider));

  return {
    stato: "ok",
    documenti: documenti.map((d) => ({
      id: d.id,
      nomeFile: d.nome_file,
      stato: d.stato,
      creatoIl: d.created_at,
      notaStile: d.nota_stile,
      strutturaTitoli: d.struttura_titoli,
      anteprima: anteprime.get(d.id) ?? null,
      minutiInElaborazione: d.stato === "in_elaborazione" ? Math.max(0, Math.round((adesso - new Date(d.created_at).getTime()) / 60_000)) : null,
      immagini: immaginiPerDocumento.get(d.id) ?? 0,
    })),
    chiaviMancanti: CHIAVI_NECESSARIE.filter((c) => !presenti.has(c.provider)).map((c) => c.etichetta),
  };
}
