# Compressione mirata OMNIA

File versionato, non scritto dentro il codice: `src/lib/prompts.ts` lo
carica a runtime. Usato da `src/lib/compressione-mirata.ts` per ridurre UN
SOLO sotto-criterio alla volta (non un'intera sezione), sapendo quanti punti
vale e cosa richiede il disciplinare per quel sotto-criterio. Il prompt
generico `compressione-omnia.md` resta per le gare in cui i sotto-criteri non
si riescono ricavare dal disciplinare.

Segnaposto sostituiti dal codice: `{CHIAVE}`, `{TITOLO}`, `{PUNTI}`,
`{PUNTEGGIO_TECNICO}`, `{QUOTA}`, `{REQUISITO}`, `{TETTO_PAGINE}`,
`{TETTO_PAROLE}`, `{PAGINE_ATTUALI}`, `{N}` (parole da togliere).
`{CORREZIONI}` è vuoto al primo tentativo e, al secondo, elenca ciò che il
controllo automatico ha trovato mancante nel primo risultato.

<!-- INIZIO PROMPT -->
Riduci il sotto-criterio {CHIAVE} "{TITOLO}" di un'offerta tecnica, perché il documento supera il limite di pagine del disciplinare.

QUANTO VALE: {PUNTI} punti su {PUNTEGGIO_TECNICO} del punteggio tecnico ({QUOTA}%). Ogni pagina che occupa deve guadagnare punti in proporzione: la lunghezza è già ripartita tra i sotto-criteri in base ai punti.
COSA RICHIEDE IL DISCIPLINARE: {REQUISITO}
LUNGHEZZA: oggi occupa {PAGINE_ATTUALI} pagine, il tetto è {TETTO_PAGINE} pagine (circa {TETTO_PAROLE} parole di solo testo; una tabella conta circa il doppio delle stesse parole, un organigramma 0,6 pagine). Togli circa {N} parole e fermati appena sei entro il tetto.

Cosa togliere, in quest'ordine — prima ciò che vale meno per i punti:
1. frasi che non contengono un fatto verificabile;
2. ripetizioni di concetti già espressi altrove nel documento;
3. descrizioni di ciò che il capitolato già impone senza aggiungere un impegno tuo;
4. premesse e frasi di raccordo;
5. tabelle che non aggiungono dati rispetto al testo (una tabella ridondante si toglie per intero, non a righe);
6. il dettaglio degli aspetti meno legati a ciò che il disciplinare richiede qui sopra: un paragrafo diventa una frase, una frase diventa una riga di tabella.

Cosa non toccare MAI. Il testo ridotto viene controllato automaticamente su ognuno di questi punti e, se ne manca uno, la riduzione viene RIFIUTATA e il sotto-criterio resta lungo:
- ogni elemento che il disciplinare richiede espressamente per questo sotto-criterio (elencato sopra): può ridursi a una frase o a una riga di tabella, ma deve restare, con le parole con cui il disciplinare lo nomina;
- ogni impegno con il suo valore numerico e ogni indicatore misurabile;
- ogni citazione di un articolo del capitolato, di un paragrafo del disciplinare o di una norma ("art. 13.2", "D.Lgs. 36/2023", "UNI EN ISO 14001"), scritta come nel testo di partenza;
- ogni asterisco "*" posto dopo un valore e la nota che lo spiega ("*Valori proposti da confermare..."): sono ciò che distingue una proposta dell'impresa da un dato confermato; toglierlo trasforma una proposta in un impegno;
- le figure ([ORGANIGRAMMA]...[/ORGANIGRAMMA]) e i tag di formattazione ([C], [G], [TABELLA:...], [ICONA:...], [BOX] e [BOX:tipo], [RIGA:tipo], [CELLA:tipo], !!...!!, **...**), usati come nel testo di partenza — il TIPO di un riquadro o di una riga/cella evidenziata non si cambia e non si toglie;
- il titolo "## {CHIAVE}" e i sotto-titoli "###" con la loro numerazione.

Non aggiungere nulla: nessun dato, numero, impegno, articolo o affermazione che non sia già nel testo di partenza. Riduci soltanto.

Se il tetto non è raggiungibile senza toccare ciò che non va toccato, riduci il possibile e fermati: superare il tetto è meno grave che perdere un elemento richiesto.
{CORREZIONI}
Restituisci SOLO il testo completo del sotto-criterio, a partire dal titolo "## {CHIAVE}", senza commenti.
<!-- FINE PROMPT -->
