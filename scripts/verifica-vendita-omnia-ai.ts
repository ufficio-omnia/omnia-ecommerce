// Autotest della messa in vendita degli abbonamenti di OMNIA AI:
//   - il pulsante «Abbonati» su /piani compare solo con l'interruttore acceso in console E la chiave Stripe reale;
//   - i controlli sulla configurazione di Stripe (eventi del webhook mancanti o doppi, prezzi, portale);
//   - la creazione dei prezzi mancanti (mai toccare quelli esistenti, nessun doppione);
//   - le azioni della console (si accende solo se tutto passa, si spegne sempre) e le pagine.
// Gratuito, nessun database né rete: gira nel livello 1, quindi in prebuild.
import fs from "fs";
import path from "path";
import {
  CHIAVE_VENDITA,
  interpretaInterruttoreVendita,
  leggiInterruttoreVendita,
  modalitaChiaveStripe,
  venditaAbbonamentiVisibile,
  venditaVisibile,
} from "../src/lib/omnia-ai-vendita";
import {
  EVENTI_ATTESI,
  analizzaWebhook,
  motiviCheImpedisconoLaVendita,
  pianiConPrezzoDaCreare,
  type DestinazioneWebhook,
  type PianoDaControllare,
  type StatoWebhook,
} from "../src/lib/console/controllo-stripe-calcoli";
import { NOME_PRODOTTO_ABBONAMENTO, creaPrezziSuStripe, type StripeCreaPrezzi } from "../src/lib/console/crea-prezzi-stripe";

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

async function main() {
  console.log("--- Modalità della chiave Stripe ---");
  uguale(
    "chiavi segrete e limitate, reali e di prova; il resto non è riconosciuto",
    ["sk_live_abc", "rk_live_abc", "sk_test_abc", "rk_test_abc", undefined, null, "", "pk_live_abc", "sk_abc", "SK_LIVE_x"].map(modalitaChiaveStripe),
    ["reale", "reale", "prova", "prova", "sconosciuta", "sconosciuta", "sconosciuta", "sconosciuta", "sconosciuta", "sconosciuta"],
  );

  console.log("--- Interruttore e visibilità ---");
  uguale("solo «1» è acceso", ["1", "0", "", null, undefined, "true", " 1", "01", "si"].map(interpretaInterruttoreVendita), [true, false, false, false, false, false, false, false, false]);
  uguale(
    "visibile solo con interruttore acceso E chiave reale",
    [
      venditaVisibile({ interruttore: true, modalita: "reale" }),
      venditaVisibile({ interruttore: true, modalita: "prova" }),
      venditaVisibile({ interruttore: true, modalita: "sconosciuta" }),
      venditaVisibile({ interruttore: false, modalita: "reale" }),
      venditaVisibile({ interruttore: false, modalita: "prova" }),
      venditaVisibile({ interruttore: false, modalita: "sconosciuta" }),
    ],
    [true, false, false, false, false, false],
  );
  const fintoDb = (risposta: { data: { valore: string } | null; error: { message: string } | null } | "lancia") => {
    const chiamate: string[] = [];
    return {
      chiamate,
      client: {
        from: (tabella: string) => ({
          select: (colonne: string) => ({
            eq: (colonna: string, valore: string) => ({
              maybeSingle: () => {
                chiamate.push(`${tabella}|${colonne}|${colonna}=${valore}`);
                if (risposta === "lancia") throw new Error("rete caduta");
                return Promise.resolve(risposta);
              },
            }),
          }),
        }),
      },
    };
  };
  const acceso = fintoDb({ data: { valore: "1" }, error: null });
  uguale("legge la chiave giusta della tabella delle impostazioni", [await leggiInterruttoreVendita(acceso.client), acceso.chiamate], [true, [`console_impostazioni|valore|chiave=${CHIAVE_VENDITA}`]]);
  uguale(
    "spento, assente, errore o rete caduta = spento (nel dubbio non si vende)",
    [
      await leggiInterruttoreVendita(fintoDb({ data: { valore: "0" }, error: null }).client),
      await leggiInterruttoreVendita(fintoDb({ data: null, error: null }).client),
      await leggiInterruttoreVendita(fintoDb({ data: null, error: { message: "relation does not exist" } }).client),
      await leggiInterruttoreVendita(fintoDb("lancia").client),
    ],
    [false, false, false, false],
  );
  const chiaveOriginale = process.env.STRIPE_SECRET_KEY_OMNIA_AI;
  try {
    process.env.STRIPE_SECRET_KEY_OMNIA_AI = "sk_test_finta";
    const conProva = await venditaAbbonamentiVisibile();
    delete process.env.STRIPE_SECRET_KEY_OMNIA_AI;
    const senzaChiave = await venditaAbbonamentiVisibile();
    uguale("con la chiave di prova o senza chiave la pagina non mostra «Abbonati» e non legge il database", [conProva, senzaChiave], [false, false]);
  } finally {
    if (chiaveOriginale === undefined) delete process.env.STRIPE_SECRET_KEY_OMNIA_AI;
    else process.env.STRIPE_SECRET_KEY_OMNIA_AI = chiaveOriginale;
  }
  const lib = leggi("src/lib/omnia-ai-vendita.ts");
  atteso("con la chiave non reale si esce prima di leggere il database", primaDi(lib, 'if (modalita !== "reale") return false;', "leggiInterruttoreVendita()") && /venditaVisibile\(\{ interruttore: await leggiInterruttoreVendita\(\), modalita \}\)/.test(lib));
  atteso("l'interruttore usa la tabella delle impostazioni esistente (nessuna migrazione)", /from\("console_impostazioni"\)/.test(lib) && !/create table/i.test(lib));

  console.log("--- Eventi del webhook ---");
  const destinazione = (url: string, eventi: string[], stato = "enabled"): DestinazioneWebhook => ({ url, stato, eventi });
  const tutti = [...EVENTI_ATTESI];
  uguale("gli eventi attesi sono i nove che il codice gestisce", [...EVENTI_ATTESI].sort(), ["checkout.session.completed", "customer.subscription.deleted", "customer.subscription.updated", "customer.updated", "invoice.paid", "invoice.payment_failed", "subscription_schedule.created", "subscription_schedule.released", "subscription_schedule.updated"].sort());
  uguale("una destinazione con tutti gli eventi: a posto", analizzaWebhook([destinazione("https://omnia-ai.it/api/webhooks/stripe", tutti)]), { mancanti: [], doppi: [] });
  uguale("un evento che non arriva a nessuno è «mancante»", analizzaWebhook([destinazione("https://a", tutti.filter((e) => e !== "invoice.paid" && e !== "customer.updated"))]).mancanti, ["invoice.paid", "customer.updated"]);
  uguale("nessuna destinazione: mancano tutti e nove", analizzaWebhook([]).mancanti.length, 9);
  uguale("due destinazioni che si dividono gli eventi senza sovrapporsi: a posto", analizzaWebhook([destinazione("https://app", ["checkout.session.completed"]), destinazione("https://ai", tutti.filter((e) => e !== "checkout.session.completed"))]), { mancanti: [], doppi: [] });
  uguale("lo stesso evento su due destinazioni attive è «doppio» (verrebbe elaborato due volte)", analizzaWebhook([destinazione("https://app", ["checkout.session.completed", "invoice.paid"]), destinazione("https://ai", tutti)]).doppi, [
    { evento: "checkout.session.completed", url: ["https://app", "https://ai"] },
    { evento: "invoice.paid", url: ["https://app", "https://ai"] },
  ]);
  uguale("una destinazione disattivata non conta, né come mancante né come doppia", analizzaWebhook([destinazione("https://vecchia", tutti, "disabled"), destinazione("https://ai", tutti)]), { mancanti: [], doppi: [] });
  uguale("solo disattivate: mancano tutti", analizzaWebhook([destinazione("https://vecchia", tutti, "disabled")]).mancanti.length, 9);
  uguale("«*» riceve tutto: nessun evento manca, ma con un'altra destinazione gli eventi sono doppi", [analizzaWebhook([destinazione("https://tutto", ["*"])]), analizzaWebhook([destinazione("https://tutto", ["*"]), destinazione("https://altra", ["invoice.paid"])]).doppi.map((d) => d.evento)], [{ mancanti: [], doppi: [] }, ["invoice.paid"]]);
  uguale("gli eventi che non sono tra quelli attesi si ignorano", analizzaWebhook([destinazione("https://app", [...tutti, "charge.refunded", "payment_intent.succeeded"]), destinazione("https://altro", ["charge.refunded"])]), { mancanti: [], doppi: [] });

  console.log("--- Prezzi dei piani ---");
  const piano = (slug: PianoDaControllare["slug"], stato: PianoDaControllare["stato"], listino = 69900): PianoDaControllare => ({ slug, nome: slug === "starter" ? "Starter" : slug === "professional" ? "Professional" : "Enterprise", listinoCentesimi: listino, stato });
  uguale("si creano solo i prezzi assenti: non quelli diversi dal listino, né quelli non leggibili", pianiConPrezzoDaCreare([piano("starter", "assente"), piano("professional", "disallineato"), piano("enterprise", "errore")]).map((p) => p.slug), ["starter"]);
  uguale("tutti allineati: niente da creare", pianiConPrezzoDaCreare([piano("starter", "allineato"), piano("professional", "allineato"), piano("enterprise", "allineato")]), []);

  console.log("--- Si può accendere la vendita? ---");
  const tuttoOk: { modalita: "reale"; piani: PianoDaControllare[]; webhook: StatoWebhook } = { modalita: "reale", piani: [piano("starter", "allineato"), piano("professional", "allineato"), piano("enterprise", "allineato")], webhook: { verificabile: true, mancanti: [], doppi: [] } };
  uguale("tutto a posto: nessun motivo", motiviCheImpedisconoLaVendita(tuttoOk), []);
  atteso("chiave di prova: non si accende", motiviCheImpedisconoLaVendita({ ...tuttoOk, modalita: "prova" }).some((m) => /modalità reale/.test(m)));
  atteso("chiave non riconosciuta: non si accende", motiviCheImpedisconoLaVendita({ ...tuttoOk, modalita: "sconosciuta" }).length === 1);
  atteso("prezzo mancante: non si accende, e dice come rimediare", motiviCheImpedisconoLaVendita({ ...tuttoOk, piani: [piano("starter", "assente"), ...tuttoOk.piani.slice(1)] }).some((m) => /manca il prezzo del piano Starter/.test(m) && /Crea i prezzi mancanti/.test(m)));
  atteso("prezzo diverso dal listino: non si accende", motiviCheImpedisconoLaVendita({ ...tuttoOk, piani: [tuttoOk.piani[0], piano("professional", "disallineato"), tuttoOk.piani[2]] }).some((m) => /Professional/.test(m) && /diverso dal listino/.test(m)));
  atteso("prezzo non leggibile: non si accende", motiviCheImpedisconoLaVendita({ ...tuttoOk, piani: [tuttoOk.piani[0], tuttoOk.piani[1], piano("enterprise", "errore")] }).some((m) => /Enterprise/.test(m) && /leggere/.test(m)));
  atteso("eventi del webhook mancanti: non si accende", motiviCheImpedisconoLaVendita({ ...tuttoOk, webhook: { verificabile: true, mancanti: ["invoice.paid"], doppi: [] } }).some((m) => /invoice\.paid/.test(m)));
  atteso("eventi doppi: non si accende", motiviCheImpedisconoLaVendita({ ...tuttoOk, webhook: { verificabile: true, mancanti: [], doppi: [{ evento: "checkout.session.completed", url: ["a", "b"] }] } }).some((m) => /checkout\.session\.completed/.test(m) && /due volte/.test(m)));
  uguale("webhook non verificabile (chiave con permessi limitati): non blocca, lo dice la pagina", motiviCheImpedisconoLaVendita({ ...tuttoOk, webhook: { verificabile: false } }), []);
  uguale("più problemi insieme: tutti elencati", motiviCheImpedisconoLaVendita({ modalita: "prova", piani: [piano("starter", "assente"), piano("professional", "assente"), piano("enterprise", "assente")], webhook: { verificabile: true, mancanti: ["invoice.paid"], doppi: [] } }).length, 5);

  console.log("--- Creazione dei prezzi su Stripe (Stripe finto) ---");
  type ChiamataCrea = { product: string; unit_amount: number; lookup_key: string; nickname: string; chiave: string; currency: string; interval: string };
  const finto = (opzioni: { esistenti?: { product: string | { id: string } }[]; falliscePrezzo?: number } = {}) => {
    const prodottiCreati: { name: string; chiave: string }[] = [];
    const prezziCreati: ChiamataCrea[] = [];
    const listaRichieste: { lookup_keys: string[]; active: boolean }[] = [];
    let n = 0;
    const stripe: StripeCreaPrezzi = {
      prices: {
        list: (p) => {
          listaRichieste.push({ lookup_keys: p.lookup_keys, active: p.active });
          return Promise.resolve({ data: opzioni.esistenti ?? [] });
        },
        create: (p, o) => {
          n++;
          if (opzioni.falliscePrezzo === n) return Promise.reject(new Error("Stripe non risponde"));
          prezziCreati.push({ product: p.product, unit_amount: p.unit_amount, lookup_key: p.lookup_key, nickname: p.nickname, chiave: o.idempotencyKey, currency: p.currency, interval: p.recurring.interval });
          return Promise.resolve({});
        },
      },
      products: {
        create: (p, o) => {
          prodottiCreati.push({ name: p.name, chiave: o.idempotencyKey });
          return Promise.resolve({ id: "prod_nuovo" });
        },
      },
    };
    return { stripe, prodottiCreati, prezziCreati, listaRichieste };
  };
  const tre = [piano("starter", "assente", 69900), piano("professional", "assente", 149000), piano("enterprise", "assente", 290000)];

  const a = finto();
  const esitoA = await creaPrezziSuStripe(a.stripe, tre);
  uguale("account senza nulla: un prodotto nuovo e tre prezzi mensili in euro, con lookup_key, importo del listino e nome del piano", [esitoA, a.prodottiCreati, a.prezziCreati], [
    { creati: ["Starter", "Professional", "Enterprise"] },
    [{ name: NOME_PRODOTTO_ABBONAMENTO, chiave: "omnia-ai-prodotto-abbonamento" }],
    [
      { product: "prod_nuovo", unit_amount: 69900, lookup_key: "omnia_ai_starter", nickname: "Starter", chiave: "omnia-ai-prezzo-starter-69900", currency: "eur", interval: "month" },
      { product: "prod_nuovo", unit_amount: 149000, lookup_key: "omnia_ai_professional", nickname: "Professional", chiave: "omnia-ai-prezzo-professional-149000", currency: "eur", interval: "month" },
      { product: "prod_nuovo", unit_amount: 290000, lookup_key: "omnia_ai_enterprise", nickname: "Enterprise", chiave: "omnia-ai-prezzo-enterprise-290000", currency: "eur", interval: "month" },
    ],
  ]);
  uguale("cerca i prezzi esistenti dei tre piani, solo attivi", a.listaRichieste, [{ lookup_keys: ["omnia_ai_starter", "omnia_ai_professional", "omnia_ai_enterprise"], active: true }]);
  const b = finto({ esistenti: [{ product: "prod_esistente" }] });
  const esitoB = await creaPrezziSuStripe(b.stripe, [piano("professional", "assente", 149000)]);
  uguale("se un altro piano ha già un prezzo, si riusa il suo prodotto (nessun prodotto nuovo) e si crea solo il prezzo mancante", [esitoB, b.prodottiCreati.length, b.prezziCreati.map((p) => [p.product, p.lookup_key])], [{ creati: ["Professional"] }, 0, [["prod_esistente", "omnia_ai_professional"]]]);
  const c = finto({ esistenti: [{ product: { id: "prod_espanso" } }] });
  await creaPrezziSuStripe(c.stripe, [piano("starter", "assente")]);
  uguale("il prodotto può arrivare anche come oggetto espanso", c.prezziCreati.map((p) => p.product), ["prod_espanso"]);
  const d = finto();
  const esitoD = await creaPrezziSuStripe(d.stripe, []);
  uguale("niente da creare: nessuna chiamata a Stripe", [esitoD, d.listaRichieste.length, d.prodottiCreati.length, d.prezziCreati.length], [{ creati: [] }, 0, 0, 0]);
  const e = finto({ falliscePrezzo: 2 });
  const silenzio = console.error;
  console.error = () => {};
  const esitoE = await creaPrezziSuStripe(e.stripe, tre);
  console.error = silenzio;
  uguale("se Stripe fallisce a metà si ferma, dice quali sono già stati creati e non ne crea altri", [esitoE.creati, /dopo Starter/.test(esitoE.errore ?? ""), e.prezziCreati.length], [["Starter"], true, 1]);
  const f1 = finto();
  const f2 = finto();
  await creaPrezziSuStripe(f1.stripe, [piano("starter", "assente", 69900)]);
  await creaPrezziSuStripe(f2.stripe, [piano("starter", "assente", 69900)]);
  uguale("lo stesso piano allo stesso prezzo usa sempre la stessa chiave di idempotenza (un secondo clic non crea un doppione)", f1.prezziCreati[0].chiave, f2.prezziCreati[0].chiave);
  const sorgenteCreazione = leggi("src/lib/console/crea-prezzi-stripe.ts");
  atteso("non modifica, archivia né sostituisce mai un prezzo esistente", !/prices\.update|archive|active:\s*false|transfer_lookup_key/.test(sorgenteCreazione.replace(/\/\/[^\n]*/g, "")));

  console.log("--- Azioni della console ---");
  const azioni = leggi("src/app/site-console/azioni/vendita.ts");
  atteso("«use server» come prima riga", azioni.startsWith('"use server";'));
  const corpoCrea = azioni.slice(azioni.indexOf("export async function creaPrezziMancanti"), azioni.indexOf("export async function impostaVenditaAbbonamenti"));
  const corpoImposta = azioni.slice(azioni.indexOf("export async function impostaVenditaAbbonamenti"));
  atteso("ogni azione comincia da richiediAdminAzione", /^[^\n]*\n\s*const sessione = await richiediAdminAzione\(\);\s*\n\s*if \(!sessione\) return/.test(corpoCrea) && /^[^\n]*\n\s*const sessione = await richiediAdminAzione\(\);\s*\n\s*if \(!sessione\) return/.test(corpoImposta));
  atteso("creaPrezziMancanti: si ferma senza chiave riconosciuta, legge i piani da creare e crea solo quelli", primaDi(corpoCrea, 'modalitaChiaveStripe(chiave) === "sconosciuta"', "leggiPrezziConsole()") && /pianiConPrezzoDaCreare\(/.test(corpoCrea) && /creaPrezziSuStripe\(createStripeClient\("omnia-ai"\), daCreare\)/.test(corpoCrea));
  atteso("impostaVenditaAbbonamenti: accetta solo «attiva» o «sospendi»", /azione !== "attiva" && azione !== "sospendi"\) return \{ errore:/.test(corpoImposta));
  atteso("per accendere si ricalcolano i controlli sul server PRIMA di scrivere, e si rifiuta se c'è un motivo", primaDi(corpoImposta, "motiviCheImpedisconoLaVendita({", ".upsert(") && /if \(motivi\.length > 0\) return \{ errore:/.test(corpoImposta) && /if \(azione === "attiva"\) \{[\s\S]*?motiviCheImpedisconoLaVendita/.test(corpoImposta));
  atteso("il controllo dei motivi vale solo per «attiva»: sospendere funziona sempre", /if \(azione === "attiva"\) \{\s*const \[dati, controllo\][\s\S]*?\n  \}\n\n  const \{ error \}/.test(corpoImposta));
  atteso("scrive «1» per attiva e «0» per sospendi sulla chiave dell'interruttore", /chiave: CHIAVE_VENDITA, valore: azione === "attiva" \? "1" : "0"/.test(corpoImposta) && /onConflict: "chiave"/.test(corpoImposta));
  atteso("dopo la modifica ricarica console e /piani", /revalidatePath\("\/site-console", "layout"\)/.test(azioni) && /revalidatePath\("\/piani"\)/.test(azioni));
  atteso("le azioni non toccano abbonamenti, ordini o clienti", !/subscriptions|\.from\("orders"\)|\.from\("users"\)/.test(azioni));

  console.log("--- Pagine ---");
  const piani = leggi("src/app/site-omnia-ai/piani/page.tsx");
  atteso("/piani: «Abbonati» solo con la vendita visibile, verso la pagina di acquisto del piano", /\{vendita && \(\s*<Link className="omnia-btn omnia-btn-p" href=\{`\/abbonati\/\$\{p\.slug\}`\}>\s*Abbonati\s*<\/Link>\s*\)\}/.test(piani));
  atteso("/piani: «Richiedi la demo» resta sempre, anche con la vendita accesa (non dipende dall'interruttore)", /\)\}\s*<Link\s+className=\{`omnia-btn \$\{!vendita && p\.inEvidenza \? "omnia-btn-p" : "omnia-btn-s"\}`\}\s+href="\/demo"[\s\S]*?Richiedi la demo\s*<\/Link>/.test(piani));
  atteso("/piani: la visibilità viene da venditaAbbonamentiVisibile (interruttore + chiave reale), non da un valore fisso", /venditaAbbonamentiVisibile\(\)/.test(piani) && !/TEMPORANEO/.test(piani));
  atteso("/piani non rimanda alla console", !/console\.omniaitalia\.com|CONSOLE_BASE_URL|site-console|lib\/console/.test(piani) && !/console\.omniaitalia\.com|CONSOLE_BASE_URL|site-console|lib\/console/.test(lib));
  const paginaPrezzi = leggi("src/app/site-console/(app)/prezzi/page.tsx");
  atteso("console «Piani e prezzi»: richiede l'admin e legge prezzi, controllo di Stripe e interruttore", primaDi(paginaPrezzi, "await richiediAdminPagina();", "leggiPrezziConsole()") && /leggiControlloStripe\(\)/.test(paginaPrezzi) && /leggiInterruttoreVendita\(\)/.test(paginaPrezzi));
  const vista = leggi("src/app/site-console/_componenti/messa-in-vendita-vista.tsx");
  atteso("pannello: i quattro controlli (Stripe reale, prezzi, webhook, portale clienti)", ["Stripe in modalità reale", "Prezzi dei piani su Stripe", "Webhook di Stripe", "Portale clienti di Stripe"].every((v) => vista.includes(`voce: "${v}"`)));
  atteso("pannello: «Accendi la vendita» è spento finché c'è un motivo, chiede conferma e li elenca", /disabilitato=\{motivi\.length > 0\}/.test(vista) && /conferma="Accendere la vendita\?/.test(vista) && /motivi\.map\(\(m\) =>/.test(vista));
  atteso("pannello: «Sospendi la vendita» chiede conferma e non è mai bloccato", /conferma="Sospendere la vendita\?/.test(vista) && !/Sospendi la vendita[\s\S]{0,40}disabilitato/.test(vista));
  atteso("pannello: dice chiaro se la vendita è accesa, spenta o accesa-ma-non-visibile", /Vendita ACCESA/.test(vista) && /Vendita SPENTA/.test(vista) && /NON è visibile/.test(vista));
  atteso("pannello: «Crea i prezzi mancanti» compare solo se mancano prezzi, con conferma che dice quale account", /daCreare\.length > 0 && modalita !== "sconosciuta"/.test(vista) && /conferma=\{`Creare su Stripe \(\$\{modalita === "reale" \? "account REALE" : "account di prova"\}\)/.test(vista));
  atteso("la pagina «Piani e prezzi» mostra il pannello", /<MessaInVenditaVista dati=\{dati\} controllo=\{controllo\} interruttore=\{interruttore\} \/>/.test(leggi("src/app/site-console/_componenti/prezzi-vista.tsx")));
  const controlloStripe = leggi("src/lib/console/controllo-stripe.ts");
  atteso("la lettura di Stripe è di sola lettura (list/retrieve), mai create/update/del", !/\.(create|update|del|cancel)\(/.test(controlloStripe) && /webhookEndpoints\.list/.test(controlloStripe) && /billingPortal\.configurations\.list/.test(controlloStripe));
  atteso("se Stripe non è leggibile la pagina non si rompe: «non verificabile»", /verificabile: false/.test(controlloStripe) && /non_verificabile/.test(controlloStripe));

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
