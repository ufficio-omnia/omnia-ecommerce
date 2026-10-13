import { PACCHETTI_CREDITI, PIANI, PIANI_ORDINE, formatEuro } from "@/lib/omnia-ai-plans";
import type { BankDetails } from "@/lib/bank-details";
import type { StatoParametri } from "@/lib/console/costi";
import { eIbanDiEsempio, erroreIban } from "@/lib/console/iban";
import { salvaParametri } from "../azioni/costi";
import { salvaDatiBancari } from "../azioni/impostazioni";
import { Pannello } from "./elementi";
import FormParametri from "./form-parametri";
import ModuloAzione from "./modulo-azione";

// Vista della pagina Impostazioni: dati bancari del bonifico, parametri di calcolo
// (cambio e IVA) e, in sola lettura, il listino di OMNIA AI che sta nel codice.

export default function ImpostazioniVista({ banca, parametri }: { banca: BankDetails; parametri: StatoParametri }) {
  const esempio = eIbanDiEsempio(banca.iban);
  const vuoto = banca.iban.trim() === "" || banca.intestatario.trim() === "";
  const problema = vuoto || esempio ? null : erroreIban(banca.iban);

  return (
    <>
      <div className="cn-testata">
        <div>
          <h1>Impostazioni</h1>
          <p>Dati bancari per i bonifici e parametri con cui la console calcola costi e ricavi</p>
        </div>
      </div>

      {(esempio || vuoto) && (
        <p className="cn-esito errore" role="alert" style={{ marginBottom: 14 }}>
          {vuoto
            ? "I dati bancari sono vuoti: chi sceglie il bonifico non sa dove pagare."
            : "L'IBAN salvato è ancora quello di esempio inserito dalla migrazione iniziale: i clienti che scelgono il bonifico vedono un conto che non esiste. Sostituiscilo prima di andare online."}
        </p>
      )}
      {problema && (
        <p className="cn-esito avviso" role="alert" style={{ marginBottom: 14 }}>
          L&apos;IBAN attualmente salvato non supera il controllo: {problema}
        </p>
      )}

      <div className="cn-colonne cn-colonne-pari">
        <Pannello titolo="Dati bancari (bonifico)">
          <div className="cn-pannello-corpo">
            <ModuloAzione azione={salvaDatiBancari} etichetta="Salva dati bancari" etichettaInCorso="Salvo…" messaggioOk="Dati bancari salvati." variante="primario" classe="cn-modulo">
              <div>
                <label className="cn-etichetta" htmlFor="iban">
                  IBAN
                </label>
                <input className="cn-input mono-campo" id="iban" name="iban" required defaultValue={banca.iban} autoComplete="off" spellCheck={false} />
              </div>
              <div>
                <label className="cn-etichetta" htmlFor="intestatario">
                  Intestatario
                </label>
                <input className="cn-input" id="intestatario" name="intestatario" required maxLength={120} defaultValue={banca.intestatario} autoComplete="off" />
              </div>
            </ModuloAzione>
            <p className="cn-nota-inline" style={{ marginTop: 10 }}>
              Questi dati compaiono nell&apos;area riservata del cliente che sceglie il bonifico e nell&apos;email che riceve subito dopo l&apos;ordine. Prima di salvare si controlla la cifra di controllo dell&apos;IBAN: un refuso manderebbe i bonifici su un altro conto.
            </p>
          </div>
        </Pannello>

        <Pannello titolo="Parametri di calcolo">
          <FormParametri azione={salvaParametri} cambio={parametri.cambioUsdEur} iva={parametri.aliquotaIva} />
          <p className="cn-nota">
            Il cambio converte in euro i costi dei modelli (registrati in dollari); l&apos;aliquota IVA serve a scorporare l&apos;imponibile dai prezzi IVA inclusa. Sono gli stessi della pagina Costi.
            {!parametri.tabellaDisponibile && " La tabella dei parametri non esiste ancora (migrazione 0077): non si possono salvare."}
          </p>
        </Pannello>
      </div>

      <div className="cn-sezione">
        <Pannello titolo="Listino OMNIA AI (sola lettura)">
          <div className="cn-scorri">
            <table className="cn-tab">
              <thead>
                <tr>
                  <th>Voce</th>
                  <th className="num">Prezzo (IVA inclusa)</th>
                  <th>Contenuto</th>
                </tr>
              </thead>
              <tbody>
                {PIANI_ORDINE.map((slug) => (
                  <tr key={slug}>
                    <td>Abbonamento {PIANI[slug].nome}</td>
                    <td className="num">{formatEuro(PIANI[slug].prezzoCentesimi)} / mese</td>
                    <td>{PIANI[slug].gareIncluse} gare incluse ogni mese</td>
                  </tr>
                ))}
                {Object.values(PACCHETTI_CREDITI).map((c) => (
                  <tr key={c.slug}>
                    <td>{c.nome}</td>
                    <td className="num">{formatEuro(c.prezzoCentesimi)}</td>
                    <td>{c.crediti} {c.crediti === 1 ? "credito" : "crediti"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="cn-nota">
            Piani e pacchetti di crediti stanno nel codice (<code>src/lib/omnia-ai-plans.ts</code>) e sono legati ai prezzi su Stripe: non si cambiano da qui. I prodotti dell&apos;e-commerce e i loro sconti sono in «Prodotti e sconti».
          </p>
        </Pannello>
      </div>
    </>
  );
}
