import { richiediAdminPagina } from "@/lib/console/accesso";
import { leggiFatturazione } from "@/lib/console/fatturazione";
import { costruisciCsv, leggiFiltroFattura } from "@/lib/console/fatturazione-calcoli";
import { dataRoma } from "@/lib/console/giorni-lavorativi";

// Esportazione CSV dell'elenco «Da fatturare», con gli stessi filtri della pagina
// (?stato=…&prova=1). Solo admin: senza sessione admin rimanda al login, come ogni
// pagina. Mai in cache: contiene dati di fatturazione dei clienti.
export async function GET(richiesta: Request) {
  await richiediAdminPagina();

  const url = new URL(richiesta.url);
  const filtro = leggiFiltroFattura(url.searchParams.get("stato") ?? undefined);
  const dati = await leggiFatturazione({ includiProva: url.searchParams.get("prova") === "1" });
  if (dati.stato === "errore") return new Response(dati.messaggio, { status: 500 });

  const righe = filtro === "tutte" ? dati.righe : dati.righe.filter((r) => r.stato === filtro);
  return new Response(costruisciCsv(righe), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="da-fatturare-${filtro}-${dataRoma(new Date())}.csv"`,
      "cache-control": "no-store",
    },
  });
}
