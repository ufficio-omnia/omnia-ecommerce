// Autotest del Google tag di omnia-ai.it con Consent Mode v2 AVANZATO e dati ridotti al minimo prima del consenso (richieste dell'utente,
// 05/11/2026): un solo gtag.js nell'HTML iniziale con le destinazioni Analytics (G-W551SWPNE4) e Google Ads (AW-18422155730), i quattro
// consensi «denied» PRIMA di ogni configurazione, Analytics SPENTO e un solo segnale ridotto verso Ads prima del consenso, banner esistente
// con testo e versione nuovi, consenso/rifiuto/revoca gestiti, eventi DEMO subordinati al consenso.
//
// Nessuna rete, nessun browser, nessun Google: lo snippet che il server mette nell'HTML viene ESEGUITO in un contesto isolato (node:vm) con
// un localStorage, un indirizzo e un referrer finti. Una «Google finta» legge la coda dei comandi come Google la elabora e dice quali ping
// partirebbero: il suo comportamento è un MODELLO ricavato dalle prove nel browser vero del 05/11/2026 (vedi GUIDA-GOOGLE-TAG-CONSENT-MODE.md,
// sezione 4), non Google stessa. Il controllo sull'HTML vero (build + server) è in scripts/controlla-html-google-tag.ts.
import fs from "fs";
import path from "path";
import vm from "node:vm";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  CHIAVE_VERSIONE_CONSENSO,
  ID_ADS_OMNIA_AI,
  ID_GA4_OMNIA_AI,
  INTERRUTTORE_GA4,
  PERCORSI_CON_SEGNALE_PRIMA_DEL_CONSENSO,
  PERSONALIZZAZIONE_DOPO_ACCETTA,
  SEGNALI_CONSENSO_GOOGLE,
  URL_GTAG_JS,
  VARIABILE_PAGINA_VISTA_GA4,
  VARIABILE_STATO_CONSENSO_GOOGLE,
  VARIABILE_STATO_TAG_GOOGLE,
  aggiornaConsensoGoogle,
  cancellaCookieGoogle,
  consensoGoogleDaBanner,
  costruisciSnippetIniziale,
  dominiPossibili,
  eCookieGoogle,
  indirizzoRidotto,
  percorsoAmmessoPrimaDelConsenso,
  valoriConsensoGoogle,
  type FinestraGoogle,
} from "../src/lib/google-tag";
import { CHIAVE_CONSENSO_COOKIE, cookiePubblicitariAccettati } from "../src/lib/demo-lead-calcoli";
import { TESTO_BANNER_COOKIE, VERSIONE_BANNER_COOKIE } from "../src/lib/demo-consensi-calcoli";
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

const ORIGINE = "https://omnia-ai.it";
const CHIAVE_ATTRIBUZIONE_FITTIZIA = "gclid=TESTGCLID123&utm_source=google&utm_campaign=prova&email=mario.rossi%40example.com&id=9f1c";
type Comando = unknown[];
type Pagina = { sandbox: Record<string, unknown> & { gtag?: (...a: unknown[]) => void }; coda: () => Comando[]; archivio: Map<string, string>; href: string; referrer: string };

type OpzioniPagina = { scelta?: string | null; versione?: string | null | "bloccato"; percorso?: string; query?: string; referrer?: string; archivio?: Map<string, string> };
// scelta: valore salvato dal banner (null = nessuno); versione: versione del testo salvata (predefinita: quella attuale)
function apriPagina(o: OpzioniPagina = {}): Pagina {
  const archivio = o.archivio ?? new Map<string, string>();
  const bloccato = o.versione === "bloccato";
  if (!bloccato && o.scelta !== undefined && o.scelta !== null) {
    archivio.set(CHIAVE_CONSENSO_COOKIE, o.scelta);
    if (o.versione !== null) archivio.set(CHIAVE_VERSIONE_CONSENSO, o.versione ?? VERSIONE_BANNER_COOKIE);
  }
  const localStorage = bloccato
    ? {
        getItem: () => {
          throw new Error("localStorage bloccato");
        },
      }
    : { getItem: (k: string) => archivio.get(k) ?? null, setItem: (k: string, v: string) => void archivio.set(k, v), removeItem: (k: string) => void archivio.delete(k) };
  const percorso = o.percorso ?? "/demo";
  const href = `${ORIGINE}${percorso}${o.query ?? `?${CHIAVE_ATTRIBUZIONE_FITTIZIA}`}#sezione`;
  const referrer = o.referrer ?? `${ORIGINE}/piani?utente=a%40b.it`;
  const sandbox: Pagina["sandbox"] = { localStorage, location: { href, pathname: percorso }, document: { referrer } };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(costruisciSnippetIniziale(), sandbox);
  return { sandbox, coda: () => ((sandbox.dataLayer as unknown[]) ?? []).map((a) => Array.from(a as ArrayLike<unknown>)), archivio, href, referrer };
}
const fin = (p: Pagina) => p.sandbox as unknown as FinestraGoogle;

type Elaborato = {
  ordine: string[];
  config: { id: string; consenso: Record<string, string> | null; opzioni: Record<string, unknown> | null; indirizzo: string; referrer: string }[];
  consensoFinale: Record<string, string> | null;
  ultimoIndirizzo: string | null;
};
// Come Google legge la coda: lo stato del consenso cambia con «consent default/update»; «set» imposta indirizzo e referrer per i comandi dopo.
function elabora(coda: Comando[], p: Pagina): Elaborato {
  let stato: Record<string, string> | null = null;
  let indirizzo = p.href;
  let referrer = p.referrer;
  const ordine: string[] = [];
  const config: Elaborato["config"] = [];
  for (const [cmd, a, b] of coda) {
    if (cmd === "consent") {
      ordine.push(`consent:${String(a)}`);
      stato = a === "default" ? { ...(b as Record<string, string>) } : { ...(stato ?? {}), ...(b as Record<string, string>) };
    } else if (cmd === "set") {
      if (typeof a === "object" && a !== null) {
        const o = a as Record<string, string>;
        if (o.page_location !== undefined) indirizzo = o.page_location;
        if (o.page_referrer !== undefined) referrer = o.page_referrer;
        ordine.push("set:indirizzo");
      } else ordine.push(`set:${String(a)}`);
    } else if (cmd === "config") {
      ordine.push(`config:${String(a)}`);
      config.push({ id: String(a), consenso: stato ? { ...stato } : null, opzioni: (b as Record<string, unknown>) ?? null, indirizzo, referrer });
    } else if (cmd === "event") ordine.push(`event:${String(a)}`);
    else ordine.push(`${String(cmd)}`);
  }
  return { ordine, config, consensoFinale: stato, ultimoIndirizzo: indirizzo };
}
const tuttiA = (s: Record<string, string> | null, valore: string) => !!s && SEGNALI_CONSENSO_GOOGLE.every((k) => s[k] === valore) && Object.keys(s).length === SEGNALI_CONSENSO_GOOGLE.length;
const concessi = (s: Record<string, string> | null) => !!s && s.ad_storage === "granted" && s.analytics_storage === "granted" && s.ad_user_data === "granted" && s.ad_personalization === "denied" && Object.keys(s).length === 4;

// MODELLO di cosa Google manda, ricavato dalle prove nel browser (05/11/2026): un ping di Google Ads per ogni «config AW» (con l'indirizzo e
// il referrer impostati da «set»); Analytics manda un page_view per «config G-» se page_view non è spento e l'interruttore ga-disable è
// spento, e per ogni «event page_view» con l'interruttore spento. Con l'interruttore acceso Analytics non manda NIENTE.
type Ping = { dove: "analytics" | "ads"; evento: string; indirizzo: string; referrer: string; consenso: string };
function pingPrevisti(coda: Comando[], p: Pagina, interruttoreAcceso: (indice: number) => boolean): Ping[] {
  const uscita: Ping[] = [];
  let stato: Record<string, string> | null = null;
  let indirizzo = p.href;
  let referrer = p.referrer;
  coda.forEach(([cmd, a, b], i) => {
    if (cmd === "consent") stato = a === "default" ? { ...(b as Record<string, string>) } : { ...(stato ?? {}), ...(b as Record<string, string>) };
    else if (cmd === "set" && typeof a === "object" && a !== null) {
      const o = a as Record<string, string>;
      if (o.page_location !== undefined) indirizzo = o.page_location;
      if (o.page_referrer !== undefined) referrer = o.page_referrer;
    } else if (cmd === "config" || (cmd === "event" && a === "page_view")) {
      const consenso = stato && stato.analytics_storage === "granted" ? "G111" : "G100";
      if (cmd === "config" && a === ID_ADS_OMNIA_AI) uscita.push({ dove: "ads", evento: "page_view", indirizzo, referrer, consenso });
      const ga4SenzaPageView = (b as { send_page_view?: boolean } | undefined)?.send_page_view === false;
      if ((cmd === "config" && a === ID_GA4_OMNIA_AI && !ga4SenzaPageView) || (cmd === "event" && a === "page_view")) {
        if (!interruttoreAcceso(i)) uscita.push({ dove: "analytics", evento: "page_view", indirizzo, referrer, consenso });
      }
    }
  });
  return uscita;
}

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
        if (!parti.some((p) => /^max-age=0$/i.test(p))) return;
        for (let i = cookie.length - 1; i >= 0; i--) if (cookie[i].nome === nome && norm(cookie[i].dominio) === norm(dominio)) cookie.splice(i, 1);
      },
    },
  };
}

const PAGINE_PUBBLICHE = ["/", "/come-funziona", "/piani", "/demo", "/contatti", "/riservatezza"];
const PAGINE_NON_AMMESSE = ["/login", "/registrati", "/abbonati/starter", "/attiva-account", "/imposta-password", "/abbonamento-attivato", "/dashboard/omnia-ai", "/dashboard/omnia-ai/gare/9f1c2d3e-aaaa-bbbb-cccc-1234567890ab", "/dashboard/omnia-ai/pagamenti/fattura/abbonamento/77", "/privacy", "/cookie-policy", "/condizioni-abbonamento", "/documenti-legali/cookie-policy/2", "/api/presenza", "/demo/altro", "/demos", "/piani-extra"];

async function main() {
  const snippet = costruisciSnippetIniziale();

  // ═════════════════════════ 1. Lo snippet nell'HTML iniziale ═════════════════════════
  console.log("--- Snippet iniziale: struttura e costanti ---");
  atteso("gli ID sono quelli richiesti e gtag.js si carica con quello di Analytics (un solo caricamento, la seconda destinazione si aggiunge con «config»)", ID_GA4_OMNIA_AI === "G-W551SWPNE4" && ID_ADS_OMNIA_AI === "AW-18422155730" && URL_GTAG_JS === "https://www.googletagmanager.com/gtag/js?id=G-W551SWPNE4" && !snippet.includes("googletagmanager") && !snippet.includes("gtag/js"));
  atteso("i quattro segnali del Consent Mode v2 sono esattamente questi: ad_storage, analytics_storage, ad_user_data, ad_personalization", JSON.stringify([...SEGNALI_CONSENSO_GOOGLE]) === JSON.stringify(["ad_storage", "analytics_storage", "ad_user_data", "ad_personalization"]));
  atteso("valori: «denied» per tutti e quattro; dopo «Accetta» ad_storage, analytics_storage e ad_user_data «granted» e la PERSONALIZZAZIONE pubblicitaria (ad_personalization) resta «denied»", tuttiA(valoriConsensoGoogle("denied"), "denied") && concessi(valoriConsensoGoogle("granted")) && PERSONALIZZAZIONE_DOPO_ACCETTA === "denied");
  atteso("ad_personalization non è mai «granted» con consenso negato, qualunque sia l'impostazione della personalizzazione dopo «Accetta»", valoriConsensoGoogle("denied").ad_personalization === "denied" && /ad_personalization: stato === "granted" \? PERSONALIZZAZIONE_DOPO_ACCETTA : "denied"/.test(leggi("src/lib/google-tag.ts")));
  atteso("solo «accepted» vale «granted»: in attesa e rifiuto sono «denied»", consensoGoogleDaBanner("accepted") === "granted" && consensoGoogleDaBanner("pending") === "denied" && consensoGoogleDaBanner("rejected") === "denied");
  atteso("l'interruttore di Analytics è quello ufficiale di Google per la proprietà G-W551SWPNE4", INTERRUTTORE_GA4 === "ga-disable-G-W551SWPNE4" && snippet.includes("w['ga-disable-G-W551SWPNE4']=true;"));
  atteso("pagine che mandano il segnale ridotto prima del consenso: ESATTAMENTE Home, Come funziona, Piani, Demo, Contatti, Riservatezza", JSON.stringify([...PERCORSI_CON_SEGNALE_PRIMA_DEL_CONSENSO]) === JSON.stringify(PAGINE_PUBBLICHE) && snippet.includes(JSON.stringify(PAGINE_PUBBLICHE)));
  atteso("percorsi ammessi: i sei esatti (con o senza barra finale); sottopagine, prefissi e varianti NO; area riservata, accesso, registrazione, acquisto e pagine legali NO", PAGINE_PUBBLICHE.every((p) => percorsoAmmessoPrimaDelConsenso(p) && percorsoAmmessoPrimaDelConsenso(p === "/" ? "//" : `${p}/`)) && PAGINE_NON_AMMESSE.every((p) => !percorsoAmmessoPrimaDelConsenso(p)) && !percorsoAmmessoPrimaDelConsenso("/Demo") && !percorsoAmmessoPrimaDelConsenso("/dashboard"));
  atteso("indirizzo ridotto: origine + percorso, senza parametri né frammento (anche con parametri strani, email, più «?» e «#»)", indirizzoRidotto(`${ORIGINE}/demo?${CHIAVE_ATTRIBUZIONE_FITTIZIA}#sezione`) === `${ORIGINE}/demo` && indirizzoRidotto(`${ORIGINE}/`) === `${ORIGINE}/` && indirizzoRidotto(`${ORIGINE}/a?b=1?c=2#d?e`) === `${ORIGINE}/a` && indirizzoRidotto("") === "" && indirizzoRidotto(`${ORIGINE}/x#y`) === `${ORIGINE}/x`);
  atteso("nel testo dello snippet: due «config» (Analytics e Ads) una volta ciascuno per ramo, un solo «js», il default PRIMA di ogni altro comando", (snippet.match(/gtag\('js'/g) ?? []).length === 1 && snippet.indexOf("gtag('consent','default'") >= 0 && snippet.indexOf("gtag('consent','default'") < snippet.indexOf("gtag('set'") && snippet.indexOf("gtag('consent','default'") < snippet.indexOf("gtag('config'") && (snippet.match(/gtag\('config','G-W551SWPNE4'/g) ?? []).length === 2 && (snippet.match(/gtag\('config','AW-18422155730'/g) ?? []).length === 2);
  atteso("nessun evento e NESSUNA conversione Ads nello snippet (niente «event», «conversion», «send_to», etichette di conversione, url_passthrough)", !/gtag\('event'|conversion|send_to|AW-18422155730\/|url_passthrough/.test(snippet));
  atteso("lo snippet non legge cookie, parametri dell'indirizzo, identificativi di clic né fa richieste: usa solo l'indirizzo (ridotto), il percorso, il referrer (ridotto) e il consenso salvato", !/document\.cookie|\.search|gclid|utm_|navigator|fetch|XMLHttpRequest|sendBeacon|\.hash/.test(snippet) && /r\(l\.href\)/.test(snippet) && /r\(document\.referrer\)/.test(snippet));
  atteso("lo snippet è ES5 (gira anche su browser vecchi): niente funzioni a freccia, let/const, template literal", !/=>|\blet\b|\bconst\b|`/.test(snippet));
  atteso("lo snippet è sempre lo stesso (deterministico: nessuna data o numero casuale scritto nell'HTML)", costruisciSnippetIniziale() === snippet && !/\d{10,}/.test(snippet.split(ID_ADS_OMNIA_AI).join("")) && !/Date\.now|Math\.random/.test(snippet));
  atteso("la versione del testo del banner dentro lo snippet è quella attuale (si aggiorna da sola con la costante)", snippet.includes(`'${VERSIONE_BANNER_COOKIE}'`) && snippet.includes(`'${CHIAVE_VERSIONE_CONSENSO}'`) && VERSIONE_BANNER_COOKIE === "banner-2026-11");

  // ═════════════════════════ 2. Prima del consenso ═════════════════════════
  console.log("\n--- Prima del consenso: nuovo visitatore, rifiuto, scelta superata ---");
  const nuova = apriPagina();
  const e0 = elabora(nuova.coda(), nuova);
  atteso("NUOVO VISITATORE su una pagina pubblica: consenso «denied» → indirizzo e referrer ridotti → riduzione dati Ads → js → config Analytics con page_view SPENTO → config Ads; nessun «update»", JSON.stringify(e0.ordine) === JSON.stringify(["consent:default", "set:indirizzo", "set:ads_data_redaction", "js", `config:${ID_GA4_OMNIA_AI}`, `config:${ID_ADS_OMNIA_AI}`]), JSON.stringify(e0.ordine));
  atteso("… il PRIMO comando in assoluto è il consenso di default con i quattro segnali «denied»", nuova.coda()[0][0] === "consent" && nuova.coda()[0][1] === "default" && tuttiA(nuova.coda()[0][2] as Record<string, string>, "denied"));
  atteso("… entrambe le destinazioni parlano con tutti e quattro i consensi «denied»; Analytics con page_view spento", e0.config.length === 2 && e0.config.every((c) => tuttiA(c.consenso, "denied")) && (e0.config[0].opzioni as { send_page_view?: boolean }).send_page_view === false && e0.config[1].opzioni === null);
  atteso("… indirizzo e referrer impostati prima delle configurazioni sono ridotti a origine + percorso", e0.config.every((c) => c.indirizzo === `${ORIGINE}/demo` && c.referrer === `${ORIGINE}/piani`));
  const json0 = JSON.stringify(nuova.coda());
  atteso("… NIENTE di ciò che c'è nell'indirizzo e nel referrer è nella coda dei comandi: né gclid, né utm_, né email, né identificativi, né frammento", !/gclid|TESTGCLID|utm_|mario|email|9f1c|sezione|utente=|a%40b/.test(json0));
  atteso("… Google non ha ricevuto nessun valore «granted»; lo stato è «denied», il tag «ridotto», l'interruttore di Analytics ACCESO, nessun page_view di Analytics ancora mandato", !json0.includes("granted") && nuova.sandbox[VARIABILE_STATO_CONSENSO_GOOGLE] === "denied" && nuova.sandbox[VARIABILE_STATO_TAG_GOOGLE] === "ridotto" && nuova.sandbox[INTERRUTTORE_GA4] === true && nuova.sandbox[VARIABILE_PAGINA_VISTA_GA4] === false);
  const ping0 = pingPrevisti(nuova.coda(), nuova, () => nuova.sandbox[INTERRUTTORE_GA4] === true);
  atteso("PING previsti prima del consenso (modello dalle prove nel browser): UNO solo, verso Google Ads, con indirizzo e referrer ridotti e consenso «G100»; Analytics NIENTE", ping0.length === 1 && ping0[0].dove === "ads" && ping0[0].indirizzo === `${ORIGINE}/demo` && ping0[0].referrer === `${ORIGINE}/piani` && ping0[0].consenso === "G100", JSON.stringify(ping0));
  atteso("ogni pagina pubblica: stessa configurazione, il segnale ridotto parte, mai un parametro", PAGINE_PUBBLICHE.every((percorso) => {
    const p = apriPagina({ percorso });
    const e = elabora(p.coda(), p);
    const pg = pingPrevisti(p.coda(), p, () => p.sandbox[INTERRUTTORE_GA4] === true);
    return JSON.stringify(e.ordine) === JSON.stringify(e0.ordine) && pg.length === 1 && !/[?#]/.test(pg[0].indirizzo + pg[0].referrer) && p.sandbox[VARIABILE_STATO_TAG_GOOGLE] === "ridotto";
  }));
  atteso("ogni pagina NON ammessa (accesso, registrazione, acquisto, area riservata con identificativi, pagine legali, sottopagine): NESSUNA destinazione configurata, quindi NESSUN ping, stato «spento»", PAGINE_NON_AMMESSE.every((percorso) => {
    const p = apriPagina({ percorso, query: "?email=a%40b.it&id=77" });
    const e = elabora(p.coda(), p);
    return e.config.length === 0 && !e.ordine.some((o) => o.startsWith("config:")) && pingPrevisti(p.coda(), p, () => p.sandbox[INTERRUTTORE_GA4] === true).length === 0 && p.sandbox[VARIABILE_STATO_TAG_GOOGLE] === "spento" && !JSON.stringify(p.coda()).includes("email");
  }));
  atteso("pagina non ammessa: l'ordine resta consenso «denied» → indirizzo ridotto → riduzione dati → js (senza config)", (() => { const p = apriPagina({ percorso: "/login" }); return JSON.stringify(elabora(p.coda(), p).ordine) === JSON.stringify(["consent:default", "set:indirizzo", "set:ads_data_redaction", "js"]); })());
  const prima = apriPagina({ percorso: "/", query: "", referrer: "" });
  atteso("pagina senza parametri e senza referrer: indirizzo e referrer restano vuoti/ridotti senza errori", elabora(prima.coda(), prima).config.every((c) => c.indirizzo === `${ORIGINE}/` && c.referrer === ""));

  const rifiutato = apriPagina({ scelta: "rejected" });
  atteso("RIFIUTO già presente (con la versione attuale): identico al nuovo visitatore, mai «granted», Analytics spento", JSON.stringify(elabora(rifiutato.coda(), rifiutato).ordine) === JSON.stringify(e0.ordine) && !JSON.stringify(rifiutato.coda()).includes("granted") && rifiutato.sandbox[INTERRUTTORE_GA4] === true);
  const strani = ["ACCEPTED", "granted", "true", "1", "yes", " accepted", "accepted ", "pending", "rejected", ""].map((v) => apriPagina({ scelta: v }));
  atteso("valori salvati strani o sporchi (maiuscole, spazi, «granted», «true»…): contano come NON accettati, mai «granted», Analytics spento", strani.every((p) => !JSON.stringify(p.coda()).includes("granted") && p.sandbox[INTERRUTTORE_GA4] === true));

  const vecchiaAccettata = apriPagina({ scelta: "accepted", versione: "banner-2026-09" });
  atteso("SCELTA FATTA CON IL TESTO PRECEDENTE (accettata, versione «banner-2026-09»): non vale; si comporta da nuovo visitatore e la scelta superata viene CANCELLATA dal browser", JSON.stringify(elabora(vecchiaAccettata.coda(), vecchiaAccettata).ordine) === JSON.stringify(e0.ordine) && !JSON.stringify(vecchiaAccettata.coda()).includes("granted") && !vecchiaAccettata.archivio.has(CHIAVE_CONSENSO_COOKIE) && !vecchiaAccettata.archivio.has(CHIAVE_VERSIONE_CONSENSO));
  const senzaVersione = apriPagina({ scelta: "accepted", versione: null });
  atteso("SCELTA SENZA VERSIONE (come quella di chi aveva già accettato prima di questo rilascio): non vale, si cancella, il banner si ripropone", !JSON.stringify(senzaVersione.coda()).includes("granted") && !senzaVersione.archivio.has(CHIAVE_CONSENSO_COOKIE) && senzaVersione.sandbox[INTERRUTTORE_GA4] === true);
  const vecchiaRifiutata = apriPagina({ scelta: "rejected", versione: "banner-2026-09" });
  atteso("anche un RIFIUTO fatto con il testo precedente si cancella (si chiede di nuovo, con il testo nuovo)", !vecchiaRifiutata.archivio.has(CHIAVE_CONSENSO_COOKIE) && !vecchiaRifiutata.archivio.has(CHIAVE_VERSIONE_CONSENSO));
  const altriDati = new Map<string, string>([["omnia-ai-attribuzione", "{}"], ["altro", "x"]]);
  apriPagina({ scelta: "accepted", versione: "banner-2026-09", archivio: altriDati });
  atteso("la pulizia della scelta superata non tocca nessun altro dato del browser", altriDati.get("altro") === "x" && altriDati.has("omnia-ai-attribuzione"));
  let bloccato: Pagina | null = null;
  let errore: unknown = null;
  try {
    bloccato = apriPagina({ versione: "bloccato" });
  } catch (e) {
    errore = e;
  }
  atteso("localStorage BLOCCATO (modalità privata, blocco del browser): nessun errore, consenso «denied», Analytics spento, segnale ridotto come per un nuovo visitatore", errore === null && !!bloccato && JSON.stringify(elabora(bloccato.coda(), bloccato).ordine) === JSON.stringify(e0.ordine) && bloccato.sandbox[INTERRUTTORE_GA4] === true);

  // ═════════════════════════ 3. Consenso già presente ═════════════════════════
  console.log("\n--- Consenso già presente (accettato con la versione attuale) ---");
  const accettato = apriPagina({ scelta: "accepted", percorso: "/dashboard/omnia-ai/gare/9f1c2d3e-aaaa-bbbb-cccc-1234567890ab", query: "?x=1" });
  const e1 = elabora(accettato.coda(), accettato);
  atteso("CONSENSO GIÀ PRESENTE: default «denied» → subito «granted» (tre segnali, personalizzazione «denied») → riduzione dati → js → le DUE configurazioni, senza riduzioni dell'indirizzo, su QUALUNQUE pagina", JSON.stringify(e1.ordine) === JSON.stringify(["consent:default", "consent:update", "set:ads_data_redaction", "js", `config:${ID_GA4_OMNIA_AI}`, `config:${ID_ADS_OMNIA_AI}`]) && e1.config.every((c) => concessi(c.consenso) && c.opzioni === null && c.indirizzo === accettato.href), JSON.stringify(e1.ordine));
  atteso("… il PRIMO comando resta il default «denied»; Analytics è ACCESO e manda il suo page_view con l'indirizzo VERO; stato «completo»", accettato.coda()[0][1] === "default" && tuttiA(accettato.coda()[0][2] as Record<string, string>, "denied") && accettato.sandbox[INTERRUTTORE_GA4] === false && accettato.sandbox[VARIABILE_STATO_CONSENSO_GOOGLE] === "granted" && accettato.sandbox[VARIABILE_STATO_TAG_GOOGLE] === "completo" && accettato.sandbox[VARIABILE_PAGINA_VISTA_GA4] === true && pingPrevisti(accettato.coda(), accettato, () => false).some((x) => x.dove === "analytics" && x.indirizzo === accettato.href));

  // ═════════════════════════ 4. Banner: accettazione, rifiuto, revoca, navigazione ═════════════════════════
  console.log("\n--- Banner: accettazione, rifiuto, revoca, navigazione tra le pagine ---");
  {
    const p = apriPagina();
    const n0 = p.coda().length;
    p.archivio.set(CHIAVE_CONSENSO_COOKIE, "accepted");
    const esito = aggiornaConsensoGoogle("accepted", fin(p));
    const nuovi = p.coda().slice(n0);
    atteso("ACCETTAZIONE su una pagina pubblica: PRIMA l'indirizzo e il referrer VERI, poi un solo «consent update» (tre segnali granted, personalizzazione denied), poi UN page_view di Analytics", esito === "concesso" && nuovi.length === 3 && nuovi[0][0] === "set" && (nuovi[0][1] as Record<string, string>).page_location === p.href && (nuovi[0][1] as Record<string, string>).page_referrer === p.referrer && nuovi[1][0] === "consent" && nuovi[1][1] === "update" && concessi(nuovi[1][2] as Record<string, string>) && nuovi[2][0] === "event" && nuovi[2][1] === "page_view", JSON.stringify(nuovi));
    atteso("… Analytics si accende (interruttore spento), lo stato è «completo»; l'indirizzo vero ha gclid e utm_ (la campagna di provenienza della prima pagina si attribuisce)", p.sandbox[INTERRUTTORE_GA4] === false && p.sandbox[VARIABILE_STATO_TAG_GOOGLE] === "completo" && p.sandbox[VARIABILE_STATO_CONSENSO_GOOGLE] === "granted" && p.href.includes("gclid=TESTGCLID123") && (nuovi[0][1] as Record<string, string>).page_location.includes("gclid=TESTGCLID123"));
    const dopoOrdine = elabora(p.coda(), p).ordine.join(" > ");
    atteso("… ripetere la stessa scelta (doppio clic, effetto del banner) NON produce comandi doppi né un secondo page_view", aggiornaConsensoGoogle("accepted", fin(p)) === "invariato" && p.coda().length === n0 + 3 && elabora(p.coda(), p).ordine.join(" > ") === dopoOrdine);
  }
  {
    const p = apriPagina({ percorso: "/login" });
    const n0 = p.coda().length;
    const esito = aggiornaConsensoGoogle("accepted", fin(p));
    const nuovi = p.coda().slice(n0).map((c) => c[0] + ":" + (c[1] && typeof c[1] === "string" ? c[1] : "oggetto"));
    atteso("ACCETTAZIONE su una pagina NON ammessa (nulla era stato configurato): indirizzo vero → update → si configurano le DUE destinazioni (Analytics con il suo page_view automatico), senza un page_view a parte", esito === "concesso" && JSON.stringify(nuovi) === JSON.stringify(["set:oggetto", "consent:update", `config:${ID_GA4_OMNIA_AI}`, `config:${ID_ADS_OMNIA_AI}`]) && p.sandbox[VARIABILE_STATO_TAG_GOOGLE] === "completo" && p.sandbox[VARIABILE_PAGINA_VISTA_GA4] === true, JSON.stringify(nuovi));
  }
  {
    const p = apriPagina();
    const n0 = p.coda().length;
    const r1 = aggiornaConsensoGoogle("rejected", fin(p));
    const r2 = aggiornaConsensoGoogle("pending", fin(p));
    atteso("RIFIUTO (o banner ignorato): nessun comando a Google, i consensi restano «denied» da prima, Analytics resta spento", r1 === "invariato" && r2 === "invariato" && p.coda().length === n0 && tuttiA(elabora(p.coda(), p).consensoFinale, "denied") && p.sandbox[INTERRUTTORE_GA4] === true);
  }
  {
    const p = apriPagina({ scelta: "accepted" });
    const n0 = p.coda().length;
    atteso("CARICAMENTO con consenso già dato: il banner (effetto dopo l'idratazione) non manda nessun comando in più", aggiornaConsensoGoogle("accepted", fin(p)) === "invariato" && p.coda().length === n0);
    atteso("(controllo del controllo) trattare lo stato dell'idratazione («pending») come una revoca revocherebbe il consenso di chi ha già accettato: per questo il banner legge la scelta VERA dal browser, non lo stato", aggiornaConsensoGoogle("pending", fin(apriPagina({ scelta: "accepted" }))) === "revocato");
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
    const p = apriPagina({ scelta: "accepted", percorso: "/piani" });
    const n0 = p.coda().length;
    const esito = aggiornaConsensoGoogle("pending", fin(p)); // «Preferenze cookie» → la scelta si cancella → banner di nuovo in attesa
    const cancellati = esito === "revocato" ? cancellaCookieGoogle(barattolo.documento, "omnia-ai.it") : [];
    const nuovi = p.coda().slice(n0);
    atteso("REVOCA («Preferenze cookie»): Analytics si SPEGNE subito, un solo «consent update» con i quattro segnali «denied», indirizzo e referrer di nuovo ridotti", esito === "revocato" && p.sandbox[INTERRUTTORE_GA4] === true && nuovi.length === 2 && nuovi[0][1] === "update" && tuttiA(nuovi[0][2] as Record<string, string>, "denied") && nuovi[1][0] === "set" && (nuovi[1][1] as Record<string, string>).page_location === `${ORIGINE}/piani` && !/gclid|utm_/.test(JSON.stringify(nuovi[1])) && p.sandbox[VARIABILE_STATO_CONSENSO_GOOGLE] === "denied", JSON.stringify(nuovi));
    atteso("… e vengono tolti SOLO i cookie di Google (_ga, _ga_…, _gid, _gcl_*, __gads), anche su domini diversi; la sessione di accesso e gli altri cookie restano", cancellati.sort().join() === ["__gads", "_ga", "_ga_W551SWPNE4", "_gcl_au", "_gcl_aw", "_gid"].sort().join() && barattolo.cookie.map((c) => c.nome).sort().join() === ["altro", "omnia-zone", "sb-xyz-auth-token"].sort().join(), JSON.stringify(barattolo.cookie));
    const n1 = p.coda().length;
    const di_nuovo = aggiornaConsensoGoogle("accepted", fin(p));
    const nuovi2 = p.coda().slice(n1);
    atteso("dopo la revoca si può accettare di nuovo: indirizzo vero → Analytics acceso → update; NESSUN secondo page_view e nessuna riconfigurazione (nello stesso documento il page_view c'è già stato)", di_nuovo === "concesso" && nuovi2.length === 2 && nuovi2[0][0] === "set" && nuovi2[1][1] === "update" && !nuovi2.some((c) => c[0] === "event" || c[0] === "config") && p.sandbox[INTERRUTTORE_GA4] === false);
    const fine = aggiornaConsensoGoogle("rejected", fin(p));
    atteso("… e poi rifiutare di nuovo: Analytics si rispegne, «denied»; i comandi seguono le scelte senza doppioni", fine === "revocato" && p.sandbox[INTERRUTTORE_GA4] === true && tuttiA(elabora(p.coda(), p).consensoFinale, "denied"));
    const senzaCookie = nuovoBarattolo([{ nome: "sb-xyz-auth-token", dominio: null }]);
    atteso("revoca senza cookie di Google presenti: non cancella nulla (e non rompe)", cancellaCookieGoogle(senzaCookie.documento, "omnia-ai.it").length === 0 && senzaCookie.cookie.length === 1);
  }
  {
    const p = apriPagina({ scelta: "accepted" });
    const n0 = p.coda().length;
    const ripetuti = [1, 2, 3].map(() => aggiornaConsensoGoogle("accepted", fin(p)));
    atteso("NAVIGAZIONE tra pagine senza ricaricare il documento (il banner resta montato): nessun comando nuovo, il consenso resta concesso", ripetuti.every((r) => r === "invariato") && p.coda().length === n0 && concessi(elabora(p.coda(), p).consensoFinale));
    const archivio = new Map<string, string>();
    const pagina1 = apriPagina({ archivio });
    archivio.set(CHIAVE_CONSENSO_COOKIE, "accepted");
    archivio.set(CHIAVE_VERSIONE_CONSENSO, VERSIONE_BANNER_COOKIE); // come setConsent("accepted") sulla pagina 1
    aggiornaConsensoGoogle("accepted", fin(pagina1));
    const pagina2 = apriPagina({ archivio, percorso: "/piani" }); // seconda pagina con caricamento completo: il consenso è nel browser
    atteso("CARICAMENTO COMPLETO di una seconda pagina dopo «Accetta»: parte da «denied», passa a «granted» prima delle configurazioni, Analytics acceso (il consenso persiste tra le pagine)", JSON.stringify(elabora(pagina2.coda(), pagina2).ordine) === JSON.stringify(e1.ordine) && elabora(pagina2.coda(), pagina2).config.every((c) => concessi(c.consenso)) && pagina2.sandbox[INTERRUTTORE_GA4] === false);
    archivio.delete(CHIAVE_CONSENSO_COOKIE);
    archivio.delete(CHIAVE_VERSIONE_CONSENSO); // revoca sulla pagina 2 (come resetOmniaAiCookieConsent)
    aggiornaConsensoGoogle("pending", fin(pagina2));
    const pagina3 = apriPagina({ archivio });
    atteso("CARICAMENTO COMPLETO di una terza pagina dopo la revoca: di nuovo tutto «denied», Analytics spento, nessun «granted»", !JSON.stringify(pagina3.coda()).includes("granted") && pagina3.sandbox[INTERRUTTORE_GA4] === true && JSON.stringify(elabora(pagina3.coda(), pagina3).ordine) === JSON.stringify(e0.ordine));
    archivio.set(CHIAVE_CONSENSO_COOKIE, "rejected");
    archivio.set(CHIAVE_VERSIONE_CONSENSO, VERSIONE_BANNER_COOKIE);
    atteso("… e dopo un rifiuto esplicito idem", !JSON.stringify(apriPagina({ archivio }).coda()).includes("granted"));
    atteso("se il tag non è presente (bloccato da un'estensione, script non caricato) il banner non va in errore e non finge di aver comunicato il consenso", aggiornaConsensoGoogle("accepted", { [VARIABILE_STATO_CONSENSO_GOOGLE]: "denied" }) === "invariato");
  }
  {
    atteso("domini su cui togliere i cookie: l'host e ogni dominio superiore con almeno due etichette (mai «.it»)", JSON.stringify(dominiPossibili("omnia-ai.it")) === JSON.stringify([null, "omnia-ai.it"]) && JSON.stringify(dominiPossibili("www.omnia-ai.it")) === JSON.stringify([null, "www.omnia-ai.it", "omnia-ai.it"]) && JSON.stringify(dominiPossibili("localhost")) === JSON.stringify([null]) && !dominiPossibili("a.b.omnia-ai.it").includes("it"));
    atteso("riconoscimento dei cookie di Google: quelli dei tag sì, quelli del sito (accesso, zona) no", ["_ga", "_ga_W551SWPNE4", "_gid", "_gat", "_gat_gtag_G_W551SWPNE4", "_gcl_au", "_gcl_aw", "_gcl_dc", "_gcl_gb", "_gac_UA-123", "__gads", "__gpi", "FPAU", "FPLC"].every(eCookieGoogle) && ["sb-abc-auth-token", "omnia-zone", "omnia_zone", "_ga_", "my_ga", "gclid", "_gaX", "session", "_gclx"].every((n) => !eCookieGoogle(n)));
  }

  // ═════════════════════════ 5. Il banner, com'è e dove si monta ═════════════════════════
  console.log("\n--- Banner: testo e versione nuovi, una sola fonte, collegamento, scelta con versione ---");
  {
    const banner = leggi("src/components/omnia-ai/cookie-consent.tsx");
    const html = renderToStaticMarkup(createElement(OmniaAiCookieConsent));
    const testoVisibile = html.replace(/<[^>]+>/g, "").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
    atteso("il banner mostra ESATTAMENTE il testo registrato nei consensi (stessa costante) con «Rifiuta» e «Accetta»", testoVisibile.includes(TESTO_BANNER_COOKIE) && html.includes("Rifiuta") && html.includes("Accetta"));
    atteso("le parole «Cookie policy» sono un collegamento a /cookie-policy (e compaiono una volta sola nel testo)", /<a [^>]*href="\/cookie-policy"[^>]*>Cookie policy<\/a>/.test(html) && TESTO_BANNER_COOKIE.split("Cookie policy").length === 2);
    atteso("il banner NON carica più nessuno script e non nomina i due ID (sta tutto nel modulo del Google tag): niente next/script, niente googletagmanager, niente ID letterali", !/next\/script|<Script|googletagmanager|G-W551SWPNE4|AW-18422155730/.test(banner) && !html.includes("<script") && !html.includes("googletagmanager"));
    atteso("chiave e nome dell'evento del consenso sono quelli di prima (stessi di attribuzione, modulo DEMO e registro dei consensi)", /const CONSENT_KEY = "omnia-ai-cookie-consent";/.test(banner) && /const CONSENT_EVENT = "omnia-ai-consent-change";/.test(banner) && CHIAVE_CONSENSO_COOKIE === "omnia-ai-cookie-consent" && /export function resetOmniaAiCookieConsent\(\)/.test(banner));
    atteso("la scelta si salva CON la versione del testo visto e la revoca toglie entrambe; la lettura vale solo se la versione è quella attuale", /function setConsent[\s\S]*?localStorage\.setItem\(CONSENT_VERSION_KEY, VERSIONE_BANNER_COOKIE\);[\s\S]*?sincronizzaConsensoGoogle\(value\);/.test(banner) && /export function resetOmniaAiCookieConsent[\s\S]*?localStorage\.removeItem\(CONSENT_KEY\);\s*localStorage\.removeItem\(CONSENT_VERSION_KEY\);/.test(banner) && /localStorage\.getItem\(CONSENT_VERSION_KEY\) === VERSIONE_BANNER_COOKIE/.test(banner) && /const CONSENT_VERSION_KEY = CHIAVE_VERSIONE_CONSENSO;/.test(banner));
    atteso("il banner comunica la scelta a Google alla scelta, alla revoca e quando cambia da fuori; nell'effetto legge la scelta VERA dal browser (getSnapshot), non lo stato dell'idratazione", /export function resetOmniaAiCookieConsent[\s\S]*?sincronizzaConsensoGoogle\("pending"\);/.test(banner) && /useEffect\(\(\) => \{\s*sincronizzaConsensoGoogle\(getSnapshot\(\)\);\s*\}, \[status\]\);/.test(banner) && /esito === "revocato"\) cancellaCookieGoogle/.test(banner));
    atteso("il banner compare solo in attesa di scelta (come prima) e lo stato iniziale del server è sempre «in attesa»", /\{status === "pending" && \(/.test(banner) && /function getServerSnapshot\(\): Consent \{\s*return "pending";/.test(banner));
    atteso("il testo del banner dichiara ciò che il codice fa: Analytics e Ads, cookie solo se accetti, nessuna personalizzazione, Analytics spento se rifiuti, segnale tecnico senza cookie a Ads sulle pagine di presentazione, senza parametri dell'indirizzo", /Google Analytics e Google Ads/.test(TESTO_BANNER_COOKIE) && /Se accetti, salviamo cookie/.test(TESTO_BANNER_COOKIE) && /non li usiamo per annunci personalizzati/.test(TESTO_BANNER_COOKIE) && /Google Analytics resta spento/.test(TESTO_BANNER_COOKIE) && /segnale tecnico senza cookie/.test(TESTO_BANNER_COOKIE) && /senza parametri dell'indirizzo/.test(TESTO_BANNER_COOKIE) && !/solo se acconsenti/.test(TESTO_BANNER_COOKIE));
    atteso("la versione del testo è cambiata insieme al testo (banner-2026-11) e l'impronta registrata nei consensi dipende da questo testo", VERSIONE_BANNER_COOKIE === "banner-2026-11" && (VERSIONE_BANNER_COOKIE as string) !== "banner-2026-09" && (TESTO_BANNER_COOKIE as string) !=="Usiamo un cookie tecnico-pubblicitario solo se acconsenti, per capire quali annunci portano contatti utili. Nessun dato viene venduto a terzi.");

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

  // ═════════════════════════ 6. Un solo punto, nessun doppione, nessuna conversione ═════════════════════════
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
    atteso("il modulo del Google tag non genera NESSUN evento di conversione Ads (niente send_to, niente etichette); l'unico evento è il «page_view» di Analytics al consenso", !/send_to|conversion\b|AW-18422155730\/[A-Za-z0-9_-]+/.test(senzaCommenti(modulo)) && (senzaCommenti(modulo).match(/gtag\("event"/g) ?? []).length === 1 && /gtag\("event", "page_view"\)/.test(modulo) && !/gtag\(\s*['"]event['"]|send_to/.test(senzaCommenti(leggi("src/app/site-omnia-ai/layout.tsx"))));
    const importatori = tutti.filter((f) => /from "@\/lib\/google-tag"/.test(leggi(f))).sort();
    atteso("il modulo del Google tag è usato SOLO dal layout e dal banner di omnia-ai.it: nessun server, cron, database, Calendar, Data Manager, Supabase o Stripe lo importa", JSON.stringify(importatori) === JSON.stringify(["src/app/site-omnia-ai/layout.tsx", "src/components/omnia-ai/cookie-consent.tsx"]), importatori.join(", "));
    atteso("il modulo è utilizzabile nel browser: nessuna crittografia, nessun database, nessuna rete, nessuna variabile d'ambiente", !/^import .*(node:|crypto|supabase)/m.test(modulo) && !/process\.env|fetch\(/.test(modulo));
    const ecommerce = leggi("src/components/cookie-consent.tsx");
    atteso("l'e-commerce NON è toccato: il suo banner carica ancora i tag solo dopo «Accetta» e non usa il Consent Mode di questo rilascio", /\{status === "accepted" && \(/.test(ecommerce) && !/google-tag|consent', *'default|consent","default|ads_data_redaction/.test(ecommerce) && !/google-tag/.test(leggi("src/app/(ecommerce)/layout.tsx")));
    atteso("la console non carica nessun tag di Google", elenca("src/app/site-console").every((f) => !/googletagmanager|gtag\(|google-tag/.test(leggi(f))));
  }

  // ═════════════════════════ 7. Eventi DEMO, GCLID e registro dei consensi ═════════════════════════
  console.log("\n--- Eventi DEMO subordinati al consenso; GCLID e consensi invariati ---");
  {
    const form = leggi("src/components/omnia-ai/demo-form.tsx");
    const corpo = /function inviaEventoGa\([^)]*\) \{([\s\S]*?)\n\}/.exec(form)?.[1] ?? "";
    atteso("gli eventi del modulo DEMO partono SOLO con i cookie accettati: il controllo del consenso (stessa chiave del banner) viene PRIMA della chiamata a gtag", /cookiePubblicitariAccettati\(localStorage\.getItem\(CHIAVE_CONSENSO_COOKIE\)\)\) return;/.test(corpo) && corpo.indexOf("cookiePubblicitariAccettati") < corpo.indexOf('gtag("event"') && /typeof gtag === "function"/.test(corpo));
    atteso("il modulo non carica né configura niente di Google (solo due eventi esistenti, subordinati al consenso) e non crea conversioni", !/googletagmanager|gtag\('config'|gtag\("config"|dataLayer|send_to|conversion/.test(senzaCommenti(form)) && (form.match(/inviaEventoGa\(/g) ?? []).length === 3);
    const eventi = (consenso: string | null, versione: string | null = VERSIONE_BANNER_COOKIE) => {
      const p = apriPagina({ scelta: consenso, versione });
      const registrati: string[] = [];
      const inviaEventoGa = (nome: string) => {
        if (!cookiePubblicitariAccettati(p.archivio.get(CHIAVE_CONSENSO_COOKIE) ?? null)) return;
        registrati.push(nome);
      };
      inviaEventoGa("demo_booking_start");
      inviaEventoGa("demo_lead_submitted");
      return registrati.length;
    };
    atteso("(modello, con lo snippet vero che ripulisce la scelta superata) senza scelta, con rifiuto, valori sporchi o scelta di una versione precedente: zero eventi; con «accepted» attuale: due", eventi(null) === 0 && eventi("rejected") === 0 && eventi("granted") === 0 && eventi("ACCEPTED") === 0 && eventi("accepted", "banner-2026-09") === 0 && eventi("accepted", null) === 0 && eventi("accepted") === 2);

    const attribuzione = leggi("src/components/omnia-ai/attribuzione-demo.tsx");
    atteso("la raccolta del GCLID non è cambiata: solo con i cookie accettati, si aggiorna al cambio di consenso (stesso evento del banner) e non usa il Google tag", /cookiePubblicitariAccettati\(localStorage\.getItem\(CHIAVE_CONSENSO_COOKIE\)\)/.test(attribuzione) && /EVENTO_CAMBIO_CONSENSO = "omnia-ai-consent-change"/.test(attribuzione) && !/google-tag|gtag|dataLayer/.test(attribuzione));
    atteso("la chiave del consenso è UNA sola per banner, GCLID, modulo e snippet", leggi("src/lib/demo-lead-calcoli.ts").includes('CHIAVE_CONSENSO_COOKIE = "omnia-ai-cookie-consent"') && leggi("src/lib/google-tag.ts").includes('import { CHIAVE_CONSENSO_COOKIE } from "@/lib/demo-lead-calcoli";') && leggi("src/components/omnia-ai/attribuzione-demo.tsx").includes("CHIAVE_CONSENSO_COOKIE"));
    const intoccati = ["src/lib/demo-ads-data-manager.ts", "src/lib/demo-calendario-sync.ts", "src/lib/demo-ga4.ts", "src/lib/demo-ga4-prova.ts", "src/lib/demo-ciclo.ts", "src/app/api/webhooks/stripe/route.ts", "src/app/actions/omnia-ai-demo.ts"];
    atteso("i moduli di Data Manager API, Calendar, GA4 lato server, cron, Stripe e l'azione del modulo non nominano il Google tag del browser", intoccati.every((f) => !/google-tag|costruisciSnippetIniziale|aggiornaConsensoGoogle/.test(leggi(f))));
    atteso("le modalità prudenti restano nel codice: validateOnly di Google Ads predefinito e debug di GA4 (nessuna variabile cambiata da questo rilascio)", /DEMO_ADS_VALIDATE_ONLY/.test(leggi("src/lib/demo-ads-data-manager.ts")) && /DEMO_GA4_MP_DEBUG/.test(leggi("src/lib/demo-ga4.ts")));
    const consensi = leggi("src/lib/demo-consensi-calcoli.ts");
    atteso("registro dei consensi: la versione dell'informativa è la «2» e la versione dei testi del MODULO DEMO non è cambiata (il modulo non è stato toccato)", /VERSIONE_INFORMATIVA_PRIVACY = "2"/.test(consensi) && leggi("src/lib/demo-lead-calcoli.ts").includes('VERSIONE_CONSENSI_DEMO = "demo-2026-11-04"'));
  }

  // ═════════════════════════ 8. Guida e catena ═════════════════════════
  console.log("\n--- Guida e catena dei test ---");
  {
    const guida = leggi("GUIDA-GOOGLE-TAG-CONSENT-MODE.md");
    atteso("la guida esiste e documenta: diagnosi, come funziona, cosa viene trasmesso prima del consenso, rischi di conformità, come verificare con Tag Assistant e in Google Ads, rilascio e ritorno indietro", guida.length > 6000 && /Diagnosi/.test(guida) && /prima del consenso/i.test(guida) && /## 5\. Rischi di conformit/.test(guida) && /### 6\.2 Tag Assistant/.test(guida) && /scheda \*\*Consent\*\*/.test(guida) && /### 6\.3 Se Google Ads riconosce il tag/.test(guida) && /## 8\. Come tornare indietro/.test(guida) && /MANDA ONLINE/.test(guida));
    atteso("la guida dichiara i limiti e la sequenza di rilascio: ping senza cookie prima del consenso, migrazione 0100 subito dopo il deploy, scelte esistenti da richiedere di nuovo, Google Ads può impiegare 24 ore", /ping senza cookie|segnale tecnico/.test(guida) && /0100/.test(guida) && /subito dopo il deploy/i.test(guida) && /scelte? (già )?(esistent|salvat)/i.test(guida) && /24/.test(guida));
    atteso("i testi legali v2 e la migrazione 0100 esistono e la guida li cita; le bozze precedenti non ci sono più", fs.existsSync(path.join(radice, "legal/cookie-policy-omnia-ai-v2.md")) && fs.existsSync(path.join(radice, "legal/privacy-policy-omnia-ai-v2.md")) && fs.existsSync(path.join(radice, "supabase/migrations/0100_omnia_ai_privacy_cookie_v2.sql")) && !fs.existsSync(path.join(radice, "legal/cookie-policy-omnia-ai-v2-BOZZA.md")) && !fs.existsSync(path.join(radice, "legal/banner-cookie-omnia-ai-BOZZA.md")) && /cookie-policy-omnia-ai-v2\.md/.test(guida) && /privacy-policy-omnia-ai-v2\.md/.test(guida));
    const cookie = leggi("legal/cookie-policy-omnia-ai-v2.md");
    atteso("i testi legali dicono ciò che fa il codice: le stesse pagine di presentazione, Analytics spento prima del consenso, indirizzo senza parametri, personalizzazione disattivata, revoca con cancellazione dei cookie", /Home, Come funziona, Piani, Demo, Contatti, Riservatezza/.test(cookie) && /Google Analytics resta spento/.test(cookie) && /senza parametri né frammenti/.test(cookie) && /personalizzazione pubblicitaria resta disattivata/.test(cookie) && /togliamo dal tuo browser i cookie di Google/.test(cookie) && PAGINE_PUBBLICHE.length === 6);
    atteso("il test è nella catena verifica:livello1", /tsx scripts\/verifica-google-tag-omnia-ai\.ts/.test(leggi("package.json")));
    atteso("la configurazione di Vercel non cambia: nessun nuovo cron e nessuna variabile nel codice di Next", !/google-tag/.test(leggi("vercel.json")) && !/GOOGLE_TAG/.test(leggi("next.config.ts")));
  }

  if (fallimenti.length > 0) {
    console.log(`\n${fallimenti.length} controlli falliti:\n- ${fallimenti.join("\n- ")}`);
    process.exit(1);
  }
  completato = true;
  console.log("\nTutti i controlli sono andati a buon fine.");
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
