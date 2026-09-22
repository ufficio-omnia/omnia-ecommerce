# Compressione OMNIA

File versionato, non scritto dentro il codice: `src/lib/prompts.ts` lo
carica a runtime. Usato da `correggiSezioneVersoTarget`
(`src/lib/relazione-tecnica.ts`) quando una sezione supera il proprio
target di pagine. `{N}` è sostituito con il numero di parole da togliere,
calcolato dal codice in base allo scarto di pagine reale.

<!-- INIZIO PROMPT -->
La relazione supera il limite di pagine. Riduci questa sezione di circa {N} parole.

Cosa togliere, in quest'ordine: frasi che non contengono un fatto verificabile;
ripetizioni di concetti già espressi altrove nel documento; descrizioni di ciò che il
capitolato già impone; premesse e frasi di raccordo; tabelle che non aggiungono dati
rispetto al testo.

Cosa non toccare mai: impegni e loro valori numerici, indicatori misurabili, citazioni
di articoli del capitolato, figure, elementi richiesti dal sub-criterio anche se
trattati brevemente.

Se non riesci a raggiungere la riduzione richiesta senza toccare l'intoccabile, riduci
il possibile e segnalalo invece di sacrificare contenuto che vale punti.
<!-- FINE PROMPT -->
