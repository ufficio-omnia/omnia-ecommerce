import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { cronAutorizzato } from "@/lib/cron-autorizzato";
import { eseguiImportazioneTed } from "@/lib/radar/importa-ted";

// Tender Intelligence: importazione quotidiana da TED (giorni feriali, dopo l'uscita della Gazzetta europea; vedi vercel.json).
// Non fa NULLA finché la fonte TED è spenta dalla console (radar_fonti_stato.attiva) o le migrazioni 0109–0113 mancano: in produzione,
// prima di quelle, ogni chiamata finisce subito con «schema_assente». Un giro dura al massimo 4 minuti e 40 pagine; se non basta (recupero
// dello storico) riprende al giro dopo dal punto salvato. La risposta contiene solo numeri e motivi. Stessa autenticazione degli altri cron.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  if (!cronAutorizzato(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let risultato: unknown;
  try {
    const esito = await eseguiImportazioneTed(createAdminClient(), { tempoMassimoMs: 240_000, pagineMassime: 40 });
    risultato = esito.eseguita ? { eseguita: true, fase: esito.fase, giroFinito: esito.giroFinito, fermata: esito.fermata, totali: esito.totali, durataMs: esito.durataMs, errore: esito.errore } : esito;
  } catch {
    risultato = { eseguita: false, motivo: "errore_imprevisto" };
  }
  return NextResponse.json(risultato, { headers: { "Cache-Control": "no-store" } });
}
