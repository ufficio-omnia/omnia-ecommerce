import { SPIEGAZIONE_LIVELLO, messaggioStato, type ClassificazioneLetta } from "@/lib/radar/classificazioni-lettura";

// Fase B3: «Perché questa gara è qui» nella scheda. Per ogni settore il livello (pertinente, correlata, non pertinente), le sottocategorie e
// i motivi scritti dalle regole approvate, con la versione delle regole. Rilevanza settoriale, NON verifica dei requisiti dell'impresa.
// Solo con le classificazioni accese (altrimenti la scheda resta com'era).
export default function ClassificazioneGara({ c }: { c: ClassificazioneLetta }) {
  const stato = messaggioStato(c);
  const pertinenti = c.settori.filter((s) => s.livello !== "C");
  const nonPertinenti = c.settori.filter((s) => s.livello === "C");
  return (
    <section className="omnia-riquadro omnia-opp-classificazione" aria-labelledby="perche-qui">
      <span id="perche-qui" className="omnia-eyebrow">
        Perché questa gara è qui
      </span>
      {stato && <p className="omnia-opp-nota omnia-opp-classificazione-stato">{stato}</p>}
      {c.stato === "classificata" && c.settori.length === 0 && <p className="omnia-opp-nota">Nessun settore indicato dalla classificazione.</p>}
      {pertinenti.length > 0 && (
        <ul className="omnia-opp-classificazione-elenco">
          {pertinenti.map((s) => (
            <li key={s.settore}>
              <div className="omnia-opp-classificazione-testa">
                <strong>{s.nome}</strong>
                <span className={`omnia-badge${s.livello === "A" ? " verde" : ""}`}>{s.etichettaLivello}</span>
                {s.ambigua && <span className="omnia-badge ambra">Fonti non concordi</span>}
              </div>
              <div className="omnia-opp-nota">{SPIEGAZIONE_LIVELLO[s.livello]}</div>
              {s.sottocategorie.length > 0 && <div className="omnia-opp-classificazione-sotto">{s.sottocategorie.map((x) => x.nome).join(" · ")}</div>}
              {s.motivi.length > 0 && (
                <ul className="omnia-opp-classificazione-motivi">
                  {s.motivi.map((m, i) => (
                    <li key={i}>{m}</li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
      {nonPertinenti.length > 0 && (
        <p className="omnia-opp-nota">
          Non pertinente per: {nonPertinenti.map((s) => s.nome).join(", ")}. {pertinenti.length === 0 ? "La gara resta consultabile, ma non è suggerita come opportunità dei settori." : ""}
        </p>
      )}
      <p className="omnia-opp-nota">
        È la rilevanza della gara per i settori, non la verifica dei requisiti della tua impresa.
        {c.versione ? ` Regole del ${c.versione.slice(8, 10)}/${c.versione.slice(5, 7)}/${c.versione.slice(0, 4)}.` : ""}
      </p>
    </section>
  );
}
