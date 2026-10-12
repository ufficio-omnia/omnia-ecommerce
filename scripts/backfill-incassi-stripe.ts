// Recupero degli incassi degli abbonamenti OMNIA AI già avvenuti, dal conto Stripe
// di OMNIA AI alla tabella omnia_ai_incassi (migrazione 0078).
//
// A COSA SERVE. Il webhook registra gli incassi solo da quando l'evento
// invoice.paid è attivo sulla destinazione di OMNIA AI. I pagamenti precedenti
// (primo pagamento, rinnovi, conguagli) vanno recuperati da Stripe: questo script
// li legge e li registra con la STESSA funzione del webhook (incassoDaFattura), così
// un incasso recuperato è identico a uno arrivato in tempo reale. È idempotente:
// ogni fattura ha una riga sola, quindi si può rilanciare senza duplicare.
//
// COME SI USA (dalla radice del progetto):
//   npx tsx scripts/backfill-incassi-stripe.ts            → PROVA: legge da Stripe e mostra cosa
//                                                            registrerebbe, senza scrivere nulla
//   npx tsx scripts/backfill-incassi-stripe.ts --esegui   → registra davvero nel database
//
// Legge STRIPE_SECRET_KEY_OMNIA_AI da .env.local: con una chiave di prova recupera i
// pagamenti di prova (livemode=false), con una chiave live quelli veri. Su Stripe fa
// SOLO letture. Il database di .env.local è quello di produzione: con --esegui
// scrive lì. La prova (senza --esegui) non stampa dati personali dei clienti.
import Stripe from "stripe";
import { incassoDaFattura, registraIncassoDaFattura } from "../src/lib/omnia-ai-incassi";

process.loadEnvFile(".env.local");

async function main() {
  const esegui = process.argv.includes("--esegui");
  const chiave = process.env.STRIPE_SECRET_KEY_OMNIA_AI;
  if (!chiave) throw new Error("STRIPE_SECRET_KEY_OMNIA_AI mancante in .env.local");
  const livemode = /^[sr]k_live_/.test(chiave);
  console.log(`Conto Stripe di OMNIA AI: modalità ${livemode ? "LIVE (pagamenti veri)" : "di PROVA"}. ${esegui ? "SCRIVO nel database." : "Prova: non scrivo nulla."}\n`);

  const stripe = new Stripe(chiave);
  const { createAdminClient } = await import("../src/lib/supabase/admin");
  const admin = createAdminClient();

  let lette = 0;
  const saltate = { senzaAbbonamento: 0, importoZero: 0 };
  const perTipo: Record<string, { n: number; centesimi: number }> = {};
  let conImposte = 0;
  let primaData: string | null = null;
  let ultimaData: string | null = null;
  const esiti: Record<string, number> = {};

  for await (const fattura of stripe.invoices.list({ status: "paid", limit: 100 })) {
    lette++;
    const incasso = incassoDaFattura(fattura, livemode);
    if (!incasso) {
      if ((fattura.amount_paid ?? 0) <= 0) saltate.importoZero++;
      else saltate.senzaAbbonamento++;
      continue;
    }
    const riga = (perTipo[incasso.tipo] ??= { n: 0, centesimi: 0 });
    riga.n++;
    riga.centesimi += incasso.importo_lordo_centesimi;
    if (incasso.imposta_centesimi !== null) conImposte++;
    if (!primaData || incasso.pagato_il < primaData) primaData = incasso.pagato_il;
    if (!ultimaData || incasso.pagato_il > ultimaData) ultimaData = incasso.pagato_il;

    if (esegui) {
      const esito = await registraIncassoDaFattura(admin, fattura, livemode);
      esiti[esito.stato] = (esiti[esito.stato] ?? 0) + 1;
      if (esito.stato === "errore") console.error(`  errore su ${fattura.id}: ${esito.messaggio}`);
      if (esito.stato === "tabella_assente") throw new Error("La tabella omnia_ai_incassi non esiste: eseguire prima la migrazione 0078.");
    }
  }

  console.log(`Fatture pagate lette da Stripe: ${lette}`);
  console.log(`Saltate: ${saltate.senzaAbbonamento} non di abbonamento, ${saltate.importoZero} a importo zero`);
  console.log("Incassi di abbonamento:");
  for (const [tipo, v] of Object.entries(perTipo)) console.log(`  ${tipo.padEnd(11)} ${String(v.n).padStart(4)}  ${(v.centesimi / 100).toLocaleString("it-IT", { style: "currency", currency: "EUR" })} lordi`);
  console.log(`Con imposte calcolate da Stripe: ${conImposte} su ${Object.values(perTipo).reduce((s, v) => s + v.n, 0)}`);
  if (primaData && ultimaData) console.log(`Periodo coperto: ${primaData.slice(0, 10)} → ${ultimaData.slice(0, 10)}`);
  if (esegui) console.log("\nEsito della scrittura:", esiti);
  else console.log("\nProva conclusa: nessuna scrittura. Rilancia con --esegui per registrare.");
}

main().catch((errore) => {
  console.error(errore);
  process.exit(1);
});
