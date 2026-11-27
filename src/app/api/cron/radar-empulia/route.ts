import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { cronAutorizzato } from "@/lib/cron-autorizzato";
import { eseguiImportazioneRegionale } from "@/lib/radar/importa-regionali";
import { portaGiroProgrammato } from "@/lib/radar/giro-programmato";

// Tender Intelligence, Fase 2 (decisione dell'utente del 27/11: «correggiamo e mandiamo in produzione empulia e siaps»): giri programmati
// da EmPULIA (feed pubblicati dei bandi, a pagine, e delle consultazioni) alle 09:25, 13:25 e 17:25 ora di Roma nei giorni feriali e alle
// 13:25 il sabato e la domenica (programmazione-calcoli.ts). Stessa forma della rotta di TuttoGare. Guardie in quest'ordine (48C §3.1), le
// prime tre PRIMA di qualunque lettura del database: 1. segreto del cron; 2. RADAR_EMPULIA_CRON=attivo (spento di base); 3. porta oraria di
// Roma; poi nell'importatore: ambiente consentito (in produzione SOLO con RADAR_EMPULIA_PRODUZIONE=autorizzata), fonte accesa dalla console
// (la 0138 la crea spenta, nascosta ai clienti e col semaforo 2099), doppio richiamo, un giro alla volta, al più 18 richieste per giro
// (reindirizzamenti compresi; i limiti a pagine predefiniti).
// La risposta contiene solo numeri e motivi.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  if (!cronAutorizzato(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const porta = portaGiroProgrammato("empulia", process.env, new Date());
  if (!porta.passa) return NextResponse.json({ eseguita: false, motivo: porta.motivo }, { headers: { "Cache-Control": "no-store" } });
  let risultato: unknown;
  try {
    const esito = await eseguiImportazioneRegionale(createAdminClient(), "empulia", { tempoMassimoMs: 120_000 });
    risultato = esito.eseguita ? { eseguita: true, invariataAllaFonte: esito.invariataAllaFonte, sospesa: esito.sospesa, statistiche: esito.statistiche, durataMs: esito.durataMs, errore: esito.errore } : esito;
  } catch {
    risultato = { eseguita: false, motivo: "errore_imprevisto" };
  }
  return NextResponse.json(risultato, { headers: { "Cache-Control": "no-store" } });
}
