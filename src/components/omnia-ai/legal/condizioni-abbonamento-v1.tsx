// Versione 1 delle Condizioni di abbonamento di omnia-ai.it — corrisponde
// esattamente a legal/condizioni-abbonamento-v1.md (stesso contenuto
// legale, revisionato). Una volta pubblicata, questa versione non si
// modifica mai: una revisione futura sarà un nuovo file
// CondizioniAbbonamentoV2 con propria voce in legal_documents, mai una
// modifica a questo componente.
//
// Numerazione delle clausole (1-17) invariata rispetto al file sorgente:
// le clausole 5, 8, 11 e 14 sono quelle richiamate per numero nella
// casella di approvazione specifica al momento dell'attivazione
// (passo successivo). Ogni <h2> ha un id "clausola-N" corrispondente,
// per poterle linkare singolarmente da lì.

export default function CondizioniAbbonamentoV1() {
  return (
    <>
      <section className="omnia-pagina-hero">
        <h1>Condizioni di abbonamento</h1>
        <p className="micro" style={{ marginTop: 12, color: "var(--fioco)" }}>
          Versione 1 — in vigore dall&apos;11 settembre 2026
        </p>
      </section>

      <section className="omnia-pagina-corpo">
        <div className="omnia-prosa">
          <h2 id="clausola-1">1. Il fornitore</h2>
          <p>
            OMNIA AI è un servizio di <strong>Omnia Consulting SRLS</strong>, P.IVA
            02957590819, email info@omniaitalia.com, PEC omnia26@legalmail.it.
          </p>

          <h2 id="clausola-2">2. Cos&apos;è il servizio</h2>
          <p>
            OMNIA AI è un assistente per la redazione di offerte tecniche per gare d&apos;appalto
            nel settore del facility management. Analizza la documentazione di gara caricata dal
            cliente, ne estrae criteri, requisiti e vincoli, e genera bozze di contenuto
            esportabili in formato Word già impaginato.
          </p>
          <p>
            <strong>I contenuti generati sono bozze di lavoro.</strong> Devono essere verificati,
            integrati con i dati specifici dell&apos;impresa e adattati alle prescrizioni della
            singola procedura prima di qualsiasi utilizzo. Il servizio non sostituisce la
            valutazione professionale di chi predispone e sottoscrive l&apos;offerta.
          </p>

          <h2 id="clausola-3">3. Attivazione dell&apos;abbonamento</h2>
          <p>
            L&apos;abbonamento si attiva con la sottoscrizione di uno dei piani e il buon esito
            del primo pagamento. Il contratto si perfeziona con l&apos;email di conferma inviata
            al cliente.
          </p>
          <p>
            L&apos;accesso è personale e riferito all&apos;impresa intestataria
            dell&apos;abbonamento. La condivisione delle credenziali con soggetti esterni
            all&apos;impresa non è consentita; il piano Professional consente l&apos;accesso di
            più utenti della stessa impresa secondo quanto indicato nella scheda del piano.
          </p>

          <h2 id="clausola-4">4. Piani, durata e rinnovo</h2>
          <p>
            I piani disponibili, con il numero di gare mensili incluse e le funzioni comprese,
            sono indicati nella pagina dei piani, che costituisce parte integrante di queste
            condizioni.
          </p>
          <p>
            L&apos;abbonamento ha durata mensile e <strong>si rinnova automaticamente</strong>{" "}
            alla scadenza, con addebito sul metodo di pagamento indicato, salvo disdetta. Il
            cliente riceve comunicazione dell&apos;avvenuto rinnovo e la relativa fattura.
          </p>

          <h2 id="clausola-5">5. Gare incluse e crediti aggiuntivi</h2>
          <p>
            <strong>
              Una gara si considera consumata nel momento in cui viene avviata l&apos;analisi dei
              documenti caricati.
            </strong>{" "}
            Da quel momento, tutte le generazioni, revisioni e rielaborazioni relative alla
            medesima gara sono comprese e non comportano ulteriori consumi. La semplice creazione
            di una gara, senza avvio dell&apos;analisi, non consuma nulla.
          </p>
          <p>
            Le gare incluse nel piano sono riferite al singolo periodo di fatturazione:{" "}
            <strong>quelle non utilizzate non si cumulano</strong> e non sono riportate al
            periodo successivo né rimborsate. All&apos;inizio di ogni periodo la disponibilità
            torna al numero previsto dal piano.
          </p>
          <p>
            Il cliente può acquistare <strong>crediti aggiuntivi</strong> in qualsiasi momento,
            per gare eccedenti quelle comprese. I crediti aggiuntivi non hanno scadenza mensile:
            restano disponibili fino al loro utilizzo e comunque{" "}
            <strong>fino alla cessazione dell&apos;abbonamento</strong>, con la quale si
            estinguono senza diritto a rimborso. Si consumano solo dopo l&apos;esaurimento delle
            gare incluse nel piano.
          </p>
          <p>
            Qualora le gare disponibili risultino esaurite, l&apos;avvio di una nuova analisi non
            ha luogo e il cliente ne è informato prima dell&apos;operazione.
          </p>

          <h2 id="clausola-6">6. Prezzi e pagamento</h2>
          <p>
            I prezzi indicati nella pagina dei piani si intendono <strong>IVA inclusa</strong>:
            l&apos;importo esposto è quello addebitato. In fattura imponibile e imposta sono
            esposti separatamente.
          </p>
          <p>
            Il pagamento avviene con carta tramite Stripe. In caso di mancato buon fine del
            rinnovo, il servizio può essere sospeso fino alla regolarizzazione; decorsi quindici
            giorni senza pagamento, l&apos;abbonamento si intende cessato.
          </p>
          <p>
            Il fornitore può modificare i prezzi con un preavviso di almeno trenta giorni,
            comunicato via email. La modifica si applica dal rinnovo successivo alla scadenza del
            preavviso; il cliente che non intenda accettarla può disdire senza costi entro tale
            termine.
          </p>

          <h2 id="clausola-7">7. Disdetta</h2>
          <p>
            Il cliente può disdire in qualsiasi momento dall&apos;area riservata, senza costi e
            senza preavviso.
          </p>
          <p>
            <strong>La disdetta ha effetto alla scadenza del periodo già pagato</strong>: fino a
            quella data il servizio resta pienamente utilizzabile, comprese le gare residue del
            piano. Non sono previsti rimborsi, neppure proporzionali, per il periodo già
            corrisposto.
          </p>

          <h2 id="clausola-8">8. Cosa succede dopo la cessazione</h2>
          <p>
            Alla cessazione dell&apos;abbonamento, per qualsiasi causa, il cliente conserva per{" "}
            <strong>trenta giorni</strong> l&apos;accesso in sola lettura al proprio spazio, al
            solo fine di scaricare gare, documenti caricati e contenuti generati.
          </p>
          <p>
            Trascorso tale termine, i contenuti sono cancellati in modo irreversibile. È onere
            del cliente provvedere al download entro il termine indicato.
          </p>
          <p>
            I crediti aggiuntivi eventualmente residui si estinguono con la cessazione e non
            danno diritto a rimborso né a riattivazione successiva.
          </p>

          <h2 id="clausola-9">9. Titolarità dei contenuti</h2>
          <p>I documenti caricati dal cliente restano di sua esclusiva titolarità.</p>
          <p>
            <strong>I contenuti generati tramite il servizio appartengono al cliente</strong>,
            che può utilizzarli, modificarli e presentarli in gara senza limitazioni e senza
            obbligo di citare la fonte.
          </p>
          <p>
            Restano di titolarità del fornitore la piattaforma, il suo funzionamento, i modelli
            di struttura, gli schemi di impaginazione e la base di conoscenza: il cliente non
            acquisisce alcun diritto su di essi e non può estrarli, replicarli o riutilizzarli al
            di fuori del servizio.
          </p>

          <h2 id="clausola-10">10. Uso corretto del servizio</h2>
          <p>
            Il cliente si impegna a non utilizzare il servizio per finalità diverse dalla
            predisposizione di offerte proprie o della società cui appartiene; a non rivenderlo,
            concederlo in uso o renderlo accessibile a terzi; a non tentare di estrarne in modo
            massivo i contenuti o le istruzioni di funzionamento; a non caricare documenti su cui
            non abbia titolo.
          </p>
          <p>
            L&apos;uso manifestamente anomalo, tale da compromettere il funzionamento del
            servizio per gli altri utenti, può comportare la sospensione previa comunicazione.
          </p>

          <h2 id="clausola-11">11. Nessuna garanzia sull&apos;esito della gara</h2>
          <p>
            Il fornitore{" "}
            <strong>
              non garantisce l&apos;aggiudicazione di una gara, l&apos;attribuzione di un
              determinato punteggio tecnico, né l&apos;ammissione alla procedura.
            </strong>
          </p>
          <p>
            L&apos;esito di una procedura dipende da fattori che esulano dal controllo del
            fornitore, tra cui il contenuto finale dell&apos;offerta come rivista dal cliente, le
            valutazioni discrezionali della commissione giudicatrice, le offerte dei concorrenti
            e le determinazioni della stazione appaltante.
          </p>
          <p>
            È onere esclusivo del cliente verificare la conformità dell&apos;offerta alla
            documentazione di gara e alla normativa vigente, il rispetto dei termini e delle
            modalità di presentazione, nonché l&apos;esattezza di ogni dato e riferimento
            contenuto nei testi generati.
          </p>
          <p>
            Qualora il disciplinare di gara imponga di dichiarare l&apos;utilizzo di sistemi di
            intelligenza artificiale nella predisposizione dell&apos;offerta, l&apos;adempimento
            è a carico del cliente.
          </p>

          <h2 id="clausola-12">12. Disponibilità del servizio</h2>
          <p>
            Il fornitore si adopera per garantire la continuità del servizio, senza però
            assumere obblighi di disponibilità continuativa. Sono possibili interruzioni per
            manutenzione, aggiornamenti o cause non imputabili al fornitore, tra cui
            l&apos;indisponibilità dei servizi dei fornitori terzi da cui il servizio dipende.
          </p>
          <p>
            Le interruzioni programmate sono comunicate con ragionevole preavviso. In caso di
            indisponibilità prolungata e imputabile al fornitore, il cliente ha diritto a
            un&apos;estensione del periodo di abbonamento pari alla durata dell&apos;interruzione.
          </p>

          <h2 id="clausola-13">13. Diritto di recesso</h2>
          <p>
            Il diritto di recesso previsto dal Codice del Consumo non si applica agli
            abbonamenti sottoscritti da imprese, società, professionisti ed enti
            nell&apos;esercizio della propria attività, che costituiscono la generalità della
            clientela di OMNIA AI.
          </p>
          <p>
            Ove l&apos;abbonamento sia sottoscritto da un consumatore, trattandosi di servizio
            digitale fornito senza supporto materiale, il diritto di recesso si perde nel momento
            in cui l&apos;esecuzione ha inizio, a condizione che il consumatore abbia
            espressamente richiesto l&apos;esecuzione immediata e riconosciuto di perdere il
            recesso. Tale accettazione è raccolta prima del pagamento.
          </p>

          <h2 id="clausola-14">14. Limitazione di responsabilità</h2>
          <p>
            Nei limiti consentiti dalla legge, e salvi i casi di dolo e colpa grave, la
            responsabilità complessiva del fornitore per qualsiasi pretesa connessa al servizio è
            limitata all&apos;importo corrisposto dal cliente nei dodici mesi precedenti
            l&apos;evento. Il fornitore non risponde di danni indiretti, mancato guadagno,
            perdita di chance o mancata aggiudicazione.
          </p>

          <h2 id="clausola-15">15. Reclami</h2>
          <p>
            I reclami vanno inviati a info@omniaitalia.com o a omnia26@legalmail.it. Rispondiamo
            entro quindici giorni lavorativi. Il consumatore può rivolgersi a un organismo di
            mediazione iscritto negli elenchi ministeriali competenti.
          </p>

          <h2 id="clausola-16">16. Legge applicabile e foro</h2>
          <p>
            Il contratto è regolato dalla legge italiana. Per le controversie con clienti
            professionali è competente in via esclusiva il foro del luogo in cui ha sede il
            fornitore. Per le controversie con consumatori resta competente, in quanto
            inderogabile, il foro del luogo di residenza o domicilio del consumatore, se ubicato
            in Italia.
          </p>

          <h2 id="clausola-17">17. Modifiche</h2>
          <p>
            Il fornitore può aggiornare queste condizioni con preavviso di almeno trenta giorni
            comunicato via email. Il cliente che non intenda accettarle può disdire senza costi
            entro tale termine. A ciascun periodo di abbonamento si applicano le condizioni
            vigenti al momento del suo avvio.
          </p>
        </div>
      </section>
    </>
  );
}
