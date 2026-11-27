// Prova con il modello VERO della rigenerazione di UNA notizia (generaParte), senza database: le righe di costo che
// andrebbero in ai_operazioni vengono scritte in un file JSON accanto all'uscita. Costa una piccola generazione.
// Uso: npx tsx scripts/newsletter-prova-parziale.ts <uscita.json>
import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";

process.loadEnvFile(path.join(process.cwd(), ".env.local"));
process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:9";
process.env.SUPABASE_SERVICE_ROLE_KEY = "nessuna";

async function main() {
  const uscita = process.argv[2];
  if (!uscita) throw new Error("Indica il file di uscita.");
  const { generaParte } = await import("../src/lib/newsletter/generazione");
  const { normalizzaContenuto } = await import("../src/lib/newsletter/contenuto");
  const ed = JSON.parse(fs.readFileSync("supabase/manuali/newsletter_edizione_001.json", "utf8"));
  const c = normalizzaContenuto(ed.contenuto);
  const normativa = c.sezioni.find((s) => s.chiave === "normativa")!;
  const righe: unknown[] = [];
  const inizio = Date.now();
  const r = await generaParte({
    dataEdizione: "2026-11-27",
    chiave: "normativa",
    notizia: normativa.notizie[2],
    altriTitoli: c.sezioni.flatMap((s) => s.notizie.map((n) => n.titolo)),
    indicazioni: "Scegli un'altra sentenza recente del Consiglio di Stato o di un TAR utile alle imprese.",
    contesto: { generazioneId: randomUUID(), tipo: "rigenerazione_notizia", edizioneId: "prova-locale", numeroEdizione: 1, versione: 99, registra: async (x) => void righe.push(x) },
  });
  fs.writeFileSync(uscita, JSON.stringify({ r, righe }, null, 2));
  console.log(`In ${Math.round((Date.now() - inizio) / 1000)} s: ${r.notizie.length} notizia, «${r.notizie[0]?.titolo}», costo ${r.uso.costoUsd.toFixed(4)} $, ${r.uso.ricerche} ricerche, ${righe.length} righe di costo.`);
}

main().catch((e) => {
  console.error("ERRORE:", e instanceof Error ? e.message : e, (e as { uso?: unknown }).uso ?? "");
  process.exit(1);
});
