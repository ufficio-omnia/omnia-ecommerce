import Link from "next/link";

// Placeholder: la chat di supporto vera arriva in un lavoro successivo.
// La barra laterale linka già questa pagina, quindi deve esistere fin da
// ora per non dare un 404 nel frattempo.
export default function AssistenzaPage() {
  return (
    <div className="omnia-app-shell">
      <Link href="/dashboard/omnia-ai" className="omnia-torna">
        ← OMNIA AI
      </Link>

      <h1 className="omnia-app-titolo">Assistenza</h1>
      <p className="omnia-app-sottotitolo">
        La chat di supporto arriva a breve. Nel frattempo scrivi a{" "}
        <a href="mailto:info@omniaitalia.com">info@omniaitalia.com</a>.
      </p>
    </div>
  );
}
