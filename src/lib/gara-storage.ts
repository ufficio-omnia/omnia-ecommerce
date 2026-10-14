import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";

// Ogni file di una gara (documenti caricati, allegati/generati in chat,
// logo cliente) finisce nel bucket "gare", sempre sotto il prefisso
// "<id gara>/"; le righe in gara_documenti/gara_messaggi/
// gara_messaggio_allegati/gare vengono cancellate a cascata dal DB quando
// si cancella la gara, ma i file nello storage no — vanno raccolti PRIMA
// (le righe che li referenziano stanno per sparire) e rimossi a parte.
//
// Il contratto (condizioni di abbonamento e Allegato A, art. 8) promette la
// cancellazione irreversibile di documenti e contenuti: per questo i file si
// raccolgono in due modi insieme — dalle righe del database E elencando il
// prefisso della gara nel bucket. Il secondo giro prende ciò che nessuna riga
// referenzia più (un logo sostituito da uno con altra estensione, un allegato
// caricato la cui riga non è stata salvata) ed è la rete di sicurezza contro
// un file dimenticato da una nuova tabella futura.

// Cartelle sotto il prefisso della gara in cui si guarda; più di così oggi non
// esiste (documenti e generati stanno alla radice, gli allegati della chat in
// "chat-allegati").
const SOTTOCARTELLE = ["", "chat-allegati"];
const PAGINA_ELENCO = 1000;

type VoceStorage = { name: string; id: string | null };

// Ciò che serve del bucket: elencare una cartella. Iniettabile per provare la logica senza rete.
export type ElencoBucket = {
  list(cartella: string, opzioni: { limit: number; offset: number }): PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>;
};

const bucketGare = (): ElencoBucket => createAdminClient().storage.from("gare") as unknown as ElencoBucket;

// File (non cartelle) presenti nel bucket sotto "<garaId>/" e nelle sue
// sottocartelle note. Un errore di elenco non blocca la cancellazione della
// gara: si registra e si prosegue con ciò che è stato raccolto dalle righe.
export async function percorsiSottoPrefisso(garaId: string, bucket: ElencoBucket = bucketGare()): Promise<string[]> {
  const trovati: string[] = [];

  for (const sotto of SOTTOCARTELLE) {
    const cartella = sotto ? `${garaId}/${sotto}` : garaId;
    for (let da = 0; ; da += PAGINA_ELENCO) {
      const { data, error } = await bucket.list(cartella, { limit: PAGINA_ELENCO, offset: da });
      if (error) {
        console.error(`Elenco file della gara ${garaId} (${cartella}) non riuscito:`, error.message);
        break;
      }
      const voci = (data ?? []) as VoceStorage[];
      // una cartella ha id null: i file hanno sempre un id
      for (const voce of voci) if (voce.id) trovati.push(`${cartella}/${voce.name}`);
      if (voci.length < PAGINA_ELENCO) break;
    }
  }

  return trovati;
}

export async function collectGaraFilePaths(
  client: SupabaseClient,
  garaId: string,
  bucket?: ElencoBucket,
): Promise<string[]> {
  const [{ data: docs }, { data: msgFiles }, { data: allegati }, { data: gara }] = await Promise.all([
    client.from("gara_documenti").select("file_path").eq("gara_id", garaId),
    client
      .from("gara_messaggi")
      .select("file_path")
      .eq("gara_id", garaId)
      .not("file_path", "is", null),
    client.from("gara_messaggio_allegati").select("file_path").eq("gara_id", garaId),
    client.from("gare").select("logo_cliente_path").eq("id", garaId).maybeSingle<{
      logo_cliente_path: string | null;
    }>(),
  ]);

  const paths = [...(docs ?? []), ...(msgFiles ?? []), ...(allegati ?? [])]
    .map((d) => d.file_path as string | null)
    .filter((p): p is string => Boolean(p));

  // Il giro sul prefisso usa la chiave di servizio, che vede tutto: lo si fa SOLO
  // se la gara risulta visibile al client chiamante (con la sessione di un cliente
  // la RLS restituisce la riga solo se la gara è sua). Senza questo vincolo, un
  // identificativo di gara altrui farebbe elencare — e poi cancellare — file non suoi.
  if (!gara) return [...new Set(paths)];

  if (gara.logo_cliente_path) {
    paths.push(gara.logo_cliente_path);
  }

  paths.push(...(await percorsiSottoPrefisso(garaId, bucket)));

  return [...new Set(paths)];
}

export async function removeGaraFiles(filePaths: string[]): Promise<void> {
  if (filePaths.length === 0) return;
  const admin = createAdminClient();
  const { error } = await admin.storage.from("gare").remove(filePaths);
  if (error) console.error("Rimozione dei file della gara non riuscita:", error.message);
}
