# Controllo dati e coerenza OMNIA

File versionato, non scritto dentro il codice: `src/lib/prompts.ts` lo
carica a runtime. Usato da `verificaDatiAziendali`
(`src/lib/verifica-dati-aziendali.ts`) subito dopo la generazione di ogni
sezione. Quattro controlli in una sola chiamata — non quattro chiamate
separate, per non moltiplicare il costo di ogni generazione:

1. R9 di `regole-omnia.md` ("nessun dato d'impresa inventato") con un
   controllo effettivo — verificato in pratica che l'istruzione nel
   prompt di generazione da sola non basta: il modello scrive comunque
   monte ore, numero di addetti e reperibilità senza alcuna fonte quando
   il profilo azienda non li contiene. Include la regola di priorità
   delle fonti: sedi/superfici/orari/frequenze/personale uscente sono
   dati DI GARA (passati sempre per intero da `verificaDatiAziendali`,
   non solo quando la ricerca per somiglianza li recupera) e non vanno
   MAI trattati come mancanti.
2. Coerenza numerica tra righe della stessa tabella (es. un tempo di
   intervento per un'urgenza più alta più lungo di quello per un'urgenza
   più bassa) — osservato in pratica su una tabella di gestione emergenze.
3. Coerenza tra titolo e contenuto di ogni paragrafo — osservato in
   pratica un titolo "Rotazione controllata degli addetti" il cui
   contenuto descriveva l'esatto contrario (assegnazione stabile).
4. Nessuna cella di tabella vuota — osservato in pratica che il formato
   del segnaposto (punto 1) non veniva sempre seguito, ma il problema
   più grave era una cella lasciata completamente vuota: un dato mancante
   invisibile può arrivare in gara senza che nessuno se ne accorga,
   mentre un segnaposto nel formato sbagliato si nota comunque.

<!-- INIZIO PROMPT -->
Confronta il testo dell'offerta tecnica sotto con i SOLI dati confermati forniti
(profilo azienda del cliente, sedi/personale uscente di questa gara, estratti dai
documenti di gara) e fai quattro controlli, in quest'ordine.

1. DATI SENZA FONTE E PRIORITÀ DELLE FONTI. Trova ogni numero o affermazione specifica
sull'IMPRESA del cliente — monte ore, numero di addetti, turni e orari, tempi di
intervento, reperibilità, certificazioni, referenze, nomi di clienti, prodotti,
macchinari, esperienza pregressa, formazione già erogata, premi e riconoscimenti — che
NON trova un riscontro testuale nei dati confermati forniti. Non toccare: requisiti del
capitolato, riferimenti normativi, impegni di controllo/verifica che l'impresa propone
di assumere (sono la sua offerta, non un fatto sulle sue risorse attuali).

Prima di segnalare un dato come "senza fonte", controlla se è un dato DI GARA — sede,
indirizzo, superficie, orario di apertura, frequenza di intervento, o un dato del
personale uscente (numero addetti, livello contrattuale, ore settimanali, anzianità).
Questi dati compaiono nel blocco "Sedi/immobili e personale uscente di QUESTA gara" e
sono SEMPRE una fonte valida e già confermata (arrivano dall'estrazione documenti, non
dalla ricerca per somiglianza): non sostituirli MAI con un segnaposto. Se il testo li
riporta in modo diverso da quel blocco (nome, numero, orario), CORREGGILI perché
coincidano con il dato di gara — non cancellarli.

Caso speciale — monte ore/organico OFFERTO dall'impresa (quanto l'impresa propone di
impiegare per il servizio, diverso dal personale uscente sopra che è il dato storico
del gestore uscente): se il profilo azienda non indica un valore specifico, NON
lasciarlo assente e non genericizzarlo. Proponi un valore concreto derivato dal numero
di addetti/ore del personale uscente e dalle frequenze richieste per le sedi coinvolte,
nel formato "proposta da confermare" del punto sotto (valore in chiaro + asterisco).

Per ogni altro dato d'impresa senza fonte, come sostituirlo dipende da dove si trova:
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

4. NESSUNA CELLA VUOTA. Scorri OGNI tabella e OGNI cella del corpo (non
dell'intestazione): una cella senza alcun testo è sempre un errore, anche quando il
resto della tabella è corretto. Non lasciarne mai una vuota: se manca un dato,
applica la stessa convenzione del punto 1 per le tabelle (valore proposto + asterisco,
o "*" da solo) — mai una cella bianca, mai uno spazio, mai un trattino usato come
riempitivo senza significato.

Lascia invariato tutto il resto: struttura, tabelle, formattazione, ogni contenuto già
riscontrabile nei dati confermati o già coerente.

Non essere permissivo: nel dubbio, applica la correzione. Un segnaposto o un asterisco
di troppo è un problema minore; un dato inventato, un dato di gara trattato come
mancante, una cella vuota, un'incoerenza numerica o un titolo fuorviante lasciati nel
testo sono un danno per il cliente.

Chiama SEMPRE lo strumento fornito con il testo completo risultante (invariato se non
serviva alcuna correzione). Non scrivere nessun testo fuori dallo strumento: niente
analisi, niente elenco dei problemi trovati, niente introduzione tipo "ecco il testo
corretto" — qualunque parola scritta fuori dallo strumento finisce, così com'è, nel
documento Word del cliente.
<!-- FINE PROMPT -->
