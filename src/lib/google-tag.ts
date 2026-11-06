import { CHIAVE_CONSENSO_COOKIE } from "@/lib/demo-lead-calcoli";
import { VERSIONE_BANNER_COOKIE } from "@/lib/demo-consensi-calcoli";

// GOOGLE TAG di omnia-ai.it con Consent Mode v2 in modalità AVANZATA e dati ridotti al minimo prima del consenso. Regole PURE (nessuna
// rete, nessun database, nessun segreto): lo stesso file serve al server (l'HTML iniziale del layout) e al browser (il banner); i test sono
// in scripts/verifica-google-tag-omnia-ai.ts, la spiegazione e le prove di rete in GUIDA-GOOGLE-TAG-CONSENT-MODE.md.
//
// Perché esiste: Google Ads segnalava «Nel tuo sito web manca un tag Google». Il tag era caricato SOLO dal browser dopo «Accetta» e
// l'HTML pubblicato non conteneva né gtag.js né l'ID di Google Ads (verificato il 05/11/2026): un controllo automatico non preme il banner.
//
// Come funziona:
//   1. nell'HTML iniziale c'è UN solo gtag.js, con due destinazioni: Google Analytics 4 (G-…) e Google Ads (AW-…);
//   2. PRIMA di qualsiasi configurazione i quattro segnali di consenso sono «denied»; solo se il visitatore ha già accettato (scelta salvata
//      nel browser CON la versione attuale del testo del banner) si passa subito a «granted», sempre prima dei comandi «config»;
//   3. finché il consenso è negato (nuovo visitatore, banner ignorato, rifiuto, revoca) parte AL MASSIMO un solo segnale tecnico verso
//      Google Ads, senza cookie, solo sulle pagine pubbliche di presentazione e con l'indirizzo e il referrer ridotti a origine + percorso
//      (niente parametri né frammento: gclid, utm_*, email, identificativi). Google Analytics resta SPENTO (interruttore ufficiale
//      «ga-disable-<ID>», nessun page_view, nessun evento di scorrimento, nessuna navigazione interna). Provato nel browser: vedi la guida;
//   4. «Accetta» → i segnali diventano «granted» (la PERSONALIZZAZIONE pubblicitaria resta «denied»), Analytics si accende e manda il
//      page_view con l'indirizzo VERO (così la campagna di provenienza della prima pagina si attribuisce);
//   5. «Rifiuta» o revoca («Preferenze cookie») → tornano «denied», Analytics si spegne e si cancellano i cookie di Google già scritti;
//   6. NESSUN evento di conversione Ads: le DEMO confermate vanno ad Ads solo dalla Data Manager API (lato server).
// Il banner, la sua chiave nel browser e il registro dei consensi della richiesta non cambiano (salvo la versione del testo, vedi sotto).

const ID_GA4 = "G-W551SWPNE4" as const;
export const ID_GA4_OMNIA_AI = ID_GA4;
export const ID_ADS_OMNIA_AI = "AW-18422155730";
// UN solo caricamento di gtag.js: la seconda destinazione si aggiunge con «config», non con un secondo script.
export const URL_GTAG_JS = `https://www.googletagmanager.com/gtag/js?id=${ID_GA4}`;

// Interruttore ufficiale di Google per spegnere la raccolta di una proprietà Analytics («window['ga-disable-<ID>'] = true»).
export const INTERRUTTORE_GA4 = `ga-disable-${ID_GA4}` as const;

export const SEGNALI_CONSENSO_GOOGLE = ["ad_storage", "analytics_storage", "ad_user_data", "ad_personalization"] as const;
export type SegnaleConsensoGoogle = (typeof SEGNALI_CONSENSO_GOOGLE)[number];
export type StatoConsensoGoogle = "granted" | "denied";
export type StatoBanner = "pending" | "accepted" | "rejected";

// La scelta del banner si salva insieme alla VERSIONE del testo che il visitatore ha visto (VERSIONE_BANNER_COOKIE). Una scelta fatta con
// un testo precedente non vale più: si cancella e il banner si ripropone. Serve perché il testo del 2026-11 dichiara cose che quello di
// prima non diceva (il Google tag caricato subito, il segnale tecnico prima della scelta): un consenso dato con il vecchio testo non
// è un consenso a questo, e il registro dei consensi della richiesta registra la versione ATTUALE del testo.
export const CHIAVE_VERSIONE_CONSENSO = "omnia-ai-cookie-consent-versione";

// Dove si ricorda cosa è stato comunicato a Google: lo scrive lo snippet iniziale, lo aggiorna il banner (mai una chiamata doppia).
export const VARIABILE_STATO_CONSENSO_GOOGLE = "__omniaAiConsensoGoogle";
// «spento»: nessuna destinazione configurata (pagina non pubblica, consenso negato); «ridotto»: solo Google Ads, ridotto, Analytics spento;
// «completo»: entrambe le destinazioni configurate e Analytics acceso (consenso dato).
export const VARIABILE_STATO_TAG_GOOGLE = "__omniaAiTagGoogle";
export type StatoTagGoogle = "spento" | "ridotto" | "completo";
// vero se Analytics ha già mandato il page_view della pagina in questo documento (per non mandarlo due volte)
export const VARIABILE_PAGINA_VISTA_GA4 = "__omniaAiPaginaVistaGa4";

// Le SOLE pagine su cui, con il consenso negato, parte il segnale tecnico verso Google Ads: le pagine pubbliche di presentazione, i cui
// indirizzi e titoli sono fissi. Tutto il resto (accesso, registrazione, acquisto, area riservata con i suoi identificativi, pagine
// legali) non manda NIENTE prima del consenso: la libreria si carica ma nessuna destinazione viene configurata. Elenco ESATTO: una pagina
// nuova non è ammessa finché non la si aggiunge qui di proposito.
export const PERCORSI_CON_SEGNALE_PRIMA_DEL_CONSENSO = ["/", "/come-funziona", "/piani", "/demo", "/contatti", "/riservatezza"] as const;

export function percorsoAmmessoPrimaDelConsenso(percorso: string): boolean {
  const normale = percorso.replace(/\/+$/, "") || "/";
  return (PERCORSI_CON_SEGNALE_PRIMA_DEL_CONSENSO as readonly string[]).includes(normale);
}

// Indirizzo ridotto a origine + percorso: niente parametri («?…») e niente frammento («#…»).
export function indirizzoRidotto(indirizzo: string): string {
  return String(indirizzo || "").split("#")[0].split("?")[0];
}

// L'unico modo di ottenere «granted» è «accepted»: in attesa e rifiuto valgono «denied».
export function consensoGoogleDaBanner(stato: StatoBanner): StatoConsensoGoogle {
  return stato === "accepted" ? "granted" : "denied";
}

// Cosa succede alla PERSONALIZZAZIONE pubblicitaria (remarketing, liste di pubblico) quando il visitatore preme «Accetta». Resta «denied»
// di proposito (decisione dell'utente, 05/11/2026): non si attivano remarketing né personalizzazione in questa fase. Verificato nel
// browser: con ad_personalization «granted» il tag di Google Ads avvia richieste di remarketing (…/rmkt/collect, …/pagead/1p-user-list).
export const PERSONALIZZAZIONE_DOPO_ACCETTA: StatoConsensoGoogle = "denied";

// I quattro segnali per uno stato: ad_storage, analytics_storage e ad_user_data seguono la scelta; ad_personalization segue la scelta solo
// se PERSONALIZZAZIONE_DOPO_ACCETTA lo permette (mai «granted» senza consenso).
export function valoriConsensoGoogle(stato: StatoConsensoGoogle): Record<SegnaleConsensoGoogle, StatoConsensoGoogle> {
  return { ad_storage: stato, analytics_storage: stato, ad_user_data: stato, ad_personalization: stato === "granted" ? PERSONALIZZAZIONE_DOPO_ACCETTA : "denied" };
}

// Lo snippet che gira nel browser PRIMA di gtag.js (ES5: gira anche su browser vecchi). Mette in coda i comandi nell'ordine in cui Google li
// vuole. Comandi (nuovo visitatore): consenso di default «denied» → indirizzo e referrer ridotti → riduzione dei dati pubblicitari → js →
// (solo pagine ammesse) config Analytics con page_view spento + config Ads. Con consenso già dato per la versione attuale del testo:
// default «denied» → aggiornamento «granted» → riduzione dati → js → config Analytics + config Ads, senza riduzioni. Se il localStorage è
// bloccato resta «denied». Non legge cookie, non scrive nulla oltre a togliere una scelta superata.
export function costruisciSnippetIniziale(): string {
  const negati = JSON.stringify(valoriConsensoGoogle("denied"));
  const concessi = JSON.stringify(valoriConsensoGoogle("granted"));
  const ammessi = JSON.stringify([...PERCORSI_CON_SEGNALE_PRIMA_DEL_CONSENSO]);
  const interruttore = `w['${INTERRUTTORE_GA4}']`;
  return [
    "window.dataLayer=window.dataLayer||[];",
    "function gtag(){dataLayer.push(arguments);}",
    "(function(){",
    "var w=window,l=w.location,ok=false;",
    `gtag('consent','default',${negati});`,
    `w.${VARIABILE_STATO_CONSENSO_GOOGLE}='denied';`,
    `w.${VARIABILE_STATO_TAG_GOOGLE}='spento';`,
    `w.${VARIABILE_PAGINA_VISTA_GA4}=false;`,
    `${interruttore}=true;`,
    `try{var s=w.localStorage;if(s.getItem('${CHIAVE_CONSENSO_COOKIE}')!==null&&s.getItem('${CHIAVE_VERSIONE_CONSENSO}')!=='${VERSIONE_BANNER_COOKIE}'){s.removeItem('${CHIAVE_CONSENSO_COOKIE}');s.removeItem('${CHIAVE_VERSIONE_CONSENSO}');}ok=s.getItem('${CHIAVE_CONSENSO_COOKIE}')==='accepted';}catch(e){ok=false;}`,
    "function r(u){return String(u||'').split('#')[0].split('?')[0];}",
    `if(ok){${interruttore}=false;gtag('consent','update',${concessi});w.${VARIABILE_STATO_CONSENSO_GOOGLE}='granted';}else{gtag('set',{page_location:r(l.href),page_referrer:r(document.referrer)});}`,
    "gtag('set','ads_data_redaction',true);",
    "gtag('js',new Date());",
    "var p=l.pathname.replace(/\\/+$/,'')||'/';",
    `if(ok){gtag('config','${ID_GA4}');gtag('config','${ID_ADS_OMNIA_AI}');w.${VARIABILE_STATO_TAG_GOOGLE}='completo';w.${VARIABILE_PAGINA_VISTA_GA4}=true;}`,
    `else if(${ammessi}.indexOf(p)>=0){gtag('config','${ID_GA4}',{send_page_view:false});gtag('config','${ID_ADS_OMNIA_AI}');w.${VARIABILE_STATO_TAG_GOOGLE}='ridotto';}`,
    "})();",
  ].join("\n");
}

// ── Aggiornamento del consenso dal banner ────────────────────────────────────────────────────────────────────────────────

export type FinestraGoogle = {
  gtag?: (...argomenti: unknown[]) => void;
  location?: { href: string };
  document?: { referrer: string };
  [VARIABILE_STATO_CONSENSO_GOOGLE]?: StatoConsensoGoogle;
  [VARIABILE_STATO_TAG_GOOGLE]?: StatoTagGoogle;
  [VARIABILE_PAGINA_VISTA_GA4]?: boolean;
  [INTERRUTTORE_GA4]?: boolean;
};

export type EsitoAggiornamentoConsenso = "invariato" | "concesso" | "revocato";

// Comunica a Google il consenso corrispondente alla scelta del banner, SOLO se è diverso da quanto già comunicato (idempotente: la
// navigazione tra le pagine, che non ricarica il documento, e le chiamate ripetute non producono comandi doppi).
//   concesso: PRIMA si rimettono l'indirizzo e il referrer VERI (così il primo invio con consenso porta la campagna di provenienza), si
//             riaccende Analytics, si aggiornano i quattro segnali, e Analytics manda UN page_view (o, se non era configurato perché la
//             pagina non è tra quelle ammesse, si configurano le due destinazioni);
//   revocato: si spegne Analytics, si aggiornano i segnali a «denied» e si rimettono indirizzo e referrer ridotti. Il chiamante deve anche
//             cancellare i cookie di Google (cancellaCookieGoogle).
export function aggiornaConsensoGoogle(stato: StatoBanner, finestra: FinestraGoogle): EsitoAggiornamentoConsenso {
  const voluto = consensoGoogleDaBanner(stato);
  if (finestra[VARIABILE_STATO_CONSENSO_GOOGLE] === voluto) return "invariato";
  const gtag = finestra.gtag;
  if (typeof gtag !== "function") return "invariato";
  const indirizzo = finestra.location?.href ?? "";
  const referrer = finestra.document?.referrer ?? "";

  if (voluto === "granted") {
    gtag("set", { page_location: indirizzo, page_referrer: referrer });
    finestra[INTERRUTTORE_GA4] = false;
    gtag("consent", "update", valoriConsensoGoogle("granted"));
    finestra[VARIABILE_STATO_CONSENSO_GOOGLE] = "granted";
    if (finestra[VARIABILE_STATO_TAG_GOOGLE] === "spento" || finestra[VARIABILE_STATO_TAG_GOOGLE] === undefined) {
      gtag("config", ID_GA4);
      gtag("config", ID_ADS_OMNIA_AI);
      finestra[VARIABILE_PAGINA_VISTA_GA4] = true;
    } else if (!finestra[VARIABILE_PAGINA_VISTA_GA4]) {
      gtag("event", "page_view");
      finestra[VARIABILE_PAGINA_VISTA_GA4] = true;
    }
    finestra[VARIABILE_STATO_TAG_GOOGLE] = "completo";
    return "concesso";
  }

  finestra[INTERRUTTORE_GA4] = true;
  gtag("consent", "update", valoriConsensoGoogle("denied"));
  gtag("set", { page_location: indirizzoRidotto(indirizzo), page_referrer: indirizzoRidotto(referrer) });
  finestra[VARIABILE_STATO_CONSENSO_GOOGLE] = "denied";
  return "revocato";
}

// ── Cookie di Google da togliere alla revoca ─────────────────────────────────────────────────────────────────────────────

// Cookie scritti dai tag Google (Analytics, Ads, conversion linker): _ga, _ga_<ID>, _gid, _gat*, _gcl_*, _gac_*, __gads, __gpi, FPAU, FPLC.
const MODELLO_COOKIE_GOOGLE = /^(?:_ga|_ga_[A-Za-z0-9]+|_gid|_gat(?:_.*)?|_gcl_(?:au|aw|dc|gb|gs|ag)|_gac_.+|__gads|__gpi|FPAU|FPLC)$/;

export function eCookieGoogle(nome: string): boolean {
  return MODELLO_COOKIE_GOOGLE.test(nome);
}

// I domini su cui un cookie può essere stato scritto: nessuno (solo l'host), l'host, e ogni dominio superiore che abbia almeno due etichette
// (www.omnia-ai.it → www.omnia-ai.it, .omnia-ai.it; mai «.it»).
export function dominiPossibili(host: string): (string | null)[] {
  const etichette = host.split(".").filter(Boolean);
  const domini: (string | null)[] = [null];
  for (let i = 0; i <= etichette.length - 2; i++) domini.push(etichette.slice(i).join("."));
  return domini;
}

export type DocumentoCookie = { cookie: string };

// Cancella dal browser i cookie di Google presenti (solo quelli: gli altri, come la sessione di accesso, non si toccano). Restituisce i
// nomi cancellati. Non può cancellare i cookie «HttpOnly», ma i tag Google non li usano.
export function cancellaCookieGoogle(documento: DocumentoCookie, host: string): string[] {
  const nomi = documento.cookie
    .split(";")
    .map((c) => c.trim().split("=")[0])
    .filter((n) => n && eCookieGoogle(n));
  for (const nome of new Set(nomi)) {
    for (const dominio of dominiPossibili(host)) {
      const prefissi = dominio === null ? [null] : [dominio, `.${dominio}`];
      for (const d of prefissi) documento.cookie = `${nome}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; max-age=0; path=/${d === null ? "" : `; domain=${d}`}`;
    }
  }
  return [...new Set(nomi)];
}
