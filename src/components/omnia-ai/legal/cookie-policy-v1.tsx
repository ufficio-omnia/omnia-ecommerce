// Versione 1 della Cookie policy di omnia-ai.it — corrisponde esattamente
// a legal/cookie-policy-omnia-ai-v1.md (stesso contenuto legale,
// revisionato). Una volta pubblicata, questa versione non si modifica
// mai: una revisione futura sarà un nuovo file CookiePolicyV2 con
// propria voce in legal_documents, mai una modifica a questo componente.

export default function CookiePolicyV1() {
  return (
    <>
      <section className="omnia-pagina-hero">
        <h1>Cookie policy</h1>
        <p className="micro" style={{ marginTop: 12, color: "var(--fioco)" }}>
          Versione 1 — in vigore dall&apos;11 settembre 2026
        </p>
      </section>

      <section className="omnia-pagina-corpo">
        <div className="omnia-prosa">
          <p>
            I cookie sono piccoli file che i siti salvano sul tuo dispositivo. Alcuni servono a
            far funzionare il servizio, altri a misurare l&apos;efficacia della pubblicità.
            Insieme ai cookie utilizziamo tecnologie analoghe, come l&apos;archiviazione locale
            del browser: valgono le stesse regole.
          </p>

          <h2>Cookie tecnici, sempre attivi</h2>
          <div className="omnia-tabella-scroll">
            <table>
              <thead>
                <tr>
                  <th>Cookie</th>
                  <th>Origine</th>
                  <th>Finalità</th>
                  <th>Durata</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Sessione di autenticazione</td>
                  <td>omnia-ai.it</td>
                  <td>Ti mantiene collegato all&apos;area riservata</td>
                  <td>Fino a 7 giorni</td>
                </tr>
                <tr>
                  <td>Preferenza cookie</td>
                  <td>omnia-ai.it</td>
                  <td>Ricorda la scelta espressa sul banner</td>
                  <td>6 mesi</td>
                </tr>
                <tr>
                  <td>Cookie di pagamento</td>
                  <td>Stripe</td>
                  <td>Sicurezza della transazione e prevenzione delle frodi</td>
                  <td>Fino a 12 mesi</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p>
            Se li blocchi dalle impostazioni del browser non potrai accedere all&apos;area
            riservata né attivare un abbonamento.
          </p>

          <h2>Cookie pubblicitari, solo con il tuo consenso</h2>
          <div className="omnia-tabella-scroll">
            <table>
              <thead>
                <tr>
                  <th>Cookie</th>
                  <th>Origine</th>
                  <th>Finalità</th>
                  <th>Durata</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Google Ads</td>
                  <td>Google</td>
                  <td>Attribuisce l&apos;attivazione dell&apos;abbonamento alla campagna di provenienza</td>
                  <td>Fino a 90 giorni</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p>
            Il tag pubblicitario non viene caricato finché non premi &quot;Accetta&quot;. Se
            scegli &quot;Rifiuta&quot;, o se ignori il banner, nessun dato viene inviato a Google.
          </p>

          <h2>Come cambiare idea</h2>
          <p>
            Puoi modificare o revocare la scelta in qualsiasi momento dal collegamento
            &quot;Preferenze cookie&quot; nel piè di pagina, oppure cancellando i dati di
            navigazione del browser per questo sito. La revoca non pregiudica la liceità del
            trattamento già effettuato.
          </p>

          <h2>Titolare</h2>
          <p>
            Omnia Consulting SRLS — P.IVA 02957590819 — info@omniaitalia.com. Per ogni altro
            aspetto si rinvia alla Privacy policy.
          </p>
        </div>
      </section>
    </>
  );
}
