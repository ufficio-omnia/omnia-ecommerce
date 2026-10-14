import { NextResponse } from "next/server";
import { richiediAdminPagina } from "@/lib/console/accesso";
import { createAdminClient } from "@/lib/supabase/admin";
import { CHIAVE_PAGAMENTO, TABELLA_PER_FONTE, UUID, nomeFileFattura, percorsoFatturaPagamento } from "@/lib/omnia-ai-pagamenti";

// Apre il PDF della fattura caricato su un pagamento, per l'admin (controllo di quello
// che vedrà il cliente). Senza sessione admin rimanda al login, come ogni pagina. Il
// file sta nel bucket privato «invoices»: si firma un collegamento valido 60 secondi,
// mai un indirizzo permanente. Il percorso nel database deve essere esattamente quello
// previsto per quel pagamento.

function nonTrovata() {
  return new NextResponse("Fattura non disponibile.", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
}

export async function GET(_richiesta: Request, { params }: { params: Promise<{ fonte: string; id: string }> }) {
  await richiediAdminPagina();

  const { fonte, id } = await params;
  if (!CHIAVE_PAGAMENTO.test(fonte) || !UUID.test(id)) return nonTrovata();
  const origine = fonte as keyof typeof TABELLA_PER_FONTE;

  const colonnaData = origine === "incasso" ? "pagato_il" : "created_at";
  const admin = createAdminClient();
  const { data: riga } = await admin
    .from(TABELLA_PER_FONTE[origine])
    .select(`numero_fattura, fattura_file_path, ${colonnaData}`)
    .eq("id", id)
    .maybeSingle<Record<string, string | null>>();
  if (!riga?.fattura_file_path) return nonTrovata();
  if (riga.fattura_file_path !== percorsoFatturaPagamento(origine, id)) {
    console.error("Console: percorso inatteso del PDF fattura nel database", origine, id);
    return nonTrovata();
  }

  const { data: firmato, error } = await admin.storage.from("invoices").createSignedUrl(riga.fattura_file_path, 60, {
    download: nomeFileFattura(riga.numero_fattura, String(riga[colonnaData] ?? "")),
  });
  if (error || !firmato) {
    console.error("Console: collegamento di download del PDF fattura non generato", error?.message);
    return new NextResponse("Errore nella generazione del collegamento di download.", { status: 500, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
  }

  const risposta = NextResponse.redirect(firmato.signedUrl, 307);
  risposta.headers.set("Cache-Control", "no-store");
  risposta.headers.set("X-Robots-Tag", "noindex");
  return risposta;
}
