import type { ReactNode } from "react";

// Mattoni della console: tessera (numero grande + dettaglio), badge di stato,
// pannello con titolo. Solo markup e classi .cn-*: nessuno stato, usabili da
// Server Component.

export type Tono = "neutro" | "ok" | "avviso" | "errore" | "accento";

export function Tessera({
  etichetta,
  valore,
  unita,
  dettaglio,
  tono = "neutro",
}: {
  etichetta: string;
  valore: ReactNode;
  unita?: string;
  dettaglio?: ReactNode;
  tono?: Tono;
}) {
  return (
    <div className={`cn-tessera${tono !== "neutro" && tono !== "accento" ? ` ${tono}` : ""}`}>
      <span className="cn-tessera-etichetta">{etichetta}</span>
      <span className="cn-tessera-valore">
        {valore}
        {unita && <small> {unita}</small>}
      </span>
      {dettaglio && <span className="cn-tessera-dettaglio">{dettaglio}</span>}
    </div>
  );
}

export function Badge({ tono = "neutro", children }: { tono?: Tono; children: ReactNode }) {
  return <span className={`cn-badge${tono === "neutro" ? "" : ` ${tono}`}`}>{children}</span>;
}

export function Pannello({
  titolo,
  azioni,
  children,
}: {
  titolo: string;
  azioni?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="cn-pannello">
      <div className="cn-pannello-testa">
        <h2>{titolo}</h2>
        {azioni}
      </div>
      {children}
    </section>
  );
}
