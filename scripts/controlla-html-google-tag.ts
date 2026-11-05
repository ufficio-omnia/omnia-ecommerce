// Controllo dell'HTML INIZIALE di omnia-ai.it: c'è il Google tag (un solo gtag.js, due destinazioni) e i quattro consensi sono «denied» prima
// di ogni configurazione? È il controllo che fa un crawler: scarica la pagina, NON esegue JavaScript, NON preme il banner.
//
// Uso (non fa parte della catena dei test: serve un sito in esecuzione):
//   locale (server di sviluppo):  npx tsx scripts/controlla-html-google-tag.ts http://localhost:3000 "?__zone=omnia-ai"
//   produzione (dopo il rilascio): npx tsx scripts/controlla-html-google-tag.ts https://omnia-ai.it
// Scarica solo le pagine (GET): non esegue lo snippet, non contatta Google, non scrive niente.
const base = (process.argv[2] ?? "https://omnia-ai.it").replace(/\/$/, "");
const suffisso = process.argv[3] ?? "";
const PAGINE = ["/", "/demo", "/piani", "/cookie-policy", "/privacy"];

const fallimenti: string[] = [];
function atteso(nome: string, ok: boolean, dettaglio = "") {
  console.log(`${ok ? "ok    " : "FALLITO"} ${nome}${ok ? "" : ` — ${dettaglio}`}`);
  if (!ok) fallimenti.push(nome);
}

async function main() {
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
    atteso("nell'<head> c'è UNO snippet inline con il consenso di default", snippet.length === 1, `${snippet.length}`);
    const codice = snippet[0] ?? "";
    const negati = /gtag\('consent','default',\{"ad_storage":"denied","analytics_storage":"denied","ad_user_data":"denied","ad_personalization":"denied"\}\)/.test(codice);
    atteso("i quattro consensi sono «denied» nel comando di default", negati);
    const posDefault = codice.indexOf("gtag('consent','default'");
    const posConfig = codice.indexOf("gtag('config'");
    atteso("il consenso di default viene PRIMA di qualsiasi «config» e di qualsiasi altro comando", posDefault >= 0 && posConfig > posDefault && codice.indexOf("gtag('js'") > posDefault && codice.indexOf("gtag('set'") > posDefault);
    atteso("le due destinazioni sono configurate UNA volta ciascuna: Analytics G-W551SWPNE4 e Google Ads AW-18422155730", (codice.match(/gtag\('config','G-W551SWPNE4'\)/g) ?? []).length === 1 && (codice.match(/gtag\('config','AW-18422155730'\)/g) ?? []).length === 1 && (codice.match(/gtag\('config'/g) ?? []).length === 2);
    atteso("lo snippet viene PRIMA della libreria nell'HTML", head.indexOf(codice) >= 0 && head.indexOf(codice) < head.indexOf(libreria[0] ?? "§§"));
    atteso("nessun secondo gtag.js né script con l'ID di Google Ads nell'HTML (la seconda destinazione la carica Google da sola dopo il «config»)", (html.match(/<script\b[^>]*\bsrc="[^"]*gtag\/js[^"]*"/g) ?? []).length === 1 && !/<script\b[^>]*\bsrc="[^"]*AW-18422155730/.test(html));
    atteso("nessun evento e nessuna conversione Ads nell'HTML (niente gtag('event'…), niente send_to)", !/gtag\('event'|send_to|AW-18422155730\//.test(html));
    atteso("il banner dei cookie è nell'HTML (si sceglie dopo, il tag è già al suo posto con tutto negato)", /Accetta/.test(html) || pagina !== "/");
  }
  if (fallimenti.length > 0) {
    console.log(`\n${fallimenti.length} controlli falliti:\n- ${fallimenti.join("\n- ")}`);
    process.exit(1);
  }
  console.log("\nHTML iniziale corretto su tutte le pagine controllate.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
