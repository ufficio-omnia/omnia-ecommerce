import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { cronAutorizzato } from "@/lib/cron-autorizzato";
import { eseguiImportazioneRegionale } from "@/lib/radar/importa-regionali";
import { FONTI_REGIONALI } from "@/lib/radar/importa-regionali-calcoli";

// Tender Intelligence, fase B2a: giri programmati delle fonti regionali (Sintel ogni giorno dopo il caricamento dei dati aperti, SardegnaCAT
// più volte al giorno). CONFIGURATI MA NON ATTIVI:
//   - questo percorso NON è in vercel.json (si aggiunge solo con l'autorizzazione del titolare al passaggio in produzione);
//   - anche se venisse chiamato, non fa nulla senza RADAR_REGIONALI_CRON=attivo nell'ambiente;
//   - poi valgono le guardie del giro: solo staging (ambiente.ts), fonte accesa dalla console, un giro alla volta (e il semaforo del
//     coordinamento), limiti verso la fonte. Ogni fonte fa al più un giro per chiamata.
// Stessa autenticazione degli altri cron. La risposta contiene solo numeri e motivi.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  if (!cronAutorizzato(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (process.env.RADAR_REGIONALI_CRON !== "attivo") {
    return NextResponse.json({ eseguita: false, motivo: "giri_programmati_non_attivi" }, { headers: { "Cache-Control": "no-store" } });
  }
  const risultati: Record<string, unknown> = {};
  for (const fonte of FONTI_REGIONALI) {
    try {
      const esito = await eseguiImportazioneRegionale(createAdminClient(), fonte, { tempoMassimoMs: 120_000 });
      risultati[fonte] = esito.eseguita ? { eseguita: true, invariataAllaFonte: esito.invariataAllaFonte, sospesa: esito.sospesa, statistiche: esito.statistiche, durataMs: esito.durataMs, errore: esito.errore } : esito;
    } catch {
      risultati[fonte] = { eseguita: false, motivo: "errore_imprevisto" };
    }
  }
  return NextResponse.json(risultati, { headers: { "Cache-Control": "no-store" } });
}
