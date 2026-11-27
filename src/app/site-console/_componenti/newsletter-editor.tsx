"use client";

import { useActionState, useDeferredValue, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { normalizzaContenuto } from "@/lib/newsletter/contenuto";
import { renderNewsletterHtml } from "@/lib/newsletter/template";
import { ETICHETTA_ORIGINE, SEZIONI_PREDEFINITE, type ChiaveSezione, type ContenutoEdizione, type DestinatariScelti, type Fonte, type Notizia, type OrigineVersione, type Sezione } from "@/lib/newsletter/tipi";
import { rigeneraNewsletter, ripristinaVersioneNewsletter, salvaEdizione, type EsitoNewsletter } from "../azioni/newsletter";

// Editor di un'edizione: campi per ogni sezione (attiva/spenta, ordine, testi, notizie, fonti) e anteprima dal vivo
// dello stesso template che parte per email (desktop 640 px e smartphone 390 px). Il salvataggio passa dal server,
// che rinormalizza tutto: qui non si decide niente di definitivo.

export type VersioneBreve = {
  numero: number;
  origine: OrigineVersione;
  esito: "ok" | "fallita";
  creata_il: string;
  costo_usd: number | null;
  indicazioni: string | null;
  errore: string | null;
  ambito: { chiave?: string; indice?: number; titolo?: string };
};

type Props = {
  id: string;
  numero: number;
  modificabile: boolean;
  // revisione del contenuto salvato (cresce a ogni modifica): quando cambia, l'editor ricarica il testo dal server
  revisione: number;
  versioneAttiva: number | null;
  versioni: VersioneBreve[];
  generazioneInCorso: boolean;
  iniziale: { oggetto: string; preheader: string; data_edizione: string; contenuto: ContenutoEdizione; destinatari: DestinatariScelti };
};

// Le sezioni E (OMNIA AI News) e F (chiusura) le scrive la redazione: niente rigenerazione (stessa regola del server).
const RIGENERABILI: ChiaveSezione[] = ["notizia", "normativa", "tender", "esperto"];

function quando(iso: string): string {
  return new Date(iso).toLocaleString("it-IT", { timeZone: "Europe/Rome", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function fontiIniziali(c: ContenutoEdizione): Record<string, string> {
  const m: Record<string, string> = {};
  c.sezioni.forEach((s) => s.notizie.forEach((n, i) => (m[`${s.chiave}:${i}`] = fontiInTesto(n.fonti))));
  return m;
}

function fontiInTesto(f: Fonte[]): string {
  return f.map((x) => [x.titolo, x.url, x.data ?? "", x.ente ?? ""].join(" | ").replace(/( \| )+$/, "")).join("\n");
}

function testoInFonti(t: string): Fonte[] {
  return t
    .split("\n")
    .map((riga) => riga.split("|").map((x) => x.trim()))
    .filter((p) => p.some(Boolean))
    .map((p) => {
      const url = p.find((x) => /^https?:\/\//.test(x)) ?? "";
      const altri = p.filter((x) => x !== url);
      const data = altri.find((x) => /^\d{4}-\d{2}-\d{2}$/.test(x));
      const resto = altri.filter((x) => x !== data);
      return { titolo: resto[0] ?? "", url, ...(data ? { data } : {}), ...(resto[1] ? { ente: resto[1] } : {}) };
    });
}

function notiziaVuota(): Notizia {
  return { titolo: "", sintesi: "", implicazioni: "", evidenza: "", fonti: [] };
}

export default function EditorNewsletter({ id, numero, modificabile, revisione, versioneAttiva, versioni, generazioneInCorso, iniziale }: Props) {
  const [oggetto, setOggetto] = useState(iniziale.oggetto);
  const [preheader, setPreheader] = useState(iniziale.preheader);
  const [dataEdizione, setData] = useState(iniziale.data_edizione);
  const [destinatari, setDestinatari] = useState(iniziale.destinatari);
  const [c, setC] = useState<ContenutoEdizione>(iniziale.contenuto);
  // testo delle fonti così come lo scrive l'utente (si interpreta al salvataggio e nell'anteprima)
  const [fontiGrezze, setFontiGrezze] = useState<Record<string, string>>(() => fontiIniziali(iniziale.contenuto));
  const [vista, setVista] = useState<"desktop" | "mobile">("desktop");
  const [sporco, setSporco] = useState(false);
  // il testo sul server è cambiato (rigenerazione, ripristino, salvataggio): l'editor riparte da quello
  const [revisioneVista, setRevisioneVista] = useState(revisione);
  if (revisione !== revisioneVista) {
    setRevisioneVista(revisione);
    setOggetto(iniziale.oggetto);
    setPreheader(iniziale.preheader);
    setData(iniziale.data_edizione);
    setDestinatari(iniziale.destinatari);
    setC(iniziale.contenuto);
    setFontiGrezze(fontiIniziali(iniziale.contenuto));
    setSporco(false);
  }
  const router = useRouter();
  const [indicazioni, setIndicazioni] = useState("");
  const [generando, avviaTransizione] = useTransition();
  const [inLavorazione, setInLavorazione] = useState<string | null>(null);
  const [esitoGen, setEsitoGen] = useState<EsitoNewsletter>({});
  const bloccato = generando || generazioneInCorso;
  const [stato, esegui, inCorso] = useActionState(async (p: EsitoNewsletter, f: FormData) => {
    const r = await salvaEdizione(p, f);
    if (r.ok) setSporco(false);
    return r;
  }, {});

  const contenutoCompleto = useMemo<ContenutoEdizione>(
    () => ({
      ...c,
      sezioni: c.sezioni.map((s) => ({ ...s, notizie: s.notizie.map((n, i) => ({ ...n, fonti: testoInFonti(fontiGrezze[`${s.chiave}:${i}`] ?? "") })) })),
    }),
    [c, fontiGrezze],
  );
  const differito = useDeferredValue({ contenutoCompleto, oggetto, preheader, dataEdizione });

  // Il testo dell'editor (anche non salvato) parte con la richiesta: il server lo salva e lo conserva prima di generare.
  function datiConTesto(): FormData {
    const fd = new FormData();
    fd.set("id", id);
    fd.set("testo", JSON.stringify({ oggetto, preheader, data_edizione: dataEdizione, contenuto: contenutoCompleto, destinatari }));
    return fd;
  }

  function rigeneraParte(tipo: "rigenerazione" | "rigenerazione_sezione" | "rigenerazione_notizia", etichetta: string, chiave?: ChiaveSezione, indice?: number) {
    if (bloccato) return;
    const avviso =
      tipo === "rigenerazione"
        ? "Rigenerare l'intera newsletter? Si fa una nuova ricerca; editoriale, OMNIA AI News e chiusura restano come sono. Il testo attuale resta nello storico."
        : `Rigenerare ${etichetta}? Il resto dell'edizione non cambia; il testo attuale resta nello storico.`;
    if (!window.confirm(avviso)) return;
    const fd = datiConTesto();
    fd.set("tipo", tipo);
    fd.set("indicazioni", indicazioni);
    if (chiave) fd.set("chiave", chiave);
    if (indice !== undefined) fd.set("indice", String(indice));
    setInLavorazione(etichetta);
    setEsitoGen({});
    avviaTransizione(async () => {
      const r = await rigeneraNewsletter({}, fd);
      setEsitoGen(r);
      setInLavorazione(null);
      router.refresh();
    });
  }

  function ripristina(n: number) {
    if (bloccato) return;
    if (!window.confirm(`Ripristinare la versione ${n}? Il testo attuale (anche non salvato) resta nello storico.`)) return;
    const fd = datiConTesto();
    fd.set("numero", String(n));
    setInLavorazione(`ripristino della versione ${n}`);
    setEsitoGen({});
    avviaTransizione(async () => {
      const r = await ripristinaVersioneNewsletter({}, fd);
      setEsitoGen(r);
      setInLavorazione(null);
      router.refresh();
    });
  }
  const html = useMemo(
    () =>
      renderNewsletterHtml(
        { numero, data_edizione: differito.dataEdizione, oggetto: differito.oggetto, preheader: differito.preheader, contenuto: normalizzaContenuto(differito.contenutoCompleto) },
        { urlDisiscrizione: "https://omnia-ai.it/newsletter/disiscrizione" },
      ),
    [differito, numero],
  );

  const tocca = () => setSporco(true);
  const aggiornaSezione = (k: number, patch: Partial<Sezione>) => {
    tocca();
    setC((x) => ({ ...x, sezioni: x.sezioni.map((s, i) => (i === k ? { ...s, ...patch } : s)) }));
  };
  const sposta = (k: number, verso: -1 | 1) => {
    tocca();
    setC((x) => {
      const s = [...x.sezioni];
      const j = k + verso;
      if (j < 0 || j >= s.length) return x;
      [s[k], s[j]] = [s[j], s[k]];
      return { ...x, sezioni: s };
    });
  };
  // le chiavi delle fonti grezze sono «sezione:indice»: spostando o togliendo una notizia si rinumerano
  const riallineaFonti = (chiave: string, nuovoOrdine: number[]) => {
    setFontiGrezze((m) => {
      const n = { ...m };
      Object.keys(n).filter((k) => k.startsWith(`${chiave}:`)).forEach((k) => delete n[k]);
      nuovoOrdine.forEach((vecchio, nuovo) => (n[`${chiave}:${nuovo}`] = m[`${chiave}:${vecchio}`] ?? ""));
      return n;
    });
  };
  const aggiornaNotizia = (k: number, i: number, patch: Partial<Notizia>) => {
    tocca();
    setC((x) => ({ ...x, sezioni: x.sezioni.map((s, a) => (a === k ? { ...s, notizie: s.notizie.map((n, b) => (b === i ? { ...n, ...patch } : n)) } : s)) }));
  };
  const aggiungiNotizia = (k: number) => {
    aggiornaSezione(k, { notizie: [...c.sezioni[k].notizie, notiziaVuota()], attiva: true });
  };
  const togliNotizia = (k: number, i: number) => {
    if (!window.confirm("Togliere questa notizia?")) return;
    const s = c.sezioni[k];
    riallineaFonti(s.chiave, s.notizie.map((_, j) => j).filter((j) => j !== i));
    aggiornaSezione(k, { notizie: s.notizie.filter((_, j) => j !== i) });
  };
  const spostaNotizia = (k: number, i: number, verso: -1 | 1) => {
    const s = c.sezioni[k];
    const j = i + verso;
    if (j < 0 || j >= s.notizie.length) return;
    const ordine = s.notizie.map((_, x) => x);
    [ordine[i], ordine[j]] = [ordine[j], ordine[i]];
    riallineaFonti(s.chiave, ordine);
    aggiornaSezione(k, { notizie: ordine.map((x) => s.notizie[x]) });
  };

  const disabilitato = !modificabile;

  return (
    <div className="cn-nl-editor">
      <form action={esegui} className="cn-nl-colonna-campi">
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="contenuto" value={JSON.stringify(contenutoCompleto)} />
        <fieldset disabled={disabilitato} className="cn-nl-fieldset">
          <div className="cn-nl-blocco cn-nl-rigenera">
            <label className="cn-etichetta" htmlFor="nl-indicazioni">
              Indicazioni per l&apos;AI (facoltative, valgono per la prossima rigenerazione)
            </label>
            <textarea
              id="nl-indicazioni"
              className="cn-input cn-nl-area"
              rows={2}
              value={indicazioni}
              onChange={(e) => setIndicazioni(e.target.value)}
              maxLength={1500}
              placeholder="Es. più spazio alla giurisprudenza, evitare un tema già trattato, tono più operativo…"
            />
            <div className="cn-nl-riga cn-nl-comandi">
              <button type="button" className="cn-btn primario" disabled={bloccato} onClick={() => rigeneraParte("rigenerazione", "l'intera newsletter")}>
                {generando && inLavorazione === "l'intera newsletter" ? "Rigenerazione in corso…" : "Rigenera intera newsletter"}
              </button>
              <span className="cn-nota">
                Versione in uso: {versioneAttiva ? `v${versioneAttiva}` : "scritta a mano"}
                {sporco ? " (modificata, non salvata)" : ""}
              </span>
            </div>
            {bloccato && (
              <p className="cn-azione-avviso">
                {generando ? `In corso: ${inLavorazione ?? "generazione"}. Può richiedere alcuni minuti: non chiudere la pagina.` : "C'è una generazione in corso per questa edizione: i pulsanti tornano attivi quando finisce (ricarica la pagina)."}
              </p>
            )}
            {esitoGen.errore && (
              <p className="cn-azione-errore" role="alert">
                {esitoGen.errore}
              </p>
            )}
            {esitoGen.ok && (
              <p className="cn-azione-ok" role="status">
                {esitoGen.avviso ?? "Fatto."}
              </p>
            )}
          </div>
          <div className="cn-nl-blocco">
            <label className="cn-etichetta" htmlFor="nl-oggetto">
              Oggetto ({oggetto.length}/70 consigliati)
            </label>
            <input id="nl-oggetto" className="cn-input" name="oggetto" value={oggetto} onChange={(e) => (setOggetto(e.target.value), tocca())} maxLength={150} />
            <label className="cn-etichetta" htmlFor="nl-pre">
              Preheader ({preheader.length}/110)
            </label>
            <input id="nl-pre" className="cn-input" name="preheader" value={preheader} onChange={(e) => (setPreheader(e.target.value), tocca())} maxLength={200} />
            <div className="cn-nl-riga">
              <div>
                <label className="cn-etichetta" htmlFor="nl-data">
                  Data dell&apos;edizione
                </label>
                <input id="nl-data" type="date" className="cn-input" name="data_edizione" value={dataEdizione} onChange={(e) => (setData(e.target.value), tocca())} />
              </div>
              <div>
                <span className="cn-etichetta">Destinatari</span>
                <label className="cn-nl-spunta">
                  <input type="checkbox" checked={destinatari.abbonati_attivi} onChange={(e) => (setDestinatari((d) => ({ ...d, abbonati_attivi: e.target.checked })), tocca())} />
                  Clienti con abbonamento attivo
                </label>
                <label className="cn-nl-spunta">
                  <input type="checkbox" checked={destinatari.altri_autorizzati} onChange={(e) => (setDestinatari((d) => ({ ...d, altri_autorizzati: e.target.checked })), tocca())} />
                  Altri destinatari autorizzati
                </label>
                <input type="hidden" name="abbonati_attivi" value={destinatari.abbonati_attivi ? "1" : "0"} />
                <input type="hidden" name="altri_autorizzati" value={destinatari.altri_autorizzati ? "1" : "0"} />
              </div>
            </div>
          </div>

          <details className="cn-nl-sezione" open={c.editoriale.attivo}>
            <summary>
              <span className="cn-nl-lettera">✎</span> Editoriale {c.editoriale.attivo ? "" : <em>(spento)</em>}
            </summary>
            <label className="cn-nl-spunta">
              <input type="checkbox" checked={c.editoriale.attivo} onChange={(e) => (tocca(), setC((x) => ({ ...x, editoriale: { ...x.editoriale, attivo: e.target.checked } })))} />
              Mostra l&apos;editoriale
            </label>
            <label className="cn-etichetta">Titolo</label>
            <input className="cn-input" value={c.editoriale.titolo} onChange={(e) => (tocca(), setC((x) => ({ ...x, editoriale: { ...x.editoriale, titolo: e.target.value } })))} />
            <label className="cn-etichetta">Testo (paragrafi separati da una riga vuota)</label>
            <textarea className="cn-input cn-nl-area" rows={7} value={c.editoriale.testo} onChange={(e) => (tocca(), setC((x) => ({ ...x, editoriale: { ...x.editoriale, testo: e.target.value } })))} />
            <label className="cn-etichetta">Firma</label>
            <input className="cn-input" value={c.editoriale.firma} onChange={(e) => (tocca(), setC((x) => ({ ...x, editoriale: { ...x.editoriale, firma: e.target.value } })))} />
          </details>

          {c.sezioni.map((s, k) => (
            <details key={s.chiave} className={`cn-nl-sezione${s.attiva ? "" : " spenta"}`} open={s.attiva && s.notizie.length > 0}>
              <summary>
                <span className="cn-nl-lettera">{SEZIONI_PREDEFINITE[s.chiave].lettera}</span> {s.titolo} <span className="cn-nl-conta">{s.notizie.length}</span>
                {!s.attiva && <em> (spenta)</em>}
              </summary>
              <div className="cn-nl-riga cn-nl-comandi">
                <label className="cn-nl-spunta">
                  <input type="checkbox" checked={s.attiva} onChange={(e) => aggiornaSezione(k, { attiva: e.target.checked })} />
                  Sezione attiva
                </label>
                <span>
                  {RIGENERABILI.includes(s.chiave) && (
                    <>
                      <button type="button" className="cn-btn piccolo" disabled={bloccato} onClick={() => rigeneraParte("rigenerazione_sezione", `la sezione «${s.titolo}»`, s.chiave)}>
                        Rigenera sezione
                      </button>{" "}
                    </>
                  )}
                  <button type="button" className="cn-btn piccolo" onClick={() => sposta(k, -1)} disabled={k === 0} title="Sposta su">
                    ↑
                  </button>{" "}
                  <button type="button" className="cn-btn piccolo" onClick={() => sposta(k, 1)} disabled={k === c.sezioni.length - 1} title="Sposta giù">
                    ↓
                  </button>
                </span>
              </div>
              <label className="cn-etichetta">Titolo della sezione</label>
              <input className="cn-input" value={s.titolo} onChange={(e) => aggiornaSezione(k, { titolo: e.target.value })} />
              <label className="cn-etichetta">{s.chiave === "chiusura" ? "Testo di chiusura (sopra il pulsante)" : "Introduzione (facoltativa)"}</label>
              <textarea className="cn-input cn-nl-area" rows={s.chiave === "chiusura" ? 4 : 2} value={s.introduzione ?? ""} onChange={(e) => aggiornaSezione(k, { introduzione: e.target.value })} />
              {s.chiave === "chiusura" && (
                <div className="cn-nl-riga">
                  <div>
                    <label className="cn-etichetta">Testo del pulsante</label>
                    <input className="cn-input" value={c.cta.etichetta} onChange={(e) => (tocca(), setC((x) => ({ ...x, cta: { ...x.cta, etichetta: e.target.value } })))} />
                  </div>
                  <div>
                    <label className="cn-etichetta">Indirizzo del pulsante</label>
                    <input className="cn-input" value={c.cta.url} onChange={(e) => (tocca(), setC((x) => ({ ...x, cta: { ...x.cta, url: e.target.value } })))} />
                  </div>
                </div>
              )}
              {s.chiave !== "chiusura" &&
                s.notizie.map((n, i) => (
                  <div key={i} className="cn-nl-notizia">
                    <div className="cn-nl-riga cn-nl-comandi">
                      <strong>Notizia {i + 1}</strong>
                      <span>
                        <button type="button" className="cn-btn piccolo" onClick={() => spostaNotizia(k, i, -1)} disabled={i === 0} title="Sposta su">
                          ↑
                        </button>{" "}
                        <button type="button" className="cn-btn piccolo" onClick={() => spostaNotizia(k, i, 1)} disabled={i === s.notizie.length - 1} title="Sposta giù">
                          ↓
                        </button>{" "}
                        {RIGENERABILI.includes(s.chiave) && (
                          <>
                            <button type="button" className="cn-btn piccolo" disabled={bloccato} onClick={() => rigeneraParte("rigenerazione_notizia", `la notizia «${n.titolo || `n. ${i + 1}`}»`, s.chiave, i)}>
                              Rigenera notizia
                            </button>{" "}
                          </>
                        )}
                        <button type="button" className="cn-btn piccolo pericolo" onClick={() => togliNotizia(k, i)}>
                          Togli
                        </button>
                      </span>
                    </div>
                    <label className="cn-etichetta">Titolo</label>
                    <input className="cn-input" value={n.titolo} onChange={(e) => aggiornaNotizia(k, i, { titolo: e.target.value })} />
                    <label className="cn-etichetta">Testo</label>
                    <textarea className="cn-input cn-nl-area" rows={6} value={n.sintesi} onChange={(e) => aggiornaNotizia(k, i, { sintesi: e.target.value })} />
                    <label className="cn-etichetta">In evidenza (facoltativo)</label>
                    <input className="cn-input" value={n.evidenza ?? ""} onChange={(e) => aggiornaNotizia(k, i, { evidenza: e.target.value })} />
                    <label className="cn-etichetta">Cosa cambia per le imprese (facoltativo)</label>
                    <textarea className="cn-input cn-nl-area" rows={3} value={n.implicazioni ?? ""} onChange={(e) => aggiornaNotizia(k, i, { implicazioni: e.target.value })} />
                    <label className="cn-etichetta">Fonti — una per riga: Titolo | https://… | AAAA-MM-GG | Ente</label>
                    <textarea
                      className="cn-input cn-nl-area cn-nl-mono"
                      rows={3}
                      value={fontiGrezze[`${s.chiave}:${i}`] ?? ""}
                      onChange={(e) => (tocca(), setFontiGrezze((m) => ({ ...m, [`${s.chiave}:${i}`]: e.target.value })))}
                    />
                    <label className="cn-etichetta">Immagine (facoltativa): indirizzo https e testo alternativo</label>
                    <div className="cn-nl-riga">
                      <input className="cn-input" placeholder="https://…" value={n.immagine?.url ?? ""} onChange={(e) => aggiornaNotizia(k, i, { immagine: e.target.value ? { url: e.target.value, alt: n.immagine?.alt ?? "" } : undefined })} />
                      <input className="cn-input" placeholder="Descrizione dell'immagine" value={n.immagine?.alt ?? ""} onChange={(e) => aggiornaNotizia(k, i, { immagine: n.immagine ? { ...n.immagine, alt: e.target.value } : undefined })} />
                    </div>
                  </div>
                ))}
              {s.chiave !== "chiusura" && (
                <button type="button" className="cn-btn piccolo" onClick={() => aggiungiNotizia(k)}>
                  + Aggiungi notizia
                </button>
              )}
            </details>
          ))}
        </fieldset>
        <div className="cn-nl-salva">
          {modificabile ? (
            <>
              <button type="submit" className="cn-btn primario" disabled={inCorso}>
                {inCorso ? "Salvataggio…" : "Salva le modifiche"}
              </button>
              {sporco && !inCorso && <span className="cn-azione-avviso">Modifiche non salvate</span>}
              {stato.errore && <span className="cn-azione-errore" role="alert">{stato.errore}</span>}
              {stato.ok && !sporco && <span className={stato.avviso ? "cn-azione-avviso" : "cn-azione-ok"}>{stato.avviso ?? "Salvato."}</span>}
            </>
          ) : (
            <span className="cn-nota">Edizione in invio, inviata o annullata: il contenuto non si modifica più.</span>
          )}
        </div>
        <div className="cn-nl-blocco cn-nl-versioni">
          <span className="cn-etichetta">Storico delle versioni ({versioni.length})</span>
          {versioni.length === 0 ? (
            <p className="cn-nota">Nessuna versione: nascono con la generazione, con ogni rigenerazione e quando il testo modificato a mano viene conservato prima di rigenerare.</p>
          ) : (
            <table className="cn-tab">
              <tbody>
                {versioni.map((v) => (
                  <tr key={v.numero} className={v.esito === "fallita" ? "cn-nl-escluso" : undefined}>
                    <td className="mono">
                      v{v.numero}
                      {v.numero === versioneAttiva ? " ●" : ""}
                    </td>
                    <td>
                      {ETICHETTA_ORIGINE[v.origine]}
                      {v.ambito.titolo ? ` · «${v.ambito.titolo}»` : v.ambito.chiave ? ` · ${SEZIONI_PREDEFINITE[v.ambito.chiave as ChiaveSezione]?.titolo ?? v.ambito.chiave}` : ""}
                      {v.esito === "fallita" ? <span className="cn-azione-errore"> · fallita: {v.errore}</span> : null}
                      {v.indicazioni ? <span className="cn-nota"> · indicazioni: {v.indicazioni}</span> : null}
                    </td>
                    <td className="mono">{quando(v.creata_il)}</td>
                    <td className="num">{v.costo_usd === null ? "n.d." : `${v.costo_usd.toFixed(3)} $`}</td>
                    <td className="nowrap">
                      {v.esito === "ok" && (
                        <>
                          <a className="cn-btn piccolo" href={`/newsletter/${id}/anteprima?versione=${v.numero}`} target="_blank" rel="noopener noreferrer">
                            Vedi
                          </a>{" "}
                          {modificabile && v.numero !== versioneAttiva && (
                            <button type="button" className="cn-btn piccolo" disabled={bloccato} onClick={() => ripristina(v.numero)}>
                              Ripristina
                            </button>
                          )}
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </form>

      <div className="cn-nl-colonna-anteprima">
        <div className="cn-nl-anteprima-barra">
          <span className="cn-etichetta">Anteprima dal vivo</span>
          <span>
            <button type="button" className={`cn-btn piccolo${vista === "desktop" ? " primario" : ""}`} onClick={() => setVista("desktop")}>
              Desktop
            </button>{" "}
            <button type="button" className={`cn-btn piccolo${vista === "mobile" ? " primario" : ""}`} onClick={() => setVista("mobile")}>
              Smartphone
            </button>{" "}
            <a className="cn-btn piccolo" href={`/newsletter/${id}/anteprima`} target="_blank" rel="noopener noreferrer" title="Versione salvata, a pagina intera">
              Apri ↗
            </a>
          </span>
        </div>
        <div className={`cn-nl-cornice ${vista}`}>
          <iframe title="Anteprima della newsletter" srcDoc={html} sandbox="allow-popups allow-popups-to-escape-sandbox" className="cn-nl-iframe" />
        </div>
      </div>
    </div>
  );
}
