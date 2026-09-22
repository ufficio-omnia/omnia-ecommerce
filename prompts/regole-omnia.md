# Regole di scrittura OMNIA AI

File versionato, non scritto dentro il codice: `src/lib/prompts.ts` lo carica a
runtime e lo inserisce nel prompt di sistema della generazione (vedi
`src/app/actions/gara-chat.ts` e `src/lib/relazione-tecnica.ts`). Modificare
qui ha effetto immediato sulla prossima generazione, senza toccare TypeScript.

Questo file copre SOLO le regole di contenuto — cosa scrivere, come
argomentarlo, cosa è vietato. La sintassi dei tag di formattazione
(`[TABELLA:colore]`, `[C]`/`[G]`, `**grassetto**`, `!!testo!!`,
`[ICONA:nome]`, `[BOX]`, `[ORGANIGRAMMA]`, `[IMMAGINE]`) resta definita dove
già viene data al modello, insieme all'istruzione di generazione: non è
ripetuta qui per evitare due fonti di verità sulla stessa sintassi.

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
- **R9 — Nessun dato d'impresa inventato.** Monte ore, organico,
  certificazioni, referenze, nomi di clienti, prodotti, macchinari, sedi
  operative, premi e riconoscimenti: usa solo ciò che risulta dal profilo
  azienda o dal contesto fornito. Se un dato manca, scrivilo chiaramente nel
  testo tra parentesi quadre con l'indicazione precisa di cosa serve (es.
  "[DATO DA CONFERMARE: monte ore settimanale dedicato al servizio]"), così
  resta visibile a colpo d'occhio nella bozza invece di sparire nel resto del
  paragrafo. Non approssimare, non dedurre da esempi dell'archivio stile, non
  scrivere un valore plausibile.
- **R10 — Nessun impegno non confermato dall'impresa.** Elenco prodotti,
  macchinari, monte ore e migliorie diventano vincolanti in contratto e
  verranno controllati in esecuzione. Un impegno che l'impresa non ha
  confermato è un danno, non un vantaggio.
- **R11 — Non copiare dall'archivio stile OMNIA.** Gli esempi che ricevi
  servono a mostrare il livello di profondità e il modo di argomentare, non
  le frasi. Riscrivi tutto per questa gara. Se una frase potrebbe stare
  identica in un'altra offerta, riformulala.

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
- **R16 — Scegli il formato giusto.** Tabella per dati confrontabili e
  frequenze, elenco per sequenze di azioni, paragrafo per argomentazioni,
  organigramma o immagine solo quando chiariscono davvero qualcosa che a
  parole richiederebbe più spazio. Non inserire un elemento visivo per
  decorare.
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

- **R21 — Grassetto solo sui valori vincolanti.** Frequenze, quantità, tempi
  di intervento, target degli indicatori, denominazioni di norme e
  certificazioni. Mai su intere frasi, mai su aggettivi.
- **R22 — Tabella quando i dati si confrontano.** Serve quando ci sono almeno
  due dimensioni da incrociare — aree e frequenze, attività e responsabili,
  indicatori e valori obiettivo. Una tabella di due righe è un elenco
  travestito: usa l'elenco.
- **R25 — Distribuisci gli elementi visivi.** Nessuna sequenza di più
  pagine di solo testo. Ma non forzare: se una sezione non ha nulla da
  rappresentare, resta testo.
- **R26 — Coerenza di rappresentazione.** La stessa informazione si presenta
  sempre nello stesso modo in tutto il documento. Se le frequenze stanno in
  tabella nel primo criterio, non diventano elenco puntato nel terzo.
- **R27 — Il visivo costa pagine.** Prima di inserire un elemento visivo
  chiediti se le stesse righe, usate per un impegno in più, varrebbero più
  punti. Se la risposta è sì, scrivi.

<!-- FINE REGOLE ATTIVE -->

## Regole rimandate alla migrazione a blocchi JSON

Le regole seguenti presuppongono capacità del renderer non ancora
implementate in `docx-generator.ts` (colore semantico fisso a livello di
intero documento, evidenziazione di singola riga/cella nelle tabelle, figure
di flusso, diagrammi temporali/cronoprogramma). Restano qui come riferimento
per quando la migrazione a blocchi JSON sarà completata. Il loader
(`src/lib/prompts.ts`) si ferma al marcatore sopra e non le invia al modello:
inviarle oggi produrrebbe tag che il renderer attuale non sa interpretare.

- **R20 — Il colore ha un significato fisso.** Verde per gli impegni
  ambientali (CAM, Ecolabel, riduzione dei consumi), arancio per sicurezza,
  dispositivi di protezione e formazione, colore primario per gli impegni
  verso la stazione appaltante e i richiami al capitolato — stesso criterio
  in tutto il documento, non a discrezione del modello per singola tabella
  come oggi.
- **R22-bis — Evidenziazione dentro le tabelle.** Colore semantico (stessa
  corrispondenza di R20) su una singola riga o singola cella, al massimo due
  righe evidenziate per tabella, mai un'intera colonna.
- **R23 — Figura di flusso solo se chiarisce un processo.** Da tre a sei
  passi in sequenza, per processi come la gestione di una non conformità o
  l'avvio di una commessa.
- **R24 — Cronoprogrammi come diagramma temporale.** Piano di formazione
  annuale, calendario dei controlli, fasi di avvio del servizio: informazioni
  che in forma temporale si valutano in tre secondi invece che in forma
  tabellare.
