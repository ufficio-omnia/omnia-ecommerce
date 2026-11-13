// Autotest dei SERVIZI AGGIUNTIVI per settore (richiesta dell'utente, 09/11/2026):
//   1. pagina dei piani: via l'abbonamento al piano di lavoro (senza cancellare il lavoro fatto), sezione «scopri cosa puoi elaborare in una gara
//      oltre alla relazione tecnica» con menu a tendina per categoria: pulizie → piano di lavoro (solo «per una gara» e «formule attive»),
//      ristorazione collettiva → OMNIA FOOD MENU (sta arrivando), le altre categorie → «Stiamo lavorando»; mai un «Abbonati» per questi servizi;
//   2. dentro la gara: l'analisi dei documenti decide il settore (pulizie / ristorazione collettiva / altro) e la scheda propone il servizio giusto:
//      pulizie → piano di lavoro, ristorazione collettiva → OMNIA FOOD MENU (sta arrivando), altro → nulla; le gare non ancora classificate
//      (analizzate prima) restano come prima; le azioni del server rifiutano il piano di lavoro per le gare di altro genere.
// Nessuna rete, nessun database, nessun modello (la prova col modello vero è scripts/prova-settore-modello.ts). Gratuito: gira nel livello 1.
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import {
  FOOD_MENU,
  MESSAGGIO_PIANO_LAVORO_SOLO_PULIZIE,
  PROPRIETA_SETTORE_ESTRAZIONE,
  SETTORI,
  normalizzaSettore,
  proponeFoodMenu,
  proponePianoLavoro,
  type Settore,
} from "../src/lib/gara-settore";
import { CATEGORIE_SERVIZI, IN_LAVORAZIONE, SEZIONE_SERVIZI, SUFFISSO_STATO_NEL_MENU, etichettaNelMenu } from "../src/lib/servizi-categorie";
import { ABBONAMENTO_PIANO_LAVORO_OFFERTO, BANDA_PIANO_LAVORO, MESSAGGIO_ABBONAMENTO_PIANO_LAVORO_NON_OFFERTO } from "../src/lib/piano-lavoro-testi";
import { surplusSeInVendita, venditaAbbonamentoPianoLavoroAttiva } from "../src/lib/piano-lavoro-offerta";
import ServiziPerCategoria from "../src/app/site-omnia-ai/piani/servizi-per-categoria";
import { NOTA_SERVIZI_SETTORE, PIANI } from "../src/lib/omnia-ai-plans";
import { costruisciCatalogo } from "../src/lib/omnia-ai-catalogo-calcoli";
import FoodMenuPanel from "../src/app/site-omnia-ai/dashboard/omnia-ai/gare/[id]/food-menu-panel";

const richiedi = createRequire(path.join(__dirname, "..", "package.json"));
const { createElement } = richiedi("react") as typeof import("react");
const { renderToStaticMarkup } = richiedi("react-dom/server") as typeof import("react-dom/server");

const fallimenti: string[] = [];
function atteso(nome: string, ok: boolean, dettaglio = "") {
  console.log(`${ok ? "ok    " : "FALLITO"} ${nome}${ok ? "" : ` — ${dettaglio}`}`);
  if (!ok) fallimenti.push(nome);
}
function uguale(nome: string, ottenuto: unknown, previsto: unknown) {
  atteso(nome, JSON.stringify(ottenuto) === JSON.stringify(previsto), `ottenuto ${JSON.stringify(ottenuto)}, previsto ${JSON.stringify(previsto)}`);
}
const radice = path.join(__dirname, "..");
const leggi = (relativo: string) => fs.readFileSync(path.join(radice, relativo), "utf-8").replace(/\r\n/g, "\n");
const senzaCommenti = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const testoDi = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

async function main() {
  // ═════ 1. Il settore e cosa si propone ═════
  console.log("--- Settore: valori, normalizzazione, cosa si propone ---");
  uguale("i settori sono tre: pulizie, ristorazione collettiva, altro", [...SETTORI], ["pulizie", "ristorazione_collettiva", "altro"]);
  uguale("normalizzaSettore: i tre valori (anche con spazi attorno)", ["pulizie", " ristorazione_collettiva ", "altro"].map(normalizzaSettore), ["pulizie", "ristorazione_collettiva", "altro"]);
  uguale("normalizzaSettore: tutto il resto è «non classificato» (null), mai un valore inventato", ["Pulizie", "mensa", "ristorazione", "", "  ", null, undefined, 5, {}, ["pulizie"]].map(normalizzaSettore), Array(10).fill(null));
  const tutti: (Settore | null)[] = [null, "pulizie", "ristorazione_collettiva", "altro"];
  uguale("piano di lavoro: si propone alle gare di pulizia e a quelle non ancora classificate (come prima), NON a ristorazione e altro", tutti.map(proponePianoLavoro), [true, true, false, false]);
  uguale("OMNIA FOOD MENU: si propone SOLO alle gare di ristorazione collettiva", tutti.map(proponeFoodMenu), [false, false, true, false]);
  atteso("mai i due servizi insieme sulla stessa gara", tutti.every((s) => !(proponePianoLavoro(s) && proponeFoodMenu(s))));
  atteso("«altro» non propone nulla", !proponePianoLavoro("altro") && !proponeFoodMenu("altro"));

  console.log("\n--- Schema dell'analisi: il modello decide il settore dall'oggetto dell'appalto ---");
  const P = PROPRIETA_SETTORE_ESTRAZIONE.settore_gara;
  uguale("il campo è un elenco chiuso dei tre settori", [P.type, [...P.enum]], ["string", ["pulizie", "ristorazione_collettiva", "altro"]]);
  atteso("la descrizione decide dall'OGGETTO PRINCIPALE, dice cos'è ciascun settore (CPV compresi), che i servizi accessori non contano e che nel dubbio è «altro»", /OGGETTO PRINCIPALE/.test(P.description) && /'pulizie'/.test(P.description) && /'ristorazione_collettiva'/.test(P.description) && /'altro'/.test(P.description) && /909xxxxx/.test(P.description) && /55xxxxxx/.test(P.description) && /Nel dubbio rispondi 'altro'/.test(P.description) && /servizi accessori/.test(P.description) && /nessuno dei due citati è chiaramente quello principale/.test(P.description) && /NON sono 'pulizie' lo spazzamento stradale, la raccolta dei rifiuti e l'igiene urbana \(sono 'altro'\)/.test(P.description));
  const estrazione = leggi("src/app/actions/gara-extraction.ts");
  atteso("l'analisi dei documenti usa lo schema del settore e lo chiede sempre (campo obbligatorio dello strumento)", /\.\.\.PROPRIETA_SETTORE_ESTRAZIONE,/.test(estrazione) && /required: \["criteri_valutazione", "requisiti", "limiti_formattazione", "settore_gara"\]/.test(estrazione) && /settore_gara\?: string;/.test(estrazione));
  const principale = estrazione.slice(estrazione.indexOf(".update({\n        stazione_appaltante"), estrazione.indexOf("estrazione_aggiornata_il: estrazioneAggiornataIl,"));
  atteso("il settore si salva a PARTE (senza la migrazione 0103 l'analisi e il resto funzionano come prima), a ogni analisi, tollerando la colonna mancante; una risposta non valida lascia «non classificata»", principale.length > 100 && !/settore/.test(principale) && /update\(\{ settore: normalizzaSettore\(result\.settore_gara\) \}\)\.eq\("id", garaId\);\s*if \(erroreSettore && !schemaAssente\(erroreSettore\)\)/.test(estrazione) && !/scadenza_manuale: decisioneScadenza\.scadenza_manuale[^}]*settore/.test(estrazione));

  // ═════ 2. OMNIA FOOD MENU ═════
  console.log("\n--- OMNIA FOOD MENU: il testo ---");
  const testoFood = JSON.stringify(FOOD_MENU);
  atteso("nome e stato: «OMNIA FOOD MENU» e «Sta arrivando»", FOOD_MENU.nome === "OMNIA FOOD MENU" && FOOD_MENU.stato === "Sta arrivando");
  atteso("il testo dice quello che ha chiesto l'utente: menu stagionali, ricettari, grammature, tabelle degli allergeni, piani delle derrate alimentari, rispetto dei requisiti, verifiche di conformità ai CAM, al futuro (genererà)", ["menu stagionali", "ricettari", "grammature", "tabelle degli allergeni", "piani delle derrate alimentari", "nel rispetto dei requisiti", "verifiche di conformità ai CAM", "genererà"].every((s) => FOOD_MENU.testo.includes(s)));
  atteso("le tre schede ripetono le stesse cose, senza inventarne altre (nessun numero, nessuna data, nessun prezzo, nessun «abbonamento»)", FOOD_MENU.punti.length === 3 && !/\d|€|abbonament|abbonati|prezzo/i.test(testoFood) && /CAM/.test(FOOD_MENU.punti[2].dettaglio));
  atteso("la nota dice che non è ancora disponibile, senza promettere una data", /non è ancora disponibile/.test(FOOD_MENU.nota) && !/\d/.test(FOOD_MENU.nota));

  // ═════ 3. Le categorie e la sezione della pagina dei piani ═════
  console.log("\n--- Pagina dei piani: le categorie ---");
  uguale("le prime due categorie sono pulizie (disponibile) e ristorazione collettiva (in arrivo); i loro valori sono settori veri dell'analisi", [CATEGORIE_SERVIZI[0], CATEGORIE_SERVIZI[1]].map((c) => [c.valore, c.stato, (SETTORI as readonly string[]).includes(c.valore)]), [["pulizie", "disponibile", true], ["ristorazione_collettiva", "in_arrivo", true]]);
  atteso("tutte le altre categorie sono «in lavorazione» e non c'è altro «disponibile» o «in arrivo»", CATEGORIE_SERVIZI.slice(2).every((c) => c.stato === "in_lavorazione") && CATEGORIE_SERVIZI.filter((c) => c.stato !== "in_lavorazione").length === 2);
  atteso("i valori sono unici e le etichette non vuote", new Set(CATEGORIE_SERVIZI.map((c) => c.valore)).size === CATEGORIE_SERVIZI.length && CATEGORIE_SERVIZI.every((c) => c.etichetta.trim() !== ""));
  uguale("nel menu: «Servizi di pulizia», «Ristorazione collettiva — sta arrivando», le altre «— stiamo lavorando»", [etichettaNelMenu(CATEGORIE_SERVIZI[0]), etichettaNelMenu(CATEGORIE_SERVIZI[1]), etichettaNelMenu(CATEGORIE_SERVIZI[2])], ["Servizi di pulizia", "Ristorazione collettiva — sta arrivando", "Manutenzione del verde — stiamo lavorando"]);
  atteso("la sezione dice quello che ha chiesto l'utente: inserisci a quale categoria appartieni, scopri cosa puoi elaborare all'interno di una gara, oltre alla relazione tecnica", /Inserisci a quale categoria appartieni/.test(SEZIONE_SERVIZI.titolo) && /scopri cosa puoi elaborare all'interno di una gara/.test(SEZIONE_SERVIZI.titolo) && /oltre alla relazione tecnica/.test(SEZIONE_SERVIZI.titolo));
  atteso("per le categorie «in lavorazione» il testo dice «Stiamo lavorando», senza promesse, date o prezzi", /Stiamo lavorando/.test(IN_LAVORAZIONE.stato) && !/\d|€/.test(JSON.stringify(IN_LAVORAZIONE)) && SUFFISSO_STATO_NEL_MENU.disponibile === "");

  console.log("\n--- Pagina dei piani: cosa si vede scegliendo (disegno vero del componente) ---");
  const disegna = (categoriaIniziale?: string) => renderToStaticMarkup(createElement(ServiziPerCategoria, { prezzoSingolaGara: "75,00 €", categoriaIniziale }));
  const vuoto = disegna();
  const optionVuoto = [...vuoto.matchAll(/<option[^>]*value="([^"]*)"[^>]*>([^<]*)<\/option>/g)].map((m) => [m[1], m[2]]);
  uguale("senza scelta: il menu ha il segnaposto e tutte le categorie, con «sta arrivando» / «stiamo lavorando»", optionVuoto.map((o) => o[1]), ["Seleziona una categoria…", ...CATEGORIE_SERVIZI.map(etichettaNelMenu)]);
  // Senza scelta, nel disegno ci sono solo il titolo, il menu e le sue voci: il contenuto dei servizi (nome, descrizione, prezzo) NON c'è. Si
  // controlla l'area del contenuto a sé (deve essere vuota) e che le frasi dei servizi non compaiano in nessun punto del disegno.
  const areaVuota = /<div class="omnia-servizi-esito" aria-live="polite"><\/div>/.test(vuoto);
  atteso("senza scelta l'area del contenuto è VUOTA e non c'è nessun titolo del contenuto (h3): il servizio compare SOLO scegliendo la categoria", areaVuota && !/<h3/.test(vuoto));
  atteso("senza scelta nessuna frase dei servizi né prezzo compare da nessuna parte nel disegno", ["75,00", "Dai documenti di gara a un piano di lavoro", "Formule attive", FOOD_MENU.titolo, FOOD_MENU.testo, IN_LAVORAZIONE.titolo, IN_LAVORAZIONE.testo].every((frase) => !testoDi(vuoto).includes(frase)));
  atteso("il menu è un vero elenco a tendina con la sua etichetta collegata, e l'area del contenuto si annuncia ai lettori di schermo", /<label class="omnia-etichetta" for="([^"]+)">La tua categoria<\/label><select id="\1" class="omnia-select"/.test(vuoto) && /aria-live="polite"/.test(vuoto));

  const pulizie = disegna("pulizie");
  const tPulizie = testoDi(pulizie);
  atteso("«Servizi di pulizia»: il piano di lavoro, con SOLO «Per una gara» (75,00 € IVA inclusa) e «Formule attive»", /Piano di lavoro/.test(tPulizie) && /Dai documenti di gara a un piano di lavoro in Excel(?!\.)/.test(tPulizie) && (pulizie.match(/<li>/g) ?? []).length === 2 && /Per una gara 75,00 € IVA inclusa, senza abbonamento/.test(tPulizie) && /Formule attive modifichi i valori e tutti i fogli si aggiornano/.test(tPulizie));
  atteso("«Servizi di pulizia»: NIENTE abbonamento al piano di lavoro (nessuna scheda «Nell'abbonamento», nessun supplemento mensile, nessun «al mese», nessun «Abbonati»)", !/Nell'abbonamento|al mese|in più|supplemento|\+\s*\d|Abbonati|Con il piano di lavoro Excel/i.test(tPulizie.replace("senza abbonamento", "")));
  atteso("«Servizi di pulizia»: dimensionamento di partenza, non un preventivo, collegamento alle condizioni del servizio", /non un preventivo/.test(tPulizie) && /href="\/condizioni-piano-lavoro"/.test(pulizie));

  const food = disegna("ristorazione_collettiva");
  const tFood = testoDi(food);
  atteso("«Ristorazione collettiva»: OMNIA FOOD MENU, «Sta arrivando», la descrizione e le tre schede", tFood.includes("Sta arrivando") && tFood.includes("OMNIA FOOD MENU") && tFood.includes(FOOD_MENU.titolo) && tFood.includes(FOOD_MENU.testo) && FOOD_MENU.punti.every((p) => tFood.includes(p.titolo) && tFood.includes(p.dettaglio)) && (food.match(/<li>/g) ?? []).length === 3);
  atteso("«Ristorazione collettiva»: nessun prezzo, nessun acquisto, nessun «Abbonati»", !/€|\d,\d\d|Abbonati|Acquista|Compra/i.test(tFood));

  const verde = disegna("verde");
  const tVerde = testoDi(verde);
  atteso("una categoria «in lavorazione»: «Stiamo lavorando» con il suo testo; nessun servizio, nessun prezzo", tVerde.includes(IN_LAVORAZIONE.stato) && tVerde.includes(IN_LAVORAZIONE.titolo) && tVerde.includes(IN_LAVORAZIONE.testo) && !/Piano di lavoro|OMNIA FOOD MENU|€|Abbonati/.test(tVerde));
  atteso("un valore iniziale che non è nel menu vale «nessuna scelta»: stesso identico disegno di quando non si è scelto niente (segnaposto selezionato, nessun contenuto)", disegna("inventata") === vuoto && disegna("") === vuoto && !disegna("inventata").includes("<h3"));
  atteso("ogni categoria «in lavorazione» mostra «Stiamo lavorando»", CATEGORIE_SERVIZI.filter((c) => c.stato === "in_lavorazione").every((c) => testoDi(disegna(c.valore)).includes(IN_LAVORAZIONE.titolo)));

  const sezione = leggi("src/app/site-omnia-ai/piani/servizi-per-categoria.tsx");
  atteso("il componente non nomina mai l'abbonamento al piano di lavoro e non ha pulsanti di acquisto", !/surplus|Abbonati|abbonati\/|href=\{`\/abbonati|partiRigaPianoLavoroPerPiano|punti\.abbonamento/.test(senzaCommenti(sezione)));

  console.log("\n--- Pagina dei piani: l'ordine delle sezioni e l'abbonamento tolto ---");
  const vista = leggi("src/app/site-omnia-ai/piani/piani-vista.tsx");
  const posSchede = vista.indexOf('<div className="omnia-prezzi">');
  const posServizi = vista.indexOf("<ServiziPerCategoria");
  const posRevisione = vista.indexOf("<RevisioneBanda />");
  atteso("la nuova sezione sta tra le schede dei piani e la «Revisione umana» (il punto segnato dall'utente); la vecchia fascia in fondo non c'è più", posSchede > 0 && posServizi > posSchede && posRevisione > posServizi && !/<PianoLavoroBanda/.test(vista));
  atteso("le schede dei piani non hanno più la riga del piano di lavoro (+X € al mese) né il supplemento", !/partiRigaPianoLavoroPerPiano|omnia-prezzo-opzione|surplusPianoLavoro|opzione\./.test(vista) && !/Con il piano di lavoro Excel|al mese\./.test(senzaCommenti(vista)));
  atteso("«Abbonati» e «Richiedi la demo» delle schede sono rimasti come prima", /\{vendita && \(\s*<Link className="omnia-btn omnia-btn-p" href=\{`\/abbonati\/\$\{p\.slug\}`\}>/.test(vista) && /Richiedi la demo/.test(vista));
  atteso("il vecchio componente della fascia resta nel codice (lavoro non cancellato) ma non è più usato in nessuna pagina", fs.existsSync(path.join(radice, "src/app/site-omnia-ai/piani/piano-lavoro-banda.tsx")) && !/piano-lavoro-banda|PianoLavoroBanda/.test(senzaCommenti(vista)) && /NON PIÙ USATA/.test(leggi("src/app/site-omnia-ai/piani/piano-lavoro-banda.tsx")));
  atteso("da telefono le due schede del piano di lavoro vanno in colonna come le tre degli altri riquadri, senza toccare la regola già esistente delle tre schede", /@media \(max-width: 900px\) \{[\s\S]*?\.omnia-revisione-punti \{\s*grid-template-columns: 1fr;\s*\}\s*\.omnia-revisione-punti\.due \{\s*grid-template-columns: 1fr;\s*\}/.test(leggi("src/app/site-omnia-ai/omnia-ai.css")));
  atteso("il testo della vecchia fascia (con la scheda «Nell'abbonamento») resta nel modulo dei testi, non cancellato", BANDA_PIANO_LAVORO.punti.abbonamento.titolo === "Nell'abbonamento");

  // ═════ 3 bis. Le schede dei piani: i servizi extra (richiesta dell'utente, 13/11/2026; SOLO testo della pagina) ═════
  console.log("\n--- Pagina dei piani: i servizi extra sulle schede ---");
  {
    const { starter, professional, enterprise } = PIANI;
    atteso(
      "Starter: riquadro «Servizi extra, quando ti servono», acquistabili in autonomia dall'area riservata: la copertina (PDF e PNG, 6 automatiche + 3 su misura in chat) e i servizi del settore*",
      starter.servizi?.titolo === "Servizi extra, quando ti servono" && /acquisti in autonomia dalla tua area riservata/.test(starter.servizi?.intro ?? "") && /Copertina della relazione tecnica in PDF e PNG: 6 proposte automatiche \+ 3 su misura, chiedendo le modifiche all'assistente in chat/.test(starter.servizi?.punti[0] ?? "") && starter.servizi?.punti[1] === "Servizi dedicati al tuo settore*",
    );
    atteso(
      "Professional: i servizi COMPRESI sono voci dell'elenco, dopo quelle di prima (niente riquadro); tolte «Intestazioni e piè di pagina con il tuo logo»",
      professional.servizi === null &&
        !professional.voci.some((v) => /Intestazioni|piè di pagina/i.test(v)) &&
        JSON.stringify(professional.voci) ===
          JSON.stringify([
            "8 gare incluse ogni mese",
            "Tutto il piano Starter",
            "Supporto prioritario",
            "Copertina della relazione tecnica compresa in ogni gara: PDF e PNG, 6 proposte automatiche + 3 su misura chiedendo le modifiche in chat",
            "Servizi dedicati al tuo settore* compresi in ogni gara",
          ]),
    );
    atteso("l'asterisco ha la sua nota (per i servizi di pulizia: il piano di lavoro), sotto Starter e Professional", NOTA_SERVIZI_SETTORE === "* Per esempio, per i servizi di pulizia: il piano di lavoro della gara in Excel." && starter.nota === NOTA_SERVIZI_SETTORE && professional.nota === NOTA_SERVIZI_SETTORE);
    atteso("Enterprise non cambia: ha già «Tutto il piano Professional» (quindi anche i servizi), senza un riquadro in più", enterprise.servizi === null && enterprise.nota === null && enterprise.voci.includes("Tutto il piano Professional"));
    atteso("Starter conserva le sue tre voci", JSON.stringify(starter.voci) === JSON.stringify(["3 gare incluse ogni mese", "Generazione relazione tecnica in Word", "Estrazione automatica dei criteri di valutazione"]));
    const catalogo = costruisciCatalogo({}, [], "2026-11-13");
    atteso("il catalogo (prezzi dalla console) porta sulle schede anche servizi e nota", JSON.stringify(catalogo.starter.servizi) === JSON.stringify(starter.servizi) && catalogo.professional.nota === NOTA_SERVIZI_SETTORE && catalogo.professional.servizi === null && JSON.stringify(catalogo.professional.voci) === JSON.stringify(professional.voci) && catalogo.enterprise.servizi === null);
    atteso("la scheda mostra il riquadro (titolo, introduzione, punti) e la nota, dopo le voci e prima dei pulsanti", /\{p\.servizi && \(\s*<div className="omnia-prezzo-servizi">\s*<b>\{p\.servizi\.titolo\}<\/b>\s*<p>\{p\.servizi\.intro\}<\/p>/.test(vista) && /p\.servizi\.punti\.map\(\(punto\) =>/.test(vista) && /\{p\.nota && <p className="omnia-prezzo-nota">\{p\.nota\}<\/p>\}/.test(vista) && vista.indexOf('className="omnia-prezzo-elenco"') < vista.indexOf('className="omnia-prezzo-servizi"') && vista.indexOf('className="omnia-prezzo-nota"') < vista.indexOf("{vendita && ("));
    const sceltaPiano = leggi("src/app/site-omnia-ai/dashboard/omnia-ai/activate-subscription-form.tsx");
    atteso("anche la scelta del piano nell'area riservata mostra i servizi e la nota (stesse schede)", /<strong>\{p\.servizi\.titolo\}<\/strong>: \{p\.servizi\.intro\} \{p\.servizi\.punti\.join\("; "\)\}\./.test(sceltaPiano) && /\{p\.nota && <p className="omnia-prezzo-nota">\{p\.nota\}<\/p>\}/.test(sceltaPiano));
    const css = leggi("src/app/site-omnia-ai/omnia-ai.css");
    atteso("le voci delle schede restano in alto anche quando un'altra scheda è più alta (lo spazio in più va sotto)", /\.omnia-prezzo-elenco \{[^}]*align-content: start;[^}]*\}/.test(css) && /\.omnia-prezzo-servizi \{[^}]*\}/.test(css) && /\.omnia-prezzo-servizi p \{[^}]*text-align: left;[^}]*\}/.test(css));
  }

  // ═════ 4. L'abbonamento al piano di lavoro è spento, ovunque ═════
  console.log("\n--- L'abbonamento al piano di lavoro: spento (il lavoro fatto resta nel codice) ---");
  uguale("l'interruttore è spento", ABBONAMENTO_PIANO_LAVORO_OFFERTO, false);
  const env = { ...process.env };
  try {
    // anche con la chiave Stripe reale e senza nessun database l'abbonamento con il piano di lavoro non si offre (e non si tocca il database)
    process.env.STRIPE_SECRET_KEY_OMNIA_AI = "sk_live_" + "x".repeat(30);
    const clientVietato = new Proxy({}, { get() { throw new Error("il database non deve essere letto"); } }) as never;
    uguale("venditaAbbonamentoPianoLavoroAttiva: no, anche con la chiave reale, senza leggere il database", await venditaAbbonamentoPianoLavoroAttiva(clientVietato), false);
    uguale("surplusSeInVendita (moduli di acquisto e di cambio piano): null, senza leggere il database", await surplusSeInVendita(clientVietato), null);
  } finally {
    process.env = env;
  }
  const lib = leggi("src/lib/piano-lavoro-offerta.ts");
  atteso("l'interruttore comanda PRIMA di ogni altra regola (e, se un domani si riaccende, vale quella di prima: vendita accesa + chiave reale)", /if \(!ABBONAMENTO_PIANO_LAVORO_OFFERTO\) return false;\s*return venditaPianoLavoroAttiva\(client\);/.test(lib) && /return \(await venditaAbbonamentoPianoLavoroAttiva\(db\)\) \? await leggiSurplusPianoLavoro\(db\) : null;/.test(lib));
  const sottoscrizione = leggi("src/app/actions/omnia-ai-subscription.ts");
  const cambioPiano = leggi("src/app/actions/omnia-ai-plan-change.ts");
  const paginaAbbonati = leggi("src/app/site-omnia-ai/abbonati/[piano]/page.tsx");
  atteso("checkout, cambio piano e pagina di acquisto usano il punto unico (nessuno usa più la vendita «generale» per l'abbonamento)", [sottoscrizione, cambioPiano, paginaAbbonati].every((s) => /venditaAbbonamentoPianoLavoroAttiva/.test(s) && !/venditaPianoLavoroAttiva/.test(s)));
  atteso("chi chiede l'abbonamento con il piano di lavoro con un modulo costruito a mano riceve un errore chiaro (e non parte nessun pagamento): il controllo è nel server", /MESSAGGIO_ABBONAMENTO_PIANO_LAVORO_NON_OFFERTO/.test(sottoscrizione) && /MESSAGGIO_ABBONAMENTO_PIANO_LAVORO_NON_OFFERTO/.test(cambioPiano) && /non si acquista con l'abbonamento/.test(MESSAGGIO_ABBONAMENTO_PIANO_LAVORO_NON_OFFERTO) && /dentro la singola gara/.test(MESSAGGIO_ABBONAMENTO_PIANO_LAVORO_NON_OFFERTO));
  atteso("chi ha già il piano di lavoro nell'abbonamento lo conserva: tenerlo o toglierlo resta possibile (il blocco è solo sull'AGGIUNTA)", /if \(destinazione\.pianoLavoro && !offertaAttuale\.pianoLavoro\) \{\s*if \(!\(await venditaAbbonamentoPianoLavoroAttiva\(\)\)\)/.test(cambioPiano));
  const gareAcquisto = leggi("src/app/actions/gara-piano-lavoro.ts");
  atteso("l'acquisto del piano di lavoro dentro la SINGOLA GARA non è toccato: usa ancora la vendita del piano di lavoro (interruttore della console + Stripe)", /venditaPianoLavoroAttiva\(admin\)\)\) return \{ error: "L'acquisto del piano di lavoro non è ancora disponibile\." \}/.test(gareAcquisto) && !/venditaAbbonamento/.test(gareAcquisto));

  // ═════ 5. Dentro la gara ═════
  console.log("\n--- Dentro la gara: il servizio giusto per il settore ---");
  const paginaGara = leggi("src/app/site-omnia-ai/dashboard/omnia-ai/gare/[id]/page.tsx");
  atteso("la scheda legge il settore a parte (colonna assente o gara non analizzata = non classificata)", /from\("gare"\)\.select\("settore"\)\.eq\("id", id\)\.maybeSingle<\{ settore: string \| null \}>\(\);\s*const settore = normalizzaSettore\(settoreRaw\?\.settore\);/.test(paginaGara));
  atteso("OMNIA FOOD MENU compare solo a analisi completata e solo per la ristorazione collettiva", /gara\.estrazione_stato === "completata" && proponeFoodMenu\(settore\) && <FoodMenuPanel \/>/.test(paginaGara));
  atteso("il piano di lavoro compare, a analisi fatta, per le gare di pulizia o non classificate; chi ha già dei piani generati li vede sempre (non si toglie nulla di ciò che c'è)", /pianoLavoroDisponibile && \(gara\.estrazione_stato === "completata" \|\| pianiLavoro\.length > 0\) && \(proponePianoLavoro\(settore\) \|\| pianiLavoro\.length > 0\) && <PianoLavoroPanel/.test(paginaGara));
  const pannelloFood = renderToStaticMarkup(createElement(FoodMenuPanel));
  const tPannello = testoDi(pannelloFood);
  // l'unico pulsante ammesso è quello che riduce/riapre la sezione (il titolo): nessun pulsante per acquistare o prenotare, nessun modulo, nessun link
  const pulsantiFood = pannelloFood.match(/<button[^>]*>/g) ?? [];
  atteso(
    "il riquadro nella gara dice «OMNIA FOOD MENU · sta arrivando», la descrizione e le tre voci; nessun pulsante di acquisto (solo quello che riduce la sezione), nessun modulo, nessun link, nessun prezzo",
    tPannello.includes("OMNIA FOOD MENU · sta arrivando") && tPannello.includes(FOOD_MENU.testo) && FOOD_MENU.punti.every((p) => tPannello.includes(p.titolo)) && pulsantiFood.length === 1 && /omnia-servizio-titolo/.test(pulsantiFood[0]) && !/<form|<a /.test(pannelloFood) && !/€|\d,\d\d/.test(tPannello),
  );
  atteso("il riquadro usa lo STESSO testo della pagina dei piani (un solo posto: FOOD_MENU)", /FOOD_MENU\.testo/.test(leggi("src/app/site-omnia-ai/dashboard/omnia-ai/gare/[id]/food-menu-panel.tsx")) && /FOOD_MENU\.testo/.test(sezione));
  atteso("la scheda non propone nulla per le altre gare: nessun terzo riquadro e nessun testo sul settore «altro»", !/proponeAltro|settore === "altro"/.test(paginaGara));

  atteso("generazione del piano di lavoro: rifiutata per una gara che l'analisi ha riconosciuto di altro genere, leggendo il settore dal database (mai dal modulo), prima di ogni altra verifica del diritto", (() => {
    const inizio = gareAcquisto.indexOf("export async function generaPianoLavoroGara(");
    const corpo = gareAcquisto.slice(inizio, gareAcquisto.indexOf("export async function scaricaPianoLavoroGara("));
    return /select\("settore"\)\.eq\("id", garaId\)/.test(corpo) && /if \(!proponePianoLavoro\(normalizzaSettore\(settoreRiga\?\.settore\)\)\) return \{ error: MESSAGGIO_PIANO_LAVORO_SOLO_PULIZIE \}/.test(corpo) && corpo.indexOf("MESSAGGIO_PIANO_LAVORO_SOLO_PULIZIE") < corpo.indexOf("valutaDirittoPiano({") && !/formData\.get\("settore/.test(corpo);
  })());
  atteso("acquisto del piano di lavoro: rifiutato per una gara di altro genere PRIMA di qualsiasi pagamento (prima di leggere i diritti e prima di creare la sessione di Stripe)", (() => {
    const inizio = gareAcquisto.indexOf("export async function acquistaPianoLavoro(");
    const corpo = gareAcquisto.slice(inizio);
    const posGuardia = corpo.indexOf("MESSAGGIO_PIANO_LAVORO_SOLO_PULIZIE");
    return posGuardia > 0 && /select\("settore"\)\.eq\("id", garaId\)/.test(corpo) && posGuardia < corpo.indexOf("leggiDirittiPianoLavoro(") && posGuardia < corpo.indexOf("valutaDirittoPiano({") && posGuardia < corpo.search(/checkout\.sessions\.create|stripe\.checkout/) && !/formData\.get\("settore/.test(corpo);
  })());
  atteso("il messaggio per una gara di altro genere dice che il piano di lavoro è per le gare di pulizia e di rianalizzare se non è così", /gare di servizi di pulizia/.test(MESSAGGIO_PIANO_LAVORO_SOLO_PULIZIE) && /rianalizza/.test(MESSAGGIO_PIANO_LAVORO_SOLO_PULIZIE));
  atteso("il download di un piano già generato NON dipende dal settore (si può sempre scaricare ciò che si è generato)", !/settore/.test(gareAcquisto.slice(gareAcquisto.indexOf("export async function scaricaPianoLavoroGara("), gareAcquisto.indexOf("export async function acquistaPianoLavoro("))));

  // ═════ 6. Migrazione 0103 e catena ═════
  console.log("\n--- Migrazione 0103 e catena ---");
  const sql = leggi("supabase/migrations/0103_gare_settore.sql");
  const sqlCodice = sql.replace(/--[^\n]*/g, "");
  atteso("aggiunge la colonna «settore» (testo, vuota per le gare che c'erano), una volta sola (if not exists), con i tre valori ammessi", /alter table public\.gare\s+add column if not exists settore text;/.test(sqlCodice) && /check \(settore is null or settore in \('pulizie', 'ristorazione_collettiva', 'altro'\)\)/.test(sqlCodice) && /not exists \(\s*select 1 from pg_constraint where conname = 'gare_settore_valori'/.test(sqlCodice));
  atteso("i valori ammessi dalla migrazione sono gli stessi del codice", JSON.stringify([...sqlCodice.matchAll(/'(pulizie|ristorazione_collettiva|altro)'/g)].map((m) => m[1])) === JSON.stringify([...SETTORI]));
  atteso("ricarica lo schema dell'API e non tocca dati né altre tabelle", /notify pgrst, 'reload schema';/.test(sqlCodice) && !/\b(delete|truncate|drop|update)\b/i.test(sqlCodice) && (sqlCodice.match(/alter table/gi) ?? []).length === 2);
  atteso("la migrazione spiega che le gare già analizzate restano come prima fino alla prossima analisi e che il codice funziona anche prima di eseguirla", /comportano come prima/.test(sql) && /tollera la mancanza della colonna/.test(sql));
  atteso("il test è nella catena verifica:livello1", /tsx scripts\/verifica-servizi-settore-omnia-ai\.ts/.test(leggi("package.json")));
  const classificate = leggi("scripts/verifica-ufficio-gare-lavoro-omnia-ai.ts");
  atteso("nessuna nuova azione del server è stata aggiunta (le azioni classificate come lavoro di gara o del titolare sono quelle di prima)", /"gara-extraction.ts": \["extractGaraData", "impostaScadenzaGara", "impostaOraScadenzaGara"\]/.test(classificate) && /"gara-piano-lavoro.ts": \["generaPianoLavoroGara", "scaricaPianoLavoroGara"\]/.test(classificate));

  if (fallimenti.length > 0) {
    console.log(`\n${fallimenti.length} controlli falliti:\n- ${fallimenti.join("\n- ")}`);
    process.exit(1);
  }
  console.log("\nTutti i controlli sono andati a buon fine.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
