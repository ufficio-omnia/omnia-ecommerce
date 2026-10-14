// Ripulisce, nel database, i dati del personale uscente già salvati (gare analizzate prima
// che esistesse il filtro di src/lib/personale-anonimo.ts) da codici fiscali, matricole e
// nominativi etichettati, e dai campi non previsti.
//
// SOLA LETTURA di default: mostra quante gare hanno qualcosa da togliere. Scrive solo con
//   npx tsx scripts/ripulisci-personale-uscente.ts --applica
// Stampa soltanto numeri e identificativi di gara, MAI il contenuto delle righe.
//
// ATTENZIONE: leggere i dati delle gare dei clienti è un accesso ai loro contenuti. Prima di
// eseguirlo registralo nella console (Accessi ai dati), caso «manutenzione o sicurezza»,
// «Tutti i clienti», con questo motivo e l'ambito «campo personale_uscente della tabella
// gare, script ripulisci-personale-uscente».
//
// Usa il database indicato da .env.local (quello reale): non è un test.
import { createClient } from "@supabase/supabase-js";
import { nessunIntervento, ripulisciPersonaleUscente, type InterventiPulizia } from "../src/lib/personale-anonimo";

type Gara = { id: string; personale_uscente: unknown };

async function main() {
  process.loadEnvFile(".env.local");
  const applica = process.argv.includes("--applica");
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

  const totali: InterventiPulizia = { vociScartate: 0, campiEstranei: 0, codiciFiscali: 0, matricole: 0, nominativi: 0 };
  const daAggiornare: { id: string; voci: ReturnType<typeof ripulisciPersonaleUscente>["voci"] }[] = [];
  let lette = 0;
  const PAGINA = 500;

  for (let da = 0; ; da += PAGINA) {
    const { data, error } = await admin.from("gare").select("id, personale_uscente").not("personale_uscente", "is", null).order("id").range(da, da + PAGINA - 1).returns<Gara[]>();
    if (error) throw new Error(`Lettura non riuscita: ${error.message}`);
    for (const gara of data ?? []) {
      lette++;
      const { voci, interventi } = ripulisciPersonaleUscente(gara.personale_uscente);
      if (nessunIntervento(interventi)) continue;
      for (const chiave of Object.keys(totali) as (keyof InterventiPulizia)[]) totali[chiave] += interventi[chiave];
      daAggiornare.push({ id: gara.id, voci });
    }
    if ((data?.length ?? 0) < PAGINA) break;
  }

  console.log(`Gare con personale uscente letto: ${lette}`);
  console.log(`Gare con qualcosa da togliere: ${daAggiornare.length}`);
  console.log("Cosa si toglierebbe (in totale):", totali);
  for (const g of daAggiornare) console.log(" - gara", g.id);

  if (!applica) {
    console.log(daAggiornare.length > 0 ? "\nNessuna modifica fatta. Per applicarla: --applica" : "\nNiente da ripulire.");
    return;
  }
  for (const g of daAggiornare) {
    const { error } = await admin.from("gare").update({ personale_uscente: g.voci }).eq("id", g.id);
    if (error) throw new Error(`Aggiornamento della gara ${g.id} non riuscito: ${error.message}`);
  }
  console.log(`\nAggiornate ${daAggiornare.length} gare.`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
