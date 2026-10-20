// Autotest del badge di Stripe Climate su omnia-ai.it: l'iframe fornito da Stripe nel piè di pagina e la frase sulla pagina
// dei piani. Si controlla che:
//   - l'iframe punti SOLO all'indirizzo di Stripe fornito, con gli accorgimenti per un contenuto di terzi (sandbox senza
//     permessi, niente indirizzo di provenienza, caricamento pigro, titolo per chi usa uno screen reader, larghezza massima);
//   - il badge sia in UN solo posto (il piè di pagina, che compare in tutte le pagine pubbliche), non duplicato nei piani
//     né in altre zone (area riservata, console, e-commerce);
//   - la frase sui piani dica solo ciò che dice Stripe (1%, Stripe Climate, CO₂), senza promesse più grandi
//     («carbon neutral», «green», «compensiamo»…);
//   - gli stili tengano il badge su una riga sua, trasparente sullo sfondo scuro, e abbastanza alto sugli schermi stretti.
// Gratuito, nessun database né rete: gira nel livello 1, quindi in prebuild.
import fs from "fs";
import path from "path";

const fallimenti: string[] = [];
function atteso(nome: string, ok: boolean, dettaglio = "") {
  console.log(`${ok ? "ok    " : "FALLITO"} ${nome}${ok ? "" : ` — ${dettaglio}`}`);
  if (!ok) fallimenti.push(nome);
}
const radice = path.join(__dirname, "..");
const leggi = (relativo: string) => fs.readFileSync(path.join(radice, relativo), "utf-8").replace(/\r\n/g, "\n");
const conta = (testo: string, re: RegExp) => (testo.match(re) ?? []).length;

function fileSorgenti(cartella: string): string[] {
  const out: string[] = [];
  for (const voce of fs.readdirSync(path.join(radice, cartella), { withFileTypes: true })) {
    const relativo = `${cartella}/${voce.name}`;
    if (voce.isDirectory()) out.push(...fileSorgenti(relativo));
    else if (/\.(tsx?|css)$/.test(voce.name)) out.push(relativo);
  }
  return out;
}

const componente = leggi("src/components/omnia-ai/climate-badge.tsx");
// Il codice del componente senza i commenti: gli attributi si controllano QUI, perché i commenti li citano e un attributo tolto resterebbe «presente».
const codice = componente
  .split("\n")
  .filter((r) => !r.trim().startsWith("//"))
  .join("\n");
const piede = leggi("src/components/omnia-ai/site-footer.tsx");
const piani = leggi("src/app/site-omnia-ai/piani/piani-vista.tsx");
const css = leggi("src/app/site-omnia-ai/omnia-ai.css");

console.log("--- L'iframe ---");
atteso("l'indirizzo è quello fornito da Stripe, e solo quello", /export const URL_BADGE_CLIMATE = "https:\/\/climate\.stripe\.com\/badge\/mE76Pa";/.test(codice) && (codice.match(/https?:\/\/[^\s"'`)]+/g) ?? []).every((u) => u.startsWith("https://climate.stripe.com/badge/mE76Pa")));
atteso("parametri: tema, dimensione piccola, lingua italiana", /src=\{`\$\{URL_BADGE_CLIMATE\}\?theme=\$\{tema\}&size=small&locale=it-IT`\}/.test(codice));
atteso("il tema predefinito è «dark» (il sito è scuro) e sono ammessi solo i due temi di Stripe", /tema = "dark"\s*\}: \{ tema\?: "light" \| "dark" \}/.test(codice));
atteso("dimensioni fornite da Stripe (380 × 38), bordo zero, mai più largo dello schermo", /width=\{380\}/.test(codice) && /height=\{38\}/.test(codice) && /border: 0/.test(codice) && /maxWidth: "100%"/.test(codice));
atteso("sandbox senza alcun permesso (la pagina del badge è solo HTML e CSS)", /sandbox=""/.test(codice) && !/allow-/.test(codice));
atteso("nessun permesso del browser concesso all'iframe (niente allow=, niente schermo intero)", !/\sallow=/.test(codice) && !/allowFullScreen|allowfullscreen/.test(codice));
atteso("non si dice a Stripe da quale pagina arriva il visitatore", /referrerPolicy="no-referrer"/.test(codice));
atteso("caricamento pigro: il piè di pagina sta in fondo, il badge si carica solo avvicinandosi", /loading="lazy"/.test(codice));
atteso("titolo per chi usa uno screen reader, con la stessa cosa che dice il badge", /title="Stripe Climate: l'1% degli acquisti contribuisce alla rimozione di CO₂ dall'atmosfera"/.test(codice));
atteso("componente del server (nessuno script del sito in più)", !/^"use client"/m.test(componente));

console.log("--- Dove compare ---");
atteso("il piè di pagina lo mostra una volta, a destra del livello alto (dopo i collegamenti), sopra la riga legale", conta(piede, /<ClimateBadge\b/g) === 1 && /<div className="omnia-footer-alto">\s*<nav>[\s\S]*?<\/nav>\s*<div className="omnia-climate">\s*<ClimateBadge \/>\s*<\/div>\s*<\/div>\s*<p className="omnia-footer-basso">/.test(piede) && /import ClimateBadge from "\.\/climate-badge";/.test(piede));
atteso("la riga legale (nome, prodotto di Omnia Consulting, partita IVA) c'è ed è l'ultima cosa del piè di pagina", /<p className="omnia-footer-basso">OMNIA AI — un prodotto di Omnia Consulting SRLS · P\.IVA 02957590819<\/p>\s*<\/footer>/.test(piede));
atteso("il piè di pagina resta un componente del server, con i collegamenti di prima", !/^"use client"/m.test(piede) && ["omniaitalia.com", "/contatti", "/privacy", "/riservatezza", "condizioniUrl", "/cookie-policy", "CookiePreferencesButton"].every((v) => piede.includes(v)));
atteso("la pagina dei piani NON ha il badge (c'è già nel piè di pagina sotto: non si duplica)", !/ClimateBadge|climate\.stripe\.com|<iframe/.test(piani));
const sorgenti = fileSorgenti("src");
const usano = sorgenti.filter((f) => /ClimateBadge|climate\.stripe\.com/.test(leggi(f))).sort();
atteso("il badge è nel componente e nel piè di pagina di OMNIA AI, in nessun altro punto (area riservata, console, e-commerce, piani)", JSON.stringify(usano) === JSON.stringify(["src/components/omnia-ai/climate-badge.tsx", "src/components/omnia-ai/site-footer.tsx"]), usano.join(", "));
atteso("nessun altro iframe di terzi nei sorgenti, a parte quello del badge", sorgenti.filter((f) => /\.tsx$/.test(f) && /<iframe/.test(leggi(f))).join(",") === "src/components/omnia-ai/climate-badge.tsx");

console.log("--- La frase sui piani ---");
const frase = "Omnia Consulting destina l&apos;1% di ogni abbonamento a Stripe Climate, per ridurre la CO₂ nell&apos;atmosfera.";
atteso("la frase c'è, una volta, in piccolo, con le stesse cose che dice Stripe (1%, Stripe Climate, CO₂)", conta(piani, /Stripe Climate/g) === 1 && piani.includes(`<p className="micro" style={{ marginTop: 8 }}>\n          ${frase}\n        </p>`));
atteso("nessuna promessa più grande di quella di Stripe (né «neutrale», né «green», né «compensiamo», né «a impatto zero»)", ![frase, componente, piede].some((t) => /neutr|green|sostenibil|compens|impatto zero|emissioni zero|azzer[ia].{0,20}(CO|emission)/i.test(t.replace(/^\s*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, ""))));
atteso("la frase è nella pagina dei piani, dopo le note sulle condizioni e sulla riservatezza (in fondo, non tra i prezzi)", piani.indexOf("Stripe Climate, per ridurre") > piani.indexOf("Riservatezza e trattamento dei dati") && piani.indexOf("Stripe Climate, per ridurre") > piani.indexOf("</div>\n\n        <RevisioneBanda"));

console.log("--- Stili ---");
atteso("livello alto: collegamenti a sinistra e badge a destra, centrati tra loro; se non ci stanno insieme il badge va sotto", /\.omnia-footer \.omnia-footer-alto \{\s*display: flex;\s*justify-content: space-between;\s*align-items: center;\s*flex-wrap: wrap;/.test(css));
atteso("i collegamenti vanno a capo da soli (non escono dallo schermo)", /\.omnia-footer nav \{\s*display: flex;\s*flex-wrap: wrap;/.test(css));
atteso("riga legale sotto una linea sottile, più piccola e più spenta", /\.omnia-footer \.omnia-footer-basso \{[^}]*border-top: 1px solid var\(--bordo\);[^}]*font-size: 13px;/.test(css));
atteso("il badge non è mai più largo dello schermo (un contenitore di 380px sul telefono usciva dal bordo e non veniva disegnato)", /\.omnia-footer \.omnia-climate \{\s*max-width: 100%;\s*line-height: 0;\s*\}/.test(css) && !/\.omnia-footer \.omnia-climate \{[^}]*flex-shrink: 0/.test(css));
atteso("sfondo trasparente sul sito scuro (color-scheme del badge diverso da quello della pagina darebbe un riquadro bianco)", /\.omnia-climate-badge \{\s*color-scheme: light;\s*\}/.test(css));
atteso("sugli schermi stretti l'altezza sale (il testo può andare su due righe)", /@media \(max-width: 480px\) \{\s*\.omnia-climate-badge \{\s*height: 64px;\s*\}\s*\}/.test(css));
atteso("la pagina continua a dichiarare lo schema scuro (la regola sopra serve proprio per questo)", /color-scheme:\s*dark/.test(css));

console.log("");
if (fallimenti.length > 0) {
  console.error(`${fallimenti.length} controlli falliti:\n - ${fallimenti.join("\n - ")}`);
  process.exit(1);
}
console.log("Tutti i controlli sono andati a buon fine.");
