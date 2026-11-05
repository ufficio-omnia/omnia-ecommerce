// Controllo dell'HTML INIZIALE di omnia-ai.it: c'è il Google tag (un solo gtag.js, due destinazioni) e i quattro consensi sono «denied» prima
// di ogni configurazione? Con il consenso negato Analytics è spento e a Google Ads arriva al massimo un segnale ridotto (indirizzo senza
// parametri)? È il controllo che fa un crawler: scarica la pagina, NON esegue JavaScript, NON preme il banner.
//
// Uso (non fa parte della catena dei test: serve un sito in esecuzione):
//   locale (server di sviluppo):  npx tsx scripts/controlla-html-google-tag.ts http://localhost:3000 "?__zone=omnia-ai"
//   produzione (dopo il rilascio): npx tsx scripts/controlla-html-google-tag.ts https://omnia-ai.it
// Scarica solo le pagine (GET): non esegue lo snippet, non contatta Google, non scrive niente.
import { costruisciSnippetIniziale } from "../src/lib/google-tag";

const base = (process.argv[2] ?? "https://omnia-ai.it").replace(/\/$/, "");
const suffisso = process.argv[3] ?? "";
const PAGINE = ["/", "/demo", "/piani", "/cookie-policy", "/privacy"];

const fallimenti: string[] = [];
function atteso(nome: string, ok: boolean, dettaglio = "") {
  console.log(`${ok ? "ok    " : "FALLITO"} ${nome}${ok ? "" : ` — ${dettaglio}`}`);
  if (!ok) fallimenti.push(nome);
}

function conta(testo: string, parte: string): number {
  return testo.split(parte).length - 1;
}

async function main() {
  // lo snippet che il codice di QUESTO ramo produce: l'HTML pubblicato deve contenerlo identico (un deploy vecchio, o uno snippet
  // cambiato a mano, non passa)
  const snippetAtteso = costruisciSnippetIniziale();
  for (const pagina of PAGINE) {
    const url = `${base}${pagina}${suffisso}`;
    console.log(`\n--- ${url} ---`);
    const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; controllo-tag-google)" } });
    const html = await r.text();
    atteso(`risponde 200 (${r.status})`, r.status === 200);
    const head = html.slice(html.indexOf("<head"), html.indexOf("</head>"));
    const scripts = [...head.matchAll(/<script\b[^>]*>(?:[\s\S]*?<\/script>)?/g)].map((m) => m[0]);
    const libreria = scripts.filter((s) => /<script\b[^>]*\bsrc="https:\/\/www\.googletagmanager\.com\/gtag\/js\?id=G-W551SWPNE4"/.test(s));
    const snippet = scripts.filter((s) => /gtag\('consent','default'/.test(s));
    atteso("nell'<head> dell'HTML iniziale c'è UN tag <script src=…gtag/js?id=G-W551SWPNE4> (il tag che Google cerca)", libreria.length === 1, `${libreria.length}`);
    atteso("la libreria è caricata con «defer» (esegue dopo lo snippet) e non con «async»", libreria.length === 1 && /\bdefer\b/.test(libreria[0]) && !/\basync\b/.test(libreria[0]));
    atteso("nell'<head> c'è UNO snippet inline con il consenso di default", snippet.length === 1, `${snippet.length}`);
    const codice = snippet[0] ?? "";
    // il browser ha decodificato le entità HTML (&#x27; ecc.): per confrontare con lo snippet atteso si riportano alla forma letterale
    const codiceLetterale = codice.replace(/^<script[^>]*>/, "").replace(/<\/script>$/, "").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
    atteso("lo snippet nell'HTML è IDENTICO a quello prodotto dal codice del ramo (stessi comandi, stesso ordine, stessa versione del banner)", codiceLetterale === snippetAtteso, "differisce");
    const negati = /gtag\('consent','default',\{"ad_storage":"denied","analytics_storage":"denied","ad_user_data":"denied","ad_personalization":"denied"\}\)/.test(codiceLetterale);
    atteso("i quattro consensi sono «denied» nel comando di default", negati);
    const posDefault = codiceLetterale.indexOf("gtag('consent','default'");
    const posConfigPrima = codiceLetterale.indexOf("gtag('config'");
    atteso("il consenso di default viene PRIMA di qualsiasi «config», «js» e «set»", posDefault >= 0 && posConfigPrima > posDefault && codiceLetterale.indexOf("gtag('js'") > posDefault && codiceLetterale.indexOf("gtag('set'") > posDefault);
    // il solo «update» presente nello snippet è quello per chi ha già accettato (versione attuale del banner): sta dopo il default e prima dei «config»
    const posUpdate = codiceLetterale.indexOf("gtag('consent','update'");
    atteso("l'unico «consent update» dello snippet (per chi ha già accettato) viene dopo il default e PRIMA di ogni «config»", conta(codiceLetterale, "gtag('consent','update'") === 1 && posUpdate > posDefault && posUpdate < posConfigPrima);
    // Ads: configurato nei due rami (consenso già dato, pagina pubblica ammessa); Analytics: nel primo senza opzioni, nel secondo con page view spento
    atteso("Analytics: due rami — consenso già dato (config normale) e consenso negato su pagina ammessa (config con send_page_view:false)", conta(codiceLetterale, "gtag('config','G-W551SWPNE4')") === 1 && conta(codiceLetterale, "gtag('config','G-W551SWPNE4',{send_page_view:false})") === 1);
    atteso("Google Ads AW-18422155730: configurato nei due rami (e solo lì), mai con parametri o eventi", conta(codiceLetterale, "gtag('config','AW-18422155730')") === 2 && conta(codiceLetterale, "AW-18422155730") === 2);
    atteso("Analytics parte SPENTO (interruttore ufficiale ga-disable-G-W551SWPNE4 = true) e si riaccende solo nel ramo «già accettato»", codiceLetterale.indexOf("w['ga-disable-G-W551SWPNE4']=true;") >= 0 && conta(codiceLetterale, "w['ga-disable-G-W551SWPNE4']=false;") === 1);
    atteso("con il consenso negato indirizzo e referrer inviati a Google sono ridotti a origine + percorso (gtag('set', page_location/page_referrer))", /gtag\('set',\{page_location:r\(l\.href\),page_referrer:r\(document\.referrer\)\}\)/.test(codiceLetterale) && /split\('\?'\)\[0\]/.test(codiceLetterale));
    atteso("ads_data_redaction attivo", codiceLetterale.indexOf("gtag('set','ads_data_redaction',true)") > posDefault);
    atteso("ad_personalization resta «denied» anche nell'aggiornamento dopo «Accetta» (niente remarketing)", /gtag\('consent','update',\{"ad_storage":"granted","analytics_storage":"granted","ad_user_data":"granted","ad_personalization":"denied"\}\)/.test(codiceLetterale));
    atteso("la scelta salvata con una versione del banner diversa viene cancellata (chiave della versione presente nello snippet)", codiceLetterale.includes("omnia-ai-cookie-consent-versione"));
    atteso("lo snippet viene PRIMA della libreria nell'HTML", head.indexOf(codice) >= 0 && head.indexOf(codice) < head.indexOf(libreria[0] ?? "§§"));
    atteso("nessun secondo gtag.js né script con l'ID di Google Ads nell'HTML (la seconda destinazione la carica Google da sola dopo il «config»)", (html.match(/<script\b[^>]*\bsrc="[^"]*gtag\/js[^"]*"/g) ?? []).length === 1 && !/<script\b[^>]*\bsrc="[^"]*AW-18422155730/.test(html));
    atteso("nessun evento e nessuna conversione Ads nell'HTML (niente gtag('event'…), niente send_to)", !/gtag\('event'|send_to|AW-18422155730\//.test(html));
    atteso("il banner dei cookie è nell'HTML (si sceglie dopo, il tag è già al suo posto con tutto negato)", /Accetta/.test(html) || pagina !== "/");
  }
  if (fallimenti.length > 0) {
    console.log(`\n${fallimenti.length} controlli falliti:\n- ${[...new Set(fallimenti)].join("\n- ")}`);
    process.exit(1);
  }
  console.log("\nHTML iniziale corretto su tutte le pagine controllate.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
