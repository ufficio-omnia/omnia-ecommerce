import Link from "next/link";
import { NAVIGAZIONE } from "./navigazione";

// Vista pura della barra laterale: nessun hook, nessun accesso alla richiesta.
// Il pathname lo passa il wrapper client (barra-laterale.tsx); l'azione di
// uscita arriva come prop, così la vista si può anche renderizzare fuori da
// Next (anteprima statica dei componenti, senza sessione).
export default function BarraLateraleVista({
  email,
  percorso,
  azioneEsci,
}: {
  email: string;
  percorso: string;
  azioneEsci?: () => Promise<void>;
}) {
  return (
    <aside className="cn-barra">
      <div className="cn-marchio">
        OMNIA <small>console</small>
      </div>

      <nav className="cn-nav" aria-label="Sezioni della console">
        {NAVIGAZIONE.map((gruppo, i) => (
          <div key={gruppo.titolo ?? i}>
            {gruppo.titolo && <div className="cn-nav-titolo">{gruppo.titolo}</div>}
            {gruppo.voci.map((voce) => {
              const attiva =
                voce.href === "/" ? percorso === "/" : percorso === voce.href || percorso.startsWith(`${voce.href}/`);
              if (!voce.pronto) {
                return (
                  <span key={voce.href} className="cn-nav-voce presto" aria-disabled="true">
                    {voce.etichetta}
                    <em>presto</em>
                  </span>
                );
              }
              return (
                <Link
                  key={voce.href}
                  href={voce.href}
                  className={`cn-nav-voce${attiva ? " attiva" : ""}`}
                  aria-current={attiva ? "page" : undefined}
                >
                  {voce.etichetta}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="cn-utente">
        <div>
          Accesso come
          <strong title={email}>{email}</strong>
        </div>
        <form action={azioneEsci}>
          <button type="submit" className="cn-btn" style={{ width: "100%" }}>
            Esci
          </button>
        </form>
      </div>
    </aside>
  );
}
