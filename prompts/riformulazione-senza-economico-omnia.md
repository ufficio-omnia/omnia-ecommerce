# Riformulazione senza riferimenti economici OMNIA

File versionato, non scritto dentro il codice: `src/lib/prompts.ts` lo carica
a runtime. Usato da `src/lib/garanzia-senza-economico.ts` quando il controllo
deterministico (`src/lib/riferimenti-economici.ts`) trova in un'offerta
tecnica una formula che rimanda all'offerta economica (R8 di
`regole-omnia.md`): chiede di riscrivere SOLO le righe interessate, non
l'intera sezione.

Segnaposto sostituito dal codice: `{CORREZIONI}` — vuoto al primo tentativo
e, al secondo, elenca ciò che il primo risultato conteneva ancora.

<!-- INIZIO PROMPT -->
Stai correggendo alcune righe di un'offerta tecnica per una gara d'appalto. Il controllo automatico ha trovato in ciascuna una formula che rimanda all'offerta economica (prezzi, importi, ribassi, costi, gratuità, "senza oneri aggiuntivi", "compreso nel prezzo", "a costo zero", riferimenti a euro). In un'offerta tecnica è causa di ESCLUSIONE dalla gara, non un difetto di stile.

Riformula ogni riga indicata SENZA alcun riferimento economico, né diretto né indiretto. Come dire che qualcosa è incluso: come impegno di servizio, mai come gratuità. Esempi:
- "l'attività è offerta gratuitamente" → "l'attività è svolta con frequenza mensile"
- "passaggio quindicinale senza oneri aggiuntivi di orario per l'Amministrazione" → "passaggio quindicinale di verifica intermedia"
- "interventi inclusi nel prezzo" → "interventi garantiti per tutta la durata del servizio"
Se la formula non aggiunge nessun impegno verificabile, eliminala e basta: una frase più corta è meglio di una frase che resta ambigua.

Regole di forma, controllate automaticamente (una riga che le viola viene scartata):
- restituisci la riga COMPLETA, non solo la parte cambiata;
- mantieni identica la struttura: una riga di tabella resta una riga di tabella con lo stesso numero di celle separate da "|"; una voce di elenco resta una voce di elenco con lo stesso "- "; un titolo resta un titolo con gli stessi "#" e la stessa numerazione;
- mantieni invariati tutti i tag di formattazione ([C], [G], [ICONA:nome], [RIGA:tipo], [CELLA:tipo], **...**, !!...!!), i valori, le frequenze, i tempi di intervento, i nomi di ruoli, sedi e attrezzature, le citazioni di articoli e gli asterischi "*" posti dopo un valore: cambia soltanto ciò che serve a togliere il riferimento economico;
- non aggiungere impegni, numeri o dati nuovi;
- non usare nessuna delle formule indicate, nemmeno con parole diverse che dicono la stessa cosa.

Titolo della sezione, per contesto: {TITOLO_SEZIONE}
{CORREZIONI}
Restituisci l'esito con lo strumento fornito: per ogni riga, il suo indice e la riga riformulata.
<!-- FINE PROMPT -->
