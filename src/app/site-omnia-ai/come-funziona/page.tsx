import type { Metadata } from "next";
import PageShell from "@/components/omnia-ai/page-shell";
import ComeFunzionaDemo from "@/components/omnia-ai/come-funziona-demo";

export const metadata: Metadata = {
  title: "Come funziona — OMNIA AI",
  description:
    "Come OMNIA AI legge bando, disciplinare e capitolato, recupera i frammenti pertinenti e scrive la relazione tecnica citando la fonte esatta.",
};

const PASSI = [
  {
    titolo: "Carichi i documenti di gara",
    testo: "Bando, disciplinare, capitolato e allegati, in PDF o Word — gli stessi file che scaricheresti dalla piattaforma di e-procurement.",
  },
  {
    titolo: "OMNIA AI li indicizza in frammenti",
    testo: "Non l'intero documento come blocco unico, ma passaggi brevi e precisi — articoli, paragrafi, righe di tabella — ciascuno con la propria fonte tracciata.",
  },
  {
    titolo: "Recupera solo i frammenti pertinenti",
    testo: "Per ogni criterio della relazione tecnica, cerca i passaggi del bando che contano davvero per quel punteggio — non l'intero documento riletto da capo ogni volta.",
  },
  {
    titolo: "Scrive citando la fonte esatta",
    testo: "Ogni affermazione nella bozza generata è ancorata al frammento da cui viene: articolo, paragrafo, tabella. Mai un'affermazione senza riferimento verificabile.",
  },
];

export default function ComeFunzionaPage() {
  return (
    <PageShell>
      <section className="omnia-pagina-hero">
        <h1>Non indovina. Recupera, e cita la fonte.</h1>
        <p className="omnia-sotto" style={{ margin: "24px auto 0" }}>
          La differenza tra un&apos;AI generica e OMNIA AI non è il modello linguistico: è cosa
          succede tra la tua domanda e la risposta. Ecco il percorso, passo per passo.
        </p>
      </section>

      <section className="omnia-pagina-corpo">
        <ol className="omnia-passi">
          {PASSI.map((p) => (
            <li key={p.titolo} className="omnia-passo">
              <div>
                <b>{p.titolo}</b>
                <p>{p.testo}</p>
              </div>
            </li>
          ))}
        </ol>

        <h2>Un esempio, dal vivo</h2>
        <p className="omnia-guida">
          Una domanda reale, i frammenti che OMNIA AI recupera dal bando per rispondere, e la
          risposta finale — con le stesse fonti citate.
        </p>
        <div style={{ maxWidth: 640, margin: "32px auto 0" }}>
          <ComeFunzionaDemo />
        </div>
      </section>
    </PageShell>
  );
}
