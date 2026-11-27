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
  const a = archivioNewsletter();
  const e = await a.leggiEdizione(id);
  if (!e) return new NextResponse("Non trovata", { status: 404 });
  // ?versione=N: il testo di una versione dello storico (stesso numero e data dell'edizione)
  const n = Number(new URL(request.url).searchParams.get("versione"));
  if (Number.isInteger(n) && n > 0) {
    const v = (await a.elencoVersioni(id)).find((x) => x.numero_versione === n);
    if (!v || !v.contenuto) return new NextResponse("Versione non trovata", { status: 404 });
    Object.assign(e, { oggetto: v.oggetto ?? "", preheader: v.preheader ?? "", contenuto: v.contenuto });
  }
  const opz = { urlDisiscrizione: "https://omnia-ai.it/newsletter/disiscrizione" };
  const testo = new URL(request.url).searchParams.get("formato") === "testo";
  return new NextResponse(testo ? renderNewsletterTesto(e, opz) : renderNewsletterHtml(e, opz), {
    headers: { "Content-Type": `${testo ? "text/plain" : "text/html"}; charset=utf-8`, "Cache-Control": "no-store" },
  });
}
