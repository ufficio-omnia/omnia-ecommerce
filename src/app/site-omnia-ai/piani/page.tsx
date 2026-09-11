import type { Metadata } from "next";
import Link from "next/link";
import PageShell from "@/components/omnia-ai/page-shell";
import { getCurrentOmniaAiCondizioniAbbonamentoUrl } from "@/lib/omnia-ai-legal";

export const metadata: Metadata = {
  title: "Piani e prezzi — OMNIA AI",
  description: "Abbonamento mensile con crediti inclusi per generare relazioni tecniche di gara.",
};

// Struttura pronta, prezzi segnaposto: i valori reali si inseriscono
// dal pannello admin quando saranno definiti (non ancora collegato a
// un valore editabile — solo la struttura della pagina, come richiesto).
const PIANI = [
  {
    nome: "Base",
    prezzo: "—",
    nota: "al mese",
    descrizione: "Per chi partecipa a poche gare e vuole provare il metodo.",
    voci: ["Crediti inclusi ogni mese", "Generazione relazione tecnica in Word", "Estrazione automatica dei criteri di valutazione"],
    inEvidenza: false,
  },
  {
    nome: "Standard",
    prezzo: "—",
    nota: "al mese",
    descrizione: "Per chi partecipa a gare con regolarità.",
    voci: [
      "Tutto il piano Base",
      "Più crediti inclusi ogni mese",
      "Intestazioni e piè di pagina con il tuo logo",
      "Supporto prioritario",
    ],
    inEvidenza: true,
  },
  {
    nome: "Studio",
    prezzo: "—",
    nota: "al mese",
    descrizione: "Per studi di consulenza e uffici gare con più utenti.",
    voci: ["Tutto il piano Standard", "Utenti multipli", "Revisione umana Omnia Consulting a condizioni dedicate"],
    inEvidenza: false,
  },
];

export default async function PianiPage() {
  const condizioniUrl = await getCurrentOmniaAiCondizioniAbbonamentoUrl();

  return (
    <PageShell>
      <section className="omnia-pagina-hero">
        <h1>Un piano per ogni ritmo di partecipazione a gara.</h1>
        <p className="omnia-sotto" style={{ margin: "24px auto 0" }}>
          Abbonamento mensile con un pacchetto di crediti incluso. Ogni operazione — analisi dei
          documenti, generazione di un criterio, revisione — consuma crediti in base al lavoro
          richiesto.
        </p>
      </section>

      <section className="omnia-pagina-corpo">
        <div className="omnia-prezzi">
          {PIANI.map((p) => (
            <div key={p.nome} className={`omnia-prezzo${p.inEvidenza ? " in-evidenza" : ""}`}>
              <b>{p.nome}</b>
              <div className="omnia-prezzo-cifra">
                {p.prezzo}
                <span> {p.nota}</span>
              </div>
              <p style={{ marginTop: 10, fontSize: 14, color: "var(--fioco)", fontWeight: 300, textAlign: "left" }}>
                {p.descrizione}
              </p>
              <ul className="omnia-prezzo-elenco">
                {p.voci.map((v) => (
                  <li key={v}>{v}</li>
                ))}
              </ul>
              <Link className={`omnia-btn ${p.inEvidenza ? "omnia-btn-p" : "omnia-btn-s"}`} href="/demo">
                Richiedi la demo
              </Link>
            </div>
          ))}
        </div>

        <p className="micro" style={{ marginTop: 32 }}>
          Prezzi in fase di definizione. Se finiscono i crediti puoi ricaricarli senza cambiare
          piano.
        </p>
        <p className="micro" style={{ marginTop: 8 }}>
          Iscrivendoti accetti le{" "}
          <Link href={condizioniUrl} style={{ color: "inherit", textDecoration: "underline" }}>
            Condizioni di abbonamento
          </Link>
          .
        </p>
      </section>
    </PageShell>
  );
}
