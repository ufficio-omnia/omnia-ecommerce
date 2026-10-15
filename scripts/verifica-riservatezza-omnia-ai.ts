// Autotest della pagina pubblica «Riservatezza e trattamento dei dati» di omnia-ai.it.
//
// La pagina promette cose ai clienti (dove stanno i documenti, chi li vede, nessun
// addestramento, per quanto tempo restano, nomina a responsabile): ognuna di queste
// promesse viene qui confrontata con i documenti contrattuali (condizioni v2 e Allegato A)
// e con il codice che deve mantenerla. Se una frase della pagina dice più di quanto il
// contratto o il sistema garantiscono, il test fallisce.
// Gratuito, nessun database né rete: gira nel livello 1, quindi in prebuild.
import fs from "fs";
import path from "path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { collectGaraFilePaths, percorsiSottoPrefisso, type ElencoBucket } from "../src/lib/gara-storage";
import {
  RISERVATEZZA_DESCRIZIONE,
  RISERVATEZZA_DOCUMENTI,
  RISERVATEZZA_INTRO,
  RISERVATEZZA_PERCORSO,
  RISERVATEZZA_TITOLO,
  SEZIONI_RISERVATEZZA,
} from "../src/lib/omnia-ai-riservatezza";

const fallimenti: string[] = [];
function atteso(nome: string, ok: boolean, dettaglio = "") {
  console.log(`${ok ? "ok    " : "FALLITO"} ${nome}${ok ? "" : ` — ${dettaglio}`}`);
  if (!ok) fallimenti.push(nome);
}
function uguale<T>(nome: string, ottenuto: T, previsto: T) {
  atteso(nome, JSON.stringify(ottenuto) === JSON.stringify(previsto), `ottenuto ${JSON.stringify(ottenuto)}, previsto ${JSON.stringify(previsto)}`);
}
const leggi = (relativo: string) => fs.readFileSync(path.join(__dirname, "..", relativo), "utf-8").replace(/\r\n/g, "\n");

const testoPagina = [RISERVATEZZA_INTRO, ...SEZIONI_RISERVATEZZA.flatMap((s) => [s.titolo, ...s.paragrafi])].join("\n");
const sezione = (id: string) => SEZIONI_RISERVATEZZA.find((s) => s.id === id)?.paragrafi.join(" ") ?? "";
const allegato = leggi("legal/allegato-a-nomina-responsabile-v1.md");
const condizioni = leggi("legal/condizioni-abbonamento-v2.md");

async function main() {
  console.log("--- Struttura del testo ---");
  uguale(
    "sezioni nell'ordine concordato",
    SEZIONI_RISERVATEZZA.map((s) => s.titolo),
    ["Dove stanno i tuoi documenti", "Chi può vederli", "Addestramento dei modelli", "La base di conoscenza", "I dati del personale", "Per quanto tempo restano", "Nomina a responsabile del trattamento"],
  );
  atteso("ogni sezione ha un identificativo unico e almeno un paragrafo", new Set(SEZIONI_RISERVATEZZA.map((s) => s.id)).size === SEZIONI_RISERVATEZZA.length && SEZIONI_RISERVATEZZA.every((s) => s.paragrafi.length > 0 && s.paragrafi.every((p) => p.trim().length > 20)));
  uguale("titolo della pagina", RISERVATEZZA_TITOLO, "Riservatezza e trattamento dei dati");
  uguale("percorso pubblico", RISERVATEZZA_PERCORSO, "/riservatezza");
  atteso("descrizione per i motori di ricerca di lunghezza ragionevole", RISERVATEZZA_DESCRIZIONE.length >= 70 && RISERVATEZZA_DESCRIZIONE.length <= 170, `${RISERVATEZZA_DESCRIZIONE.length} caratteri`);
  uguale("quattro documenti collegati, nell'ordine", Object.values(RISERVATEZZA_DOCUMENTI), ["Privacy policy", "Cookie policy", "Condizioni generali di abbonamento", "Allegato A, atto di nomina a responsabile del trattamento"]);

  console.log("--- Le due correzioni concordate ---");
  for (const frase of ["nemmeno in caso di errore del programma", "non dall'applicazione", "nessuna richiesta può restituire", "né estratti né conservati", "estratti né conservati", "applicate dalla base dati stessa"]) {
    atteso(`la pagina non contiene la frase troppo forte «${frase}»`, !testoPagina.includes(frase));
  }
  atteso("isolamento: «applicate anche a livello di base dati»", sezione("dove-stanno").includes("regole di isolamento applicate anche a livello di base dati"));
  atteso("la formula dell'isolamento è coerente con l'Allegato A (art. 5)", /regole di isolamento applicate a livello di base dati/.test(allegato));
  atteso("personale: nominativi, codici fiscali e matricole non finiscono «in questi dati» (non «non vengono conservati»)", /Nominativi, codici fiscali e matricole non vengono riportati in questi dati/.test(sezione("dati-del-personale")));
  atteso("personale: si dice che il documento caricato resta conservato com'è", /resta conservato così com'è, con tutto ciò che contiene/.test(sezione("dati-del-personale")));
  atteso("personale: il documento caricato è soggetto alle stesse regole di accesso (non «solo dal tuo account»)", !/solo dal tuo account/.test(sezione("dati-del-personale")));

  console.log("--- Promesse confrontate con condizioni v2 e Allegato A ---");
  const quattroCasi: [string, RegExp, RegExp][] = [
    ["assistenza tecnica", /assistenza tecnica/, /assistenza tecnica/],
    ["revisione umana", /revisione umana/, /revisione umana/],
    ["manutenzione o sicurezza", /manutenzione o sicurezza/, /manutenzione o sicurezza/],
    ["obbligo di legge", /obbligo di legge/, /(obbligo|obblighi) di legge/],
  ];
  atteso("«solo in quattro casi»", /solo in quattro casi/.test(sezione("chi-puo-vederli")));
  for (const [nome, nellaPagina, nelContratto] of quattroCasi) {
    atteso(`caso «${nome}»: nella pagina, nelle condizioni e nell'Allegato A`, nellaPagina.test(sezione("chi-puo-vederli")) && nelContratto.test(condizioni) && nelContratto.test(allegato));
  }
  const casiAllegato = allegato.match(/^[a-z]\) /gm) ?? [];
  uguale("l'Allegato A elenca esattamente quattro casi di accesso (a-d)", casiAllegato, ["a) ", "b) ", "c) ", "d) "]);
  atteso("l'accesso è registrato e l'estratto è disponibile: pagina, condizioni e Allegato A", /Ogni accesso è registrato/.test(sezione("chi-puo-vederli")) && /Ogni accesso è registrato con data, ora, operatore e motivo/.test(condizioni) && /Ogni accesso è registrato con data, ora, operatore e motivo/.test(allegato) && /estratto/.test(sezione("chi-puo-vederli")) && /estratto/.test(condizioni) && /estratto/.test(allegato));
  atteso("nessun addestramento: pagina, condizioni e Allegato", /non vengono utilizzati per addestrare modelli/.test(sezione("addestramento")) && /non sono utilizzati per l'addestramento/.test(condizioni) && /non utilizzano i contenuti trasmessi tramite interfaccia applicativa per l'addestramento/.test(allegato));
  atteso("la pagina dice che per i fornitori è una condizione contrattuale (come l'Allegato A)", /condizione contrattuale/.test(sezione("addestramento")) && /in forza delle condizioni contrattuali/.test(allegato));
  atteso("base di conoscenza: i contenuti dei clienti non entrano nemmeno in forma anonima, aggregata o rielaborata (pagina e condizioni)", /nemmeno in forma anonima, aggregata o rielaborata/.test(sezione("base-di-conoscenza")) && /nemmeno in forma anonima, aggregata o rielaborata/.test(condizioni));
  atteso("infrastruttura nell'Unione Europea: pagina e Allegato A (Supabase)", /Unione Europea/.test(sezione("dove-stanno")) && /\| Supabase \|[^\n]*\| Unione Europea \|/.test(allegato));
  atteso("collegamenti temporanei dopo verifica: pagina e Allegato A (art. 5)", /collegamenti temporanei generati dal server solo dopo aver verificato/.test(sezione("dove-stanno")) && /collegamenti temporanei generati dopo verifica dell'autorizzazione/.test(allegato));
  atteso("conservazione: trenta giorni dalla cessazione, indici semantici compresi (pagina e Allegato A art. 8)", /trenta giorni dalla cessazione/.test(sezione("conservazione")) && /comprese le copie negli indici semantici/.test(sezione("conservazione")) && /trenta giorni dalla sua cessazione/.test(allegato) && /comprese le copie negli indici semantici/.test(allegato));
  atteso("cancellazione autonoma di una gara: pagina e Allegato A (art. 8)", /Puoi cancellare una gara e i suoi documenti in qualsiasi momento/.test(sezione("conservazione")) && /anche autonomamente dall'area riservata/.test(allegato));
  const nomina = sezione("nomina-responsabile");
  atteso("nomina: art. 28 del Regolamento UE 2016/679 (pagina, condizioni, Allegato A)", /art\. 28 del Regolamento UE 2016\/679/.test(nomina) && /art\. 28 del Regolamento UE 2016\/679/.test(condizioni) && /art\. 28/.test(allegato));
  for (const [promessa, titoloArticolo] of [
    ["l'elenco completo dei sottoresponsabili", "### Art. 6 — Sottoresponsabili"],
    ["le misure di sicurezza", "### Art. 5 — Misure di sicurezza"],
    ["i tempi di notifica in caso di violazione", "### Art. 10 — Violazioni dei dati"],
    ["il diritto di verifica", "### Art. 11 — Verifiche"],
  ] as const) {
    atteso(`la pagina promette ${promessa} e l'Allegato A li contiene`, allegato.includes(titoloArticolo));
  }
  atteso("la pagina nomina davvero le quattro cose dell'Allegato", /sottoresponsabili/.test(nomina) && /misure di sicurezza/.test(nomina) && /tempi di notifica/.test(nomina) && /diritto di verifica/.test(nomina));
  atteso("il sottoresponsabile dei modelli (Anthropic) e dell'indicizzazione (Voyage AI) sono elencati nell'Allegato A", /\| Anthropic \|/.test(allegato) && /\| Voyage AI \|/.test(allegato));

  console.log("--- Promesse confrontate con il codice ---");
  const migrazioneGare = leggi("supabase/migrations/0036_gare.sql");
  atteso("il bucket «gare» è privato", /values \('gare', 'gare', false\)/.test(migrazioneGare));
  const download = leggi("src/app/actions/download.ts");
  atteso("ogni download di documenti di gara controlla la sessione e firma un collegamento di 60 secondi", (download.match(/\.from\("gare"\)\s*\.createSignedUrl\([^)]*,\s*60/g) ?? []).length === 3 && (download.match(/await richiediAccountAzione\(\)/g) ?? []).length === 3);
  const sorgentiApp = ["src/app", "src/lib", "src/components"];
  const conUrlPubblico: string[] = [];
  const visita = (dir: string) => {
    for (const voce of fs.readdirSync(path.join(__dirname, "..", dir), { withFileTypes: true })) {
      const relativo = `${dir}/${voce.name}`;
      if (voce.isDirectory()) visita(relativo);
      else if (/\.(ts|tsx)$/.test(voce.name) && /from\("gare"\)\s*\.getPublicUrl/.test(leggi(relativo))) conUrlPubblico.push(relativo);
    }
  };
  for (const d of sorgentiApp) visita(d);
  uguale("nessun indirizzo pubblico permanente per i file del bucket «gare»", conUrlPubblico, []);
  atteso("la lettura è sola in 30 giorni dalla cessazione (GIORNI_SOLA_LETTURA = 30)", /const GIORNI_SOLA_LETTURA = 30;/.test(leggi("src/lib/omnia-ai-access.ts")));
  const cron = leggi("src/app/api/cron/omnia-ai-purge-cessati/route.ts");
  atteso("a cessazione avvenuta un lavoro giornaliero cancella le gare e i loro file", /collectGaraFilePaths\(admin, gara\.id\)/.test(cron) && /from\("gare"\)\.delete\(\)/.test(cron) && /removeGaraFiles\(filePaths\)/.test(cron));
  atteso("il lavoro giornaliero è pianificato", /omnia-ai-purge-cessati/.test(leggi("vercel.json")));
  const gare = leggi("src/app/actions/gare.ts");
  atteso("il cliente cancella una gara dall'area riservata: righe e file", /collectGaraFilePaths\(supabase, garaId\)/.test(gare) && /from\("gare"\)\.delete\(\)\.eq\("id", garaId\)/.test(gare) && /await removeGaraFiles\(filePaths\)/.test(gare));
  atteso("la cancellazione di una gara è bloccata solo in sola lettura, non dopo la cessazione dei contenuti", /export async function deleteGara[\s\S]*?accessoNegatoPerAccount\(contesto, user, supabase\)/.test(gare));

  console.log("--- Cancellazione dei file di una gara (nessun file dimenticato) ---");
  type Righe = Record<string, { file_path: string | null }[]>;
  const clienteFinto = (righe: Righe, gara: { logo_cliente_path: string | null } | null) =>
    ({
      from: (tabella: string) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const q: any = {
          select: () => q,
          eq: () => q,
          not: () => q,
          maybeSingle: async () => ({ data: gara }),
          then: (ok: (v: { data: unknown }) => unknown) => ok({ data: righe[tabella] ?? [] }),
        };
        return q;
      },
    }) as unknown as SupabaseClient;
  const GARA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const bucketFinto = (contenuto: Record<string, { name: string; id: string | null }[]>, chiamate: string[] = []): ElencoBucket => ({
    list: async (cartella, { offset }) => {
      chiamate.push(`${cartella}@${offset}`);
      return { data: offset === 0 ? (contenuto[cartella] ?? []) : [], error: null };
    },
  });

  const chiamate: string[] = [];
  const raccolti = await collectGaraFilePaths(
    clienteFinto(
      {
        gara_documenti: [{ file_path: `${GARA}/1-bando.pdf` }],
        gara_messaggi: [{ file_path: `${GARA}/2-relazione.docx` }],
        gara_messaggio_allegati: [{ file_path: `${GARA}/chat-allegati/3-allegato.pdf` }],
      },
      { logo_cliente_path: `${GARA}/logo-cliente.png` },
    ),
    GARA,
    bucketFinto(
      {
        [GARA]: [
          { name: "1-bando.pdf", id: "x1" },
          { name: "logo-cliente.png", id: "x2" },
          { name: "logo-cliente.jpg", id: "x3" }, // logo sostituito con altra estensione: nessuna riga lo referenzia più
          { name: "chat-allegati", id: null }, // cartella: non è un file
        ],
        [`${GARA}/chat-allegati`]: [
          { name: "3-allegato.pdf", id: "x4" },
          { name: "9-orfano.pdf", id: "x5" }, // caricato ma con la riga non salvata
        ],
      },
      chiamate,
    ),
  );
  uguale(
    "si raccolgono righe del database, logo e file orfani sotto il prefisso, senza doppioni né cartelle",
    raccolti.sort(),
    [`${GARA}/1-bando.pdf`, `${GARA}/2-relazione.docx`, `${GARA}/chat-allegati/3-allegato.pdf`, `${GARA}/chat-allegati/9-orfano.pdf`, `${GARA}/logo-cliente.jpg`, `${GARA}/logo-cliente.png`].sort(),
  );
  const soloRighe = await collectGaraFilePaths(
    clienteFinto({ gara_messaggio_allegati: [{ file_path: `${GARA}/chat-allegati/3-allegato.pdf` }] }, { logo_cliente_path: null }),
    GARA,
    bucketFinto({}),
  );
  uguale("gli allegati della chat sono raccolti anche dalle loro righe, a bucket vuoto (prima non lo erano)", soloRighe, [`${GARA}/chat-allegati/3-allegato.pdf`]);
  const soloBucket = await collectGaraFilePaths(clienteFinto({}, { logo_cliente_path: null }), GARA, bucketFinto({ [`${GARA}/chat-allegati`]: [{ name: "9-orfano.pdf", id: "x5" }] }));
  uguale("un file senza nessuna riga si trova comunque dall'elenco del bucket", soloBucket, [`${GARA}/chat-allegati/9-orfano.pdf`]);
  uguale("si elencano la radice della gara e la cartella degli allegati", chiamate, [`${GARA}@0`, `${GARA}/chat-allegati@0`]);

  const chiamateAltrui: string[] = [];
  const altrui = await collectGaraFilePaths(clienteFinto({}, null), "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", bucketFinto({ "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb": [{ name: "segreto.pdf", id: "z" }] }, chiamateAltrui));
  uguale("una gara non visibile al chiamante (non sua): nessun file raccolto", altrui, []);
  uguale("e il bucket non viene nemmeno elencato", chiamateAltrui, []);

  const erroreElenco = await percorsiSottoPrefisso(GARA, { list: async () => ({ data: null, error: { message: "giù" } }) });
  uguale("se l'elenco del bucket fallisce non si rompe nulla (si usano le righe del database)", erroreElenco, []);
  const lungo = Array.from({ length: 1000 }, (_, i) => ({ name: `f${i}.pdf`, id: `i${i}` }));
  const paginato = await percorsiSottoPrefisso(GARA, {
    list: async (cartella, { offset }) => ({ data: cartella === GARA ? (offset === 0 ? lungo : [{ name: "ultimo.pdf", id: "u" }]) : [], error: null }),
  });
  uguale("un elenco di oltre 1000 file si legge a pagine, senza perderne", paginato.length, 1001);
  const sorgenteStorage = leggi("src/lib/gara-storage.ts");
  atteso("il giro sul prefisso parte solo se la gara è visibile al client chiamante", /if \(!gara\) return/.test(sorgenteStorage) && sorgenteStorage.indexOf("if (!gara) return") < sorgenteStorage.indexOf("percorsiSottoPrefisso(garaId, bucket)"));

  console.log("--- Pagina, collegamenti e sitemap ---");
  const pagina = leggi("src/app/site-omnia-ai/riservatezza/page.tsx");
  atteso("la pagina usa paginaMetadata con il percorso pubblico", /paginaMetadata\(\{[\s\S]*?path: RISERVATEZZA_PERCORSO/.test(pagina) && /title: `\$\{RISERVATEZZA_TITOLO\} — OMNIA AI`/.test(pagina));
  atteso("la pagina mostra tutte le sezioni dal testo di riferimento", /SEZIONI_RISERVATEZZA\.map/.test(pagina) && /RISERVATEZZA_INTRO/.test(pagina) && /<h1>\{RISERVATEZZA_TITOLO\}<\/h1>/.test(pagina));
  atteso("i link alle condizioni e all'Allegato A seguono la versione vigente (nessun numero di versione scritto a mano)", /getCurrentOmniaAiCondizioniAbbonamentoUrl\(\)/.test(pagina) && /getCurrentOmniaAiAllegatoAUrl\(\)/.test(pagina) && !/documenti-legali\/[a-z-]+\/\d/.test(pagina));
  atteso("prima della migrazione 0080 l'Allegato A compare senza collegamento, mai con un link rotto", /allegatoUrl \? \(/.test(pagina) && /: \(\s*RISERVATEZZA_DOCUMENTI\.allegato\s*\)/.test(pagina));
  atteso("privacy e cookie puntano alle pagine in vigore", /href="\/privacy"/.test(pagina) && /href="\/cookie-policy"/.test(pagina));
  atteso("link dal piè di pagina", /<Link href="\/riservatezza">Riservatezza<\/Link>/.test(leggi("src/components/omnia-ai/site-footer.tsx")));
  atteso("link dalla pagina dei piani", /href="\/riservatezza"/.test(leggi("src/app/site-omnia-ai/piani/piani-vista.tsx")));
  const sitemap = leggi("src/app/sitemap.ts");
  const voceSitemap = sitemap.match(/\{ path: "\/riservatezza", lastModified: "(\d{4}-\d{2}-\d{2})" \}/);
  atteso("nella sitemap di omnia-ai.it, con una data fissa valida", Boolean(voceSitemap) && !Number.isNaN(Date.parse(`${voceSitemap?.[1]}T00:00:00Z`)));
  atteso("la pagina non rimanda alla console", !/console\.omniaitalia\.com|CONSOLE_BASE_URL|site-console|lib\/console/.test(pagina + leggi("src/lib/omnia-ai-riservatezza.ts")));

  console.log("");
  if (fallimenti.length > 0) {
    console.error(`${fallimenti.length} controlli falliti:\n - ${fallimenti.join("\n - ")}`);
    process.exit(1);
  }
  console.log("Tutti i controlli sono andati a buon fine.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
