// Autotest della disdetta di un abbonamento OMNIA AI: con un cambio di piano programmato (downgrade)
// Stripe rifiuta la disdetta diretta («managed by the subscription schedule», provato su Stripe di
// prova), quindi la disdetta deve prima annullare il cambio e poi registrarsi. Si prova con uno Stripe
// finto che si comporta come quello vero, l'ordine delle chiamate, gli errori, i testi e il collegamento.
// Gratuito, nessun database né rete: gira nel livello 1, quindi in prebuild.
import fs from "fs";
import path from "path";
import { AVVISO_CAMBIO_PIANO_ANNULLATO_CON_DISDETTA, disdiciSuStripe, testoConfermaDisdetta, type StripePerDisdetta } from "../src/lib/omnia-ai-disdetta";

const fallimenti: string[] = [];
function atteso(nome: string, ok: boolean, dettaglio = "") {
  console.log(`${ok ? "ok    " : "FALLITO"} ${nome}${ok ? "" : ` — ${dettaglio}`}`);
  if (!ok) fallimenti.push(nome);
}
function uguale<T>(nome: string, ottenuto: T, previsto: T) {
  atteso(nome, JSON.stringify(ottenuto) === JSON.stringify(previsto), `ottenuto ${JSON.stringify(ottenuto)}, previsto ${JSON.stringify(previsto)}`);
}
const leggi = (relativo: string) => fs.readFileSync(path.join(__dirname, "..", relativo), "utf-8").replace(/\r\n/g, "\n");
const primaDi = (sorgente: string, a: string, b: string) => sorgente.indexOf(a) !== -1 && sorgente.indexOf(b) !== -1 && sorgente.indexOf(a) < sorgente.indexOf(b);

// Stripe finto: uno stato solo, con il comportamento osservato su Stripe di prova.
type Schedule = string | { id: string } | null;
function stripeFinto(schedule: Schedule, guasti: { retrieve?: boolean; release?: boolean; update?: boolean } = {}) {
  const stato = { schedule, cancel_at_period_end: false };
  const chiamate: string[] = [];
  const stripe: StripePerDisdetta = {
    subscriptions: {
      retrieve: async (id) => {
        chiamate.push(`retrieve:${id}`);
        if (guasti.retrieve) throw new Error("guasto retrieve");
        return { schedule: stato.schedule };
      },
      update: async (id, params) => {
        chiamate.push(`update:${id}:${JSON.stringify(params)}`);
        if (guasti.update) throw new Error("guasto update");
        // il comportamento vero di Stripe con una schedule collegata
        if (stato.schedule !== null) throw new Error("The subscription is managed by the subscription schedule, and updating any cancelation behavior directly is not allowed.");
        stato.cancel_at_period_end = params.cancel_at_period_end;
        return {};
      },
    },
    subscriptionSchedules: {
      release: async (id) => {
        chiamate.push(`release:${id}`);
        if (guasti.release) throw new Error("guasto release");
        stato.schedule = null;
        return {};
      },
    },
  };
  return { stripe, stato, chiamate };
}
// Una disdetta che deve riuscire: un'eccezione diventa un controllo fallito con il suo messaggio,
// non un'interruzione dell'intero test.
async function disdici(stripe: StripePerDisdetta) {
  try {
    return { r: await disdiciSuStripe(stripe, "sub_1"), errore: null as string | null };
  } catch (e) {
    return { r: { cambioProgrammatoAnnullato: false }, errore: e instanceof Error ? e.message : String(e) };
  }
}
async function esito(f: () => Promise<unknown>): Promise<string> {
  try {
    await f();
    return "ok";
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

async function main() {
  console.log("--- Lo Stripe finto si comporta come quello vero ---");
  const prova = stripeFinto("sub_sched_1");
  atteso("la disdetta diretta con una schedule collegata è rifiutata (come su Stripe di prova)", /managed by the subscription schedule/.test(await esito(() => prova.stripe.subscriptions.update("sub_1", { cancel_at_period_end: true }))));

  console.log("--- Disdetta senza cambio di piano programmato ---");
  {
    const { stripe, stato, chiamate } = stripeFinto(null);
    const { r, errore } = await disdici(stripe);
    atteso("la disdetta riesce senza errori", errore === null, errore ?? "");
    uguale("legge l'abbonamento e registra la disdetta, nient'altro", chiamate, ["retrieve:sub_1", 'update:sub_1:{"cancel_at_period_end":true}']);
    uguale("disdetta registrata, cambio non annullato (non c'era)", [stato.cancel_at_period_end, r.cambioProgrammatoAnnullato], [true, false]);
  }

  console.log("--- Disdetta con un downgrade programmato ---");
  for (const [descrizione, schedule] of [["schedule come identificativo", "sub_sched_9"], ["schedule come oggetto espanso", { id: "sub_sched_9" }]] as const) {
    const { stripe, stato, chiamate } = stripeFinto(schedule);
    const { r, errore } = await disdici(stripe);
    atteso(`${descrizione}: la disdetta riesce senza errori`, errore === null, errore ?? "");
    uguale(`${descrizione}: prima annulla il cambio, poi registra la disdetta`, chiamate, ["retrieve:sub_1", "release:sub_sched_9", 'update:sub_1:{"cancel_at_period_end":true}']);
    uguale(`${descrizione}: disdetta registrata, schedule tolta, cambio annullato segnalato`, [stato.cancel_at_period_end, stato.schedule, r.cambioProgrammatoAnnullato], [true, null, true]);
  }

  console.log("--- Errori: mai una disdetta a metà non dichiarata ---");
  {
    const { stripe, stato, chiamate } = stripeFinto("sub_sched_9", { release: true });
    const e = await esito(() => disdiciSuStripe(stripe, "sub_1"));
    uguale("se il cambio non si annulla, la disdetta non viene nemmeno tentata e l'errore arriva a chi chiama", [e, chiamate.some((c) => c.startsWith("update")), stato.cancel_at_period_end], ["guasto release", false, false]);
  }
  {
    const { stripe, stato } = stripeFinto("sub_sched_9", { update: true });
    const e = await esito(() => disdiciSuStripe(stripe, "sub_1"));
    uguale("se la disdetta fallisce dopo l'annullamento del cambio, l'errore arriva a chi chiama (il cliente riprova)", [e, stato.cancel_at_period_end], ["guasto update", false]);
  }
  {
    const { stripe, chiamate } = stripeFinto("sub_sched_9", { retrieve: true });
    const e = await esito(() => disdiciSuStripe(stripe, "sub_1"));
    uguale("se Stripe non risponde non si tocca nulla", [e, chiamate], ["guasto retrieve", ["retrieve:sub_1"]]);
  }
  {
    // dopo l'annullamento del cambio, un secondo tentativo (senza più schedule) riesce
    const f = stripeFinto("sub_sched_9", { update: true });
    await esito(() => disdiciSuStripe(f.stripe, "sub_1"));
    const g = stripeFinto(f.stato.schedule);
    atteso("riprovando dopo il guasto la disdetta riesce (la schedule era già stata tolta)", (await esito(() => disdiciSuStripe(g.stripe, "sub_1"))) === "ok" && g.stato.cancel_at_period_end);
  }

  console.log("--- Testi per il cliente ---");
  const senza = testoConfermaDisdetta("14/11/2026", false);
  const con = testoConfermaDisdetta("14/11/2026", true);
  atteso("conferma senza cambio programmato: data, gare residue, crediti, nessun cenno al cambio", /fino al 14\/11\/2026/.test(senza) && /gare residue del piano/.test(senza) && /crediti aggiuntivi residui si estinguono/.test(senza) && !/cambio di piano/.test(senza));
  atteso("conferma con cambio programmato: dice che verrà annullato e che si resta sul piano attuale fino alla data", /cambio di piano programmato verrà annullato/.test(con) && /piano attuale fino al 14\/11\/2026 e poi termina/.test(con) && /crediti aggiuntivi residui/.test(con));
  atteso("senza data di rinnovo si usa «termine del periodo corrente»", /termine del periodo corrente/.test(testoConfermaDisdetta(null, true)));
  atteso("l'avviso dopo la disdetta dice che il cambio è annullato e l'abbonamento termina a fine periodo", /cambio di piano programmato è stato annullato/.test(AVVISO_CAMBIO_PIANO_ANNULLATO_CON_DISDETTA) && /poi termina/.test(AVVISO_CAMBIO_PIANO_ANNULLATO_CON_DISDETTA));

  console.log("--- Collegamento ---");
  const lib = leggi("src/lib/omnia-ai-disdetta.ts");
  atteso("la disdetta legge da Stripe se c'è una schedule (non dal database locale, che può essere in ritardo)", /stripe\.subscriptions\.retrieve\(stripeSubscriptionId\)/.test(lib) && !/supabase|createAdminClient|createClient/.test(lib));
  atteso("il cambio si toglie con release (la schedule sparisce, l'abbonamento resta com'è), mai con cancel (cancellerebbe l'abbonamento subito)", /subscriptionSchedules\.release\(scheduleId\)/.test(lib) && !/subscriptionSchedules\.cancel|subscriptions\.cancel\(/.test(lib));
  atteso("prima si toglie la schedule, poi si registra la disdetta", primaDi(lib, "subscriptionSchedules.release(scheduleId)", "subscriptions.update(stripeSubscriptionId, { cancel_at_period_end: true })"));
  atteso("la disdetta è a fine periodo (cancel_at_period_end), mai immediata", /cancel_at_period_end: true/.test(lib) && !/prorate|invoice_now|\.cancel\(/.test(lib));
  const azione = leggi("src/app/actions/omnia-ai-subscription.ts");
  const corpoDisdetta = azione.slice(azione.indexOf("export async function cancelOmniaAiSubscription"), azione.indexOf("export async function openOmniaAiBillingPortal"));
  atteso("l'azione passa dalla funzione di disdetta, dentro un try/catch con l'errore al cliente", /try \{[^}]*await disdiciSuStripe\(stripe, subscription\.stripe_subscription_id\);\s*\} catch \(err\) \{[^}]*Errore nella disdetta\. Riprova\./.test(corpoDisdetta.replace(/\/\/[^\n]*\n/g, "\n")));
  atteso("l'azione non chiama più Stripe direttamente per la disdetta", !/cancel_at_period_end/.test(corpoDisdetta.replace(/\/\/[^\n]*\n/g, "\n")) && !/subscriptions\.update/.test(corpoDisdetta));
  atteso("l'azione cerca l'abbonamento attivo del cliente che la chiama", /\.eq\("user_id", user\.id\)\s*\.eq\("status", "attivo"\)/.test(corpoDisdetta));
  const pagina = leggi("src/app/site-omnia-ai/dashboard/omnia-ai/abbonamento/page.tsx");
  atteso("la pagina dice al pulsante se c'è un cambio programmato", /<DisdiciAbbonamentoButton dataRinnovo=\{dataRinnovo\} cambioPianoProgrammato=\{!!subscription\.piano_programmato\} \/>/.test(pagina));
  const pulsante = leggi("src/app/site-omnia-ai/dashboard/omnia-ai/abbonamento/disdici-abbonamento-button.tsx");
  atteso("il pulsante chiede conferma con il testo che tiene conto del cambio programmato", /window\.confirm\(testoConfermaDisdetta\(dataRinnovo, cambioPianoProgrammato\)\)/.test(pulsante));
  atteso("dopo la disdetta il pulsante lo ricorda solo se c'era un cambio programmato", /\{cambioPianoProgrammato && ` \$\{AVVISO_CAMBIO_PIANO_ANNULLATO_CON_DISDETTA\}`\}/.test(pulsante));
  atteso("l'area cliente non rimanda alla console", ![lib, pagina, pulsante].some((t) => /console\.omniaitalia\.com|CONSOLE_BASE_URL|site-console|lib\/console/.test(t)));

  console.log("");
  if (fallimenti.length > 0) {
    console.error(`${fallimenti.length} controlli falliti:\n - ${fallimenti.join("\n - ")}`);
    process.exit(1);
  }
  console.log("Tutti i controlli sono andati a buon fine.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
