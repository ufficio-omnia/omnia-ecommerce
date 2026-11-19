import { richiediAdminPagina } from "@/lib/console/accesso";
import { nomeFilePdfEstratto } from "@/lib/console/accessi-dati-calcoli";
import { giornoValido, leggiEstratto } from "@/lib/console/accessi-dati-estratto";
import { creaPdfEstrattoAccessi } from "@/lib/console/accessi-dati-pdf";

// Estratto del registro degli accessi di un cliente in PDF: lo stesso file che parte allegato all'email al cliente (stesso
// periodo e stesse righe della pagina). Sostituisce la stampa dal browser, che tagliava la tabella. Solo admin, mai in cache.
function giornoItaliano(giorno: string | null): string | null {
  if (!giorno) return null;
  const [anno, mese, g] = giorno.split("-");
  return `${g}/${mese}/${anno}`;
}

export async function GET(richiesta: Request, { params }: { params: Promise<{ cliente: string }> }) {
  const sessione = await richiediAdminPagina();

  const { cliente } = await params;
  const url = new URL(richiesta.url);
  const dal = giornoValido(url.searchParams.get("dal") ?? undefined);
  const al = giornoValido(url.searchParams.get("al") ?? undefined);

  const estratto = await leggiEstratto(cliente, dal, al);
  if (estratto.stato === "id_non_valido") return new Response("Cliente non valido.", { status: 404, headers: { "cache-control": "no-store" } });
  if (estratto.stato === "tabella_assente") return new Response("Il registro non esiste ancora: eseguire la migrazione 0082.", { status: 503, headers: { "cache-control": "no-store" } });
  if (estratto.stato === "errore") return new Response(estratto.messaggio, { status: 500, headers: { "cache-control": "no-store" } });

  const emessoIl = new Date();
  const pdf = await creaPdfEstrattoAccessi({ cliente: estratto.cliente, righe: estratto.righe, periodo: { da: giornoItaliano(dal), a: giornoItaliano(al) }, emessoIl, operatore: sessione.email });
  return new Response(Buffer.from(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="${nomeFilePdfEstratto(emessoIl)}"`,
      "cache-control": "no-store",
    },
  });
}
