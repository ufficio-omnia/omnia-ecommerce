import Link from "next/link";
import ImpostazioniForm from "./impostazioni-form";
import { richiediTitolarePagina } from "@/lib/omnia-ai-account-guardie";

// Solo dati account: i dati azienda restano esclusivamente in Profilo
// azienda, non duplicati qui.
export default async function ImpostazioniPage() {
  // Solo il titolare: l'Ufficio Gare non vede questa pagina (la barra laterale non la mostra, il controllo vero è qui).
  const sessione = await richiediTitolarePagina();
  if (!sessione) return null;
  const { user } = sessione;

  return (
    <div className="omnia-app-shell">
      <Link href="/dashboard/omnia-ai" className="omnia-torna">
        ← OMNIA AI
      </Link>

      <h1 className="omnia-app-titolo">Impostazioni</h1>
      <p className="omnia-app-sottotitolo">Email e password di accesso al tuo account.</p>

      <ImpostazioniForm emailAttuale={user.email ?? ""} />
    </div>
  );
}
