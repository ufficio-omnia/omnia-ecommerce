import type { Metadata } from "next";
import Link from "next/link";
import { richiediAdminPagina } from "@/lib/console/accesso";
import { archivioNewsletter } from "@/lib/newsletter/archivio";
import { abbonatiAttivi, selezionaDestinatari, type Abbonato } from "@/lib/newsletter/destinatari";
import { sincronizzaClienti } from "@/lib/newsletter/gestione-iscritti";
import { pulisciNonConfermati } from "@/lib/newsletter/iscrizioni";
import { formattaRoma } from "@/lib/newsletter/pianificazione";
import { ETICHETTA_BASE, ETICHETTA_PROVENIENZA, type Iscritto, type Provenienza } from "@/lib/newsletter/tipi";
import { Badge, Pannello, Tessera } from "../../../_componenti/elementi";
import ModuloAzione from "../../../_componenti/modulo-azione";
import PulsanteAzione from "../../../_componenti/pulsante-azione";
import { aggiungiDestinatari, cambiaStatoIscritto } from "../../../azioni/newsletter";

export const metadata: Metadata = { title: "Iscritti · Newsletter" };

const STATO: Record<Iscritto["stato"], { etichetta: string; tono: "ok" | "neutro" | "avviso" | "errore" }> = {
  in_attesa: { etichetta: "in attesa di conferma", tono: "avviso" },
  iscritto: { etichetta: "iscritto", tono: "ok" },
  disiscritto: { etichetta: "disiscritto", tono: "neutro" },
  rimbalzato: { etichetta: "non valido (rimbalzo)", tono: "errore" },
  segnalato_spam: { etichetta: "bloccato (spam)", tono: "errore" },
};

const FILTRI = [
  { id: "tutti", etichetta: "Tutti" },
  { id: "autorizzati", etichetta: "Destinatari autorizzati" },
  { id: "clienti", etichetta: "Clienti con abbonamento attivo" },
  { id: "sito", etichetta: "Iscritti dal sito" },
  { id: "manuali", etichetta: "Aggiunti a mano" },
  { id: "in_attesa", etichetta: "In attesa di conferma" },
  { id: "disiscritti", etichetta: "Disiscritti" },
  { id: "bloccati", etichetta: "Non validi o bloccati" },
] as const;
type Filtro = (typeof FILTRI)[number]["id"];

function CampiBase() {
  return (
    <>
      <div className="cn-nl-griglia">
        <label className="cn-etichetta">
          Base giuridica
          <select name="base_giuridica" className="cn-input" defaultValue="consenso">
            <option value="consenso">Consenso espresso</option>
            <option value="soft_spam_art130">Cliente – art. 130 c. 4 (con informativa che lo prevede)</option>
            <option value="altro_documentato">Altra base documentata</option>
          </select>
        </label>
        <label className="cn-etichetta">
          Categoria
          <select name="categoria" className="cn-input" defaultValue="altro">
            <option value="cliente">Cliente</option>
            <option value="prospect">Prospect</option>
            <option value="interno">Interno</option>
            <option value="altro">Altro</option>
          </select>
        </label>
        <label className="cn-etichetta">
          Autorizzazione dal
          <input name="base_dal" type="date" className="cn-input" />
        </label>
        <label className="cn-etichetta cn-nl-largo">
          Prova dell&apos;autorizzazione (come, quando e dove è documentata)
          <input name="prova_base" className="cn-input" placeholder="Es. consenso scritto via email del 27/11/2026, conservato nella casella ufficio@" required minLength={10} />
        </label>
        <label className="cn-etichetta cn-nl-largo">
          Note amministrative (facoltative)
          <input name="note_admin" className="cn-input" maxLength={500} />
        </label>
      </div>
      <label className="cn-nl-spunta">
        <input type="checkbox" name="dichiarazione" value="1" /> L&apos;autorizzazione all&apos;invio è documentata e la prova è conservata.
      </label>
      <label className="cn-nl-spunta">
        <input type="checkbox" name="nuova_autorizzazione" value="1" /> Per eventuali indirizzi già DISISCRITTI ho una NUOVA autorizzazione documentata (senza questa spunta restano disiscritti).
      </label>
    </>
  );
}

export default async function PaginaIscritti({ searchParams }: { searchParams: Promise<{ filtro?: string; q?: string }> }) {
  await richiediAdminPagina();
  const parametri = await searchParams;
  const filtro: Filtro = (FILTRI.find((f) => f.id === parametri.filtro)?.id ?? "tutti") as Filtro;
  const q = (parametri.q ?? "").trim().toLowerCase().slice(0, 100);
  const a = archivioNewsletter();
  let iscritti: Iscritto[] = [];
  let abbonati: Abbonato[] = [];
  let errore: string | null = null;
  let acquisiti = 0;
  try {
    // i clienti che hanno accettato le Condizioni con Tender Weekly entrano da soli (nessun intervento dell'admin)
    acquisiti = (await sincronizzaClienti(a).catch(() => ({ aggiunti: 0 }))).aggiunti;
    // iscrizioni dal sito mai confermate da oltre 30 giorni: come promesso dall'informativa
    await pulisciNonConfermati(a).catch((e) => console.error("Newsletter: pulizia non riuscita", e instanceof Error ? e.message : e));
    [iscritti, abbonati] = await Promise.all([a.elencoIscritti(), abbonatiAttivi()]);
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    errore = /newsletter_|provenienza/.test(m) ? "Le tabelle della newsletter non sono aggiornate: vanno eseguite le migrazioni 0141 e 0142." : m;
  }
  const idAbbonati = new Set(abbonati.map((x) => x.userId));
  const emailAbbonati = new Set(abbonati.map((x) => x.email));
  const eAbbonato = (i: Iscritto) => (i.user_id !== null && idAbbonati.has(i.user_id)) || emailAbbonati.has(i.email);
  const { inclusi } = selezionaDestinatari(iscritti, abbonati, { abbonati_attivi: true, altri_autorizzati: true });
  const idInclusi = new Set(inclusi.map((i) => i.id));
  const prov = (i: Iscritto): Provenienza => i.provenienza ?? "console";
  const conta: Record<Filtro, number> = {
    tutti: iscritti.length,
    autorizzati: inclusi.length,
    clienti: iscritti.filter(eAbbonato).length,
    sito: iscritti.filter((i) => prov(i) === "sito").length,
    manuali: iscritti.filter((i) => prov(i) === "console" || prov(i) === "importazione").length,
    in_attesa: iscritti.filter((i) => i.stato === "in_attesa").length,
    disiscritti: iscritti.filter((i) => i.stato === "disiscritto").length,
    bloccati: iscritti.filter((i) => i.stato === "rimbalzato" || i.stato === "segnalato_spam").length,
  };
  const passa: Record<Filtro, (i: Iscritto) => boolean> = {
    tutti: () => true,
    autorizzati: (i) => idInclusi.has(i.id),
    clienti: eAbbonato,
    sito: (i) => prov(i) === "sito",
    manuali: (i) => prov(i) === "console" || prov(i) === "importazione",
    in_attesa: (i) => i.stato === "in_attesa",
    disiscritti: (i) => i.stato === "disiscritto",
    bloccati: (i) => i.stato === "rimbalzato" || i.stato === "segnalato_spam",
  };
  const visibili = iscritti.filter(passa[filtro]).filter((i) => !q || i.email.includes(q) || (i.nome ?? "").toLowerCase().includes(q) || (i.azienda ?? "").toLowerCase().includes(q));
  const perProvenienza = (["abbonamento", "sito", "console", "importazione"] as Provenienza[]).map((p) => ({ p, n: inclusi.filter((i) => prov(i) === p).length }));

  return (
    <>
      <div className="cn-testata">
        <div>
          <p className="cn-indietro">
            <Link href="/newsletter">← Newsletter & Comunicazioni</Link>
          </p>
          <h1>Iscritti a Tender Weekly</h1>
          <p>Riceve la newsletter solo chi è iscritto con una base giuridica documentata. Un indirizzo è una riga sola: anche se arriva da più fonti riceve una copia.</p>
        </div>
      </div>
      {errore && <p className="cn-nl-banner errore">{errore}</p>}
      {acquisiti > 0 && <p className="cn-nl-banner">Acquisiti ora {acquisiti} clienti che hanno accettato le Condizioni di abbonamento con Tender Weekly incluso.</p>}

      <div className="cn-tessere">
        <Tessera etichetta="Destinatari autorizzati" valore={inclusi.length} tono="accento" dettaglio={perProvenienza.map((x) => `${x.n} ${ETICHETTA_PROVENIENZA[x.p].toLowerCase()}`).join(" · ")} />
        <Tessera etichetta="In attesa di conferma" valore={conta.in_attesa} dettaglio="iscritti dal sito che non hanno ancora confermato: non ricevono nulla" />
        <Tessera etichetta="Disiscritti" valore={conta.disiscritti} />
        <Tessera etichetta="Non validi o bloccati" valore={conta.bloccati} />
      </div>

      <div className="cn-nl-flusso">
        <Pannello titolo="Aggiungi destinatario">
          <details className="cn-nl-sezione" open>
            <summary>Un indirizzo</summary>
            <ModuloAzione azione={aggiungiDestinatari} campi={{ modo: "singolo" }} etichetta="Aggiungi" etichettaInCorso="…" svuota messaggioOk="Fatto." classe="cn-modulo">
              <div className="cn-nl-griglia">
                <label className="cn-etichetta">
                  Email
                  <input name="email" type="email" className="cn-input" required />
                </label>
                <label className="cn-etichetta">
                  Nome e cognome (facoltativo)
                  <input name="nome" className="cn-input" maxLength={120} />
                </label>
                <label className="cn-etichetta">
                  Azienda (facoltativa)
                  <input name="azienda" className="cn-input" maxLength={160} />
                </label>
              </div>
              <CampiBase />
            </ModuloAzione>
          </details>
          <details className="cn-nl-sezione">
            <summary>Più indirizzi (copia e incolla)</summary>
            <ModuloAzione azione={aggiungiDestinatari} campi={{ modo: "elenco" }} etichetta="Aggiungi tutti" etichettaInCorso="…" svuota messaggioOk="Fatto." classe="cn-modulo">
              <label className="cn-etichetta">
                Un indirizzo per riga, oppure separati da virgola o punto e virgola; «Nome Cognome &lt;email&gt;» è accettato
                <textarea name="elenco" className="cn-input cn-nl-area" rows={6} required />
              </label>
              <CampiBase />
            </ModuloAzione>
          </details>
          <details className="cn-nl-sezione">
            <summary>Importazione da file CSV</summary>
            <ModuloAzione azione={aggiungiDestinatari} campi={{ modo: "csv" }} etichetta="Importa" etichettaInCorso="Importazione…" svuota messaggioOk="Fatto." classe="cn-modulo">
              <label className="cn-etichetta">
                File CSV con intestazione: colonna «email» obbligatoria; «nome», «cognome», «azienda» facoltative; separatore virgola o punto e virgola (massimo 2 MB)
                <input name="file" type="file" accept=".csv,text/csv,text/plain" className="cn-input" required />
              </label>
              <CampiBase />
            </ModuloAzione>
          </details>
        </Pannello>
        <Pannello titolo="Da dove arrivano i destinatari">
          <p className="cn-nota">
            <strong>Clienti con abbonamento</strong>: entrano da soli quando hanno accettato le Condizioni di abbonamento che includono Tender Weekly (versione 3 o successive); la prova è
            l&apos;accettazione registrata. Chi si è disiscritto non viene mai riacquisito.
          </p>
          <p className="cn-nota">
            <strong>Sito omnia-ai.it</strong>: iscrizione gratuita con doppia conferma; fino alla conferma l&apos;indirizzo è «in attesa» e non riceve nulla.
          </p>
          <p className="cn-nota">
            <strong>Aggiunti a mano</strong>: uno, un elenco o un CSV, sempre con base giuridica e prova. Gli indirizzi già presenti non si duplicano.
          </p>
          <table className="cn-tab">
            <tbody>
              {perProvenienza.map((x) => (
                <tr key={x.p}>
                  <td>{ETICHETTA_PROVENIENZA[x.p]}</td>
                  <td className="num">{x.n} autorizzati</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Pannello>
      </div>

      <div className="cn-sezione">
        <Pannello titolo={`Elenco (${visibili.length})`}>
          <nav className="cn-filtri" aria-label="Filtri" style={{ margin: "10px 14px" }}>
            {FILTRI.map((f) => (
              <Link key={f.id} href={`/newsletter/iscritti?filtro=${f.id}`} className={f.id === filtro ? "attivo" : undefined}>
                {f.etichetta} ({conta[f.id]})
              </Link>
            ))}
          </nav>
          <form action="/newsletter/iscritti" method="get" className="cn-ricerca" style={{ margin: "0 14px 10px" }}>
            <input type="hidden" name="filtro" value={filtro} />
            <input name="q" className="cn-input" defaultValue={q} placeholder="Cerca email, nome o azienda" aria-label="Cerca" />
            <button className="cn-btn" type="submit">
              Cerca
            </button>
          </form>
          <div className="cn-scorri">
            <table className="cn-tab">
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Provenienza</th>
                  <th>Stato</th>
                  <th>Base giuridica</th>
                  <th>Prova / consenso</th>
                  <th>Iscritto il</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {visibili.map((i) => (
                  <tr key={i.id}>
                    <td>
                      {i.email}
                      {i.nome || i.azienda ? <span className="cn-nota"> · {[i.nome, i.azienda].filter(Boolean).join(" · ")}</span> : null}
                      {eAbbonato(i) ? (
                        <>
                          {" "}
                          <Badge tono="ok">abbonato</Badge>
                        </>
                      ) : null}
                    </td>
                    <td>{ETICHETTA_PROVENIENZA[prov(i)]}</td>
                    <td>
                      <Badge tono={STATO[i.stato].tono}>{STATO[i.stato].etichetta}</Badge>
                      {i.disiscritto_il && <span className="cn-nota"> {formattaRoma(i.disiscritto_il)}</span>}
                    </td>
                    <td>{ETICHETTA_BASE[i.base_giuridica]}</td>
                    <td className="tronca" title={[i.prova_base, i.informativa_versione ? `Informativa: ${i.informativa_versione}` : "", i.note_admin ? `Note: ${i.note_admin}` : ""].filter(Boolean).join(" · ")}>
                      {i.prova_base}
                    </td>
                    <td className="nowrap">{formattaRoma(i.confermato_il ?? i.creato_il)}</td>
                    <td>
                      {(i.stato === "iscritto" || i.stato === "in_attesa") && (
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
