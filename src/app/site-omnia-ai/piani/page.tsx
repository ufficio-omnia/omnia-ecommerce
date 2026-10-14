import type { Metadata } from "next";
import Link from "next/link";
import PageShell from "@/components/omnia-ai/page-shell";
import { getCurrentOmniaAiCondizioniAbbonamentoUrl } from "@/lib/omnia-ai-legal";
import { PIANI_ORDINE, formatEuroCifra } from "@/lib/omnia-ai-plans";
import { getCatalogoPiani } from "@/lib/omnia-ai-catalogo";
import { testoOfferta } from "@/lib/omnia-ai-catalogo-calcoli";
import { paginaMetadata } from "@/lib/omnia-ai-seo";

export const metadata: Metadata = paginaMetadata({
  title: "Piani e prezzi — OMNIA AI",
  description:
    "Piani e prezzi di OMNIA AI: abbonamento mensile con gare incluse per generare la relazione tecnica delle tue gare d'appalto in Word.",
  path: "/piani",
});

export default async function PianiPage() {
  const [condizioniUrl, catalogo] = await Promise.all([getCurrentOmniaAiCondizioniAbbonamentoUrl(), getCatalogoPiani()]);

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
                {/* TEMPORANEO: Stripe è in modalità di prova, "Abbonati"
                    (verso /abbonati/[piano], pagamento diretto) resta
                    pronto ma non collegato qui finché non si passa alla
                    modalità live — nessun visitatore deve arrivare a un
                    pagamento che non può davvero completare. */}
                <Link className={`omnia-btn ${p.inEvidenza ? "omnia-btn-p" : "omnia-btn-s"}`} href="/demo">
                  Richiedi la demo
                </Link>
              </div>
            );
          })}
        </div>

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
      </section>
    </PageShell>
  );
}
