// Tre tappe verificabili, non una percentuale inventata: ognuna è un
// fatto vero a database (documento caricato, analisi conclusa, relazione
// generata), mai una stima. La quarta tappa "revisione richiesta" resta
// fuori finché la funzione di revisione umana non esiste davvero.
export default function ProgressBarGara({
  documentiCaricati,
  analisiConclusa,
  relazioneGenerata,
}: {
  documentiCaricati: boolean;
  analisiConclusa: boolean;
  relazioneGenerata: boolean;
}) {
  const tappe = [documentiCaricati, analisiConclusa, relazioneGenerata];

  return (
    <div
      className="omnia-gara-avanzamento"
      role="img"
      aria-label={`Avanzamento: ${tappe.filter(Boolean).length} di ${tappe.length} tappe completate`}
    >
      {tappe.map((fatta, i) => (
        <span key={i} className={`omnia-gara-tappa${fatta ? " fatta" : ""}`} />
      ))}
    </div>
  );
}
