import type { Metadata } from "next";
import Link from "next/link";
import PageShell from "@/components/omnia-ai/page-shell";
import { SITO_COME_FUNZIONA_PIANO_LAVORO } from "@/lib/piano-lavoro-testi";
import ComeFunzionaDemo from "@/components/omnia-ai/come-funziona-demo";
import SchermataPiattaforma from "@/components/omnia-ai/schermata-piattaforma";
import { paginaMetadata } from "@/lib/omnia-ai-seo";

export const metadata: Metadata = paginaMetadata({
  title: "Come funziona — OMNIA AI",
  description:
    "Come OMNIA AI analizza bando, disciplinare e capitolato e scrive l'offerta tecnica in Word citando la fonte: i vantaggi e il percorso, passo per passo.",
  path: "/come-funziona",
});

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

// Prima i vantaggi pratici, poi i dettagli tecnici (restyling 16/11/2026). Nessuna promessa di conformità o di aggiudicazione.
const VANTAGGI = [
  {
    titolo: "Meno ore su stesura e impaginazione",
    testo: "Il documento esce già strutturato e impaginato in Word: il tuo tempo va sui contenuti che solo tu conosci e sulla verifica finale.",
  },
  {
    titolo: "Un'offerta costruita sui punteggi",
    testo: "Lo spazio di ogni criterio segue il suo peso e il limite di pagine della gara: niente sezioni gonfie e criteri pesanti trattati in tre righe.",
  },
  {
    titolo: "Riferimenti che puoi verificare",
    testo: "Le affermazioni della bozza sono ancorate ai passaggi del bando da cui vengono, così il controllo prima della consegna è più rapido.",
  },
];

export default function ComeFunzionaPage() {
  return (
    <PageShell>
      <section className="omnia-pagina-hero">
        <p className="omnia-occhiello omnia-occhiello-centro">Come funziona</p>
        <h1>OMNIA AI non indovina. Recupera, e cita la fonte</h1>
        <p className="omnia-sotto" style={{ margin: "24px auto 0" }}>
          La differenza tra un&apos;AI generica e OMNIA AI non è il modello linguistico: è cosa
          succede tra la tua domanda e la risposta. Ecco il percorso, passo per passo.
        </p>
      </section>

      <section className="omnia-pagina-corpo">
        <h2>Cosa cambia nel tuo lavoro</h2>
        <ul className="omnia-tre">
          {VANTAGGI.map((v) => (
            <li key={v.titolo} className="omnia-cella">
              <h3>{v.titolo}</h3>
              <p>{v.testo}</p>
            </li>
          ))}
        </ul>

        <h2>Il percorso, passo per passo</h2>
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

        <div className="omnia-schermata-singola">
          <SchermataPiattaforma
            schermata="datiGara"
            titolo="Il risultato dell'analisi, in una schermata"
            testo="Schermata reale di una gara in OMNIA AI, con nomi, ente e importi sostituiti da dati di esempio: scadenza, formattazione richiesta, limite di pagine, criteri con i punteggi e requisiti chiave, ricavati dai documenti caricati."
          />
        </div>

        <h2>Un esempio, dal vivo</h2>
        <p className="omnia-guida">
          Una domanda reale, i frammenti che OMNIA AI recupera dal bando per rispondere, e la
          risposta finale — con le stesse fonti citate.
        </p>
        <div style={{ maxWidth: 640, margin: "32px auto 0" }}>
          <ComeFunzionaDemo />
        </div>

        <h2 id="piano-di-lavoro">{SITO_COME_FUNZIONA_PIANO_LAVORO.titolo}</h2>
        <p className="omnia-guida">{SITO_COME_FUNZIONA_PIANO_LAVORO.guida}</p>
        <ol className="omnia-passi">
          {SITO_COME_FUNZIONA_PIANO_LAVORO.passi.map((p) => (
            <li key={p.titolo} className="omnia-passo">
              <div>
                <b>{p.titolo}</b>
                <p>{p.testo}</p>
              </div>
            </li>
          ))}
        </ol>
        <p className="micro" style={{ marginTop: 24 }}>
          {SITO_COME_FUNZIONA_PIANO_LAVORO.nota}{" "}
          <Link href="/piani" style={{ color: "inherit", textDecoration: "underline" }}>
            {SITO_COME_FUNZIONA_PIANO_LAVORO.collegamento}
          </Link>
          .
        </p>

        <div className="omnia-dietro omnia-chiusura">
          <div>
            <h2>Vuoi vederlo su una tua gara?</h2>
          </div>
          <div>
            <p className="omnia-firma">
              Nella demo lavoriamo su un bando che ti interessa davvero. E se vuoi un controllo in più,
              dalla piattaforma puoi chiedere la revisione umana dei consulenti di Omnia Consulting, un
              servizio a pagamento separato dall&apos;abbonamento.
            </p>
            <div className="omnia-azioni omnia-azioni-sinistra">
              <Link className="omnia-btn omnia-btn-p" href="/demo">
                Richiedi la demo
              </Link>
              <Link className="omnia-btn omnia-btn-s" href="/piani">
                Vedi i piani
              </Link>
            </div>
          </div>
        </div>
      </section>
    </PageShell>
  );
}
