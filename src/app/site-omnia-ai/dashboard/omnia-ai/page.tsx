import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getOmniaAiAccessState } from "@/lib/omnia-ai-access";

// Non c'è bisogno di gestire "cessato" qui: il layout blocca del tutto
// l'accesso a questa pagina (e a ogni altra sotto dashboard/omnia-ai)
// prima che il rendering arrivi fin qui, mostrando la schermata di
// vendita al suo posto.
export default async function OmniaAiHomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const stato = user ? await getOmniaAiAccessState(user.id, supabase) : null;
  const soleLettura = stato?.stato === "sola_lettura";

  return (
    <div className="omnia-app-shell">
      <h1 className="omnia-app-titolo">OMNIA AI</h1>
      <p className="omnia-app-sottotitolo">
        {soleLettura
          ? "Il tuo abbonamento non è più attivo: l'area è in sola lettura, come indicato nell'avviso qui sopra."
          : "Il tuo abbonamento è attivo. Da qui puoi accedere agli strumenti OMNIA AI per l'analisi delle gare e la generazione dei contenuti."}
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

        <Link href="/dashboard/omnia-ai/abbonamento" className="omnia-riga-link">
          <div className="titolo">Abbonamento</div>
          <p className="meta">
            Piano corrente, gare incluse residue, crediti aggiuntivi, pagamento e disdetta.
          </p>
        </Link>
      </div>
    </div>
  );
}
