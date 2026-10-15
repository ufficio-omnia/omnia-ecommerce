import Link from "next/link";

const SCORCIATOIE = [
  { href: "/dashboard/omnia-ai/gare", label: "Nuova gara" },
  { href: "/dashboard/omnia-ai/documenti-aziendali", label: "Documenti aziendali" },
  { href: "/dashboard/omnia-ai/profilo-azienda", label: "Profilo azienda" },
  { href: "/dashboard/omnia-ai/abbonamento", label: "Abbonamento" },
];

// L'Ufficio Gare ha solo le scorciatoie del suo lavoro (le altre portano a pagine amministrative a lui chiuse).
const SCORCIATOIE_UFFICIO_GARE = [
  { href: "/dashboard/omnia-ai/gare", label: "Nuova gara" },
  { href: "/dashboard/omnia-ai/assistenza", label: "Supporto" },
];

// Occupa da sola la riga a due schede: quella per la revisione umana
// resta fuori finché la funzione non esiste, non un placeholder vuoto.
export default function CosaVuoiFareOggi({ ufficioGare = false }: { ufficioGare?: boolean }) {
  const scorciatoie = ufficioGare ? SCORCIATOIE_UFFICIO_GARE : SCORCIATOIE;
  return (
    <section className="omnia-riquadro">
      <span className="omnia-eyebrow">Cosa vuoi fare oggi</span>
      <div className="omnia-scorciatoie">
        {scorciatoie.map((s) => (
          <Link key={s.href} href={s.href} className="omnia-scorciatoia">
            {s.label}
          </Link>
        ))}
      </div>
    </section>
  );
}
