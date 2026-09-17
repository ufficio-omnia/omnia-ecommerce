import Link from "next/link";
import GaraRiga, { type GaraRigaProps } from "./gara-riga";

const LIMITE = 6;

export default function GareRecentiList({ gare }: { gare: GaraRigaProps[] }) {
  return (
    <section className="omnia-riquadro">
      <span className="omnia-eyebrow">Gare</span>

      {gare.length === 0 ? (
        <p className="omnia-elenco-vuoto" style={{ marginTop: 12 }}>
          Nessuna gara ancora. Crea la prima da &quot;Nuova gara&quot;.
        </p>
      ) : (
        <div className="omnia-gare-elenco" style={{ marginTop: 16 }}>
          {gare.slice(0, LIMITE).map((g) => (
            <GaraRiga key={g.id} {...g} />
          ))}
        </div>
      )}

      {gare.length > LIMITE && (
        <p className="omnia-riquadro-nota" style={{ marginTop: 14 }}>
          <Link href="/dashboard/omnia-ai/gare">Vedi tutte le {gare.length} gare →</Link>
        </p>
      )}
    </section>
  );
}
