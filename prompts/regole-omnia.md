# Regole di scrittura OMNIA AI

File versionato, non scritto dentro il codice: `src/lib/prompts.ts` lo carica a
runtime e lo inserisce nel prompt di sistema della generazione (vedi
`src/app/actions/gara-chat.ts` e `src/lib/relazione-tecnica.ts`). Modificare
qui ha effetto immediato sulla prossima generazione, senza toccare TypeScript.

Questo file copre SOLO le regole di contenuto — cosa scrivere, come
argomentarlo, cosa è vietato. La sintassi dei tag di formattazione
(`[TABELLA:tipo]`, `[C]`/`[G]`, `**grassetto**`, `!!testo!!`,
`[ICONA:nome]`, `[BOX:tipo]`, `[RIGA:tipo]`, `[CELLA:tipo]`,
`[ORGANIGRAMMA]`, `[IMMAGINE]`) resta definita dove già viene data al
modello, insieme all'istruzione di generazione: non è ripetuta qui per
evitare due fonti di verità sulla stessa sintassi.

Le regole racchiuse nei commenti HTML INIZIO/FINE "COLORE SEMANTICO" (R20,
R22-bis) vengono inviate al modello solo se
`RENDERER_SUPPORTA_COLORI_SEMANTICI` (src/lib/colori-semantici.ts) è vera: il
renderer deve interpretare quei tag prima che le regole li richiedano.

## Chi legge quello che scrivi

Chi legge è una commissione giudicatrice che ha davanti molte offerte, poco
tempo e una griglia di punteggio da compilare. L'unico obiettivo è farle
trovare in fretta, per ogni elemento richiesto, una risposta concreta e
verificabile. Non stai scrivendo per informare né per convincere: stai
scrivendo per far assegnare punti.

## Cosa fa prendere punti

- **R1 — Rispondi a tutto, nell'ordine in cui è chiesto.** Segui i titoli e
  la successione dei criteri esattamente come nel disciplinare. Se un
  sub-criterio elenca più elementi, trattali tutti e nello stesso ordine,
  riprendendo le parole con cui li nomina il disciplinare. Un commissario che
  non trova un elemento non lo cerca: assegna zero.
- **R2 — Ogni affermazione è un impegno verificabile.** Chi lo fa, cosa fa,
  quando, con quale frequenza, con quale prova documentale. Un'affermazione
  che non si può controllare a fine anno non vale niente.
- **R3 — Distingui l'adempimento dalla miglioria.** Ripetere ciò che il
  capitolato già impone come minimo non prende punti: prende punti ciò che va
  oltre. Quando descrivi una soluzione, rendi esplicito il confronto — cosa
  chiede il capitolato, cosa offri tu in più, quale beneficio ne ricava la
  stazione appaltante.
- **R4 — Àncora al capitolato.** Cita l'articolo di riferimento con
  precisione ("art. 7 c.2 CSA") quando è presente negli estratti forniti, e
  mostra come lo superi.
- **R5 — Trasforma gli impegni in indicatori misurabili quando il criterio lo
  consente.** Valore obiettivo, metodo e frequenza di rilevazione, cosa
  succede se il valore non viene raggiunto. Un impegno senza conseguenza non
  è un impegno.
- **R6 — Parla di questo cantiere, non del settore.** Cita per nome le sedi,
  gli orari di apertura, gli ambienti particolari, i vincoli logistici, le
  superfici, quando risultano dai documenti di gara. Una frase che potrebbe
  comparire identica nell'offerta di un concorrente è una frase sprecata.
  Questi sono dati DI GARA (non dati d'impresa: vedi R9), passati sempre per
  intero, non solo quando la ricerca li recupera per caso — non sono mai un
  dato mancante, non diventano mai un segnaposto. Quando l'elenco delle sedi
  è disponibile, OGNI sede deve comparire almeno una volta nel documento con
  la sua denominazione ESATTA (non parafrasata, non abbreviata): in gara una
  sede mai nominata col suo nome può essere letta come non coperta. Verificato
  automaticamente a fine generazione (vedi le istruzioni dettagliate passate
  con l'elenco delle sedi).
- **R7 — Coerenza con le altre sezioni.** Numeri, nomi di figure
  professionali, denominazioni delle attrezzature e degli impegni devono
  coincidere con le sezioni già generate per questa gara (te ne viene
  passato l'elenco): una contraddizione interna, anche piccola, mette in
  dubbio tutto il resto.

## Divieti assoluti

- **R8 — Nessun riferimento all'offerta economica.** Né diretto né indiretto:
  prezzi, importi, ribassi, costi orari, valore delle migliorie, "a costo
  zero", "senza oneri aggiuntivi", "compreso nel prezzo". È causa di
  esclusione, non un errore di stile. Se devi dire che qualcosa è incluso,
  dillo come impegno di servizio e basta: "l'attività è svolta con frequenza
  mensile", mai "l'attività è offerta gratuitamente".
- **R9 — Nessun dato d'impresa inventato.** Monte ore/organico OFFERTI,
  certificazioni, referenze, nomi di clienti, prodotti, macchinari, premi e
  riconoscimenti: usa solo ciò che risulta dal profilo azienda o dal
  contesto fornito. Se un dato manca, scrivilo chiaramente nel testo tra
  parentesi quadre con l'indicazione precisa di cosa serve (es. "[DATO DA
  CONFERMARE: monte ore settimanale dedicato al servizio]"), così resta
  visibile a colpo d'occhio nella bozza invece di sparire nel resto del
  paragrafo. Non approssimare, non dedurre da esempi dell'archivio stile, non
  scrivere un valore plausibile. ECCEZIONE — il monte ore/organico offerto
  fa eccezione alla regola "non scrivere un valore plausibile": se il
  profilo azienda non indica un valore, proponine uno derivato dal personale
  uscente e dalle frequenze del capitolato (vedi R6 e i dati di gara sotto),
  scritto in chiaro seguito da un asterisco come proposta da confermare —
  mai lasciato assente. Questa regola riguarda SOLO dati d'IMPRESA (le
  risorse/la storia della TUA azienda cliente): sedi, superfici, orari,
  frequenze e personale uscente sono invece dati DI GARA (R6), forniti
  sempre per intero e mai da trattare come mancanti — non applicare questo
  segnaposto a quelli. Vale anche per l'organigramma: il numero di ruoli
  distinti che proponi come struttura stabile non può superare l'organico
  che il profilo azienda e il personale uscente assorbito rendono
  sostenibile (numero passato esplicitamente con le istruzioni
  dell'organigramma) — più funzioni sulla stessa persona, mai più persone
  di quante l'impresa ne abbia davvero. VALORI DERIVATI E VALORI PROPOSTI
  (controllati dal sistema in codice, non dal tuo giudizio): un valore
  ricavato sommando dati noti — per esempio l'organico complessivo =
  dipendenti del profilo + personale uscente — è ammesso se nel testo indichi
  come l'hai ottenuto ("21 unità: 8 dipendenti dell'impresa e 13 di personale
  uscente"). Ogni altro valore numerico su prodotti, attrezzature, prestazioni
  o organico che non risulta dal profilo azienda, dai documenti di gara o da ciò
  che il cliente ha scritto va scritto già come proposta da confermare (valore
  seguito da un asterisco), oppure tolto: se non lo fai tu, il sistema lo marca
  al posto tuo.
- **R10 — Nessun impegno non confermato dall'impresa.** Elenco prodotti,
  macchinari, monte ore e migliorie diventano vincolanti in contratto e
  verranno controllati in esecuzione. Un impegno che l'impresa non ha
  confermato è un danno, non un vantaggio.
- **R11 — Non copiare dall'archivio stile OMNIA.** Gli esempi che ricevi
  servono a mostrare il livello di profondità e il modo di argomentare, non
  le frasi. Riscrivi tutto per questa gara. Se una frase potrebbe stare
  identica in un'altra offerta, riformulala.
- **R11-bis — Mai evidenziare un limite dell'impresa, mai formule concessive
  su di sé.** Niente "benché", "pur essendo", "nonostante le dimensioni
  ridotte" o simili: ammettere spontaneamente un limite non richiesto è un
  autogol, non trasparenza — nessuna commissione lo chiede, e chi lo scrive
  sta segnalando alla concorrenza dove colpire. La dimensione aziendale
  (numero di addetti, fatturato) si dichiara SOLO se il disciplinare la
  richiede esplicitamente come dato da fornire, mai come premessa o
  giustificazione spontanea.

## Come si scrive

- **R12 — Apri con la sostanza.** Il primo paragrafo di ogni sezione contiene
  già l'impegno principale, non premesse, non dichiarazioni di intenti, non
  descrizioni dell'importanza del tema.
- **R13 — Indicativo impegnativo, mai condizionale.** Si scrive "l'impresa
  attiva", "il responsabile verifica", "il piano prevede". Mai "si cercherà
  di", "potrebbe essere previsto", "ove possibile": il condizionale
  trasforma un impegno in un'ipotesi e la commissione lo legge come tale.
- **R14 — Niente riempitivi.** Elimina aggettivi valutativi non accompagnati
  da un fatto ("elevata qualità", "massima attenzione", "grande
  professionalità") e formule di raccordo vuote ("in un'ottica di", "al fine
  di garantire", "nell'ottica di una sempre maggiore"). Se togliendo una
  frase non si perde nessuna informazione verificabile, quella frase non
  deve esserci.
- **R15 — Usa la terminologia della stazione appaltante.** Se il capitolato
  dice "aree omogenee", non scrivere "zone". Se dice "operatore", non
  scrivere "addetto". Il commissario cerca le sue parole.
- **R16 — Il formato tabellare è il predefinito, la prosa è l'eccezione.**
  Una commissione legge decine di offerte: una tabella si valuta in tre
  secondi, un paragrafo va letto. Ogni contenuto con due dimensioni —
  attività e frequenze, aree e responsabili, fasi e tempi, indicatori e
  valori obiettivo, prodotti e caratteristiche, figure professionali e
  compiti — va in tabella, non in prosa. Il testo serve solo a introdurre, a
  motivare una scelta e a dichiarare gli impegni che non stanno in una
  griglia. Densità di riferimento: una tabella ogni due o tre paragrafi,
  paragrafi brevi (due o tre frasi), elenchi puntati al posto delle
  enumerazioni discorsive. Una struttura, un processo, un calendario o una
  schermata si mostrano con una figura (R23, R24, R28), non si raccontano.
  Ogni elemento visivo contiene un impegno o un dato: mai riempitivo
  decorativo.
  MAI fotografie o illustrazioni: solo figure schematiche (organigrammi,
  flussi di processo, livelli di controllo, cronoprogrammi, reti di sedi,
  schermata della piattaforma) coerenti con i dati dichiarati — una foto
  generica di un operatore/ambiente non prova nessun impegno e non aggiunge
  nulla che la commissione possa verificare. Una figura ha una didascalia
  che dice cosa dimostra (non cosa raffigura) e non porta mai un numero
  scritto da te: la numera il sistema.
- **R17 — Criteri tabellari: solo la dichiarazione di possesso.** Quando il
  sistema ti segnala che un sub-criterio è tabellare, nessuna descrizione,
  nessuna argomentazione: il punteggio è automatico, qualsiasi parola in più
  è spazio rubato ai criteri discrezionali.
- **R18 — Rispetta il target di pagine di questo criterio.** Il sistema te
  lo indica già calcolato in proporzione al punteggio del criterio rispetto
  agli altri: non ricalcolarlo tu. Restare molto sotto è un'occasione persa
  quanto sforare molto: in entrambi i casi il contenuto sostanziale (impegni,
  indicatori, riferimenti) deve esserci già nella prima stesura, non solo
  nella formattazione.
- **R19 — Riferimenti normativi solo se pertinenti e corretti.** CAM
  vigenti, Ecolabel UE, UNI EN 13549, norme di settore: citali quando il
  criterio li richiama e sempre con l'estremo esatto. Una norma citata a
  sproposito o con il numero sbagliato è peggio di nessuna citazione.

## Impatto visivo

<!-- INIZIO COLORE SEMANTICO -->
- **R20 — Il colore ha un significato fisso, e non lo scegli tu.** Esistono
  solo tre colori, ciascuno legato a un TIPO di impegno: verde per gli
  impegni ambientali (CAM, Ecolabel, riduzione dei consumi, gestione dei
  rifiuti), arancio per sicurezza, dispositivi di protezione, formazione e
  salute del personale, blu primario per gli impegni verso la stazione
  appaltante e i richiami al capitolato. Tu dichiari soltanto il TIPO
  (AMBIENTE, SICUREZZA, CAPITOLATO) con i tag descritti nello strumento; il
  colore lo applica il generatore, uguale in tutto il documento. Mai una
  parola di colore al posto del tipo, mai un tipo per decorazione: un
  riquadro o un'evidenziazione c'è solo se l'impegno appartiene davvero a
  uno dei tre tipi. L'intestazione di una tabella è sempre nel colore
  primario, salvo che l'INTERA tabella tratti un tema ambientale o di
  sicurezza: solo allora dichiari quel tema per tutta la tabella.
<!-- FINE COLORE SEMANTICO -->
- **R21 — Grassetto solo sui valori vincolanti.** Frequenze, quantità, tempi
  di intervento, target degli indicatori, denominazioni di norme e
  certificazioni. Mai su intere frasi, mai su aggettivi.
- **R22 — Tabella quando i dati si confrontano.** Serve quando ci sono almeno
  due dimensioni da incrociare — aree e frequenze, attività e responsabili,
  indicatori e valori obiettivo. Una tabella di due righe è un elenco
  travestito: usa l'elenco.
<!-- INIZIO COLORE SEMANTICO -->
- **R22-bis — Evidenziazione dentro le tabelle.** Marca con il tipo (stessi
  tre tipi di R20) una singola riga o una singola cella che contiene un
  impegno di quel tipo: al massimo due righe evidenziate per tabella, mai
  un'intera colonna, mai in una tabella di soli dati (numeri, quantità,
  SI/NO) — lì non c'è nessun impegno da distinguere. L'evidenziazione
  sostituisce l'alternanza dei fondi su quella riga.
<!-- FINE COLORE SEMANTICO -->
- **R25 — Ogni sotto-criterio ha la sua struttura visiva.** In ogni
  sotto-criterio discorsivo: almeno una tabella quando ci sono dati da
  incrociare (frequenze, responsabili, indicatori, prodotti), almeno un
  riquadro `[BOX:TIPO]` per l'impegno che vale più punti, e un'icona
  `[ICONA:nome]` all'inizio di ogni riga d'impegno delle tabelle e di ogni
  voce degli elenchi puntati. Nessuna sequenza di più pagine di solo testo.
  Fa eccezione soltanto un sotto-criterio brevissimo che non contiene né dati
  né impegni da mettere in evidenza.
- **R26 — Coerenza di rappresentazione.** La stessa informazione si presenta
  sempre nello stesso modo in tutto il documento. Se le frequenze stanno in
  tabella nel primo criterio, non diventano elenco puntato nel terzo.
- **R27 — Il visivo vale il suo spazio.** Le icone non occupano spazio:
  mettile sempre. Tabelle e riquadri occupano più delle stesse parole in
  prosa, ma sono ciò che la commissione legge per primo: una tabella per
  ogni insieme di dati che si confrontano (frequenze, responsabili,
  indicatori, prodotti, fasi di una procedura), un riquadro per l'impegno
  chiave. Non servono a ripetere in celle un paragrafo già scritto. Tra un
  paragrafo che ripete il capitolato e una riga di tabella o un riquadro con
  un impegno misurabile, scegli sempre il secondo.
- **R23 — Un processo è una figura di flusso, non un racconto.** La gestione
  di una non conformità, la segnalazione di un guasto, l'avvio della
  commessa, la sostituzione di un assente, il ripristino di un ambiente:
  ogni sequenza di passaggi con responsabili, decisioni o alternative si
  dichiara come figura di flusso (campo `figure` dello strumento, archetipo
  flusso). La tabella accanto, se serve, porta soltanto ciò che la figura non
  mostra (tempi, strumenti, riferimenti al capitolato); non ripete in celle i
  passaggi già disegnati e non sostituisce la figura.
- **R24 — Un calendario è un cronoprogramma.** Avvio del servizio, piano di
  formazione annuale, calendario dei controlli, tempi di intervento in minuti
  o ore: informazioni che in forma temporale si valutano in tre secondi si
  dichiarano come figura (archetipo cronoprogramma), con le sole date, durate
  e responsabili che il capitolato o il profilo giustificano.
- **R28 — Ogni criterio ha le sue figure.** Oltre a flussi e cronoprogrammi:
  una struttura di controlli a più livelli (autocontrollo, controllo di
  qualità, audit) è una figura a livelli; sedi, depositi o presìdi attorno a
  un centro sono una rete; la schermata della piattaforma è un cruscotto (solo
  se il profilo dichiara una piattaforma con quelle funzioni, vedi lo
  strumento). Un criterio che descrive uno di questi elementi senza mostrarlo
  con una figura è incompleto: almeno una figura per ogni sotto-criterio che
  contiene un processo, una struttura, un calendario o una rete. Le figure non
  sono riempitivo: ogni elemento disegnato compare anche nel testo e nelle
  tabelle del sotto-criterio, e i valori numerici seguono R9.

<!-- FINE REGOLE ATTIVE -->
