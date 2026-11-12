// SOLO SUI BRANCH DI BENCHMARK: primo comando di prebuild e di build. Se l'ambiente non è lo staging autorizzato con i
// servizi esterni finti, esce con errore PRIMA di qualsiasi altro passo (nessuna rete, nessun database). Stampa solo nomi.
import { erroriAmbienteBenchmark } from "../src/lib/benchmark-guardia-ambiente";

const errori = erroriAmbienteBenchmark(process.env);
if (errori.length) {
  console.error("BUILD BLOCCATA — ambiente non autorizzato per il benchmark (solo Supabase Staging e servizi finti):");
  for (const x of errori) console.error(`  - ${x}`);
  process.exit(1);
}
console.log("Guardia del benchmark: ambiente di staging autorizzato.");
