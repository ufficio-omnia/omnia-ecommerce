"use client";

import { useActionState } from "react";
import {
  creaUfficioGare,
  rimuoviUfficioGare,
  rinviaLinkUfficioGare,
  riattivaUfficioGare,
  sospendiUfficioGare,
  type UfficioGareState,
} from "@/app/actions/omnia-ai-ufficio-gare";
import { ETICHETTA_STATO_UFFICIO_GARE, TESTO_CONSENSO_TITOLARE, type StatoUfficioGare } from "@/lib/omnia-ai-account-calcoli";

const STATO_INIZIALE: UfficioGareState = {};

const FORMATO_DATA = new Intl.DateTimeFormat("it-IT", { timeZone: "Europe/Rome", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
const data = (iso: string) => FORMATO_DATA.format(new Date(iso));

export type DatiUfficioGare = {
  email: string;
  stato: StatoUfficioGare;
  creatoIl: string;
  invitoInviatoIl: string;
  ultimoAccesso: string | null;
};

function Esito({ stato }: { stato: UfficioGareState }) {
  return (
    <>
      {stato.error && <p className="omnia-messaggio-stato errore">{stato.error}</p>}
      {stato.success && <p className="omnia-messaggio-stato successo">{stato.success}</p>}
      {stato.avviso && <p className="omnia-messaggio-stato avviso">{stato.avviso}</p>}
    </>
  );
}

const COLORE_STATO: Record<StatoUfficioGare, string> = { in_attesa: "ambra", attivo: "verde", sospeso: "rosso" };

function ModuloInvito({ puoCreare, motivoBlocco }: { puoCreare: boolean; motivoBlocco: string | null }) {
  const [stato, azione, inCorso] = useActionState(creaUfficioGare, STATO_INIZIALE);
  return (
    <section className="omnia-riquadro">
      <span className="omnia-eyebrow">Crea l&apos;accesso</span>
      <p className="omnia-riquadro-nota" style={{ marginTop: 10 }}>
        Indica l&apos;email della persona (o della casella condivisa) dell&apos;ufficio gare: riceverà un link per scegliere la sua password.
      </p>
      {motivoBlocco && <p className="omnia-messaggio-stato avviso">{motivoBlocco}</p>}
      <form action={azione} style={{ marginTop: 16 }}>
        <div className="omnia-form-riga">
          <input type="email" name="email" placeholder="ufficiogare@tuaazienda.it" required className="omnia-input" style={{ flex: 1, minWidth: 240 }} autoComplete="off" disabled={!puoCreare} />
        </div>
        <div className="omnia-check-riga">
          <input id="consenso-ufficio-gare" name="consenso" type="checkbox" required disabled={!puoCreare} />
          <label htmlFor="consenso-ufficio-gare">{TESTO_CONSENSO_TITOLARE}</label>
        </div>
        <button type="submit" disabled={!puoCreare || inCorso} className="omnia-btn omnia-btn-p" style={{ marginTop: 18 }}>
          {inCorso ? "Creazione..." : "Crea l'accesso Ufficio Gare"}
        </button>
      </form>
      <Esito stato={stato} />
    </section>
  );
}

function SchedaUfficioGare({ ufficio }: { ufficio: DatiUfficioGare }) {
  const [statoRinvio, rinvia, rinvioInCorso] = useActionState(rinviaLinkUfficioGare, STATO_INIZIALE);
  const [statoSospendi, sospendi, sospendiInCorso] = useActionState(sospendiUfficioGare, STATO_INIZIALE);
  const [statoRiattiva, riattiva, riattivaInCorso] = useActionState(riattivaUfficioGare, STATO_INIZIALE);
  const [statoRimuovi, rimuovi, rimuoviInCorso] = useActionState(rimuoviUfficioGare, STATO_INIZIALE);
  const occupato = rinvioInCorso || sospendiInCorso || riattivaInCorso || rimuoviInCorso;

  return (
    <section className="omnia-riquadro">
      <span className="omnia-eyebrow">Il tuo Ufficio Gare</span>
      <div style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <strong style={{ fontSize: 17 }}>{ufficio.email}</strong>
        <span className={`omnia-badge ${COLORE_STATO[ufficio.stato]}`}>{ETICHETTA_STATO_UFFICIO_GARE[ufficio.stato]}</span>
      </div>
      <p className="omnia-riquadro-nota" style={{ marginTop: 10 }}>
        Creato il {data(ufficio.creatoIl)}
        {ufficio.stato === "in_attesa" && <> · link inviato il {data(ufficio.invitoInviatoIl)}</>}
        {ufficio.ultimoAccesso && <> · ultimo accesso il {data(ufficio.ultimoAccesso)}</>}
      </p>

      <div className="omnia-form-riga" style={{ marginTop: 18 }}>
        {ufficio.stato === "in_attesa" && (
          <form action={rinvia}>
            <button type="submit" disabled={occupato} className="omnia-btn omnia-btn-s omnia-btn-piccolo">
              {rinvioInCorso ? "Invio..." : "Rinvia il link"}
            </button>
          </form>
        )}
        {ufficio.stato !== "sospeso" && (
          <form
            action={sospendi}
            onSubmit={(e) => {
              if (!window.confirm("Sospendere l'accesso? L'Ufficio Gare non potrà più entrare finché non lo riattivi.")) e.preventDefault();
            }}
          >
            <button type="submit" disabled={occupato} className="omnia-btn omnia-btn-s omnia-btn-piccolo">
              {sospendiInCorso ? "Sospensione..." : "Sospendi l'accesso"}
            </button>
          </form>
        )}
        {ufficio.stato === "sospeso" && (
          <form action={riattiva}>
            <button type="submit" disabled={occupato} className="omnia-btn omnia-btn-p omnia-btn-piccolo">
              {riattivaInCorso ? "Riattivazione..." : "Riattiva l'accesso"}
            </button>
          </form>
        )}
        <form
          action={rimuovi}
          onSubmit={(e) => {
            if (!window.confirm("Rimuovere l'Ufficio Gare? L'utente viene eliminato. Le gare e i documenti restano della tua azienda. L'operazione non si può annullare.")) e.preventDefault();
          }}
        >
          <button type="submit" disabled={occupato} className="omnia-btn omnia-btn-s omnia-btn-piccolo">
            {rimuoviInCorso ? "Rimozione..." : "Rimuovi"}
          </button>
        </form>
      </div>

      <Esito stato={statoRinvio} />
      <Esito stato={statoSospendi} />
      <Esito stato={statoRiattiva} />
      <Esito stato={statoRimuovi} />
    </section>
  );
}

// Un solo componente per i due casi (nessun Ufficio Gare / Ufficio Gare presente): dopo la creazione la pagina si
// ricarica e passa da sola dall'invito alla scheda.
export default function UfficioGareGestione({
  ufficio,
  puoCreare,
  motivoBlocco,
}: {
  ufficio: DatiUfficioGare | null;
  puoCreare: boolean;
  motivoBlocco: string | null;
}) {
  return ufficio ? <SchedaUfficioGare ufficio={ufficio} /> : <ModuloInvito puoCreare={puoCreare} motivoBlocco={motivoBlocco} />;
}
