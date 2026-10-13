import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { leggiSessioneConsole } from "@/lib/console/accesso";
import LoginForm from "./login-form";

// Pagina pubblica: serve proprio a ottenere una sessione. Nessun link di
// registrazione, di recupero password o verso gli altri siti.
export const metadata: Metadata = { title: "Accesso" };

const MESSAGGI: Record<string, string> = {
  accesso: "Questo account non è abilitato alla console.",
  scaduta: "La sessione è scaduta. Richiedi un nuovo link per rientrare.",
  link: "Il link non è valido o è già stato usato. Richiedine uno nuovo.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ errore?: string }> }) {
  // Già dentro come admin: niente da fare qui.
  if ((await leggiSessioneConsole()).stato === "admin") redirect("/");

  const { errore } = await searchParams;
  const messaggio = errore ? MESSAGGI[errore] : undefined;

  return (
    <main className="cn-accesso">
      <div className="cn-accesso-scheda">
        <div className="cn-marchio" style={{ padding: 0 }}>
          OMNIA <small>console</small>
        </div>
        <h1>Accesso riservato</h1>
        <p>Inserisci l&apos;email di amministratore: riceverai un link per entrare. Non c&apos;è nessuna password.</p>
        {messaggio && (
          <p className="cn-esito errore" role="alert">
            {messaggio}
          </p>
        )}
        <LoginForm />
      </div>
    </main>
  );
}
