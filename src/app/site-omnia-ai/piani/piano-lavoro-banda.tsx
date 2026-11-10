import Link from "next/link";
import { formatEuro, type PianoSlug } from "@/lib/omnia-ai-plans";
import { BANDA_PIANO_LAVORO, ETICHETTA_LINK_CONDIZIONI, PERCORSO_CONDIZIONI_PIANO_LAVORO } from "@/lib/piano-lavoro-testi";

// NON PIÙ USATA nella pagina dei piani dal 09/11/2026: il piano di lavoro ora si presenta nella sezione «cosa puoi elaborare in una gara oltre alla
// relazione tecnica» (servizi-per-categoria.tsx), dove compare solo scegliendo la categoria «Servizi di pulizia», senza l'opzione nell'abbonamento.
// Il file resta per non perdere il lavoro fatto (si può rimettere in pagina con una riga).
//
// Fascia della pagina dei piani che presenta il piano di lavoro (l'Excel con formule attive, per gara). Compare solo quando il piano di lavoro è
// in vendita (la pagina passa i prezzi solo allora): il sito non annuncia ciò che non si può comprare. I prezzi vengono dalle stesse letture
// che il checkout usa, non scritti a mano. Nessuna promessa sull'esito della gara; il testo dice che è un dimensionamento di partenza.
export default function PianoLavoroBanda({ prezzoSingolaGaraCentesimi, surplus }: { prezzoSingolaGaraCentesimi: number; surplus: Record<PianoSlug, number> }) {
  const p = BANDA_PIANO_LAVORO.punti;
  return (
    <section className="omnia-revisione" aria-labelledby="omnia-piano-lavoro-titolo">
      <p className="omnia-revisione-etichetta">{BANDA_PIANO_LAVORO.etichetta}</p>
      <h2 id="omnia-piano-lavoro-titolo">{BANDA_PIANO_LAVORO.titolo}</h2>
      <p className="omnia-revisione-testo">{BANDA_PIANO_LAVORO.testo}</p>
      <ul className="omnia-revisione-punti">
        <li>
          <b>{p.singola.titolo}</b>
          <span>{p.singola.dettaglio(formatEuro(prezzoSingolaGaraCentesimi))}</span>
        </li>
        <li>
          <b>{p.abbonamento.titolo}</b>
          <span>{p.abbonamento.dettaglio(formatEuro(surplus.starter))}</span>
        </li>
        <li>
          <b>{p.formule.titolo}</b>
          <span>{p.formule.dettaglio}</span>
        </li>
      </ul>
      <p className="omnia-revisione-nota">
        {BANDA_PIANO_LAVORO.nota}{" "}
        <Link href={PERCORSO_CONDIZIONI_PIANO_LAVORO} style={{ color: "inherit", textDecoration: "underline" }}>
          {ETICHETTA_LINK_CONDIZIONI}
        </Link>
        .
      </p>
    </section>
  );
}
