import Link from "next/link";

export default function OmniaAiHomePage() {
  return (
    <div className="omnia-app-shell">
      <h1 className="omnia-app-titolo">OMNIA AI</h1>
      <p className="omnia-app-sottotitolo">
        Il tuo abbonamento è attivo. Da qui puoi accedere agli strumenti OMNIA AI per l&apos;analisi
        delle gare e la generazione dei contenuti.
      </p>

      <div className="omnia-elenco-riquadri">
        <Link href="/dashboard/omnia-ai/gare" className="omnia-riga-link">
          <div className="titolo">Gare</div>
          <p className="meta">
            Crea una stanza di lavoro per ogni gara d&apos;appalto e carica bando, disciplinare e
            capitolato.
          </p>
        </Link>

        <Link href="/dashboard/omnia-ai/profilo-azienda" className="omnia-riga-link">
          <div className="titolo">Profilo azienda</div>
          <p className="meta">
            Compila i dati della tua azienda: verranno usati come base fissa da OMNIA AI per
            l&apos;analisi delle gare e la generazione dei contenuti.
          </p>
        </Link>
      </div>
    </div>
  );
}
