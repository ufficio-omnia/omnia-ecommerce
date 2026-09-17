import Link from "next/link";

export type AttivitaVoce = {
  testo: string;
  garaId: string | null;
  orario: string;
};

function formattaOrario(iso: string): string {
  const data = new Date(iso);
  const oggi = new Date();
  const stessoGiorno = data.toDateString() === oggi.toDateString();
  return stessoGiorno
    ? data.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })
    : data.toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit" });
}

// Ricavata da fatti reali già a database (documento caricato, analisi
// conclusa, relazione generata) — mai un log inventato.
export default function AttivitaRecente({ voci }: { voci: AttivitaVoce[] }) {
  return (
    <section className="omnia-riquadro">
      <span className="omnia-eyebrow">Attività recente</span>

      {voci.length === 0 ? (
        <p className="omnia-elenco-vuoto" style={{ marginTop: 12 }}>
          Nessuna attività ancora.
        </p>
      ) : (
        <div className="omnia-attivita-elenco">
          {voci.map((v, i) => (
            <div key={i} className="omnia-attivita-riga">
              <span className="orario">{formattaOrario(v.orario)}</span>
              <span className="testo">
                {v.garaId ? <Link href={`/dashboard/omnia-ai/gare/${v.garaId}`}>{v.testo}</Link> : v.testo}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
