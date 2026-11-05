// Autotest del Google tag di omnia-ai.it con Consent Mode v2 AVANZATO (richiesta dell'utente, 05/11/2026): un solo gtag.js nell'HTML
// iniziale con le destinazioni Analytics (G-W551SWPNE4) e Google Ads (AW-18422155730), i quattro consensi «denied» PRIMA di ogni
// configurazione, banner esistente invariato, consenso/rifiuto/revoca gestiti, eventi DEMO subordinati al consenso.
//
// Nessuna rete, nessun browser, nessun Google: lo snippet che il server mette nell'HTML viene ESEGUITO in un contesto isolato (node:vm) con
// un localStorage finto, e una «Google finta» legge la coda dei comandi nell'ordine in cui Google li elabora, dicendo con quale consenso
// ogni «config» avrebbe parlato. Il controllo sull'HTML vero (build + server) è in scripts/controlla-html-google-tag.ts.
import fs from "fs";
import path from "path";
import vm from "node:vm";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ID_ADS_OMNIA_AI,
  ID_GA4_OMNIA_AI,
  PERSONALIZZAZIONE_DOPO_ACCETTA,
  SEGNALI_CONSENSO_GOOGLE,
  URL_GTAG_JS,
  VARIABILE_STATO_CONSENSO_GOOGLE,
  aggiornaConsensoGoogle,
  cancellaCookieGoogle,
  consensoGoogleDaBanner,
  costruisciSnippetIniziale,
  dominiPossibili,
  eCookieGoogle,
  valoriConsensoGoogle,
  type FinestraGoogle,
} from "../src/lib/google-tag";
import { CHIAVE_CONSENSO_COOKIE, cookiePubblicitariAccettati } from "../src/lib/demo-lead-calcoli";
import OmniaAiCookieConsent from "../src/components/omnia-ai/cookie-consent";

const fallimenti: string[] = [];
function atteso(nome: string, ok: boolean, dettaglio = "") {
  console.log(`${ok ? "ok    " : "FALLITO"} ${nome}${ok ? "" : ` — ${dettaglio}`}`);
  if (!ok) fallimenti.push(nome);
}
const radice = path.join(__dirname, "..");
const leggi = (relativo: string) => fs.readFileSync(path.join(radice, relativo), "utf-8").replace(/\r\n/g, "\n");
const elenca = (dir: string): string[] => {
  const uscita: string[] = [];
  for (const v of fs.readdirSync(path.join(radice, dir), { withFileTypes: true })) {
    const f = `${dir}/${v.name}`;
    if (v.isDirectory()) uscita.push(...elenca(f));
    else if (/\.(ts|tsx)$/.test(v.name)) uscita.push(f);
  }
  return uscita;
};
const senzaCommenti = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");

// ── «Browser» finto: esegue lo snippet vero e ricorda cosa è finito nella coda di Google ──────────────────────────────────

type Comando = unknown[];
type Pagina = { sandbox: Record<string, unknown> & { gtag?: (...a: unknown[]) => void }; coda: () => Comando[]; archivio: Map<string, string> };

function apriPagina(salvato: string | null | "bloccato", archivio = new Map<string, string>()): Pagina {
  if (salvato !== null && salvato !== "bloccato") archivio.set(CHIAVE_CONSENSO_COOKIE, salvato);
  const localStorage =
    salvato === "bloccato"
      ? {
          getItem: () => {
            throw new Error("localStorage bloccato");
          },
        }
      : { getItem: (k: string) => archivio.get(k) ?? null, setItem: (k: string, v: string) => void archivio.set(k, v), removeItem: (k: string) => void archivio.delete(k) };
  const sandbox: Pagina["sandbox"] = { localStorage };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(costruisciSnippetIniziale(), sandbox);
  return { sandbox, coda: () => ((sandbox.dataLayer as unknown[]) ?? []).map((a) => Array.from(a as ArrayLike<unknown>)), archivio };
}
type Elaborato = { ordine: string[]; config: { id: string; consenso: Record<string, string> | null }[]; consensoFinale: Record<string, string> | null };
// Come Google legge la coda: lo stato del consenso cambia con «consent default/update» e ogni «config» parla con lo stato di quel momento.
function elabora(coda: Comando[]): Elaborato {
  let stato: Record<string, string> | null = null;
  const ordine: string[] = [];
  const config: Elaborato["config"] = [];
  for (const [cmd, a, b] of coda) {
    if (cmd === "consent") {
      ordine.push(`consent:${String(a)}`);
      stato = a === "default" ? { ...(b as Record<string, string>) } : { ...(stato ?? {}), ...(b as Record<string, string>) };
    } else if (cmd === "config") {
      ordine.push(`config:${String(a)}`);
      config.push({ id: String(a), consenso: stato ? { ...stato } : null });
    } else ordine.push(`${String(cmd)}${cmd === "set" ? `:${String(a)}` : ""}`);
  }
  return { ordine, config, consensoFinale: stato };
}
const fin = (p: Pagina) => p.sandbox as unknown as FinestraGoogle;
const concessi = (s: Record<string, string> | null) => !!s && s.ad_storage === "granted" && s.analytics_storage === "granted" && s.ad_user_data === "granted" && s.ad_personalization === "denied" && Object.keys(s).length === 4;
const tuttiA = (s: Record<string, string> | null, valore: string) => !!s && SEGNALI_CONSENSO_GOOGLE.every((k) => s[k] === valore) && Object.keys(s).length === SEGNALI_CONSENSO_GOOGLE.length;

// Cookie finti con il dominio di ciascuno (null = solo l'host): scrivere «scaduto» toglie il cookie che corrisponde per nome e dominio.
function nuovoBarattolo(iniziali: { nome: string; dominio: string | null }[]) {
  const cookie = iniziali.map((c) => ({ ...c }));
  const norm = (d: string | null) => (d === null ? null : d.replace(/^\./, ""));
  return {
    cookie,
    documento: {
      get cookie() {
        return cookie.map((c) => `${c.nome}=1`).join("; ");
      },
      set cookie(riga: string) {
        const parti = riga.split(";").map((p) => p.trim());
        const [nome] = parti[0].split("=");
        const dominio = parti.find((p) => p.toLowerCase().startsWith("domain="))?.slice(7) ?? null;
        const scaduto = parti.some((p) => /^max-age=0$/i.test(p));
        if (!scaduto) return;
        for (let i = cookie.length - 1; i >= 0; i--) if (cookie[i].nome === nome && norm(cookie[i].dominio) === norm(dominio)) cookie.splice(i, 1);
      },
    },
  };
}

async function main() {
  const snippet = costruisciSnippetIniziale();

  // ═════════════════════════ 1. Lo snippet nell'HTML iniziale ═════════════════════════
  console.log("--- Snippet iniziale (Consent Mode v2 avanzato) ---");
  atteso("gli ID sono quelli richiesti e gtag.js si carica con quello di Analytics (un solo caricamento, la seconda destinazione si aggiunge con «config»)", ID_GA4_OMNIA_AI === "G-W551SWPNE4" && ID_ADS_OMNIA_AI === "AW-18422155730" && URL_GTAG_JS === "https://www.googletagmanager.com/gtag/js?id=G-W551SWPNE4" && !snippet.includes("googletagmanager") && !snippet.includes("gtag/js"));
  atteso("i quattro segnali del Consent Mode v2 sono esattamente questi: ad_storage, analytics_storage, ad_user_data, ad_personalization", JSON.stringify([...SEGNALI_CONSENSO_GOOGLE]) === JSON.stringify(["ad_storage", "analytics_storage", "ad_user_data", "ad_personalization"]));
  atteso("valori: «denied» per tutti e quattro; dopo «Accetta» ad_storage, analytics_storage e ad_user_data «granted» e la PERSONALIZZAZIONE pubblicitaria (ad_personalization) resta «denied» finché un testo non la dichiara", tuttiA(valoriConsensoGoogle("denied"), "denied") && concessi(valoriConsensoGoogle("granted")) && PERSONALIZZAZIONE_DOPO_ACCETTA === "denied");
  atteso("ad_personalization non è mai «granted» con consenso negato, qualunque sia l'impostazione della personalizzazione dopo «Accetta»", valoriConsensoGoogle("denied").ad_personalization === "denied" && /ad_personalization: stato === "granted" \? PERSONALIZZAZIONE_DOPO_ACCETTA : "denied"/.test(leggi("src/lib/google-tag.ts")));
  atteso("solo «accepted» vale «granted»: in attesa e rifiuto sono «denied»", consensoGoogleDaBanner("accepted") === "granted" && consensoGoogleDaBanner("pending") === "denied" && consensoGoogleDaBanner("rejected") === "denied");

  const nuova = apriPagina(null);
  const e0 = elabora(nuova.coda());
  atteso("NUOVO VISITATORE: ordine dei comandi = consenso di default → riduzione dati Ads → js → config Analytics → config Ads; nessun «update»", JSON.stringify(e0.ordine) === JSON.stringify(["consent:default", "set:ads_data_redaction", "js", `config:${ID_GA4_OMNIA_AI}`, `config:${ID_ADS_OMNIA_AI}`]), JSON.stringify(e0.ordine));
  atteso("NUOVO VISITATORE: i quattro consensi sono «denied» PRIMA di ogni configurazione, e ENTRAMBE le destinazioni parlano con tutti e quattro «denied»", e0.config.length === 2 && e0.config.every((c) => tuttiA(c.consenso, "denied")) && tuttiA(e0.consensoFinale, "denied"));
  atteso("NUOVO VISITATORE: Google non ha ricevuto nessun valore «granted» e lo stato ricordato è «denied»", !JSON.stringify(nuova.coda()).includes("granted") && nuova.sandbox[VARIABILE_STATO_CONSENSO_GOOGLE] === "denied");
  const primo = nuova.coda()[0];
  atteso("il PRIMO comando in assoluto è il consenso di default (prima di qualsiasi altra cosa), con i quattro segnali", primo[0] === "consent" && primo[1] === "default" && tuttiA(primo[2] as Record<string, string>, "denied"));
  atteso("«ads_data_redaction» è attivo (con consenso negato gli identificativi di clic vengono oscurati nelle richieste di Google Ads); «url_passthrough» NON si usa", e0.ordine.includes("set:ads_data_redaction") && nuova.coda().some((c) => c[0] === "set" && c[1] === "ads_data_redaction" && c[2] === true) && !snippet.includes("url_passthrough"));

  const accettato = apriPagina("accepted");
  const e1 = elabora(accettato.coda());
  atteso("CONSENSO GIÀ PRESENTE (accettato in passato): default «denied» → subito «granted» → poi le due configurazioni, tutte con ad_storage, analytics_storage e ad_user_data «granted» (ad_personalization resta «denied»)", JSON.stringify(e1.ordine) === JSON.stringify(["consent:default", "consent:update", "set:ads_data_redaction", "js", `config:${ID_GA4_OMNIA_AI}`, `config:${ID_ADS_OMNIA_AI}`]) && e1.config.every((c) => concessi(c.consenso)), JSON.stringify(e1));
  atteso("… e il PRIMO comando resta il default «denied» (anche chi ha già accettato parte da «denied» e passa a «granted» prima di ogni config)", accettato.coda()[0][1] === "default" && tuttiA(accettato.coda()[0][2] as Record<string, string>, "denied") && accettato.sandbox[VARIABILE_STATO_CONSENSO_GOOGLE] === "granted");
  const rifiutato = apriPagina("rejected");
  const e2 = elabora(rifiutato.coda());
  atteso("RIFIUTO già presente: come il nuovo visitatore, mai «granted»", JSON.stringify(e2.ordine) === JSON.stringify(e0.ordine) && e2.config.every((c) => tuttiA(c.consenso, "denied")) && !JSON.stringify(rifiutato.coda()).includes("granted"));
  const strani = ["ACCEPTED", "granted", "true", "1", "yes", " accepted", "accepted ", "pending", "rejected", ""].map((v) => elabora(apriPagina(v).coda()));
  atteso("valori salvati strani o sporchi (maiuscole, spazi, «granted», «true»…): contano come NON accettati, mai «granted»", strani.every((e) => !e.ordine.includes("consent:update") && e.config.every((c) => tuttiA(c.consenso, "denied"))));
  let bloccato: Elaborato | null = null;
  let errore: unknown = null;
  try {
    bloccato = elabora(apriPagina("bloccato").coda());
  } catch (e) {
    errore = e;
  }
  atteso("localStorage BLOCCATO (modalità privata, blocco del browser): nessun errore, consenso «denied», tag configurato comunque", errore === null && !!bloccato && bloccato.config.length === 2 && bloccato.config.every((c) => tuttiA(c.consenso, "denied")));

  const periodo = (snippet.match(/gtag\('config'/g) ?? []).length;
  atteso("nel testo dello snippet: due «config» (Analytics e Ads), un solo «js», il default PRIMA del primo «config»", periodo === 2 && (snippet.match(/gtag\('js'/g) ?? []).length === 1 && snippet.indexOf("gtag('consent','default'") >= 0 && snippet.indexOf("gtag('consent','default'") < snippet.indexOf("gtag('config'"));
  atteso("nessun evento e NESSUNA conversione Ads nello snippet (niente «event», «conversion», «send_to», etichette di conversione)", !/gtag\('event'|conversion|send_to|AW-18422155730\//.test(snippet) && !nuova.coda().some((c) => c[0] === "event"));
  atteso("lo snippet non legge cookie, indirizzo della pagina o parametri (gclid): nessun dato personale o identificativo, solo il consenso salvato", !/document\.cookie|location|search|gclid|referrer|navigator|fetch|XMLHttpRequest|sendBeacon/.test(snippet));
  atteso("lo snippet è ES5 (gira anche su browser vecchi): niente funzioni a freccia, let/const, template literal", !/=>|\blet\b|\bconst\b|`/.test(snippet));
  atteso("lo snippet è sempre lo stesso (deterministico: nessuna data o numero casuale scritto nell'HTML)", costruisciSnippetIniziale() === snippet && !/\d{10,}/.test(snippet.replace(ID_ADS_OMNIA_AI, "")) && !/Date\.now|Math\.random/.test(snippet));

  // ═════════════════════════ 2. Banner: consenso, rifiuto, revoca, navigazione ═════════════════════════
  console.log("\n--- Banner: accettazione, rifiuto, revoca, navigazione tra le pagine ---");
  {
    const p = apriPagina(null);
    const prima = p.coda().length;
    p.archivio.set(CHIAVE_CONSENSO_COOKIE, "accepted"); // come setConsent("accepted")
    const esito = aggiornaConsensoGoogle("accepted", fin(p));
    const dopo = p.coda();
    atteso("ACCETTAZIONE: un solo «consent update» (tre segnali «granted», ad_personalization «denied»), dopo la configurazione iniziale", esito === "concesso" && dopo.length === prima + 1 && dopo[dopo.length - 1][0] === "consent" && dopo[dopo.length - 1][1] === "update" && concessi(dopo[dopo.length - 1][2] as Record<string, string>) && elabora(dopo).consensoFinale !== null && concessi(elabora(dopo).consensoFinale));
    atteso("… ripetere la stessa scelta (doppio clic, effetto del banner) NON produce comandi doppi", aggiornaConsensoGoogle("accepted", fin(p)) === "invariato" && p.coda().length === prima + 1);
  }
  {
    const p = apriPagina(null);
    const prima = p.coda().length;
    const r1 = aggiornaConsensoGoogle("rejected", fin(p));
    const r2 = aggiornaConsensoGoogle("pending", fin(p));
    atteso("RIFIUTO (o banner ignorato): nessun comando a Google, i consensi restano «denied» da prima", r1 === "invariato" && r2 === "invariato" && p.coda().length === prima && tuttiA(elabora(p.coda()).consensoFinale, "denied"));
  }
  {
    const p = apriPagina("accepted");
    const prima = p.coda().length;
    const alCaricamento = aggiornaConsensoGoogle("accepted", fin(p));
    atteso("CARICAMENTO con consenso già dato: il banner (effetto dopo l'idratazione) non manda nessun comando in più", alCaricamento === "invariato" && p.coda().length === prima);
    const sbagliato = apriPagina("accepted");
    const esitoSbagliato = aggiornaConsensoGoogle("pending", fin(sbagliato));
    atteso("(controllo del controllo) trattare lo stato dell'idratazione («pending») come una revoca revocherebbe il consenso di chi ha già accettato: per questo il banner legge la scelta VERA dal browser, non lo stato", esitoSbagliato === "revocato");
  }
  {
    const barattolo = nuovoBarattolo([
      { nome: "_ga", dominio: "omnia-ai.it" },
      { nome: "_ga_W551SWPNE4", dominio: "omnia-ai.it" },
      { nome: "_gid", dominio: "omnia-ai.it" },
      { nome: "_gcl_aw", dominio: null },
      { nome: "_gcl_au", dominio: "omnia-ai.it" },
      { nome: "__gads", dominio: "omnia-ai.it" },
      { nome: "sb-xyz-auth-token", dominio: null },
      { nome: "omnia-zone", dominio: null },
      { nome: "altro", dominio: "omnia-ai.it" },
    ]);
    const p = apriPagina("accepted");
    const prima = p.coda().length;
    const esito = aggiornaConsensoGoogle("pending", fin(p)); // «Preferenze cookie» → la scelta si cancella → banner di nuovo in attesa
    const cancellati = esito === "revocato" ? cancellaCookieGoogle(barattolo.documento, "omnia-ai.it") : [];
    const dopo = p.coda();
    atteso("REVOCA («Preferenze cookie»): un «consent update» con i quattro segnali «denied», subito", esito === "revocato" && dopo.length === prima + 1 && dopo[dopo.length - 1][1] === "update" && tuttiA(dopo[dopo.length - 1][2] as Record<string, string>, "denied") && tuttiA(elabora(dopo).consensoFinale, "denied"));
    atteso("… e vengono tolti SOLO i cookie di Google (_ga, _ga_…, _gid, _gcl_*, __gads), anche su domini diversi; la sessione di accesso e gli altri cookie restano", cancellati.sort().join() === ["__gads", "_ga", "_ga_W551SWPNE4", "_gcl_au", "_gcl_aw", "_gid"].sort().join() && barattolo.cookie.map((c) => c.nome).sort().join() === ["altro", "omnia-zone", "sb-xyz-auth-token"].sort().join(), JSON.stringify(barattolo.cookie));
    // poi cambia idea di nuovo: accetta
    const di_nuovo = aggiornaConsensoGoogle("accepted", fin(p));
    const fine = aggiornaConsensoGoogle("rejected", fin(p));
    atteso("dopo la revoca si può accettare di nuovo e poi rifiutare: i comandi seguono le scelte (granted, poi denied), senza doppioni", di_nuovo === "concesso" && fine === "revocato" && p.coda().length === prima + 3 && tuttiA(elabora(p.coda()).consensoFinale, "denied"));
    const senzaCookie = nuovoBarattolo([{ nome: "sb-xyz-auth-token", dominio: null }]);
    atteso("revoca senza cookie di Google presenti: non cancella nulla (e non rompe)", cancellaCookieGoogle(senzaCookie.documento, "omnia-ai.it").length === 0 && senzaCookie.cookie.length === 1);
  }
  {
    // navigazione tra le pagine
    const p = apriPagina("accepted");
    const prima = p.coda().length;
    const ripetuti = [1, 2, 3].map(() => aggiornaConsensoGoogle("accepted", fin(p)));
    atteso("NAVIGAZIONE tra pagine senza ricaricare il documento (il banner resta montato): nessun comando nuovo, il consenso resta concesso", ripetuti.every((r) => r === "invariato") && p.coda().length === prima && concessi(elabora(p.coda()).consensoFinale));
    const archivio = new Map<string, string>();
    const pagina1 = apriPagina(null, archivio);
    archivio.set(CHIAVE_CONSENSO_COOKIE, "accepted"); // «Accetta» sulla pagina 1
    aggiornaConsensoGoogle("accepted", fin(pagina1));
    const pagina2 = apriPagina(null, archivio); // seconda pagina con caricamento completo: il consenso è nel browser
    atteso("CARICAMENTO COMPLETO di una seconda pagina dopo «Accetta»: parte da «denied», passa a «granted» prima delle configurazioni (il consenso persiste tra le pagine)", JSON.stringify(elabora(pagina2.coda()).ordine) === JSON.stringify(e1.ordine) && elabora(pagina2.coda()).config.every((c) => concessi(c.consenso)));
    archivio.delete(CHIAVE_CONSENSO_COOKIE); // revoca sulla pagina 2
    aggiornaConsensoGoogle("pending", fin(pagina2));
    const pagina3 = apriPagina(null, archivio);
    atteso("CARICAMENTO COMPLETO di una terza pagina dopo la revoca: di nuovo tutto «denied», nessun «granted»", elabora(pagina3.coda()).config.every((c) => tuttiA(c.consenso, "denied")) && !JSON.stringify(pagina3.coda()).includes("granted"));
    archivio.set(CHIAVE_CONSENSO_COOKIE, "rejected");
    atteso("… e dopo un rifiuto esplicito idem", elabora(apriPagina(null, archivio).coda()).config.every((c) => tuttiA(c.consenso, "denied")));
    const senzaGtag = aggiornaConsensoGoogle("accepted", { [VARIABILE_STATO_CONSENSO_GOOGLE]: "denied" });
    atteso("se il tag non è presente (bloccato da un'estensione, script non caricato) il banner non va in errore e non finge di aver comunicato il consenso", senzaGtag === "invariato");
  }
  {
    const barattolo = (host: string) => dominiPossibili(host);
    atteso("domini su cui togliere i cookie: l'host e ogni dominio superiore con almeno due etichette (mai «.it»)", JSON.stringify(barattolo("omnia-ai.it")) === JSON.stringify([null, "omnia-ai.it"]) && JSON.stringify(barattolo("www.omnia-ai.it")) === JSON.stringify([null, "www.omnia-ai.it", "omnia-ai.it"]) && JSON.stringify(barattolo("localhost")) === JSON.stringify([null]) && !barattolo("a.b.omnia-ai.it").includes("it"));
    atteso("riconoscimento dei cookie di Google: quelli dei tag sì, quelli del sito (accesso, zona) no", ["_ga", "_ga_W551SWPNE4", "_gid", "_gat", "_gat_gtag_G_W551SWPNE4", "_gcl_au", "_gcl_aw", "_gcl_dc", "_gcl_gb", "_gac_UA-123", "__gads", "__gpi", "FPAU", "FPLC"].every(eCookieGoogle) && ["sb-abc-auth-token", "omnia-zone", "omnia_zone", "_ga_", "my_ga", "gclid", "_gaX", "session", "_gclx"].every((n) => !eCookieGoogle(n)));
  }

  // ═════════════════════════ 3. Il banner, com'è e dove si monta ═════════════════════════
  console.log("\n--- Banner esistente: testo, chiavi, nessun caricamento di script ---");
  {
    const banner = leggi("src/components/omnia-ai/cookie-consent.tsx");
    const html = renderToStaticMarkup(createElement(OmniaAiCookieConsent));
    atteso("il banner mostra lo stesso testo di prima con «Rifiuta» e «Accetta» (nessuna dichiarazione cambiata in questo rilascio: vedi la guida, sezione sulle proposte di testo)", html.includes("Usiamo un cookie tecnico-pubblicitario solo se acconsenti, per capire quali annunci portano contatti utili. Nessun dato viene venduto a terzi.") && html.includes("Rifiuta") && html.includes("Accetta"));
    atteso("il banner NON carica più nessuno script e non nomina i due ID (sta tutto nel modulo del Google tag): niente next/script, niente googletagmanager, niente ID letterali", !/next\/script|<Script|googletagmanager|G-W551SWPNE4|AW-18422155730/.test(banner) && !html.includes("<script") && !html.includes("googletagmanager"));
    atteso("chiave e nome dell'evento del consenso sono quelli di prima (stessi di attribuzione, modulo DEMO e registro dei consensi)", /const CONSENT_KEY = "omnia-ai-cookie-consent";/.test(banner) && /const CONSENT_EVENT = "omnia-ai-consent-change";/.test(banner) && CHIAVE_CONSENSO_COOKIE === "omnia-ai-cookie-consent" && /export function resetOmniaAiCookieConsent\(\)/.test(banner));
    atteso("il banner comunica la scelta a Google alla scelta, alla revoca e quando cambia da fuori; nell'effetto legge la scelta VERA dal browser (getSnapshot), non lo stato dell'idratazione", /function setConsent[\s\S]*?sincronizzaConsensoGoogle\(value\);/.test(banner) && /export function resetOmniaAiCookieConsent[\s\S]*?sincronizzaConsensoGoogle\("pending"\);/.test(banner) && /useEffect\(\(\) => \{\s*sincronizzaConsensoGoogle\(getSnapshot\(\)\);\s*\}, \[status\]\);/.test(banner) && /esito === "revocato"\) cancellaCookieGoogle/.test(banner));
    atteso("il banner compare solo in attesa di scelta (come prima) e lo stato iniziale del server è sempre «in attesa»", /\{status === "pending" && \(/.test(banner) && /function getServerSnapshot\(\): Consent \{\s*return "pending";/.test(banner));

    const layout = leggi("src/app/site-omnia-ai/layout.tsx");
    const codiceLayout = senzaCommenti(layout);
    const posHead = codiceLayout.indexOf("<head>");
    const posInit = codiceLayout.indexOf("<script dangerouslySetInnerHTML={{ __html: costruisciSnippetIniziale() }} />");
    const posLib = codiceLayout.indexOf("<script defer src={URL_GTAG_JS} />");
    const posFineHead = codiceLayout.indexOf("</head>");
    atteso("il layout della zona omnia-ai mette il Google tag nell'HTML iniziale come VERI tag <script> dell'<head>: prima lo snippet inline, poi la libreria con «defer» (il browser la esegue dopo lo snippet, sempre), UNA sola volta src=URL_GTAG_JS, tutto prima di <body>", posHead > 0 && posInit > posHead && posLib > posInit && posFineHead > posLib && codiceLayout.indexOf("<body>") > posFineHead && (codiceLayout.match(/src=\{URL_GTAG_JS\}/g) ?? []).length === 1 && (codiceLayout.match(/<script\b/g) ?? []).length === 2);
    atteso("niente next/script e niente «async» sulla libreria (Next metterebbe lo snippet in una coda interna e React sposterebbe uno script «async» prima dello snippet): l'ordine dell'HTML è quello garantito", !/next\/script|<Script|beforeInteractive|afterInteractive/.test(codiceLayout) && !/<script[^>]*\basync\b/.test(codiceLayout));
    atteso("il layout resta un root layout con il proprio <html> e NON contiene ID o indirizzi di Google scritti a mano", /<html lang="it">/.test(codiceLayout) && !/G-W551SWPNE4|AW-18422155730|googletagmanager|gtag\(/.test(codiceLayout));
  }

  // ═════════════════════════ 4. Un solo punto, nessun doppione, nessuna conversione ═════════════════════════
  console.log("\n--- Nessun doppione e nessuna conversione Ads ---");
  {
    const zonaOmniaAi = [...elenca("src/app/site-omnia-ai"), ...elenca("src/components/omnia-ai")];
    const conGtag = zonaOmniaAi.filter((f) => /googletagmanager\.com\/gtag|gtag\(['"]config['"]|gtag\(['"]js['"]/.test(leggi(f)));
    atteso("nella zona omnia-ai.it nessun file carica gtag.js o configura destinazioni (nessun secondo tag, nessun GA4 duplicato): l'unica fonte è src/lib/google-tag.ts", conGtag.length === 0, conGtag.join(", "));
    const conId = zonaOmniaAi.filter((f) => /G-W551SWPNE4|AW-18422155730/.test(leggi(f)));
    atteso("nella zona omnia-ai.it nessun file scrive a mano gli ID di Google (solo il modulo)", conId.length === 0, conId.join(", "));
    const tutti = elenca("src");
    const conUrl = tutti.filter((f) => /googletagmanager\.com\/gtag\/js/.test(leggi(f)));
    atteso("in tutto il codice gtag.js si carica da: modulo omnia-ai (una volta), banner e-commerce (altra zona, invariato)", JSON.stringify(conUrl.sort()) === JSON.stringify(["src/components/cookie-consent.tsx", "src/lib/google-tag.ts"]), conUrl.join(", "));
    const modulo = leggi("src/lib/google-tag.ts");
    atteso("il modulo del Google tag non genera NESSUN evento di conversione Ads (niente gtag('event'…), niente send_to, niente etichette): le DEMO confermate vanno ad Ads solo dalla Data Manager API", !/gtag\(\s*['"]event['"]|send_to|conversion\b|AW-18422155730\/[A-Za-z0-9_-]+/.test(senzaCommenti(modulo)) && !/gtag\(\s*['"]event['"]|send_to/.test(senzaCommenti(leggi("src/app/site-omnia-ai/layout.tsx"))));
    const importatori = tutti.filter((f) => /from "@\/lib\/google-tag"/.test(leggi(f))).sort();
    atteso("il modulo del Google tag è usato SOLO dal layout e dal banner di omnia-ai.it: nessun server, cron, database, Calendar, Data Manager, Supabase o Stripe lo importa", JSON.stringify(importatori) === JSON.stringify(["src/app/site-omnia-ai/layout.tsx", "src/components/omnia-ai/cookie-consent.tsx"]), importatori.join(", "));
    atteso("il modulo è utilizzabile nel browser: nessuna crittografia, nessun database, nessuna rete, nessuna variabile d'ambiente", !/^import .*(node:|crypto|supabase)/m.test(modulo) && !/process\.env|fetch\(/.test(modulo));
    const ecommerce = leggi("src/components/cookie-consent.tsx");
    atteso("l'e-commerce NON è toccato: il suo banner carica ancora i tag solo dopo «Accetta» e non usa il Consent Mode di questo rilascio", /\{status === "accepted" && \(/.test(ecommerce) && !/google-tag|consent', *'default|consent","default|ads_data_redaction/.test(ecommerce) && !/google-tag/.test(leggi("src/app/(ecommerce)/layout.tsx")));
    atteso("la console non carica nessun tag di Google", elenca("src/app/site-console").every((f) => !/googletagmanager|gtag\(|google-tag/.test(leggi(f))));
  }

  // ═════════════════════════ 5. Eventi DEMO, GCLID e registro dei consensi ═════════════════════════
  console.log("\n--- Eventi DEMO subordinati al consenso; GCLID e consensi invariati ---");
  {
    const form = leggi("src/components/omnia-ai/demo-form.tsx");
    const corpo = /function inviaEventoGa\([^)]*\) \{([\s\S]*?)\n\}/.exec(form)?.[1] ?? "";
    atteso("gli eventi del modulo DEMO partono SOLO con i cookie accettati: il controllo del consenso (stessa chiave del banner) viene PRIMA della chiamata a gtag", /cookiePubblicitariAccettati\(localStorage\.getItem\(CHIAVE_CONSENSO_COOKIE\)\)\) return;/.test(corpo) && corpo.indexOf("cookiePubblicitariAccettati") < corpo.indexOf('gtag("event"') && /typeof gtag === "function"/.test(corpo));
    atteso("il modulo non carica né configura niente di Google (solo due eventi esistenti, subordinati al consenso) e non crea conversioni", !/googletagmanager|gtag\('config'|gtag\("config"|dataLayer|send_to|conversion/.test(senzaCommenti(form)) && (form.match(/inviaEventoGa\(/g) ?? []).length === 3);
    // simulazione: con il tag SEMPRE presente, senza consenso nessun evento; con consenso sì
    const eventi = (consenso: string | null) => {
      const registrati: unknown[][] = [];
      const archivio = new Map<string, string>();
      if (consenso !== null) archivio.set(CHIAVE_CONSENSO_COOKIE, consenso);
      const inviaEventoGa = (nome: string) => {
        if (!cookiePubblicitariAccettati(archivio.get(CHIAVE_CONSENSO_COOKIE) ?? null)) return;
        registrati.push(["event", nome]);
      };
      inviaEventoGa("demo_booking_start");
      inviaEventoGa("demo_lead_submitted");
      return registrati.length;
    };
    atteso("(modello) senza scelta, con rifiuto o con valori sporchi: zero eventi; con «accepted»: due", eventi(null) === 0 && eventi("rejected") === 0 && eventi("granted") === 0 && eventi("ACCEPTED") === 0 && eventi("accepted") === 2);

    const attribuzione = leggi("src/components/omnia-ai/attribuzione-demo.tsx");
    atteso("la raccolta del GCLID non è cambiata: solo con i cookie accettati, si aggiorna al cambio di consenso (stesso evento del banner) e non usa il Google tag", /cookiePubblicitariAccettati\(localStorage\.getItem\(CHIAVE_CONSENSO_COOKIE\)\)/.test(attribuzione) && /EVENTO_CAMBIO_CONSENSO = "omnia-ai-consent-change"/.test(attribuzione) && !/google-tag|gtag|dataLayer/.test(attribuzione));
    atteso("la chiave del consenso è UNA sola per banner, GCLID, modulo e snippet (un test sul registro dei consensi la confronta con quella del banner)", leggi("src/lib/demo-lead-calcoli.ts").includes('CHIAVE_CONSENSO_COOKIE = "omnia-ai-cookie-consent"') && modulloUsaChiave());
    const consensiCalcoli = leggi("src/lib/demo-consensi-calcoli.ts");
    atteso("registro dei consensi coerente con il banner: versione e testo registrati sono quelli che il banner mostra (nessuna dichiarazione cambiata, versione «banner-2026-09»)", /VERSIONE_BANNER_COOKIE = "banner-2026-09"/.test(consensiCalcoli) && consensiCalcoli.includes("Usiamo un cookie tecnico-pubblicitario solo se acconsenti, per capire quali annunci portano contatti utili. Nessun dato viene venduto a terzi.") && leggi("src/components/omnia-ai/cookie-consent.tsx").replace(/\s+/g, " ").includes("Usiamo un cookie tecnico-pubblicitario solo se acconsenti, per capire quali annunci portano contatti utili. Nessun dato viene venduto a terzi."));
    const intoccati = ["src/lib/demo-ads-data-manager.ts", "src/lib/demo-calendario-sync.ts", "src/lib/demo-ga4.ts", "src/lib/demo-ga4-prova.ts", "src/lib/demo-ciclo.ts", "src/app/api/webhooks/stripe/route.ts", "src/app/actions/omnia-ai-demo.ts"];
    atteso("i moduli di Data Manager API, Calendar, GA4 lato server, cron, Stripe e l'azione del modulo non nominano il Google tag del browser", intoccati.every((f) => !/google-tag|costruisciSnippetIniziale|aggiornaConsensoGoogle/.test(leggi(f))));
    atteso("le modalità prudenti restano nel codice: validateOnly di Google Ads predefinito e debug di GA4 (nessuna variabile cambiata da questo rilascio)", /DEMO_ADS_VALIDATE_ONLY/.test(leggi("src/lib/demo-ads-data-manager.ts")) && /DEMO_GA4_MP_DEBUG/.test(leggi("src/lib/demo-ga4.ts")));
  }

  // ═════════════════════════ 6. Guida, bozze di testo, catena ═════════════════════════
  console.log("\n--- Guida, proposte di testo, catena dei test ---");
  {
    const guida = leggi("GUIDA-GOOGLE-TAG-CONSENT-MODE.md");
    atteso("la guida esiste e documenta: diagnosi, come funziona, cosa viene trasmesso prima del consenso, rischi di conformità, come verificare con Tag Assistant e in Google Ads, rilascio e ritorno indietro", guida.length > 4000 && /Diagnosi/.test(guida) && /prima del consenso/i.test(guida) && /## 5\. Rischi di conformit/.test(guida) && /### 6\.2 Tag Assistant/.test(guida) && /scheda \*\*Consent\*\*/.test(guida) && /### 6\.3 Se Google Ads riconosce il tag/.test(guida) && /## 8\. Come tornare indietro/.test(guida) && /MANDA ONLINE/.test(guida));
    atteso("la guida dichiara i limiti: la modalità avanzata invia ping senza cookie prima del consenso; la cookie policy v1 e il banner attuali diventerebbero inesatti e vanno aggiornati prima del rilascio; Google Ads può impiegare tempo a riconoscere il tag", /cookie policy v1|Cookie policy v1/.test(guida) && /Nessun dato viene inviato a Google|nessun dato viene inviato a Google/.test(guida) && /ping senza cookie/.test(guida) && /24/.test(guida));
    const bozzaPolicy = fs.existsSync(path.join(radice, "legal/cookie-policy-omnia-ai-v2-BOZZA.md")) ? leggi("legal/cookie-policy-omnia-ai-v2-BOZZA.md") : "";
    const bozzaBanner = fs.existsSync(path.join(radice, "legal/banner-cookie-omnia-ai-BOZZA.md")) ? leggi("legal/banner-cookie-omnia-ai-BOZZA.md") : "";
    atteso("le proposte di testo (cookie policy v2 e banner) esistono, sono marcate come BOZZA da rivedere e descrivono il comportamento reale: Consent Mode, prima del consenso, rifiuto, revoca, Analytics e Google Ads", /^# BOZZA — Cookie policy/.test(bozzaPolicy) && /NON è in vigore e NON è collegata al codice/.test(bozzaPolicy) && /da sottoporre a revisione/i.test(bozzaPolicy) && /Consent Mode|consenso negato/i.test(bozzaPolicy) && /Google Analytics/.test(bozzaPolicy) && /Google Ads/.test(bozzaPolicy) && /^# BOZZA — Testo del banner/.test(bozzaBanner) && /NON è in vigore e NON è collegata al codice/.test(bozzaBanner) && /Accetta/.test(bozzaBanner) && /Rifiuta/.test(bozzaBanner));
    const sorgenti = elenca("src").map((f) => leggi(f)).join("\n");
    atteso("le bozze NON sono collegate al codice: il testo del banner e la cookie policy v1 pubblicata non sono stati modificati (la v1 non si modifica mai: la revisione sarà una v2 con la sua voce in legal_documents)", !/banner-cookie-omnia-ai-BOZZA|cookie-policy-omnia-ai-v2-BOZZA/.test(senzaCommenti(sorgenti)) && !/from "[^"]*\.md"/.test(sorgenti) && leggi("src/components/omnia-ai/legal/cookie-policy-v1.tsx").includes("Il tag pubblicitario non viene caricato finché non premi") );
    atteso("il test è nella catena verifica:livello1", /tsx scripts\/verifica-google-tag-omnia-ai\.ts/.test(leggi("package.json")));
  }

  if (fallimenti.length > 0) {
    console.log(`\n${fallimenti.length} controlli falliti:\n- ${fallimenti.join("\n- ")}`);
    process.exit(1);
  }
  completato = true;
  console.log("\nTutti i controlli sono andati a buon fine.");
}

// la chiave nel banner, nello snippet e nel GCLID è la stessa
function modulloUsaChiave(): boolean {
  return leggi("src/lib/google-tag.ts").includes('import { CHIAVE_CONSENSO_COOKIE } from "@/lib/demo-lead-calcoli";') && leggi("src/components/omnia-ai/attribuzione-demo.tsx").includes("CHIAVE_CONSENSO_COOKIE");
}

// Una promessa rimasta appesa farebbe uscire Node con codice 0 senza dire niente: qui diventa un fallimento.
let completato = false;
process.on("exit", () => {
  if (!completato && process.exitCode === undefined) {
    console.log("FALLITO il test non è arrivato in fondo");
    process.exitCode = 1;
  }
});

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
