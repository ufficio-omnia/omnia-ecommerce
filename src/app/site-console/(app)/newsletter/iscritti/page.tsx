import type { Metadata } from "next";
import Link from "next/link";
import { richiediAdminPagina } from "@/lib/console/accesso";
import { archivioNewsletter } from "@/lib/newsletter/archivio";
import { abbonatiAttivi, candidatiDaAbbonati, type Abbonato } from "@/lib/newsletter/destinatari";
import { formattaRoma } from "@/lib/newsletter/pianificazione";
import { ETICHETTA_BASE, type Iscritto } from "@/lib/newsletter/tipi";
import { Badge, Pannello, Tessera } from "../../../_componenti/elementi";
import ModuloAzione from "../../../_componenti/modulo-azione";
import PulsanteAzione from "../../../_componenti/pulsante-azione";
import { aggiungiIscritto, cambiaStatoIscritto } from "../../../azioni/newsletter";

export const metadata: Metadata = { title: "Iscritti · Newsletter" };

const STATO: Record<Iscritto["stato"], { etichetta: string; tono: "ok" | "neutro" | "avviso" | "errore" }> = {
  iscritto: { etichetta: "iscritto", tono: "ok" },
  disiscritto: { etichetta: "disiscritto", tono: "neutro" },
  rimbalzato: { etichetta: "rimbalzo", tono: "avviso" },
  segnalato_spam: { etichetta: "spam", tono: "errore" },
};

function ModuloIscritto({ email = "", userId = "", categoria = "altro" }: { email?: string; userId?: string; categoria?: string }) {
  return (
    <ModuloAzione azione={aggiungiIscritto} campi={userId ? { user_id: userId } : {}} etichetta="Aggiungi" etichettaInCorso="…" svuota messaggioOk="Aggiunto." classe="cn-modulo">
      <div className="cn-nl-griglia">
        <label className="cn-etichetta">
          Email
          <input name="email" type="email" className="cn-input" defaultValue={email} readOnly={Boolean(email)} required />
        </label>
        <label className="cn-etichetta">
          Nome / azienda (facoltativo)
          <input name="nome" className="cn-input" />
        </label>
        <label className="cn-etichetta">
          Categoria
          <select name="categoria" className="cn-input" defaultValue={categoria}>
            <option value="cliente">Cliente</option>
            <option value="prospect">Prospect</option>
            <option value="interno">Interno</option>
            <option value="altro">Altro</option>
          </select>
        </label>
        <label className="cn-etichetta">
          Base giuridica
          <select name="base_giuridica" className="cn-input" defaultValue="consenso">
            <option value="consenso">Consenso espresso</option>
            <option value="soft_spam_art130">Cliente – art. 130 c. 4 (solo con informativa che lo prevede)</option>
            <option value="altro_documentato">Altra base documentata</option>
          </select>
        </label>
        <label className="cn-etichetta">
          Dal
          <input name="base_dal" type="date" className="cn-input" />
        </label>
        <label className="cn-etichetta cn-nl-largo">
          Prova (come, quando e dove è documentata)
          <input name="prova_base" className="cn-input" placeholder="Es. consenso via email del 27/11/2026, conservata nella casella ufficio@" required minLength={10} />
        </label>
      </div>
      <label className="cn-nl-spunta">
        <input type="checkbox" name="dichiarazione" value="1" /> La base giuridica è documentata e la prova è conservata.
      </label>
    </ModuloAzione>
  );
}

export default async function PaginaIscritti() {
  await richiediAdminPagina();
  let iscritti: Iscritto[] = [];
  let abbonati: Abbonato[] = [];
  let errore: string | null = null;
  try {
    [iscritti, abbonati] = await Promise.all([archivioNewsletter().elencoIscritti(), abbonatiAttivi()]);
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    errore = /newsletter_/.test(m) ? "Le tabelle della newsletter non esistono ancora: va eseguita la migrazione 0141." : m;
  }
  const candidati = candidatiDaAbbonati(iscritti, abbonati);
  const attivi = iscritti.filter((i) => i.stato === "iscritto");

  return (
    <>
      <div className="cn-testata">
        <div>
          <p className="cn-indietro">
            <Link href="/newsletter">← Newsletter & Comunicazioni</Link>
          </p>
          <h1>Iscritti a Tender Weekly</h1>
          <p>Ricevono la newsletter solo gli indirizzi iscritti con una base giuridica documentata. Un account o un abbonamento non sono un consenso.</p>
        </div>
      </div>
      {errore && <p className="cn-nl-banner errore">{errore}</p>}

      <div className="cn-tessere">
        <Tessera etichetta="Iscritti attivi" valore={attivi.length} tono="accento" />
        <Tessera etichetta="Disiscritti" valore={iscritti.filter((i) => i.stato === "disiscritto").length} />
        <Tessera etichetta="Rimbalzi / spam" valore={iscritti.filter((i) => i.stato === "rimbalzato" || i.stato === "segnalato_spam").length} />
        <Tessera etichetta="Abbonati non iscritti" valore={candidati.length} dettaglio="non ricevono nulla finché manca una base" />
      </div>

      <p className="cn-nl-banner">
        Base giuridica: la privacy policy attuale di omnia-ai.it cita solo le «comunicazioni di servizio». Per usare l&apos;art. 130 c. 4 (newsletter ai clienti su servizi analoghi, con diritto di opposizione) l&apos;informativa
        deve prevederlo: da verificare con l&apos;avvocato. Nel dubbio: consenso espresso e documentato.
      </p>

      <div className="cn-nl-flusso">
        <Pannello titolo="Aggiungi un iscritto">
          <ModuloIscritto />
        </Pannello>
        <Pannello titolo={`Clienti con abbonamento attivo non iscritti (${candidati.length})`}>
          <p className="cn-nota">Si aggiungono uno per uno, solo indicando la base giuridica e la sua prova.</p>
          {candidati.length === 0 ? (
            <p className="cn-nota">Nessuno.</p>
          ) : (
            candidati.map((c) => (
              <details key={c.userId} className="cn-nl-sezione">
                <summary>{c.email}</summary>
                <ModuloIscritto email={c.email} userId={c.userId} categoria="cliente" />
              </details>
            ))
          )}
        </Pannello>
      </div>

      <div className="cn-sezione">
        <Pannello titolo={`Elenco (${iscritti.length})`}>
          <div className="cn-scorri">
            <table className="cn-tab">
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Categoria</th>
                  <th>Stato</th>
                  <th>Base giuridica</th>
                  <th>Prova</th>
                  <th>Dal</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {iscritti.map((i) => (
                  <tr key={i.id}>
                    <td>
                      {i.email}
                      {i.nome ? <span className="cn-nota"> · {i.nome}</span> : null}
                    </td>
                    <td>{i.categoria}</td>
                    <td>
                      <Badge tono={STATO[i.stato].tono}>{STATO[i.stato].etichetta}</Badge>
                      {i.disiscritto_il && <span className="cn-nota"> {formattaRoma(i.disiscritto_il)}</span>}
                    </td>
                    <td>{ETICHETTA_BASE[i.base_giuridica]}</td>
                    <td className="tronca" title={i.prova_base}>
                      {i.prova_base}
                    </td>
                    <td className="nowrap">{i.base_dal}</td>
                    <td>
                      {i.stato === "iscritto" && (
                        <PulsanteAzione azione={cambiaStatoIscritto} campi={{ id: i.id, azione: "disiscrivi" }} etichetta="Disiscrivi" etichettaInCorso="…" conferma={`Disiscrivere ${i.email}?`} />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Pannello>
      </div>
    </>
  );
}
