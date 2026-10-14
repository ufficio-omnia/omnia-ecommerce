import { richiediAdminPagina } from "@/lib/console/accesso";
import { costruisciCsvEstratto, righeEstratto } from "@/lib/console/accessi-dati-calcoli";
import { giornoValido, leggiEstratto } from "@/lib/console/accessi-dati-estratto";

// Estratto del registro degli accessi di un cliente in CSV (stesso periodo e stesse righe
// della pagina). Solo admin: senza sessione admin rimanda al login, come ogni pagina.
// Mai in cache: contiene dati di un cliente.
export async function GET(richiesta: Request, { params }: { params: Promise<{ cliente: string }> }) {
  await richiediAdminPagina();

  const { cliente } = await params;
  const url = new URL(richiesta.url);
  const dal = giornoValido(url.searchParams.get("dal") ?? undefined);
  const al = giornoValido(url.searchParams.get("al") ?? undefined);

  const estratto = await leggiEstratto(cliente, dal, al);
  if (estratto.stato === "id_non_valido") return new Response("Cliente non valido.", { status: 404, headers: { "cache-control": "no-store" } });
  if (estratto.stato === "tabella_assente") return new Response("Il registro non esiste ancora: eseguire la migrazione 0082.", { status: 503, headers: { "cache-control": "no-store" } });
  if (estratto.stato === "errore") return new Response(estratto.messaggio, { status: 500, headers: { "cache-control": "no-store" } });

  return new Response(costruisciCsvEstratto(righeEstratto(estratto.righe)), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="estratto-accessi-${estratto.cliente.id}.csv"`,
      "cache-control": "no-store",
    },
  });
}
