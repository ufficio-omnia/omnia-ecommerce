import Link from "next/link";
import RichiestaPacchettoForm from "@/components/omnia-ai/richiesta-pacchetto-form";
import { FOOD_MENU } from "@/lib/gara-settore";
import { SERVIZI, TESTI_PACCHETTI, formattaEuro, testoUnita, type SchedaServizio } from "@/lib/pacchetti-servizi-calcoli";

// «Servizi per le tue gare» nella home: i servizi aggiuntivi dei settori che l'azienda tratta (pulizie → piano di lavoro; ristorazione collettiva →
// OMNIA FOOD MENU, che «sta arrivando»), con le unità residue e i pacchetti. Lo vedono il titolare e l'Ufficio Gare: il titolare apre la pagina
// dove si paga, l'Ufficio Gare con «Acquista» avvisa il titolare con un'email. Le schede arrivano già decise da costruisciSchede (regole pure):
// qui si disegna soltanto.

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
              ) : (
                <span className={`omnia-badge ${s.saldo > 0 ? "verde" : "ambra"}`}>{s.saldo > 0 ? `${s.saldo} residu${s.saldo === 1 ? "o" : "i"}` : "Esaurito"}</span>
              )}
            </div>

            <p className="omnia-pacchetto-testo">{s.servizio === "food_menu" ? FOOD_MENU.testo : SERVIZI[s.servizio].descrizione}</p>

            {s.offerta.stato === "in_arrivo" && <p className="omnia-pacchetto-nota">{TESTI_PACCHETTI.foodMenuArrivo}</p>}

            {s.offerta.stato !== "in_arrivo" && (
              <p className="omnia-pacchetto-saldo">
                {s.saldo > 0 ? (
                  <>
                    {TESTI_PACCHETTI.saldoEtichetta} <strong>{s.saldo}</strong> {s.saldo === 1 ? SERVIZI[s.servizio].unitaSingolare : SERVIZI[s.servizio].unitaPlurale}
                  </>
                ) : (
                  TESTI_PACCHETTI.saldoZero
                )}
              </p>
            )}

            {s.pacchetti.map((p) => (
              <div className="omnia-pacchetto-riga" key={p.quantita}>
                <div className="omnia-pacchetto-riga-testo">
                  <strong>
                    {testoUnita(p.quantita, s.servizio)} — {formattaEuro(p.prezzoCentesimi)}
                  </strong>{" "}
                  (IVA inclusa)
                  <small>
                    {formattaEuro(p.perUnitaCentesimi)} l&apos;uno{p.risparmioCentesimi ? ` · risparmi ${formattaEuro(p.risparmioCentesimi)} rispetto all'acquisto per singola gara` : ""}
                  </small>
                </div>
                {s.offerta.stato === "acquistabile" ? (
                  <Link href={`/dashboard/omnia-ai/servizi?servizio=${s.servizio}&quantita=${p.quantita}`} className="omnia-btn omnia-btn-p omnia-btn-piccolo">
                    Acquista
                  </Link>
                ) : (
                  <RichiestaPacchettoForm servizio={s.servizio} quantita={p.quantita} />
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
