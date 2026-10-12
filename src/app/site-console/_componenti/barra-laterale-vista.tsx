import Link from "next/link";
import { NAVIGAZIONE } from "./navigazione";

// Vista pura della barra laterale: nessun hook, nessun accesso alla richiesta.
// Il pathname lo passa il wrapper client (barra-laterale.tsx); l'azione di
// uscita arriva come prop, così la vista si può anche renderizzare fuori da
// Next (anteprima statica dei componenti, senza sessione).
// Cose che aspettano un'azione dell'admin, mostrate accanto alla voce da qualunque pagina.
// daFatturare: incassi veri non ancora fatturati (assente se la migrazione 0079 non c'è).
export type ConteggiBarra = { bonifici: number; bonificiScaduti: number; daFatturare?: number };

export default function BarraLateraleVista({
  email,
  percorso,
  conteggi,
  azioneEsci,
}: {
  email: string;
  percorso: string;
  // numero di bonifici da confermare, mostrato accanto alla voce da qualunque pagina
  conteggi?: ConteggiBarra;
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
                  {voce.href === "/fatturazione" && conteggi && (conteggi.daFatturare ?? 0) > 0 && (
                    <span className="cn-conta avviso" title={`${conteggi.daFatturare} da fatturare`}>
                      {conteggi.daFatturare}
                    </span>
                  )}
                  {voce.href === "/bonifici" && conteggi && conteggi.bonifici > 0 && (
                    <span
                      className={`cn-conta ${conteggi.bonificiScaduti > 0 ? "errore" : "avviso"}`}
                      title={
                        conteggi.bonificiScaduti > 0
                          ? `${conteggi.bonifici} da confermare, ${conteggi.bonificiScaduti} oltre il termine`
                          : `${conteggi.bonifici} da confermare`
                      }
                    >
                      {conteggi.bonifici}
                    </span>
                  )}
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
