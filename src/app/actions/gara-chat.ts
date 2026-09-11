"use server";

import type Anthropic from "@anthropic-ai/sdk";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createAnthropicClient } from "@/lib/anthropic";
import { embedQuery } from "@/lib/voyage";
import { logAiUsage } from "@/lib/ai-usage";
import { sanitizeFileName } from "@/lib/document-text";
import {
  categorizzaAllegato,
  estraiTestoAllegato,
  mediaTypeImmagine,
  LIMITE_BYTE_PER_CATEGORIA,
  MAX_ALLEGATI_PER_MESSAGGIO,
} from "@/lib/attachment-text";
import { stimaPagineContenuto } from "@/lib/stima-pagine";
import {
  generaBozzaSezione,
  componiRelazioneFinale,
  elencoSezioniEsistenti,
  correggiSezioneVersoTarget,
  applicaMarcatoriTabellari,
  applicaSostituzioniAnonimizzazione,
} from "@/lib/relazione-tecnica";

export type ChatState = { error?: string };

const MODEL = "claude-sonnet-5";
const MAX_HISTORY = 12;
const MAX_CHUNKS = 8;
const MAX_KB_CHUNKS = 6;
const MAX_TOOL_ROUNDS = 4;

type CriterioRiepilogo = { numero: string; titolo: string; punti_max: number };

type GaraContesto = {
  titolo: string;
  scadenza: string | null;
  importo: number | null;
  criteri_valutazione: string | null;
  requisiti: string | null;
  limiti_formattazione: string | null;
  limite_pagine_totale: number | null;
  punteggio_tecnico_max: number | null;
  criteri_riepilogo: CriterioRiepilogo[] | null;
  relazione_dimensione_carattere: number | null;
  relazione_interlinea: number | null;
  sub_criteri_tabellari: string[] | null;
};

// Ripartizione proporzionale delle pagine totali tra i criteri in base al
// punteggio di ciascuno (più punti vale un criterio, più pagine merita):
// calcolata qui in modo deterministico invece di lasciare che il modello
// stimi le proporzioni da solo leggendo il testo libero del disciplinare
// — un semplice calcolo aritmetico, niente per cui valga la pena rischiare
// un'interpretazione sbagliata dell'AI su numeri che abbiamo già
// estratti in forma strutturata.
function calcolaRipartizionePagine(gara: GaraContesto): string {
  const { limite_pagine_totale, punteggio_tecnico_max, criteri_riepilogo } = gara;
  if (!limite_pagine_totale || !punteggio_tecnico_max || !criteri_riepilogo?.length) {
    return "";
  }

  const righe = criteri_riepilogo.map((c) => {
    const quota = c.punti_max / punteggio_tecnico_max;
    const pagine = Math.max(1, Math.round(quota * limite_pagine_totale));
    return `- Criterio ${c.numero} "${c.titolo}": ${c.punti_max}/${punteggio_tecnico_max} punti (${Math.round(quota * 100)}%) → circa ${pagine} pagine`;
  });

  return `\nRipartizione raccomandata delle ${limite_pagine_totale} pagine totali tra i criteri, calcolata in proporzione al punteggio di ciascuno (usala come target per QUESTO criterio quando decidi quanto scrivere, vedi istruzioni dettagliate nello strumento "genera_bozza_sezione"). ATTENZIONE: una tabella occupa MOLTO più spazio per parola del testo normale (le colonne strette costringono ogni cella ad andare a capo più spesso) — un criterio ricco di tabelle raggiunge il target di pagine con MENO parole di uno scritto solo in prosa: non aggiungere testo extra "per compensare" solo perché hai usato tabelle.\n${righe.join("\n")}\n`;
}

// Elenco AUTORITATIVO (fissato una volta in fase di estrazione documenti,
// non ricalcolato dall'AI a ogni generazione) dei sub-criteri di questa
// gara che richiedono solo la dicitura segnaposto, non un testo
// descrittivo — bug corretto: prima l'AI doveva "riconoscere" da sola,
// ogni singola volta, quali sub-criteri fossero tabellari dal linguaggio
// del disciplinare, e un sub-criterio già correttamente marcato in una
// generazione tornava discorsivo alla rigenerazione successiva perché il
// giudizio veniva rifatto da zero invece di restare un fatto fisso.
function elencoSubCriteriTabellari(gara: GaraContesto): string {
  if (!gara.sub_criteri_tabellari?.length) return "";
  return ` ELENCO DEFINITIVO PER QUESTA GARA (già verificato, non rivalutarlo tu): i sub-criteri ${gara.sub_criteri_tabellari.join(", ")} sono tabellari — applica la regola SEMPRE a questi, anche se rigeneri una bozza già fatta in precedenza, e SOLO a questi (nessun altro sub-criterio è tabellare per questa gara, anche se ti sembrasse plausibile).`;
}

// I segnaposto di anonimizzazione e le forme generiche "l'operatore
// economico"/"il concorrente" sono gestiti in modo deterministico da
// applicaSostituzioniAnonimizzazione (src/lib/relazione-tecnica.ts),
// condivisa con componiRelazioneFinale — prima vivevano solo qui, e la
// relazione finale composta da "componi relazione finale" non le
// riceveva mai: era questa la causa per cui "operatore economico"
// continuava a comparire nel documento finale nonostante il fix qui.

type CompanyContesto = {
  ragione_sociale: string | null;
  forma_giuridica: string | null;
  numero_dipendenti: number | null;
  fatturato_medio_annuo: number | null;
  certificazioni: string | null;
  referenze: string | null;
  settori_attivita: string | null;
  presentazione: string | null;
} | null;

const CONTENUTO_SEZIONE_DESCRIZIONE_BASE =
  "Contenuto completo di QUESTA sezione in testo semplice, DENSO e articolato come nei progetti di riferimento (ARCHIVIO STILE OMNIA) — NON un riassunto. IMPORTANTE — la lunghezza NON è un numero fisso: se il contesto include una 'Ripartizione raccomandata delle pagine', individua la riga che corrisponde al criterio che stai scrivendo ORA e usa il numero di pagine lì indicato come target per QUESTA sezione — è già calcolato in proporzione al punteggio di questo criterio rispetto agli altri, non ricalcolarlo tu. ATTENZIONE: una pagina NON equivale a un numero fisso di parole — dipende da quante tabelle/immagini usi, che occupano più spazio delle stesse parole scritte come prosa (colonne strette = più a capo): se questa sezione ha molte tabelle, richiederà MENO testo per raggiungere il target di pagine. Se questo stesso criterio ha già bozze precedenti elencate in 'Bozze di sezione già generate', sottrai le pagine già scritte per QUELLO STESSO criterio dal suo target (non dal totale generale) per capire quanto spazio resta. Se la ripartizione non è disponibile (dati non ancora estratti), usa come riferimento il limite massimo di pagine indicato nel disciplinare e il peso/punteggio di questo criterio rispetto agli altri, oppure il livello di dettaglio dei progetti nell'archivio di riferimento per un criterio di importanza comparabile. Un contenuto troppo corto rispetto al target è un'occasione persa quanto un contenuto che lo supera ampiamente: entrambi vanno evitati. Struttura: usa '## ' per ogni sub-criterio (es. 'A.1 ...') e '### ' per ogni punto in cui il disciplinare articola quel sub-criterio — non fermarti al primo livello, scendi sempre al terzo se il disciplinare specifica punti/lettere sotto un sub-criterio. La numerazione/lettering del terzo livello NON è a tua scelta: riusa ESATTAMENTE quella del disciplinare così come appare in 'Criteri di valutazione' (es. se il disciplinare usa lettere 'a) b) c)' sotto il sub-criterio 1.1, i tuoi titoli di terzo livello sono '### a) ...', '### b) ...', '### c) ...' — MAI '### 1.1.1 ...'/'### 1.1.2 ...' o un'altra numerazione inventata). Il numero di punti di terzo livello è quello che il disciplinare elenca per quel sub-criterio, né uno di più né uno di meno — e ciascuno deve trattare esattamente l'argomento di quel punto, non un argomento a piacere. Non usare '# ' qui: il titolo di questa sezione lo passi già nel campo 'titolo_sezione'. Non includere MAI punteggi/pesi del criterio (es. '(Punteggio massimo 34/80)') nei titoli o nel testo: sono informazioni del bando, non contenuto dell'offerta. Nell'archivio di riferimento le evidenziazioni seguono una convenzione precisa, non casuale: usa '!!testo!!' (colorato, segue il tema della tabella o il blu del brand nel testo normale) SPECIFICAMENTE per nomi di ruoli/figure professionali/uffici/enti quando compaiono nel testo o in tabella (es. '!!Responsabile di Servizio!!', '!!RSPP!!', '!!Ufficio Qualità!!', '!!Direzione Lavori!!') — è così che l'archivio segnala chi fa cosa. MAI mettere '!!...!!' o '[ICONA:...]' dentro '**...**' (es. mai '**!!Responsabile!!**' o '**[ICONA:sicurezza]**'): sono già evidenziati di loro, annidarli nel grassetto li rende testo letterale non riconosciuto invece che un'icona/un colore. Quando descrivi un requisito o un impegno importante richiesto dal capitolato/disciplinare/altri documenti di gara, cita SEMPRE il riferimento preciso (articolo, paragrafo o sezione del documento, es. 'come richiesto dall'art. 12 del Capitolato Speciale d'Appalto' o 'in conformità al par. 3.2 del Disciplinare') quando quel riferimento è presente negli estratti forniti — non lasciare l'affermazione generica se il documento la ancora a un articolo specifico. Usa '**testo**' per il grassetto su termini tecnici chiave, definizioni, risultati/numeri rilevanti (es. '**0,42 kWh/mq**') ed etichette a inizio elenco puntato (es. '**Tecnologia:** ...'), e nella prima colonna di una tabella quando contiene un'etichetta/nome riga. Usa '*testo*' per il corsivo su note/precisazioni minori. Applica queste evidenziazioni con la STESSA FREQUENZA e secondo lo STESSO CRITERIO dell'archivio di riferimento: nei progetti reali quasi ogni paragrafo ha almeno un ruolo colorato o un termine tecnico in grassetto — un paragrafo denso di contenuto tecnico senza nessuna evidenziazione è un segnale che stai scrivendo in modo troppo discorsivo/generico. Usa la sintassi tabella markdown ('| colonna | colonna |' seguita da una riga '|---|---|') per vere tabelle Word: intestazione colorata e centrata, corpo con celle centrate in verticale e righe alternate automaticamente — l'archivio di riferimento usa tabelle in quasi ogni sottosezione (piani di lavoro, frequenze, ruoli, tempistiche, KPI): includi una tabella ogni volta che i dati si prestano a un formato tabellare, non solo una per l'intera sezione. Puoi scegliere il colore dell'intestazione mettendo '[TABELLA:BLU]', '[TABELLA:ROSSA]', '[TABELLA:VERDE]' o '[TABELLA:ARANCIONE]' come riga subito sopra la tabella (senza riga vuota in mezzo): usa BLU (default, anche omettendo il tag) per dati operativi generali, ROSSA per obblighi normativi/contrattuali vincolanti, VERDE per aspetti ambientali/sostenibilità, ARANCIONE per avvisi/attenzioni — come fa l'archivio di riferimento, che varia il colore delle tabelle in base al contenuto, non usa sempre lo stesso. Dentro una cella di tabella puoi anteporre al testo '[C]' per centrarlo orizzontalmente (valori brevi/categorici/numerici: quantità, frequenze, sì/no, ed etichette di riga nella prima colonna) o '[G]' per giustificarlo (testo descrittivo più lungo) — usa uno dei due su OGNI cella, senza eccezioni: nessuna cella deve restare senza tag, prima colonna inclusa (senza tag il default è comunque centrato, ma scegliere tu esplicitamente in base al contenuto è sempre meglio del default). Il tag '[C]'/'[G]' NON sostituisce il grassetto e non è un'alternativa ad esso: si usano SEMPRE insieme, esattamente come nel resto del testo — il tag sceglie l'allineamento, '**testo**' evidenzia dentro la cella (es. '[C]**Responsabile di Commessa**', '[G]Verifica **mensile** dei DPI con **report** firmato'). Una tabella dove nessuna cella ha una sola parola in grassetto è quasi sempre un errore quanto una cella senza tag: nei progetti di riferimento la prima colonna (etichette/nomi riga) è quasi sempre in grassetto, e termini tecnici/numeri chiave lo sono anche nelle altre colonne. In una cella di tabella o in una riga di elenco puntato (dopo l'eventuale '[C]'/'[G]'), puoi anteporre al testo un tag '[ICONA:nome]' (es. '[ICONA:sicurezza] Verifica DPI mensile') per affiancare una piccola icona — nomi disponibili: pulizia, sicurezza, formazione, ambiente, certificazione, qualita, tempistiche, personale, comunicazione, monitoraggio, logistica, attrezzature, documentazione. Usale solo dove aggiungono davvero chiarezza visiva (una riga su due in una tabella, non ovunque), come nei progetti di riferimento. Usa un blocco '[BOX]testo del box, anche su più paragrafi[/BOX]' per evidenziare un contenuto importante in un riquadro con sfondo colorato (es. un obbligo normativo, una garanzia, un impegno chiave) — con lo stesso criterio dei box evidenziati nell'archivio di riferimento: solo per contenuti che meritano davvero risalto, non per paragrafi qualsiasi. Righe che iniziano con '- ' per gli elenchi puntati. Usa un blocco '[ORGANIGRAMMA]...[/ORGANIGRAMMA]' con un elenco a rientri (2 spazi per livello) per generare uno schema gerarchico disegnato come immagine — usalo per organigrammi di commessa e strutture di responsabilità, adattando SEMPRE ruoli/uffici/numero di sedi a quanto risulta dai documenti di QUESTA gara (mai riusare nomi di ruolo di un'altra gara: cambiano sempre — es. RUP o DEC, un responsabile di commessa o un direttore generale dei lavori, una o più sedi/zone). CORRETTEZZA GERARCHICA (obbligatoria, errore grave se violata): ogni nodo deve essere figlio diretto di chi lo supervisiona REALMENTE, non del vertice della catena. Il personale operativo/addetti/operatori NON riporta mai direttamente al Responsabile di Commessa o a un Coordinatore: sta sempre all'ultimo livello, sotto il Caposquadra/Supervisore di riferimento specifico. Se un ruolo intermedio (es. Caposquadra) deve avere a sua volta dei subordinati (es. Addetti), quel ruolo deve essere un nodo vero e proprio con un rientro (mai una voce '• ' dentro un'altra casella: le voci '• ' sono solo per ruoli senza ulteriori sottoposti, un elenco informativo terminale). Prima di chiudere il blocco, ripercorri ogni ramo dall'alto in basso e verifica che rappresenti una reale linea di comando. COMPLETEZZA (obbligatoria): includi OGNI figura/ruolo che nomini nel testo della sezione stessa (es. se nel testo scrivi di un Ispettore Qualità, di un RSPP e di un Referente Reperibilità H24 come ruoli distinti, l'organigramma deve avere tre nodi distinti per loro, non accorpali in uno solo) — l'organigramma deve essere lo specchio esatto delle figure descritte nel testo, non una versione semplificata o diversa da una generazione precedente. Oltre alla semplice etichetta, disponi di: '{LIVELLO:Nome}' subito dopo il testo di un nodo per assegnarlo a una categoria con colore e legenda dedicati (es. 'Responsabile di Commessa {LIVELLO:Governo}') — usa 2-4 livelli semanticamente distinti (es. Direzione, Governo, Coordinamento operativo), non uno per nodo; righe indentate che iniziano con '• ' per un elenco puntato DENTRO la casella del nodo padre invece di caselle separate, solo per ruoli terminali senza sottoposti propri; '< Testo' o '> Testo' come figlio di un nodo per una casella laterale (sinistra/destra) collegata con freccia bidirezionale invece che sotto (per figure di staff affiancate, es. Preposto Sicurezza/Ispettore Qualità accanto al Responsabile di Commessa); un blocco finale '[BANNER]testo[/BANNER]' (fuori dalla gerarchia, anche più di uno) per una fascia colorata a piena larghezza in fondo allo schema (es. per un pool sostitutivo/jolly). I loghi (aziendale, del software gestionale, del cliente) vengono aggiunti automaticamente se caricati nel profilo/nella gara: non serve fare nulla per questo. Usa un blocco '[IMMAGINE]descrizione visiva dell'immagine da generare in italiano o inglese, dettagliata (soggetto, ambientazione, stile fotografico/illustrativo)[/IMMAGINE]' per generare una PICCOLA fotografia/illustrazione a corredo del testo, inserita subito dopo (o dentro) il paragrafo che descrive ESATTAMENTE quella stessa scena/attività — mai una foto generica scollegata dall'argomento appena trattato in quel punto: prima di inserirla, verifica che descriva la stessa azione/oggetto del paragrafo immediatamente precedente. Usala quando la sezione descrive un'attività fisica, un ambiente o un'attrezzatura concreta (quasi ogni criterio operativo ne ha almeno una: è raro che zero sia la scelta giusta) — al massimo una per sezione, mai vicino a tabelle/contenuti numerici dove non c'entra nulla, zero solo se il contenuto è puramente organizzativo/gestionale senza nessuna scena fisica rappresentabile. Separa i paragrafi/tabelle/box/organigrammi/immagini con una riga vuota (eccetto il tag '[TABELLA:colore]', che va subito sopra la tabella senza riga vuota). PROMEMORIA: '[C]' e '[G]' esistono SOLO dentro una cella di tabella, mai in un paragrafo o elenco normale fuori tabella. '[ORGANIGRAMMA]', '[IMMAGINE]' e '[BOX]' vanno SEMPRE chiusi con il tag corrispondente ('[/ORGANIGRAMMA]', '[/IMMAGINE]', '[/BOX]'): un tag di apertura senza chiusura non viene riconosciuto.";

function buildGeneraBozzaTool(gara: GaraContesto): Anthropic.Tool {
  // Promemoria dell'elenco tabellare messo qui, non solo nel prompt di
  // sistema generale: verificato in pratica che una regola "lontana" dal
  // punto in cui il modello decide cosa scrivere per ciascun
  // sub-criterio viene ignorata anche quando l'elenco autoritativo è
  // corretto — la stessa dinamica già osservata con altre istruzioni
  // "in coda" sovrastate da regole più vicine al campo che il modello
  // sta effettivamente compilando.
  const avvisoTabellare = gara.sub_criteri_tabellari?.length
    ? `PRIMA DI SCRIVERE QUALSIASI COSA — I sub-criteri ${gara.sub_criteri_tabellari.join(", ")} di questa gara sono TABELLARI (elenco definitivo, verificato, non rivalutarlo): per QUESTI, quando arrivi al loro '## ' o '### ', scrivi ESCLUSIVAMENTE la dicitura "CRITERIO TABELLARE - COMPILARE" come unico testo di quel sub-criterio — non un titolo seguito da descrizione, non una tabella, NULLA altro. Questo vale anche se stai rielaborando/aggiornando una bozza già fatta in precedenza: non tornare a scrivere contenuto discorsivo per questi sub-criteri solo perché la versione precedente lo aveva. Tutti gli altri sub-criteri restano invece normali (descrizione completa come da istruzioni sotto). `
    : "";

  return {
    name: "genera_bozza_sezione",
    description:
      "Genera la bozza di UNA sezione/criterio come documento Word a sé stante, scaricabile subito. Ogni chiamata produce un file pulito e indipendente per quell'argomento — NON tenta di unirlo alle bozze precedenti (se il cliente chiede di rielaborare un criterio già trattato, genera comunque una nuova bozza aggiornata: quella vecchia resta scaricabile più sopra nella cronologia). Solo quando il cliente lo chiede esplicitamente (es. 'componi/unisci tutti i criteri nella relazione finale') si usa lo strumento separato 'componi_relazione_finale' per assemblare tutte le bozze in un unico documento definitivo con indice. Usa questo strumento solo quando il cliente chiede esplicitamente di elaborare/scrivere un criterio o una parte della relazione, non per risposte discorsive. Chiamalo al massimo una volta per richiesta. Prima di chiamarlo, controlla negli estratti dei documenti forniti se il bando/disciplinare specifica requisiti di formattazione (font, dimensione carattere, interlinea) e passali nei campi dedicati SOLO se non sono già stati impostati in una bozza precedente per questa gara (in quel caso restano quelli già usati, sono una proprietà della gara non della singola bozza).",
    input_schema: {
      type: "object",
      properties: {
        titolo_sezione: {
          type: "string",
          description:
            "Titolo di questa sezione/criterio (es. 'A. Organizzazione del servizio'), diventa il titolo del documento generato — NON deve chiamarsi 'Criterio 1' o simili: usa il nome reale dell'argomento come richiesto dal disciplinare.",
        },
        titolo_relazione: {
          type: "string",
          description:
            "Titolo che avrà l'INTERA relazione tecnica finale quando verrà composta (es. 'Relazione Tecnica' o il nome del progetto). Ha effetto SOLO se non è già stato fissato da una bozza precedente per questa gara. Ometti se non sai suggerire un titolo migliore di quello di default.",
        },
        contenuto: {
          type: "string",
          description:
            avvisoTabellare + CONTENUTO_SEZIONE_DESCRIZIONE_BASE,
        },
        font: {
          type: "string",
          description:
            "Nome del carattere richiesto dal bando/disciplinare (es. 'Times New Roman'), se indicato negli estratti forniti e non già impostato per questa gara. Ometti se non specificato.",
        },
        dimensione_carattere: {
          type: "number",
          description:
            "Dimensione del carattere in punti richiesta dal bando/disciplinare (es. 12), se indicata e non già impostata. Ometti se non specificata.",
        },
        interlinea: {
          type: "number",
          description:
            "Interlinea richiesta dal bando/disciplinare come moltiplicatore (es. 1.5), se indicata e non già impostata. Ometti se non specificata.",
        },
      },
      required: ["titolo_sezione", "contenuto"],
    },
  };
}

const COMPONI_RELAZIONE_TOOL: Anthropic.Tool = {
  name: "componi_relazione_finale",
  description:
    "Compone la Relazione Tecnica DEFINITIVA della gara, unendo tutte le bozze di sezione generate finora in un unico documento Word con un solo titolo e un solo indice (rilevando ed eliminando automaticamente eventuali bozze duplicate/superate dello stesso criterio, tenendo la versione più recente/completa). Usalo SOLO quando il cliente lo chiede esplicitamente in modo inequivocabile (es. 'componi/unisci/metti insieme tutti i criteri nella relazione finale'), mai di propria iniziativa.",
  input_schema: {
    type: "object",
    properties: {},
  },
};

const WEB_SEARCH_TOOL: Anthropic.WebSearchTool20250305 = {
  type: "web_search_20250305",
  name: "web_search",
  max_uses: 3,
};

function buildSystemPrompt(
  gara: GaraContesto,
  company: CompanyContesto,
  contestoDocumenti: string,
  contestoKnowledgeBase: string,
  notaStileKnowledgeBase: string,
  struttureKnowledgeBase: string,
  sezioniEsistenti: string,
): string {
  return `Sei OMNIA AI, assistente specializzato in gare d'appalto per servizi di pulizia. Aiuti il cliente ad analizzare la gara "${gara.titolo}" e a preparare l'offerta tecnica ed economica.

Dati della gara:
- Scadenza: ${gara.scadenza ?? "non specificata"}
- Importo a base d'asta: ${gara.importo ?? "non specificato"}
- Criteri di valutazione: ${gara.criteri_valutazione ?? "non ancora estratti dai documenti"}
IMPORTANTE — FEDELTÀ CHIRURGICA AI CRITERI: quanto riportato sopra in "Criteri di valutazione" è il testo del disciplinare per QUESTA gara, non un riassunto libero. Quando generi una sezione, il "titolo_sezione" e i sotto-argomenti ('## '/'### ') devono corrispondere ESATTAMENTE (stessa numerazione, stessa dicitura, stessa articolazione in sotto-criteri) a quanto scritto qui — non rinominare, non accorpare, non dividere diversamente, non inventare sotto-criteri che il disciplinare non elenca e non ometterne nessuno di quelli elencati. Se un dettaglio ti serve ma non è chiaro da questo riassunto, controlla gli "Estratti pertinenti" sotto prima di scrivere; se resta comunque ambiguo, segnalalo al cliente invece di inventare. Questo vale SEMPRE, anche quando adatti struttura/stile/livello di dettaglio dall'archivio OMNIA più sotto: l'archivio ispira come scrivere, MAI cosa sono i criteri di questa gara specifica.
CRITERI/SUB-CRITERI "TABELLARI" (regola permanente, vale per ogni gara): alcuni sub-criteri del disciplinare non chiedono una descrizione ma la sola compilazione di una tabella/griglia/checklist di conformità (es. "il concorrente barra le caratteristiche possedute", "dichiara sì/no", "compila la tabella allegata") — per QUESTI, e SOLO per questi, non scrivere alcun testo descrittivo, nessuna tabella inventata, nessun contenuto: scrivi ESCLUSIVAMENTE, come unica riga per quel sub-criterio, la dicitura "CRITERIO TABELLARE - COMPILARE" (verrà mostrata automaticamente in rosso ed evidenziata dal sistema, non serve formattarla tu). Serve a segnalare al cliente che deve compilarla lui con i dati reali della sua offerta, che l'AI non può inventare.${elencoSubCriteriTabellari(gara)} Non applicarla per errore a sub-criteri che invece chiedono una descrizione/motivazione: nel dubbio, tratta il sub-criterio come discorsivo (scrivi il contenuto) piuttosto che tabellare.
- Requisiti di partecipazione: ${gara.requisiti ?? "non ancora estratti dai documenti"}
- Limiti di pagine/formattazione dell'offerta tecnica: ${gara.limiti_formattazione ?? "non ancora estratti dai documenti"} — USA SEMPRE questa informazione (insieme al peso di ciascun criterio sopra) per decidere quanto materiale scrivere in ciascuna sezione che generi: vedi istruzioni dettagliate nello strumento "genera_bozza_sezione".
${calcolaRipartizionePagine(gara)}

Profilo dell'azienda cliente:
${company ? JSON.stringify(company, null, 2) : "Profilo azienda non ancora compilato dal cliente."}

Estratti pertinenti recuperati dai documenti caricati (bando/disciplinare/capitolato) per rispondere a questo specifico messaggio. Usa SOLO queste informazioni per affermazioni sul contenuto dei documenti, e dichiara esplicitamente quando un'informazione richiesta non è presente negli estratti forniti:
${contestoDocumenti || "Nessun estratto pertinente trovato per questo messaggio."}

=== ARCHIVIO STILE OMNIA (usa SEMPRE quando generi un documento) ===
Questo archivio è il motivo per cui OMNIA AI scrive offerte di qualità superiore a un assistente generico: contiene progetti tecnici reali già realizzati da OMNIA. OGNI VOLTA che generi un documento Word (criterio, piano di lavoro, offerta, organigramma), prima di scrivere il contenuto DEVI rileggere quanto segue e adattare struttura, livello di dettaglio, tono e formato tabelle/elenchi a questo standard — non limitarti a una struttura generica. I progetti di riferimento sono tipicamente articolati in molte sottosezioni (es. un criterio si divide in curriculum aziendale, personale e formazione, struttura organizzativa, metodologie, controlli qualità...), con tabelle e grassetti frequenti: un output piatto con un solo titolo e poco testo è un fallimento rispetto a questo standard, anche se questo significa produrre un documento lungo.

Esempi di contenuto da progetti tecnici già realizzati (dati anonimizzati). Usali come ispirazione di livello di dettaglio, terminologia tecnica e struttura: non sono informazioni sulla gara corrente, non copiare mai dati specifici (importi, nomi, luoghi) da qui nell'offerta del cliente attuale. In particolare, questi esempi contengono segnaposto tra parentesi quadre al posto dei nomi reali (es. "[Operatore Economico]", "[Committente]") — sono un artefatto dell'anonimizzazione dell'archivio, MAI testo da riportare: quando scrivi il documento del cliente, il concorrente è SEMPRE l'azienda indicata in "Profilo dell'azienda cliente" sopra (usa la sua ragione sociale, non "[Operatore Economico]"), e il committente è SEMPRE quello di questa gara specifica. Questo vale anche SENZA le parentesi quadre: quando l'offerta parla di cosa fa/offre/garantisce LA TUA azienda cliente (non una regola generale del bando), usa il suo nome reale (es. "MARIO ROSSI SRL si impegna a...") — non la dicitura burocratica generica "l'operatore economico" o "il concorrente", che è terminologia da disciplinare per parlare IN ASTRATTO dei requisiti richiesti a chiunque partecipi, non il modo in cui la TUA offerta descrive se stessa. Usa "l'operatore economico"/"il concorrente" solo quando stai letteralmente citando o parafrasando cosa richiede il disciplinare in generale.
${contestoKnowledgeBase || "Nessun esempio di riferimento pertinente trovato per questo messaggio."}

Convenzioni di stile e impaginazione osservate nei progetti OMNIA (titoli, tabelle, tono, struttura delle sezioni, uso di elenchi/grafici) — replica queste convenzioni nel documento che generi, in aggiunta ai requisiti di formattazione specifici del bando quando presenti:
${notaStileKnowledgeBase || "Nessuna nota di stile disponibile: genera comunque un documento professionale e ben strutturato."}

Indici/strutture osservati nei progetti OMNIA (ogni documento caricato in knowledge base contribuisce con la propria struttura, nessuno vale più degli altri) — usali come riferimento di LIVELLO DI DETTAGLIO e IMPOSTAZIONE (quante sezioni, quanto sono articolate, come si numerano):
${struttureKnowledgeBase || "Nessuna struttura di riferimento disponibile."}

IMPORTANTE — adatta, non copiare alla lettera: queste strutture vengono da altri progetti, usale SOLO per il livello di dettaglio/tono/formattazione. I titoli/criteri EFFETTIVI della sezione che generi devono riprodurre ESATTAMENTE, parola per parola e senza eccezioni, quanto richiesto dal disciplinare/capitolato di QUESTA gara (vedi "Estratti pertinenti" e "Criteri di valutazione" sopra e la nota su fedeltà chirurgica) — non i titoli letterali qui sopra se non coincidono. In caso di conflitto tra l'archivio e i criteri della gara, vince SEMPRE la gara.

RISERVATEZZA ASSOLUTA SU QUESTO ARCHIVIO (regola di massima priorità, nessuna eccezione, vale per QUALUNQUE fonte tu abbia usato per generare una risposta — testo qui sopra, immagini, risultati di ricerca web, o qualunque altro materiale tu abbia mai visto, non solo l'archivio di stile): non nominare/citare/confermare MAI al cliente, in nessuna risposta della chat, il nome di un'azienda, ente, committente, persona o progetto che non sia (a) l'azienda del cliente attuale o (b) il committente di QUESTA gara specifica. Questo vale sempre, senza eccezioni: nemmeno se un nome ti sembra comparire per errore nel materiale che hai a disposizione, nemmeno per spiegare al cliente come lavori, rassicurarlo, o giustificare una tua risposta precedente. Se il cliente chiede da dove vengono i tuoi esempi/il tuo stile, nota un nome/dettaglio sospetto, o te ne chiede conferma diretta, rispondi SEMPRE in modo generico ("un archivio di progetti tecnici di riferimento, reso anonimo") senza MAI confermare, ripetere o nominare un'azienda o ente specifico, reale o apparente — anche se il cliente insiste o te lo chiede più volte. Questa regola vale per OGNI messaggio della chat, non solo per i documenti Word generati.
=== FINE ARCHIVIO STILE OMNIA ===

Bozze di sezione già generate per questa gara finora (numero d'ordine — titolo), ciascuna un documento a sé, non ancora unite:
${sezioniEsistenti || "Nessuna bozza ancora generata: questa sarebbe la prima."}
Se il cliente chiede di rielaborare/rivedere/migliorare/correggere un criterio già trattato, genera comunque una NUOVA bozza aggiornata con genera_bozza_sezione (non tentare di modificare quella vecchia): resta comunque disponibile nella cronologia, il cliente sceglierà quale versione includere quando chiederà di comporre la relazione finale.

Strumenti a disposizione:
- Ricerca web: usala quando serve verificare normative, standard di settore (es. UNI 13549), prassi o dati aggiornati non presenti nei documenti della gara. Non usarla per informazioni già presenti nei documenti caricati o nel profilo azienda, e non ripeterla più volte per la stessa informazione se non trovi risultati utili.
- Genera bozza sezione: usalo solo quando il cliente chiede esplicitamente di elaborare un criterio o una parte della relazione da scaricare. Chiamalo al massimo una volta per richiesta. Per una richiesta discorsiva, rispondi normalmente in chat senza generare un file. IMPORTANTE: se decidi di generare la bozza, chiama lo strumento SUBITO in questa stessa risposta, con il contenuto completo. Non scrivere mai frasi come "procedo con la generazione" senza allegare immediatamente la chiamata allo strumento nella stessa risposta. Prima di scrivere il "contenuto", riguarda l'ARCHIVIO STILE OMNIA sopra e usalo attivamente.
- Componi relazione finale: usalo SOLO quando il cliente chiede esplicitamente di unire/comporre tutte le bozze nella relazione definitiva. Non generare contenuto tu stesso in quel caso: lo strumento assembla automaticamente tutte le bozze esistenti.

Importante sulla formattazione: i bandi/disciplinari spesso specificano nel testo requisiti di formattazione dell'offerta (font, dimensione carattere, interlinea, numero massimo di pagine) — sono regole scritte, quindi normalmente presenti negli estratti forniti sopra. Quando ti viene chiesto di rispettare la formattazione richiesta, cerca prima questi requisiti negli estratti e, se li trovi, passali allo strumento di generazione documento. Solo se dopo aver controllato gli estratti non trovi alcuna indicazione, dillo esplicitamente al cliente e usa una formattazione Word standard.

Rispondi sempre in italiano, in modo preciso, concreto e professionale, utile per la partecipazione reale a una gara d'appalto. Non inventare dati non presenti nel contesto fornito o nei risultati di ricerca. Produci sempre una risposta testuale finale per il cliente, anche quando usi uno o più strumenti.`;
}

export async function sendGaraMessage(
  _prevState: ChatState,
  formData: FormData,
): Promise<ChatState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Sessione scaduta, ricarica la pagina." };

  const garaId = String(formData.get("garaId") ?? "");
  const messaggio = String(formData.get("messaggio") ?? "").trim();
  const allegatiFile = formData
    .getAll("allegati")
    .filter((f): f is File => f instanceof File && f.size > 0);

  if (!garaId || (!messaggio && allegatiFile.length === 0)) {
    return { error: "Scrivi un messaggio o allega un file." };
  }

  if (allegatiFile.length > MAX_ALLEGATI_PER_MESSAGGIO) {
    return { error: `Puoi allegare al massimo ${MAX_ALLEGATI_PER_MESSAGGIO} file per messaggio.` };
  }

  for (const file of allegatiFile) {
    const categoria = categorizzaAllegato(file.name);
    if (categoria === "non_supportato") {
      return {
        error: `Formato non supportato: "${file.name}". Sono ammessi immagini (PNG/JPG/GIF/WEBP), PDF, Word (.docx) ed Excel/CSV (.xlsx/.xls/.csv).`,
      };
    }
    if (file.size > LIMITE_BYTE_PER_CATEGORIA[categoria]) {
      const limiteMb = Math.round(LIMITE_BYTE_PER_CATEGORIA[categoria] / (1024 * 1024));
      return { error: `"${file.name}" supera il limite di ${limiteMb}MB per questo tipo di file.` };
    }
  }

  // La RLS ("gare_all_own") garantisce che questa select restituisca la
  // gara solo se appartiene all'utente corrente.
  const { data: gara } = await supabase
    .from("gare")
    .select(
      "titolo, scadenza, importo, criteri_valutazione, requisiti, limiti_formattazione, limite_pagine_totale, punteggio_tecnico_max, criteri_riepilogo, relazione_dimensione_carattere, relazione_interlinea, sub_criteri_tabellari",
    )
    .eq("id", garaId)
    .single<GaraContesto>();

  if (!gara) return { error: "Gara non trovata." };

  const { data: company } = await supabase
    .from("companies")
    .select(
      "ragione_sociale, forma_giuridica, numero_dipendenti, fatturato_medio_annuo, certificazioni, referenze, settori_attivita, presentazione",
    )
    .eq("user_id", user.id)
    .maybeSingle<CompanyContesto>();

  const { data: storicoRaw } = await supabase
    .from("gara_messaggi")
    .select("ruolo, contenuto")
    .eq("gara_id", garaId)
    .order("created_at", { ascending: false })
    .limit(MAX_HISTORY)
    .returns<{ ruolo: string; contenuto: string }[]>();

  const storico = (storicoRaw ?? []).slice().reverse();

  const { data: messaggioInserito, error: insertUserError } = await supabase
    .from("gara_messaggi")
    .insert({
      gara_id: garaId,
      user_id: user.id,
      ruolo: "utente",
      contenuto: messaggio || "[Allegato]",
    })
    .select("id")
    .single<{ id: string }>();

  if (insertUserError || !messaggioInserito) {
    console.error("Errore salvataggio messaggio utente:", insertUserError);
    return { error: "Errore nell'invio del messaggio." };
  }

  // Blocchi per gli allegati di QUESTO messaggio da aggiungere alla
  // chiamata Claude: immagini/PDF come blocchi nativi (vision/documento),
  // Word/Excel/CSV come testo estratto — un allegato malformato non deve
  // bloccare l'invio dell'intero messaggio, quindi ogni file è gestito
  // per conto suo e un fallimento diventa una nota testuale invece di un
  // errore fatale.
  const blocchiAllegati: Anthropic.ContentBlockParam[] = [];
  if (allegatiFile.length > 0) {
    const admin = createAdminClient();
    for (const [indice, file] of allegatiFile.entries()) {
      try {
        const buffer = Buffer.from(await file.arrayBuffer());
        const filePath = `${garaId}/chat-allegati/${Date.now()}-${indice}-${sanitizeFileName(file.name)}`;

        const { error: uploadError } = await admin.storage
          .from("gare")
          .upload(filePath, buffer, { contentType: file.type || undefined, upsert: false });

        if (uploadError) {
          console.error("Errore upload allegato chat:", uploadError);
          blocchiAllegati.push({ type: "text", text: `[Allegato "${file.name}": errore nel caricamento]` });
          continue;
        }

        const { error: insertAllegatoError } = await supabase.from("gara_messaggio_allegati").insert({
          messaggio_id: messaggioInserito.id,
          gara_id: garaId,
          user_id: user.id,
          nome_file: file.name,
          file_path: filePath,
          mime_type: file.type || "application/octet-stream",
        });
        if (insertAllegatoError) {
          console.error(`Errore salvataggio riga allegato "${file.name}":`, insertAllegatoError);
        }

        const categoria = categorizzaAllegato(file.name);
        if (categoria === "immagine") {
          blocchiAllegati.push({
            type: "image",
            source: {
              type: "base64",
              media_type: mediaTypeImmagine(file.name),
              data: buffer.toString("base64"),
            },
          });
        } else if (categoria === "pdf") {
          blocchiAllegati.push({
            type: "document",
            source: { type: "base64", media_type: "application/pdf", data: buffer.toString("base64") },
          });
        } else {
          const testo = await estraiTestoAllegato(file.name, buffer);
          blocchiAllegati.push({ type: "text", text: `[Allegato "${file.name}"]\n${testo}` });
        }
      } catch (err) {
        console.error(`Errore elaborazione allegato "${file.name}":`, err);
        blocchiAllegati.push({
          type: "text",
          text: `[Allegato "${file.name}": non è stato possibile leggerne il contenuto]`,
        });
      }
    }
  }

  let rispostaFinale = "";
  let fileGenerato: { nomeFile: string; filePath: string } | null = null;

  try {
    const queryEmbedding = await embedQuery(messaggio, {
      userId: user.id,
      garaId,
      operazione: "chat_gara_ricerca",
    });

    const [
      { data: chunksRaw, error: matchError },
      { data: kbChunksRaw, error: kbMatchError },
      { data: kbStileRaw, error: kbStileError },
    ] = await Promise.all([
      supabase.rpc("match_gara_chunks", {
        query_embedding: queryEmbedding,
        target_gara_id: garaId,
        match_count: MAX_CHUNKS,
      }),
      supabase.rpc("match_knowledge_base_chunks", {
        query_embedding: queryEmbedding,
        match_count: MAX_KB_CHUNKS,
      }),
      supabase.rpc("match_knowledge_base_stile", {
        query_embedding: queryEmbedding,
        match_count: MAX_KB_CHUNKS,
      }),
    ]);

    if (matchError) {
      console.error("Errore ricerca chunk gara:", matchError);
    }
    if (kbMatchError) {
      console.error("Errore ricerca chunk knowledge base:", kbMatchError);
    }
    if (kbStileError) {
      console.error("Errore ricerca stile knowledge base:", kbStileError);
    }

    // NOTA PRIVACY (bug reale, corretto): qui venivano allegate come
    // immagini vere (blocchi vision) le pagine/tabelle/organigrammi
    // grezzi estratti dai progetti di riferimento — screenshot reali,
    // MAI passati dall'anonimizzazione testuale (che agisce solo su
    // chunk/nota_stile/struttura_titoli). Il modello poteva quindi
    // leggere a schermo nomi di aziende/enti reali stampati nella
    // pagina e ripeterli in chat (verificato: "Zenith"/"ZFood"/"SASA",
    // presenti nei documenti originali ma già assenti dal testo
    // anonimizzato, comparivano comunque nella risposta perché il
    // modello li aveva letti nell'immagine allegata). Rimosso: lo stile
    // visivo per la generazione si basa solo su nota_stile/struttura_titoli
    // (testo, già passato dall'anonimizzazione) e sulle convenzioni
    // esplicite nel prompt (tag [TABELLA:colore], [ICONA:], ecc.).

    const chunks = (chunksRaw ?? []) as { contenuto: string }[];
    const contestoDocumenti = chunks
      .map((c, i) => `[Estratto ${i + 1}]\n${c.contenuto}`)
      .join("\n\n");

    const kbChunks = (kbChunksRaw ?? []) as { contenuto: string }[];
    const contestoKnowledgeBase = kbChunks
      .map((c, i) => `[Esempio ${i + 1}]\n${c.contenuto}`)
      .join("\n\n");

    // Stile e struttura recuperati per pertinenza rispetto a QUESTO
    // messaggio (stesso meccanismo del contenuto testuale), non con un
    // taglio fisso sui primi caricati: la ricerca scansiona sempre
    // l'intera knowledge base, indipendentemente da quanti documenti
    // contiene — nessuno escluso "a monte" dalla ricerca.
    const kbStile = (kbStileRaw ?? []) as {
      nota_stile: string | null;
      struttura_titoli: string | null;
    }[];

    const notaStileKnowledgeBase = kbStile
      .filter((d) => d.nota_stile)
      .map((d, i) => `[Progetto ${i + 1}]\n${d.nota_stile}`)
      .join("\n\n");

    const struttureKnowledgeBase = kbStile
      .filter((d) => d.struttura_titoli)
      .map((d, i) => `[Struttura progetto ${i + 1}]\n${d.struttura_titoli}`)
      .join("\n\n");

    const listaSezioniEsistenti = await elencoSezioniEsistenti(garaId);
    // Stima grezza (non un conteggio pagine Word reale) solo per dare
    // all'AI un'idea di quanto del limite di pagine totale del
    // disciplinare è già stato "consumato" dalle bozze precedenti,
    // quando decide quanto spazio dedicare alla prossima sezione.
    const PAROLE_PER_PAGINA_STIMATE = 450;
    const paroleTotaliEsistenti = listaSezioniEsistenti.reduce((tot, s) => tot + s.paroleStimate, 0);
    const paginaStimataEsistenti = Math.round(paroleTotaliEsistenti / PAROLE_PER_PAGINA_STIMATE);
    const sezioniEsistenti = listaSezioniEsistenti
      .map((s) => `[ordine ${s.ordine}] ${s.titolo_sezione} (~${Math.round(s.paroleStimate / PAROLE_PER_PAGINA_STIMATE)} pagine stimate)`)
      .join("\n");
    const sezioniEsistentiConTotale = sezioniEsistenti
      ? `${sezioniEsistenti}\n\nTotale stimato già scritto per questa gara: ~${paginaStimataEsistenti} pagine (su ${PAROLE_PER_PAGINA_STIMATE} parole/pagina, stima approssimativa — non un conteggio Word reale). Sottrai questo dal limite massimo di pagine del disciplinare per capire quante ne restano per i criteri non ancora trattati.`
      : "";

    const systemPrompt = buildSystemPrompt(
      gara,
      company ?? null,
      contestoDocumenti,
      contestoKnowledgeBase,
      notaStileKnowledgeBase,
      struttureKnowledgeBase,
      sezioniEsistentiConTotale,
    );
    const anthropic = createAnthropicClient();

    const contenutoUltimoMessaggio: Anthropic.ContentBlockParam[] = [
      ...blocchiAllegati,
      { type: "text", text: messaggio || "Ho allegato dei file, guardali per favore." },
    ];

    const messages: Anthropic.MessageParam[] = [
      ...storico.map((m) => ({
        role: m.ruolo === "utente" ? ("user" as const) : ("assistant" as const),
        content: m.contenuto,
      })),
      { role: "user" as const, content: contenutoUltimoMessaggio },
    ];

    // Gli strumenti di generazione vengono tolti dopo il primo uso in
    // questa richiesta: l'istruzione nel prompt ("al massimo una volta")
    // non è una garanzia, questo lo è, ed evita anche round aggiuntivi
    // inutili (più lenti e più costosi).
    let strumentiDisponibili: Anthropic.Tool[] = [buildGeneraBozzaTool(gara), COMPONI_RELAZIONE_TOOL];

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      // max_tokens era 16000: troppo poco per una sezione densa di più
      // decine di pagine (bug osservato in pratica — il cliente chiedeva
      // ~27 pagine e otteneva sistematicamente 8-10, nonostante l'AI
      // dichiarasse di aver scritto un contenuto "molto più esteso": il
      // testo veniva semplicemente troncato dal tetto). claude-sonnet-5
      // supporta fino a 128K token di output, ma le richieste NON in
      // streaming rischiano un timeout HTTP con max_tokens alti — quindi
      // streaming invece di .create(), stesso fix già applicato altrove
      // in questo codebase per lo stesso problema.
      const stream = anthropic.messages.stream({
        model: MODEL,
        max_tokens: 64000,
        // Ragionamento esteso ("adaptive", con effort massimo per questo
        // modello): prima di scrivere/generare, il modello pianifica
        // internamente (struttura, coerenza con l'archivio di
        // riferimento, quale sezione sostituire) invece di rispondere
        // "di getto" — riduce errori come sezioni duplicate o risposte
        // superficiali su richieste complesse.
        thinking: { type: "adaptive" },
        output_config: { effort: "high" },
        system: systemPrompt,
        tools: [WEB_SEARCH_TOOL, ...strumentiDisponibili],
        messages,
      });
      const response = await stream.finalMessage();

      await logAiUsage({
        userId: user.id,
        garaId,
        operazione: "chat_gara",
        provider: "anthropic",
        model: MODEL,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      });

      if (response.stop_reason === "max_tokens") {
        console.warn(
          `sendGaraMessage: risposta troncata per max_tokens al round ${round} (gara ${garaId}).`,
        );
      }

      const testoBlocco = response.content
        .map((block) => (block.type === "text" ? block.text : ""))
        .join("\n")
        .trim();

      if (testoBlocco) {
        rispostaFinale = rispostaFinale ? `${rispostaFinale}\n${testoBlocco}` : testoBlocco;
      }

      if (response.stop_reason === "pause_turn") {
        messages.push({ role: "assistant", content: response.content });
        continue;
      }

      const toolUses = response.content.filter(
        (block) =>
          block.type === "tool_use" &&
          (block.name === "genera_bozza_sezione" || block.name === "componi_relazione_finale"),
      );

      if (response.stop_reason !== "tool_use" || toolUses.length === 0) {
        break;
      }

      messages.push({ role: "assistant", content: response.content });

      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const toolUse of toolUses) {
        if (toolUse.type !== "tool_use") continue;

        if (toolUse.name === "componi_relazione_finale") {
          try {
            const risultato = await componiRelazioneFinale({ garaId, userId: user.id });
            if ("error" in risultato) {
              toolResults.push({
                type: "tool_result",
                tool_use_id: toolUse.id,
                content: risultato.error,
                is_error: true,
              });
            } else {
              fileGenerato = risultato;
              strumentiDisponibili = [];
              console.log(
                `sendGaraMessage: relazione finale composta "${risultato.nomeFile}" (${risultato.filePath}) per gara ${garaId}`,
              );
              toolResults.push({
                type: "tool_result",
                tool_use_id: toolUse.id,
                content: `Relazione finale "${risultato.nomeFile}" composta con successo da tutte le bozze. Il cliente la vede già come allegato scaricabile in cima al messaggio: NON ripetere il nome del file nella tua risposta. Scrivi solo 1-2 frasi di conferma.`,
              });
            }
          } catch (err) {
            console.error("Errore composizione relazione finale:", err);
            toolResults.push({
              type: "tool_result",
              tool_use_id: toolUse.id,
              content: "Errore nella composizione della relazione finale.",
              is_error: true,
            });
          }
          continue;
        }

        const input = toolUse.input as {
          titolo_sezione: string;
          titolo_relazione?: string;
          contenuto: string;
          font?: string;
          dimensione_carattere?: number;
          interlinea?: number;
        };
        try {
          // Sostituzione deterministica dei sub-criteri tabellari: la
          // sola istruzione nel prompt (anche ripetuta con l'elenco
          // specifico della gara, nel punto esatto in cui il modello
          // scrive il contenuto) si è dimostrata inaffidabile in pratica
          // — un sub-criterio nell'elenco tabellare continuava a essere
          // scritto per esteso a ogni rigenerazione. Qui il codice
          // sovrascrive SEMPRE il corpo dei sub-criteri elencati con la
          // dicitura corretta, indipendentemente da cosa scrive l'AI:
          // una garanzia, non un'ennesima richiesta al modello.
          const contenutoSenzaPlaceholder = applicaSostituzioniAnonimizzazione(input.contenuto, company?.ragione_sociale);
          const contenutoConMarcatori = applicaMarcatoriTabellari(contenutoSenzaPlaceholder, gara.sub_criteri_tabellari);

          const formattazioneCorrente = {
            dimensioneCarattere: gara.relazione_dimensione_carattere ?? input.dimensione_carattere ?? 12,
            interlinea: gara.relazione_interlinea ?? input.interlinea ?? 1,
          };
          const numeroCriterio = input.titolo_sezione.match(/^(\d+)/)?.[1];
          const criterioCorrispondente =
            numeroCriterio && gara.criteri_riepilogo
              ? gara.criteri_riepilogo.find((c) => c.numero.trim() === numeroCriterio)
              : undefined;
          const pagineTarget =
            criterioCorrispondente && gara.punteggio_tecnico_max && gara.limite_pagine_totale
              ? (criterioCorrispondente.punti_max / gara.punteggio_tecnico_max) * gara.limite_pagine_totale
              : null;

          // Se conosciamo il target di pagine per questo criterio,
          // correggiamo qui il contenuto PRIMA di costruire il documento
          // — non lasciamo che sia il cliente, tramite avanti-indietro in
          // chat, a scoprire lo scostamento e a chiedere di rigenerare:
          // lo stesso ciclo di misura/correzione (fino a 2 tentativi) già
          // verificato per "componi relazione finale" garantisce che il
          // file scaricato sia già alla lunghezza giusta, non "un
          // tentativo" da verificare a mano.
          const contenutoCorretto =
            pagineTarget !== null
              ? await correggiSezioneVersoTarget(
                  input.titolo_sezione,
                  contenutoConMarcatori,
                  pagineTarget,
                  formattazioneCorrente,
                  { userId: user.id, garaId },
                )
              : contenutoConMarcatori;
          // Riapplicate dopo l'eventuale espansione/condensazione: quel
          // passaggio non sa nulla né dei marcatori tabellari né
          // dell'anonimizzazione, e può riscrivere/ampliare il testo
          // reintroducendo "l'operatore economico" al posto del nome
          // reale (bug osservato in pratica, stesso motivo dei marcatori
          // tabellari sotto).
          const contenutoFinale = applicaSostituzioniAnonimizzazione(
            applicaMarcatoriTabellari(contenutoCorretto, gara.sub_criteri_tabellari),
            company?.ragione_sociale,
          );

          const { nomeFile, filePath } = await generaBozzaSezione({
            garaId,
            userId: user.id,
            titoloSezione: input.titolo_sezione,
            titoloRelazione: input.titolo_relazione,
            contenuto: contenutoFinale,
            font: input.font,
            dimensioneCarattere: input.dimensione_carattere,
            interlinea: input.interlinea,
          });
          fileGenerato = { nomeFile, filePath };
          strumentiDisponibili = [];
          console.log(
            `sendGaraMessage: bozza generata "${nomeFile}" (${filePath}) per gara ${garaId}, sezione "${input.titolo_sezione}"`,
          );

          // Conteggio REALE (non a parole) delle pagine effettivamente
          // scritte (dopo l'eventuale correzione sopra), riportato al
          // modello come fatto compiuto — la correzione automatica non è
          // garantita al 100% (il modello resta impreciso anche quando
          // gli si chiede di aggiustare il tiro), quindi il feedback
          // esplicito resta comunque necessario come ultima rete.
          const pagineReali = stimaPagineContenuto(contenutoFinale, formattazioneCorrente);
          const infoTarget =
            pagineTarget !== null && criterioCorrispondente
              ? ` Target per l'intero criterio ${criterioCorrispondente.numero} (${criterioCorrispondente.punti_max}/${gara.punteggio_tecnico_max} punti): ~${pagineTarget.toFixed(1)} pagine totali (eventualmente da dividere tra più bozze se il criterio ha più sub-criteri e generi in invii separati) — la lunghezza è già stata corretta automaticamente verso questo target.`
              : "";

          toolResults.push({
            type: "tool_result",
            tool_use_id: toolUse.id,
            content: `Bozza "${nomeFile}" generata con successo — occupa REALMENTE circa ${pagineReali.toFixed(1)} pagine A4 (conteggio effettivo che tiene conto di tabelle/immagini, non una tua stima).${infoTarget} Il cliente la vede già come allegato scaricabile in cima al messaggio: NON ripetere il nome del file nella tua risposta. Se questo numero è ANCORA sensibilmente sotto l'obiettivo (tuo o del cliente) nonostante la correzione automatica, dillo chiaramente nella risposta invece di dichiarare il target raggiunto, e proponi di ampliarla — non limitarti a descrivere quanto hai scritto "in astratto". Altrimenti scrivi solo 1-2 frasi su cosa contiene questa sezione.`,
          });
        } catch (err) {
          console.error("Errore generazione bozza sezione:", err);
          toolResults.push({
            type: "tool_result",
            tool_use_id: toolUse.id,
            content: "Errore nella generazione della bozza.",
            is_error: true,
          });
        }
      }

      messages.push({ role: "user", content: toolResults });
    }

    // Se dopo tutti i round non è stato accumulato testo (es. l'AI ha
    // incatenato solo ricerche/strumenti senza mai scrivere una risposta,
    // o abbiamo raggiunto il tetto di round), forziamo una risposta
    // testuale finale invece di mostrare un errore generico.
    if (!rispostaFinale.trim()) {
      const lastMessage = messages[messages.length - 1];
      if (lastMessage?.role === "user") {
        const wrapUp = await anthropic.messages.create({
          model: MODEL,
          max_tokens: 3000,
          system: systemPrompt,
          tool_choice: { type: "none" },
          messages,
        });

        await logAiUsage({
          userId: user.id,
          garaId,
          operazione: "chat_gara_wrapup",
          provider: "anthropic",
          model: MODEL,
          inputTokens: wrapUp.usage.input_tokens,
          outputTokens: wrapUp.usage.output_tokens,
        });

        rispostaFinale = wrapUp.content
          .map((block) => (block.type === "text" ? block.text : ""))
          .join("\n")
          .trim();
      }
    }
  } catch (err) {
    console.error("Errore chat gara:", err);
  }

  if (!rispostaFinale.trim()) {
    console.warn(
      "sendGaraMessage: nessun testo prodotto dal modello dopo il ciclo di strumenti.",
    );
  }

  const contenutoFinale =
    rispostaFinale ||
    "Non sono riuscito a completare la richiesta. Prova a riformularla in modo più semplice o dividila in passaggi più piccoli.";

  console.log(
    `sendGaraMessage: salvataggio messaggio finale per gara ${garaId}, fileGenerato=${
      fileGenerato ? fileGenerato.nomeFile : "nessuno"
    }`,
  );

  const { error: insertAiError } = await supabase.from("gara_messaggi").insert({
    gara_id: garaId,
    user_id: user.id,
    ruolo: "assistente",
    contenuto: contenutoFinale,
    file_nome: fileGenerato?.nomeFile ?? null,
    file_path: fileGenerato?.filePath ?? null,
  });

  if (insertAiError) {
    console.error("Errore salvataggio risposta AI:", insertAiError);
  }

  revalidatePath(`/dashboard/omnia-ai/gare/${garaId}`);
  return {};
}
