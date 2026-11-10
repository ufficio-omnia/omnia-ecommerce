import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { richiediTitolarePagina } from "@/lib/omnia-ai-account-guardie";
import { getOmniaAiAccessState } from "@/lib/omnia-ai-access";
import { getCurrentOmniaAiLegalDocuments } from "@/lib/omnia-ai-legal";
import { FOOD_MENU } from "@/lib/gara-settore";
import { leggiMovimentiPacchetti, leggiSchedeServizi, leggiSettoriGare } from "@/lib/pacchetti-servizi";
import { ETICHETTA_MOVIMENTO, SERVIZI, TESTI_PACCHETTI, eServizioPacchetto, formattaEuro, testoUnita } from "@/lib/pacchetti-servizi-calcoli";
import AcquistoPacchettoForm from "./acquisto-pacchetto-form";

export const metadata: Metadata = { title: "Servizi aggiuntivi — OMNIA AI" };

const dataOra = (iso: string) => new Date(iso).toLocaleString("it-IT", { timeZone: "Europe/Rome", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

// Servizi aggiuntivi a pacchetto (piano di lavoro e, in arrivo, OMNIA FOOD MENU): le unità residue, le concessioni gratuite, le offerte dedicate al
// cliente, i pacchetti in vendita con il modulo d'acquisto e lo storico dei movimenti. Pagina del TITOLARE: l'Ufficio Gare vede i pacchetti nella
// home e con «Acquista» gli manda una email, ma paga solo lui.
export default async function ServiziAggiuntiviPage({ searchParams }: { searchParams: Promise<{ servizio?: string; quantita?: string; offerta?: string; pacchetto?: string }> }) {
  const supabase = await createClient();
  const sessione = await richiediTitolarePagina();
  if (!sessione) return null;
  const { contesto } = sessione;
  const accountId = contesto.accountId;
  const admin = createAdminClient();
  const query = await searchParams;
  const ritorno = query.pacchetto === "pagato" || query.pacchetto === "annullato" ? query.pacchetto : null;
  const servizioAperto = eServizioPacchetto(query.servizio) ? query.servizio : null;
  const quantitaAperta = Number(query.quantita);
  const offertaAperta = typeof query.offerta === "string" ? query.offerta : null;

  const statoAccesso = await getOmniaAiAccessState(accountId, admin);
  const attivo = statoAccesso.stato === "attivo";

  // Settori delle gare (migrazione 0103), come nella home: senza la colonna le gare risultano «non classificate» e contano come pulizie.
  const settoriGare = await leggiSettoriGare(supabase, accountId);

  const [schede, movimenti, documenti] = await Promise.all([
    attivo ? leggiSchedeServizi({ admin, accountId, titolare: true, settoriGare }) : Promise.resolve([]),
    leggiMovimentiPacchetti(admin, accountId, 15),
    attivo ? getCurrentOmniaAiLegalDocuments(admin) : Promise.resolve(null),
  ]);
  const privacyVersione = documenti?.privacyPolicy.version ?? null;

  return (
    <div className="omnia-app-shell largo">
      <div className="omnia-app-intestazione">
        <div>
          <h1 style={{ margin: 0 }}>Servizi aggiuntivi</h1>
          <p className="omnia-riquadro-nota">{TESTI_PACCHETTI.introSezione}</p>
        </div>
        <Link href="/dashboard/omnia-ai/pagamenti" className="omnia-btn omnia-btn-s omnia-btn-piccolo">
          Pagamenti e fatture
        </Link>
      </div>

      {ritorno === "pagato" && <p className="omnia-messaggio-stato successo">{TESTI_PACCHETTI.pacchettoPagato}</p>}
      {ritorno === "annullato" && <p className="omnia-messaggio-stato avviso">{TESTI_PACCHETTI.pacchettoAnnullato}</p>}

      {!attivo && (
        <p className="omnia-messaggio-stato avviso" style={{ marginTop: 18 }}>
          I pacchetti si acquistano con l&apos;abbonamento attivo: come i crediti aggiuntivi, si perdono se l&apos;abbonamento cessa.
        </p>
      )}

      {attivo && schede.length === 0 && (
        <p className="omnia-messaggio-stato avviso" style={{ marginTop: 18 }}>
          Per ora non ci sono servizi da mostrare: compaiono qui quando analizzi gare di un settore che ha un servizio aggiuntivo (per esempio, le pulizie per il piano di lavoro).
        </p>
      )}

      {schede.map((s) => (
        <section className="omnia-riquadro" key={s.servizio} id={s.servizio} aria-labelledby={`titolo-${s.servizio}`}>
          <div className="omnia-pacchetto-testata">
            <span className="omnia-eyebrow" id={`titolo-${s.servizio}`}>
              {s.servizio === "food_menu" ? FOOD_MENU.nome : SERVIZI[s.servizio].nome}
            </span>
            {s.offerta.stato === "in_arrivo" ? (
              <span className="omnia-badge ambra">{FOOD_MENU.stato}</span>
            ) : s.saldo > 0 ? (
              <span className="omnia-badge verde">{`${s.saldo} residu${s.saldo === 1 ? "o" : "i"}`}</span>
            ) : s.haAvutoUnita ? (
              // «Esaurito» solo a chi ha avuto delle unità e le ha finite
              <span className="omnia-badge ambra">Esaurito</span>
            ) : null}
          </div>
          <p className="omnia-pacchetto-testo">{s.servizio === "food_menu" ? FOOD_MENU.testo : SERVIZI[s.servizio].descrizione}</p>
          {s.offerta.stato === "in_arrivo" && <p className="omnia-pacchetto-nota">{TESTI_PACCHETTI.foodMenuArrivo}</p>}

          {s.offerta.stato !== "in_arrivo" && (
            <p className="omnia-pacchetto-saldo">
              {s.saldo > 0 ? (
                <>
                  {TESTI_PACCHETTI.saldoEtichetta} <strong>{s.saldo}</strong> {s.saldo === 1 ? SERVIZI[s.servizio].unitaSingolare : SERVIZI[s.servizio].unitaPlurale}
                </>
              ) : s.haAvutoUnita ? (
                TESTI_PACCHETTI.saldoZero
              ) : (
                TESTI_PACCHETTI.nessunPacchetto
              )}
            </p>
          )}

          {s.concessioni.length > 0 && (
            <div className="omnia-pacchetto-concessione">
              {s.concessioni.map((testo) => (
                <p key={testo}>
                  <strong>{TESTI_PACCHETTI.concessioneEtichetta}:</strong> {testo}
                </p>
              ))}
              <p className="omnia-pacchetto-nota">{TESTI_PACCHETTI.concessioneNota}</p>
            </div>
          )}

          {s.pacchetti.map((p) => (
            <div className="omnia-pacchetto-scheda" key={p.offertaId ?? p.quantita} style={{ marginTop: 14 }} id={p.offertaId ? `offerta-${p.offertaId}` : `${s.servizio}-${p.quantita}`}>
              <div className="omnia-pacchetto-riga-testo">
                {p.offertaId && <span className="omnia-badge verde">{TESTI_PACCHETTI.offertaDedicata}</span>}
                {p.offertaId && " "}
                <strong>
                  {testoUnita(p.quantita, s.servizio)} — {formattaEuro(p.prezzoCentesimi)}
                </strong>{" "}
                (IVA inclusa)
                <small>
                  {formattaEuro(p.perUnitaCentesimi)} l&apos;uno{p.risparmioCentesimi ? ` · risparmi ${formattaEuro(p.risparmioCentesimi)} rispetto all'acquisto per singola gara` : ""}
                  {p.offertaId && p.scadeIl ? ` · ${TESTI_PACCHETTI.validaFinoAl(p.scadeIl)}` : ""}. {TESTI_PACCHETTI.dettaglioPacchetto}
                </small>
              </div>
              <AcquistoPacchettoForm
                servizio={s.servizio}
                quantita={p.quantita}
                prezzoCentesimi={p.prezzoCentesimi}
                privacyVersione={privacyVersione}
                offertaId={p.offertaId}
                aperto={p.offertaId ? offertaAperta === p.offertaId : servizioAperto === s.servizio && quantitaAperta === p.quantita}
              />
            </div>
          ))}

          {s.pacchetti.length === 0 && s.offerta.stato === "nessuna" && s.saldo > 0 && <p className="omnia-pacchetto-nota">{TESTI_PACCHETTI.venditaSpenta} Le unità che hai restano utilizzabili dalla pagina di ogni gara.</p>}
        </section>
      ))}

      {movimenti.length > 0 && (
        <section className="omnia-riquadro" aria-labelledby="titolo-movimenti">
          <span className="omnia-eyebrow" id="titolo-movimenti">
            Ultimi movimenti
          </span>
          <ul className="omnia-pacchetto-movimenti">
            {movimenti.map((m) => (
              <li key={m.id}>
                <span>
                  {ETICHETTA_MOVIMENTO[m.tipo]}
                  {m.gara_titolo ? ` — ${m.gara_titolo}` : ""}
                  <small style={{ display: "block", color: "var(--fioco)" }}>{dataOra(m.creato_il)}</small>
                </span>
                <strong>
                  {m.delta > 0 ? "+" : ""}
                  {m.delta} <small style={{ fontWeight: 400, color: "var(--fioco)" }}>→ {m.saldo_dopo}</small>
                </strong>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
