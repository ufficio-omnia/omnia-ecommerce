# Espansione mirata OMNIA

File versionato, non scritto dentro il codice: `src/lib/prompts.ts` lo
carica a runtime. Usato da `src/lib/espansione-mirata.ts` per ampliare UN
SOLO sotto-criterio alla volta quando occupa molto meno del proprio tetto di
pagine (il tetto è ripartito in proporzione ai punti): verificato con il
modello vero che con il solo vincolo nel prompt di generazione le bozze si
fermano al 60-75% del tetto, e che un'istruzione "riempi il tetto" nello
stesso prompt non lo cambia (peggiora). È l'equivalente per sotto-criterio
del vecchio passaggio "espandi" per criterio (`espansione-omnia.md`), con le
garanzie della compressione mirata a rovescio: ciò che viene aggiunto non
può contenere numeri, riferimenti o impegni nuovi.

Segnaposto sostituiti dal codice: `{CHIAVE}`, `{TITOLO}`, `{PUNTI}`,
`{PUNTEGGIO_TECNICO}`, `{QUOTA}`, `{REQUISITO}`, `{TETTO_PAGINE}`,
`{TETTO_PAROLE}`, `{PAGINE_ATTUALI}`, `{N}` (parole da aggiungere).
`{CORREZIONI}` è vuoto al primo tentativo e, al secondo, elenca ciò che il
controllo automatico ha trovato di sbagliato nel primo risultato.

<!-- INIZIO PROMPT -->
Amplia il sotto-criterio {CHIAVE} "{TITOLO}" di un'offerta tecnica: ha ancora spazio a disposizione e oggi ne usa solo una parte.

QUANTO VALE: {PUNTI} punti su {PUNTEGGIO_TECNICO} del punteggio tecnico ({QUOTA}%). Lo spazio è già ripartito tra i sotto-criteri in base ai punti.
COSA RICHIEDE IL DISCIPLINARE: {REQUISITO}
LUNGHEZZA: oggi occupa {PAGINE_ATTUALI} pagine, il tetto è {TETTO_PAGINE} pagine (circa {TETTO_PAROLE} parole di solo testo; una tabella conta circa il doppio delle stesse parole). Aggiungi circa {N} parole e fermati entro il tetto.

Cosa aggiungere, in quest'ordine — ciò che rende il testo più valutabile:
1. per ogni impegno già presente: COME viene eseguito (fasi, strumenti, chi lo svolge) e COME viene controllato (chi verifica, con quale registrazione, a chi viene comunicato l'esito);
2. per ogni requisito del disciplinare elencato sopra: come l'impegno già scritto lo soddisfa, con le parole con cui il disciplinare lo nomina;
3. il comportamento nei casi che il capitolato prevede (eccezioni, emergenze, sostituzioni), solo dove il testo li implica già;
4. nuove voci di elenco o nuove righe nelle tabelle già presenti, per ciò che il testo descrive oggi solo in prosa.

Cosa NON fare MAI. Il testo ampliato viene controllato automaticamente su ognuno di questi punti e, se ne è violato uno, l'ampliamento viene RIFIUTATO e il sotto-criterio resta com'è:
- nessun numero, percentuale, quantità, frequenza numerica, data o durata che non sia già nel testo di partenza: descrivi a parole ciò che il testo già dice, senza introdurre dati nuovi;
- nessuna citazione di articolo, paragrafo, norma o certificazione che non sia già nel testo di partenza; nessun impegno, strumento, sede, certificazione o dato dell'impresa che il testo non contenga già o che non sia deducibile dal testo stesso;
- tutto il testo di partenza resta: non togliere, non riassumere, non riscrivere, non spostare; aggiungi attorno e dentro;
- le figure e i tag di formattazione restano com'erano ([ORGANIGRAMMA], le righe [FIGURA:n] o [FIGURA:@n] costruite dal sistema — identiche, nello stesso punto, mai tolte né ripetute —, [C], [G], [TABELLA:...], [ICONA:...], [BOX:tipo], [RIGA:tipo], [CELLA:tipo], !!...!!, **...**, gli asterischi dopo i valori e la loro nota); le righe nuove di tabelle ed elenchi portano l'icona pertinente come le altre; non aggiungere riquadri se il sotto-criterio ne ha già uno;
- il titolo "## {CHIAVE}" e i sotto-titoli "###" restano.

Niente premesse, niente aggettivi valutativi, niente frasi di raccordo vuote, niente ripetizione di ciò che è già scritto: se non hai altro da aggiungere che abbia un contenuto verificabile, aggiungi meno e fermati.
{CORREZIONI}
Restituisci SOLO il testo completo del sotto-criterio, a partire dal titolo "## {CHIAVE}", senza commenti.
<!-- FINE PROMPT -->
