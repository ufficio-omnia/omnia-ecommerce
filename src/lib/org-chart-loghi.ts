import sharp from "sharp";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { LoghiOrganigramma } from "@/lib/org-chart";

async function caricaLogo(
  bucket: string,
  path: string | null,
): Promise<{ base64: string; width: number; height: number } | undefined> {
  if (!path) return undefined;

  const admin = createAdminClient();
  const { data: file, error } = await admin.storage.from(bucket).download(path);
  if (error || !file) return undefined;

  const buffer = Buffer.from(await file.arrayBuffer());
  const metadata = await sharp(buffer).metadata();
  if (!metadata.width || !metadata.height) return undefined;

  // Convertiamo sempre in PNG: l'organigramma è un unico file PNG e "img"
  // (via data URI) nell'SVG richiede sapere il tipo — normalizzarlo
  // evita di dover propagare il content-type originale (png/jpeg/webp).
  const png = await sharp(buffer).png().toBuffer();

  return { base64: png.toString("base64"), width: metadata.width, height: metadata.height };
}

// Recupera i loghi reali da inserire nell'organigramma: aziendale e del
// software gestionale sono fissi sul profilo azienda dell'utente, quello
// del cliente/stazione appaltante è specifico della singola gara.
// Nessuno è obbligatorio: un logo mancante viene semplicemente omesso
// dal disegno, non è un errore.
export async function recuperaLoghiOrganigramma(garaId: string): Promise<LoghiOrganigramma> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return {};

  const [{ data: company }, { data: gara }] = await Promise.all([
    supabase
      .from("companies")
      .select("logo_path, software_logo_path")
      .eq("user_id", user.id)
      .maybeSingle<{ logo_path: string | null; software_logo_path: string | null }>(),
    supabase
      .from("gare")
      .select("logo_cliente_path")
      .eq("id", garaId)
      .maybeSingle<{ logo_cliente_path: string | null }>(),
  ]);

  const [aziendale, software, cliente] = await Promise.all([
    caricaLogo("company-assets", company?.logo_path ?? null),
    caricaLogo("company-assets", company?.software_logo_path ?? null),
    caricaLogo("gare", gara?.logo_cliente_path ?? null),
  ]);

  return { aziendale, software, cliente };
}
