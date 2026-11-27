import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { richiediAdminPagina } from "@/lib/console/accesso";
import { archivioNewsletter, generazioneInCorso } from "@/lib/newsletter/archivio";
import { costoEdizione } from "@/lib/console/newsletter-costi-calcoli";
import { leggiParametriCalcolo } from "@/lib/console/costi";
import { controllaEdizione } from "@/lib/newsletter/contenuto";
import { anteprimaDestinatari, statistiche } from "@/lib/newsletter/invio";
import { formattaRoma, perInputLocale, prossimaScadenza } from "@/lib/newsletter/pianificazione";
import { invioRealeConsentito } from "@/lib/newsletter/posta";
import { numeroEdizione } from "@/lib/newsletter/template";
import { ETICHETTA_STATO, GIORNI_SETTIMANA, STATI_MODIFICABILI } from "@/lib/newsletter/tipi";
import { Badge, Pannello, Tessera } from "../../../_componenti/elementi";
import ModuloAzione from "../../../_componenti/modulo-azione";
import EditorNewsletter from "../../../_componenti/newsletter-editor";
import { TONO_STATO } from "../../../_componenti/newsletter-comuni";
import { cambiaStatoEdizione, inviaAdesso, inviaEmailDiProva, programmaInvio, riprendiInvioEdizione } from "../../../azioni/newsletter";

export const metadata: Metadata = { title: "Edizione · Newsletter" };
export const maxDuration = 800;

export default async function PaginaEdizione({ params }: { params: Promise<{ id: string }> }) {
  const sessione = await richiediAdminPagina();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const a = archivioNewsletter();
  const e = await a.leggiEdizione(id);
  if (!e) notFound();
  const [invii, imp, registro, destinatari, versioni, operazioni, parametri] = await Promise.all([
    a.inviiDellEdizione(id),
    a.leggiImpostazioni(),
    a.registro(id, 30),
    anteprimaDestinatari(e, a),
    a.elencoVersioni(id),
    a.operazioniCosto().catch(() => []),
    leggiParametriCalcolo(),
  ]);
  const costo = costoEdizione(operazioni, id);
  const cambio = parametri.cambioUsdEur;
  const inCorso = generazioneInCorso(e.generazione_in_corso_da);
  const st = statistiche(invii);
  const controllo = controllaEdizione(e);
  const modificabile = STATI_MODIFICABILI.includes(e.stato);
  const prossimo = prossimaScadenza(imp.giorno_invio, imp.ora_invio, new Date());
  const abbonati = destinatari.inclusi.filter((d) => d.gruppo === "abbonato").length;
  const reale = invioRealeConsentito();
  const prove = invii.filter((r) => r.tipo === "prova").slice(-8).reverse();

  return (
    <>
      <div className="cn-testata">
        <div>
          <p className="cn-indietro">
            <Link href="/newsletter">← Newsletter & Comunicazioni</Link>
          </p>
          <h1>
            Edizione n. {numeroEdizione(e.numero)} <Badge tono={TONO_STATO[e.stato]}>{ETICHETTA_STATO[e.stato]}</Badge>
          </h1>
          <p>
            {e.oggetto || "Senza oggetto"} · versione {e.versione} · {e.origine === "manuale" ? "scritta a mano" : "bozza generata con AI"} · aggiornata {formattaRoma(e.aggiornata_il)}
          </p>
        </div>
      </div>

      {!reale && (
        <p className="cn-nl-banner">
          Ambiente di sviluppo: prove e invii sono <strong>simulati</strong> (nessuna email parte). L&apos;invio reale esiste solo sul deploy di produzione.
        </p>
      )}

      <div className="cn-tessere">
        <Tessera etichetta="Destinatari autorizzati" valore={destinatari.inclusi.length} dettaglio={`${abbonati} abbonati · ${destinatari.inclusi.length - abbonati} altri`} tono="accento" />
        <Tessera etichetta="Esclusi" valore={destinatari.esclusi.length} dettaglio="disiscritti, rimbalzi, gruppi non scelti" />
        <Tessera etichetta="Inviate" valore={st.inviati} dettaglio={st.totale ? `su ${st.totale} in elenco` : "nessun invio reale"} tono={st.errori ? "avviso" : "neutro"} />
        <Tessera etichetta="Consegnate / aperte / clic" valore={`${st.consegnati} / ${st.aperti} / ${st.cliccati}`} dettaglio="dal webhook di Resend" />
        <Tessera
          etichetta="Costo dell'edizione"
          valore={cambio ? `${(costo.produzioneUsd * cambio).toFixed(2)} €` : `${costo.produzioneUsd.toFixed(3)} $`}
          dettaglio={`tutte le versioni, anche scartate o fallite · ${costo.chiamate} chiamate${costo.sviluppoUsd > 0 ? ` · sviluppo ${costo.sviluppoUsd.toFixed(3)} $` : ""}`}
        />
        <Tessera etichetta="Rimbalzi · spam · errori" valore={`${st.rimbalzati} · ${st.spam} · ${st.errori}`} tono={st.rimbalzati + st.spam + st.errori ? "avviso" : "neutro"} />
      </div>

      <div className="cn-nl-flusso">
        <Pannello titolo="Approvazione e invio">
          {e.note_generazione && (
            <details className="cn-nl-note">
              <summary>Note della generazione (da verificare)</summary>
              <pre>{e.note_generazione}</pre>
            </details>
          )}
          {controllo.bloccanti.length > 0 && (
            <ul className="cn-nl-problemi errore">
              {controllo.bloccanti.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          )}
          {controllo.avvisi.length > 0 && (
            <ul className="cn-nl-problemi">
              {controllo.avvisi.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          )}

          {e.stato === "bozza" && (
            <ModuloAzione azione={cambiaStatoEdizione} campi={{ id, azione: "revisione" }} etichetta="Metti in revisione" etichettaInCorso="…" messaggioOk="In revisione.">
              <span className="cn-nota">Quando i testi sono pronti, passa l&apos;edizione in revisione.</span>
            </ModuloAzione>
          )}

          {(e.stato === "bozza" || e.stato === "in_revisione") && (
            <ModuloAzione azione={cambiaStatoEdizione} campi={{ id, azione: "approva" }} etichetta="Approva l'edizione" etichettaInCorso="Approvazione…" variante="primario" messaggioOk="Approvata.">
              <label className="cn-nl-spunta">
                <input type="checkbox" name="conferma" value="1" /> Ho riletto l&apos;anteprima, verificato fonti e date e ricevuto l&apos;email di prova.
              </label>
            </ModuloAzione>
          )}

          {e.stato === "approvata" && (
            <>
              <p className="cn-nota">
                Approvata il {formattaRoma(e.approvata_il)}. Qualunque modifica toglie l&apos;approvazione. Programmazione predefinita: {GIORNI_SETTIMANA[imp.giorno_invio]} alle {imp.ora_invio} (Roma).
              </p>
              <ModuloAzione azione={programmaInvio} campi={{ id }} etichetta="Programma l'invio" etichettaInCorso="…" messaggioOk="Programmata.">
                <input type="datetime-local" name="quando" className="cn-input cn-nl-corto" defaultValue={perInputLocale(prossimo)} aria-label="Data e ora dell'invio (ora di Roma)" />
              </ModuloAzione>
              <ModuloAzione azione={inviaAdesso} campi={{ id, destinatari_attesi: String(destinatari.inclusi.length) }} etichetta={`Invia adesso a ${destinatari.inclusi.length} destinatari`} etichettaInCorso="Invio in corso…" variante="primario">
                <input name="conferma" className="cn-input cn-nl-corto" placeholder="Scrivi INVIA" autoComplete="off" aria-label="Conferma: scrivi INVIA" />
              </ModuloAzione>
            </>
          )}

          {e.stato === "programmata" && (
            <>
              <p className="cn-nota">
                Partirà <strong>{formattaRoma(e.programmata_per)}</strong> con il processo pianificato (se attivo), a {destinatari.inclusi.length} destinatari autorizzati in quel momento. Si può anche inviare subito.
              </p>
              <ModuloAzione azione={cambiaStatoEdizione} campi={{ id, azione: "deprogramma" }} etichetta="Togli la programmazione" etichettaInCorso="…">
                <span />
              </ModuloAzione>
              <ModuloAzione azione={inviaAdesso} campi={{ id, destinatari_attesi: String(destinatari.inclusi.length) }} etichetta={`Invia adesso a ${destinatari.inclusi.length} destinatari`} etichettaInCorso="Invio in corso…" variante="primario">
                <input name="conferma" className="cn-input cn-nl-corto" placeholder="Scrivi INVIA" autoComplete="off" aria-label="Conferma: scrivi INVIA" />
              </ModuloAzione>
            </>
          )}

          {(e.stato === "invio_parziale" || e.stato === "in_invio") && (
            <ModuloAzione azione={riprendiInvioEdizione} campi={{ id }} etichetta="Riprendi invio" etichettaInCorso="Ripresa…">
              <span className="cn-nota">Rimanda SOLO le email non partite (in coda o in errore). Chi le ha già ricevute non le riceve di nuovo.</span>
            </ModuloAzione>
          )}

          {(e.stato === "in_revisione" || e.stato === "approvata" || e.stato === "programmata") && (
            <ModuloAzione azione={cambiaStatoEdizione} campi={{ id, azione: "bozza" }} etichetta="Riporta in bozza" etichettaInCorso="…">
              <span />
            </ModuloAzione>
          )}
          {STATI_MODIFICABILI.includes(e.stato) && (
            <ModuloAzione azione={cambiaStatoEdizione} campi={{ id, azione: "annulla" }} etichetta="Annulla l'edizione" etichettaInCorso="…">
              <span />
            </ModuloAzione>
          )}
          {e.stato === "annullata" && (
            <ModuloAzione azione={cambiaStatoEdizione} campi={{ id, azione: "ripristina" }} etichetta="Ripristina come bozza" etichettaInCorso="…">
              <span />
            </ModuloAzione>
          )}
        </Pannello>

        <Pannello titolo="Email di prova">
          <p className="cn-nota">Arriva con l&apos;oggetto «[PROVA] …» e una fascia in cima. Non cambia lo stato dell&apos;edizione e non conta nelle statistiche.</p>
          <ModuloAzione azione={inviaEmailDiProva} campi={{ id }} etichetta="Invia la prova" etichettaInCorso="Invio…">
            <input name="indirizzi" className="cn-input" defaultValue={sessione.email} placeholder="indirizzi separati da virgola (max 5)" aria-label="Indirizzi per la prova" />
          </ModuloAzione>
          {prove.length > 0 && (
            <table className="cn-tab">
              <tbody>
                {prove.map((p) => (
                  <tr key={p.id}>
                    <td className="mono">{formattaRoma(p.creato_il)}</td>
                    <td>{p.email}</td>
                    <td>v{p.versione}</td>
                    <td>
                      <Badge tono={p.stato === "errore" ? "errore" : "ok"}>{p.resend_id?.startsWith("simulato-") ? "simulata" : p.stato}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Pannello>
      </div>

      <div className="cn-sezione">
        <EditorNewsletter
          id={e.id}
          numero={e.numero}
          modificabile={modificabile}
          revisione={e.versione}
          versioneAttiva={e.versione_attiva}
          generazioneInCorso={inCorso}
          versioni={versioni.map((v) => ({ numero: v.numero_versione, origine: v.origine, esito: v.esito, creata_il: v.creata_il, costo_usd: v.costo_usd === null ? null : Number(v.costo_usd), indicazioni: v.indicazioni, errore: v.errore, ambito: v.ambito ?? {} }))}
          iniziale={{ oggetto: e.oggetto, preheader: e.preheader, data_edizione: e.data_edizione, contenuto: e.contenuto, destinatari: e.destinatari }}
        />
      </div>

      <div className="cn-nl-flusso">
        <Pannello titolo={`Destinatari autorizzati (${destinatari.inclusi.length})`}>
          <p className="cn-nota">
            Solo indirizzi iscritti con base giuridica documentata. Gli indirizzi non sono mai visibili agli altri destinatari: ogni email parte da sola. <Link href="/newsletter/iscritti">Gestisci gli iscritti →</Link>
          </p>
          <div className="cn-scorri cn-nl-elenco-breve">
            <table className="cn-tab">
              <tbody>
                {destinatari.inclusi.map((d) => (
                  <tr key={d.id}>
                    <td>{d.email}</td>
                    <td>{d.gruppo === "abbonato" ? <Badge tono="ok">abbonato</Badge> : <Badge>altro</Badge>}</td>
                  </tr>
                ))}
                {destinatari.esclusi.map((d) => (
                  <tr key={d.email} className="cn-nl-escluso">
                    <td>{d.email}</td>
                    <td>escluso: {d.motivo}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Pannello>
        <Pannello titolo="Registro">
          {registro.length === 0 ? (
            <p className="cn-nota">Nessuna azione registrata.</p>
          ) : (
            <table className="cn-tab">
              <tbody>
                {registro.map((r, i) => (
                  <tr key={i}>
                    <td className="mono">{formattaRoma(r.creato_il)}</td>
                    <td>{r.azione}</td>
                    <td className="tronca" title={JSON.stringify(r.dettaglio)}>
                      {JSON.stringify(r.dettaglio)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Pannello>
      </div>
    </>
  );
}
