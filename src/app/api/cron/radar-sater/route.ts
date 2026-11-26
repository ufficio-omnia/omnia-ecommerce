import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { cronAutorizzato } from "@/lib/cron-autorizzato";
import { eseguiImportazioneRegionale } from "@/lib/radar/importa-regionali";
import { portaGiroProgrammato } from "@/lib/radar/giro-programmato";

// Tender Intelligence, Fase 2 (decisione dell'utente del 26/11: SATER in produzione): giri programmati da SATER (API del portale
// Intercent-ER) alle 08:50, 12:50 e 16:50 ora di Roma nei giorni feriali e alle 12:50 il sabato e la domenica (programmazione-calcoli.ts).
// Stessa forma di radar-sardegnacat. Guardie in quest'ordine (48C §3.1), le prime tre PRIMA di qualunque lettura del database:
//   1. segreto del cron; 2. RADAR_SATER_CRON=attivo (spento di base); 3. porta oraria di Roma; poi nell'importatore: ambiente consentito
//   (in produzione SOLO con RADAR_SATER_PRODUZIONE=autorizzata), fonte accesa dalla console (la 0134 la crea spenta e nascosta ai clienti),
//   doppio richiamo, un giro alla volta, limiti verso la fonte.
// La risposta contiene solo numeri e motivi.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  if (!cronAutorizzato(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const porta = portaGiroProgrammato("sater", process.env, new Date());
  if (!porta.passa) return NextResponse.json({ eseguita: false, motivo: porta.motivo }, { headers: { "Cache-Control": "no-store" } });
  let risultato: unknown;
  try {
    const esito = await eseguiImportazioneRegionale(createAdminClient(), "sater", { tempoMassimoMs: 120_000 });
    risultato = esito.eseguita ? { eseguita: true, invariataAllaFonte: esito.invariataAllaFonte, sospesa: esito.sospesa, statistiche: esito.statistiche, durataMs: esito.durataMs, errore: esito.errore } : esito;
  } catch {
    risultato = { eseguita: false, motivo: "errore_imprevisto" };
  }
  return NextResponse.json(risultato, { headers: { "Cache-Control": "no-store" } });
}
