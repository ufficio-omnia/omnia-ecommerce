// Versione 1 della Privacy policy — corrisponde esattamente a
// legal/privacy-policy-v1.md (riga per riga, stesso contenuto legale).
// Una volta pubblicata, questa versione non si modifica mai: una
// revisione futura sarà un nuovo file PrivacyPolicyV2 con propria voce
// in legal_documents, mai una modifica a questo componente.

const h2 = "mt-10 font-serif text-xl text-ink";
const p = "mt-3 text-justify text-sm text-sage";
const ul = "mt-3 list-disc space-y-1 pl-5 text-sm text-sage";
const tableWrap =
  "mt-4 overflow-x-auto rounded-2xl border border-border bg-cream-soft";
const table = "min-w-full divide-y divide-border text-sm";
const th = "px-4 py-2 text-left font-medium text-ink";
const td = "px-4 py-2 text-sage";

export default function PrivacyPolicyV1() {
  return (
    <main className="flex-1">
      <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
        <h1 className="font-serif text-3xl text-ink">Privacy policy</h1>
        <p className="mt-1 font-mono text-xs tracking-wide text-sage uppercase">
          Versione 1 — in vigore dal 10 settembre 2026
        </p>

        <p className={p}>
          La presente informativa descrive come Omnia Consulting SRLS
          (&quot;Omnia&quot;, &quot;noi&quot;) tratta i dati personali di chi
          utilizza l&apos;area di acquisto e l&apos;area riservata di questo
          sito (app.omniaitalia.com), ai sensi del Regolamento UE 2016/679
          (GDPR) e del Codice Privacy italiano (D.Lgs. 196/2003 e successive
          modifiche).
        </p>
        <p className={p}>
          Il sito vetrina omniaitalia.com ha un&apos;informativa propria.
        </p>

        <h2 className={h2}>Titolare del trattamento</h2>
        <p className={p}>
          Omnia Consulting SRLS
          <br />
          P.IVA 02957590819
          <br />
          Email: info@omniaitalia.com
          <br />
          PEC: omnia26@legalmail.it
        </p>

        <h2 className={h2}>Dati raccolti e finalità</h2>
        <p className={p}>
          Questo sito consente di acquistare documenti digitali e di accedere
          a un&apos;area riservata personale. A differenza del sito vetrina,
          richiede quindi la creazione di un account e il trattamento dei
          dati necessari all&apos;acquisto e alla fatturazione.
        </p>
        <p className={p}>
          Non vengono installati cookie di profilazione all&apos;apertura
          della pagina; l&apos;unica eccezione è il tag pubblicitario di
          Google Ads, descritto più sotto, attivato solo previo consenso
          esplicito.
        </p>

        <div className={tableWrap}>
          <table className={table}>
            <thead>
              <tr>
                <th className={th}>Dato</th>
                <th className={th}>Quando</th>
                <th className={th}>Finalità</th>
                <th className={th}>Base giuridica</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              <tr>
                <td className={td}>Nome, cognome, email</td>
                <td className={td}>Alla creazione dell&apos;account</td>
                <td className={td}>
                  Identificarti, darti accesso all&apos;area riservata,
                  inviarti le comunicazioni sull&apos;ordine
                </td>
                <td className={td}>Esecuzione del contratto</td>
              </tr>
              <tr>
                <td className={td}>Password</td>
                <td className={td}>Alla creazione dell&apos;account</td>
                <td className={td}>
                  Proteggere l&apos;accesso. È conservata cifrata e non è
                  leggibile da noi
                </td>
                <td className={td}>Esecuzione del contratto</td>
              </tr>
              <tr>
                <td className={td}>
                  Ragione sociale, P.IVA o codice fiscale, indirizzo, codice
                  destinatario o PEC
                </td>
                <td className={td}>Al momento dell&apos;acquisto</td>
                <td className={td}>Emettere la fattura elettronica</td>
                <td className={td}>Obbligo legale</td>
              </tr>
              <tr>
                <td className={td}>
                  Ordini, importi, stato del pagamento, documenti scaricati
                </td>
                <td className={td}>Durante l&apos;uso del servizio</td>
                <td className={td}>
                  Gestire l&apos;ordine, sbloccare i download, fornire
                  assistenza
                </td>
                <td className={td}>Esecuzione del contratto</td>
              </tr>
              <tr>
                <td className={td}>
                  Esito della transazione e identificativo del pagamento
                </td>
                <td className={td}>Al pagamento con carta</td>
                <td className={td}>Confermare l&apos;avvenuto pagamento</td>
                <td className={td}>Esecuzione del contratto</td>
              </tr>
              <tr>
                <td className={td}>Dati dell&apos;ordinante del bonifico</td>
                <td className={td}>Al pagamento con bonifico</td>
                <td className={td}>
                  Verificare l&apos;accredito e abbinarlo all&apos;ordine
                </td>
                <td className={td}>Esecuzione del contratto</td>
              </tr>
              <tr>
                <td className={td}>
                  Dati tecnici di navigazione (log del server, es. indirizzo
                  IP)
                </td>
                <td className={td}>Automaticamente, ad ogni visita</td>
                <td className={td}>
                  Sicurezza del sito, prevenzione di accessi non autorizzati e
                  di abusi nel download dei file
                </td>
                <td className={td}>Legittimo interesse</td>
              </tr>
              <tr>
                <td className={td}>Contenuto dei messaggi di assistenza</td>
                <td className={td}>Se ci scrivi</td>
                <td className={td}>Rispondere alla richiesta</td>
                <td className={td}>
                  Esecuzione del contratto / legittimo interesse
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <p className={p}>
          <strong className="text-ink">
            I dati della tua carta non transitano mai dai nostri sistemi e
            non vengono da noi memorizzati.
          </strong>{" "}
          Sono trattati direttamente da Stripe su pagina sicura; noi
          riceviamo soltanto l&apos;esito dell&apos;operazione.
        </p>

        <h2 className={h2}>Font e risorse del sito</h2>
        <p className={p}>
          I caratteri tipografici utilizzati sono ospitati direttamente su
          questo sito e non vengono richiamati da server esterni: la visita
          non comporta quindi l&apos;invio del tuo indirizzo IP a terze parti
          per questo scopo.
        </p>

        <h2 className={h2}>Cookie pubblicitari (Google Ads)</h2>
        <p className={p}>
          Se acconsenti tramite il banner mostrato alla prima visita, questo
          sito utilizza il tag di Google Ads per misurare l&apos;efficacia
          delle nostre campagne pubblicitarie — ad esempio per capire quale
          annuncio ha portato a un acquisto — e per finalità di remarketing.
          Questo comporta l&apos;installazione di cookie e l&apos;invio di
          dati di navigazione a Google, anche verso paesi extra-UE, sulla
          base delle clausole contrattuali standard adottate da Google.
        </p>
        <p className={p}>
          Puoi rifiutare questi cookie dal banner stesso, oppure revocare il
          consenso in qualsiasi momento dal collegamento &quot;Preferenze
          cookie&quot; nel piè di pagina. Se rifiuti, puoi comunque navigare
          e acquistare senza alcuna limitazione. Maggiori dettagli nella
          nostra Cookie policy.
        </p>

        <h2 className={h2}>Fornitori che trattano i dati per nostro conto</h2>
        <p className={p}>
          Per erogare il servizio ci avvaliamo di fornitori nominati
          responsabili del trattamento:
        </p>
        <ul className={ul}>
          <li>
            <strong className="text-ink">Vercel</strong> — hosting
            dell&apos;applicazione
          </li>
          <li>
            <strong className="text-ink">Supabase</strong> — database,
            autenticazione e archiviazione dei file, con infrastruttura in
            Unione Europea
          </li>
          <li>
            <strong className="text-ink">Stripe</strong> — elaborazione dei
            pagamenti con carta
          </li>
          <li>
            <strong className="text-ink">Resend</strong> — invio delle email
            relative all&apos;ordine e all&apos;account
          </li>
          <li>
            <strong className="text-ink">Studio commercialista</strong> —
            adempimenti fiscali e fatturazione
          </li>
          <li>
            <strong className="text-ink">Google</strong> — misurazione delle
            campagne pubblicitarie, solo previo consenso
          </li>
        </ul>
        <p className={p}>
          Alcuni di questi fornitori hanno sede negli Stati Uniti: il
          trasferimento avviene sulla base delle clausole contrattuali
          standard approvate dalla Commissione Europea e, ove applicabile,
          dell&apos;adesione al Data Privacy Framework UE-USA. Puoi chiederci
          copia delle garanzie adottate scrivendo a info@omniaitalia.com.
        </p>
        <p className={p}>
          Non vendiamo i tuoi dati e non li cediamo a terzi per finalità di
          marketing altrui.
        </p>

        <h2 className={h2}>Conservazione dei dati</h2>
        <p className={p}>
          Account, ordini e documenti fiscali sono conservati per tutta la
          durata del rapporto e per dieci anni dall&apos;ultimo acquisto, in
          ottemperanza agli obblighi contabili. I documenti acquistati
          restano scaricabili finché l&apos;account è attivo. I log tecnici
          sono conservati fino a dodici mesi, le email di assistenza fino a
          ventiquattro mesi dalla chiusura della richiesta. I dati trattati
          sulla base del consenso sono conservati fino alla revoca.
        </p>

        <h2 className={h2}>Decisioni automatizzate</h2>
        <p className={p}>
          Non effettuiamo profilazione né decisioni automatizzate che
          producano effetti giuridici nei tuoi confronti.
        </p>

        <h2 className={h2}>Diritti dell&apos;interessato</h2>
        <p className={p}>
          In qualsiasi momento puoi richiedere l&apos;accesso, la rettifica,
          la cancellazione o la limitazione del trattamento dei tuoi dati,
          chiederne la portabilità, oppure opporti al trattamento fondato sul
          legittimo interesse, scrivendo a info@omniaitalia.com. Dove il
          trattamento si basa sul consenso, puoi revocarlo liberamente senza
          pregiudicare la liceità di quanto avvenuto in precedenza.
        </p>
        <p className={p}>
          La cancellazione dell&apos;account comporta la perdita
          dell&apos;accesso ai documenti acquistati; restano conservati i
          soli dati necessari agli obblighi fiscali.
        </p>
        <p className={p}>
          Hai inoltre diritto di proporre reclamo al Garante per la
          Protezione dei Dati Personali (www.garanteprivacy.it).
        </p>

        <h2 className={h2}>Modifiche a questa informativa</h2>
        <p className={p}>
          Questa informativa può essere aggiornata nel tempo. La versione in
          vigore è sempre quella pubblicata su questa pagina.
        </p>
      </div>
    </main>
  );
}
