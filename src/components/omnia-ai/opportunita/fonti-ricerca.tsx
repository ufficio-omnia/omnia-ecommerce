import { descrizioneFonte } from "@/lib/radar/fonti/tipi";
import { giorno } from "./formato";

export type StatoFontePubblica = { fonte: "ted" | "pvl" | "sintel" | "sardegnacat" | "sater" | "tuttogare" | "empulia" | "siaps"; attiva: boolean; datiAl: string | null; ultimoSuccesso: string | null };

// Regioni sotto soglia coperte da una piattaforma regionale attiva (decisione 9 del 16/11: mai dichiarare una copertura che non c'è).
const REGIONE_DELLA_PIATTAFORMA: Partial<Record<StatoFontePubblica["fonte"], string>> = { sintel: "Lombardia (gare su Sintel)", sardegnacat: "Sardegna (gare su SardegnaCAT)", sater: "Emilia-Romagna (gare su SATER)", tuttogare: "alcuni enti di Lazio, Puglia e Sicilia (sulle loro piattaforme)", empulia: "Puglia (gare su EmPULIA)", siaps: "Campania, sanità (gare su SIAPS)" };

// Copertura, aggiornamento e limiti delle fonti attive, sempre visibili nelle schermate di ricerca (precisazione P3 del 16/11/2026).
// Fase B1-bis: anche la PVL di ANAC, quando è accesa (solo staging). Una gara pubblicata su entrambe compare una volta sola.
export default function FontiRicerca({ fonti }: { fonti: readonly StatoFontePubblica[] }) {
  const attive = fonti.filter((f) => f.attiva);
  const manuale = descrizioneFonte("manuale");
  const ultimo = attive.map((f) => f.ultimoSuccesso).filter((d): d is string => !!d).sort()[0] ?? null;
  return (
    <details className="omnia-opp-fonti">
      <summary>
        Da dove vengono le gare: {attive.length ? attive.map((f) => descrizioneFonte(f.fonte).nome).join(" e ") : "nessuna fonte pubblica attiva"}
        {ultimo ? `, aggiornate il ${giorno(ultimo)}` : ""}
      </summary>
      <div className="omnia-opp-fonti-corpo">
        {attive.map((f) => {
          const d = descrizioneFonte(f.fonte);
          return (
            <div key={f.fonte}>
              <strong>{d.nome}</strong>
              <p>
                {d.copertura}. Aggiornamento: {d.aggiornamento.toLowerCase()}
                {f.datiAl ? `; avvisi letti fino al ${giorno(f.datiAl)}` : ""}.
              </p>
              <p className="omnia-opp-nota">Limiti: {d.limiti.join("; ")}.</p>
              <p className="omnia-opp-nota">Licenza: {d.licenza}.</p>
            </div>
          );
        })}
        {attive.length > 1 && <p className="omnia-opp-nota">Una gara pubblicata su più fonti compare una volta sola, con tutte le sue fonti.</p>}
        <div>
          <strong>{manuale.nome}</strong>
          <p className="omnia-opp-nota">{manuale.limiti.join("; ")}. Le trovi in «Salvate e monitorate».</p>
        </div>
        {!attive.some((f) => f.fonte === "pvl") && (
          <p className="omnia-opp-nota">
            {(() => {
              const regioni = attive.map((f) => REGIONE_DELLA_PIATTAFORMA[f.fonte]).filter((r): r is string => !!r);
              return regioni.length > 0
                ? `Le gare sotto la soglia europea sono comprese solo per: ${regioni.join(", ")}. Quelle delle altre regioni non sono ancora comprese.`
                : "Le gare sotto la soglia europea (la maggior parte di quelle dei tuoi settori) non sono ancora comprese.";
            })()}{" "}
            Nel frattempo puoi aggiungerle a mano con il CIG o il collegamento.
          </p>
        )}
      </div>
    </details>
  );
}
