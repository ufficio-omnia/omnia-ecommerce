import Link from "next/link";
import { RADICE_OPPORTUNITA } from "@/lib/radar/area-cliente";
import { perTeAttivo, preferenzeNotificheAttive } from "@/lib/radar/interruttori-b4";

// Testata comune delle pagine «Opportunità»: titolo, schede in alto e «Aggiungi a mano». Fase B4 (grado 1): con RADAR_PER_TE acceso la
// prima scheda è «Per te» e c'è anche «Profilo di ricerca»; grado 3: con RADAR_NOTIFICHE_PREFERENZE la scheda «Notifiche». Tutti i
// collegamenti con prefetch={false} (vedi sidebar-nav.tsx).
type Scheda = "per-te" | "cerca" | "monitorate" | "profilo" | "notifiche";

// Componente del server: l'interruttore si legge qui (nel browser non c'è, quindi resterebbe spento).
export default function TestataOpportunita({ attiva, sottotitolo }: { attiva: Scheda | "aggiungi" | null; sottotitolo?: string }) {
  const perTe = perTeAttivo(process.env);
  const notifiche = preferenzeNotificheAttive(process.env);
  const schede: { id: Scheda; href: string; etichetta: string }[] = [
    ...(perTe ? [{ id: "per-te" as const, href: `${RADICE_OPPORTUNITA}/per-te`, etichetta: "Per te" }] : []),
    { id: "cerca", href: `${RADICE_OPPORTUNITA}/cerca`, etichetta: "Cerca" },
    { id: "monitorate", href: `${RADICE_OPPORTUNITA}/monitorate`, etichetta: "Salvate e monitorate" },
    ...(perTe ? [{ id: "profilo" as const, href: `${RADICE_OPPORTUNITA}/profilo`, etichetta: "Profilo di ricerca" }] : []),
    ...(notifiche ? [{ id: "notifiche" as const, href: `${RADICE_OPPORTUNITA}/notifiche`, etichetta: "Notifiche" }] : []),
  ];
  return (
    <div className="omnia-opp-testata">
      <div className="omnia-opp-titolo-riga">
        <div>
          <h1 className="omnia-app-titolo">Opportunità</h1>
          {sottotitolo && <p className="omnia-app-sottotitolo">{sottotitolo}</p>}
        </div>
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
