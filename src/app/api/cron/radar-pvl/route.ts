import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { cronAutorizzato } from "@/lib/cron-autorizzato";
import { eseguiImportazionePvl } from "@/lib/radar/importa-pvl";
import { CRON_PVL_PROPOSTO, eOraDiUnGiroPvl } from "@/lib/radar/importa-pvl-calcoli";

// Tender Intelligence, fase B1-bis: giri programmati dalla PVL di ANAC alle 8:00, 13:00 e 18:00 ora italiana. CONFIGURATI MA NON ATTIVI:
//   - questo percorso NON è in vercel.json (le righe da aggiungere sono CRON_PVL_PROPOSTO: le due ore UTC possibili per ogni giro, così
//     l'ora legale è gestita qui, e parte solo il richiamo che a Roma cade all'ora giusta);
//   - anche se venisse chiamato, non fa nulla senza RADAR_PVL_CRON=attivo nell'ambiente (autorizzazione operativa del titolare);
//   - poi valgono le guardie del giro: solo staging (ambiente.ts), fonte accesa dalla console, un giro alla volta, limiti verso la PVL.
// Stessa autenticazione degli altri cron. La risposta contiene solo numeri e motivi.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  if (!cronAutorizzato(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (process.env.RADAR_PVL_CRON !== "attivo") {
    return NextResponse.json({ eseguita: false, motivo: "giri_programmati_non_attivi", pianificazione: CRON_PVL_PROPOSTO }, { headers: { "Cache-Control": "no-store" } });
  }
  if (!eOraDiUnGiroPvl(new Date())) {
    return NextResponse.json({ eseguita: false, motivo: "non_e_l_ora_italiana_di_un_giro" }, { headers: { "Cache-Control": "no-store" } });
  }
  let risultato: unknown;
  try {
    const esito = await eseguiImportazionePvl(createAdminClient(), { modo: "incrementale", tempoMassimoMs: 240_000 });
    risultato = esito.eseguita ? { eseguita: true, giroFinito: esito.giroFinito, sospesa: esito.sospesa, statistiche: esito.statistiche, durataMs: esito.durataMs, errore: esito.errore } : esito;
  } catch {
    risultato = { eseguita: false, motivo: "errore_imprevisto" };
  }
  return NextResponse.json(risultato, { headers: { "Cache-Control": "no-store" } });
}
