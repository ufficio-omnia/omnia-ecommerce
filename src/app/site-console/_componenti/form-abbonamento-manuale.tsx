"use client";

import { useActionState } from "react";
import type { StatoAzioneUtente } from "../azioni/utenti";

type Azione = (stato: StatoAzioneUtente, dati: FormData) => Promise<StatoAzioneUtente>;

// Abbonamento creato o modificato a mano (accordo commerciale, prova concessa):
// non passa da Stripe, quindi non genera incassi né accettazioni. Il piano si sceglie
// dal catalogo, mai in testo libero (un «Enterprise» scritto a mano non veniva riconosciuto).
export default function FormAbbonamentoManuale({
  userId,
  piani,
  attuale,
  azione,
}: {
  userId: string;
  piani: { slug: string; nome: string }[];
  attuale: { piano: string; stato: string; scadenza: string | null } | null;
  azione: Azione;
}) {
  const [stato, esegui, inCorso] = useActionState(azione, {});

  return (
    <form action={esegui} className="cn-modulo-griglia">
      <input type="hidden" name="userId" value={userId} />
      <div>
        <label className="cn-etichetta" htmlFor="ab-piano">
          Piano
        </label>
        <select id="ab-piano" name="plan" className="cn-input" defaultValue={attuale?.piano ?? "starter"} required>
          {piani.map((p) => (
            <option key={p.slug} value={p.slug}>
              {p.nome}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="cn-etichetta" htmlFor="ab-stato">
          Stato
        </label>
        <select id="ab-stato" name="status" className="cn-input" defaultValue={attuale?.stato ?? "attivo"}>
          <option value="attivo">Attivo</option>
          <option value="scaduto">Scaduto</option>
          <option value="annullato">Annullato</option>
        </select>
      </div>
      <div>
        <label className="cn-etichetta" htmlFor="ab-fine">
          Valido fino al (compreso)
        </label>
        <input id="ab-fine" name="currentPeriodEnd" type="date" className="cn-input" defaultValue={attuale?.scadenza ?? ""} />
      </div>
      <div className="cn-azione">
        <button type="submit" className="cn-btn primario" disabled={inCorso}>
          {inCorso ? "Salvo…" : "Salva abbonamento"}
        </button>
        {stato.ok && <span className="cn-esito ok">Salvato.</span>}
        {stato.errore && (
          <span className="cn-azione-errore" role="alert">
            {stato.errore}
          </span>
        )}
      </div>
    </form>
  );
}
