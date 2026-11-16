import { descrizioneFonte } from "@/lib/radar/fonti/tipi";
import { giorno } from "./formato";

// Copertura, aggiornamento e limiti delle fonti attive, sempre visibili nelle schermate di ricerca (precisazione P3 del 16/11/2026).
export default function FontiRicerca({ tedAttiva, tedDatiAl, tedUltimoSuccesso }: { tedAttiva: boolean; tedDatiAl: string | null; tedUltimoSuccesso: string | null }) {
  const ted = descrizioneFonte("ted");
  const manuale = descrizioneFonte("manuale");
  return (
    <details className="omnia-opp-fonti">
      <summary>
        Da dove vengono le gare: {tedAttiva ? `${ted.nome}` : "nessuna fonte pubblica attiva"}
        {tedAttiva && tedUltimoSuccesso ? `, aggiornata il ${giorno(tedUltimoSuccesso)}` : ""}
      </summary>
      <div className="omnia-opp-fonti-corpo">
        {tedAttiva && (
          <div>
            <strong>{ted.nome}</strong>
            <p>
              {ted.copertura}. Aggiornamento: {ted.aggiornamento.toLowerCase()}
              {tedDatiAl ? `; avvisi letti fino al ${giorno(tedDatiAl)}` : ""}.
            </p>
            <p className="omnia-opp-nota">Limiti: {ted.limiti.join("; ")}.</p>
            <p className="omnia-opp-nota">Licenza: {ted.licenza}.</p>
          </div>
        )}
        <div>
          <strong>{manuale.nome}</strong>
          <p className="omnia-opp-nota">{manuale.limiti.join("; ")}. Le trovi in «Salvate e monitorate».</p>
        </div>
        <p className="omnia-opp-nota">
          Le gare sotto la soglia europea (la maggior parte di quelle dei tuoi settori) non sono ancora comprese: arriveranno con i dati ANAC. Nel frattempo puoi aggiungerle a mano con il CIG o il collegamento.
        </p>
      </div>
    </details>
  );
}
