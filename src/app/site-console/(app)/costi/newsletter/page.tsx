import type { Metadata } from "next";
import Link from "next/link";
import { richiediAdminPagina } from "@/lib/console/accesso";
import { leggiParametriCalcolo } from "@/lib/console/costi";
import { riepilogaCostiNewsletter, type RiepilogoCostiNewsletter } from "@/lib/console/newsletter-costi-calcoli";
import { calcolaPeriodo } from "@/lib/console/periodo";
import { archivioNewsletter } from "@/lib/newsletter/archivio";
import { numeroEdizione } from "@/lib/newsletter/template";
import { ETICHETTA_STATO } from "@/lib/newsletter/tipi";
import { Badge, Pannello, Tessera } from "../../../_componenti/elementi";
import { formattaDataOra, formattaEuro, formattaIntero, formattaUsd } from "../../../_componenti/formati";
import { TONO_STATO } from "../../../_componenti/newsletter-comuni";
import SelettorePeriodo from "../../../_componenti/selettore-periodo";

export const metadata: Metadata = { title: "Costi · Newsletter | Tender Weekly" };

const TIPO: Record<string, string> = {
  generazione: "Generazione",
  rigenerazione: "Rigenerazione intera",
  rigenerazione_sezione: "Rigenerazione sezione",
  rigenerazione_notizia: "Rigenerazione notizia",
};

export default async function PaginaCostiNewsletter({ searchParams }: { searchParams: Promise<{ p?: string; dal?: string; al?: string }> }) {
  await richiediAdminPagina();
  const parametri = await searchParams;
  const periodo = calcolaPeriodo(parametri, new Date());
  let r: RiepilogoCostiNewsletter | null = null;
  let errore: string | null = null;
  let cambio: number | null = null;
  try {
    const a = archivioNewsletter();
    const [operazioni, versioni, edizioni, invii, impostazioni, par] = await Promise.all([a.operazioniCosto(), a.versioniSenzaContenuto(), a.elencoEdizioni(), a.tuttiGliInviiConProve(20000), a.leggiImpostazioni(), leggiParametriCalcolo()]);
    cambio = par.cambioUsdEur;
    r = riepilogaCostiNewsletter({ operazioni, versioni, edizioni, invii, impostazioni, cambioUsdEur: cambio, adesso: new Date(), da: periodo.da, a: periodo.a });
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    errore = /newsletter_|dettaglio/.test(m) ? "Le tabelle della newsletter non esistono ancora: va eseguita la migrazione 0141." : m;
  }
  const importo = (usd: number, eur: number | null) => (eur === null ? `${formattaUsd(usd, 3)}` : `${formattaEuro(eur)} (${formattaUsd(usd, 3)})`);

  return (
    <>
      <div className="cn-testata">
        <div>
          <p className="cn-indietro">
            <Link href="/costi">← Costi e margini</Link>
          </p>
          <h1>Newsletter | Tender Weekly</h1>
          <p>Costo operativo interno di OMNIA AI: entra nel margine complessivo, non nel costo per gara né in quello dei clienti.</p>
        </div>
      </div>
      <SelettorePeriodo percorso="/costi/newsletter" periodo={periodo} />
      {errore && <p className="cn-nl-banner errore">{errore}</p>}
      {cambio === null && !errore && <p className="cn-nl-banner">Cambio USD→EUR non impostato (Costi e margini → Parametri): gli importi sono in dollari.</p>}
      {r && (
        <>
          <div className="cn-tessere">
            <Tessera etichetta="Oggi" valore={importo(r.tessere.oggi.costoUsd, r.tessere.oggi.costoEur)} />
            <Tessera etichetta="Mese corrente" valore={importo(r.tessere.mese.costoUsd, r.tessere.mese.costoEur)} />
            <Tessera etichetta="Anno corrente" valore={importo(r.tessere.anno.costoUsd, r.tessere.anno.costoEur)} />
            <Tessera etichetta="Storico complessivo" valore={importo(r.tessere.storico.costoUsd, r.tessere.storico.costoEur)} tono="accento" />
          </div>
          <div className="cn-tessere" style={{ marginTop: 12 }}>
            <Tessera etichetta={`Periodo: ${periodo.etichetta}`} valore={importo(r.tessere.periodo.costoUsd, r.tessere.periodo.costoEur)} dettaglio={`${formattaIntero(r.tessere.periodo.chiamate)} chiamate · ${formattaIntero(r.tessere.periodo.ricerche)} ricerche web`} />
            <Tessera
              etichetta="Generazioni nel periodo"
              valore={r.conteggi.totaleGenerazioni}
              dettaglio={`${r.conteggi.generazioni} generazioni · ${r.conteggi.rigenerazioniIntere} rigen. intere · ${r.conteggi.rigenerazioniSezione} sezioni · ${r.conteggi.rigenerazioniNotizia} notizie · ${r.conteggi.fallite} fallite`}
            />
            <Tessera etichetta="Costo medio per generazione" valore={r.medie.perGenerazioneUsd === null ? "—" : importo(r.medie.perGenerazioneUsd, cambio ? r.medie.perGenerazioneUsd * cambio : null)} />
            <Tessera
              etichetta="Costo medio per edizione inviata"
              valore={r.medie.perEdizioneInviataUsd === null ? "—" : importo(r.medie.perEdizioneInviataUsd, cambio ? r.medie.perEdizioneInviataUsd * cambio : null)}
              dettaglio={`${r.conteggi.edizioniInviate} edizioni inviate nel periodo`}
            />
            <Tessera
              etichetta="Sviluppo e collaudo"
              valore={importo(r.tessere.sviluppoPeriodo.costoUsd, r.tessere.sviluppoPeriodo.costoEur)}
              dettaglio={`fuori dai totali · storico ${formattaUsd(r.tessere.sviluppoStorico.costoUsd, 3)}`}
            />
          </div>

          <p className="cn-nota" style={{ marginTop: 10 }}>
            Natura dei costi: <strong>stimati</strong> = consumi reali (token e ricerche web) × tariffe di listino del progetto; <strong>non disponibili</strong> = chiamate senza tariffa ({r.tessere.periodo.senzaCosto} nel periodo). Anthropic fattura in aggregato: un costo
            «effettivo» per singola chiamata non esiste. Immagini generate: nessuna (la newsletter non ne genera).
          </p>

          <div className="cn-nl-flusso">
            <Pannello titolo="Ripartizione per provider e voce">
              <table className="cn-tab">
                <thead>
                  <tr>
                    <th>Voce</th>
                    <th className="num">Chiamate</th>
                    <th className="num">Token in / out</th>
                    <th className="num">Ricerche</th>
                    <th className="num">Costo</th>
                  </tr>
                </thead>
                <tbody>
                  {r.perVoce.map((v) => (
                    <tr key={v.voce}>
                      <td>{v.voce}</td>
                      <td className="num">{v.chiamate}</td>
                      <td className="num">
                        {formattaIntero(v.inputTokens)} / {formattaIntero(v.outputTokens)}
                      </td>
                      <td className="num">{v.ricerche}</td>
                      <td className="num">{importo(v.costoUsd, v.costoEur)}</td>
                    </tr>
                  ))}
                  {r.perVoce.length === 0 && (
                    <tr>
                      <td colSpan={5}>Nessun costo nel periodo.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </Pannello>
            <Pannello titolo="Ripartizione per tipologia">
              <table className="cn-tab">
                <thead>
                  <tr>
                    <th>Tipologia</th>
                    <th className="num">Chiamate</th>
                    <th className="num">Costo</th>
                  </tr>
                </thead>
                <tbody>
                  {r.perTipo.map((v) => (
                    <tr key={v.tipo}>
                      <td>{TIPO[v.tipo] ?? v.tipo}</td>
                      <td className="num">{v.chiamate}</td>
                      <td className="num">{importo(v.costoUsd, v.costoEur)}</td>
                    </tr>
                  ))}
                  {r.perTipo.length === 0 && (
                    <tr>
                      <td colSpan={3}>Nessun costo nel periodo.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </Pannello>
          </div>

          <div className="cn-sezione">
            <Pannello titolo="Per edizione (storico completo)">
              <div className="cn-scorri">
                <table className="cn-tab">
                  <thead>
                    <tr>
                      <th>N.</th>
                      <th>Oggetto</th>
                      <th>Stato</th>
                      <th className="num">Versioni</th>
                      <th className="num">Fallite</th>
                      <th className="num">Costo totale</th>
                      <th className="num">Versione in uso</th>
                      <th className="num">Versioni scartate / fallite</th>
                      <th className="num">Sviluppo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.edizioni.map((e) => (
                      <tr key={e.id}>
                        <td className="mono">
                          <Link href={`/newsletter/${e.id}`}>{numeroEdizione(e.numero)}</Link>
                        </td>
                        <td className="tronca" title={e.oggetto}>
                          {e.oggetto || "—"}
                        </td>
                        <td>
                          <Badge tono={TONO_STATO[e.stato]}>{ETICHETTA_STATO[e.stato]}</Badge>
                        </td>
                        <td className="num">{e.versioni}</td>
                        <td className="num">{e.fallite}</td>
                        <td className="num">{importo(e.costoUsd, e.costoEur)}</td>
                        <td className="num">
                          {e.versioneAttiva ? `v${e.versioneAttiva} · ` : ""}
                          {formattaUsd(e.costoAttivaUsd, 3)}
                        </td>
                        <td className="num">{formattaUsd(e.costoScartateUsd, 3)}</td>
                        <td className="num">{formattaUsd(e.costoSviluppoUsd, 3)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Pannello>
          </div>

          <div className="cn-nl-flusso">
            <Pannello titolo="Invii (Resend)">
              <p className="cn-nota">
                Nessun costo per singola email: sono comprese nel piano. Piano dichiarato: <strong>{r.resend.piano ?? "non indicato"}</strong>. Quota fissa mensile attribuita alla newsletter:{" "}
                <strong>{r.resend.quotaMensileEur === null ? "non disponibile" : formattaEuro(r.resend.quotaMensileEur)}</strong> (si imposta in Newsletter → Programmazione; è condivisa con le email transazionali e non entra nel margine dei
                modelli). Costi incrementali oltre il piano: non disponibili dall&apos;API di Resend.
              </p>
              <p className="cn-nota">
                Nel periodo: {r.resend.periodo.reali} email della newsletter, {r.resend.periodo.prove} email di prova. Invii simulati (sviluppo, mai spediti): {r.resend.periodo.simulate}.
              </p>
              <table className="cn-tab">
                <thead>
                  <tr>
                    <th>Mese</th>
                    <th className="num">Newsletter</th>
                    <th className="num">Prove</th>
                  </tr>
                </thead>
                <tbody>
                  {r.resend.mesi.map((m) => (
                    <tr key={m.mese}>
                      <td className="mono">{m.mese}</td>
                      <td className="num">{m.reali}</td>
                      <td className="num">{m.prove}</td>
                    </tr>
                  ))}
                  {r.resend.mesi.length === 0 && (
                    <tr>
                      <td colSpan={3}>Nessun invio reale finora.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </Pannello>
            <Pannello titolo={`Operazioni nel periodo (${r.storico.length})`}>
              <div className="cn-scorri cn-nl-elenco-breve">
                <table className="cn-tab">
                  <thead>
                    <tr>
                      <th>Quando</th>
                      <th>Edizione</th>
                      <th>Tipologia</th>
                      <th>Voce</th>
                      <th className="num">Token in/out</th>
                      <th className="num">Costo</th>
                      <th>Natura</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.storico.map((o) => (
                      <tr key={o.id} className={o.ambito === "sviluppo" ? "cn-nl-escluso" : undefined}>
                        <td className="mono">{formattaDataOra(o.created_at)}</td>
                        <td className="mono">{o.numeroEdizione ? `${numeroEdizione(o.numeroEdizione)}${o.versione ? ` v${o.versione}` : ""}` : "—"}</td>
                        <td>
                          {TIPO[o.tipo] ?? o.tipo}
                          {o.ambito === "sviluppo" ? " · sviluppo" : ""}
                        </td>
                        <td>{o.voce === "ricerca_web" ? `ricerca web × ${Number((o.dettaglio ?? {}).ricerche_web ?? 0)}` : o.model}</td>
                        <td className="num">{o.voce === "ricerca_web" ? "—" : `${formattaIntero(o.input_tokens ?? 0)} / ${formattaIntero(o.output_tokens ?? 0)}`}</td>
                        <td className="num">{o.costo_stimato === null ? "n.d." : formattaUsd(o.costo_stimato, 4)}</td>
                        <td>{o.costo_stimato === null ? "non disponibile" : "stimato"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Pannello>
          </div>
        </>
      )}
    </>
  );
}
