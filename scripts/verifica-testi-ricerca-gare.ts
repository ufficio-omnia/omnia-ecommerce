// Verifica della pagina pubblica «Ricerca gare» di omnia-ai.it, del rimando dalla home e della riga nei piani (25/11/2026, decisioni
// dell'utente: nome «Ricerca gare», compresa in tutti e tre i piani). Ogni frase promette solo ciò che c'è nell'area riservata: qui si
// confrontano i testi (src/lib/ricerca-gare-testi.ts) con il codice di «Opportunità», del motore delle email e delle fonti. Regole del sito:
// H1 senza «OMNIA AI», paginaMetadata, voce nella sitemap, pagina servita nella zona omnia-ai senza accesso. Nessuna rete, nessun database.
// Uso: npx tsx scripts/verifica-testi-ricerca-gare.ts → codice 0 se tutto passa.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const RADICE = path.resolve(__dirname, "..");
const richiedi = createRequire(path.join(RADICE, "package.json"));
const src = (rel: string) => path.join(RADICE, "src", ...rel.split("/"));
const leggi = (rel: string) => fs.readFileSync(path.join(RADICE, rel), "utf8");

let ok = 0;
const falliti: string[] = [];
function controlla(nome: string, condizione: boolean, dettaglio?: unknown): void {
  if (condizione) ok++;
  else falliti.push(`${nome}${dettaglio === undefined ? "" : ` → ${JSON.stringify(dettaglio).slice(0, 500)}`}`);
}

const T = richiedi(src("lib/ricerca-gare-testi.ts")) as typeof import("../src/lib/ricerca-gare-testi");
const { SITO_RICERCA_GARE: P, SITO_HOME_RICERCA_GARE: H, RIGA_PIANI_RICERCA_GARE: R, PERCORSO_RICERCA_GARE } = T;
const { SETTORI_RADAR } = richiedi(src("lib/radar/settori.ts")) as typeof import("../src/lib/radar/settori");
const { NOME_FONTE_ESTESO } = richiedi(src("lib/radar/fonti-gara-calcoli.ts")) as { NOME_FONTE_ESTESO: Record<string, string> };
const { CATEGORIE_TIPO } = richiedi(src("lib/radar/tipo-gara-calcoli.ts")) as { CATEGORIE_TIPO: readonly { id: string; etichetta: string }[] };
const { GIORNI_PROMEMORIA } = richiedi(src("lib/radar/notifiche/tipi.ts")) as { GIORNI_PROMEMORIA: Record<string, number> };
const { chiHaSalvato } = richiedi(src("lib/radar/salvate-calcoli.ts")) as { chiHaSalvato: (a: string, b: string, c: string) => string | null };
const { modoModifica } = richiedi(src("lib/radar/notifiche-preferenze-calcoli.ts")) as { modoModifica: (a: unknown, b: unknown, c: boolean) => string };
const { ZONE_PREFIX, ZONE_REWRITE_EXEMPT_PATHS } = richiedi(src("lib/zone.ts")) as { ZONE_PREFIX: Record<string, string>; ZONE_REWRITE_EXEMPT_PATHS: string[] };

const tuttoIlTesto = [P.titolo, P.sotto, ...P.funzioni.flatMap((f) => [f.titolo, f.testo]), P.fontiTesto, ...P.settori, ...P.limiti.flatMap((l) => [l.titolo, l.testo]), P.chiusuraTitolo, P.chiusuraTesto].join("\n");
const funzione = (inizio: string) => P.funzioni.find((f) => f.titolo.startsWith(inizio))?.testo ?? "";
const OPP = "src/app/site-omnia-ai/dashboard/omnia-ai/opportunita";

// ═════ regole del sito ═════
const pagina = leggi("src/app/site-omnia-ai/ricerca-gare/page.tsx");
controlla(
  "B1.1 pagina /ricerca-gare: paginaMetadata con il suo percorso, un solo H1 senza «OMNIA AI», stile di «Come funziona» (PageShell, hero e corpo della pagina)",
  PERCORSO_RICERCA_GARE === "/ricerca-gare" &&
    /export const metadata: Metadata = paginaMetadata\(\{[\s\S]*description: DESCRIZIONE_RICERCA_GARE,[\s\S]*path: PERCORSO_RICERCA_GARE,/.test(pagina) &&
    (pagina.match(/<h1>/g) ?? []).length === 1 &&
    /<h1>\{T\.titolo\}<\/h1>/.test(pagina) &&
    !/OMNIA AI/i.test(P.titolo) &&
    /<PageShell>/.test(pagina) &&
    /omnia-pagina-hero/.test(pagina) &&
    /omnia-pagina-corpo/.test(pagina),
);
const sitemap = leggi("src/app/sitemap.ts");
const rotte = sitemap.slice(sitemap.indexOf("const OMNIA_AI_ROUTES"), sitemap.indexOf("];", sitemap.indexOf("const OMNIA_AI_ROUTES")));
controlla("B1.2 voce in OMNIA_AI_ROUTES (sitemap), una sola", (rotte.match(/path: "\/ricerca-gare"/g) ?? []).length === 1);
const middleware = leggi("src/lib/supabase/middleware.ts");
controlla(
  "B1.3 servita nella zona omnia-ai: la cartella è sotto il prefisso della zona, il percorso non è tra quelli esclusi dalla riscrittura e l'accesso è chiesto solo sotto /dashboard",
  ZONE_PREFIX["omnia-ai"] === "/site-omnia-ai" &&
    fs.existsSync(src("app/site-omnia-ai/ricerca-gare/page.tsx")) &&
    !ZONE_REWRITE_EXEMPT_PATHS.includes(PERCORSO_RICERCA_GARE) &&
    /: request\.nextUrl\.pathname\.startsWith\("\/dashboard"\);/.test(middleware),
);
controlla(
  "B1.4 chiamate all'azione verso Piani e Demo",
  /<Link className="omnia-btn omnia-btn-p" href="\/piani">\s*Vedi i piani\s*<\/Link>/.test(pagina) && /<Link className="omnia-btn omnia-btn-s" href="\/demo">\s*Richiedi la demo\s*<\/Link>/.test(pagina),
);

// ═════ le frasi dicono ciò che c'è ═════
controlla("B1.5 settori: esattamente i 6 di SETTORI_RADAR, nello stesso ordine", JSON.stringify(P.settori) === JSON.stringify(SETTORI_RADAR.map((s) => s.nome)) && P.settori.length === 6);
const vercel = JSON.parse(leggi("vercel.json")) as { crons: { path: string; schedule: string }[] };
const giro = (f: string) => vercel.crons.find((c) => c.path === `/api/cron/radar-${f}`)?.schedule.split(" ") ?? [];
const fontiNomi = ["ted", "pvl", "sintel", "sardegnacat"];
controlla(
  "B1.6 fonti senza nomi né numero (decisione dell'utente del 25/11), con una frase generica VERA: fonti europee (TED), nazionali (ANAC) e regionali (Sintel, SardegnaCAT), ognuna letta più volte al giorno",
  P.fontiTesto === "Raccogliamo bandi e avvisi da fonti ufficiali nazionali, europee e regionali, aggiornate più volte al giorno; le fonti crescono nel tempo." &&
    !("fonti" in P) &&
    fontiNomi.every((f) => !!NOME_FONTE_ESTESO[f]) &&
    fontiNomi.every((f) => (giro(f)[1] ?? "").split(",").length > 1),
  fontiNomi.map((f) => giro(f).join(" ")),
);
const cerca = leggi(`${OPP}/cerca/page.tsx`);
const ricerca = funzione("Cerchi come lavori");
controlla(
  "B1.7 ricerca libera e filtri come in «Cerca»: oggetto, ente, codice fiscale dell'ente, CIG; settore, tipo, regione, importo da/a, scadenza, pubblicazione, procedura; aperte o storico; i quattro ordinamenti",
  /placeholder="Cerca per oggetto, ente, codice fiscale dell'ente o CIG"/.test(cerca) &&
    ricerca.startsWith("Per oggetto, ente, codice fiscale dell'ente o CIG.") &&
    ["settore", "tipo", "regione", "min", "max", "scadenza", "pubblicata", "procedura", "stato"].every((n) => cerca.includes(`name="${n}"`)) &&
    /<option value="aperte">Solo aperte<\/option>/.test(cerca) &&
    /<option value="storico">/.test(cerca) &&
    /const ORDINAMENTI_ETICHETTE = \{ rilevanza: "Rilevanza", recenti: "Più recenti", scadenza: "Scadenza più vicina", importo: "Importo più alto" \} as const;/.test(cerca) &&
    ricerca.includes("ordini per rilevanza, più recenti, scadenza più vicina o importo più alto"),
);
const tipi = funzione("Bandi, candidature");
controlla(
  "B1.8 tipi di avviso come in «Cerca» (CATEGORIE_TIPO): bandi, candidature (manifestazioni di interesse, indagini di mercato, avvisi di preinformazione), iscrizioni (elenchi, sistemi di qualificazione, SDA)",
  JSON.stringify(CATEGORIE_TIPO.map((c) => c.id)) === JSON.stringify(["bandi", "candidature", "iscrizioni"]) &&
    CATEGORIE_TIPO[1].etichetta.includes("manifestazioni di interesse, indagini di mercato, avvisi di preinformazione") &&
    CATEGORIE_TIPO[2].etichetta.includes("elenchi, sistemi di qualificazione, SDA") &&
    tipi.includes("le candidature (manifestazioni di interesse, indagini di mercato, avvisi di preinformazione)") &&
    tipi.includes("iscrizioni a elenchi, sistemi di qualificazione e SDA"),
);
const perTe = leggi(`${OPP}/per-te/page.tsx`);
const profilo = leggi(`${OPP}/profilo/page.tsx`);
controlla(
  "B1.9 «Per te»: profilo con settori, regioni e importo; ogni gara dice perché compare, da quale fonte viene e quando è stata aggiornata",
  /Ogni gara dice perché compare, da quale fonte viene e quando è stata aggiornata/.test(perTe) &&
    ["settori:", "regioni:", "importoMin:", "importoMax:"].every((c) => profilo.includes(c)) &&
    funzione("«Per te»").includes("per ognuna dice perché compare, da quale fonte viene e quando è stata aggiornata"),
);
const monitorate = leggi(`${OPP}/monitorate/page.tsx`);
controlla(
  "B1.10 salvate e monitorate: elenco per scadenza con le novità (rettifiche, proroghe, annullamenti, esiti) finché non si apre la scheda",
  /\{ id: "settimana", titolo: "Scadono entro 7 giorni" \}/.test(monitorate) &&
    ['n.tipo === "annullamento"', 'n.tipo === "esito"', 'n.tipo === "proroga"', "Rettifica del"].every((x) => monitorate.includes(x)) &&
    /Le novità rilevate nelle fonti compaiono qui finché non apri la scheda\./.test(monitorate) &&
    funzione("Salvi e monitori").includes("(rettifiche, proroghe, annullamenti, esiti) finché non apri la scheda"),
);
const avvisi = funzione("Avvisi email");
controlla(
  "B1.11 avvisi email: promemoria 10, 5 e 1 giorno; modifiche; riepilogo del profilo; il titolare sceglie per ogni persona (modifica completa), mai «documenti»",
  JSON.stringify(Object.values(GIORNI_PROMEMORIA).sort((a, b) => b - a)) === "[10,5,1]" &&
    avvisi.startsWith("Promemoria a 10, 5 e 1 giorno dalla scadenza") &&
    modoModifica({ userId: "t", ruolo: "titolare" }, { userId: "altro" }, true) === "completa" &&
    !/document/i.test(avvisi),
);
const azioni = leggi("src/app/actions/radar.ts");
controlla(
  "B1.12 gara aggiunta con il CIG: si cerca il CIG nell'archivio, altrimenti nasce una gara riservata dell'impresa",
  /\.from\("radar_lotti"\)\.select\("procedura_id"\)\.eq\("cig", v\.cig\)/.test(azioni) && /\.from\("omnia_ai_radar_gare_aggiunte"\)/.test(azioni) && /resta riservata alla tua impresa e si collega da sola quando il CIG compare/.test(funzione("Una gara che non trovi")),
);
controlla(
  "B1.13 Ufficio Gare: nell'elenco si vede chi ha salvato (ruolo, mai nome o email)",
  chiHaSalvato("impresa", "impresa", "membro") === "salvata dal titolare" && chiHaSalvato("membro", "impresa", "impresa") === "salvata dall'Ufficio Gare",
);
controlla(
  "B1.14 onestà: servizio informativo con verifica dei documenti ufficiali; la classificazione non verifica i requisiti; copertura limitata a fonti e settori elencati",
  /verifica sempre i documenti ufficiali/.test(tuttoIlTesto) && /non dice se la tua impresa ha i requisiti/.test(tuttoIlTesto) && /può non comparire/.test(tuttoIlTesto),
);

// ═════ home e piani ═════
const home = leggi("src/app/site-omnia-ai/page.tsx");
controlla(
  "B2.1 home: sezione «Ricerca gare» con il collegamento alla pagina; i punti dicono cose vere (ricerca, «Per te», promemoria 10/5/1, Ufficio Gare)",
  /<section className="omnia-section" id="ricerca-gare"/.test(home) &&
    /href=\{PERCORSO_RICERCA_GARE\}/.test(home) &&
    H.punti.length === 4 &&
    H.punti[0].startsWith("Ricerca per oggetto, ente, codice fiscale o CIG") &&
    H.punti[2] === "Promemoria email a 10, 5 e 1 giorno dalla scadenza" &&
    /^Bandi e avvisi da molte fonti ufficiali per i servizi di facility management/.test(H.guida),
);
const piani = leggi("src/app/site-omnia-ai/piani/piani-vista.tsx");
controlla(
  "B2.2 piani: riga «Ricerca gare» compresa in Starter, Professional ed Enterprise, con il rimando alla pagina",
  R.voce === "Ricerca gare" &&
    JSON.stringify(R.valori) === JSON.stringify({ starter: "Compresa", professional: "Compresa", enterprise: "Compresa" }) &&
    /\{ voce: RIGA_PIANI_RICERCA_GARE\.voce, valori: \{ \.\.\.RIGA_PIANI_RICERCA_GARE\.valori \} \},/.test(piani) &&
    /\{NOTA_PIANI_RICERCA_GARE\}\{" "\}\s*<Link href=\{PERCORSO_RICERCA_GARE\}>Come funziona<\/Link>/.test(piani),
);

// ═════ fonti MAI nominate né contate nelle parti pubbliche (decisione dell'utente del 25/11: le fonti crescono e cambiano) ═════
// tutte le pagine pubbliche di omnia-ai.it (fuori dall'area riservata), i componenti pubblici e i moduli di testi che usano; senza commenti
const senzaCommenti = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'])\/\/[^\n]*/g, "$1");
const pubblici: string[] = [];
const raccogli = (dir: string) => {
  for (const v of fs.readdirSync(path.join(RADICE, dir), { withFileTypes: true })) {
    const rel = `${dir}/${v.name}`;
    if (v.isDirectory()) {
      if (v.name !== "dashboard") raccogli(rel);
    } else if (/\.(ts|tsx)$/.test(v.name)) pubblici.push(rel);
  }
};
raccogli("src/app/site-omnia-ai");
for (const v of fs.readdirSync(src("components/omnia-ai"), { withFileTypes: true })) if (v.isFile() && /\.(ts|tsx)$/.test(v.name)) pubblici.push(`src/components/omnia-ai/${v.name}`);
pubblici.push("src/lib/ricerca-gare-testi.ts", "src/lib/piano-lavoro-testi.ts", "src/lib/omnia-ai-plans.ts", "src/lib/omnia-ai-seo.ts", "src/app/sitemap.ts");
const NOMI_FONTI = [/\b(TED|ANAC|PVL)\b/, /sintel|sardegna\s*cat|gazzetta ufficiale|pubblicità a valore legale|e-procurement/i];
const NUMERO_FONTI = /\b(una|due|tre|quattro|cinque|sei|sette|otto|nove|dieci|\d+)\s+fonti\b/i;
const trovate = pubblici.flatMap((rel) => {
  const codice = senzaCommenti(leggi(rel));
  return [...NOMI_FONTI, NUMERO_FONTI].map((re) => codice.match(re)).filter((m): m is RegExpMatchArray => !!m).map((m) => `${rel}: «${m[0]}»`);
});
const testiPubblici = [tuttoIlTesto, P.sotto, H.titolo, H.guida, ...H.punti, T.DESCRIZIONE_RICERCA_GARE, T.NOTA_PIANI_RICERCA_GARE].join("\n");
controlla(
  "B4. nessuna pagina pubblica (ricerca-gare, home, piani, metadati, menu, piè di pagina, testi) nomina una fonte (TED, ANAC, PVL, Sintel, SardegnaCAT…) o un numero di fonti",
  pubblici.length > 20 &&
    pubblici.includes("src/app/site-omnia-ai/ricerca-gare/page.tsx") &&
    pubblici.includes("src/app/site-omnia-ai/page.tsx") &&
    pubblici.includes("src/app/site-omnia-ai/piani/piani-vista.tsx") &&
    trovate.length === 0 &&
    ![...NOMI_FONTI, NUMERO_FONTI].some((re) => re.test(testiPubblici)) &&
    /molte fonti ufficiali/.test(P.titolo) &&
    /molte fonti ufficiali/.test(T.DESCRIZIONE_RICERCA_GARE) &&
    /molte fonti ufficiali/.test(T.NOTA_PIANI_RICERCA_GARE),
  trovate.slice(0, 5),
);

// ═════ menu in alto e piè di pagina ═════
const testata = leggi("src/components/omnia-ai/site-header.tsx");
const piede = leggi("src/components/omnia-ai/site-footer.tsx");
const css = leggi("src/app/site-omnia-ai/omnia-ai.css");
controlla(
  "B5. «Ricerca gare» nel menu in alto (computer e menu mobile leggono le stesse VOCI) e nel piè di pagina, subito dopo «Come funziona»; le voci del menu non vanno a capo e tra 901 e 1100 px il menu si stringe",
  /\{ href: "\/come-funziona", label: "Come funziona" \},\n\s*\{ href: "\/ricerca-gare", label: "Ricerca gare" \},\n\s*\{ href: "\/piani", label: "Piani" \},/.test(testata) &&
    T.VOCE_MENU_RICERCA_GARE.href === PERCORSO_RICERCA_GARE &&
    T.VOCE_MENU_RICERCA_GARE.label === "Ricerca gare" &&
    /<Link href="\/come-funziona">Come funziona<\/Link>\n\s*<Link href="\/ricerca-gare">Ricerca gare<\/Link>\n\s*<Link href="\/piani">Piani<\/Link>/.test(piede) &&
    /\.omnia-nav\.omnia-principale a \{\s*white-space: nowrap;\s*\}/.test(css) &&
    /@media \(min-width: 901px\) and \(max-width: 1100px\) \{[\s\S]*?\.omnia-nav\.omnia-principale \{\s*gap: 16px;/.test(css),
);

console.log(`Verifica della pagina «Ricerca gare», della home e dei piani (testi confrontati con il codice): ${ok} ok, ${falliti.length} falliti`);
for (const f of falliti) console.log(`FALLITO ${f}`);
process.exit(falliti.length ? 1 : 0);
