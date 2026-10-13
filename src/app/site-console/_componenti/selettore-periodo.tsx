import Link from "next/link";
import { PRESET_PERIODO, type Periodo } from "@/lib/console/periodo";

// Parametri d'URL che descrivono un periodo: servono a ogni link della pagina
// (ordinamento, dettaglio) per non perdere il periodo scelto.
export function parametriPeriodo(periodo: Periodo): Record<string, string> {
  return periodo.preset === "personalizzato" ? { p: "personalizzato", dal: periodo.da, al: periodo.a } : { p: periodo.preset };
}

export function urlConParametri(percorso: string, parametri: Record<string, string | undefined>): string {
  const q = new URLSearchParams();
  for (const [chiave, valore] of Object.entries(parametri)) if (valore) q.set(chiave, valore);
  const testo = q.toString();
  return testo ? `${percorso}?${testo}` : percorso;
}

// Scelta del periodo, senza JavaScript: i preset sono link, il periodo
// personalizzato è un modulo GET. `extra` porta con sé gli altri parametri
// della pagina (es. l'ordinamento).
export default function SelettorePeriodo({
  percorso,
  periodo,
  extra = {},
}: {
  percorso: string;
  periodo: Periodo;
  extra?: Record<string, string | undefined>;
}) {
  return (
    <div className="cn-periodo">
      <nav className="cn-filtri" aria-label="Periodo">
        {PRESET_PERIODO.map((p) => (
          <Link key={p.valore} href={urlConParametri(percorso, { ...extra, p: p.valore })} className={periodo.preset === p.valore ? "attivo" : undefined}>
            {p.etichetta}
          </Link>
        ))}
      </nav>
      <form action={percorso} method="get" className="cn-ricerca">
        <input type="hidden" name="p" value="personalizzato" />
        {Object.entries(extra).map(([chiave, valore]) => (valore ? <input key={chiave} type="hidden" name={chiave} value={valore} /> : null))}
        <input className="cn-input" type="date" name="dal" defaultValue={periodo.da} required aria-label="Dal" />
        <input className="cn-input" type="date" name="al" defaultValue={periodo.a} required aria-label="Al" />
        <button type="submit" className={`cn-btn${periodo.preset === "personalizzato" ? " primario" : ""}`}>
          Applica
        </button>
      </form>
    </div>
  );
}
