// Verifica STRUTTURALE della console amministrativa e della sua separazione dai due
// siti pubblici. Non prova la logica di una pagina (lo fanno gli autotest
// verifica-console-*.ts): garantisce che la forma del progetto resti quella
// promessa, anche quando si aggiunge una pagina o un'azione tra sei mesi.
//
//   1. L'amministrazione non esiste più su app.omniaitalia.com e omnia-ai.it.
//   2. I due siti pubblici non puntano alla console (unica eccezione dichiarata: l'email
//      che avvisa l'admin di un messaggio, che porta alla scheda del cliente).
//   3. Ogni pagina, route e azione della console controlla il ruolo admin PRIMA di toccare
//      i dati — solo accesso e conferma del magic link sono aperti.
//   4. La console non ha password, non è indicizzabile e non è incorniciabile.
//   5. Ogni voce della barra laterale porta a una pagina che esiste.
//
// Gratuito, nessun database né rete: gira nel livello 1, quindi in prebuild.
import fs from "fs";
import path from "path";
import { CONSOLE_PERCORSI_CONDIVISI, CONSOLE_PERCORSI_PUBBLICI, RESERVED_PREFIXES, ZONE_PREFIX } from "../src/lib/zone";

const RADICE = path.join(__dirname, "..");
const fallimenti: string[] = [];
function atteso(nome: string, ok: boolean, dettaglio = "") {
  console.log(`${ok ? "ok    " : "FALLITO"} ${nome}${ok ? "" : ` — ${dettaglio}`}`);
  if (!ok) fallimenti.push(nome);
}
function uguale<T>(nome: string, ottenuto: T, previsto: T) {
  atteso(nome, JSON.stringify(ottenuto) === JSON.stringify(previsto), `ottenuto ${JSON.stringify(ottenuto)}, previsto ${JSON.stringify(previsto)}`);
}
const assoluto = (relativo: string) => path.join(RADICE, relativo);
const esiste = (relativo: string) => fs.existsSync(assoluto(relativo));
const leggi = (relativo: string) => fs.readFileSync(assoluto(relativo), "utf-8").replace(/\r\n/g, "\n");

// Tutti i file sotto una cartella, con percorsi relativi alla radice e barre «/».
function elenca(cartella: string, estensioni = [".ts", ".tsx"]): string[] {
  if (!esiste(cartella)) return [];
  const risultato: string[] = [];
  const visita = (relativa: string) => {
    for (const voce of fs.readdirSync(assoluto(relativa), { withFileTypes: true })) {
      const figlia = `${relativa}/${voce.name}`;
      if (voce.isDirectory()) visita(figlia);
      else if (estensioni.some((e) => voce.name.endsWith(e))) risultato.push(figlia);
    }
  };
  visita(cartella);
  return risultato.sort();
}
function cartelleChiamate(cartella: string, nome: string): string[] {
  if (!esiste(cartella)) return [];
  const trovate: string[] = [];
  const visita = (relativa: string) => {
    for (const voce of fs.readdirSync(assoluto(relativa), { withFileTypes: true })) {
      if (!voce.isDirectory()) continue;
      const figlia = `${relativa}/${voce.name}`;
      if (voce.name === nome) trovate.push(figlia);
      visita(figlia);
    }
  };
  visita(cartella);
  return trovate;
}

console.log("--- 1. L'amministrazione vive solo sulla console ---");
uguale("nessuna cartella «admin» sotto l'e-commerce", cartelleChiamate("src/app/(ecommerce)", "admin"), []);
uguale("nessuna cartella «admin» sotto omnia-ai.it", cartelleChiamate("src/app/site-omnia-ai", "admin"), []);
uguale("nessuna cartella «admin» altrove in src/app (la console usa nomi italiani)", cartelleChiamate("src/app", "admin"), []);
for (const rimosso of ["src/lib/require-admin.ts", "src/app/actions/admin.ts", "src/app/actions/admin-download.ts", "src/app/actions/products.ts", "src/app/actions/product-previews.ts", "src/app/actions/bank-details.ts", "src/app/actions/knowledge-base.ts", "src/app/actions/subscriptions.ts"]) {
  atteso(`rimosso il vecchio ${rimosso.replace("src/", "")}`, !esiste(rimosso));
}
{
  const tutti = [...elenca("src")].filter((f) => !f.startsWith("src/app/site-console/"));
  const conAdmin = tutti.filter((f) => /["'`]\/admin(["'`/?]|$)|requireAdmin|require-admin/.test(leggi(f)));
  uguale("nessun riferimento a una rotta «/admin» né a requireAdmin nel resto del codice", conAdmin, []);
}
{
  const intestazioni = leggi("src/components/site-header.tsx") + leggi("src/components/header-nav.tsx");
  atteso("nel menu dei siti pubblici non c'è più la voce «Admin» né la lettura del ruolo", !/isAdmin|label: "Admin"|\.select\("role"\)/.test(intestazioni));
  atteso("la protezione per sessione del sito pubblico riguarda solo l'area riservata, non /admin", /startsWith\("\/dashboard"\)/.test(leggi("src/lib/supabase/middleware.ts")) && !/startsWith\("\/admin"\)/.test(leggi("src/lib/supabase/middleware.ts")));
  atteso("robots.txt di omnia-ai.it non cita più /admin", !/\/admin/.test(leggi("src/app/robots.ts")));
}

console.log("--- 2. I siti pubblici non puntano alla console ---");
{
  const PUBBLICI = [...elenca("src/app/(ecommerce)"), ...elenca("src/app/site-omnia-ai"), ...elenca("src/components"), ...elenca("src/app/actions"), ...elenca("src/app/api"), ...elenca("src/app/auth"), ...elenca("src/lib").filter((f) => !f.startsWith("src/lib/console/"))];
  const RIFERIMENTO = /console\.omniaitalia\.com|CONSOLE_BASE_URL|site-console|lib\/console|["'`]\/console\//;
  // eccezioni dichiarate: l'infrastruttura di zona (che DEVE conoscere la console) e l'email
  // all'admin con il collegamento alla scheda del cliente
  const AMMESSI = new Set(["src/lib/zone.ts", "src/lib/supabase/middleware.ts", "src/app/actions/messages.ts"]);
  const colpevoli = PUBBLICI.filter((f) => !AMMESSI.has(f) && RIFERIMENTO.test(leggi(f)));
  uguale("nessun file dei due siti pubblici cita la console (a parte l'infrastruttura di zona e l'email all'admin)", colpevoli, []);

  const messaggi = leggi("src/app/actions/messages.ts");
  atteso("l'email all'admin per un messaggio punta alla console, neutralizza il testo del cliente e non cita più /admin", /\$\{CONSOLE_BASE_URL\}\/utenti\/\$\{user\.id\}/.test(messaggi) && /testoPerEmail\(body\)/.test(messaggi) && /escapeHtml\(user\.email/.test(messaggi) && !/\/admin/.test(messaggi));
  atteso("la risposta dell'admin non esiste più nell'e-commerce (si risponde dalla console)", !/sendMessageAsAdmin/.test(messaggi));
  const dashboard = leggi("src/app/(ecommerce)/dashboard/page.tsx");
  atteso("l'area riservata del cliente non ha collegamenti alla console", !/console/i.test(dashboard.replace(/console\.(log|error|warn)/g, "")));
}
{
  const proxy = leggi("src/proxy.ts");
  atteso("il proxy blocca sul dominio della console le route condivise (callback di accesso e webhook Stripe)", /zone === "console" && isZoneRewriteExempt && !CONSOLE_PERCORSI_CONDIVISI\.includes/.test(proxy));
  atteso("il proxy impedisce di raggiungere /site-console e /site-omnia-ai digitandoli sull'e-commerce", /zone === "ecommerce" &&\s*RESERVED_PREFIXES\.some/.test(proxy));
  uguale("i prefissi riservati comprendono la console", RESERVED_PREFIXES.includes(ZONE_PREFIX.console), true);
  uguale("sulla console, dei percorsi condivisi valgono solo robots.txt e sitemap.xml", CONSOLE_PERCORSI_CONDIVISI, ["/robots.txt", "/sitemap.xml"]);
  uguale("percorsi della console aperti senza sessione: solo accesso, conferma e i file per i crawler", CONSOLE_PERCORSI_PUBBLICI, ["/login", "/auth/conferma", "/robots.txt", "/sitemap.xml"]);
}

console.log("--- 3. Ogni pagina, route e azione controlla il ruolo admin ---");
{
  const radice = "src/app/site-console";
  const APERTI = new Set([`${radice}/login/page.tsx`, `${radice}/auth/conferma/page.tsx`]);
  // Prima della guardia una pagina può solo leggere i parametri dell'indirizzo: qualunque
  // altro «await» (una lettura di dati) prima di essa sarebbe una lettura senza controllo.
  const operazioniPrimaDellaGuardia = (testo: string): string[] => {
    const guardia = testo.indexOf("await richiediAdminPagina()");
    if (guardia < 0) return ["manca richiediAdminPagina"];
    return (testo.slice(0, guardia).match(/\bawait\b[^;\n]*/g) ?? []).filter((a) => !/^await (params|searchParams)\b/.test(a));
  };

  const pagine = elenca(radice).filter((f) => /\/(page\.tsx|route\.ts)$/.test(f) && !APERTI.has(f));
  atteso(`trovate ${pagine.length} pagine e route riservate (almeno quattordici)`, pagine.length >= 14, String(pagine.length));
  for (const f of pagine) {
    const testo = leggi(f);
    uguale(`${f.replace(`${radice}/(app)/`, "")}: richiediAdminPagina è la prima operazione asincrona`, operazioniPrimaDellaGuardia(testo), []);
  }
  atteso("il guscio delle pagine riservate controlla l'admin anche nel layout (oltre che in ogni pagina)", /await richiediAdminPagina\(\)/.test(leggi(`${radice}/(app)/layout.tsx`)));

  const azioni = elenca(`${radice}/azioni`).filter((f) => !f.endsWith("/accesso.ts"));
  atteso(`trovati ${azioni.length} file di azioni riservate (almeno sette)`, azioni.length >= 7, String(azioni.length));
  let funzioniTotali = 0;
  for (const f of azioni) {
    const testo = leggi(f);
    atteso(`${f.split("/").pop()}: «use server» come prima riga`, testo.startsWith('"use server"'));
    const funzioni = testo.split(/^export async function /m).slice(1);
    funzioniTotali += funzioni.length;
    // prima della guardia non si può né leggere il modulo né toccare il database
    const senzaGuardia = funzioni.filter((corpo) => {
      const guardia = corpo.indexOf("await richiediAdminAzione()");
      return guardia < 0 || /createAdminClient\(\)|formData\.get|\bawait\b/.test(corpo.slice(0, guardia));
    });
    uguale(`${f.split("/").pop()}: ogni azione esportata comincia da richiediAdminAzione`, senzaGuardia.map((c) => c.split("(")[0]), []);
  }
  atteso(`in tutto ${funzioniTotali} azioni riservate (almeno venticinque), tutte sotto la stessa guardia`, funzioniTotali >= 25, String(funzioniTotali));

  // accesso.ts: richiede il link a chiunque (risposta uniforme), conferma e esci; nessuna lettura di dati
  const accesso = leggi(`${radice}/azioni/accesso.ts`);
  atteso("accesso.ts espone solo richiesta del link, conferma e uscita", JSON.stringify((accesso.match(/^export async function (\w+)/gm) ?? []).map((m) => m.replace("export async function ", ""))) === JSON.stringify(["richiediLinkAccesso", "confermaAccesso", "esci"]));
}
{
  const accesso = leggi("src/lib/console/accesso.ts");
  atteso("il ruolo si rilegge dal database con la service role (non si fida del cookie né della sessione del browser)", /createAdminClient\(\)/.test(accesso) && /\.eq\("id", user\.id\)/.test(accesso) && /role/.test(accesso));
  atteso("la sessione della console dura al massimo 12 ore", /12\s*\*\s*60\s*\*\s*60/.test(accesso) || /DURATA_MASSIMA/.test(accesso));
}

console.log("--- 4. Nessuna password, nessuna indicizzazione, nessun incorniciamento ---");
{
  const tutti = elenca("src/app/site-console");
  const conPassword = tutti.filter((f) => /type="password"|signInWithPassword|updateUser\(\{\s*password/.test(leggi(f)));
  uguale("nessun campo password né accesso con password nella console", conPassword, []);
  const clientBrowser = tutti.filter((f) => /createBrowserClient|@supabase\/ssr/.test(leggi(f)));
  uguale("la console non usa il client Supabase del browser", clientBrowser, []);
  const login = leggi("src/app/site-console/login/login-form.tsx");
  atteso("il modulo di accesso chiede solo l'email", /type="email"/.test(login) && !/password/i.test(login));
}
{
  const next = leggi("next.config.ts");
  atteso("X-Robots-Tag noindex per ogni risposta del solo host della console", /has: \[\{ type: "host", value: "console\.omniaitalia\.com" \}\]/.test(next) && /X-Robots-Tag", value: "noindex, nofollow, noarchive, nosnippet"/.test(next));
  atteso("la console non si incornicia, non cede il Referer e non permette lo sniffing", /X-Frame-Options", value: "DENY"/.test(next) && /Referrer-Policy", value: "no-referrer"/.test(next) && /X-Content-Type-Options", value: "nosniff"/.test(next));
  atteso("metadati noindex anche nel layout della console", /robots: \{ index: false, follow: false/.test(leggi("src/app/site-console/layout.tsx")));
  const robots = leggi("src/app/robots.ts");
  atteso("robots.txt: tutto vietato per la console e per ogni host non riconosciuto", /rules: \{ userAgent: "\*", disallow: "\/" \}/.test(robots));
}

console.log("--- 5. La barra laterale porta a pagine che esistono ---");
{
  const nav = leggi("src/app/site-console/_componenti/navigazione.ts");
  const voci = [...nav.matchAll(/href: "([^"]+)", etichetta: "([^"]+)", pronto: (true|false)/g)].map((m) => ({ href: m[1], etichetta: m[2], pronto: m[3] === "true" }));
  atteso(`${voci.length} voci nella barra (almeno dodici)`, voci.length >= 12, String(voci.length));
  uguale("nessuna voce «presto»: tutte le sezioni previste esistono", voci.filter((v) => !v.pronto).map((v) => v.etichetta), []);
  const mancanti = voci.filter((v) => !esiste(v.href === "/" ? "src/app/site-console/(app)/page.tsx" : `src/app/site-console/(app)${v.href}/page.tsx`));
  uguale("ogni voce ha la sua pagina", mancanti.map((v) => v.href), []);
}

if (fallimenti.length > 0) {
  console.error(`\n${fallimenti.length} controllo/i fallito/i:\n- ${fallimenti.join("\n- ")}`);
  process.exit(1);
}
console.log("\nVerifica della console: tutti i casi ok.");
