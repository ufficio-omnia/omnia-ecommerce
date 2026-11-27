import type { Metadata } from "next";
import Link from "next/link";
import { richiediAdminPagina } from "@/lib/console/accesso";
import { archivioNewsletter } from "@/lib/newsletter/archivio";
import { statistiche } from "@/lib/newsletter/invio";
import { formattaRoma, prossimaScadenza } from "@/lib/newsletter/pianificazione";
import { invioRealeConsentito } from "@/lib/newsletter/posta";
import { numeroEdizione } from "@/lib/newsletter/template";
import { ETICHETTA_STATO, GIORNI_SETTIMANA, type Edizione, type Impostazioni, type Invio, type Iscritto } from "@/lib/newsletter/tipi";
import { Badge, Pannello, Tessera } from "../../_componenti/elementi";
import ModuloAzione from "../../_componenti/modulo-azione";
import { TONO_STATO } from "../../_componenti/newsletter-comuni";
import { creaEdizioneVuota, generaEdizioneSettimanale, salvaImpostazioniNewsletter } from "../../azioni/newsletter";

export const metadata: Metadata = { title: "Newsletter & Comunicazioni" };
export const maxDuration = 800;

type Dati = { stato: "ok"; edizioni: Edizione[]; iscritti: Iscritto[]; invii: Invio[]; imp: Impostazioni } | { stato: "errore"; messaggio: string };

export default async function PaginaNewsletter() {
  await richiediAdminPagina();
  const d = await leggi();
  if (d.stato === "errore") {
    return (
      <>
        <div className="cn-testata">
          <div>
            <h1>Newsletter & Comunicazioni</h1>
            <p>OMNIA AI | Tender Weekly</p>
          </div>
        </div>
        <p className="cn-nl-banner errore">{d.messaggio}</p>
      </>
    );
  }
  const { edizioni, iscritti, invii, imp } = d;
  const attivi = iscritti.filter((i) => i.stato === "iscritto").length;
  const usciti = iscritti.filter((i) => i.stato !== "iscritto").length;
  const ultimaInviata = edizioni.find((e) => e.stato === "inviata" || e.stato === "invio_parziale");
  const programmata = edizioni.filter((e) => e.stato === "programmata").sort((a, b) => (a.programmata_per ?? "").localeCompare(b.programmata_per ?? ""))[0];
  const perEdizione = new Map<string, Invio[]>();
  for (const r of invii) perEdizione.set(r.edizione_id, [...(perEdizione.get(r.edizione_id) ?? []), r]);
  const stUltima = ultimaInviata ? statistiche(perEdizione.get(ultimaInviata.id) ?? []) : null;
  const adesso = new Date();
  const cronAttivo = process.env.NEWSLETTER_CRON === "attivo";

  return (
    <>
      <div className="cn-testata">
        <div>
          <h1>Newsletter & Comunicazioni</h1>
          <p>OMNIA AI | Tender Weekly — il mondo degli appalti pubblici, ogni settimana. Comunicazioni informative, separate dalle email di servizio.</p>
        </div>
        <div className="cn-azioni-testata">
          <Link className="cn-btn" href="/newsletter/iscritti">
            Iscritti ({attivi})
          </Link>
        </div>
      </div>

      {!invioRealeConsentito() && (
        <p className="cn-nl-banner">
          Ambiente di sviluppo: prove e invii sono <strong>simulati</strong>, nessuna email parte.
        </p>
      )}

      <div className="cn-tessere">
        <Tessera etichetta="Edizioni" valore={edizioni.length} dettaglio={`${edizioni.filter((e) => e.stato === "inviata").length} inviate`} />
        <Tessera etichetta="Iscritti attivi" valore={attivi} dettaglio={`${usciti} disiscritti, rimbalzati o spam`} tono="accento" />
        <Tessera etichetta="Prossimo invio" valore={programmata ? `n. ${numeroEdizione(programmata.numero)}` : "—"} dettaglio={programmata ? formattaRoma(programmata.programmata_per) : "nessuna edizione programmata"} />
        <Tessera
          etichetta="Ultima inviata"
          valore={ultimaInviata ? `n. ${numeroEdizione(ultimaInviata.numero)}` : "—"}
          dettaglio={stUltima ? `${stUltima.inviati} inviate · ${stUltima.consegnati} consegnate · ${stUltima.cliccati} clic · ${stUltima.rimbalzati} rimbalzi` : "nessun invio reale finora"}
        />
      </div>

      <div className="cn-nl-flusso">
        <Pannello titolo="Genera edizione settimanale">
          <p className="cn-nota">
            Il modello cerca sul web le notizie degli ultimi 7 giorni su fonti ufficiali e autorevoli (ANAC, MIT, Gazzetta Ufficiale, Normattiva, Giustizia amministrativa…) e propone oggetto, preheader e sezioni. I link che non risultano dalla
            ricerca vengono tolti in automatico. La bozza va sempre riletta e approvata: niente parte da solo. Durata: fino a 5–8 minuti.
          </p>
          <ModuloAzione azione={generaEdizioneSettimanale} etichetta="Genera edizione settimanale" etichettaInCorso="Ricerca e scrittura in corso…" variante="primario" classe="cn-modulo">
            <label className="cn-etichetta" htmlFor="nl-fonti">
              Fonti da considerare (facoltative, un indirizzo per riga)
            </label>
            <textarea id="nl-fonti" name="fonti" className="cn-input cn-nl-area" rows={3} placeholder="https://www.anticorruzione.it/-/…" />
            <label className="cn-etichetta" htmlFor="nl-ind">
              Indicazioni editoriali (facoltative)
            </label>
            <textarea id="nl-ind" name="indicazioni" className="cn-input cn-nl-area" rows={2} placeholder="Es. dare spazio al correttivo, approfondimento sulle offerte tecniche…" />
          </ModuloAzione>
          <ModuloAzione azione={creaEdizioneVuota} etichetta="Nuova edizione vuota" etichettaInCorso="…">
            <span className="cn-nota">Oppure scrivila a mano, sezione per sezione.</span>
          </ModuloAzione>
        </Pannello>

        <Pannello titolo="Programmazione settimanale">
          <p className="cn-nota">
            Fuso Europe/Rome, ora legale compresa. La bozza automatica NON parte mai da sola: si invia solo un&apos;edizione approvata e programmata. Processo pianificato:{" "}
            <strong>{cronAttivo ? "ATTIVO" : "SPENTO"}</strong>
            {cronAttivo ? "" : " (si accende con la variabile NEWSLETTER_CRON=attivo e la voce in vercel.json, solo con autorizzazione)"}.
          </p>
          <ModuloAzione azione={salvaImpostazioniNewsletter} etichetta="Salva" etichettaInCorso="…" classe="cn-modulo">
            <div className="cn-nl-griglia">
              <label className="cn-etichetta">
                Generazione bozza
                <span className="cn-nl-riga">
                  <select name="giorno_generazione" className="cn-input" defaultValue={imp.giorno_generazione}>
                    {GIORNI_SETTIMANA.slice(1).map((g, i) => (
                      <option key={g} value={i + 1}>
                        {g}
                      </option>
                    ))}
                  </select>
                  <input name="ora_generazione" type="time" className="cn-input" defaultValue={imp.ora_generazione} />
                </span>
              </label>
              <label className="cn-etichetta">
                Invio predefinito
                <span className="cn-nl-riga">
                  <select name="giorno_invio" className="cn-input" defaultValue={imp.giorno_invio}>
                    {GIORNI_SETTIMANA.slice(1).map((g, i) => (
                      <option key={g} value={i + 1}>
                        {g}
                      </option>
                    ))}
                  </select>
                  <input name="ora_invio" type="time" className="cn-input" defaultValue={imp.ora_invio} />
                </span>
              </label>
              <label className="cn-etichetta">
                Nome mittente
                <input name="mittente_nome" className="cn-input" defaultValue={imp.mittente_nome} />
              </label>
              <label className="cn-etichetta">
                Indirizzo mittente
                <input name="mittente_email" className="cn-input" defaultValue={imp.mittente_email} />
              </label>
              <label className="cn-etichetta">
                Rispondi a
                <input name="rispondi_a" className="cn-input" defaultValue={imp.rispondi_a ?? ""} placeholder="info@omniaitalia.com" />
              </label>
              <label className="cn-etichetta">
                Notifica bozza pronta a
                <input name="email_notifica_admin" className="cn-input" defaultValue={imp.email_notifica_admin} />
              </label>
            </div>
            <label className="cn-nl-spunta">
              <input type="checkbox" name="generazione_automatica" value="1" defaultChecked={imp.generazione_automatica} /> Genera la bozza in automatico (con il processo pianificato attivo)
            </label>
          </ModuloAzione>
          <p className="cn-nota">
            Prossima generazione: {formattaRoma(prossimaScadenza(imp.giorno_generazione, imp.ora_generazione, adesso))} · prossimo invio predefinito: {formattaRoma(prossimaScadenza(imp.giorno_invio, imp.ora_invio, adesso))}
          </p>
        </Pannello>
      </div>

      <div className="cn-sezione">
        <Pannello titolo={`Archivio delle edizioni (${edizioni.length})`}>
          {edizioni.length === 0 ? (
            <p className="cn-nota">Nessuna edizione: generane una o creala a mano.</p>
          ) : (
            <div className="cn-scorri">
              <table className="cn-tab">
                <thead>
                  <tr>
                    <th>N.</th>
                    <th>Data</th>
                    <th>Oggetto</th>
                    <th>Stato</th>
                    <th>Origine</th>
                    <th className="num">Inviate</th>
                    <th className="num">Consegnate</th>
                    <th className="num">Clic</th>
                    <th className="num">Rimbalzi / spam</th>
                  </tr>
                </thead>
                <tbody>
                  {edizioni.map((e) => {
                    const s = statistiche(perEdizione.get(e.id) ?? []);
                    return (
                      <tr key={e.id}>
                        <td className="mono">
                          <Link href={`/newsletter/${e.id}`}>{numeroEdizione(e.numero)}</Link>
                        </td>
                        <td className="nowrap">{e.data_edizione.split("-").reverse().join("/")}</td>
                        <td>
                          <Link href={`/newsletter/${e.id}`}>{e.oggetto || <em>senza oggetto</em>}</Link>
                          {e.stato === "programmata" && <span className="cn-nota"> · {formattaRoma(e.programmata_per)}</span>}
                        </td>
                        <td>
                          <Badge tono={TONO_STATO[e.stato]}>{ETICHETTA_STATO[e.stato]}</Badge>
                        </td>
                        <td>{e.origine === "manuale" ? "a mano" : e.origine === "ai" ? "AI" : "AI automatica"}</td>
                        <td className="num">{s.inviati}</td>
                        <td className="num">{s.consegnati}</td>
                        <td className="num">{s.cliccati}</td>
                        <td className="num">
                          {s.rimbalzati} / {s.spam}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="cn-nota">Aperture e clic arrivano dal webhook di Resend e solo se il tracciamento è acceso sul dominio (oggi spento: si contano consegne, rimbalzi e segnalazioni spam).</p>
        </Pannello>
      </div>
    </>
  );
}

async function leggi(): Promise<Dati> {
  try {
    const a = archivioNewsletter();
    const [edizioni, iscritti, invii, imp] = await Promise.all([a.elencoEdizioni(), a.elencoIscritti(), a.tuttiGliInvii(5000), a.leggiImpostazioni()]);
    return { stato: "ok", edizioni, iscritti, invii, imp };
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    return { stato: "errore", messaggio: /newsletter_/.test(m) ? "Le tabelle della newsletter non esistono ancora: va eseguita la migrazione 0141." : m };
  }
}
