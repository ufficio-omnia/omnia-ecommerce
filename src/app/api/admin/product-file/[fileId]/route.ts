import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/require-admin";

// Supabase Storage forza Content-Type: text/plain per i tipi "eseguibili
// dal browser" (html, svg, xml) come misura anti-XSS, anche se il file è
// stato caricato con il mimetype corretto: il browser mostra il sorgente
// invece di renderizzarlo. Questa rotta, riservata all'admin, riserve i
// bytes con il Content-Type giusto solo per l'anteprima di verifica.
const CONTENT_TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8",
  htm: "text/html; charset=utf-8",
  svg: "image/svg+xml",
  xml: "application/xml",
};

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ fileId: string }> },
) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "Non autorizzato." }, { status: 403 });
  }

  const { fileId } = await params;

  const admin = createAdminClient();
  const { data: file } = await admin
    .from("product_files")
    .select("file_path")
    .eq("id", fileId)
    .single<{ file_path: string }>();

  if (!file) {
    return NextResponse.json({ error: "File non trovato." }, { status: 404 });
  }

  const ext = file.file_path.split(".").pop()?.toLowerCase() ?? "";
  const contentType = CONTENT_TYPES[ext];

  if (!contentType) {
    return NextResponse.json(
      { error: "Tipo di file non supportato per l'anteprima." },
      { status: 400 },
    );
  }

  const { data: blob, error } = await admin.storage
    .from("documents")
    .download(file.file_path);

  if (error || !blob) {
    return NextResponse.json(
      { error: "Errore nel recupero del file." },
      { status: 500 },
    );
  }

  const buffer = Buffer.from(await blob.arrayBuffer());

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": "inline",
      "Cache-Control": "private, no-store",
      // Il file è caricato da admin, ma potrebbe comunque venire da fonti
      // terze: eseguirlo "sandboxed" impedisce a script/HTML potenzialmente
      // ostili di leggere cookie o fare richieste con la sessione admin.
      "Content-Security-Policy": "sandbox allow-scripts allow-forms allow-popups",
    },
  });
}
