import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { cronAutorizzato } from "@/lib/cron-autorizzato";
import { sincronizzaCalendario } from "@/lib/demo-calendario-sync";
import { inviaConversioniGa4 } from "@/lib/demo-ga4";
import { inviaConversioniAds } from "@/lib/demo-ads-data-manager";

// Chiamata ogni 10 minuti da Vercel Cron (vedi vercel.json). Tre passi INDIPENDENTI (un errore in uno non ferma gli altri), tutti
// spenti finché non si impostano le variabili e i flag descritti in GUIDA-DEMO-TRACCIAMENTO.md:
//   1. sincronizzazione del calendario: prenotazioni confermate → lead «confirmed» (o casi da verificare);
//   2. evento GA4 «demo_booking_confirmed» lato server, una volta per prenotazione;
//   3. conversione Google Ads «OMNIA AI - DEMO prenotata» (Data Manager API), in modalità «solo verifica» finché non si passa
//      a quella reale.
// La risposta contiene SOLO numeri e motivi, mai dati delle persone. Stessa autenticazione delle altre route cron.
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(request: NextRequest) {
  if (!cronAutorizzato(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const adesso = Date.now();
  const risultato: Record<string, unknown> = {};

  try {
    risultato.calendario = await sincronizzaCalendario(admin, process.env, adesso);
  } catch {
    risultato.calendario = { eseguita: false, motivo: "errore_imprevisto" };
  }
  try {
    risultato.ga4 = await inviaConversioniGa4(admin, process.env, adesso);
  } catch {
    risultato.ga4 = { abilitato: false, motivo: "errore_imprevisto" };
  }
  try {
    risultato.ads = await inviaConversioniAds(admin, process.env, adesso);
  } catch {
    risultato.ads = { abilitato: false, motivo: "errore_imprevisto" };
  }
  return NextResponse.json(risultato, { headers: { "Cache-Control": "no-store" } });
}
