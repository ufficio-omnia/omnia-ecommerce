import { CHIAVE_CONSENSO_COOKIE } from "@/lib/demo-lead-calcoli";

// GOOGLE TAG di omnia-ai.it con Consent Mode v2 in modalità AVANZATA. Regole PURE (nessuna rete, nessun database, nessun segreto): lo
// stesso file serve al server (l'HTML iniziale del layout) e al browser (il banner); i test sono in scripts/verifica-google-tag-omnia-ai.ts.
//
// Perché esiste: Google Ads segnalava «Nel tuo sito web manca un tag Google». Il tag era caricato SOLO dal browser dopo «Accetta» e
// l'HTML pubblicato non conteneva né gtag.js né l'ID di Google Ads (verificato il 05/11/2026): un controllo automatico non preme il banner.
//
// Come funziona (modalità AVANZATA di Google):
//   1. nell'HTML iniziale c'è UN solo gtag.js, con due destinazioni: Google Analytics 4 (G-…) e Google Ads (AW-…);
//   2. PRIMA di qualsiasi configurazione i quattro segnali di consenso sono «denied»; solo se il visitatore ha già accettato (scelta salvata
//      nel browser) si passa subito a «granted», sempre prima dei comandi «config»;
//   3. finché il consenso è negato Google riceve solo ping SENZA cookie (vedi la guida, sezione «Cosa viene trasmesso prima del consenso»);
//   4. «Accetta» → i quattro segnali diventano «granted»; «Rifiuta» o revoca («Preferenze cookie») → tornano «denied» e si cancellano i
//      cookie di Google già scritti;
//   5. NESSUN evento di conversione Ads: le DEMO confermate vanno a Google Ads solo dalla Data Manager API (lato server).
// Il banner, la sua chiave nel browser e il registro dei consensi della richiesta non cambiano.

export const ID_GA4_OMNIA_AI = "G-W551SWPNE4";
export const ID_ADS_OMNIA_AI = "AW-18422155730";
// UN solo caricamento di gtag.js: la seconda destinazione si aggiunge con «config», non con un secondo script.
export const URL_GTAG_JS = `https://www.googletagmanager.com/gtag/js?id=${ID_GA4_OMNIA_AI}`;

export const SEGNALI_CONSENSO_GOOGLE = ["ad_storage", "analytics_storage", "ad_user_data", "ad_personalization"] as const;
export type SegnaleConsensoGoogle = (typeof SEGNALI_CONSENSO_GOOGLE)[number];
export type StatoConsensoGoogle = "granted" | "denied";
export type StatoBanner = "pending" | "accepted" | "rejected";

// Dove si ricorda cosa è stato comunicato a Google: l'ha scritto lo snippet iniziale, lo aggiorna il banner (mai una chiamata doppia).
export const VARIABILE_STATO_CONSENSO_GOOGLE = "__omniaAiConsensoGoogle";

// L'unico modo di ottenere «granted» è «accepted»: in attesa e rifiuto valgono «denied».
export function consensoGoogleDaBanner(stato: StatoBanner): StatoConsensoGoogle {
  return stato === "accepted" ? "granted" : "denied";
}

// Cosa succede alla PERSONALIZZAZIONE pubblicitaria (remarketing, liste di pubblico) quando il visitatore preme «Accetta». Resta «denied»
// di proposito: il testo del banner («capire quali annunci portano contatti utili») e la cookie policy parlano di MISURAZIONE delle
// campagne, non di pubblicità personalizzata. Verificato nel browser il 05/11/2026: con ad_personalization «granted» il tag di Google Ads
// avvia richieste di remarketing (…/rmkt/collect, …/pagead/1p-user-list) che quei testi non dichiarano. Per attivarla serve prima un
// testo che la dichiari (vedi legal/banner-cookie-omnia-ai-BOZZA.md): poi basta cambiare questo valore in «granted».
export const PERSONALIZZAZIONE_DOPO_ACCETTA: StatoConsensoGoogle = "denied";

// I quattro segnali per uno stato: ad_storage, analytics_storage e ad_user_data seguono la scelta; ad_personalization segue la scelta solo
// se PERSONALIZZAZIONE_DOPO_ACCETTA lo permette (mai «granted» senza consenso).
export function valoriConsensoGoogle(stato: StatoConsensoGoogle): Record<SegnaleConsensoGoogle, StatoConsensoGoogle> {
  return { ad_storage: stato, analytics_storage: stato, ad_user_data: stato, ad_personalization: stato === "granted" ? PERSONALIZZAZIONE_DOPO_ACCETTA : "denied" };
}

// Lo snippet che gira nel browser PRIMA di gtag.js (ES5: gira anche su browser vecchi). Mette in coda i comandi nell'ordine in cui Google li
// vuole: consenso di default «denied» → (scelta già salvata) aggiornamento → riduzione dei dati pubblicitari → js → config GA4 → config Ads.
// Se il localStorage è bloccato resta «denied». Non legge cookie, non legge l'indirizzo della pagina, non scrive nulla.
export function costruisciSnippetIniziale(): string {
  const negati = JSON.stringify(valoriConsensoGoogle("denied"));
  const concessi = JSON.stringify(valoriConsensoGoogle("granted"));
  return [
    "window.dataLayer=window.dataLayer||[];",
    "function gtag(){dataLayer.push(arguments);}",
    `gtag('consent','default',${negati});`,
    `window.${VARIABILE_STATO_CONSENSO_GOOGLE}='denied';`,
    `try{if(window.localStorage.getItem('${CHIAVE_CONSENSO_COOKIE}')==='accepted'){gtag('consent','update',${concessi});window.${VARIABILE_STATO_CONSENSO_GOOGLE}='granted';}}catch(e){}`,
    "gtag('set','ads_data_redaction',true);",
    "gtag('js',new Date());",
    `gtag('config','${ID_GA4_OMNIA_AI}');`,
    `gtag('config','${ID_ADS_OMNIA_AI}');`,
  ].join("\n");
}

// ── Aggiornamento del consenso dal banner ────────────────────────────────────────────────────────────────────────────────

export type FinestraGoogle = {
  gtag?: (...argomenti: unknown[]) => void;
  [VARIABILE_STATO_CONSENSO_GOOGLE]?: StatoConsensoGoogle;
};

export type EsitoAggiornamentoConsenso = "invariato" | "concesso" | "revocato";

// Comunica a Google il consenso corrispondente alla scelta del banner, SOLO se è diverso da quanto già comunicato (idempotente: la
// navigazione tra le pagine, che non ricarica il documento, e le chiamate ripetute non producono comandi doppi). «revocato» = prima era
// concesso e ora no: il chiamante deve anche cancellare i cookie di Google (cancellaCookieGoogle).
export function aggiornaConsensoGoogle(stato: StatoBanner, finestra: FinestraGoogle): EsitoAggiornamentoConsenso {
  const voluto = consensoGoogleDaBanner(stato);
  const attuale = finestra[VARIABILE_STATO_CONSENSO_GOOGLE];
  if (attuale === voluto) return "invariato";
  if (typeof finestra.gtag !== "function") return "invariato";
  finestra.gtag("consent", "update", valoriConsensoGoogle(voluto));
  finestra[VARIABILE_STATO_CONSENSO_GOOGLE] = voluto;
  return voluto === "granted" ? "concesso" : "revocato";
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
