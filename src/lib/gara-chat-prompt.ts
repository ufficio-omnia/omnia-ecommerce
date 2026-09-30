import type Anthropic from "@anthropic-ai/sdk";
import { limitePagineConMargine } from "@/lib/stima-pagine";
import { REGOLE_OMNIA } from "@/lib/prompts";
import { calcolaBudgetSottoCriteri, formattaBudgetPerPrompt, formattaTettiPerStrumento, type BudgetGara } from "@/lib/sotto-criteri";

// Estratto da src/app/actions/gara-chat.ts: quel file ha "use server", che
// impone che OGNI export sia una funzione async (i Server Action di
// Next.js) — buildSystemPrompt e buildGeneraBozzaTool sono pure funzioni
// sincrone, quindi vivono qui. Permette anche di riusarle da uno script di
// test (generazione reale, stesso prompt esatto) senza duplicarne la
// logica, con lo stesso rischio di disallineamento visto altrove in
// questo progetto.

export type CriterioRiepilogo = { numero: string; titolo: string; punti_max: number };

export type SedeGara = {
  denominazione: string;
  indirizzo?: string | null;
  superficie_mq?: number | null;
  orari_apertura?: string | null;
  frequenze?: string | null;
};

export type PersonaleUscente = {
  livello_contrattuale: string;
  numero_addetti: number;
  ore_settimanali?: number | null;
  anzianita?: string | null;
  note?: string | null;
};

export type GaraContesto = {
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
  sedi: SedeGara[] | null;
  personale_uscente: PersonaleUscente[] | null;
};

export type CompanyContesto = {
  ragione_sociale: string | null;
  forma_giuridica: string | null;
  numero_dipendenti: number | null;
  fatturato_medio_annuo: number | null;
  certificazioni: string | null;
  referenze: string | null;
  settori_attivita: string | null;
  presentazione: string | null;
} | null;

// Ripartizione proporzionale delle pagine totali tra i criteri in base al
// punteggio di ciascuno (più punti vale un criterio, più pagine merita):
// calcolata qui in modo deterministico invece di lasciare che il modello
// stimi le proporzioni da solo leggendo il testo libero del disciplinare
// — un semplice calcolo aritmetico, niente per cui valga la pena rischiare
// un'interpretazione sbagliata dell'AI su numeri che abbiamo già
// estratti in forma strutturata.
// Budget per SOTTO-CRITERIO (proporzionale ai punti), o null se dal
// disciplinare non si ricavano sotto-criteri con i punti: in quel caso resta
// il solo budget per criterio qui sotto.
export function budgetSottoCriteriDiGara(gara: GaraContesto): BudgetGara | null {
  return calcolaBudgetSottoCriteri({
    criteriValutazione: gara.criteri_valutazione,
    criteriRiepilogo: gara.criteri_riepilogo,
    punteggioTecnicoMax: gara.punteggio_tecnico_max,
    limitePagineTotale: gara.limite_pagine_totale,
    subCriteriTabellari: gara.sub_criteri_tabellari,
    formattazione: {
      dimensioneCarattere: gara.relazione_dimensione_carattere ?? undefined,
      interlinea: gara.relazione_interlinea ?? undefined,
    },
  });
}

function calcolaRipartizionePagine(gara: GaraContesto): string {
  const { limite_pagine_totale, punteggio_tecnico_max, criteri_riepilogo } = gara;
  if (!limite_pagine_totale || !punteggio_tecnico_max || !criteri_riepilogo?.length) {
    return "";
  }

  // Con i sotto-criteri disponibili la ripartizione è per SOTTO-CRITERIO e
  // vale come vincolo (tetto), non come raccomandazione: sostituisce quella
  // per solo criterio, che lasciava al modello la libertà di distribuire le
  // pagine dentro il criterio e produceva documenti del 50% più lunghi.
  const budgetGara = budgetSottoCriteriDiGara(gara);
  if (budgetGara) {
    const titoli = new Map(criteri_riepilogo.map((c) => [c.numero.trim(), c.titolo]));
    return `\n${formattaBudgetPerPrompt(budgetGara, titoli)}\n`;
  }

  // Il target reale resta sotto il limite dichiarato dal disciplinare
  // (vedi limitePagineConMargine): la stima di pagine non è un conteggio
  // Word reale, puntare esattamente al limite rischia di sforarlo.
  const limiteConMargine = limitePagineConMargine(limite_pagine_totale);

  const righe = criteri_riepilogo.map((c) => {
    const quota = c.punti_max / punteggio_tecnico_max;
    const pagine = Math.max(1, Math.round(quota * limiteConMargine));
    return `- Criterio ${c.numero} "${c.titolo}": ${c.punti_max}/${punteggio_tecnico_max} punti (${Math.round(quota * 100)}%) → circa ${pagine} pagine`;
  });

  return `\nRipartizione raccomandata delle ${limiteConMargine} pagine (già ridotte di un margine di sicurezza rispetto al limite dichiarato di ${limite_pagine_totale}, per non rischiare di sforarlo) tra i criteri, calcolata in proporzione al punteggio di ciascuno (usala come target per QUESTO criterio quando decidi quanto scrivere, vedi istruzioni dettagliate nello strumento "genera_bozza_sezione"). ATTENZIONE: una tabella occupa MOLTO più spazio per parola del testo normale (le colonne strette costringono ogni cella ad andare a capo più spesso) — un criterio ricco di tabelle raggiunge il target di pagine con MENO parole di uno scritto solo in prosa: non aggiungere testo extra "per compensare" solo perché hai usato tabelle.\n${righe.join("\n")}\n`;
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

function formattaSedi(sedi: SedeGara[] | null): string {
  if (!sedi?.length) return "";
  return sedi
    .map((s, i) => {
      const dettagli = [
        s.indirizzo ? `indirizzo: ${s.indirizzo}` : null,
        s.superficie_mq ? `superficie: ${s.superficie_mq} mq` : null,
        s.orari_apertura ? `orari di apertura: ${s.orari_apertura}` : null,
        s.frequenze ? `frequenze previste dal capitolato: ${s.frequenze}` : null,
      ]
        .filter(Boolean)
        .join("; ");
      return `${i + 1}. ${s.denominazione}${dettagli ? ` — ${dettagli}` : ""}`;
    })
    .join("\n");
}

function formattaPersonaleUscente(personale: PersonaleUscente[] | null): string {
  if (!personale?.length) return "";
  return personale
    .map((p, i) => {
      const dettagli = [
        `${p.numero_addetti} addett${p.numero_addetti === 1 ? "o" : "i"}`,
        p.ore_settimanali ? `${p.ore_settimanali} ore settimanali` : null,
        p.anzianita ? `anzianità: ${p.anzianita}` : null,
        p.note || null,
      ]
        .filter(Boolean)
        .join(", ");
      return `${i + 1}. ${p.livello_contrattuale} — ${dettagli}`;
    })
    .join("\n");
}

// Passati SEMPRE alla generazione e alla verifica in forma diretta,
// completa e strutturata — non solo quando la ricerca per somiglianza
// (contestoDocumenti, dipendente dal singolo messaggio) li recupera per
// caso. Prima di questa estensione dell'estrazione, sedi e personale
// uscente esistevano solo come testo libero dentro i documenti caricati:
// raggiungibili unicamente tramite RAG, quindi comparivano o sparivano a
// seconda di cosa il modello chiedeva in quel momento, e finivano spesso
// segnaposto nonostante fossero scritti nero su bianco nel capitolato.
export function formattaDatiGaraStrutturati(gara: Pick<GaraContesto, "sedi" | "personale_uscente">): string {
  const sediTesto = formattaSedi(gara.sedi);
  const personaleTesto = formattaPersonaleUscente(gara.personale_uscente);
  if (!sediTesto && !personaleTesto) return "";
  const parti: string[] = [];
  if (sediTesto) parti.push(`Sedi/immobili oggetto del servizio:\n${sediTesto}`);
  if (personaleTesto) parti.push(`Personale uscente ai fini della clausola sociale:\n${personaleTesto}`);
  return parti.join("\n\n");
}

// Regola esplicita di copertura sedi: R6 ("cita per nome le sedi... quando
// risultano dai documenti") si è rivelata troppo debole in pratica — il
// modello ha citato le sedi con un elenco discorsivo, parafrasando i nomi
// invece di riportarli esatti (osservato su una gara reale: "Servizio
// Ambiente e Idrico" al posto di "SERVIZIO AMBIENTE E IDRICO rimanente"),
// e il controllo di livello 2 (che cerca la denominazione ESATTA) segnalava
// la sede come mai citata. In gara una sede non nominata con il suo nome
// esatto rischia di essere letta dalla commissione come non coperta: qui la
// regola diventa un elenco esplicito e verificabile, non una descrizione
// generica.
function regolaCoperturaSedi(gara: Pick<GaraContesto, "sedi">): string {
  if (!gara.sedi?.length) return "";
  const elenco = gara.sedi.map((s) => `"${s.denominazione}"`).join(", ");
  return `COPERTURA OBBLIGATORIA DELLE SEDI (verificata automaticamente sul documento finale): ognuna delle sedi elencate sopra deve comparire ALMENO UNA VOLTA in tutto il documento con la sua denominazione ESATTA, copiata carattere per carattere da come è scritta qui sopra — non parafrasarla, non abbreviarla, non sostituirla con una descrizione generica del tipo "le sedi comunali" o un elenco che ne cambia anche solo la dicitura: una sede citata con un nome diverso da quello esatto conta come NON citata. Il punto più naturale per farlo è il criterio/sotto-criterio che descrive l'organizzazione del servizio (piano di lavoro, turni, responsabilità per sede), ma se generi altre sezioni che toccano una sede specifica, usa comunque il suo nome esatto lì. A documento completo nessuna sede della lista deve restare priva di almeno una citazione col nome esatto. Denominazioni esatte da usare, una per una: ${elenco}.\n`;
}

// Numero di persone su cui l'organigramma può REALMENTE contare: organico
// dichiarato dal profilo azienda più il personale uscente assorbito per
// clausola sociale (che diventa organico dell'impresa per QUESTA commessa).
// Esportata perché lo stesso identico calcolo serve al controllo di
// coerenza in scripts/verifica-livello2.ts — un secondo calcolo scritto a
// mano lì rischierebbe di disallinearsi da questo.
export function organicoDisponibile(gara: Pick<GaraContesto, "personale_uscente">, company: CompanyContesto): number | null {
  const dipendenti = company?.numero_dipendenti;
  if (dipendenti == null) return null;
  const uscente = (gara.personale_uscente ?? []).reduce((tot, p) => tot + (p.numero_addetti ?? 0), 0);
  return dipendenti + uscente;
}

// Regola esplicita di coerenza organigramma/organico — osservato in pratica
// (audit AI su una gara reale): una struttura con 9 figure specialistiche
// distinte e stabili (Responsabile di Commessa, RSPP, 3 Caposquadra...)
// proposta con solo 8 dipendenti dichiarati, senza che nessuna fosse
// marcata come proposta/condivisa. Il numero va calcolato qui (non lasciato
// al modello, stesso motivo della ripartizione pagine: pura aritmetica su
// dati già estratti) e passato come tetto esplicito.
function avvisoCoerenzaOrganico(gara: GaraContesto, company: CompanyContesto): string {
  const totale = organicoDisponibile(gara, company);
  if (totale == null) return "";
  const uscente = (gara.personale_uscente ?? []).reduce((tot, p) => tot + (p.numero_addetti ?? 0), 0);
  return `COERENZA ORGANIGRAMMA/ORGANICO (obbligatoria, vale per ogni [ORGANIGRAMMA] che generi): l'organico complessivamente disponibile per questa commessa è ${totale} persone (${company?.numero_dipendenti} dipendenti dichiarati dal profilo azienda + ${uscente} del personale uscente assorbito per clausola sociale). Il numero di RUOLI/CASELLE DISTINTE nell'organigramma (ogni casella, ogni "• " puntato, ogni casella laterale "<"/">" conta come una persona) non può superare questo totale. Se il disciplinare richiede più funzioni specialistiche di quante persone siano disponibili, NON inventare figure separate per riempire l'organigramma: assegna più funzioni alla STESSA persona nella STESSA casella (es. "Responsabile di Commessa / RSPP", non due caselle), oppure ometti un ruolo che il disciplinare non richiede esplicitamente. Una struttura proposta come stabile con più teste di quante l'azienda ne abbia è un dato d'impresa inventato (R9), anche se nessuna singola casella contiene un numero falso.\n`;
}

const CONTENUTO_SEZIONE_DESCRIZIONE_BASE =
  "Contenuto completo di QUESTA sezione in testo semplice, DENSO e articolato come nei progetti di riferimento (ARCHIVIO STILE OMNIA) — NON un riassunto. IMPORTANTE — la lunghezza NON è un numero fisso: se il contesto include una 'Ripartizione raccomandata delle pagine', individua la riga che corrisponde al criterio che stai scrivendo ORA e usa il numero di pagine lì indicato come target per QUESTA sezione — è già calcolato in proporzione al punteggio di questo criterio rispetto agli altri, non ricalcolarlo tu. ATTENZIONE: una pagina NON equivale a un numero fisso di parole — dipende da quante tabelle/immagini usi, che occupano più spazio delle stesse parole scritte come prosa (colonne strette = più a capo): se questa sezione ha molte tabelle, richiederà MENO testo per raggiungere il target di pagine. Se questo stesso criterio ha già bozze precedenti elencate in 'Bozze di sezione già generate', sottrai le pagine già scritte per QUELLO STESSO criterio dal suo target (non dal totale generale) per capire quanto spazio resta. Se la ripartizione non è disponibile (dati non ancora estratti), usa come riferimento il limite massimo di pagine indicato nel disciplinare e il peso/punteggio di questo criterio rispetto agli altri, oppure il livello di dettaglio dei progetti nell'archivio di riferimento per un criterio di importanza comparabile. Un contenuto troppo corto rispetto al target è un'occasione persa quanto un contenuto che lo supera ampiamente: entrambi vanno evitati. Struttura: usa '## ' per ogni sub-criterio (es. 'A.1 ...') e '### ' per ogni punto in cui il disciplinare articola quel sub-criterio — non fermarti al primo livello, scendi sempre al terzo se il disciplinare specifica punti/lettere sotto un sub-criterio. La numerazione/lettering del terzo livello NON è a tua scelta: riusa ESATTAMENTE quella del disciplinare così come appare in 'Criteri di valutazione' (es. se il disciplinare usa lettere 'a) b) c)' sotto il sub-criterio 1.1, i tuoi titoli di terzo livello sono '### a) ...', '### b) ...', '### c) ...' — MAI '### 1.1.1 ...'/'### 1.1.2 ...' o un'altra numerazione inventata). Il numero di punti di terzo livello è quello che il disciplinare elenca per quel sub-criterio, né uno di più né uno di meno — e ciascuno deve trattare esattamente l'argomento di quel punto, non un argomento a piacere. Non usare '# ' qui: il titolo di questa sezione lo passi già nel campo 'titolo_sezione'. Non includere MAI punteggi/pesi del criterio (es. '(Punteggio massimo 34/80)') nei titoli o nel testo: sono informazioni del bando, non contenuto dell'offerta. Nell'archivio di riferimento le evidenziazioni seguono una convenzione precisa, non casuale: usa '!!testo!!' (colorato, segue il tema della tabella o il blu del brand nel testo normale) SPECIFICAMENTE per nomi di ruoli/figure professionali/uffici/enti quando compaiono nel testo o in tabella (es. '!!Responsabile di Servizio!!', '!!RSPP!!', '!!Ufficio Qualità!!', '!!Direzione Lavori!!') — è così che l'archivio segnala chi fa cosa. MAI mettere '!!...!!' o '[ICONA:...]' dentro '**...**' (es. mai '**!!Responsabile!!**' o '**[ICONA:sicurezza]**'): sono già evidenziati di loro, annidarli nel grassetto li rende testo letterale non riconosciuto invece che un'icona/un colore. Quando descrivi un requisito o un impegno importante richiesto dal capitolato/disciplinare/altri documenti di gara, cita SEMPRE il riferimento preciso (articolo, paragrafo o sezione del documento, es. 'come richiesto dall'art. 12 del Capitolato Speciale d'Appalto' o 'in conformità al par. 3.2 del Disciplinare') quando quel riferimento è presente negli estratti forniti — non lasciare l'affermazione generica se il documento la ancora a un articolo specifico. Usa '**testo**' per il grassetto su termini tecnici chiave, definizioni, risultati/numeri rilevanti (es. '**0,42 kWh/mq**') ed etichette a inizio elenco puntato (es. '**Tecnologia:** ...'), e nella prima colonna di una tabella quando contiene un'etichetta/nome riga. Usa '*testo*' per il corsivo su note/precisazioni minori. Applica queste evidenziazioni con la STESSA FREQUENZA e secondo lo STESSO CRITERIO dell'archivio di riferimento: nei progetti reali quasi ogni paragrafo ha almeno un ruolo colorato o un termine tecnico in grassetto — un paragrafo denso di contenuto tecnico senza nessuna evidenziazione è un segnale che stai scrivendo in modo troppo discorsivo/generico. Usa la sintassi tabella markdown ('| colonna | colonna |' seguita da una riga '|---|---|') per vere tabelle Word: intestazione colorata e centrata, corpo con celle centrate in verticale e righe alternate automaticamente — l'archivio di riferimento usa tabelle in quasi ogni sottosezione (piani di lavoro, frequenze, ruoli, tempistiche, KPI): includi una tabella ogni volta che i dati si prestano a un formato tabellare, non solo una per l'intera sezione. Puoi scegliere il colore dell'intestazione mettendo '[TABELLA:BLU]', '[TABELLA:ROSSA]', '[TABELLA:VERDE]' o '[TABELLA:ARANCIONE]' come riga subito sopra la tabella (senza riga vuota in mezzo): usa BLU (default, anche omettendo il tag) per dati operativi generali, ROSSA per obblighi normativi/contrattuali vincolanti, VERDE per aspetti ambientali/sostenibilità, ARANCIONE per avvisi/attenzioni — come fa l'archivio di riferimento, che varia il colore delle tabelle in base al contenuto, non usa sempre lo stesso. Dentro una cella di tabella puoi anteporre al testo '[C]' per centrarlo orizzontalmente (valori brevi/categorici/numerici: quantità, frequenze, sì/no, ed etichette di riga nella prima colonna) o '[G]' per giustificarlo (testo descrittivo più lungo) — usa uno dei due su OGNI cella, senza eccezioni: nessuna cella deve restare senza tag, prima colonna inclusa (senza tag il default è comunque centrato, ma scegliere tu esplicitamente in base al contenuto è sempre meglio del default). Una cella non può MAI restare vuota: se non hai un dato specifico per quella cella, scrivi comunque un valore proposto seguito da asterisco (es. '[C]30 minuti *') o, se non hai nessun valore da proporre, un asterisco da solo (es. '[C]*') — mai testo assente, mai uno spazio, mai un trattino usato come riempitivo senza significato. Il tag '[C]'/'[G]' NON sostituisce il grassetto e non è un'alternativa ad esso: si usano SEMPRE insieme, esattamente come nel resto del testo — il tag sceglie l'allineamento, '**testo**' evidenzia dentro la cella (es. '[C]**Responsabile di Commessa**', '[G]Verifica **mensile** dei DPI con **report** firmato'). Una tabella dove nessuna cella ha una sola parola in grassetto è quasi sempre un errore quanto una cella senza tag: nei progetti di riferimento la prima colonna (etichette/nomi riga) è quasi sempre in grassetto, e termini tecnici/numeri chiave lo sono anche nelle altre colonne. In una cella di tabella o in una riga di elenco puntato (dopo l'eventuale '[C]'/'[G]'), puoi anteporre al testo un tag '[ICONA:nome]' (es. '[ICONA:sicurezza] Verifica DPI mensile') per affiancare una piccola icona — nomi disponibili: pulizia, sicurezza, formazione, ambiente, certificazione, qualita, tempistiche, personale, comunicazione, monitoraggio, logistica, attrezzature, documentazione. Usale solo dove aggiungono davvero chiarezza visiva (una riga su due in una tabella, non ovunque), come nei progetti di riferimento. Usa un blocco '[BOX]testo del box, anche su più paragrafi[/BOX]' per evidenziare un contenuto importante in un riquadro con sfondo colorato (es. un obbligo normativo, una garanzia, un impegno chiave) — con lo stesso criterio dei box evidenziati nell'archivio di riferimento: solo per contenuti che meritano davvero risalto, non per paragrafi qualsiasi. Righe che iniziano con '- ' per gli elenchi puntati. Usa un blocco '[ORGANIGRAMMA]...[/ORGANIGRAMMA]' con un elenco a rientri (2 spazi per livello) per generare uno schema gerarchico disegnato come immagine — usalo per organigrammi di commessa e strutture di responsabilità, adattando SEMPRE ruoli/uffici/numero di sedi a quanto risulta dai documenti di QUESTA gara (mai riusare nomi di ruolo di un'altra gara: cambiano sempre — es. RUP o DEC, un responsabile di commessa o un direttore generale dei lavori, una o più sedi/zone). CORRETTEZZA GERARCHICA (obbligatoria, errore grave se violata): ogni nodo deve essere figlio diretto di chi lo supervisiona REALMENTE, non del vertice della catena. Il personale operativo/addetti/operatori NON riporta mai direttamente al Responsabile di Commessa o a un Coordinatore: sta sempre all'ultimo livello, sotto il Caposquadra/Supervisore di riferimento specifico. Se un ruolo intermedio (es. Caposquadra) deve avere a sua volta dei subordinati (es. Addetti), quel ruolo deve essere un nodo vero e proprio con un rientro (mai una voce '• ' dentro un'altra casella: le voci '• ' sono solo per ruoli senza ulteriori sottoposti, un elenco informativo terminale). Prima di chiudere il blocco, ripercorri ogni ramo dall'alto in basso e verifica che rappresenti una reale linea di comando. COMPLETEZZA (obbligatoria): includi OGNI figura/ruolo che nomini nel testo della sezione stessa (es. se nel testo scrivi di un Ispettore Qualità, di un RSPP e di un Referente Reperibilità H24 come ruoli distinti, l'organigramma deve avere tre nodi distinti per loro, non accorpali in uno solo) — l'organigramma deve essere lo specchio esatto delle figure descritte nel testo, non una versione semplificata o diversa da una generazione precedente. Oltre alla semplice etichetta, disponi di: '{LIVELLO:Nome}' subito dopo il testo di un nodo per assegnarlo a una categoria con colore e legenda dedicati (es. 'Responsabile di Commessa {LIVELLO:Governo}') — usa 2-4 livelli semanticamente distinti (es. Direzione, Governo, Coordinamento operativo), non uno per nodo; righe indentate che iniziano con '• ' per un elenco puntato DENTRO la casella del nodo padre invece di caselle separate, solo per ruoli terminali senza sottoposti propri; '< Testo' o '> Testo' come figlio di un nodo per una casella laterale (sinistra/destra) collegata con freccia bidirezionale invece che sotto (per figure di staff affiancate, es. Preposto Sicurezza/Ispettore Qualità accanto al Responsabile di Commessa); un blocco finale '[BANNER]testo[/BANNER]' (fuori dalla gerarchia, anche più di uno) per una fascia colorata a piena larghezza in fondo allo schema (es. per un pool sostitutivo/jolly). I loghi (aziendale, del software gestionale, del cliente) vengono aggiunti automaticamente se caricati nel profilo/nella gara: non serve fare nulla per questo. NIENTE fotografie o illustrazioni, in nessuna forma: la relazione tecnica contiene solo figure schematiche (organigramma, tabelle) — una foto generica di un operatore/ambiente non prova nessun impegno e non aggiunge nulla che la commissione possa verificare (R16). Separa i paragrafi/tabelle/box/organigrammi con una riga vuota (eccetto il tag '[TABELLA:colore]', che va subito sopra la tabella senza riga vuota). PROMEMORIA: '[C]' e '[G]' esistono SOLO dentro una cella di tabella, mai in un paragrafo o elenco normale fuori tabella. '[ORGANIGRAMMA]' e '[BOX]' vanno SEMPRE chiusi con il tag corrispondente ('[/ORGANIGRAMMA]', '[/BOX]'): un tag di apertura senza chiusura non viene riconosciuto.";

export function buildGeneraBozzaTool(gara: GaraContesto): Anthropic.Tool {
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

  // Vincolo di lunghezza per sotto-criterio, ripetuto qui (oltre che nel
  // prompt di sistema) per lo stesso motivo dell'avviso tabellare sopra: è
  // qui che il modello decide quanto scrivere. Sostituisce l'invito a non
  // "scrivere troppo poco", che con un tetto vincolante è fuorviante.
  const budgetGara = budgetSottoCriteriDiGara(gara);
  const descrizioneContenuto = budgetGara
    ? formattaTettiPerStrumento(budgetGara) +
      CONTENUTO_SEZIONE_DESCRIZIONE_BASE.replace(
        "Un contenuto troppo corto rispetto al target è un'occasione persa quanto un contenuto che lo supera ampiamente: entrambi vanno evitati.",
        "Il tetto per sotto-criterio (VINCOLO DI LUNGHEZZA all'inizio di questa descrizione) prevale su ogni altra indicazione di lunghezza: scrivere sotto il tetto è accettabile, superarlo no.",
      )
    : CONTENUTO_SEZIONE_DESCRIZIONE_BASE;

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
            avvisoTabellare + descrizioneContenuto,
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

export function buildSystemPrompt(
  gara: GaraContesto,
  company: CompanyContesto,
  contestoDocumenti: string,
  contestoKnowledgeBase: string,
  notaStileKnowledgeBase: string,
  struttureKnowledgeBase: string,
  sezioniEsistenti: string,
): string {
  return `Sei OMNIA AI, assistente specializzato in gare d'appalto per servizi di pulizia. Aiuti il cliente ad analizzare la gara "${gara.titolo}" e a preparare l'offerta tecnica ed economica.

=== REGOLE DI SCRITTURA OMNIA (massima priorità, valgono per ogni sezione che generi) ===
${REGOLE_OMNIA}
=== FINE REGOLE DI SCRITTURA OMNIA ===

Dati della gara:
- Scadenza: ${gara.scadenza ?? "non specificata"}
- Importo a base d'asta: ${gara.importo ?? "non specificato"}
- Criteri di valutazione: ${gara.criteri_valutazione ?? "non ancora estratti dai documenti"}
IMPORTANTE — FEDELTÀ CHIRURGICA AI CRITERI: quanto riportato sopra in "Criteri di valutazione" è il testo del disciplinare per QUESTA gara, non un riassunto libero. Quando generi una sezione, il "titolo_sezione" e i sotto-argomenti ('## '/'### ') devono corrispondere ESATTAMENTE (stessa numerazione, stessa dicitura, stessa articolazione in sotto-criteri) a quanto scritto qui — non rinominare, non accorpare, non dividere diversamente, non inventare sotto-criteri che il disciplinare non elenca e non ometterne nessuno di quelli elencati. Se un dettaglio ti serve ma non è chiaro da questo riassunto, controlla gli "Estratti pertinenti" sotto prima di scrivere; se resta comunque ambiguo, segnalalo al cliente invece di inventare. Questo vale SEMPRE, anche quando adatti struttura/stile/livello di dettaglio dall'archivio OMNIA più sotto: l'archivio ispira come scrivere, MAI cosa sono i criteri di questa gara specifica.
CRITERI/SUB-CRITERI "TABELLARI" (regola permanente, vale per ogni gara): alcuni sub-criteri del disciplinare non chiedono una descrizione ma la sola compilazione di una tabella/griglia/checklist di conformità (es. "il concorrente barra le caratteristiche possedute", "dichiara sì/no", "compila la tabella allegata") — per QUESTI, e SOLO per questi, non scrivere alcun testo descrittivo, nessuna tabella inventata, nessun contenuto: scrivi ESCLUSIVAMENTE, come unica riga per quel sub-criterio, la dicitura "CRITERIO TABELLARE - COMPILARE" (verrà mostrata automaticamente in rosso ed evidenziata dal sistema, non serve formattarla tu). Serve a segnalare al cliente che deve compilarla lui con i dati reali della sua offerta, che l'AI non può inventare.${elencoSubCriteriTabellari(gara)} Non applicarla per errore a sub-criteri che invece chiedono una descrizione/motivazione: nel dubbio, tratta il sub-criterio come discorsivo (scrivi il contenuto) piuttosto che tabellare.
- Requisiti di partecipazione: ${gara.requisiti ?? "non ancora estratti dai documenti"}
- Limiti di pagine/formattazione dell'offerta tecnica: ${gara.limiti_formattazione ?? "non ancora estratti dai documenti"} — USA SEMPRE questa informazione (insieme al peso di ciascun criterio sopra) per decidere quanto materiale scrivere in ciascuna sezione che generi: vedi istruzioni dettagliate nello strumento "genera_bozza_sezione".
- Sedi/immobili e personale uscente della clausola sociale: ${formattaDatiGaraStrutturati(gara) || "non ancora estratti in forma strutturata dai documenti"}
REGOLA DI PRIORITÀ DELLE FONTI SU SEDI E PERSONALE USCENTE (obbligatoria, massima priorità — vedi anche R6): quanto elencato sopra sotto "Sedi/immobili e personale uscente" è dato DI GARA, verificato in fase di estrazione documenti — non un dato d'impresa da confermare. Usalo SEMPRE per nome/numero quando scrivi un passaggio pertinente (denominazione e orari della sede, superfici, frequenze del capitolato, numero/livello/ore del personale uscente): non è MAI corretto trattarlo come mancante o sostituirlo con un segnaposto, è già confermato. Diverso è il MONTE ORE/ORGANICO CHE LA TUA AZIENDA CLIENTE OFFRE per il servizio (una scelta dell'impresa per la propria offerta, non il dato storico del personale uscente sopra, che appartiene al gestore uscente): se il profilo azienda cliente non indica un valore specifico per l'organico offerto, NON lasciarlo vuoto e non generalizzare — PROPONI un valore concreto derivato dal numero di addetti/ore del personale uscente sopra e dalle frequenze richieste dal capitolato per le sedi coinvolte, scritto in chiaro seguito da un asterisco come proposta da confermare (es. "16 ore settimanali *", non un intervallo vago). Questa distinzione (dato di gara mai segnaposto vs. proposta dell'impresa sempre presente ma marcata "*") vale anche nel controllo automatico che segue questa generazione.
${regolaCoperturaSedi(gara)}${avvisoCoerenzaOrganico(gara, company)}
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
