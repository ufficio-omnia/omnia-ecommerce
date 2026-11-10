import Link from "next/link";
import RichiestaPacchettoForm from "@/components/omnia-ai/richiesta-pacchetto-form";
import { FOOD_MENU } from "@/lib/gara-settore";
import { SERVIZI, TESTI_PACCHETTI, formattaEuro, testoUnita, type SchedaServizio } from "@/lib/pacchetti-servizi-calcoli";

// «Servizi per le tue gare» nella home: i servizi aggiuntivi dei settori che l'azienda tratta (pulizie → piano di lavoro; ristorazione collettiva →
// OMNIA FOOD MENU, che «sta arrivando»), con le unità residue, le concessioni gratuite, le offerte dedicate al cliente e i pacchetti. Lo vedono il
// titolare e l'Ufficio Gare: il titolare apre la pagina dove si paga, l'Ufficio Gare con «Acquista» avvisa il titolare con un'email. Le schede
// arrivano già decise da costruisciSchede (regole pure): qui si disegna soltanto.

export default function ServiziPerLeGare({ schede, titolare }: { schede: SchedaServizio[]; titolare: boolean }) {
  if (schede.length === 0) return null;
  return (
    <section className="omnia-riquadro" aria-labelledby="servizi-gare-titolo" id="servizi">
      <div className="omnia-app-intestazione">
        <span className="omnia-eyebrow" id="servizi-gare-titolo">
          {TESTI_PACCHETTI.titoloSezione}
        </span>
        {titolare && schede.some((s) => s.offerta.stato === "acquistabile" || s.saldo > 0) && (
          <Link href="/dashboard/omnia-ai/servizi" className="omnia-btn omnia-btn-s omnia-btn-piccolo">
            Tutti i servizi
          </Link>
        )}
      </div>
      <p className="omnia-riquadro-nota">{TESTI_PACCHETTI.introSezione}</p>

      <div className="omnia-pacchetti-griglia">
        {schede.map((s) => (
          <div className="omnia-pacchetto-scheda" key={s.servizio} id={`servizio-${s.servizio}`}>
            <div className="omnia-pacchetto-testata">
              <h3>{s.servizio === "food_menu" ? FOOD_MENU.nome : SERVIZI[s.servizio].nome}</h3>
              {s.offerta.stato === "in_arrivo" ? (
                <span className="omnia-badge ambra">{FOOD_MENU.stato}</span>
              ) : s.saldo > 0 ? (
                <span className="omnia-badge verde">{`${s.saldo} residu${s.saldo === 1 ? "o" : "i"}`}</span>
              ) : s.haAvutoUnita ? (
                // «Esaurito» solo a chi ha avuto delle unità e le ha finite: chi non ne ha mai avute non ha finito nulla
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
              <div className="omnia-pacchetto-riga" key={p.offertaId ?? p.quantita}>
                <div className="omnia-pacchetto-riga-testo">
                  {p.offertaId && <span className="omnia-badge verde">{TESTI_PACCHETTI.offertaDedicata}</span>}
                  {p.offertaId && " "}
                  <strong>
                    {testoUnita(p.quantita, s.servizio)} — {formattaEuro(p.prezzoCentesimi)}
                  </strong>{" "}
                  (IVA inclusa)
                  <small>
                    {formattaEuro(p.perUnitaCentesimi)} l&apos;uno{p.risparmioCentesimi ? ` · risparmi ${formattaEuro(p.risparmioCentesimi)} rispetto all'acquisto per singola gara` : ""}
                    {p.offertaId && p.scadeIl ? ` · ${TESTI_PACCHETTI.validaFinoAl(p.scadeIl)}` : ""}
                  </small>
                </div>
                {s.offerta.stato === "acquistabile" ? (
                  <Link
                    href={p.offertaId ? `/dashboard/omnia-ai/servizi?servizio=${s.servizio}&offerta=${p.offertaId}` : `/dashboard/omnia-ai/servizi?servizio=${s.servizio}&quantita=${p.quantita}`}
                    className="omnia-btn omnia-btn-p omnia-btn-piccolo"
                  >
                    Acquista
                  </Link>
                ) : (
                  <RichiestaPacchettoForm servizio={s.servizio} quantita={p.quantita} offertaId={p.offertaId} />
                )}
              </div>
            ))}

            {s.pacchetti.length > 0 && <p className="omnia-pacchetto-nota">{TESTI_PACCHETTI.dettaglioPacchetto}</p>}
            {s.offerta.stato === "solo_titolare" && <p className="omnia-pacchetto-nota">{TESTI_PACCHETTI.soloTitolareNota}</p>}
            {!titolare && s.saldo > 0 && s.offerta.stato !== "solo_titolare" && <p className="omnia-pacchetto-nota">Le puoi usare dalla pagina di ogni gara.</p>}
          </div>
        ))}
      </div>
    </section>
  );
}
