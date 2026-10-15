import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { getOmniaAiAccessState } from "@/lib/omnia-ai-access";
import { richiediTitolarePagina } from "@/lib/omnia-ai-account-guardie";
import { leggiUfficioGare } from "@/lib/omnia-ai-ufficio-gare";
import { MESSAGGIO_UFFICIO_GARE_VERIFICA_NON_RIUSCITA } from "@/lib/omnia-ai-account-calcoli";
import UfficioGareGestione from "./ufficio-gare-gestione";

const PUO = [
  "Vedere la dashboard e tutte le gare dell'azienda",
  "Creare gare, caricare i documenti, farle analizzare",
  "Usare la chat con OMNIA AI e generare la relazione tecnica",
  "Scaricare i documenti prodotti",
  "Scrivere al supporto",
];
const NON_PUO = [
  "Abbonamento, piani e acquisto di crediti",
  "Pagamenti e fatture",
  "Profilo azienda e documenti aziendali",
  "Documenti contrattuali e impostazioni dell'account",
  "Pagare la revisione umana (può chiederla: ti arriva un'email e la paghi tu)",
];

export default async function UfficioGarePage() {
  const sessione = await richiediTitolarePagina();

  const intestazione = (
    <>
      <Link href="/dashboard/omnia-ai" className="omnia-torna">
        ← OMNIA AI
      </Link>
      <h1 className="omnia-app-titolo">Ufficio Gare</h1>
      <p className="omnia-app-sottotitolo">
        Un accesso separato per chi, nella tua azienda, si occupa delle gare: lavora sulle gare ma non vede la parte amministrativa. Ne puoi creare uno solo.
      </p>
    </>
  );

  if (!sessione) {
    return (
      <div className="omnia-app-shell">
        {intestazione}
        <p className="omnia-messaggio-stato errore">{MESSAGGIO_UFFICIO_GARE_VERIFICA_NON_RIUSCITA}</p>
      </div>
    );
  }

  const admin = createAdminClient();
  const [lettura, statoAccesso] = await Promise.all([leggiUfficioGare(sessione.contesto.accountId, admin), getOmniaAiAccessState(sessione.contesto.accountId, admin)]);

  const abbonamentoUtilizzabile = statoAccesso.stato === "attivo" || statoAccesso.stato === "prova";
  const motivoBlocco =
    lettura.esito === "schema_assente"
      ? "L'Ufficio Gare non è ancora disponibile. Riprova più tardi."
      : !abbonamentoUtilizzabile
        ? "Con l'abbonamento non attivo non si può creare l'accesso: riattivalo dalla pagina Abbonamento."
        : null;

  return (
    <div className="omnia-app-shell">
      {intestazione}

      <section className="omnia-riquadro">
        <div className="omnia-campo-griglia" style={{ marginTop: 0 }}>
          <div>
            <span className="omnia-eyebrow">L&apos;Ufficio Gare può</span>
            <ul style={{ marginTop: 12, paddingLeft: 18, lineHeight: 1.8, fontSize: 14 }}>
              {PUO.map((voce) => (
                <li key={voce}>{voce}</li>
              ))}
            </ul>
          </div>
          <div>
            <span className="omnia-eyebrow">Non può</span>
            <ul style={{ marginTop: 12, paddingLeft: 18, lineHeight: 1.8, fontSize: 14 }}>
              {NON_PUO.map((voce) => (
                <li key={voce}>{voce}</li>
              ))}
            </ul>
          </div>
        </div>
        <p className="omnia-riquadro-nota" style={{ marginTop: 16 }}>
          Le gare e le relazioni sono dell&apos;azienda e consumano le gare e i crediti del tuo abbonamento. Quando finiscono, l&apos;Ufficio Gare vede un promemoria per te e tu ricevi un&apos;email.
        </p>
      </section>

      {lettura.esito === "errore" ? (
        <p className="omnia-messaggio-stato errore">Non riesco a leggere l&apos;Ufficio Gare in questo momento. Riprova tra qualche istante.</p>
      ) : (
        <UfficioGareGestione
          ufficio={
            lettura.esito === "presente"
              ? {
                  email: lettura.ufficio.email,
                  stato: lettura.ufficio.stato,
                  creatoIl: lettura.ufficio.creatoIl,
                  invitoInviatoIl: lettura.ufficio.invitoInviatoIl,
                  ultimoAccesso: lettura.ufficio.ultimoAccesso,
                }
              : null
          }
          puoCreare={lettura.esito === "assente" && abbonamentoUtilizzabile}
          motivoBlocco={motivoBlocco}
        />
      )}
    </div>
  );
}
