// Autotest dell'offerta pilot di OMNIA AI (migrazione 0086): un prezzo dedicato a un cliente creato
// dalla console, per N mesi (0 = sempre), visibile solo nella sua area riservata, con il promemoria
// degli ultimi 15 giorni e il ritorno al prezzo pieno. Si prova il controllo dei campi, le date, i
// testi, il catalogo visto dal cliente, la migrazione e ogni collegamento (checkout, webhook, cron,
// pagine, console). Gratuito, nessun database né rete: gira nel livello 1, quindi in prebuild.
import fs from "fs";
import path from "path";
import { testoOfferta } from "../src/lib/omnia-ai-catalogo-calcoli";
import {
  GIORNI_PREAVVISO_PILOT,
  aggiungiMesi,
  applicaPilotAlCatalogo,
  fineScontoStripe,
  scadenzaPilot,
  pilotInCorso,
  prezzoPilotEffettivo,
  promemoriaPilot,
  risparmioPilot,
  statoOffertaPilot,
  testoOffertaPilot,
  testoPilotInCorso,
  testoPromemoriaPilot,
  validaNuovaOffertaPilot,
} from "../src/lib/omnia-ai-pilot-calcoli";

const fallimenti: string[] = [];
function atteso(nome: string, ok: boolean, dettaglio = "") {
  console.log(`${ok ? "ok    " : "FALLITO"} ${nome}${ok ? "" : ` — ${dettaglio}`}`);
  if (!ok) fallimenti.push(nome);
}
function uguale<T>(nome: string, ottenuto: T, previsto: T) {
  atteso(nome, JSON.stringify(ottenuto) === JSON.stringify(previsto), `ottenuto ${JSON.stringify(ottenuto)}, previsto ${JSON.stringify(previsto)}`);
}
const leggi = (relativo: string) => fs.readFileSync(path.join(__dirname, "..", relativo), "utf-8").replace(/\r\n/g, "\n");
const primaDi = (sorgente: string, a: string, b: string) => sorgente.indexOf(a) !== -1 && sorgente.indexOf(a) < sorgente.indexOf(b);

const LISTINI = { starter: 69900, professional: 149000, enterprise: 290000 };
const GIORNO_MS = 86_400_000;

console.log("--- Nuova offerta: controllo dei campi ---");
const base = { piano: "starter", prezzo: "399", mesi: "6" };
const errore = (campi: Partial<typeof base>) => {
  const r = validaNuovaOffertaPilot({ ...base, ...campi }, LISTINI);
  return r.ok ? null : r.errore;
};
const valida = validaNuovaOffertaPilot(base, LISTINI);
atteso("un'offerta completa è accettata", valida.ok);
if (valida.ok) uguale("piano, prezzo in centesimi e mesi", [valida.valori.piano, valida.valori.prezzoCentesimi, valida.valori.mesi], ["starter", 39900, 6]);
uguale("mesi vuoti = 0 (sempre il prezzo pilot)", (validaNuovaOffertaPilot({ ...base, mesi: "" }, LISTINI) as { valori: { mesi: number } }).valori.mesi, 0);
uguale("prezzo con virgola e decimali", (validaNuovaOffertaPilot({ ...base, prezzo: "399,50" }, LISTINI) as { valori: { prezzoCentesimi: number } }).valori.prezzoCentesimi, 39950);
atteso("piano mancante", errore({ piano: "" }) !== null);
atteso("piano inesistente", errore({ piano: "gold" }) !== null);
atteso("prezzo non valido", errore({ prezzo: "tanto" }) !== null);
atteso("prezzo sotto il minimo", errore({ prezzo: "0,50" }) !== null);
atteso("prezzo uguale al listino non è un'offerta", errore({ prezzo: "699" }) !== null);
atteso("prezzo oltre il listino", errore({ prezzo: "800" }) !== null);
atteso("il confronto è col listino DEL PIANO scelto (399 va bene per Starter, non per un listino più basso)", errore({ piano: "professional", prezzo: "1000" }) === null && validaNuovaOffertaPilot({ ...base, prezzo: "399" }, { ...LISTINI, starter: 39900 }).ok === false);
atteso("mesi negativi", errore({ mesi: "-1" }) !== null);
atteso("mesi con decimali", errore({ mesi: "2.5" }) !== null);
atteso("mesi oltre 60", errore({ mesi: "61" }) !== null);
atteso("60 mesi accettati", errore({ mesi: "60" }) === null);

console.log("--- Prezzo ed effetto ---");
uguale("il prezzo effettivo non supera mai il listino", [prezzoPilotEffettivo(69900, 39900), prezzoPilotEffettivo(69900, 80000)], [39900, 69900]);
uguale("risparmio mensile = listino − prezzo pilot (mai negativo)", [risparmioPilot(69900, 39900), risparmioPilot(69900, 80000)], [30000, 0]);
uguale("stato: aperta, revocata, acquistata", [statoOffertaPilot({ attiva: true, acquistataIl: null }), statoOffertaPilot({ attiva: false, acquistataIl: null }), statoOffertaPilot({ attiva: true, acquistataIl: "2026-10-14T10:00:00Z" })], ["aperta", "revocata", "acquistata"]);

console.log("--- Testi dell'offerta ---");
uguale("per N mesi e poi prezzo pieno", testoOffertaPilot({ prezzoCentesimi: 39900, mesi: 6 }, "Starter", 69900), "Offerta riservata a te: piano Starter a 399,00 € al mese, IVA inclusa, per i primi 6 mesi. Poi il rinnovo avviene a prezzo pieno: 699,00 € al mese.");
atteso("un mese solo (singolare)", /per il primo mese\. Poi il rinnovo/.test(testoOffertaPilot({ prezzoCentesimi: 39900, mesi: 1 }, "Starter", 69900)));
uguale("mesi = 0: per tutta la durata, senza parlare di rinnovo a prezzo pieno", testoOffertaPilot({ prezzoCentesimi: 39900, mesi: 0 }, "Starter", 69900), "Offerta riservata a te: piano Starter a 399,00 € al mese, IVA inclusa, per tutta la durata dell'abbonamento.");
atteso("mesi = 0 non promette un prezzo pieno futuro", !/prezzo pieno/.test(testoOffertaPilot({ prezzoCentesimi: 39900, mesi: 0 }, "Starter", 69900)));

console.log("--- Mesi di calendario ---");
const g = (d: Date) => d.toISOString().slice(0, 10);
uguale("14 ottobre + 6 mesi = 14 aprile", g(aggiungiMesi(new Date("2026-10-14T09:00:00Z"), 6)), "2027-04-14");
uguale("31 agosto + 6 mesi: l'ultimo giorno di febbraio (28)", g(aggiungiMesi(new Date("2026-08-31T09:00:00Z"), 6)), "2027-02-28");
uguale("anno bisestile: 31 agosto 2023 + 6 mesi = 29 febbraio 2024", g(aggiungiMesi(new Date("2023-08-31T09:00:00Z"), 6)), "2024-02-29");
uguale("oltre l'anno: 15 novembre + 14 mesi", g(aggiungiMesi(new Date("2026-11-15T09:00:00Z"), 14)), "2028-01-15");
uguale("0 mesi = stessa data", g(aggiungiMesi(new Date("2026-10-14T09:00:00Z"), 0)), "2026-10-14");
uguale("l'orario si conserva", aggiungiMesi(new Date("2026-10-14T09:12:34Z"), 1).toISOString(), "2026-11-14T09:12:34.000Z");

console.log("--- Fine del prezzo pilot (da Stripe) ---");
uguale("la fine dello sconto si legge dall'oggetto sconto espanso", fineScontoStripe([{ end: 1807696274 }]), 1807696274);
uguale("uno sconto che non finisce mai (end null): nessuna fine", fineScontoStripe([{ end: null }]), null);
uguale("un sconto non espanso (solo l'id) non dice nulla", fineScontoStripe(["di_123"]), null);
uguale("tra più sconti conta il primo con una fine", fineScontoStripe(["di_1", { end: null }, { end: 1800000000 }]), 1800000000);
uguale("nessun elenco: nessuna fine", [fineScontoStripe(undefined), fineScontoStripe(null), fineScontoStripe([])], [null, null, null]);
  uguale("con la data di Stripe (14 aprile 2027, come nella prova su Stripe di prova) prevale su qualunque calcolo dai mesi", scadenzaPilot(6, 1807696274, new Date("2026-10-20T00:00:00Z"))?.toISOString(), "2027-04-14T09:51:14.000Z");
uguale("senza la data di Stripe si calcola dai mesi", scadenzaPilot(6, null, new Date("2026-10-14T09:51:14Z"))?.toISOString(), "2027-04-14T09:51:14.000Z");
uguale("mesi = 0: non scade mai, anche se Stripe desse una data", [scadenzaPilot(0, null, new Date("2026-10-14T09:00:00Z")), scadenzaPilot(0, 1807696274, new Date("2026-10-14T09:00:00Z"))], [null, null]);

console.log("--- Promemoria degli ultimi 15 giorni ---");
const scadenza = "2026-10-29T12:00:00Z";
const acquistata = "2026-04-29T12:00:00Z";
const dopo = (giorni: number) => new Date(Date.parse(scadenza) - giorni * GIORNO_MS);
uguale("la finestra è di 15 giorni", GIORNI_PREAVVISO_PILOT, 15);
uguale("20 giorni alla scadenza: nessun promemoria", promemoriaPilot({ acquistataIl: acquistata, scadeIl: scadenza }, dopo(20)), null);
uguale("15 giorni esatti: c'è (il primo giorno della finestra)", promemoriaPilot({ acquistataIl: acquistata, scadeIl: scadenza }, dopo(15)), { giorni: 15, scadeIlGiorno: "2026-10-29" });
uguale("15 giorni e un secondo: ancora no", promemoriaPilot({ acquistataIl: acquistata, scadeIl: scadenza }, new Date(dopo(15).getTime() - 1000)), null);
uguale("14 giorni e mezzo: «15 giorni» (arrotondato per eccesso)", promemoriaPilot({ acquistataIl: acquistata, scadeIl: scadenza }, dopo(14.5))?.giorni, 15);
uguale("mezza giornata: «1 giorno»", promemoriaPilot({ acquistataIl: acquistata, scadeIl: scadenza }, dopo(0.5))?.giorni, 1);
uguale("alla scadenza o dopo: più nessun promemoria", [promemoriaPilot({ acquistataIl: acquistata, scadeIl: scadenza }, dopo(0)), promemoriaPilot({ acquistataIl: acquistata, scadeIl: scadenza }, dopo(-3))], [null, null]);
uguale("senza scadenza (mesi = 0) non c'è mai", promemoriaPilot({ acquistataIl: acquistata, scadeIl: null }, dopo(3)), null);
uguale("se non è stata acquistata non c'è", promemoriaPilot({ acquistataIl: null, scadeIl: scadenza }, dopo(3)), null);
uguale("una data illeggibile non fa scattare nulla", promemoriaPilot({ acquistataIl: acquistata, scadeIl: "boh" }, dopo(3)), null);
uguale("22:30 UTC è ancora il 29 a Roma (ora solare, 23:30)", promemoriaPilot({ acquistataIl: acquistata, scadeIl: "2026-10-29T22:30:00Z" }, new Date("2026-10-20T10:00:00Z"))?.scadeIlGiorno, "2026-10-29");
atteso("23:30 UTC è già il giorno dopo a Roma", promemoriaPilot({ acquistataIl: acquistata, scadeIl: "2026-10-29T23:30:00Z" }, new Date("2026-10-20T10:00:00Z"))?.scadeIlGiorno === "2026-10-30");
atteso("il testo dice quando scade, a quanto torna e che il prezzo è IVA inclusa", /fra 15 giorni, il 29\/10\/2026/.test(testoPromemoriaPilot({ giorni: 15, scadeIlGiorno: "2026-10-29" }, 69900)) && /prezzo pieno: 699,00 € al mese, IVA inclusa/.test(testoPromemoriaPilot({ giorni: 15, scadeIlGiorno: "2026-10-29" }, 69900)));
atteso("l'ultimo giorno: «domani»", /scade domani, il 29\/10\/2026/.test(testoPromemoriaPilot({ giorni: 1, scadeIlGiorno: "2026-10-29" }, 69900)));
atteso("pilot in corso: prima della scadenza sì, dopo no; senza scadenza sempre", pilotInCorso({ acquistataIl: acquistata, scadeIl: scadenza, mesi: 6 }, dopo(40)) && !pilotInCorso({ acquistataIl: acquistata, scadeIl: scadenza, mesi: 6 }, dopo(-1)) && pilotInCorso({ acquistataIl: acquistata, scadeIl: null, mesi: 0 }, dopo(-900)) && !pilotInCorso({ acquistataIl: null, scadeIl: null, mesi: 0 }, dopo(0)));
atteso("testo del pilot in corso: con scadenza e prezzo pieno / per sempre", /prezzo pilot: 399,00 € al mese, IVA inclusa, fino al 29\/10\/2026\. Dopo, il rinnovo sarà a prezzo pieno: 699,00 € al mese\./.test(testoPilotInCorso({ prezzoCentesimi: 39900, mesi: 6, scadeIl: scadenza, prezzoPienoCentesimi: 69900 })) && /per tutta la durata dell'abbonamento/.test(testoPilotInCorso({ prezzoCentesimi: 39900, mesi: 0, scadeIl: null, prezzoPienoCentesimi: 69900 })));

console.log("--- Il catalogo come lo vede il cliente ---");
type Voce = { slug: "starter" | "professional" | "enterprise"; prezzoListinoCentesimi: number; prezzoCentesimi: number; sconto: unknown };
const catalogo: Voce[] = [
  { slug: "starter", prezzoListinoCentesimi: 69900, prezzoCentesimi: 69900, sconto: null },
  { slug: "professional", prezzoListinoCentesimi: 149000, prezzoCentesimi: 134100, sconto: { nome: "Lancio" } },
  { slug: "enterprise", prezzoListinoCentesimi: 290000, prezzoCentesimi: 290000, sconto: null },
];
const offerta = { id: "00000000-0000-4000-8000-0000000000aa", piano: "starter" as const, prezzoCentesimi: 39900, mesi: 6 };
const vista = applicaPilotAlCatalogo(catalogo, offerta);
const starter = vista.piani.find((p) => p.slug === "starter") as Voce & { sconto: { nome: string; prezzoCentesimi: number; risparmioCentesimi: number; durataMesi: number; validoAl: string | null } };
uguale("il piano offerto mostra il prezzo pilot e l'offerta", [starter.prezzoCentesimi, starter.prezzoListinoCentesimi, starter.sconto.risparmioCentesimi], [39900, 69900, 30000]);
uguale("la frase dell'offerta nel modulo di acquisto", testoOfferta(starter.sconto, starter.prezzoListinoCentesimi), "Offerta riservata a te: 399,00 € al mese per i primi 6 mesi, poi 699,00 € al mese.");
uguale("gli altri piani non cambiano (compreso lo sconto pubblico di Professional)", [vista.piani[1], vista.piani[2]], [catalogo[1], catalogo[2]]);
uguale("il piano da selezionare in partenza è quello offerto", vista.pianoPredefinito, "starter");
uguale("senza offerta il catalogo è identico e nessun piano è preselezionato", applicaPilotAlCatalogo(catalogo, null), { piani: catalogo, pianoPredefinito: null });
uguale("un prezzo pilot non inferiore al listino non è un'offerta: nulla cambia", applicaPilotAlCatalogo(catalogo, { ...offerta, prezzoCentesimi: 69900 }), { piani: catalogo, pianoPredefinito: null });
atteso("con mesi = 0 la frase dice «per tutta la durata dell'abbonamento»", /per tutta la durata dell'abbonamento/.test(testoOfferta((applicaPilotAlCatalogo(catalogo, { ...offerta, mesi: 0 }).piani[0] as typeof starter).sconto, 69900)));
atteso("il catalogo originale non viene modificato", catalogo[0].sconto === null && catalogo[0].prezzoCentesimi === 69900);

console.log("--- Migrazione 0086 ---");
const mig = leggi("supabase/migrations/0086_omnia_ai_offerte_pilot.sql");
const sql = mig.split("\n").filter((r) => !r.trimStart().startsWith("--")).join("\n");
atteso("tabella creata se manca, con la RLS attiva", /create table if not exists public\.omnia_ai_offerte_pilot/.test(sql) && /alter table public\.omnia_ai_offerte_pilot enable row level security/.test(sql));
atteso("solo clienti creati dalla console (chiave esterna verso omnia_ai_utenti_console) e si cancella con loro", /user_id uuid not null references public\.omnia_ai_utenti_console \(user_id\) on delete cascade/.test(sql));
atteso("piani e limiti come nel codice (prezzo 1 € - 100.000 €, mesi 0-60)", /'starter', 'professional', 'enterprise'/.test(sql) && /between 100 and 10000000/.test(sql) && /mesi between 0 and 60/.test(sql));
atteso("al più UNA offerta aperta per cliente (indice univoco parziale)", /create unique index if not exists omnia_ai_offerte_pilot_una_aperta_idx[\s\S]*?\(user_id\)\s*where attiva and acquistata_il is null/.test(sql));
atteso("la scadenza esiste solo per un'offerta acquistata", /check \(scade_il is null or acquistata_il is not null\)/.test(sql));
atteso("nessun permesso ai ruoli utente: solo la chiave di servizio", !/\b(anon|authenticated)\b/i.test(sql) && /grant select, insert, update on public\.omnia_ai_offerte_pilot to service_role/.test(sql) && !/create policy/i.test(sql));
atteso("nessuna cancellazione di dati", !/\b(delete\s+from|truncate|drop\s+(table|column))\b/i.test(sql));
atteso("il tipo di notifica del promemoria è ammesso dal database", /'pilot_in_scadenza'/.test(leggi("supabase/migrations/0083_omnia_ai_notifiche_nuovi_tipi.sql")));

console.log("--- Checkout ---");
const checkout = leggi("src/app/actions/omnia-ai-subscription.ts");
atteso("l'offerta si legge solo per un cliente autenticato (userId), mai nel percorso anonimo", /const pilot = userId \? await leggiOffertaPilotAperta\(userId\) : null/.test(checkout));
atteso("vale solo per il piano offerto", /pilot && pilot\.piano === planSlug \? calcolaRisparmioPilot\(voce\.prezzoListinoCentesimi, pilot\.prezzoCentesimi\) : 0/.test(checkout));
atteso("ha la precedenza sullo sconto pubblico", primaDi(checkout, "if (pilot && risparmioPilot > 0)", "} else if (voce.sconto)"));
atteso("coupon a importo fisso (listino − prezzo pilot), per i mesi dell'offerta (0 = forever)", /idCouponSconto\(pilot\.id, risparmioPilot, pilot\.mesi\)/.test(checkout) && /durataMesi: pilot\.mesi/.test(checkout) && /risparmioCentesimi: risparmioPilot/.test(checkout));
atteso("l'offerta viaggia nei metadata (il webhook la riconosce)", /metadata\.pilotOffertaId = pilot\.id/.test(checkout));
atteso("il rinnovo a prezzo pieno non lo gestisce il nostro codice: lo fa il coupon a durata di Stripe", !/subscriptionSchedules/.test(checkout));

console.log("--- Webhook: acquisto dell'offerta ---");
const webhook = leggi("src/app/api/webhooks/stripe/route.ts");
atteso("alla creazione dell'abbonamento, se i metadata portano l'offerta, la si registra", /if \(metadata\?\.pilotOffertaId\) \{\s*try \{\s*await registraAcquistoPilot\(/.test(webhook));
atteso("con l'utente dell'abbonamento, non quello scritto nei metadata (l'offerta deve essere sua)", /registraAcquistoPilot\(\{ stripe: createStripeClient\("omnia-ai"\), offertaId: metadata\.pilotOffertaId, userId, stripeSubscriptionId \}\)/.test(webhook));
atteso("dopo aver trovato l'utente e prima delle accettazioni; un errore non le blocca (try/catch)", primaDi(webhook, "await registraAcquistoPilot(", "recordOmniaAiLegalAcceptances({") && primaDi(webhook, "if (!subscriptionRowId || !userId) return;", "await registraAcquistoPilot("));
const pilotLib = leggi("src/lib/omnia-ai-pilot.ts");
const corpoAcquisto = pilotLib.slice(pilotLib.indexOf("export async function registraAcquistoPilot"), pilotLib.indexOf("export type EsitoPromemoriPilot"));
atteso("l'offerta deve appartenere a chi ha comprato", /\.eq\("id", params\.offertaId\)\.eq\("user_id", params\.userId\)/.test(corpoAcquisto));
atteso("idempotente: un'offerta già acquistata non si tocca (controllo e guardia nell'aggiornamento)", /if \(riga\.acquistata_il\) return;/.test(corpoAcquisto) && /\.is\("acquistata_il", null\)/.test(corpoAcquisto));
  atteso("la fine del prezzo pilot è quella di Stripe (sconti espansi) con i mesi come ripiego, e mesi = 0 non scade (funzioni pure provate sopra)", /expand: \["discounts"\]/.test(corpoAcquisto) && /scadenzaPilot\(riga\.mesi, fineScontoStripe\(/.test(corpoAcquisto));
atteso("registra il prezzo pieno che subentra (quello del prezzo Stripe dell'abbonamento)", /abbonamento\.items\.data\[0\]\?\.price\.unit_amount/.test(corpoAcquisto) && /prezzo_pieno_centesimi: prezzoPieno/.test(corpoAcquisto));

console.log("--- Promemoria giornaliero ---");
const cron = leggi("src/app/api/cron/omnia-ai-purge-cessati/route.ts");
atteso("il lavoro giornaliero invia i promemoria, senza che un errore fermi il resto", /try \{\s*await inviaPromemoriaPilot\(\);\s*\} catch/.test(cron) && primaDi(cron, "await inviaPromemoriaPilot()", "omnia_ai_purge_log"));
const corpoPromemoria = pilotLib.slice(pilotLib.indexOf("export async function inviaPromemoriaPilot"));
atteso("solo offerte acquistate, con scadenza nella finestra di 15 giorni e senza promemoria già inviato", /\.not\("acquistata_il", "is", null\)/.test(corpoPromemoria) && /\.is\("promemoria_inviato_il", null\)/.test(corpoPromemoria) && /\.gt\("scade_il", adesso\.toISOString\(\)\)/.test(corpoPromemoria) && /\.lte\("scade_il", limite\)/.test(corpoPromemoria) && /GIORNI_PREAVVISO_PILOT \* 24 \* 60 \* 60 \* 1000/.test(corpoPromemoria));
atteso("solo se il cliente è ancora abbonato e non ha disdetto", /\.eq\("status", "attivo"\)/.test(corpoPromemoria) && /abbonamento\.cancel_at_period_end\) continue/.test(corpoPromemoria));
atteso("notifica nel campanello (deduplicata per scadenza) ed email", /tipo: "pilot_in_scadenza"/.test(corpoPromemoria) && /chiaveDedup: `\$\{offerta\.userId\}:pilot:\$\{promemoria\.scadeIlGiorno\}`/.test(corpoPromemoria) && /sendEmail\(/.test(corpoPromemoria));
atteso("l'email rimanda alla pagina Abbonamento dell'area del cliente (non alla console)", /\$\{OMNIA_AI_BASE_URL\}\/dashboard\/omnia-ai\/abbonamento/.test(corpoPromemoria) && !/CONSOLE_BASE_URL|console\.omniaitalia/.test(pilotLib));
atteso("segnato come inviato SOLO se l'email è partita (altrimenti si ritenta domani)", /if \(inviata\) \{\s*const \{ error: errore \} = await admin\.from\("omnia_ai_offerte_pilot"\)\.update\(\{ promemoria_inviato_il/.test(corpoPromemoria));
atteso("un errore su una singola offerta non ferma le altre", /for \(const riga of data \?\? \[\]\) \{\s*const offerta = offertaDaRiga\(riga\);[\s\S]*?try \{[\s\S]*?\} catch \(e\) \{[\s\S]*?esito\.falliti\+\+/.test(corpoPromemoria));
atteso("mai promemoria senza il prezzo pieno da dire", /if \(prezzoPieno === null\) continue/.test(corpoPromemoria));

console.log("--- Area riservata del cliente ---");
const layout = leggi("src/app/site-omnia-ai/dashboard/omnia-ai/layout.tsx");
const abbonamento = leggi("src/app/site-omnia-ai/dashboard/omnia-ai/abbonamento/page.tsx");
const modulo = leggi("src/app/site-omnia-ai/dashboard/omnia-ai/activate-subscription-form.tsx");
atteso("pagina di attivazione e pagina Abbonamento: l'offerta riservata cambia il prezzo del SUO piano", /leggiOffertaPilotAperta\(user\.id\)/.test(layout) && /leggiOffertaPilotAperta\(user\.id\)/.test(abbonamento) && /applicaPilotAlCatalogo\(/.test(layout) && /applicaPilotAlCatalogo\(/.test(abbonamento));
atteso("il piano offerto è quello selezionato in partenza", /pianoPredefinito=\{vista\.pianoPredefinito\}/.test(layout) && /pianoPredefinito=\{vista\.pianoPredefinito\}/.test(abbonamento) && /useState<PianoSlug>\(pianoPredefinito \?\? "professional"\)/.test(modulo));
atteso("avviso degli ultimi 15 giorni in cima a ogni pagina, solo per chi è abbonato, con il prezzo pieno", /stato\.stato === "attivo" \? await leggiPilotAcquistato\(user\.id\)/.test(layout) && /promemoriaPilot\(pilot, new Date\(\)\)/.test(layout) && /pilot\.prezzoPienoCentesimi !== null && <PilotAvviso/.test(layout) && /testoPromemoriaPilot\(promemoria, prezzoPieno, gareDopo\)/.test(layout));
atteso("la pagina Abbonamento mostra il prezzo pilot finché dura, e quando torna al pieno", /pilotInCorso\(pilotAcquistato, new Date\(\)\)/.test(abbonamento) && /testoPilotInCorso\(\{ \.\.\.pilotAttuale, gareIncluse: gareDedicateInVigore \}, piano\?\.gareIncluse\)/.test(abbonamento));
atteso("l'offerta si legge dal server filtrando per l'utente della sessione (nessuna lettura dal browser)", /\.eq\("user_id", userId\)/.test(pilotLib) && !/"use client"/.test(pilotLib) && !/to authenticated/.test(sql));
atteso("l'area cliente e le librerie pubbliche del pilot non rimandano alla console", ![layout, abbonamento, pilotLib, leggi("src/lib/omnia-ai-pilot-calcoli.ts")].some((t) => /console\.omniaitalia\.com|CONSOLE_BASE_URL|site-console|lib\/console/.test(t)));
atteso("il campanello porta «pilot in scadenza» alla pagina Abbonamento", /pilot_in_scadenza: "\/dashboard\/omnia-ai\/abbonamento"/.test(leggi("src/components/omnia-ai/notification-bell.tsx")));

console.log("--- Console ---");
const az = leggi("src/app/site-console/azioni/pilot.ts");
const corpoCrea = az.slice(az.indexOf("export async function creaOffertaPilot"), az.indexOf("export async function revocaOffertaPilot"));
const corpoRevoca = az.slice(az.indexOf("export async function revocaOffertaPilot"));
for (const [nome, corpo] of [["creaOffertaPilot", corpoCrea], ["revocaOffertaPilot", corpoRevoca]] as const) {
  atteso(`${nome}: controllo admin e stop subito se non lo è`, /const sessione = await richiediAdminAzione\(\);\s*if \(!sessione\) return \{ errore: "Non autorizzato\." \};/.test(corpo));
}
atteso("solo clienti (non admin) creati dalla console", /utente\.role !== "cliente"/.test(corpoCrea) && /from\("omnia_ai_utenti_console"\)\.select\("user_id"\)/.test(corpoCrea) && /if \(!creato\) return \{ errore: "L'offerta pilot è solo per i clienti creati dalla console\."/.test(corpoCrea));
atteso("non si offre un pilot a chi è già abbonato", /accesso\.stato === "attivo"/.test(corpoCrea));
atteso("il prezzo si controlla col listino reale di oggi (catalogo), con la stessa funzione provata qui", /getCatalogoPiani\(\)/.test(corpoCrea) && /validaNuovaOffertaPilot\(/.test(corpoCrea));
atteso("la nuova offerta sostituisce quella aperta (una alla volta), mai una già acquistata", /update\(\{ attiva: false \}\)\.eq\("user_id", userId\)\.eq\("attiva", true\)\.is\("acquistata_il", null\)/.test(corpoCrea) && primaDi(corpoCrea, 'update({ attiva: false })', '.insert({ user_id: userId'));
atteso("la revoca vale solo per un'offerta aperta (non acquistata)", /\.eq\("attiva", true\)\.is\("acquistata_il", null\)/.test(corpoRevoca));
atteso("nessuna cancellazione: un'offerta si revoca, non si cancella", !/\.delete\(/.test(az));
atteso("nessuna azione scrive password o dati di accesso", !/password|auth\.admin/.test(az));
const scheda = leggi("src/app/site-console/_componenti/scheda-cliente-vista.tsx");
const pannello = scheda.slice(scheda.indexOf("Offerta pilot: solo per i clienti creati dalla console"), scheda.indexOf("Accessi ai suoi dati (registro promesso"));
atteso("scheda cliente: il riquadro c'è solo per i clienti creati dalla console", /prova\.creatoDaConsole && s\.utente\.ruolo !== "admin"/.test(pannello));
atteso("scheda cliente: mostra l'offerta aperta (con revoca), quella acquistata (scadenza, prezzo pieno, promemoria) e il modulo per crearne una", /statoOffertaPilot\(o\) === "aperta"/.test(pannello) && /statoOffertaPilot\(o\) === "acquistata"/.test(pannello) && /revocaOffertaPilot/.test(pannello) && /creaOffertaPilot/.test(pannello) && /Il promemoria parte da solo 15 giorni prima della scadenza/.test(pannello));
atteso("scheda cliente: con un abbonamento attivo non si offre un nuovo pilot", /abbonamentoAttivo \? \(/.test(pannello) && /s\.abbonamenti\.some\(\(a\) => a\.stato === "attivo"\)/.test(pannello));

console.log("");
if (fallimenti.length > 0) {
  console.error(`${fallimenti.length} controlli falliti:\n - ${fallimenti.join("\n - ")}`);
  process.exit(1);
}
console.log("Tutti i controlli sono andati a buon fine.");
