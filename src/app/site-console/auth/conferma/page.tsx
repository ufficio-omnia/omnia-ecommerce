import type { Metadata } from "next";
import { confermaAccesso } from "../../azioni/accesso";

// Pagina pubblica di destinazione del link nell'email. Non completa l'accesso
// da sola: serve un clic sul pulsante. Un sistema che apre in anticipo i link
// delle email (antivirus, anteprime) fa una GET e non preme pulsanti, quindi non
// consuma il token al posto dell'admin.
export const metadata: Metadata = { title: "Conferma accesso" };

export default async function ConfermaPage({ searchParams }: { searchParams: Promise<{ token_hash?: string }> }) {
  const { token_hash: tokenHash } = await searchParams;

  return (
    <main className="cn-accesso">
      <div className="cn-accesso-scheda">
        <div className="cn-marchio" style={{ padding: 0 }}>
          OMNIA <small>console</small>
        </div>

        {tokenHash ? (
          <>
            <h1>Conferma l&apos;accesso</h1>
            <p>Premi il pulsante per aprire la console con questo link.</p>
            <form action={confermaAccesso} className="cn-modulo">
              <input type="hidden" name="token_hash" value={tokenHash} />
              <button type="submit" className="cn-btn primario ampio">
                Entra nella console
              </button>
            </form>
          </>
        ) : (
          <>
            <h1>Link non valido</h1>
            <p>Il link è incompleto. Richiedine uno nuovo dalla pagina di accesso.</p>
            <a className="cn-btn ampio" href="/login">
              Vai all&apos;accesso
            </a>
          </>
        )}
      </div>
    </main>
  );
}
