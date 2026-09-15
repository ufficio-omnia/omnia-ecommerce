import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";

// Ogni file di una gara (documenti caricati, allegati/generati in chat,
// logo cliente) finisce nel bucket "gare"; le righe in gara_documenti/
// gara_messaggi/gare vengono cancellate a cascata dal DB quando si
// cancella la gara, ma i file nello storage no — vanno raccolti PRIMA
// (le righe che li referenziano stanno per sparire) e rimossi a parte.
export async function collectGaraFilePaths(
  client: SupabaseClient,
  garaId: string,
): Promise<string[]> {
  const [{ data: docs }, { data: msgFiles }, { data: gara }] = await Promise.all([
    client.from("gara_documenti").select("file_path").eq("gara_id", garaId),
    client
      .from("gara_messaggi")
      .select("file_path")
      .eq("gara_id", garaId)
      .not("file_path", "is", null),
    client.from("gare").select("logo_cliente_path").eq("id", garaId).maybeSingle<{
      logo_cliente_path: string | null;
    }>(),
  ]);

  const paths = [...(docs ?? []), ...(msgFiles ?? [])]
    .map((d) => d.file_path as string | null)
    .filter((p): p is string => Boolean(p));

  if (gara?.logo_cliente_path) {
    paths.push(gara.logo_cliente_path);
  }

  return paths;
}

export async function removeGaraFiles(filePaths: string[]): Promise<void> {
  if (filePaths.length === 0) return;
  const admin = createAdminClient();
  await admin.storage.from("gare").remove(filePaths);
}
