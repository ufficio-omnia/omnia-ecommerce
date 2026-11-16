import Link from "next/link";
import { RADICE_OPPORTUNITA } from "@/lib/radar/area-cliente";
import { ETICHETTA_STATO, statoMostrato, type StatoProcedura } from "@/lib/radar/importa-calcoli";
import { contoAllaRovescia, giorno, importoBreve, regioniLeggibili, scadenzaBreve, settoriLeggibili } from "./formato";

export type DatiRigaGara = {
  href: string;
  titolo: string;
  ente: string | null;
  comune: string | null;
  provincia: string | null;
  regioni: string[];
  scadenza: string | null;
  scadenzaOraIndicata: boolean;
  valore: number | null;
  tipoValore: string;
  durataMesi: number | null;
  nLotti: number | null;
  settori: string[];
  tipoProcedura: string | null;
  stato: StatoProcedura;
  rettificata: boolean;
  motivi: string[];
  fonte: string;
  verificataIl: string | null;
  salvata: boolean;
  monitorata: boolean;
  novita?: string | null;
};

// La riga di una gara negli elenchi (Cerca, Salvate e monitorate): le quattro informazioni chiave (cosa, chi, quanto, entro quando),
// poi pertinenza e requisiti separati, fonte e data di verifica. Si apre la scheda con un clic.
export default function RigaGara({ d, adesso }: { d: DatiRigaGara; adesso: Date }) {
  const stato = statoMostrato(d.stato, d.scadenza, adesso);
  const conto = stato === "aperta" ? contoAllaRovescia(d.scadenza, adesso) : null;
  const valore = importoBreve(d.valore);
  const dove = [d.comune ? `${d.comune}${d.provincia ? ` (${d.provincia})` : ""}` : null, d.regioni.length ? regioniLeggibili(d.regioni) : null].filter(Boolean).join(" · ");
  return (
    <Link href={d.href} className="omnia-opp-riga">
      <div className="omnia-opp-riga-testa">
        <div className="omnia-opp-riga-titolo">{d.titolo}</div>
        <div className={`omnia-opp-riga-scadenza${conto?.urgente ? " urgente" : ""}`}>
          {conto && <strong>{conto.testo}</strong>}
          <span>{scadenzaBreve(d.scadenza, d.scadenzaOraIndicata)}</span>
        </div>
      </div>
      <div className="omnia-opp-riga-ente">
        {d.ente ?? "Ente non indicato"}
        {dove && <span> · {dove}</span>}
      </div>
      <div className="omnia-opp-riga-dati">
        <span>{valore ? `${d.tipoValore} ${valore}` : `${d.tipoValore}: non indicato`}</span>
        {d.durataMesi && <span>{d.durataMesi} mesi</span>}
        {d.nLotti && d.nLotti > 1 && <span>{d.nLotti} lotti</span>}
        {d.settori.length > 0 && <span>{settoriLeggibili(d.settori)}</span>}
        {d.tipoProcedura && <span>{d.tipoProcedura}</span>}
      </div>
      {d.novita && <div className="omnia-opp-riga-novita">{d.novita}</div>}
      <div className="omnia-opp-riga-indicatori">
        {d.motivi.length > 0 && (
          <span className="omnia-opp-indicatore">
            <span aria-hidden>●</span> Perché compare: {d.motivi.join(" · ")}
          </span>
        )}
        <span className="omnia-opp-indicatore fioco">
          <span aria-hidden>○</span> Requisiti: non ancora analizzati
        </span>
      </div>
      <div className="omnia-opp-riga-piede">
        <span className="omnia-opp-badge-gruppo">
          {stato !== "aperta" && <span className={`omnia-badge ${stato === "annullata" || stato === "chiusa_senza_aggiudicazione" ? "rosso" : "ambra"}`}>{ETICHETTA_STATO[stato]}</span>}
          {d.rettificata && <span className="omnia-badge ambra">Rettificata</span>}
          {d.monitorata ? <span className="omnia-badge verde">Monitorata</span> : d.salvata ? <span className="omnia-badge verde">Salvata</span> : null}
        </span>
        <span className="omnia-opp-fonte">
          {d.fonte}
          {d.verificataIl ? ` · verificata il ${giorno(d.verificataIl)}` : ""}
        </span>
      </div>
    </Link>
  );
}

export function hrefGara(id: string): string {
  return `${RADICE_OPPORTUNITA}/gara/${id}`;
}
