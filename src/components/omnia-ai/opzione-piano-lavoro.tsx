"use client";

import { formatEuro } from "@/lib/omnia-ai-plans";
import { CLAUSOLE_PIANO_LAVORO, CLAUSOLE_SPECIFICHE_PIANO_LAVORO, VERSIONE_CONDIZIONI_PIANO_LAVORO } from "@/lib/piano-lavoro-acquisto-calcoli";
import { ETICHETTA_LINK_CONDIZIONI, OPZIONE_ABBONAMENTO_DESCRIZIONE, PERCORSO_CONDIZIONI_PIANO_LAVORO, TITOLO_AVVERTENZE_ACQUISTO, testoAccettazioneCompleta } from "@/lib/piano-lavoro-testi";

// L'opzione «piano di lavoro» dell'abbonamento, nei moduli di acquisto (pagina del piano e area riservata). Con la spunta il prezzo mensile è
// quello del piano + il supplemento; si accettano le avvertenze sul servizio (le stesse dell'acquisto della singola gara). Il server
// riverifica tutto: la vendita accesa, le avvertenze accettate, il prezzo Stripe dell'offerta.
export default function OpzionePianoLavoro({
  nomePiano,
  surplusCentesimi,
  totaleCentesimi,
  aggiunto,
  onAggiuntoChange,
  accettato,
  onAccettatoChange,
}: {
  nomePiano: string;
  surplusCentesimi: number;
  // il prezzo mensile con il piano di lavoro (con lo sconto in corso, se c'è)
  totaleCentesimi: number;
  aggiunto: boolean;
  onAggiuntoChange: (valore: boolean) => void;
  accettato: boolean;
  onAccettatoChange: (valore: boolean) => void;
}) {
  const numeriSpecifiche = CLAUSOLE_SPECIFICHE_PIANO_LAVORO.map((c) => c.numero);

  return (
    <section className="omnia-riquadro" style={{ marginTop: 20 }} aria-labelledby="opzione-piano-lavoro">
      <span className="omnia-eyebrow" id="opzione-piano-lavoro">
        Piano di lavoro (facoltativo)
      </span>
      <div className="omnia-check-riga">
        <input id="pianoLavoro" name="pianoLavoro" type="checkbox" checked={aggiunto} onChange={(e) => onAggiuntoChange(e.target.checked)} />
        <label htmlFor="pianoLavoro">
          Aggiungi il piano di lavoro al piano {nomePiano}: <strong>+{formatEuro(surplusCentesimi)} al mese</strong> (IVA inclusa), in tutto <strong>{formatEuro(totaleCentesimi)} al mese</strong>.
        </label>
      </div>
      <p className="omnia-riquadro-nota">{OPZIONE_ABBONAMENTO_DESCRIZIONE}</p>

      {aggiunto && (
        <>
          <details style={{ marginTop: 10 }}>
            <summary style={{ cursor: "pointer" }}>
              {TITOLO_AVVERTENZE_ACQUISTO} sul piano di lavoro (versione {VERSIONE_CONDIZIONI_PIANO_LAVORO})
            </summary>
            <div style={{ marginTop: 10, maxHeight: 240, overflowY: "auto", paddingRight: 8, fontSize: 14, lineHeight: 1.55 }}>
              {CLAUSOLE_PIANO_LAVORO.map((c) => (
                <p key={c.numero} style={{ margin: "0 0 10px" }}>
                  <strong>
                    {c.numero}. {c.titolo}.
                  </strong>{" "}
                  {c.testo}
                </p>
              ))}
              <p style={{ margin: 0 }}>
                <a href={PERCORSO_CONDIZIONI_PIANO_LAVORO} target="_blank" rel="noopener noreferrer">
                  {ETICHETTA_LINK_CONDIZIONI}
                </a>
              </p>
            </div>
          </details>
          <div className="omnia-check-riga">
            <input id="acceptPianoLavoro" name="acceptPianoLavoro" type="checkbox" checked={accettato} onChange={(e) => onAccettatoChange(e.target.checked)} required />
            <label htmlFor="acceptPianoLavoro">
              {testoAccettazioneCompleta(numeriSpecifiche, CLAUSOLE_SPECIFICHE_PIANO_LAVORO.map((c) => c.titolo.toLowerCase()))}
            </label>
          </div>
        </>
      )}
    </section>
  );
}
