import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { richiediTitolareAzione } from "@/lib/omnia-ai-account-guardie";
import { CHIAVE_PAGAMENTO, COLONNA_DATA_PER_FONTE, TABELLA_PER_FONTE, UUID, nomeFileFattura, percorsoFatturaPagamento } from "@/lib/omnia-ai-pagamenti";

// Scarica la fattura PDF di un pagamento dell'abbonamento (o di un acquisto di crediti).
//
// Chi può scaricarla: solo il cliente a cui il pagamento appartiene. La riga si legge con
// la SESSIONE del cliente (non con la chiave di servizio): la RLS restituisce solo le sue
// righe, e in più si filtra per il suo identificativo. Solo dopo, con la chiave di
// servizio, si firma un collegamento valido 60 secondi verso il file nel bucket privato:
// nessun indirizzo permanente del file esiste mai.
//
// La fattura si scarica solo se è segnata «fatturata» e il file c'è, e il percorso nel
// database deve essere esattamente quello previsto per quel pagamento (un valore diverso
// scritto per errore non porta mai a un altro file).

function nonTrovata() {
  return new NextResponse("Fattura non disponibile.", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
}

type Riga = { stato_fattura: string | null; numero_fattura: string | null; fattura_file_path: string | null; data: string };

export async function GET(request: NextRequest, { params }: { params: Promise<{ fonte: string; id: string }> }) {
  const { fonte, id } = await params;
  if (!CHIAVE_PAGAMENTO.test(fonte) || !UUID.test(id)) return nonTrovata();
  const origine = fonte as keyof typeof TABELLA_PER_FONTE;

  const supabase = await createClient();
  // Solo il titolare: i pagamenti e le fatture sono amministrazione (l'Ufficio Gare non li vede). Senza sessione,
  // al login; per l'Ufficio Gare (o un ruolo non verificabile) la fattura «non è disponibile».
  const guardia = await richiediTitolareAzione();
  if (!guardia.ok) {
    return guardia.errore.startsWith("Sessione scaduta") ? NextResponse.redirect(new URL("/login", request.url)) : nonTrovata();
  }
  const { user } = guardia;

  const colonnaData = COLONNA_DATA_PER_FONTE[origine];
  const { data: grezza } = await supabase
    .from(TABELLA_PER_FONTE[origine])
    .select(`stato_fattura, numero_fattura, fattura_file_path, ${colonnaData}`)
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle<Record<string, string | null>>();
  if (!grezza) return nonTrovata();

  const riga: Riga = { stato_fattura: grezza.stato_fattura, numero_fattura: grezza.numero_fattura, fattura_file_path: grezza.fattura_file_path, data: String(grezza[colonnaData] ?? "") };
  if (riga.stato_fattura !== "fatturata" || !riga.fattura_file_path) return nonTrovata();
  if (riga.fattura_file_path !== percorsoFatturaPagamento(origine, id)) {
    console.error("Fattura cliente: percorso inatteso nel database", origine, id);
    return nonTrovata();
  }

  const { data: firmato, error } = await createAdminClient()
    .storage.from("invoices")
    .createSignedUrl(riga.fattura_file_path, 60, { download: nomeFileFattura(riga.numero_fattura, riga.data) });
  if (error || !firmato) {
    console.error("Fattura cliente: collegamento di download non generato", error?.message);
    return new NextResponse("Errore nella generazione del collegamento di download.", { status: 500, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
  }

  const risposta = NextResponse.redirect(firmato.signedUrl, 307);
  risposta.headers.set("Cache-Control", "no-store");
  risposta.headers.set("X-Robots-Tag", "noindex");
  return risposta;
}
