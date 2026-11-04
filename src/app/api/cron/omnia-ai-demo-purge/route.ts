import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { cronAutorizzato } from "@/lib/cron-autorizzato";
import { eliminaDatiScaduti } from "@/lib/demo-leads";

// Conservazione dei dati delle richieste di demo, ogni giorno (vedi vercel.json): lead «pending» oltre 90 giorni, lead confermati o
// cancellati oltre 24 mesi, casi del calendario da verificare oltre 12 mesi (6 se risolti). Restituisce solo i numeri.
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!cronAutorizzato(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const esito = await eliminaDatiScaduti(createAdminClient(), new Date());
  return NextResponse.json(esito, { headers: { "Cache-Control": "no-store" } });
}
