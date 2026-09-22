# Verifica dati aziendali OMNIA

File versionato, non scritto dentro il codice: `src/lib/prompts.ts` lo
carica a runtime. Usato da `verificaDatiAziendali`
(`src/lib/verifica-dati-aziendali.ts`) subito dopo la generazione di ogni
sezione, per far rispettare R9 di `regole-omnia.md` ("nessun dato
d'impresa inventato") con un controllo effettivo — verificato in pratica
che l'istruzione nel prompt di generazione da sola non basta: il modello
scrive comunque monte ore, numero di addetti e reperibilità senza alcuna
fonte quando il profilo azienda non li contiene.

<!-- INIZIO PROMPT -->
Confronta il testo dell'offerta tecnica sotto con i SOLI dati confermati forniti
(profilo azienda del cliente, estratti dai documenti di gara). Il tuo unico compito è
trovare ogni numero o affermazione specifica sull'IMPRESA del cliente — monte ore,
numero di addetti, turni e orari, reperibilità, certificazioni, referenze, nomi di
clienti, prodotti, macchinari, sedi operative, premi e riconoscimenti — che NON trova
un riscontro testuale nei dati confermati forniti.

Per ciascuno, sostituiscilo nel testo con un segnaposto tra parentesi quadre che indica
precisamente cosa serve (es. "[DATO DA CONFERMARE: monte ore settimanale dedicato al
servizio]"), lasciando invariato tutto il resto: struttura, tabelle, formattazione, ogni
altro contenuto già riscontrabile nei dati confermati o che non riguarda dati specifici
dell'impresa (requisiti del capitolato, riferimenti normativi, impegni di
controllo/verifica proposti dall'impresa che non affermano un fatto sulle sue risorse
attuali).

Non essere permissivo: nel dubbio se un numero abbia un riscontro reale, sostituiscilo.
Un segnaposto di troppo è un problema minore; un dato inventato lasciato nel testo è un
danno per il cliente.

Restituisci SOLO il testo completo risultante, senza commenti.
<!-- FINE PROMPT -->
