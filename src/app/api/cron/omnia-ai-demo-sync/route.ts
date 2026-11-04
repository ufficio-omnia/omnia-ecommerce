import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { cronAutorizzato } from "@/lib/cron-autorizzato";
import { eseguiCicloDemo } from "@/lib/demo-ciclo";

// Chiamata ogni 10 minuti da Vercel Cron (vedi vercel.json; una frequenza inferiore a un giorno richiede il piano Pro di Vercel, che
// questo progetto ha già: lo prova il cron «omnia-ai-email-retry» ogni 15 minuti). Un giro = sincronizzazione del calendario, evento GA4,
// conversione Google Ads (in modalità «solo verifica» finché non si passa a quella reale), tutto sotto un blocco contro le esecuzioni
// in parallelo: vedi src/lib/demo-ciclo.ts. Tutto spento finché non si impostano le variabili e i flag descritti in
// GUIDA-DEMO-TRACCIAMENTO.md. La risposta contiene SOLO numeri e motivi, mai dati delle persone. Stessa autenticazione delle altre
// route cron.
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(request: NextRequest) {
  if (!cronAutorizzato(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let risultato: unknown;
  try {
    risultato = await eseguiCicloDemo(createAdminClient(), process.env, Date.now());
  } catch {
    risultato = { eseguito: false, motivo: "errore_imprevisto" };
  }
  return NextResponse.json(risultato, { headers: { "Cache-Control": "no-store" } });
}
