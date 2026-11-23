import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { cronAutorizzato } from "@/lib/cron-autorizzato";
import { eseguiImportazionePvl } from "@/lib/radar/importa-pvl";
import { portaGiroProgrammato } from "@/lib/radar/giro-programmato";

// Tender Intelligence: giri programmati dalla PVL di ANAC alle 8:05, 13:05 e 18:05 ora di Roma, tutti i giorni (piano 48C §3.2).
// NON è in vercel.json: le righe le mette il coordinamento al rilascio autorizzato (CRON_PROPOSTI in programmazione-calcoli.ts).
// Guardie in quest'ordine (48C §3.1), le prime tre PRIMA di qualunque lettura del database:
//   1. segreto del cron; 2. RADAR_PVL_CRON=attivo (spento di base); 3. porta oraria di Roma; poi nell'importatore: ambiente consentito
//   (oggi solo staging; la produzione arriva con le guardie del K8), fonte accesa dalla console, doppio richiamo, un giro alla volta, limiti verso la PVL.
// La risposta contiene solo numeri e motivi.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  if (!cronAutorizzato(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const porta = portaGiroProgrammato("pvl", process.env, new Date());
  if (!porta.passa) return NextResponse.json({ eseguita: false, motivo: porta.motivo }, { headers: { "Cache-Control": "no-store" } });
  let risultato: unknown;
  try {
    const esito = await eseguiImportazionePvl(createAdminClient(), { modo: "incrementale", tempoMassimoMs: 240_000 });
    risultato = esito.eseguita ? { eseguita: true, giroFinito: esito.giroFinito, sospesa: esito.sospesa, fermata: esito.fermata, statistiche: esito.statistiche, durataMs: esito.durataMs, errore: esito.errore } : esito;
  } catch {
    risultato = { eseguita: false, motivo: "errore_imprevisto" };
  }
  return NextResponse.json(risultato, { headers: { "Cache-Control": "no-store" } });
}
