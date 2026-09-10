// Versione 1 delle Condizioni generali di vendita — corrisponde a
// legal/condizioni-vendita-v1.md. Immutabile dopo la pubblicazione: le
// revisioni future sono nuovi componenti (CondizioniVenditaV2, ecc.),
// mai una modifica a questo file. Le clausole 7/8/11/14 hanno un id per
// permettere al checkout di linkare direttamente alla clausola citata.

const h2 = "mt-10 font-serif text-xl text-ink";
const p = "mt-3 text-justify text-sm text-sage";

export default function CondizioniVenditaV1() {
  return (
    <main className="flex-1">
      <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
        <h1 className="font-serif text-3xl text-ink">
          Condizioni generali di vendita
        </h1>
        <p className="mt-1 font-mono text-xs tracking-wide text-sage uppercase">
          Versione 1 — in vigore dal 10 settembre 2026
        </p>

        <h2 className={h2}>1. Il venditore</h2>
        <p className={p}>
          I prodotti presenti su app.omniaitalia.com sono venduti da{" "}
          <strong className="text-ink">Omnia Consulting SRLS</strong>, P.IVA
          02957590819, email info@omniaitalia.com, PEC
          omnia26@legalmail.it.
        </p>

        <h2 className={h2}>2. Cosa acquisti</h2>
        <p className={p}>
          Oggetto della vendita sono{" "}
          <strong className="text-ink">documenti digitali modificabili</strong>{" "}
          — modelli e fac-simile in formato Word, Excel e Publisher —
          destinati alla predisposizione di offerte tecniche per gare
          d&apos;appalto nel settore del facility management.
        </p>
        <p className={p}>
          Si tratta di <strong className="text-ink">modelli professionali da adattare</strong>,
          non di documenti pronti da presentare in gara. Il contenuto va
          necessariamente personalizzato sui dati dell&apos;acquirente,
          sull&apos;oggetto della specifica procedura e sulle prescrizioni
          del relativo bando, disciplinare e capitolato.
        </p>
        <p className={p}>
          L&apos;elenco dei file compresi in ciascun pacchetto è indicato
          nella scheda del prodotto e costituisce parte integrante di queste
          condizioni.
        </p>

        <h2 className={h2}>3. Conclusione del contratto</h2>
        <p className={p}>
          La presentazione dei prodotti sul sito costituisce invito a
          proporre. Il contratto si perfeziona quando il venditore conferma
          l&apos;ordine tramite l&apos;email di riepilogo inviata
          all&apos;indirizzo indicato dall&apos;acquirente.
        </p>
        <p className={p}>
          Il venditore si riserva di non accettare ordini incompleti o
          contenenti dati manifestamente errati.
        </p>

        <h2 className={h2}>4. Prezzi</h2>
        <p className={p}>
          I prezzi sono espressi in euro e si intendono{" "}
          <strong className="text-ink">IVA inclusa</strong>, con
          l&apos;aliquota applicabile indicata nel riepilogo prima del
          pagamento. Il prezzo dovuto è quello esposto al momento
          dell&apos;invio dell&apos;ordine.
        </p>
        <p className={p}>
          Eventuali sconti sono temporanei, indicati con il prezzo pieno
          barrato accanto a quello ridotto, e non sono cumulabili salvo
          diversa indicazione.
        </p>

        <h2 className={h2}>5. Pagamento</h2>
        <p className={p}>
          <strong className="text-ink">Carta di credito o debito.</strong> Il
          pagamento è gestito da Stripe su pagina sicura; i dati della carta
          non sono mai visibili al venditore. L&apos;ordine è confermato
          solo dopo l&apos;esito positivo comunicato dal sistema di
          pagamento.
        </p>
        <p className={p}>
          <strong className="text-ink">Bonifico bancario.</strong> Gli
          estremi e la causale sono mostrati al termine dell&apos;ordine e
          inviati via email. L&apos;ordine resta in stato &quot;in attesa di
          pagamento&quot; fino all&apos;accredito, verificato manualmente. Se
          il bonifico non risulta accreditato entro sette giorni lavorativi,
          l&apos;ordine può essere annullato.
        </p>

        <h2 className={h2}>6. Consegna</h2>
        <p className={p}>
          I documenti non vengono spediti né inviati come allegato: sono resi{" "}
          <strong className="text-ink">
            disponibili al download nell&apos;area riservata
          </strong>{" "}
          dell&apos;acquirente.
        </p>
        <p className={p}>
          Il download si sblocca immediatamente dopo la conferma del
          pagamento con carta, oppure dopo la verifica dell&apos;accredito
          del bonifico, di norma entro un giorno lavorativo dalla ricezione.
        </p>
        <p className={p}>
          I file restano scaricabili finché l&apos;account è attivo. È onere
          dell&apos;acquirente conservarne copia.
        </p>

        <h2 id="clausola-7" className={h2}>
          7. Licenza d&apos;uso
        </h2>
        <p className={p}>
          Con l&apos;acquisto non si acquisisce la proprietà dei documenti,
          ma una licenza d&apos;uso{" "}
          <strong className="text-ink">
            non esclusiva, non trasferibile e non cedibile
          </strong>
          , a tempo indeterminato e limitata a quanto segue.
        </p>
        <p className={p}>
          <strong className="text-ink">È consentito</strong> utilizzare,
          modificare e adattare i documenti per predisporre offerte proprie
          dell&apos;acquirente o della società cui appartiene, anche in caso
          di partecipazione in raggruppamento temporaneo di imprese, purché
          l&apos;acquirente sia parte del raggruppamento.
        </p>
        <p className={p}>
          <strong className="text-ink">È vietato</strong> rivendere, cedere,
          concedere in sublicenza, distribuire, pubblicare o condividere i
          documenti, anche gratuitamente e anche solo in parte; utilizzarli
          per redigere offerte per conto di terzi a titolo professionale;
          renderli accessibili su reti, archivi o piattaforme consultabili da
          soggetti diversi dall&apos;acquirente.
        </p>
        <p className={p}>
          La violazione comporta la risoluzione di diritto del contratto, la
          revoca immediata dell&apos;accesso ai file e il risarcimento del
          danno, ferma restando la tutela dei diritti d&apos;autore sul
          materiale.
        </p>

        <h2 id="clausola-8" className={h2}>
          8. Nessuna garanzia sull&apos;esito della gara
        </h2>
        <p className={p}>
          I documenti sono strumenti di lavoro. Il venditore{" "}
          <strong className="text-ink">
            non garantisce l&apos;aggiudicazione di una gara,
            l&apos;attribuzione di un determinato punteggio tecnico, né
            l&apos;ammissione alla procedura.
          </strong>
        </p>
        <p className={p}>
          L&apos;esito di una procedura di affidamento dipende da fattori che
          esulano interamente dal controllo del venditore, tra cui il
          contenuto dell&apos;offerta come personalizzata
          dall&apos;acquirente, le valutazioni discrezionali della
          commissione giudicatrice, le offerte dei concorrenti e le
          determinazioni della stazione appaltante.
        </p>
        <p className={p}>
          È onere esclusivo dell&apos;acquirente verificare la conformità
          della propria offerta alla documentazione di gara e alla normativa
          vigente, nonché il rispetto dei termini e delle modalità di
          presentazione.
        </p>

        <h2 className={h2}>9. Diritto di recesso</h2>
        <p className={p}>
          <strong className="text-ink">Acquirenti professionali.</strong> Il
          diritto di recesso previsto dal Codice del Consumo non si applica
          agli acquisti effettuati da imprese, società, professionisti ed
          enti nell&apos;esercizio della propria attività.
        </p>
        <p className={p}>
          <strong className="text-ink">Consumatori.</strong> Trattandosi di
          contenuto digitale fornito senza supporto materiale, il diritto di
          recesso si perde nel momento in cui l&apos;esecuzione ha inizio,
          ossia quando il file viene reso disponibile al download, a
          condizione che il consumatore abbia espressamente richiesto
          l&apos;esecuzione immediata e riconosciuto di perdere il recesso.
          Tale accettazione è raccolta prima del pagamento; in sua assenza la
          consegna non ha luogo prima della scadenza dei quattordici giorni.
        </p>
        <p className={p}>
          Nessun rimborso è dovuto per documenti già scaricati, salvo i casi
          di prodotto difettoso, incompleto o non corrispondente alla
          descrizione.
        </p>

        <h2 className={h2}>10. Difformità e assistenza</h2>
        <p className={p}>
          Se un file risulta illeggibile, danneggiato, mancante rispetto
          all&apos;elenco pubblicato o non corrispondente alla descrizione,
          scrivi a info@omniaitalia.com entro quattordici giorni dal
          download: provvederemo alla sostituzione del file o, se non
          possibile, al rimborso della quota parte corrispondente.
        </p>

        <h2 id="clausola-11" className={h2}>
          11. Limitazione di responsabilità
        </h2>
        <p className={p}>
          Nei limiti consentiti dalla legge, e salvi i casi di dolo e colpa
          grave, la responsabilità complessiva del venditore per qualsiasi
          pretesa connessa alla vendita è limitata all&apos;importo
          effettivamente pagato per il prodotto oggetto di contestazione. Il
          venditore non risponde di danni indiretti, mancato guadagno,
          perdita di chance o mancata aggiudicazione.
        </p>

        <h2 className={h2}>12. Fatturazione</h2>
        <p className={p}>
          La fattura elettronica è emessa e trasmessa tramite Sistema di
          Interscambio ai dati forniti in fase di ordine. È onere
          dell&apos;acquirente indicare correttamente partita IVA, codice
          destinatario o PEC.
        </p>

        <h2 className={h2}>13. Reclami</h2>
        <p className={p}>
          I reclami vanno inviati a info@omniaitalia.com o a
          omnia26@legalmail.it. Rispondiamo entro quindici giorni lavorativi.
          Il consumatore può in ogni caso rivolgersi a un organismo di
          mediazione o di risoluzione alternativa delle controversie iscritto
          negli elenchi ministeriali competenti.
        </p>

        <h2 id="clausola-14" className={h2}>
          14. Legge applicabile e foro
        </h2>
        <p className={p}>
          Il contratto è regolato dalla legge italiana. Per le controversie
          con acquirenti professionali è competente in via esclusiva il foro
          del luogo in cui ha sede il venditore. Per le controversie con
          consumatori resta competente, in quanto inderogabile, il foro del
          luogo di residenza o domicilio del consumatore, se ubicato in
          Italia.
        </p>

        <h2 className={h2}>15. Modifiche</h2>
        <p className={p}>
          Il venditore può aggiornare queste condizioni. A ciascun ordine si
          applicano le condizioni vigenti e accettate al momento del suo
          invio.
        </p>
      </div>
    </main>
  );
}
