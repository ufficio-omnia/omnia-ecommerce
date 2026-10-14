import type { ReactNode } from "react";
import Link from "next/link";
import { dataRoma } from "@/lib/data-it";
import type { PagamentoCliente } from "@/lib/omnia-ai-pagamenti";
import { formatEuro } from "@/lib/omnia-ai-plans";

// Vista della pagina «Pagamenti e fatture» dell'area riservata: lo storico dei pagamenti
// dell'abbonamento OMNIA AI, la ricevuta di Stripe e la FATTURA, tenute ben distinte.
// Riceve dati già letti e calcolati; il pulsante del portale Stripe arriva come figlio
// (è un componente client con la sua azione).

function CellaFattura({ p }: { p: PagamentoCliente }) {
  const f = p.fattura;
  const dettaglio = f.tipo === "disponibile" || f.tipo === "emessa" ? [f.numero ? `n. ${f.numero}` : null, f.data ? `del ${dataRoma(f.data + "T12:00:00Z")}` : null].filter(Boolean).join(" ") : "";

  switch (f.tipo) {
    case "disponibile":
      return (
        <>
          <a className="omnia-btn omnia-btn-p omnia-btn-piccolo" href={`/dashboard/omnia-ai/pagamenti/fattura/${p.fonte}/${p.id}`}>
            Scarica fattura
          </a>
          {dettaglio && <div className="omnia-pagamento-nota">Fattura {dettaglio}</div>}
        </>
      );
    case "emessa":
      return (
        <>
          <span className="omnia-badge verde">Emessa</span>
          <div className="omnia-pagamento-nota">{dettaglio ? `Fattura ${dettaglio}.` : "Fattura emessa."} Non c&apos;è un file da scaricare qui: scrivici dal Supporto se ti serve.</div>
        </>
      );
    case "non_dovuta":
      return <span className="omnia-pagamento-nota">Nessuna fattura da emettere</span>;
    case "in_preparazione":
      return (
        <>
          <span className="omnia-badge ambra">In arrivo</span>
          <div className="omnia-pagamento-nota">Te la inviamo separatamente e compare qui appena emessa.</div>
        </>
      );
  }
}

export default function PagamentiVista({
  pagamenti,
  storicoAbbonamentoDisponibile,
  portale,
}: {
  pagamenti: PagamentoCliente[];
  // false se non si riesce a leggere lo storico degli incassi dell'abbonamento (migrazione 0081 non ancora eseguita)
  storicoAbbonamentoDisponibile: boolean;
  // pulsante del portale clienti di Stripe, se il cliente ha un abbonamento attivo con Stripe
  portale: ReactNode | null;
}) {
  return (
    <div className="omnia-app-shell largo">
      <Link href="/dashboard/omnia-ai" className="omnia-torna">
        ← Torna alla dashboard
      </Link>

      <h1 className="omnia-app-titolo">Pagamenti e fatture</h1>
      <p className="omnia-app-sottotitolo">I pagamenti OMNIA AI (abbonamento, crediti e revisioni umane), con la ricevuta di Stripe e la fattura di ciascuno.</p>

      <section className="omnia-riquadro" aria-labelledby="ricevuta-non-fattura">
        <span className="omnia-eyebrow" id="ricevuta-non-fattura">
          Ricevuta e fattura sono due documenti diversi
        </span>
        <p className="omnia-messaggio-stato avviso" style={{ marginTop: 12 }}>
          <strong>La ricevuta di Stripe non è la fattura.</strong> Stripe te la invia a ogni addebito come conferma del pagamento con carta, ma non ha valore fiscale. Nelle pagine di Stripe compare anche una voce «fattura» con un numero (per esempio FJXLL3LD-0018): è la numerazione interna di Stripe, non la nostra fattura. La fattura la emette Omnia Consulting e ti arriva separatamente: appena è pronta la trovi qui, accanto al pagamento, e puoi scaricarla quando vuoi.
        </p>
      </section>

      {portale && (
        <section className="omnia-riquadro">
          <span className="omnia-eyebrow">Ricevute di Stripe e metodo di pagamento</span>
          <p className="omnia-riquadro-nota">Dal portale di Stripe scarichi da solo le ricevute di ogni rinnovo e puoi cambiare la carta con cui paghi.</p>
          <div style={{ marginTop: 16 }}>{portale}</div>
        </section>
      )}

      <section className="omnia-riquadro">
        <span className="omnia-eyebrow">Storico dei pagamenti</span>

        {!storicoAbbonamentoDisponibile && (
          <p className="omnia-messaggio-stato avviso" style={{ marginTop: 12 }}>
            Lo storico dei pagamenti dell&apos;abbonamento non è ancora disponibile. Riprova tra poco o scrivici dal Supporto.
          </p>
        )}

        {pagamenti.length === 0 ? (
          <p className="omnia-elenco-vuoto" style={{ marginTop: 12 }}>
            Non risultano ancora pagamenti.
          </p>
        ) : (
          <div className="omnia-tabella-scroll">
            <table>
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Descrizione</th>
                  <th className="num">Importo (IVA inclusa)</th>
                  <th>Stato</th>
                  <th>Documento Stripe</th>
                  <th>Fattura</th>
                </tr>
              </thead>
              <tbody>
                {pagamenti.map((p) => (
                  <tr key={p.chiave}>
                    <td style={{ whiteSpace: "nowrap" }}>{dataRoma(p.data)}</td>
                    <td>{p.descrizione}</td>
                    <td className="num" style={{ whiteSpace: "nowrap" }}>
                      {formatEuro(p.importoCentesimi)}
                    </td>
                    <td>
                      <span className="omnia-badge verde">Pagato</span>
                      {p.prova && (
                        <>
                          {" "}
                          <span className="omnia-badge ambra">di prova</span>
                        </>
                      )}
                    </td>
                    <td>
                      {/* Il numero che arriva da Stripe (p.numeroRicevuta) è quello della SUA «fattura»
                          interna, non di una ricevuta: mostrarlo sotto «ricevuta» lo farebbe scambiare per
                          un numero di fattura. Non si mostra; si lascia solo il collegamento. */}
                      {p.ricevutaUrl ? (
                        <>
                          <a href={p.ricevutaUrl} target="_blank" rel="noopener noreferrer">
                            Apri su Stripe
                          </a>
                          <div className="omnia-pagamento-nota">Documento Stripe, non fiscale</div>
                        </>
                      ) : (
                        <span className="omnia-pagamento-nota">—</span>
                      )}
                    </td>
                    <td>
                      <CellaFattura p={p} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="omnia-riquadro-nota">
        Le fatture riportano i dati del tuo <Link href="/dashboard/omnia-ai/profilo-azienda">profilo azienda</Link>: se qualcosa è sbagliato, correggilo lì e scrivici dalla pagina{" "}
        <Link href="/dashboard/omnia-ai/assistenza">Supporto</Link>.
      </p>
    </div>
  );
}
