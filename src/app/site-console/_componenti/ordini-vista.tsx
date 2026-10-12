import Link from "next/link";
import type { ElencoOrdini, FiltroStato, RigaOrdine } from "@/lib/console/ordini";
import type { StatoAzione } from "../azioni/ordini";
import AvvisoEsito, { type ParametriEsito } from "./avviso-esito";
import { Badge, Pannello } from "./elementi";
import { formattaData, formattaDataOra, formattaEuro } from "./formati";
import FormFattura from "./form-fattura";
import PulsanteAzione from "./pulsante-azione";

// Vista pura della pagina Ordini: elenco già letto e filtrato, azioni come prop.

type Azione = (stato: StatoAzione, dati: FormData) => Promise<StatoAzione>;

function percorsoFiltro(stato: FiltroStato, q: string): string {
  const parametri = new URLSearchParams();
  if (stato !== "tutti") parametri.set("stato", stato);
  if (q) parametri.set("q", q);
  const testo = parametri.toString();
  return testo ? `/ordini?${testo}` : "/ordini";
}

function badgeStato(stato: RigaOrdine["stato"]) {
  return stato === "pagato" ? <Badge tono="ok">pagato</Badge> : <Badge tono="avviso">in attesa</Badge>;
}

export default function OrdiniVista({
  elenco,
  righe,
  conteggi,
  stato,
  q,
  esito,
  azioneFattura,
  azioneElimina,
}: {
  elenco: ElencoOrdini;
  righe: RigaOrdine[];
  conteggi: { tutti: number; inAttesa: number; pagati: number };
  stato: FiltroStato;
  q: string;
  esito: ParametriEsito;
  azioneFattura: Azione;
  azioneElimina: Azione;
}) {
  const filtri: { valore: FiltroStato; etichetta: string; n: number }[] = [
    { valore: "tutti", etichetta: "Tutti", n: conteggi.tutti },
    { valore: "in_attesa", etichetta: "In attesa", n: conteggi.inAttesa },
    { valore: "pagato", etichetta: "Pagati", n: conteggi.pagati },
  ];

  return (
    <>
      <div className="cn-testata">
        <div>
          <h1>Ordini</h1>
          <p>Ordini dell&apos;e-commerce, dal più recente · importi IVA inclusa</p>
        </div>
      </div>

      <AvvisoEsito {...esito} />

      {elenco.errore && (
        <p className="cn-esito errore" role="alert" style={{ marginBottom: 14 }}>
          {elenco.errore}
        </p>
      )}
      {!elenco.dataPagamentoDisponibile && (
        <p className="cn-esito avviso" role="status" style={{ marginBottom: 14 }}>
          La data di pagamento non è ancora disponibile: eseguire la migrazione 0075.
        </p>
      )}

      <div className="cn-barra-strumenti">
        <nav className="cn-filtri" aria-label="Filtro per stato">
          {filtri.map((f) => (
            <Link key={f.valore} href={percorsoFiltro(f.valore, q)} className={stato === f.valore ? "attivo" : undefined}>
              {f.etichetta} <span>{f.n}</span>
            </Link>
          ))}
        </nav>
        <form action="/ordini" method="get" className="cn-ricerca">
          {stato !== "tutti" && <input type="hidden" name="stato" value={stato} />}
          <input
            className="cn-input"
            type="search"
            name="q"
            defaultValue={q}
            placeholder="Email, prodotto o id ordine"
            aria-label="Cerca negli ordini"
          />
          <button type="submit" className="cn-btn">
            Cerca
          </button>
        </form>
      </div>

      <Pannello titolo={`Ordini (${righe.length})`}>
        {righe.length === 0 ? (
          <p className="cn-vuoto">Nessun ordine con questi filtri.</p>
        ) : (
          <div className="cn-scorri">
            <table className="cn-tab">
              <thead>
                <tr>
                  <th>Ordine</th>
                  <th>Cliente</th>
                  <th>Prodotto</th>
                  <th>Stato</th>
                  <th>Pagamento</th>
                  <th className="num">Importo</th>
                  <th>Ordinato il</th>
                  <th>Pagato il</th>
                  <th>Fattura</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {righe.map((r) => (
                  <tr key={r.id}>
                    <td className="mono" title={r.id}>
                      {r.id.slice(0, 8)}
                    </td>
                    <td className="tronca" title={r.email ?? undefined}>
                      {r.email ?? "—"}
                    </td>
                    <td>{r.prodotto ?? "—"}</td>
                    <td>{badgeStato(r.stato)}</td>
                    <td>{r.metodo ?? "—"}</td>
                    <td className="num">{formattaEuro(r.importo)}</td>
                    <td className="mono">{formattaData(r.creatoIl)}</td>
                    <td className="mono">
                      {r.stato !== "pagato" ? (
                        "—"
                      ) : r.pagatoIl ? (
                        <span title={formattaDataOra(r.pagatoIl)}>{formattaData(r.pagatoIl)}</span>
                      ) : (
                        <span title="Data non registrata: ordine confermato prima della migrazione 0075">n.d.</span>
                      )}
                    </td>
                    <td>
                      {r.stato !== "pagato" ? (
                        "—"
                      ) : r.fatturaCaricata ? (
                        <Badge tono="ok">caricata</Badge>
                      ) : (
                        <FormFattura orderId={r.id} azione={azioneFattura} />
                      )}
                    </td>
                    <td>
                      <PulsanteAzione
                        azione={azioneElimina}
                        campi={{ orderId: r.id }}
                        conferma={`Eliminare definitivamente l'ordine ${r.id.slice(0, 8)}? L'operazione non è reversibile.`}
                        etichetta="Elimina"
                        etichettaInCorso="Elimino…"
                        variante="pericolo"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Pannello>

      {elenco.troncato && (
        <p style={{ marginTop: 10, color: "var(--cn-fioco)" }}>Mostrati gli ultimi 500 ordini; restringi con la ricerca per vedere gli altri.</p>
      )}
    </>
  );
}
