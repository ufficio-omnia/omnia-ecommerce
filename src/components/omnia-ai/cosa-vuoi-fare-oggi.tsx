import Link from "next/link";

const SCORCIATOIE = [
  { href: "/dashboard/omnia-ai/gare", label: "Nuova gara" },
  { href: "/dashboard/omnia-ai/documenti-aziendali", label: "Documenti aziendali" },
  { href: "/dashboard/omnia-ai/profilo-azienda", label: "Profilo azienda" },
  { href: "/dashboard/omnia-ai/abbonamento", label: "Abbonamento" },
];

// Occupa da sola la riga a due schede: quella per la revisione umana
// resta fuori finché la funzione non esiste, non un placeholder vuoto.
export default function CosaVuoiFareOggi() {
  return (
    <section className="omnia-riquadro">
      <span className="omnia-eyebrow">Cosa vuoi fare oggi</span>
      <div className="omnia-scorciatoie">
        {SCORCIATOIE.map((s) => (
          <Link key={s.href} href={s.href} className="omnia-scorciatoia">
            {s.label}
          </Link>
        ))}
      </div>
    </section>
  );
}
