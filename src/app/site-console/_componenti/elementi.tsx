import type { ReactNode } from "react";
import type { StatoScadenzaBonifico } from "@/lib/console/giorni-lavorativi";

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

// Stato del termine di un bonifico: quanto manca ai sette giorni lavorativi.
export function BadgeScadenza({ stato, giorniRimasti }: { stato: StatoScadenzaBonifico; giorniRimasti: number }) {
  if (stato === "scaduto") {
    return <Badge tono="errore">{giorniRimasti < 0 ? `scaduto da ${-giorniRimasti} gg lav.` : "scaduto"}</Badge>;
  }
  if (giorniRimasti === 0) return <Badge tono="avviso">scade oggi</Badge>;
  return <Badge tono={stato === "in_scadenza" ? "avviso" : "neutro"}>tra {giorniRimasti} gg lav.</Badge>;
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
