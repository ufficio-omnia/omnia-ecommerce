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
    "Come si prepara un'offerta tecnica con OMNIA AI: dati aziendali, documenti di gara, analisi dei criteri, generazione in Word, rielaborazioni e verifica finale.",
  path: "/come-funziona",
});

// Il percorso pratico, nell'ordine in cui lo fa l'utente (revisione del 16/11/2026). Ogni passo corrisponde a una funzione presente
// nell'area riservata: profilo e documenti aziendali, caricamento (PDF, Word, tabelle, immagini), dati estratti, chat per criterio,
// relazione finale in Word, revisione umana.
const PERCORSO = [
  {
    titolo: "Prepari i dati della tua azienda",
    testo: "Una volta sola: il profilo aziendale (dati societari, dimensioni, organizzazione della direzione) e il tuo logo, che OMNIA AI usa nelle offerte di ogni gara.",
  },
  {
    titolo: "Carichi i documenti di gara",
    testo: "Bando, disciplinare, capitolato e allegati, in PDF o Word: gli stessi file che scarichi dalla piattaforma della stazione appaltante.",
  },
  {
    titolo: "OMNIA AI analizza la gara",
    testo: "Ricava scadenza, importo, formattazione richiesta, limite di pagine, criteri con i punteggi e requisiti chiave, da verificare in una schermata.",
  },
  {
    titolo: "Generi l'offerta, criterio per criterio",
    testo: "Chiedi in chat di sviluppare un criterio alla volta: ogni criterio diventa una bozza in Word, con tabelle e schemi dove servono.",
  },
  {
    titolo: "Rielabori e personalizzi",
    testo: "Chiedi le modifiche che vuoi sulla stessa gara: le rielaborazioni sono comprese nell'abbonamento.",
  },
  {
    titolo: "Componi la relazione finale e la verifichi",
    testo: "Quando i criteri sono pronti, OMNIA AI li riunisce in un unico Word modificabile. Lo completi con i dati della tua azienda e lo controlli prima della consegna.",
  },
  {
    titolo: "Se serve, la revisione di un consulente",
    testo: "Per le gare più importanti puoi chiedere dalla piattaforma la revisione umana di Omnia Consulting: è un servizio a pagamento, separato dall'abbonamento.",
  },
];

// L'approfondimento tecnico (espandibile): come OMNIA AI trova le informazioni nei documenti. Nessuna affermazione assoluta.
const TECNICA = [
  {
    titolo: "I documenti diventano passaggi brevi",
    testo: "Non l'intero documento come blocco unico, ma articoli, paragrafi e righe di tabella, ciascuno con la propria fonte.",
  },
  {
    titolo: "Per ogni domanda o criterio, i passaggi pertinenti",
    testo: "OMNIA AI cerca i passaggi del bando che contano per quella domanda o per quel punteggio, invece di rileggere tutto da capo.",
  },
  {
    titolo: "Le risposte indicano da dove vengono",
    testo: "Le risposte sui documenti riportano articolo, paragrafo o tabella di provenienza: un supporto per verificarle, non un sostituto del controllo.",
  },
];

export default function ComeFunzionaPage() {
  return (
    <PageShell>
      <section className="omnia-pagina-hero">
        <p className="omnia-occhiello omnia-occhiello-centro">Come funziona</p>
        <h1>Dai documenti di gara all&apos;offerta tecnica, passo per passo</h1>
        <p className="omnia-sotto" style={{ margin: "24px auto 0" }}>
          Il percorso che fai dentro OMNIA AI, dalla preparazione dei dati alla verifica finale del
          documento Word.
        </p>
      </section>

      <section className="omnia-pagina-corpo">
        <h2>Il tuo lavoro, in sette passi</h2>
        <ol className="omnia-passi">
          {PERCORSO.map((p) => (
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
            testo="Scadenza, formattazione, limite di pagine, criteri e requisiti ricavati dai documenti. Interfaccia reale, dati sostituiti per riservatezza."
            dettagli={["vincoli", "criteri"]}
          />
        </div>

        <h2>Cosa estrae e cosa propone</h2>
        <ul className="omnia-tre omnia-quattro omnia-distinzione">
          <li className="omnia-cella">
            <h3>Informazioni estratte dai documenti</h3>
            <p>
              Scadenze, criteri, punteggi, vincoli e risposte alle tue domande sul bando. Vengono dai documenti
              caricati e ne indicano la fonte: la verifichi confrontandola con l&apos;originale.
            </p>
          </li>
          <li className="omnia-cella">
            <h3>Proposte per l&apos;offerta</h3>
            <p>
              Il testo dei criteri, l&apos;organizzazione del servizio, tabelle e schemi. Sono contenuti progettuali
              generati per la tua offerta: li adatti alla tua azienda e li approvi tu.
            </p>
          </li>
        </ul>

        <h2>Un esempio di domanda sui documenti</h2>
        <p className="omnia-guida">
          Una domanda, i passaggi del bando da cui parte la risposta e la risposta con le fonti. È un esempio
          dimostrativo con dati di fantasia.
        </p>
        <div className="omnia-esempio-cf">
          <ComeFunzionaDemo />
        </div>

        <details className="omnia-approfondimento">
          <summary>Approfondimento: come trova le informazioni nei documenti</summary>
          <ol className="omnia-passi">
            {TECNICA.map((p) => (
              <li key={p.titolo} className="omnia-passo">
                <div>
                  <b>{p.titolo}</b>
                  <p>{p.testo}</p>
                </div>
              </li>
            ))}
          </ol>
        </details>

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
              Nella demo partiamo da un bando che ti interessa davvero e ti mostriamo il percorso dall&apos;inizio
              alla relazione in Word.
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
