import type { Metadata } from "next";
import Link from "next/link";
import PageShell from "@/components/omnia-ai/page-shell";
import { getCurrentOmniaAiCondizioniAbbonamentoUrl } from "@/lib/omnia-ai-legal";
import { PIANI, PIANI_ORDINE, formatEuro } from "@/lib/omnia-ai-plans";

export const metadata: Metadata = {
  title: "Piani e prezzi — OMNIA AI",
  description: "Abbonamento mensile con gare incluse per generare relazioni tecniche di gara.",
};

export default async function PianiPage() {
  const condizioniUrl = await getCurrentOmniaAiCondizioniAbbonamentoUrl();

  return (
    <PageShell>
      <section className="omnia-pagina-hero">
        <h1>Un piano per ogni ritmo di partecipazione a gara.</h1>
        <p className="omnia-sotto" style={{ margin: "24px auto 0" }}>
          Abbonamento mensile con un numero di gare incluso. Una gara si consuma quando parte
          l&apos;analisi dei documenti: da lì in poi generazioni e revisioni sulla stessa gara
          sono comprese.
        </p>
      </section>

      <section className="omnia-pagina-corpo">
        <div className="omnia-prezzi">
          {PIANI_ORDINE.map((slug) => {
            const p = PIANI[slug];
            return (
              <div key={p.slug} className={`omnia-prezzo${p.inEvidenza ? " in-evidenza" : ""}`}>
                <b>{p.nome}</b>
                <div className="omnia-prezzo-cifra">
                  {formatEuro(p.prezzoCentesimi)}
                  <span> al mese, IVA inclusa</span>
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
      </section>
    </PageShell>
  );
}
