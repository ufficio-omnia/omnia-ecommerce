// SOLO SUL RAMO anteprima/tender-intelligence-b3: primo comando di prebuild e di build (e del lanciatore locale).
// Se l'ambiente non è lo staging autorizzato con i servizi finti, esce con errore PRIMA di qualsiasi altro passo.
// Tre controlli, in quest'ordine:
//   1. nessun file d'ambiente nella cartella del progetto (su Vercel non ce ne sono; in locale un .env.local copiato
//      porterebbe la produzione: è la causa dell'incidente del 16/11);
//   2. le variabili (src/lib/anteprima-guardia-ambiente.ts: solo lettura, nessuna rete);
//   3. in rete, SOLO verso lo staging: le due chiavi devono essere accettate dal progetto di staging (una lettura di zero
//      righe, nessuna scrittura). Una chiave di un altro progetto risponde 401 e blocca.
// Stampa solo i nomi delle variabili, mai i valori.
import fs from "node:fs";
import path from "node:path";
import { STAGING_URL, erroriAmbienteAnteprima } from "../src/lib/anteprima-guardia-ambiente";

export function fileAmbienteNelProgetto(cartella: string): string[] {
  return fs.readdirSync(cartella).filter((f) => /^\.env(\..+)?$/.test(f) && f !== ".env.example");
}

export async function erroriChiaviSulloStaging(env: Record<string, string | undefined>, fetchFn: typeof fetch = fetch): Promise<string[]> {
  const errori: string[] = [];
  const prova = async (nome: string, indirizzo: string, chiave: string) => {
    try {
      const risposta = await fetchFn(indirizzo, { headers: { apikey: chiave, Authorization: `Bearer ${chiave}` }, signal: AbortSignal.timeout(15_000) });
      if (risposta.status !== 200) errori.push(`${nome} non è accettata dallo staging (risposta ${risposta.status})`);
    } catch {
      errori.push(`${nome}: lo staging non risponde (controllo non eseguibile, avvio bloccato)`);
    }
  };
  await prova("NEXT_PUBLIC_SUPABASE_ANON_KEY", `${STAGING_URL}/auth/v1/settings`, (env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "").trim());
  // limit=0: nessuna riga letta. Risponde 200 solo se la chiave di servizio appartiene allo staging.
  await prova("SUPABASE_SERVICE_ROLE_KEY", `${STAGING_URL}/rest/v1/radar_fonti_stato?select=*&limit=0`, (env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim());
  return errori;
}

async function principale() {
  const cartella = path.resolve(__dirname, "..");
  const errori = fileAmbienteNelProgetto(cartella).map((f) => `file d'ambiente «${f}» presente nella cartella del progetto`);
  errori.push(...erroriAmbienteAnteprima(process.env));
  if (!errori.length) errori.push(...(await erroriChiaviSulloStaging(process.env)));
  if (errori.length) {
    console.error("BUILD BLOCCATA — ambiente non autorizzato per l'anteprima di Tender Intelligence (solo Supabase Staging e servizi finti):");
    for (const x of errori) console.error(`  - ${x}`);
    process.exit(1);
  }
  console.log("Guardia dell'anteprima superata: Supabase Staging confermato, servizi esterni finti o spenti, nessun file d'ambiente.");
}

if (require.main === module) void principale();
