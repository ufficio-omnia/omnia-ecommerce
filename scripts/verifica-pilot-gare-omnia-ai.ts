// Autotest delle GARE DEDICATE dell'offerta pilot di OMNIA AI (migrazione 0093): oltre al prezzo, l'offerta può
// dare al cliente un numero di gare incluse al mese diverso da quello del piano (es. 4 invece delle 3 di Starter),
// per tutta la durata del prezzo pilot; finito il pilot tornano insieme prezzo pieno e gare del piano.
// Si prova: il controllo del campo, la regola che decide quante gare ha un abbonamento (ogni condizione da sola
// deve farla tornare alle gare del piano), i testi, il catalogo visto dal cliente, la lettura con un finto
// database, la migrazione e ogni collegamento (i tre punti che leggono la quota, console, pagine del cliente).
// Gratuito, nessun database né rete: gira nel livello 1, quindi in prebuild.
import fs from "fs";
import path from "path";
import { PIANI } from "../src/lib/omnia-ai-plans";
import {
  GARE_PILOT_MAX,
  applicaPilotAlCatalogo,
  gareIncluseEffettive,
  testoGareIncluse,
  testoOffertaPilot,
  testoPilotInCorso,
  testoPromemoriaPilot,
  validaNuovaOffertaPilot,
  voceGarePilot,
  vociConGarePilot,
  type OffertaPerQuota,
} from "../src/lib/omnia-ai-pilot-calcoli";
import { COLONNE_OFFERTA_PILOT, gareInclusePerAbbonamento, offertaDaRiga } from "../src/lib/omnia-ai-pilot";

const fallimenti: string[] = [];
function atteso(nome: string, ok: boolean, dettaglio = "") {
  console.log(`${ok ? "ok    " : "FALLITO"} ${nome}${ok ? "" : ` — ${dettaglio}`}`);
  if (!ok) fallimenti.push(nome);
}
function uguale<T>(nome: string, ottenuto: T, previsto: T) {
  atteso(nome, JSON.stringify(ottenuto) === JSON.stringify(previsto), `ottenuto ${JSON.stringify(ottenuto)}, previsto ${JSON.stringify(previsto)}`);
}
const leggi = (relativo: string) => fs.readFileSync(path.join(__dirname, "..", relativo), "utf-8").replace(/\r\n/g, "\n");

const LISTINI = { starter: 69900, professional: 149000, enterprise: 290000 };
const GIORNO_MS = 86_400_000;
const ADESSO = new Date("2026-11-10T10:00:00Z");

async function main() {
  console.log("--- Il campo «gare incluse al mese» ---");
  const base = { piano: "starter", prezzo: "599", mesi: "6" };
  const esito = (gare?: string) => validaNuovaOffertaPilot({ ...base, ...(gare === undefined ? {} : { gare }) }, LISTINI);
  const gareDi = (gare?: string) => (esito(gare) as { valori: { gareIncluse: number | null } }).valori.gareIncluse;
  const erroreGare = (gare: string) => {
    const r = esito(gare);
    return r.ok ? null : r.errore;
  };
  uguale("senza il campo: nessuna gara dedicata (come prima della 0093)", gareDi(), null);
  uguale("campo vuoto o solo spazi: nessuna gara dedicata", [gareDi(""), gareDi("   ")], [null, null]);
  uguale("4 gare per Starter (3 gare di piano): dedicate", gareDi("4"), 4);
  uguale("gli spazi attorno si tolgono", gareDi(" 4 "), 4);
  uguale("2 gare (meno di quelle del piano) sono ammesse: è una scelta commerciale", gareDi("2"), 2);
  uguale("1 gara è il minimo", gareDi("1"), 1);
  uguale(`${GARE_PILOT_MAX} è il massimo`, gareDi(String(GARE_PILOT_MAX)), GARE_PILOT_MAX);
  uguale("le stesse gare del piano (3 per Starter) non sono «dedicate»: si salva null", gareDi("3"), null);
  uguale("il confronto è col piano scelto: 8 per Professional è null, 8 per Starter è dedicato", [(validaNuovaOffertaPilot({ piano: "professional", prezzo: "999", mesi: "6", gare: "8" }, LISTINI) as { valori: { gareIncluse: number | null } }).valori.gareIncluse, gareDi("8")], [null, 8]);
  atteso("zero gare non ha senso", erroreGare("0") !== null);
  atteso("negative", erroreGare("-1") !== null);
  atteso("oltre il massimo", erroreGare(String(GARE_PILOT_MAX + 1)) !== null);
  atteso("con decimali", erroreGare("2.5") !== null && erroreGare("2,5") !== null);
  atteso("con lettere o notazione scientifica", erroreGare("4 gare") !== null && erroreGare("1e1") !== null && erroreGare("abc") !== null);
  atteso("l'errore dice cosa fare", /da 1 a 100/.test(erroreGare("0") ?? "") && /lascia vuoto/.test(erroreGare("0") ?? ""));
  atteso("un errore sulle gare non fa passare un prezzo giusto", esito("0").ok === false && esito("4").ok === true);
  atteso("i controlli di prima restano: prezzo uguale al listino rifiutato anche con le gare", validaNuovaOffertaPilot({ ...base, prezzo: "699", gare: "4" }, LISTINI).ok === false);
  atteso("prezzo sotto 699 con 4 gare: l'offerta del caso reale è accettata", (() => {
    const r = validaNuovaOffertaPilot({ piano: "starter", prezzo: "649", mesi: "0", gare: "4" }, LISTINI);
    return r.ok && r.valori.prezzoCentesimi === 64900 && r.valori.mesi === 0 && r.valori.gareIncluse === 4;
  })());

  console.log("--- Quante gare ha un abbonamento (ogni condizione da sola) ---");
  const offerta: OffertaPerQuota = { piano: "starter", gareIncluse: 4, acquistataIl: "2026-10-10T09:00:00Z", scadeIl: "2027-04-10T09:00:00Z", mesi: 6, stripeSubscriptionId: "sub_AAA" };
  const quota = (o: Partial<OffertaPerQuota> | null, extra: Partial<{ gareDelPiano: number; pianoAbbonamento: "starter" | "professional" | "enterprise" | null; stripeSubscriptionId: string | null; adesso: Date }> = {}) =>
    gareIncluseEffettive({ gareDelPiano: 3, pianoAbbonamento: "starter", stripeSubscriptionId: "sub_AAA", offerta: o === null ? null : { ...offerta, ...o }, adesso: ADESSO, ...extra });
  uguale("tutto in regola: le gare dell'offerta (4)", quota({}), 4);
  uguale("nessuna offerta: le gare del piano", quota(null), 3);
  uguale("l'offerta non dedica gare (null): quelle del piano", quota({ gareIncluse: null }), 3);
  uguale("offerta non ancora acquistata: quelle del piano", quota({ acquistataIl: null }), 3);
  uguale("prezzo pilot scaduto: tornano quelle del piano", quota({ scadeIl: "2026-11-10T09:59:59Z" }), 3);
  uguale("un secondo prima della scadenza vale ancora", quota({ scadeIl: "2026-11-10T10:00:01Z" }), 4);
  uguale("alla scadenza esatta non vale più", quota({ scadeIl: "2026-11-10T10:00:00Z" }), 3);
  uguale("mesi = 0 (sempre): non scade mai, anche tra anni", gareIncluseEffettive({ gareDelPiano: 3, pianoAbbonamento: "starter", stripeSubscriptionId: "sub_AAA", offerta: { ...offerta, mesi: 0, scadeIl: null }, adesso: new Date("2031-01-01T00:00:00Z") }), 4);
  uguale("il cliente è passato a un altro piano: quelle del nuovo piano", quota({}, { pianoAbbonamento: "professional", gareDelPiano: 8 }), 8);
  uguale("piano dell'abbonamento non riconosciuto: nessuna eccezione", quota({}, { pianoAbbonamento: null }), 3);
  uguale("abbonamento diverso da quello a cui l'offerta è stata applicata (si è riabbonato): quelle del piano", quota({}, { stripeSubscriptionId: "sub_BBB" }), 3);
  uguale("abbonamento senza identificativo Stripe: quelle del piano", quota({}, { stripeSubscriptionId: null }), 3);
  uguale("offerta senza abbonamento registrato: quelle del piano", quota({ stripeSubscriptionId: null }), 3);
  uguale("l'offerta può dare MENO gare del piano (2): vale 2", quota({ gareIncluse: 2 }), 2);
  atteso("un solo istante di differenza non scambia le gare del piano con quelle dedicate in senso opposto", quota({}, { adesso: new Date(Date.parse(offerta.scadeIl as string) - 1) }) === 4 && quota({}, { adesso: new Date(Date.parse(offerta.scadeIl as string) + 1) }) === 3);

  console.log("--- Testi ---");
  const o4 = { prezzoCentesimi: 64900, mesi: 6, gareIncluse: 4 };
  uguale("offerta a mesi: prezzo, gare dedicate, poi prezzo pieno e gare del piano", testoOffertaPilot(o4, "Starter", 69900, 3), "Offerta riservata a te: piano Starter a 649,00 € al mese, IVA inclusa, con 4 gare incluse al mese, per i primi 6 mesi. Poi il rinnovo avviene a prezzo pieno: 699,00 € al mese, con 3 gare incluse al mese.");
  uguale("offerta per sempre (mesi = 0): nessun «poi»", testoOffertaPilot({ ...o4, mesi: 0 }, "Starter", 69900, 3), "Offerta riservata a te: piano Starter a 649,00 € al mese, IVA inclusa, con 4 gare incluse al mese, per tutta la durata dell'abbonamento.");
  atteso("un mese solo: «per il primo mese»", /con 4 gare incluse al mese, per il primo mese\. Poi il rinnovo avviene a prezzo pieno: 699,00 € al mese, con 3 gare incluse al mese\./.test(testoOffertaPilot({ ...o4, mesi: 1 }, "Starter", 69900, 3)));
  atteso("senza gare dedicate il testo è identico a quello di prima (nessuna parola in più)", testoOffertaPilot({ prezzoCentesimi: 64900, mesi: 6 }, "Starter", 69900) === "Offerta riservata a te: piano Starter a 649,00 € al mese, IVA inclusa, per i primi 6 mesi. Poi il rinnovo avviene a prezzo pieno: 699,00 € al mese." && testoOffertaPilot({ ...o4, gareIncluse: null }, "Starter", 69900, 3) === testoOffertaPilot({ prezzoCentesimi: 64900, mesi: 6 }, "Starter", 69900, 3));
  atteso("al singolare: «1 gara inclusa al mese»", testoGareIncluse(1) === "1 gara inclusa al mese" && testoGareIncluse(4) === "4 gare incluse al mese");
  const inCorso = { prezzoCentesimi: 64900, mesi: 6, scadeIl: "2027-04-10T09:00:00Z", prezzoPienoCentesimi: 69900 };
  uguale("pagina Abbonamento con gare dedicate: dice quante e a quante si torna", testoPilotInCorso({ ...inCorso, gareIncluse: 4 }, 3), "Hai un prezzo pilot: 649,00 € al mese, IVA inclusa, con 4 gare incluse al mese, fino al 10/04/2027. Dopo, il rinnovo sarà a prezzo pieno: 699,00 € al mese, con 3 gare incluse al mese.");
  atteso("pagina Abbonamento per sempre: dice le gare dedicate, nessun «Dopo»", /prezzo dedicato: 649,00 € al mese, IVA inclusa, con 4 gare incluse al mese, per tutta la durata dell'abbonamento\./.test(testoPilotInCorso({ ...inCorso, mesi: 0, scadeIl: null, gareIncluse: 4 }, 3)) && !/Dopo/.test(testoPilotInCorso({ ...inCorso, mesi: 0, scadeIl: null, gareIncluse: 4 }, 3)));
  atteso("pagina Abbonamento senza gare dedicate in vigore: identica a prima", testoPilotInCorso({ ...inCorso, gareIncluse: null }, 3) === testoPilotInCorso(inCorso) && !/gar[ae]/.test(testoPilotInCorso(inCorso)));
  atteso("promemoria con gare: dice che tornano a 3", /rinnova a prezzo pieno: 699,00 € al mese, IVA inclusa e le gare incluse tornano a 3 al mese\./.test(testoPromemoriaPilot({ giorni: 15, scadeIlGiorno: "2026-10-29" }, 69900, 3)));
  atteso("promemoria senza gare dedicate: identico a prima", testoPromemoriaPilot({ giorni: 15, scadeIlGiorno: "2026-10-29" }, 69900) === "Il tuo prezzo pilot scade fra 15 giorni, il 29/10/2026. Dopo quella data l'abbonamento si rinnova a prezzo pieno: 699,00 € al mese, IVA inclusa.");

  console.log("--- Il catalogo come lo vede il cliente ---");
  uguale("voce a mesi: «4 gare incluse ogni mese per i primi 6 mesi, poi 3 al mese»", voceGarePilot({ gareIncluse: 4, mesi: 6 }, 3), "4 gare incluse ogni mese per i primi 6 mesi, poi 3 al mese");
  uguale("voce per un mese e per sempre", [voceGarePilot({ gareIncluse: 4, mesi: 1 }, 3), voceGarePilot({ gareIncluse: 4, mesi: 0 }, 3)], ["4 gare incluse ogni mese per il primo mese, poi 3 al mese", "4 gare incluse ogni mese"]);
  uguale("una sola gara: singolare", voceGarePilot({ gareIncluse: 1, mesi: 0 }, 3), "1 gara inclusa ogni mese");
  uguale("la voce delle gare di Starter si sostituisce, le altre restano", vociConGarePilot(PIANI.starter.voci, { gareIncluse: 4, mesi: 0 }, 3), ["4 gare incluse ogni mese", "Generazione relazione tecnica in Word", "Estrazione automatica dei criteri di valutazione"]);
  uguale("senza una voce di gare, quella dell'offerta va in testa", vociConGarePilot(["Supporto"], { gareIncluse: 4, mesi: 0 }, 3), ["4 gare incluse ogni mese", "Supporto"]);
  uguale("l'elenco originale non si modifica", PIANI.starter.voci[0], "3 gare incluse ogni mese");
  type Voce = { slug: "starter" | "professional" | "enterprise"; prezzoListinoCentesimi: number; prezzoCentesimi: number; sconto: unknown; gareIncluse: number; voci: string[] };
  const catalogo: Voce[] = (["starter", "professional", "enterprise"] as const).map((slug) => ({ slug, prezzoListinoCentesimi: LISTINI[slug], prezzoCentesimi: LISTINI[slug], sconto: null, gareIncluse: PIANI[slug].gareIncluse, voci: PIANI[slug].voci }));
  const offertaCat = { id: "00000000-0000-4000-8000-0000000000bb", piano: "starter" as const, prezzoCentesimi: 64900, mesi: 6, gareIncluse: 4 };
  const vista = applicaPilotAlCatalogo(catalogo, offertaCat);
  const starter = vista.piani[0];
  uguale("il piano offerto mostra le gare dedicate, il prezzo pilot e la voce", [starter.gareIncluse, starter.prezzoCentesimi, starter.voci[0]], [4, 64900, "4 gare incluse ogni mese per i primi 6 mesi, poi 3 al mese"]);
  uguale("gli altri piani non cambiano di una virgola", [vista.piani[1], vista.piani[2]], [catalogo[1], catalogo[2]]);
  uguale("senza gare dedicate il piano offerto cambia solo il prezzo (gare e voci come prima)", (() => {
    const v = applicaPilotAlCatalogo(catalogo, { ...offertaCat, gareIncluse: null }).piani[0];
    return [v.gareIncluse, v.voci];
  })(), [3, PIANI.starter.voci]);
  uguale("un'offerta come quelle di prima (senza il campo) non cambia nulla alle gare", (() => {
    const { gareIncluse: _tolto, ...vecchia } = offertaCat;
    void _tolto;
    const v = applicaPilotAlCatalogo(catalogo, vecchia).piani[0];
    return [v.gareIncluse, v.prezzoCentesimi];
  })(), [3, 64900]);
  atteso("un prezzo pilot non inferiore al listino non è un'offerta: nemmeno le gare cambiano", applicaPilotAlCatalogo(catalogo, { ...offertaCat, prezzoCentesimi: 69900 }).piani[0].gareIncluse === 3);
  atteso("il catalogo originale non viene modificato", catalogo[0].gareIncluse === 3 && catalogo[0].voci[0] === "3 gare incluse ogni mese");

  console.log("--- Lettura dell'offerta e gare di un abbonamento (finto database) ---");
  type Risposta = { data: unknown; error: { code?: string; message?: string } | null };
  function finto(risposta: Risposta) {
    const chiamate: string[] = [];
    const catena: Record<string, unknown> = {};
    for (const metodo of ["select", "eq", "not", "order", "limit"]) catena[metodo] = () => catena;
    catena.maybeSingle = async () => risposta;
    const admin = { from: (tabella: string) => (chiamate.push(tabella), catena) };
    return { admin: admin as unknown as Parameters<typeof gareInclusePerAbbonamento>[0]["admin"], chiamate };
  }
  const riga = (extra: Record<string, unknown> = {}) => ({
    id: "00000000-0000-4000-8000-0000000000cc",
    user_id: "u1",
    piano: "starter",
    prezzo_centesimi: 64900,
    mesi: 6,
    attiva: true,
    creata_il: "2026-10-01T09:00:00Z",
    creata_da_email: "ufficio@omniaitalia.com",
    acquistata_il: "2026-10-10T09:00:00Z",
    scade_il: "2027-04-10T09:00:00Z",
    prezzo_pieno_centesimi: 69900,
    promemoria_inviato_il: null,
    gare_incluse: 4,
    stripe_subscription_id: "sub_AAA",
    ...extra,
  });
  const gare = async (r: Risposta, p: Partial<{ piano: string | null; stripeSubscriptionId: string | null; adesso: Date }> = {}) => {
    const f = finto(r);
    const n = await gareInclusePerAbbonamento({ userId: "u1", piano: "starter", stripeSubscriptionId: "sub_AAA", adesso: ADESSO, ...p, admin: f.admin });
    return { n, chiamate: f.chiamate.length };
  };
  uguale("offerta in regola: 4 gare, una sola lettura", await gare({ data: riga(), error: null }), { n: 4, chiamate: 1 });
  uguale("nessuna offerta acquistata: 3 gare (quelle di Starter)", (await gare({ data: null, error: null })).n, 3);
  uguale("l'offerta non dedica gare: 3", (await gare({ data: riga({ gare_incluse: null }), error: null })).n, 3);
  uguale("colonna assente (migrazione 0093 non ancora eseguita): 3, nessun blocco", (await gare({ data: null, error: { code: "42703", message: "column gare_incluse does not exist" } })).n, 3);
  uguale("tabella assente: 3", (await gare({ data: null, error: { code: "42P01", message: "relation does not exist" } })).n, 3);
  uguale("errore qualunque di lettura: 3, mai un blocco", (await gare({ data: null, error: { code: "XX000", message: "boom" } })).n, 3);
  uguale("pilot scaduto: 3", (await gare({ data: riga({ scade_il: "2026-11-01T00:00:00Z" }), error: null })).n, 3);
  uguale("mesi = 0: sempre 4", (await gare({ data: riga({ mesi: 0, scade_il: null }), error: null }, { adesso: new Date("2030-01-01T00:00:00Z") })).n, 4);
  uguale("altro abbonamento Stripe: 3", (await gare({ data: riga({ stripe_subscription_id: "sub_ZZZ" }), error: null })).n, 3);
  uguale("senza identificativo dell'abbonamento: 3 e nemmeno si legge l'offerta", await gare({ data: riga(), error: null }, { stripeSubscriptionId: null }), { n: 3, chiamate: 0 });
  uguale("piano Professional dell'abbonamento: 8 (l'offerta è per Starter)", (await gare({ data: riga(), error: null }, { piano: "professional" })).n, 8);
  uguale("piano scritto «Starter » con maiuscola e spazio: riconosciuto come sempre", (await gare({ data: riga(), error: null }, { piano: " Starter " })).n, 4);
  uguale("piano non riconosciuto: 0 gare, come prima, e nessuna lettura", await gare({ data: riga(), error: null }, { piano: "gold" }), { n: 0, chiamate: 0 });
  uguale("piano assente: 0 gare", (await gare({ data: riga(), error: null }, { piano: null })).n, 0);
  atteso("la riga del database diventa un'offerta con gare e abbonamento", (() => {
    const o = offertaDaRiga(riga());
    return o !== null && o.gareIncluse === 4 && o.stripeSubscriptionId === "sub_AAA";
  })());
  atteso("una riga di prima della 0093 (colonne assenti) diventa un'offerta senza gare dedicate", (() => {
    const { gare_incluse: _g, stripe_subscription_id: _s, ...vecchia } = riga();
    void _g;
    void _s;
    const o = offertaDaRiga(vecchia as unknown as Parameters<typeof offertaDaRiga>[0]);
    return o !== null && o.gareIncluse === null && o.stripeSubscriptionId === null;
  })());
  atteso("le colonne lette comprendono le gare e l'abbonamento", /gare_incluse/.test(COLONNE_OFFERTA_PILOT) && /stripe_subscription_id/.test(COLONNE_OFFERTA_PILOT));

  console.log("--- Migrazione 0093 ---");
  const mig = leggi("supabase/migrations/0093_omnia_ai_pilot_gare_incluse.sql");
  const sql = mig.split("\n").filter((r) => !r.trimStart().startsWith("--")).join("\n");
  atteso("aggiunge UNA colonna, solo se manca, senza obbligo (nullable) e con limiti 1-100", /alter table public\.omnia_ai_offerte_pilot\s+add column if not exists gare_incluse integer\s+check \(gare_incluse is null or gare_incluse between 1 and 100\)/.test(sql) && !/not null/.test(sql));
  atteso("nessun dato toccato, nessuna cancellazione", !/\b(update|delete\s+from|truncate|drop\s+(table|column)|insert\s+into)\b/i.test(sql));
  atteso("nessun permesso nuovo né regole: la tabella resta solo della chiave di servizio", !/\b(grant|revoke|create policy|anon|authenticated)\b/i.test(sql));
  atteso("il limite del campo nel database è lo stesso del codice", GARE_PILOT_MAX === 100);

  console.log("--- I tre punti che leggono la quota passano tutti da gareInclusePerAbbonamento ---");
  const consumo = leggi("src/lib/gara-consumo.ts");
  const diritto = leggi("src/lib/gara-diritto.ts");
  const periodo = leggi("src/lib/omnia-ai-consumo-periodo.ts");
  for (const [nome, sorgente] of [["consumo di una gara", consumo], ["verifica del diritto", diritto], ["riepilogo del periodo", periodo]] as const) {
    atteso(`${nome}: usa il punto unico`, /gareInclusePerAbbonamento\(\{ userId, piano: subscription\.plan, stripeSubscriptionId: subscription\.stripe_subscription_id/.test(sorgente));
    atteso(`${nome}: non legge più le gare direttamente dal piano`, !/PIANI\[[a-zA-Z]+\]\??\.gareIncluse/.test(sorgente.replace(/\/\/.*$/gm, "")));
    atteso(`${nome}: legge l'identificativo dell'abbonamento Stripe dalla tabella degli abbonamenti`, /from\("subscriptions"\)\s*\.select\(\s*"[^"]*\bstripe_subscription_id\b[^"]*"/.test(sorgente));
  }
  atteso("consumo e diritto calcolano le gare solo per un abbonamento ancora in corso (altrimenti 0)", /subscriptionAttiva\s*\?\s*await gareInclusePerAbbonamento/.test(consumo.replace(/\n\s*/g, " ")) && /abbonamentoAttivo\s*\?\s*await gareInclusePerAbbonamento/.test(diritto.replace(/\n\s*/g, " ")));
  atteso("consumo: il controllo «ne restano?» usa il numero effettivo", /\(count \?\? 0\) < gareIncluse/.test(consumo) && /subscriptionAttiva && gareIncluse > 0/.test(consumo));
  atteso("diritto: la fonte della quota porta il numero effettivo", /piano = \{ gareIncluse, consumate: count \?\? 0 \}/.test(diritto));
  atteso("riepilogo: gare residue = effettive − consumate", /Math\.max\(0, gareIncluse - \(consumatePiano \?\? 0\)\)/.test(periodo));
  const pilotLib = leggi("src/lib/omnia-ai-pilot.ts");
  const corpoQuota = pilotLib.slice(pilotLib.indexOf("export async function gareInclusePerAbbonamento"), pilotLib.indexOf("// ───── Acquisto: dal webhook Stripe"));
  atteso("il punto unico: piano non riconosciuto = 0, senza abbonamento Stripe = gare del piano, poi la regola pura", /if \(!slug\) return 0;/.test(corpoQuota) && /if \(!params\.stripeSubscriptionId\) return gareDelPiano;/.test(corpoQuota) && /return gareIncluseEffettive\(/.test(corpoQuota));
  atteso("il punto unico legge l'offerta dal server e non scrive nulla", /leggiPilotAcquistato\(params\.userId, params\.admin\)/.test(corpoQuota) && !/\.(insert|update|delete|upsert)\(/.test(corpoQuota));
  const corpoPromemoria = pilotLib.slice(pilotLib.indexOf("export async function inviaPromemoriaPilot"));
  atteso("il promemoria dice a quante gare si torna solo se in questo momento ci sono gare dedicate", /select\("status, cancel_at_period_end, plan, stripe_subscription_id"\)/.test(corpoPromemoria.replace(/\n\s*/g, "")) && /gareIncluseEffettive\(/.test(corpoPromemoria) && /testoPromemoriaPilot\(promemoria, prezzoPieno, gareDedicateOra \? gareDelPiano : undefined\)/.test(corpoPromemoria));

  console.log("--- Cambio piano e checkout: nessun cambiamento nei calcoli di Stripe ---");
  const checkout = leggi("src/app/actions/omnia-ai-subscription.ts");
  atteso("il checkout non parla di gare: Stripe vede solo il prezzo (le gare le decidiamo noi)", !/gareIncluse|gare_incluse/.test(checkout));
  const webhook = leggi("src/app/api/webhooks/stripe/route.ts");
  atteso("il webhook non parla di gare dedicate: registra solo l'acquisto dell'offerta, come prima", !/gare_incluse/.test(webhook));
  const cambioPiano = leggi("src/app/actions/omnia-ai-plan-change.ts");
  atteso("l'anteprima del cambio piano mostra le gare del piano di destinazione (le gare dedicate valgono solo sul piano dell'offerta)", /gareIncluseNuovo: nuovo\.gareIncluse/.test(cambioPiano) && !/gareInclusePerAbbonamento/.test(cambioPiano));

  console.log("--- Console ---");
  const az = leggi("src/app/site-console/azioni/pilot.ts");
  const corpoCrea = az.slice(az.indexOf("export async function creaOffertaPilot"), az.indexOf("export async function revocaOffertaPilot"));
  atteso("l'azione legge il campo «gare» e lo passa al controllo (la stessa funzione provata qui)", /gare: String\(formData\.get\("gare"\) \?\? ""\)/.test(corpoCrea) && /validaNuovaOffertaPilot\(/.test(corpoCrea));
  atteso("la colonna si scrive solo se ci sono gare dedicate (un'offerta solo di prezzo funziona anche prima della 0093)", /\.\.\.\(v\.gareIncluse !== null \? \{ gare_incluse: v\.gareIncluse \} : \{\}\)/.test(corpoCrea));
  atteso("con gare dedicate, prima di revocare l'offerta precedente si controlla che la colonna esista", /select\("gare_incluse"\)\.limit\(1\)/.test(corpoCrea) && corpoCrea.indexOf('select("gare_incluse")') < corpoCrea.indexOf("update({ attiva: false })") && /migrazione 0093/.test(corpoCrea));
  atteso("un errore di colonna assente dopo l'inserimento dà il messaggio chiaro, non un errore generico", /v\.gareIncluse !== null && schemaAssente\(error\)/.test(corpoCrea));
  const scheda = leggi("src/app/site-console/_componenti/scheda-cliente-vista.tsx");
  const pannello = scheda.slice(scheda.indexOf("Offerta pilot: solo per i clienti creati dalla console"), scheda.indexOf("Accessi ai suoi dati (registro promesso"));
  atteso("il modulo ha il campo «Gare incluse al mese» (facoltativo, 1-100, vuoto = quelle del piano)", /name="gare"/.test(pannello) && /min=\{1\} max=\{GARE_PILOT_MAX\}/.test(pannello) && /vuoto = quelle del piano/.test(pannello) && !/name="gare"[^>]*required/.test(pannello));
  atteso("l'offerta aperta e quella acquistata mostrano le gare dedicate e a quante si torna", /testoOffertaPilot\(aperta, pilot\.nomi\[aperta\.piano\], pilot\.listini\[aperta\.piano\], PIANI\[aperta\.piano\]\.gareIncluse\)/.test(pannello) && /acquistata\.gareIncluse !== null \? `, con \$\{testoGareIncluse\(acquistata\.gareIncluse\)\}`/.test(pannello) && /le gare tornano a \$\{PIANI\[acquistata\.piano\]\.gareIncluse\} al mese/.test(pannello));
  atteso("la nota del riquadro dice che a fine pilot tornano prezzo e gare del piano", /torna da solo al prezzo pieno e alle gare del piano/.test(pannello));

  console.log("--- Area riservata del cliente ---");
  const layout = leggi("src/app/site-omnia-ai/dashboard/omnia-ai/layout.tsx");
  const abbonamento = leggi("src/app/site-omnia-ai/dashboard/omnia-ai/abbonamento/page.tsx");
  atteso("il promemoria in cima alle pagine dice a quante gare si torna, solo se l'offerta dedica gare", /gareDopo=\{pilot\.gareIncluse !== null \? PIANI\[pilot\.piano\]\.gareIncluse : undefined\}/.test(layout) && /testoPromemoriaPilot\(promemoria, prezzoPieno, gareDopo\)/.test(layout));
  atteso("la pagina Abbonamento mostra le gare dedicate solo se sono davvero in vigore (numero effettivo diverso da quello del piano)", /const gareDedicateInVigore = pilotAttuale && piano && gareIncluse !== piano\.gareIncluse \? gareIncluse : null;/.test(abbonamento) && /testoPilotInCorso\(\{ \.\.\.pilotAttuale, gareIncluse: gareDedicateInVigore \}, piano\?\.gareIncluse\)/.test(abbonamento));
  atteso("il modulo di acquisto mostra le voci del catalogo (quindi la voce con le gare dedicate)", /p\.voci\.map\(/.test(leggi("src/app/site-omnia-ai/dashboard/omnia-ai/activate-subscription-form.tsx")) && /applicaPilotAlCatalogo\(/.test(layout) && /applicaPilotAlCatalogo\(/.test(abbonamento));
  atteso("l'area cliente non rimanda alla console", ![layout, abbonamento, pilotLib].some((t) => /console\.omniaitalia\.com|CONSOLE_BASE_URL|site-console|lib\/console/.test(t)));

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
