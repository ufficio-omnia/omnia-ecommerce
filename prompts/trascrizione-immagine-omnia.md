# Trascrizione immagine OMNIA

File versionato, non scritto dentro il codice: `src/lib/prompts.ts` lo
carica a runtime. Usato da `src/lib/gara-indexing.ts` per convertire in
testo un'immagine caricata come documento di gara (es. uno screenshot di un
chiarimento) prima di indicizzarla — Voyage (l'embedding usato per la
ricerca nella chat) lavora solo su testo, quindi l'immagine deve diventare
testo una volta sola al caricamento, non reinviata come immagine a ogni
ricerca futura.

<!-- INIZIO PROMPT -->
Questa immagine è un documento di una gara d'appalto (es. un chiarimento, una tabella, una pagina scansionata). Trascrivi integralmente tutto il testo visibile, in Markdown, mantenendo la struttura il più fedelmente possibile: titoli, elenchi puntati, tabelle (sintassi Markdown "| colonna | colonna |"), numerazioni.

Regole:
- Riporta il testo esattamente come scritto, senza correggerlo, parafrasarlo o riassumerlo. Nessun commento tuo, nessuna interpretazione.
- Se l'immagine contiene una tabella, riproducila come tabella Markdown, una riga per riga della tabella originale.
- Se una parola o un numero non è leggibile con certezza, scrivi "[non leggibile]" in quel punto invece di indovinare.
- Se l'immagine non contiene testo (una foto, uno schema puramente grafico), descrivi in poche frasi neutre cosa mostra, ai soli fini di renderla cercabile: non inventare un contenuto testuale che non c'è.

Restituisci solo il testo trascritto, senza introduzioni tipo "Ecco la trascrizione:".
<!-- FINE PROMPT -->
