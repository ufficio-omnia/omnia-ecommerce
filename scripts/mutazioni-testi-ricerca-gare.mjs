// Mutazioni dei testi pubblici di «Ricerca gare» e dei testi di Opportunità (25/11/2026): ognuna altera UN punto e deve cadere sul controllo
// indicato (motore comune con tempo massimo e ripristino dal buffer). Le prime: una fonte nominata o contata in una parte pubblica.
// Uso: node scripts/mutazioni-testi-ricerca-gare.mjs
import path from "node:path";
import { fileURLToPath } from "node:url";
import { eseguiMutazioni } from "./lib/esegui-mutazioni.mjs";

const RADICE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TESTI = "src/lib/ricerca-gare-testi.ts";
const HOME = "src/app/site-omnia-ai/page.tsx";
const PAGINA = "src/app/site-omnia-ai/ricerca-gare/page.tsx";
const PIANI = "src/app/site-omnia-ai/piani/piani-vista.tsx";
const TESTATA = "src/components/omnia-ai/site-header.tsx";
const PIEDE = "src/components/omnia-ai/site-footer.tsx";
const CSS = "src/app/site-omnia-ai/omnia-ai.css";
const PREF = "src/lib/radar/notifiche-preferenze-calcoli.ts";
const AGGIUNTA = "src/app/site-omnia-ai/dashboard/omnia-ai/opportunita/aggiunta/[id]/page.tsx";

const PUBBLICHE = [
  { nome: "RG1 titolo con il numero delle fonti", file: TESTI, cerca: 'titolo: "Le gare dei tuoi servizi, da molte fonti ufficiali, in un unico posto"', con: 'titolo: "Le gare dei tuoi servizi, da quattro fonti ufficiali, in un unico posto"', richiede: "B4." },
  { nome: "RG2 home che nomina le fonti", file: TESTI, cerca: 'guida: "Bandi e avvisi da molte fonti ufficiali per', con: 'guida: "Bandi e avvisi da TED, ANAC e altre fonti ufficiali per', richiede: "B4." },
  { nome: "RG3 nota dei piani che nomina una fonte", file: TESTI, cerca: "bandi e avvisi da molte fonti ufficiali, con i filtri", con: "bandi e avvisi da ANAC e da altre fonti ufficiali, con i filtri", richiede: "B4." },
  { nome: "RG4 metadati che nominano le fonti regionali", file: TESTI, cerca: "bandi e avvisi da molte fonti ufficiali, filtri per settore", con: "bandi e avvisi da Sintel e SardegnaCAT, filtri per settore", richiede: "B4." },
  { nome: "RG5 frase delle fonti con un numero", file: TESTI, cerca: "Raccogliamo bandi e avvisi da fonti ufficiali nazionali", con: "Raccogliamo bandi e avvisi da 4 fonti ufficiali nazionali", richiede: "B4." },
  { nome: "RG6 fonte scritta a mano nella home", file: HOME, cerca: "<p className=\"omnia-guida\">{SITO_HOME_RICERCA_GARE.guida}</p>", con: "<p className=\"omnia-guida\">{SITO_HOME_RICERCA_GARE.guida} Tra le fonti: la PVL.</p>", richiede: "B4." },
  { nome: "RG7 elenco delle fonti tornato nella pagina", file: PAGINA, cerca: "<p className=\"omnia-guida\">{T.fontiTesto}</p>", con: "<p className=\"omnia-guida\">{T.fontiTesto} Oggi: TED, Gazzetta ufficiale dell&apos;Unione europea.</p>", richiede: "B4." },
  { nome: "RG8 menu senza «Ricerca gare»", file: TESTATA, cerca: '  { href: "/ricerca-gare", label: "Ricerca gare" },\n', con: "", richiede: "B5." },
  { nome: "RG9 «Ricerca gare» dopo «Piani» nel menu", file: TESTATA, cerca: '  { href: "/ricerca-gare", label: "Ricerca gare" },\n  { href: "/piani", label: "Piani" },', con: '  { href: "/piani", label: "Piani" },\n  { href: "/ricerca-gare", label: "Ricerca gare" },', richiede: "B5." },
  { nome: "RG10 piè di pagina senza «Ricerca gare»", file: PIEDE, cerca: '          <Link href="/ricerca-gare">Ricerca gare</Link>\n', con: "", richiede: "B5." },
  { nome: "RG11 voci del menu che vanno a capo", file: CSS, cerca: ".omnia-nav.omnia-principale a {\n  white-space: nowrap;\n}", con: ".omnia-nav.omnia-principale a {\n  white-space: normal;\n}", richiede: "B5." },
  { nome: "RG12 nota dei piani senza il collegamento", file: PIANI, cerca: '{NOTA_PIANI_RICERCA_GARE}{" "}\n            <Link href={PERCORSO_RICERCA_GARE}>Come funziona</Link>.', con: "{NOTA_PIANI_RICERCA_GARE}", richiede: "B2.2" },
];
const OPPORTUNITA = [
  { nome: "OP1 Notifiche promette di nuovo «documenti nuovi»", file: PREF, cerca: "Rettifiche, proroghe, cambi di scadenza e annullamenti delle gare salvate o monitorate.", con: "Rettifiche, proroghe o modifiche della scadenza e documenti nuovi delle gare salvate o monitorate.", richiede: "A1.11" },
  { nome: "OP2 gara aggiunta a mano senza la spiegazione", file: AGGIUNTA, cerca: '          <p className="omnia-opp-spiega">{TESTO_PULSANTI_SALVA}</p>\n', con: "", richiede: "A2.3" },
];

const a = eseguiMutazioni({ radice: RADICE, verifica: "scripts/verifica-testi-ricerca-gare.ts", mutazioni: PUBBLICHE });
const b = eseguiMutazioni({ radice: RADICE, verifica: "scripts/verifica-testi-opportunita.ts", mutazioni: OPPORTUNITA });
process.exit(a || b);
