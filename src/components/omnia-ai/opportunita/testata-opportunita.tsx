import Link from "next/link";
import { RADICE_OPPORTUNITA } from "@/lib/radar/area-cliente";

// Testata comune delle pagine «Opportunità»: titolo, schede in alto (Cerca, Monitorate) e «Aggiungi a mano». «Per te» arriva in B2.
export default function TestataOpportunita({ attiva, sottotitolo }: { attiva: "cerca" | "monitorate" | "aggiungi" | null; sottotitolo?: string }) {
  const schede = [
    { id: "cerca", href: `${RADICE_OPPORTUNITA}/cerca`, etichetta: "Cerca" },
    { id: "monitorate", href: `${RADICE_OPPORTUNITA}/monitorate`, etichetta: "Salvate e monitorate" },
  ] as const;
  return (
    <div className="omnia-opp-testata">
      <div className="omnia-opp-titolo-riga">
        <div>
          <h1 className="omnia-app-titolo">Opportunità</h1>
          {sottotitolo && <p className="omnia-app-sottotitolo">{sottotitolo}</p>}
        </div>
        {/* prefetch={false}: menu dell'area riservata, vedi sidebar-nav.tsx */}
        <Link href={`${RADICE_OPPORTUNITA}/aggiungi`} prefetch={false} className={`omnia-btn omnia-btn-s omnia-btn-piccolo${attiva === "aggiungi" ? " attivo" : ""}`}>
          + Aggiungi a mano
        </Link>
      </div>
      <nav className="omnia-opp-schede" aria-label="Sezioni di Opportunità">
        {schede.map((s) => (
          <Link key={s.id} href={s.href} prefetch={false} className={`omnia-opp-scheda${attiva === s.id ? " attiva" : ""}`} aria-current={attiva === s.id ? "page" : undefined}>
            {s.etichetta}
          </Link>
        ))}
      </nav>
    </div>
  );
}
