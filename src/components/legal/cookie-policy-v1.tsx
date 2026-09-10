// Versione 1 della Cookie policy — corrisponde a legal/cookie-policy-v1.md.
// Immutabile dopo la pubblicazione: le revisioni future sono nuovi
// componenti (CookiePolicyV2, ecc.), mai una modifica a questo file.

const h2 = "mt-10 font-serif text-xl text-ink";
const p = "mt-3 text-justify text-sm text-sage";
const tableWrap =
  "mt-4 overflow-x-auto rounded-2xl border border-border bg-cream-soft";
const table = "min-w-full divide-y divide-border text-sm";
const th = "px-4 py-2 text-left font-medium text-ink";
const td = "px-4 py-2 text-sage";

export default function CookiePolicyV1() {
  return (
    <main className="flex-1">
      <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
        <h1 className="font-serif text-3xl text-ink">Cookie policy</h1>
        <p className="mt-1 font-mono text-xs tracking-wide text-sage uppercase">
          Versione 1 — in vigore dal 10 settembre 2026
        </p>

        <p className={p}>
          I cookie sono piccoli file che i siti salvano sul tuo dispositivo.
          Alcuni servono a far funzionare il sito, altri a misurare
          l&apos;efficacia della pubblicità. Insieme ai cookie utilizziamo
          tecnologie analoghe, come l&apos;archiviazione locale del browser:
          valgono le stesse regole.
        </p>

        <h2 className={h2}>Cookie tecnici, sempre attivi</h2>
        <p className={p}>
          Non richiedono consenso perché senza di essi il sito non funziona.
        </p>

        <div className={tableWrap}>
          <table className={table}>
            <thead>
              <tr>
                <th className={th}>Cookie</th>
                <th className={th}>Origine</th>
                <th className={th}>Finalità</th>
                <th className={th}>Durata</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              <tr>
                <td className={td}>Sessione di autenticazione</td>
                <td className={td}>app.omniaitalia.com</td>
                <td className={td}>
                  Ti mantiene collegato all&apos;area riservata
                </td>
                <td className={td}>Fino a 7 giorni</td>
              </tr>
              <tr>
                <td className={td}>Preferenza cookie</td>
                <td className={td}>app.omniaitalia.com</td>
                <td className={td}>
                  Ricorda la scelta espressa sul banner
                </td>
                <td className={td}>6 mesi</td>
              </tr>
              <tr>
                <td className={td}>Cookie di pagamento</td>
                <td className={td}>Stripe</td>
                <td className={td}>
                  Sicurezza della transazione e prevenzione delle frodi
                </td>
                <td className={td}>Fino a 12 mesi</td>
              </tr>
            </tbody>
          </table>
        </div>

        <p className={p}>
          Se li blocchi dalle impostazioni del browser non potrai accedere
          all&apos;area riservata né completare un pagamento.
        </p>

        <h2 className={h2}>Cookie pubblicitari, solo con il tuo consenso</h2>

        <div className={tableWrap}>
          <table className={table}>
            <thead>
              <tr>
                <th className={th}>Cookie</th>
                <th className={th}>Origine</th>
                <th className={th}>Finalità</th>
                <th className={th}>Durata</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              <tr>
                <td className={td}>Google Ads</td>
                <td className={td}>Google</td>
                <td className={td}>
                  Attribuisce l&apos;acquisto alla campagna pubblicitaria di
                  provenienza e consente il remarketing
                </td>
                <td className={td}>Fino a 90 giorni</td>
              </tr>
            </tbody>
          </table>
        </div>

        <p className={p}>
          <strong className="text-ink">
            Il tag di Google Ads non viene caricato finché non premi
            &quot;Accetta&quot;.
          </strong>{" "}
          Se scegli &quot;Rifiuta&quot;, o se ignori il banner, nessun dato
          viene inviato a Google.
        </p>

        <h2 className={h2}>Come cambiare idea</h2>
        <p className={p}>
          Puoi modificare o revocare la tua scelta in qualsiasi momento dal
          collegamento &quot;Preferenze cookie&quot; presente nel piè di
          pagina, oppure cancellando i dati di navigazione del browser per
          questo sito. La revoca non pregiudica la liceità del trattamento
          già effettuato.
        </p>

        <h2 className={h2}>Titolare</h2>
        <p className={p}>
          Omnia Consulting SRLS — P.IVA 02957590819 — info@omniaitalia.com.
          Per ogni altro aspetto si rinvia alla Privacy policy.
        </p>
      </div>
    </main>
  );
}
