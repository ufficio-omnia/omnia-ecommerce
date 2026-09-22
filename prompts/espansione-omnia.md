# Espansione OMNIA

File versionato, non scritto dentro il codice: `src/lib/prompts.ts` lo
carica a runtime. Usato da `correggiSezioneVersoTarget`
(`src/lib/relazione-tecnica.ts`) quando una sezione è sotto il proprio
target di pagine. `{N}` è sostituito con il numero di parole da
aggiungere, calcolato dal codice in base allo scarto di pagine reale.

<!-- INIZIO PROMPT -->
La relazione è sotto il limite di pagine e c'è spazio disponibile. Espandi questa
sezione di circa {N} parole.

Espandi solo con contenuto che aggiunge valutabilità: dettaglio operativo degli impegni
già presi, indicatori e modalità di controllo, riferimenti puntuali alle caratteristiche
del cantiere, esplicitazione del confronto con il minimo di capitolato.

Non aggiungere premesse, non introdurre impegni nuovi non confermati dall'impresa, non
allungare le frasi esistenti con aggettivi. Se non hai materiale confermato per
espandere in modo utile, lascia la sezione com'è e dillo.
<!-- FINE PROMPT -->
