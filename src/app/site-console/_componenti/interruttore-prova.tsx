import Link from "next/link";
import { urlConParametri } from "./selettore-periodo";

// Mostra o nasconde i dati di PROVA (account Stripe di OMNIA AI in modalità test:
// abbonamenti, incassi e acquisti di crediti che non sono denaro reale). Di
// default sono nascosti e fuori da ogni totale; lo stato sta nell'URL (?prova=1),
// quindi sopravvive al ricaricamento e si porta dietro nei link della pagina.
export default function InterruttoreProva({
  percorso,
  parametri,
  includiProva,
}: {
  percorso: string;
  // gli altri parametri della pagina (periodo, ordinamento) da non perdere
  parametri: Record<string, string | undefined>;
  includiProva: boolean;
}) {
  return (
    <nav className="cn-filtri" aria-label="Dati di prova">
      <span className="cn-etichetta-inline">Dati di prova</span>
      <Link href={urlConParametri(percorso, { ...parametri, prova: undefined })} className={includiProva ? undefined : "attivo"}>
        Nascosti
      </Link>
      <Link href={urlConParametri(percorso, { ...parametri, prova: "1" })} className={includiProva ? "attivo" : undefined}>
        Inclusi
      </Link>
    </nav>
  );
}
