import { createHash } from "crypto";
import { emailClientePianoLavoroAcquistato } from "@/lib/omnia-ai-email-piano-lavoro-calcoli";
import { PIANI } from "@/lib/omnia-ai-plans";
import { AVVERTENZE_FISSE, LEGENDA_FILE } from "@/lib/piano-lavoro-excel";
import { MESSAGGI_PIANO } from "@/lib/piano-lavoro-gara-calcoli";
import {
  CLAUSOLE_PIANO_LAVORO,
  CLAUSOLE_SPECIFICHE_PIANO_LAVORO,
  PREZZO_PIANO_LAVORO,
  VERSIONE_CONDIZIONI_PIANO_LAVORO,
  testoCanonicoCondizioniPianoLavoro,
} from "@/lib/piano-lavoro-acquisto-calcoli";
import { ETICHETTA_POLITICA_PROVA, POLITICHE_PROVA, SURPLUS_PIANO_LAVORO_PREDEFINITO } from "@/lib/piano-lavoro-offerta-calcoli";
import {
  ACQUISTO_SINGOLO_DETTAGLIO,
  APPROVAZIONE_LEGALE_PIANO_LAVORO,
  BANDA_PIANO_LAVORO,
  CONDIZIONI_INTRO,
  FORNITORE_PIANO_LAVORO,
  NOTA_FONTE_DIRITTO,
  OPZIONE_ABBONAMENTO_DESCRIZIONE,
  PERCORSO_CONDIZIONI_PIANO_LAVORO,
  RIQUADRO_PIANO_PARTI,
  rigaPianoLavoroPerPiano,
  SITO_COME_FUNZIONA_PIANO_LAVORO,
  SITO_FAQ_PIANO_LAVORO,
  SITO_HOME_PIANO_LAVORO,
  testoAccettazioneCompleta,
  testoApprovazioneSpecifica,
} from "@/lib/piano-lavoro-testi";

// Il Word per il legale: tutti i testi del piano di lavoro che il cliente accetta o legge, presi dalle STESSE fonti che usa l'applicazione
// (clausole, avvertenze del file Excel, testi dell'interfaccia e del sito, email), così il documento non può dire cose diverse dal prodotto.
// Questo modulo costruisce il contenuto (puro, provato da scripts/verifica-piano-lavoro-testi-omnia-ai.ts); scripts/genera-testi-legali-piano-lavoro.ts
// lo scrive in Word.
//
// Testi approvati dal legale il 6 novembre 2026 (clausole versione 1): questo documento ne è la copia completa.

export type Blocco =
  | { t: "p"; testo: string }
  | { t: "elenco"; voci: string[] }
  | { t: "numerato"; voci: string[] }
  | { t: "clausola"; titolo: string; testo: string; nota?: string }
  | { t: "tabella"; intestazioni: string[]; righe: string[][] }
  // un punto da decidere o da verificare: evidenziato nel documento
  | { t: "domanda"; testo: string }
  // un punto già deciso (con la data): evidenziato in verde
  | { t: "deciso"; testo: string };

export type SezioneDossier = { titolo: string; blocchi: Blocco[] };
export type Dossier = { titolo: string; sottotitolo: string; sezioni: SezioneDossier[] };

// L'HTML di una email in testo semplice (per mostrarla al legale com'è, senza grafica).
export function htmlInTesto(html: string): string {
  return html
    .replace(/<a\s[^>]*href="([^"]+)"[^>]*>([^<]*)<\/a>/gi, "$2 ($1)")
    .replace(/<(br|\/p|\/tr|\/h1|\/h2|\/div|\/li)\s*\/?>/gi, "\n")
    .replace(/<\/td>/gi, " — ")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/[ \t]+/g, " ")
    .split("\n")
    .map((r) => r.trim().replace(/\s+—$/, ""))
    .filter((r) => r !== "")
    .join("\n");
}

const euro = (centesimi: number) => `${(centesimi / 100).toLocaleString("it-IT", { minimumFractionDigits: 0, maximumFractionDigits: 2 })} €`;

export function costruisciDossier(adesso: Date = new Date()): Dossier {
  const data = adesso.toLocaleDateString("it-IT", { timeZone: "Europe/Rome", day: "numeric", month: "long", year: "numeric" });
  const impronta = createHash("sha256").update(testoCanonicoCondizioniPianoLavoro()).digest("hex");
  const numeriSpecifiche = CLAUSOLE_SPECIFICHE_PIANO_LAVORO.map((c) => c.numero);
  const titoliSpecifiche = CLAUSOLE_SPECIFICHE_PIANO_LAVORO.map((c) => c.titolo.toLowerCase());

  const emailCliente = htmlInTesto(
    emailClientePianoLavoroAcquistato({
      prova: false,
      garaTitolo: "«titolo della gara»",
      importoCentesimi: PREZZO_PIANO_LAVORO.predefinitoCentesimi,
      pagataIl: adesso,
      linkGara: "https://omnia-ai.it/dashboard/omnia-ai/gare/…",
      linkCondizioni: `https://omnia-ai.it${PERCORSO_CONDIZIONI_PIANO_LAVORO}`,
    }).html,
  );

  const sezioni: SezioneDossier[] = [
    {
      titolo: "1. In breve: che cos'è il servizio e come si vende",
      blocchi: [
        {
          t: "p",
          testo:
            "Il piano di lavoro è un file Excel con formule attive, modificabile, che OMNIA AI costruisce dai documenti di gara caricati dal cliente: monte ore per sede e tipologia di ambiente, organico per livello contrattuale, quadratura con il monte ore dichiarato dal bando, macchinari e attrezzature. Un modello di intelligenza artificiale LEGGE i documenti e ne ricava i dati, indicando per ciascuno la fonte; i calcoli e le formule li scrive il programma, mai il modello. I dati che i documenti non permettono di ricavare restano in evidenza (celle gialle) da compilare: non si inventano.",
        },
        {
          t: "tabella",
          intestazioni: ["Come si ottiene", "Regole", "Prezzo (IVA inclusa)"],
          righe: [
            ["Acquisto della singola gara", "Lo compra il titolare dell'account, con carta su Stripe, prima di generare. Una generazione per gara; una seconda solo se i documenti indicano una proroga dei termini.", `${euro(PREZZO_PIANO_LAVORO.predefinitoCentesimi)} per gara (modificabile dalla console)`],
            [
              "Opzione nell'abbonamento",
              "Per ogni gara INCLUSA NEL PIANO (non per quelle pagate con i crediti aggiuntivi). Si aggiunge in ogni momento con conguaglio immediato e si toglie con effetto dal rinnovo. Segue il rinnovo e la disdetta dell'abbonamento.",
              `Supplemento mensile: ${(["starter", "professional", "enterprise"] as const).map((p) => `${PIANI[p].nome} +${euro(SURPLUS_PIANO_LAVORO_PREDEFINITO[p])}`).join(", ")} (modificabile dalla console)`,
            ],
            ["Concessione gratuita dalla console", "Per tutte le gare di un cliente (con numero massimo e scadenza facoltativi) oppure per una gara. Si revoca, non si cancella.", "Gratis"],
            ["Utenti in prova", `Decide la console: ${POLITICHE_PROVA.map((p) => `«${ETICHETTA_POLITICA_PROVA[p]}»`).join(", ")}.`, "Secondo la scelta"],
          ],
        },
        {
          t: "elenco",
          voci: [
            "Nessuna rigenerazione a richiesta: una generazione per gara, la seconda solo con la proroga. Una generazione che fallisce per un errore del servizio non conta e si può rifare.",
            "Genera il titolare e anche il suo Ufficio Gare (utente secondario); compra solo il titolare.",
            "Il costo del lavoro NON è compreso (il foglio dell'organico è predisposto per alimentare una analisi economica separata).",
            "I prezzi di macchinari e attrezzature sono prezzi standard di mercato (listini di rivenditori di marche di riferimento o ricerca di mercato), con fonte e data di rilevazione, da sostituire con quelli dei fornitori del cliente.",
            "Il file è un dimensionamento di partenza, non un preventivo.",
          ],
        },
      ],
    },
    {
      titolo: "2. Dati personali e conservazione",
      blocchi: [
        {
          t: "elenco",
          voci: [
            "I documenti di gara possono contenere elenchi del personale uscente (clausola sociale). Nel piano di lavoro restano solo il livello contrattuale, il numero di addetti, le ore settimanali e, se c'è, una breve nota. Prima di scrivere nel file e nel database i dati passano dallo stesso filtro già usato per l'analisi della gara, che toglie codici fiscali, matricole e nominativi etichettati e scarta ogni campo non previsto.",
            "Per trovare i prezzi dei macchinari che non sono in catalogo si fa una ricerca sul web: nella richiesta va solo la descrizione della dotazione (per esempio il tipo di macchina), non dati del cliente né della gara.",
            "Il file Excel generato sta nello spazio privato della gara e si cancella insieme alla gara. I dati normalizzati da cui nasce il file sono conservati nel database, nella riga della generazione, e si cancellano anch'essi con la gara.",
            "Il pagamento (importo, titolo della gara, dati di fatturazione raccolti da Stripe, versione e impronta delle clausole accettate, data, indirizzo IP e browser) resta registrato anche se il cliente cancella la gara o l'account: è un dato contabile.",
          ],
        },
        { t: "deciso", testo: "Privacy policy, Allegato A (nomina a responsabile) e pagina «Riservatezza» coprono già questi trattamenti: nessuna integrazione (indicazione del titolare, 6 novembre 2026)." },
      ],
    },
    {
      titolo: `3. Testo 1 — Condizioni del servizio «Piano di lavoro» (versione ${VERSIONE_CONDIZIONI_PIANO_LAVORO})`,
      blocchi: [
        { t: "p", testo: FORNITORE_PIANO_LAVORO },
        ...CONDIZIONI_INTRO.map((testo) => ({ t: "p" as const, testo })),
        { t: "p", testo: "Le sei clausole che seguono sono il testo che il cliente accetta (identico nel modulo d'acquisto, nel modulo dell'opzione dell'abbonamento, nella pagina pubblica e nell'impronta registrata)." },
        ...CLAUSOLE_PIANO_LAVORO.map((c) => ({
          t: "clausola" as const,
          titolo: `${c.numero}. ${c.titolo}`,
          testo: c.testo,
          nota: c.specifica ? "Clausola da approvare specificamente, ai sensi di legge (seconda casella)." : undefined,
        })),
        {
          t: "p",
          testo: `Come si accetta: nel modulo d'acquisto ci sono due caselle obbligatorie. Prima: «Dichiaro di aver letto e accettato le avvertenze sul piano di lavoro (versione ${VERSIONE_CONDIZIONI_PIANO_LAVORO}) e di aver preso visione della Privacy policy (versione N)». Seconda: «${testoApprovazioneSpecifica(numeriSpecifiche, titoliSpecifiche)}». Nel modulo dell'opzione dell'abbonamento (e quando si aggiunge il piano di lavoro a un abbonamento già attivo) c'è una casella sola: «${testoAccettazioneCompleta(numeriSpecifiche, titoliSpecifiche)}». Il pulsante resta spento finché le caselle non sono spuntate, e il server lo riverifica.`,
        },
        {
          t: "p",
          testo: `Che cosa si registra: la versione (${VERSIONE_CONDIZIONI_PIANO_LAVORO}), l'impronta SHA-256 del testo (oggi ${impronta}), la data e l'ora, l'indirizzo IP, il browser e la versione della Privacy policy. Per l'acquisto della singola gara sono colonne della riga del pagamento; per l'opzione dell'abbonamento la versione e l'impronta sono sulla riga dell'abbonamento e il resto è nelle accettazioni legali dell'abbonamento. La pagina pubblica ${PERCORSO_CONDIZIONI_PIANO_LAVORO} mostra lo stesso testo e la stessa impronta.`,
        },
      ],
    },
    {
      titolo: "4. Testo 2 — Avvertenze scritte nel file Excel",
      blocchi: [
        { t: "p", testo: "Nella copertina del file, sotto «Avvertenze», sempre e in questo ordine (il terzo punto compare anche in evidenza nel foglio dei macchinari):" },
        { t: "numerato", voci: AVVERTENZE_FISSE },
        { t: "p", testo: "Legenda dei colori («Come leggere il file»):" },
        { t: "tabella", intestazioni: ["Come appare", "Che cosa significa"], righe: LEGENDA_FILE.map((v) => [v.nome, v.spiegazione]) },
        { t: "p", testo: "In copertina compaiono anche, quando servono, l'elenco dei dati mancanti, delle anomalie rilevate e dei documenti non letti (con il motivo)." },
      ],
    },
    {
      titolo: "5. Testo 3 — Testi nell'applicazione e sul sito",
      blocchi: [
        {
          t: "tabella",
          intestazioni: ["Dove", "Testo"],
          righe: [
            ["Riquadro «Piano di lavoro» nella pagina della gara", RIQUADRO_PIANO_PARTI.join("")],
            ["Modulo d'acquisto della singola gara", `Piano di lavoro di questa gara: «prezzo» (IVA inclusa).${ACQUISTO_SINGOLO_DETTAGLIO}`],
            ["Opzione nell'abbonamento (pagina di acquisto e area riservata)", `Aggiungi il piano di lavoro al piano «piano»: +«supplemento» al mese (IVA inclusa), in tutto «prezzo» al mese. ${OPZIONE_ABBONAMENTO_DESCRIZIONE}`],
            ["Pagina dei piani, sotto ogni piano (si vede sempre, come i prezzi dei piani)", rigaPianoLavoroPerPiano("«supplemento»")],
            [
              "Pagina dei piani, fascia «Piano di lavoro» (si vede sempre)",
              `${BANDA_PIANO_LAVORO.etichetta} — ${BANDA_PIANO_LAVORO.titolo} ${BANDA_PIANO_LAVORO.testo} ${BANDA_PIANO_LAVORO.punti.singola.titolo}: ${BANDA_PIANO_LAVORO.punti.singola.dettaglio("«prezzo»")}. ${BANDA_PIANO_LAVORO.punti.abbonamento.titolo}: ${BANDA_PIANO_LAVORO.punti.abbonamento.dettaglio("«supplemento Starter»")}. ${BANDA_PIANO_LAVORO.punti.formule.titolo}: ${BANDA_PIANO_LAVORO.punti.formule.dettaglio}. ${BANDA_PIANO_LAVORO.nota}`,
            ],
            ["Nota nella gara, a seconda di come si ha il diritto", (["abbonamento", "concessione", "prova", "acquisto", "pacchetto"] as const).map((k) => `${k}: «${NOTA_FONTE_DIRITTO[k]}»`).join("\n")],
            ["Messaggi nella gara quando non si può generare", Object.values(MESSAGGI_PIANO).join("\n")],
            [
              "Home, sezione «Dai documenti di gara anche il piano di lavoro» (senza prezzi; il pulsante porta alla pagina dei piani)",
              `${SITO_HOME_PIANO_LAVORO.titolo} ${SITO_HOME_PIANO_LAVORO.guida}\n${SITO_HOME_PIANO_LAVORO.punti.map((p) => `• ${p}`).join("\n")}\n${SITO_HOME_PIANO_LAVORO.nota}\n[pulsante] ${SITO_HOME_PIANO_LAVORO.collegamento}`,
            ],
            [`Home, domande frequenti: «${SITO_FAQ_PIANO_LAVORO.domanda}»`, SITO_FAQ_PIANO_LAVORO.risposta],
            [
              "Pagina «Come funziona», sezione «E poi, il piano di lavoro» (senza prezzi)",
              `${SITO_COME_FUNZIONA_PIANO_LAVORO.titolo}\n${SITO_COME_FUNZIONA_PIANO_LAVORO.guida}\n${SITO_COME_FUNZIONA_PIANO_LAVORO.passi.map((p, i) => `${i + 1}. ${p.titolo}: ${p.testo}`).join("\n")}\n${SITO_COME_FUNZIONA_PIANO_LAVORO.nota} ${SITO_COME_FUNZIONA_PIANO_LAVORO.collegamento}`,
            ],
          ],
        },
        {
          t: "domanda",
          testo:
            "Aggiunti dopo l'approvazione del 6 novembre 2026, da far vedere al legale: gli ultimi tre testi della tabella (sezione della home, domanda frequente della home e sezione di «Come funziona»). Sono testi di presentazione, senza prezzi, che rimandano alla pagina dei piani e ripetono che si tratta di un dimensionamento di partenza e non di un preventivo. Cambia anche dove si vedono la riga sotto ogni piano e la fascia «Piano di lavoro» della pagina dei piani: i testi sono quelli già approvati, ma ora compaiono sempre, non solo quando il piano di lavoro è in vendita.",
        },
      ],
    },
    {
      titolo: "6. Testo 4 — Email di conferma al cliente dopo l'acquisto",
      blocchi: [{ t: "p", testo: emailCliente }],
    },
    {
      titolo: "7. Condizioni generali di abbonamento: decisione (strada A)",
      blocchi: [
        {
          t: "p",
          testo:
            "Il piano di lavoro ha condizioni proprie (testo 1), accettate al momento dell'acquisto, e le Condizioni generali di abbonamento (versione 2) non lo nominano. Le strade erano due: (A) lasciare le cose così, con un documento a parte e le Condizioni generali invariate; (B) integrare l'opzione nelle Condizioni generali, con una versione 3 (che si applicherebbe ai nuovi abbonamenti e alle riattivazioni, come previsto dall'art. 18).",
        },
        {
          t: "deciso",
          testo:
            "Strada A (indicazione del titolare, 6 novembre 2026): il piano di lavoro resta un documento a parte, accettato al momento dell'acquisto o dell'adesione all'opzione. Le Condizioni generali di abbonamento (versione 2) non cambiano e non si pubblica una versione 3. Una frase di richiamo nelle Condizioni generali, se mai la si volesse, richiederebbe comunque una versione 3.",
        },
        { t: "p", testo: "Per riferimento, se in futuro si scegliesse la strada (B), il testo proposto come nuovo articolo, dopo «6. Prezzi e pagamento», è questo:" },
        {
          t: "clausola",
          titolo: "Opzione «Piano di lavoro»",
          testo:
            "L'abbonamento può includere, a richiesta del cliente e con un supplemento mensile indicato al momento dell'adesione (IVA inclusa), il servizio «Piano di lavoro»: per ciascuna gara inclusa nel piano, il fornitore genera un file Excel con formule attive costruito dai documenti di gara caricati dal cliente, nei limiti e alle condizioni del documento «Condizioni del servizio Piano di lavoro», che il cliente accetta al momento dell'adesione all'opzione. L'opzione non comprende le gare acquistate con i crediti aggiuntivi o altrimenti non incluse nel piano, per le quali il piano di lavoro può essere acquistato per la singola gara. Il supplemento si somma al prezzo del piano, si rinnova e cessa con l'abbonamento; l'opzione può essere aggiunta in ogni momento, con addebito immediato della quota di periodo residuo, e tolta con effetto dal rinnovo successivo. Chi cambia piano mantiene l'opzione.",
        },
        {
          t: "elenco",
          voci: [
            "Art. 2 («Cos'è il servizio»): aggiungere che, a richiesta, il servizio comprende anche il piano di lavoro in formato Excel, e che anche questo è una bozza di lavoro da verificare.",
            "Art. 12 («Nessuna garanzia sull'esito della gara»): richiamare che il piano di lavoro è un dimensionamento di partenza e non un preventivo, e che i prezzi di macchinari e attrezzature sono standard.",
            "Art. 15 («Limitazione di responsabilità»): coordinarlo con la clausola 6 del testo 1 (oggi: «al corrispettivo pagato»; l'art. 15 dice: «all'importo corrisposto nei dodici mesi precedenti»).",
            "Inserire un articolo in mezzo fa scorrere i numeri: le clausole da approvare specificamente, oggi 5, 8, 10, 12 e 15 (versione 2), diventerebbero 5, 9, 11, 13 e 16. Per evitare lo scorrimento si può invece aggiungere il testo come ultimo articolo o come «Allegato B» alle Condizioni, come l'Allegato A. Il file con i numeri delle clausole e il test che lo confronta con il testo vanno aggiornati insieme alla nuova versione.",
          ],
        },
      ],
    },
    {
      titolo: "8. Punti sottoposti al parere del legale: esito",
      blocchi: [
        {
          t: "deciso",
          testo: `Tutti i punti che seguono sono stati approvati dal legale il ${APPROVAZIONE_LEGALE_PIANO_LAVORO.data}, senza modifiche ai testi (indicazione del titolare). L'elenco resta per memoria di cosa è stato sottoposto.`,
        },
        {
          t: "numerato",
          voci: [
            "Natura del documento: le clausole 2 («Natura del documento») e 4 («Documenti e risultato») bastano a far intendere che il piano è un dimensionamento di partenza e non un preventivo, e a lasciare al cliente la responsabilità di usarlo?",
            "Clausole da approvare specificamente (artt. 1341-1342 c.c.): sono giuste la 2, la 4 e la 6? Va aggiunta la 5 (corrispettivo e pagamento, anticipato) o la regola «una generazione per gara, la seconda solo con la proroga» (clausola 1)?",
            "Coordinamento con le Condizioni generali: art. 14 (il recesso del Codice del Consumo non si applica a chi acquista per la propria attività; la clausola 1 dice che il servizio è rivolto a imprese e professionisti: va bene se compra un consumatore?) e art. 15 (limite di responsabilità diverso).",
            "Rimborsi: una generazione che fallisce non conta e si può rifare; nessun rimborso per una generazione riuscita ma ritenuta insoddisfacente; un pagamento doppio per la stessa gara si rimborsa. Va scritto nelle clausole?",
            "Opzione nell'abbonamento: aggiunta subito con conguaglio, tolta dal rinnovo; le gare del piano già consumate nel periodo in cui si aggiunge l'opzione risultano coperte. Va detto nelle condizioni del piano di lavoro (con la strada A, le Condizioni generali non cambiano)?",
            "Gratuità: per le concessioni della console e per gli utenti in prova (se la console li rende gratuiti) non c'è l'accettazione delle clausole al momento della generazione; il cliente trova le avvertenze nella copertina del file e una nota nella gara. Basta, o serve far accettare le condizioni anche in questi casi?",
            "Uso del file: il cliente può modificarlo e usarlo liberamente per la propria offerta; i prezzi standard derivano da listini pubblici di rivenditori (indicati con fonte e data). Servono cautele sull'uso dei listini o sulla titolarità del file?",
            "Dati personali (elenchi del personale uscente, ricerca sul web, conservazione): DECISO, la Privacy policy, l'Allegato A e la pagina «Riservatezza» sono sufficienti (sezione 2).",
            "Promesse sul sito: la fascia della pagina dei piani dice «Formule attive: modifichi i valori e tutti i fogli si aggiornano» e «dimensionamento di partenza, non un preventivo». Va bene com'è?",
            "Intelligenza artificiale: se il disciplinare impone di dichiarare l'uso di sistemi di IA, l'art. 12 lo pone a carico del cliente. Vale anche per il piano di lavoro?",
            "Ufficio Gare: quando genera un utente secondario, il titolare resta il solo contraente e risponde dell'uso? Va detto?",
            "Conservazione: il file e i dati della generazione si cancellano con la gara; la registrazione del pagamento resta per gli obblighi contabili. Per quanto tempo conviene dichiararlo?",
          ],
        },
      ],
    },
    {
      titolo: "9. Dove compare ogni testo (per chi deve modificarli)",
      blocchi: [
        {
          t: "tabella",
          intestazioni: ["Testo", "File del programma"],
          righe: [
            ["Le sei clausole (testo accettato, versione e impronta)", "src/lib/piano-lavoro-acquisto-calcoli.ts — se cambia anche una sola parola si aumenta la versione"],
            ["Testi dell'interfaccia e del sito, pagina delle condizioni, avviso in console", "src/lib/piano-lavoro-testi.ts"],
            ["Pagina pubblica delle condizioni", `src/app/site-omnia-ai/condizioni-piano-lavoro/page.tsx (${PERCORSO_CONDIZIONI_PIANO_LAVORO})`],
            ["Avvertenze e legenda nel file Excel", "src/lib/piano-lavoro-excel.ts"],
            ["Email di conferma al cliente e all'ufficio", "src/lib/omnia-ai-email-piano-lavoro-calcoli.ts"],
            ["Questo documento", "npm run testi-legali:piano-lavoro (si rigenera da solo dai testi qui sopra)"],
          ],
        },
      ],
    },
  ];

  return {
    titolo: "OMNIA AI — Piano di lavoro: testi da sottoporre al legale",
    sottotitolo: `Documento del ${data}. Testi approvati dal legale il ${APPROVAZIONE_LEGALE_PIANO_LAVORO.data} (clausole, versione ${APPROVAZIONE_LEGALE_PIANO_LAVORO.versioneClausole}). Ogni modifica alle clausole richiede una nuova versione e una nuova approvazione.`,
    sezioni,
  };
}
