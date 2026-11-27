// Genera una bozza di Tender Weekly con il motore della console (ricerca web + filtro deterministico delle fonti) e la
// scrive in un file JSON. NON scrive sul database: le variabili di Supabase vengono svuotate in questo processo, così
// anche il registro dei costi AI (logAiUsage) non tocca il DB condiviso (l'errore viene solo stampato). Costa una
// generazione del modello principale con ricerca web (ordine di 1 $).
//
// Uso: npx tsx scripts/newsletter-genera-bozza.ts <file-di-uscita.json> [AAAA-MM-GG]
import fs from "fs";
import path from "path";

process.loadEnvFile(path.join(process.cwd(), ".env.local"));
process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:9";
process.env.SUPABASE_SERVICE_ROLE_KEY = "nessuna";
process.env.OMNIA_AI_SCRIPT_PROVE = "1";

async function main() {
  const uscita = process.argv[2];
  if (!uscita) throw new Error("Indica il file di uscita.");
  const data = process.argv[3] ?? new Date().toISOString().slice(0, 10);
  const { generaEdizione } = await import("../src/lib/newsletter/generazione");
  const inizio = Date.now();
  const { randomUUID } = await import("crypto");
  const g = await generaEdizione({ dataEdizione: data, contesto: { generazioneId: randomUUID(), tipo: "generazione" } });
  fs.writeFileSync(uscita, JSON.stringify(g, null, 2));
  console.log(`Bozza scritta in ${uscita} in ${Math.round((Date.now() - inizio) / 1000)} s. Ricerche: ${g.ricerche}, fonti scartate: ${g.fontiScartate}, notizie tolte: ${g.notizieScartate}.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
