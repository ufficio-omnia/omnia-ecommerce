# Controllo dati e coerenza OMNIA

File versionato, non scritto dentro il codice: `src/lib/prompts.ts` lo
carica a runtime. Usato da `verificaDatiAziendali`
(`src/lib/verifica-dati-aziendali.ts`) subito dopo la generazione di ogni
sezione. Tre controlli in una sola chiamata — non tre chiamate separate,
per non moltiplicare il costo di ogni generazione:

1. R9 di `regole-omnia.md` ("nessun dato d'impresa inventato") con un
   controllo effettivo — verificato in pratica che l'istruzione nel
   prompt di generazione da sola non basta: il modello scrive comunque
   monte ore, numero di addetti e reperibilità senza alcuna fonte quando
   il profilo azienda non li contiene.
2. Coerenza numerica tra righe della stessa tabella (es. un tempo di
   intervento per un'urgenza più alta più lungo di quello per un'urgenza
   più bassa) — osservato in pratica su una tabella di gestione emergenze.
3. Coerenza tra titolo e contenuto di ogni paragrafo — osservato in
   pratica un titolo "Rotazione controllata degli addetti" il cui
   contenuto descriveva l'esatto contrario (assegnazione stabile).

<!-- INIZIO PROMPT -->
Confronta il testo dell'offerta tecnica sotto con i SOLI dati confermati forniti
(profilo azienda del cliente, estratti dai documenti di gara) e fai tre controlli, in
quest'ordine.

1. DATI SENZA FONTE. Trova ogni numero o affermazione specifica sull'IMPRESA del
cliente — monte ore, numero di addetti, turni e orari, tempi di intervento,
reperibilità, certificazioni, referenze, nomi di clienti, prodotti, macchinari, sedi
operative, esperienza pregressa, formazione già erogata, premi e riconoscimenti — che
NON trova un riscontro testuale nei dati confermati forniti. Non toccare: requisiti del
capitolato, riferimenti normativi, impegni di controllo/verifica che l'impresa propone
di assumere (sono la sua offerta, non un fatto sulle sue risorse attuali).

Come sostituirlo dipende da dove si trova:
- Fuori da una tabella (prosa): segnaposto tra parentesi quadre con l'indicazione
  precisa di cosa serve, es. "[DATO DA CONFERMARE: monte ore settimanale dedicato al
  servizio]".
- Dentro una cella di tabella: MAI la frase tra parentesi quadre, rompe la tabella. Se
  avevi scritto un valore specifico e realistico, lascialo in chiaro seguito da un
  asterisco — es. "30 minuti *" — un valore proposto ma non confermato, non un dato
  mancante. Se non hai nessun valore da proporre, scrivi solo "*" al posto del dato.

2. COERENZA NUMERICA DENTRO LA STESSA TABELLA. Confronta i valori di righe diverse
della stessa tabella quando descrivono livelli/gradi diversi della stessa cosa (es.
tempi di intervento per urgenza crescente, frequenze per priorità decrescente): un
valore che contraddice l'ordine logico degli altri (es. l'intervento per un'emergenza
GRAVE più lento di quello per una richiesta ORDINARIA) è un errore, anche se ciascun
valore preso da solo sembra plausibile. Se riesci a stabilire con sicurezza quale dei
due è sbagliato, correggilo; se non puoi saperlo con certezza, sostituisci ENTRAMBI i
valori in conflitto con "*" (stessa convenzione del punto 1) invece di indovinare quale
tenere.

3. COERENZA TRA TITOLO E CONTENUTO. Per ogni titolo di paragrafo/sotto-sezione,
verifica che descriva esattamente quello che il contenuto sottostante dice — non il
contrario, non un'approssimazione fuorviante. Se sono in contraddizione (es. un titolo
che parla di "rotazione" quando il contenuto descrive un'assegnazione stabile),
correggi il TITOLO perché rispecchi il contenuto reale: il contenuto è l'impegno vero,
il titolo è solo l'etichetta.

Lascia invariato tutto il resto: struttura, tabelle, formattazione, ogni contenuto già
riscontrabile nei dati confermati o già coerente.

Non essere permissivo: nel dubbio, applica la correzione. Un segnaposto o un asterisco
di troppo è un problema minore; un dato inventato, un'incoerenza numerica o un titolo
fuorviante lasciati nel testo sono un danno per il cliente.

Restituisci SOLO il testo completo risultante, senza commenti.
<!-- FINE PROMPT -->
