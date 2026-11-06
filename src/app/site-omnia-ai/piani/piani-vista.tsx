import Link from "next/link";
import PageShell from "@/components/omnia-ai/page-shell";
import { PIANI_ORDINE, formatEuroCifra, type PianoSlug } from "@/lib/omnia-ai-plans";
import { testoOfferta, type Catalogo as CatalogoTipo } from "@/lib/omnia-ai-catalogo-calcoli";
import RevisioneBanda from "./revisione-banda";
import PianoLavoroBanda from "./piano-lavoro-banda";
import { partiRigaPianoLavoroPerPiano } from "@/lib/piano-lavoro-testi";

// La pagina dei piani, senza accesso ai dati: la pagina (page.tsx) legge catalogo, condizioni e se la
// vendita è visibile, e li passa qui. Separata per poterla mostrare con la vendita accesa in anteprima.
// `surplusPianoLavoro`: il supplemento mensile del piano di lavoro per ogni piano; `prezzoSingolaGaraCentesimi`: il prezzo del piano di lavoro di una
// singola gara. Si mostrano SEMPRE, come i prezzi dei piani (il pulsante «Abbonati», invece, solo con la vendita accesa): li legge la pagina dalla console.
export default function PianiVista({
  catalogo,
  condizioniUrl,
  vendita,
  surplusPianoLavoro,
  prezzoSingolaGaraCentesimi,
}: {
  catalogo: CatalogoTipo;
  condizioniUrl: string;
  vendita: boolean;
  surplusPianoLavoro: Record<PianoSlug, number>;
  prezzoSingolaGaraCentesimi: number;
}) {
  return (
    <PageShell>
      <section className="omnia-pagina-hero">
        <h1>OMNIA AI: un piano per ogni ritmo di partecipazione a gara.</h1>
        <p className="omnia-sotto" style={{ margin: "24px auto 0" }}>
          Abbonamento mensile con un numero di gare incluso. Una gara si consuma quando parte
          l&apos;analisi dei documenti: da lì in poi generazioni e revisioni sulla stessa gara
          sono comprese.
        </p>
      </section>

      <section className="omnia-pagina-corpo">
        <div className="omnia-prezzi">
          {PIANI_ORDINE.map((slug) => {
            // prezzi e sconti dal catalogo (modificabili dalla console), mai dalla costante del codice
            const p = catalogo[slug];
            const opzione = partiRigaPianoLavoroPerPiano(formatEuroCifra(surplusPianoLavoro[slug]));
            return (
              <div key={p.slug} className={`omnia-prezzo${p.inEvidenza ? " in-evidenza" : ""}`}>
                <b>{p.nome}</b>
                <div className="omnia-prezzo-cifra">
                  {p.sconto && <span className="omnia-prezzo-prima">{formatEuroCifra(p.prezzoListinoCentesimi)} €</span>}
                  <span className="omnia-prezzo-valore">
                    {formatEuroCifra(p.prezzoCentesimi)}
                    <span className="omnia-prezzo-simbolo">€</span>
                  </span>
                  <span className="omnia-prezzo-periodo">al mese · IVA inclusa</span>
                </div>
                {p.sconto && <p className="omnia-prezzo-offerta">{testoOfferta(p.sconto, p.prezzoListinoCentesimi)}</p>}
                <p style={{ marginTop: 10, fontSize: 14, color: "var(--fioco)", fontWeight: 300, textAlign: "left" }}>
                  {p.descrizione}
                </p>
                <ul className="omnia-prezzo-elenco">
                  {p.voci.map((v) => (
                    <li key={v}>{v}</li>
                  ))}
                </ul>
                {/* Il piano di lavoro, sotto ogni piano: possibilità e prezzo che si aggiunge. */}
                <div className="omnia-prezzo-opzione">
                  <p>
                    <strong>{opzione.evidenza}</strong> {opzione.seguito}
                  </p>
                </div>
                {/* «Abbonati» (verso /abbonati/[piano], pagamento diretto) compare solo con la vendita accesa
                    in console E la chiave Stripe reale (vedi lib/omnia-ai-vendita.ts): nessun visitatore deve
                    arrivare a un pagamento che non può davvero completare. */}
                {vendita && (
                  <Link className="omnia-btn omnia-btn-p" href={`/abbonati/${p.slug}`}>
                    Abbonati
                  </Link>
                )}
                <Link
                  className={`omnia-btn ${!vendita && p.inEvidenza ? "omnia-btn-p" : "omnia-btn-s"}`}
                  href="/demo"
                  style={vendita ? { marginTop: 10 } : undefined}
                >
                  Richiedi la demo
                </Link>
              </div>
            );
          })}
        </div>

        <RevisioneBanda />

        <PianoLavoroBanda prezzoSingolaGaraCentesimi={prezzoSingolaGaraCentesimi} surplus={surplusPianoLavoro} />

        <p className="micro" style={{ marginTop: 32 }}>
          Le gare incluse si azzerano ad ogni rinnovo e non si cumulano. Se non bastano, puoi
          acquistare crediti aggiuntivi in qualsiasi momento: restano validi fino
          all&apos;utilizzo, senza scadenza mensile.
        </p>
        <p className="micro" style={{ marginTop: 8 }}>
          Iscrivendoti accetti le{" "}
          <Link href={condizioniUrl} style={{ color: "inherit", textDecoration: "underline" }}>
            Condizioni di abbonamento
          </Link>
          .
        </p>
        <p className="micro" style={{ marginTop: 8 }}>
          Come trattiamo i documenti di gara che ci affidi:{" "}
          <Link href="/riservatezza" style={{ color: "inherit", textDecoration: "underline" }}>
            Riservatezza e trattamento dei dati
          </Link>
          .
        </p>
        {/* Programma «Climate Commitments» dell'account Stripe di OMNIA AI (il badge è nel piè di pagina). La frase
            dice solo ciò che dice Stripe: se il programma si disattiva o cambia la percentuale, va aggiornata. */}
        <p className="micro" style={{ marginTop: 8 }}>
          Omnia Consulting destina l&apos;1% di ogni abbonamento a Stripe Climate, per ridurre la CO₂ nell&apos;atmosfera.
        </p>
      </section>
    </PageShell>
  );

}
