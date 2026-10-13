import type { ProdottiLetti, ProdottoLetto } from "@/lib/console/prodotti";
import { PESO_MASSIMO_ANTEPRIMA, PESO_MASSIMO_FILE_PRODOTTO, riepilogoProdotti } from "@/lib/console/prodotti-calcoli";
import {
  aggiornaProdotto,
  aggiungiAnteprime,
  aggiungiFile,
  attivaSconto,
  creaProdotto,
  disattivaSconto,
  eliminaProdotto,
  impostaAttivo,
  ottieniLinkFileProdotto,
  rimuoviAnteprima,
  rimuoviFile,
  spostaAnteprima,
} from "../azioni/prodotti";
import { Badge, Pannello, Tessera } from "./elementi";
import { formattaData, formattaEuro, formattaIntero } from "./formati";
import ModuloAzione from "./modulo-azione";
import PulsanteApriLink from "./pulsante-apri-link";
import PulsanteAzione from "./pulsante-azione";

// Vista della pagina Prodotti e sconti: il catalogo dell'e-commerce, con prezzo,
// sconto, file da scaricare e galleria di anteprime di ciascun file. Riceve dati
// già letti; le modifiche passano dalle azioni di site-console/azioni/prodotti.ts.

function Prezzo({ p }: { p: ProdottoLetto }) {
  if (p.scontoAttivo && p.prezzoScontato !== null) {
    return (
      <span className="cn-prodotto-prezzo">
        <strong>{formattaEuro(p.prezzoScontato)}</strong>
        <s>{formattaEuro(p.prezzo)}</s>
      </span>
    );
  }
  return (
    <span className="cn-prodotto-prezzo">
      <strong>{formattaEuro(p.prezzo)}</strong>
    </span>
  );
}

function PannelloFile({ p }: { p: ProdottoLetto }) {
  return (
    <div className="cn-prodotto-blocco">
      <h3>File inclusi ({p.file.length})</h3>
      {p.file.length === 0 ? (
        <p className={p.attivo ? "cn-nota-inline errore" : "cn-nota-inline"}>
          {p.attivo ? "Nessun file: chi acquista questo prodotto non avrebbe nulla da scaricare. Aggiungine uno o disattiva il prodotto." : "Nessun file."}
        </p>
      ) : (
        <ul className="cn-file-elenco">
          {p.file.map((f) => (
            <li key={f.id}>
              <div className="cn-file-testa">
                <span>
                  <span className="cn-file-ordine">[{f.ordine}]</span> {f.etichetta}
                  <small className="mono"> {f.nome}</small>
                </span>
                <span className="cn-azione">
                  <PulsanteApriLink azione={ottieniLinkFileProdotto} campi={{ fileId: f.id }} />
                  <PulsanteAzione
                    azione={rimuoviFile}
                    campi={{ fileId: f.id }}
                    conferma={`Rimuovere «${f.etichetta}» dal prodotto? Anche chi ha già acquistato non potrà più scaricarlo, e le sue anteprime vengono cancellate.`}
                    etichetta="Rimuovi"
                    etichettaInCorso="Rimuovo…"
                    variante="pericolo"
                  />
                </span>
              </div>

              <div className="cn-anteprime-blocco">
                <span className="cn-etichetta-inline">Anteprime ({f.anteprime.length})</span>
                {f.anteprime.length > 0 && (
                  <ul className="cn-anteprime">
                    {f.anteprime.map((a, i) => (
                      <li key={a.id}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={a.url} alt={`Anteprima ${i + 1} di ${f.etichetta}`} loading="lazy" />
                        <span className="cn-anteprima-azioni">
                          <PulsanteAzione azione={spostaAnteprima} campi={{ previewId: a.id, productFileId: f.id, direction: "up" }} etichetta="↑" etichettaInCorso="…" disabilitato={i === 0} titolo="Sposta prima" />
                          <PulsanteAzione azione={spostaAnteprima} campi={{ previewId: a.id, productFileId: f.id, direction: "down" }} etichetta="↓" etichettaInCorso="…" disabilitato={i === f.anteprime.length - 1} titolo="Sposta dopo" />
                          <PulsanteAzione azione={rimuoviAnteprima} campi={{ previewId: a.id }} conferma="Eliminare questa anteprima?" etichetta="✕" etichettaInCorso="…" variante="pericolo" titolo="Elimina anteprima" />
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                <ModuloAzione azione={aggiungiAnteprime} campi={{ productFileId: f.id }} etichetta="Carica anteprime" etichettaInCorso="Carico…" svuota messaggioOk="Anteprime caricate.">
                  <input type="file" name="images" multiple accept="image/jpeg,image/png,image/webp" className="cn-file" aria-label={`Immagini di anteprima per ${f.etichetta}`} />
                  <span className="cn-nota-inline">JPG, PNG o WebP, fino a {PESO_MASSIMO_ANTEPRIMA / 1024 / 1024} MB ciascuna.</span>
                </ModuloAzione>
              </div>
            </li>
          ))}
        </ul>
      )}

      <ModuloAzione azione={aggiungiFile} campi={{ productId: p.id }} etichetta="Aggiungi file" etichettaInCorso="Carico…" svuota messaggioOk="File aggiunto." classe="cn-modulo-linea cn-modulo-bordo">
        <label className="cn-campo largo">
          <span className="cn-etichetta">Etichetta del file</span>
          <input className="cn-input" name="label" required maxLength={120} placeholder="es. Piano di lavoro (Excel)" />
        </label>
        <label className="cn-campo stretto">
          <span className="cn-etichetta">Ordine</span>
          <input className="cn-input" name="sortOrder" type="number" min={0} max={999} defaultValue={p.file.length} />
        </label>
        <label className="cn-campo">
          <span className="cn-etichetta">File (fino a {PESO_MASSIMO_FILE_PRODOTTO / 1024 / 1024} MB)</span>
          <input type="file" name="file" required className="cn-file" />
        </label>
      </ModuloAzione>
    </div>
  );
}

function SchedaProdotto({ p }: { p: ProdottoLetto }) {
  const anteprime = p.file.reduce((somma, f) => somma + f.anteprime.length, 0);

  return (
    <section className={`cn-pannello cn-prodotto${p.attivo ? "" : " spento"}`}>
      <div className="cn-prodotto-testa">
        <div className="cn-prodotto-titolo">
          <h2>{p.titolo}</h2>
          <p>
            {p.categoria ?? "senza categoria"} · {p.file.length} file · {anteprime} {anteprime === 1 ? "anteprima" : "anteprime"} · creato il {formattaData(p.creatoIl)}
          </p>
        </div>
        <div className="cn-prodotto-stato">
          {!p.attivo && <Badge tono="avviso">disattivato</Badge>}
          {p.scontoAttivo && <Badge tono="ok">in sconto</Badge>}
          {p.attivo && p.file.length === 0 && <Badge tono="errore">senza file</Badge>}
          <span className="cn-prodotto-ordini" title="Ordini che includono questo prodotto">
            {p.ordini.totali === 0 ? "nessun ordine" : `${p.ordini.pagati}/${p.ordini.totali} ordini pagati`}
          </span>
        </div>
        <Prezzo p={p} />
        <div className="cn-azione">
          <PulsanteAzione
            azione={impostaAttivo}
            campi={{ productId: p.id, attivo: String(!p.attivo) }}
            etichetta={p.attivo ? "Disattiva" : "Riattiva"}
            etichettaInCorso="…"
            titolo={p.attivo ? "Toglie il prodotto dal catalogo; gli ordini già fatti restano" : "Rimette il prodotto nel catalogo"}
          />
          <PulsanteAzione
            azione={eliminaProdotto}
            campi={{ productId: p.id }}
            conferma={`Eliminare definitivamente «${p.titolo}»? Si cancellano anche i suoi file e le anteprime. L'operazione non è reversibile.`}
            etichetta="Elimina"
            etichettaInCorso="Elimino…"
            variante="pericolo"
            disabilitato={p.ordini.totali > 0}
            titolo={p.ordini.totali > 0 ? "Ha ordini associati: non si elimina, si disattiva" : "Elimina il prodotto, i suoi file e le anteprime"}
          />
        </div>
      </div>

      <details className="cn-prodotto-gestione">
        <summary>Gestisci prezzo, sconto e file</summary>
        <div className="cn-prodotto-corpo">
          <div className="cn-prodotto-blocco">
            <h3>Prezzo e descrizione</h3>
            <ModuloAzione azione={aggiornaProdotto} campi={{ productId: p.id }} etichetta="Salva" etichettaInCorso="Salvo…" messaggioOk="Salvato.">
              <label className="cn-campo stretto">
                <span className="cn-etichetta">Prezzo (€, IVA inclusa)</span>
                <input className="cn-input" name="price" inputMode="decimal" required defaultValue={String(p.prezzo).replace(".", ",")} />
              </label>
              <label className="cn-campo largo">
                <span className="cn-etichetta">Descrizione</span>
                <input className="cn-input" name="description" maxLength={2000} defaultValue={p.descrizione ?? ""} />
              </label>
            </ModuloAzione>
          </div>

          <div className="cn-prodotto-blocco">
            <h3>Sconto</h3>
            {p.scontoAttivo && p.prezzoScontato !== null ? (
              <div className="cn-azione">
                <span>
                  Sconto attivo: <strong>{formattaEuro(p.prezzoScontato)}</strong> invece di <s>{formattaEuro(p.prezzo)}</s> (−{formattaIntero(Math.round((1 - p.prezzoScontato / p.prezzo) * 100))} %)
                </span>
                <PulsanteAzione azione={disattivaSconto} campi={{ productId: p.id }} etichetta="Disattiva sconto" etichettaInCorso="…" />
              </div>
            ) : (
              <ModuloAzione azione={attivaSconto} campi={{ productId: p.id }} etichetta="Attiva sconto" etichettaInCorso="…" messaggioOk="Sconto attivato.">
                <label className="cn-campo stretto">
                  <span className="cn-etichetta">Prezzo scontato (€, IVA inclusa)</span>
                  <input className="cn-input" name="discountPrice" inputMode="decimal" required placeholder={`meno di ${String(p.prezzo).replace(".", ",")}`} />
                </label>
              </ModuloAzione>
            )}
          </div>

          <PannelloFile p={p} />
        </div>
      </details>
    </section>
  );
}

export default function ProdottiVista({ letti }: { letti: ProdottiLetti }) {
  const testata = (
    <div className="cn-testata">
      <div>
        <h1>Prodotti e sconti</h1>
        <p>Il catalogo dell&apos;e-commerce: prezzi, sconti, file da scaricare e anteprime</p>
      </div>
    </div>
  );

  if (letti.stato === "errore") {
    return (
      <>
        {testata}
        <p className="cn-esito errore" role="alert">
          {letti.messaggio}
        </p>
      </>
    );
  }

  const prodotti = letti.prodotti;
  const r = riepilogoProdotti(prodotti.map((p) => ({ attivo: p.attivo, prezzo: p.prezzo, scontoAttivo: p.scontoAttivo, file: p.file.length, ordini: p.ordini.totali })));

  return (
    <>
      {testata}

      <div className="cn-tessere">
        <Tessera etichetta="Prodotti" valore={formattaIntero(r.totale)} dettaglio={`${r.attivi} in catalogo`} />
        <Tessera etichetta="In sconto" valore={formattaIntero(r.inSconto)} tono={r.inSconto > 0 ? "ok" : "neutro"} dettaglio="Con prezzo scontato attivo" />
        <Tessera etichetta="Disattivati" valore={formattaIntero(r.disattivati)} tono={r.disattivati > 0 ? "avviso" : "neutro"} dettaglio="Non visibili ai clienti" />
        <Tessera etichetta="Senza file" valore={formattaIntero(r.attiviSenzaFile)} tono={r.attiviSenzaFile > 0 ? "errore" : "neutro"} dettaglio="In catalogo ma senza nulla da scaricare" />
      </div>

      <div className="cn-sezione">
        <details className="cn-dettagli cn-nuovo">
          <summary>+ Nuovo prodotto</summary>
          <div className="cn-pannello-corpo">
            <ModuloAzione azione={creaProdotto} etichetta="Aggiungi prodotto" etichettaInCorso="Aggiungo…" svuota messaggioOk="Prodotto aggiunto: compare qui sotto. Aggiungi i file da scaricare." variante="primario" classe="cn-modulo-linea">
              <label className="cn-campo largo">
                <span className="cn-etichetta">Titolo</span>
                <input className="cn-input" name="title" required maxLength={200} />
              </label>
              <label className="cn-campo">
                <span className="cn-etichetta">Categoria</span>
                <input className="cn-input" name="category" maxLength={100} />
              </label>
              <label className="cn-campo stretto">
                <span className="cn-etichetta">Prezzo (€, IVA inclusa)</span>
                <input className="cn-input" name="price" inputMode="decimal" required placeholder="es. 399" />
              </label>
              <label className="cn-campo pieno">
                <span className="cn-etichetta">Descrizione</span>
                <textarea className="cn-input cn-testo" name="description" rows={2} maxLength={2000} />
              </label>
            </ModuloAzione>
            <p className="cn-nota-inline" style={{ marginTop: 8 }}>
              Il prodotto nasce senza file e subito in catalogo: aggiungi i file da scaricare, altrimenti chi lo acquista non riceve nulla.
            </p>
          </div>
        </details>
      </div>

      <div className="cn-sezione cn-prodotti">
        {prodotti.length === 0 ? (
          <Pannello titolo="Prodotti">
            <p className="cn-vuoto">Nessun prodotto.</p>
          </Pannello>
        ) : (
          prodotti.map((p) => <SchedaProdotto key={p.id} p={p} />)
        )}
      </div>

      <div className="cn-sezione">
        <details className="cn-dettagli">
          <summary>Come funziona</summary>
          <ul className="cn-elenco">
            <li>
              <strong>Prezzi:</strong> sono IVA inclusa, come li vede il cliente. Lo sconto è un prezzo minore del listino; il prezzo non può scendere sotto uno sconto attivo.
            </li>
            <li>
              <strong>Disattivare o eliminare:</strong> un prodotto già acquistato non si elimina (resterebbe lo storico degli ordini): lo si disattiva e sparisce dal catalogo. Chi l&apos;ha già pagato continua a scaricarlo.
            </li>
            <li>
              <strong>File:</strong> sono ciò che il cliente scarica dopo il pagamento. Rimuovere un file lo toglie anche a chi ha già acquistato.
            </li>
            <li>
              <strong>Anteprime:</strong> le immagini di un file si vedono nella pagina pubblica del prodotto, prima dell&apos;acquisto. Si riordinano con le frecce.
            </li>
          </ul>
        </details>
      </div>
    </>
  );
}
