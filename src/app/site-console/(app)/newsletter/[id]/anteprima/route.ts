import { NextResponse } from "next/server";
import { richiediAdminPagina } from "@/lib/console/accesso";
import { archivioNewsletter } from "@/lib/newsletter/archivio";
import { renderNewsletterHtml, renderNewsletterTesto } from "@/lib/newsletter/template";

// Anteprima a pagina intera della versione SALVATA di un'edizione (HTML o, con ?formato=testo, la versione in testo
// semplice). Il link di disiscrizione è d'esempio: quello vero è personale e si crea solo all'invio.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  await richiediAdminPagina();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new NextResponse("Non trovata", { status: 404 });
  const e = await archivioNewsletter().leggiEdizione(id);
  if (!e) return new NextResponse("Non trovata", { status: 404 });
  const opz = { urlDisiscrizione: "https://omnia-ai.it/newsletter/disiscrizione" };
  const testo = new URL(request.url).searchParams.get("formato") === "testo";
  return new NextResponse(testo ? renderNewsletterTesto(e, opz) : renderNewsletterHtml(e, opz), {
    headers: { "Content-Type": `${testo ? "text/plain" : "text/html"}; charset=utf-8`, "Cache-Control": "no-store" },
  });
}
