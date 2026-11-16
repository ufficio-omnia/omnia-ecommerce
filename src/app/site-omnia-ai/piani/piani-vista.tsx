import Link from "next/link";
import PageShell from "@/components/omnia-ai/page-shell";
import { PIANI_ORDINE, formatEuro, formatEuroCifra } from "@/lib/omnia-ai-plans";
import { testoOfferta, type Catalogo as CatalogoTipo } from "@/lib/omnia-ai-catalogo-calcoli";
import RevisioneBanda from "./revisione-banda";
import ServiziPerCategoria from "./servizi-per-categoria";

// La pagina dei piani, senza accesso ai dati: la pagina (page.tsx) legge catalogo, condizioni e se la
// vendita è visibile, e li passa qui. Separata per poterla mostrare con la vendita accesa in anteprima.
// `prezzoSingolaGaraCentesimi`: il prezzo del piano di lavoro di una singola gara (letto dalla console), mostrato nella sezione «cosa puoi elaborare
// in una gara oltre alla relazione tecnica». Il piano di lavoro NON si acquista con l'abbonamento (decisione del 09/11/2026): sulle schede dei piani non
// c'è più nessuna opzione né prezzo aggiuntivo, e la sezione dei servizi non ha nessun «Abbonati».
// Come funzionano gare e crediti, in quattro punti: stesse regole dell'art. 5 delle Condizioni di abbonamento (quando si consuma una gara,
// cosa è compreso, gare non cumulabili, crediti aggiuntivi validi fino alla cessazione). Nessun prezzo: i prezzi sono solo sulle schede.
const REGOLE_GARE = [
  {
    titolo: "Quando si consuma una gara",
    testo: "Quando avvii l'analisi dei documenti caricati. Creare una gara senza avviare l'analisi non consuma nulla.",
  },
  {
    titolo: "Cosa è compreso",
    testo: "Da quel momento generazioni, revisioni e rielaborazioni della stessa gara sono comprese, senza altri consumi.",
  },
  {
    titolo: "Gare non usate e crediti",
    testo: "Le gare incluse valgono per il periodo e non si cumulano. Se non bastano acquisti crediti aggiuntivi: si usano dopo le gare incluse e restano validi finché l'abbonamento è attivo.",
  },
  {
    titolo: "Cosa si paga a parte",
    testo: "I servizi aggiuntivi della singola gara, quando non sono compresi nel piano, e la revisione umana dei consulenti: li trovi descritti qui sotto.",
  },
];

export default function PianiVista({
  catalogo,
  condizioniUrl,
  vendita,
  prezzoSingolaGaraCentesimi,
}: {
  catalogo: CatalogoTipo;
  condizioniUrl: string;
  vendita: boolean;
  prezzoSingolaGaraCentesimi: number;
}) {
  return (
    <PageShell>
      <section className="omnia-pagina-hero">
        <p className="omnia-occhiello omnia-occhiello-centro">Piani e prezzi</p>
        <h1>OMNIA AI: un piano per ogni ritmo di partecipazione a gara</h1>
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
                {/* i servizi extra della gara, in evidenza (acquistabili con Starter, compresi con Professional) e la nota con l'asterisco */}
                {p.servizi && (
                  <div className="omnia-prezzo-servizi">
                    <b>{p.servizi.titolo}</b>
                    <p>{p.servizi.intro}</p>
                    <ul>
                      {p.servizi.punti.map((punto) => (
                        <li key={punto}>{punto}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {p.nota && <p className="omnia-prezzo-nota">{p.nota}</p>}
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

        <section className="omnia-regole-gare" aria-labelledby="omnia-regole-titolo">
          <h2 id="omnia-regole-titolo">Come funzionano gare e crediti</h2>
          <ul className="omnia-regole-elenco">
            {REGOLE_GARE.map((r) => (
              <li key={r.titolo}>
                <h3>{r.titolo}</h3>
                <p>{r.testo}</p>
              </li>
            ))}
          </ul>
        </section>

        {/* Cosa si può elaborare dentro una gara oltre alla relazione tecnica, per categoria: solo dentro la singola gara, mai con l'abbonamento. */}
        <ServiziPerCategoria prezzoSingolaGara={formatEuro(prezzoSingolaGaraCentesimi)} />

        <RevisioneBanda />

        <p className="micro" style={{ marginTop: 32 }}>
          Le gare incluse si azzerano ad ogni rinnovo e non si cumulano. Se non bastano, puoi
          acquistare crediti aggiuntivi in qualsiasi momento: non hanno scadenza mensile e restano
          validi fino all&apos;utilizzo, finché l&apos;abbonamento è attivo.
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
