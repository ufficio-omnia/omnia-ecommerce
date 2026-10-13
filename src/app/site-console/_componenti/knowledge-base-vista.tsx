import type { DocumentoKnowledgeBase, KnowledgeBaseLetta } from "@/lib/console/knowledge-base";
import { MINUTI_ELABORAZIONE_SOSPETTA } from "@/lib/console/knowledge-base";
import { caricaDocumento, eliminaDocumento, ricalcolaStruttura } from "../azioni/knowledge-base";
import { Badge, Pannello, Tessera } from "./elementi";
import { formattaDataOra, formattaIntero } from "./formati";
import ModuloAzione from "./modulo-azione";
import PulsanteAzione from "./pulsante-azione";

// Vista della pagina Knowledge base AI: i progetti già svolti (PDF e Word) che OMNIA
// AI usa come riferimento di stile e qualità nelle chat dei clienti. Riceve dati già
// letti; carica, ricalcola ed elimina passano dalle azioni di
// site-console/azioni/knowledge-base.ts.

// I segnaposto dell'anonimizzazione ([NOME AZIENDA], [CITTÀ]…) si evidenziano nell'anteprima.
// split con un gruppo di cattura mette i segnaposto sempre in posizione dispari.
function conEvidenziazione(testo: string) {
  return testo.split(/(\[[^[\]]+\])/g).map((parte, i) => (i % 2 === 1 ? <mark key={i}>{parte}</mark> : <span key={i}>{parte}</span>));
}

function BadgeStato({ d }: { d: DocumentoKnowledgeBase }) {
  if (d.stato === "pronto") return <Badge tono="ok">pronto</Badge>;
  if (d.stato === "errore") return <Badge tono="errore">errore o nessun testo</Badge>;
  if (d.stato === "in_elaborazione") {
    const sospetto = (d.minutiInElaborazione ?? 0) >= MINUTI_ELABORAZIONE_SOSPETTA;
    return <Badge tono="avviso">{sospetto ? `in elaborazione da ${d.minutiInElaborazione} min: forse interrotto` : "in elaborazione"}</Badge>;
  }
  return <Badge>{d.stato}</Badge>;
}

function RigaDocumento({ d }: { d: DocumentoKnowledgeBase }) {
  return (
    <li className="cn-doc">
      <div className="cn-doc-testa">
        <div className="cn-doc-titolo">
          <strong title={d.nomeFile}>{d.nomeFile}</strong>
          <small>
            caricato il {formattaDataOra(d.creatoIl)}
            {d.immagini > 0 && ` · ${d.immagini} ${d.immagini === 1 ? "immagine" : "immagini"} estratte`}
          </small>
        </div>
        <BadgeStato d={d} />
        <div className="cn-azione">
          {d.stato === "pronto" && (
            <PulsanteAzione
              azione={ricalcolaStruttura}
              campi={{ docId: d.id }}
              conferma="Ricalcolare la struttura di questo documento? Fa una chiamata al modello (un piccolo costo)."
              etichetta="Ricalcola struttura"
              etichettaInCorso="Analisi…"
            />
          )}
          <PulsanteAzione azione={eliminaDocumento} campi={{ docId: d.id }} conferma={`Eliminare «${d.nomeFile}» dalla knowledge base? Si cancellano anche il testo indicizzato e le immagini estratte.`} etichetta="Elimina" etichettaInCorso="Elimino…" variante="pericolo" />
        </div>
      </div>

      {d.strutturaTitoli && (
        <details className="cn-doc-dettaglio">
          <summary>Indice e struttura rilevati</summary>
          <pre>{d.strutturaTitoli}</pre>
        </details>
      )}
      {d.notaStile && (
        <details className="cn-doc-dettaglio">
          <summary>Stile e impaginazione rilevati</summary>
          <p>{d.notaStile}</p>
        </details>
      )}
      {d.anteprima ? (
        <details className="cn-doc-dettaglio">
          <summary>Anteprima del testo anonimizzato indicizzato</summary>
          <p className="cn-doc-anteprima">
            {conEvidenziazione(d.anteprima.slice(0, 800))}
            {d.anteprima.length > 800 ? "…" : ""}
          </p>
        </details>
      ) : (
        d.stato === "pronto" && <p className="cn-nota-inline cn-doc-vuoto">Nessun estratto disponibile per l&apos;anteprima.</p>
      )}
    </li>
  );
}

export default function KnowledgeBaseVista({ letta }: { letta: KnowledgeBaseLetta }) {
  const testata = (
    <div className="cn-testata">
      <div>
        <h1>Knowledge base AI</h1>
        <p>Progetti già svolti che OMNIA AI usa come esempio di stile e qualità in tutte le chat dei clienti</p>
      </div>
    </div>
  );

  if (letta.stato === "errore") {
    return (
      <>
        {testata}
        <p className="cn-esito errore" role="alert">
          {letta.messaggio}
        </p>
      </>
    );
  }

  const documenti = letta.documenti;
  const pronti = documenti.filter((d) => d.stato === "pronto").length;
  const inElaborazione = documenti.filter((d) => d.stato === "in_elaborazione").length;
  const conErrore = documenti.filter((d) => d.stato === "errore").length;

  return (
    <>
      {testata}

      {letta.chiaviMancanti.length > 0 && (
        <p className="cn-esito errore" role="alert" style={{ marginBottom: 14 }}>
          In questo ambiente mancano le chiavi dei modelli che servono per caricare un documento: {letta.chiaviMancanti.join("; ")}. Il caricamento fallirebbe.
        </p>
      )}

      <div className="cn-tessere">
        <Tessera etichetta="Documenti" valore={formattaIntero(documenti.length)} dettaglio="Nella knowledge base" />
        <Tessera etichetta="Pronti" valore={formattaIntero(pronti)} tono={pronti > 0 ? "ok" : "neutro"} dettaglio="Indicizzati e usati dall'AI" />
        <Tessera etichetta="In elaborazione" valore={formattaIntero(inElaborazione)} tono={inElaborazione > 0 ? "avviso" : "neutro"} dettaglio="Un documento resta qui finché non finisce" />
        <Tessera etichetta="Con errore" valore={formattaIntero(conErrore)} tono={conErrore > 0 ? "errore" : "neutro"} dettaglio="Non indicizzati: eliminali e riprova" />
      </div>

      <div className="cn-sezione">
        <Pannello titolo="Carica un documento">
          <div className="cn-pannello-corpo">
            <ModuloAzione azione={caricaDocumento} etichetta="Carica documento" etichettaInCorso="Elaborazione in corso…" svuota messaggioOk="Documento caricato e indicizzato." variante="primario" classe="cn-modulo-linea">
              <input type="file" name="file" accept=".pdf,.docx" required className="cn-file" aria-label="Documento da caricare (PDF o Word)" />
            </ModuloAzione>
            <p className="cn-nota-inline" style={{ marginTop: 8 }}>
              PDF o Word (.docx), fino a 25 MB. L&apos;elaborazione può durare qualche minuto: lascia aperta la pagina finché non compare l&apos;esito. Ogni caricamento chiama i modelli (anonimizzazione, analisi dello stile, indicizzazione) e ha un costo reale, visibile tra i costi di piattaforma.
            </p>
          </div>
        </Pannello>
      </div>

      <div className="cn-sezione">
        <Pannello titolo={`Documenti (${documenti.length})`}>
          {documenti.length === 0 ? (
            <p className="cn-vuoto">Nessun documento caricato.</p>
          ) : (
            <ul className="cn-doc-elenco">
              {documenti.map((d) => (
                <RigaDocumento key={d.id} d={d} />
              ))}
            </ul>
          )}
        </Pannello>
      </div>

      <div className="cn-sezione">
        <details className="cn-dettagli">
          <summary>Come viene usata</summary>
          <ul className="cn-elenco">
            <li>
              <strong>Anonimizzazione:</strong> nomi, aziende, indirizzi e dati identificativi sostituiti da segnaposto generici (evidenziati nell&apos;anteprima) prima dell&apos;indicizzazione.
            </li>
            <li>
              <strong>Cosa si impara:</strong> testo, indice e struttura, impaginazione e stile (titoli, tabelle, tono). L&apos;AI usa tutti i documenti come riferimento di qualità, nessuno vale più degli altri, mai per copiare dati specifici nell&apos;offerta di un altro cliente.
            </li>
            <li>
              <strong>Documenti scansionati:</strong> senza testo selezionabile non producono nulla di indicizzabile e finiscono in «errore».
            </li>
          </ul>
        </details>
      </div>
    </>
  );
}
