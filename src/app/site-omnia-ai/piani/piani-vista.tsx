import Link from "next/link";
import PageShell from "@/components/omnia-ai/page-shell";
import { PIANI_ORDINE, formatEuro, formatEuroCifra, type PianoSlug } from "@/lib/omnia-ai-plans";
import { testoOfferta, type Catalogo as CatalogoTipo } from "@/lib/omnia-ai-catalogo-calcoli";
import { NOTA_PIANI_RICERCA_GARE, PERCORSO_RICERCA_GARE, RIGA_PIANI_RICERCA_GARE } from "@/lib/ricerca-gare-testi";
import RevisioneBanda from "./revisione-banda";
import ServiziPerCategoria from "./servizi-per-categoria";

// La pagina dei piani, senza accesso ai dati: la pagina (page.tsx) legge catalogo, condizioni e se la vendita è visibile, e li passa qui.
// Separata per poterla mostrare con la vendita accesa in anteprima.
//
// Ordine (revisione del 16/11/2026): schede sintetiche con l'acquisto online come azione principale e la demo come alternativa facoltativa;
// poi la tabella delle caratteristiche; poi i dettagli comuni una sola volta (gare e crediti, servizi a parte, categorie, revisione umana).
// L'acquisto («Abbonati a …» → /abbonati/[piano], il piano resta nell'indirizzo; l'account si crea con il pagamento) compare solo con la
// vendita accesa in console E la chiave Stripe reale (lib/omnia-ai-vendita.ts): nessun visitatore deve arrivare a un pagamento che non può
// completare. Prezzi e sconti sempre dal catalogo, mai dalla costante del codice.
//
// Piano di lavoro Excel: compreso con Professional ed Enterprise nelle gare del piano; con Starter, e per le gare acquistate con i crediti, si
// compra dentro la singola gara al prezzo letto dalla console (`prezzoSingolaGaraCentesimi`). Lo stesso in tabella, servizi a parte, categorie.

// Le differenze essenziali di ogni piano (quelle comuni stanno nella tabella). Riassumono le voci del catalogo, senza promesse nuove.
const DIFFERENZE: Record<PianoSlug, string[]> = {
  starter: ["Copertina e piano di lavoro Excel acquistabili a parte, gara per gara"],
  professional: ["Copertina e piano di lavoro Excel compresi nelle gare del piano", "Supporto prioritario"],
  enterprise: ["Tutto il piano Professional", "Revisione umana a condizioni dedicate"],
};

// La tabella delle caratteristiche: riassume le voci del catalogo e l'art. 5 delle Condizioni. La riga del piano di lavoro dice nello stesso
// punto quando è compreso e quanto costa quando non lo è. «Ricerca gare» (decisione dell'utente del 25/11/2026: compresa in tutti e tre i
// piani) NON è ancora nel catalogo né nelle Condizioni: la frase per l'avvocato è nel rapporto del 25/11 (allegati B1, 46).
function righeConfronto(prezzoPianoLavoro: string): { voce: string; valori: Record<PianoSlug, string> }[] {
  return [
    { voce: "Relazione tecnica in Word", valori: { starter: "Sì", professional: "Sì", enterprise: "Sì" } },
    { voce: "Estrazione automatica dei criteri", valori: { starter: "Sì", professional: "Sì", enterprise: "Sì" } },
    { voce: RIGA_PIANI_RICERCA_GARE.voce, valori: { ...RIGA_PIANI_RICERCA_GARE.valori } },
    { voce: "Rielaborazioni sulla stessa gara", valori: { starter: "Comprese", professional: "Comprese", enterprise: "Comprese" } },
    { voce: "Copertina della relazione tecnica", valori: { starter: "Acquistabile", professional: "Compresa", enterprise: "Compresa" } },
    {
      voce: "Piano di lavoro Excel (gare di pulizia)",
      valori: { starter: `${prezzoPianoLavoro} per gara`, professional: "Compreso*", enterprise: "Compreso*" },
    },
    { voce: "Supporto prioritario", valori: { starter: "—", professional: "Sì", enterprise: "Sì" } },
    { voce: "Revisione umana", valori: { starter: "A pagamento", professional: "A pagamento", enterprise: "Condizioni dedicate" } },
    { voce: "Crediti per gare in più", valori: { starter: "Acquistabili", professional: "Acquistabili", enterprise: "Acquistabili" } },
  ];
}

// Come funzionano gare e crediti, in quattro punti: stesse regole dell'art. 5 delle Condizioni di abbonamento.
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
    testo: "I servizi della singola gara quando il piano non li comprende, e la revisione umana dei consulenti: li trovi qui sotto.",
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
  const prezzoPianoLavoro = formatEuro(prezzoSingolaGaraCentesimi);
  const righe = righeConfronto(prezzoPianoLavoro);
  return (
    <PageShell>
      <section className="omnia-pagina-hero omnia-piani-hero">
        <p className="omnia-occhiello omnia-occhiello-centro">Piani e prezzi</p>
        <h1>OMNIA AI: un piano per ogni ritmo di partecipazione a gara</h1>
        <p className="omnia-sotto" style={{ margin: "20px auto 0" }}>
          Abbonamento mensile con un numero di gare incluso. Una gara si consuma quando parte
          l&apos;analisi dei documenti: da lì in poi generazioni e revisioni sulla stessa gara
          sono comprese.
        </p>
        {/* La demo è facoltativa: chi vuole comprare procede da solo. Solo con la vendita visibile (stessa condizione del pulsante). */}
        {vendita && (
          <p className="omnia-sotto omnia-piani-acquisto" style={{ margin: "14px auto 0" }}>
            Puoi acquistare il tuo abbonamento direttamente online. Se preferisci vedere prima la
            piattaforma, <Link href="/demo">prenota una demo</Link>.
          </p>
        )}
      </section>

      <section className="omnia-pagina-corpo">
        <div className="omnia-prezzi">
          {PIANI_ORDINE.map((slug) => {
            // prezzi e sconti dal catalogo (modificabili dalla console), mai dalla costante del codice
            const p = catalogo[slug];
            return (
              <div key={p.slug} className={`omnia-prezzo${p.inEvidenza ? " in-evidenza" : ""}`}>
                <b>{p.nome}</b>
                <p className="omnia-prezzo-per">{p.descrizione}</p>
                <div className="omnia-prezzo-cifra">
                  {p.sconto && <span className="omnia-prezzo-prima">{formatEuroCifra(p.prezzoListinoCentesimi)} €</span>}
                  <span className="omnia-prezzo-valore">
                    {formatEuroCifra(p.prezzoCentesimi)}
                    <span className="omnia-prezzo-simbolo">€</span>
                  </span>
                  <span className="omnia-prezzo-periodo">al mese · IVA inclusa</span>
                </div>
                {/* le condizioni della promozione subito sotto il prezzo */}
                {p.sconto && <p className="omnia-prezzo-offerta">{testoOfferta(p.sconto, p.prezzoListinoCentesimi)}</p>}
                <ul className="omnia-prezzo-elenco">
                  <li>
                    <strong>{p.gareIncluse} gare</strong> incluse ogni mese
                  </li>
                  {DIFFERENZE[slug].map((v) => (
                    <li key={v}>{v}</li>
                  ))}
                </ul>
                {vendita && (
                  <Link className="omnia-btn omnia-btn-p" href={`/abbonati/${p.slug}`}>
                    Abbonati a {p.nome}
                  </Link>
                )}
                <Link
                  className={`omnia-btn ${!vendita && p.inEvidenza ? "omnia-btn-p" : "omnia-btn-s"}`}
                  href="/demo"
                  style={vendita ? { marginTop: 10 } : undefined}
                >
                  Richiedi la demo
                </Link>
                {vendita && <p className="omnia-prezzo-dopo">Paghi online su Stripe; se non hai ancora un account, si crea con l&apos;acquisto.</p>}
              </div>
            );
          })}
        </div>

        {/* Il confronto delle caratteristiche: su telefono una voce per riga, con i tre valori sotto */}
        <section className="omnia-confronto" aria-labelledby="omnia-confronto-titolo">
          <h2 id="omnia-confronto-titolo">I piani a confronto</h2>
          <div className="omnia-confronto-scorrimento">
            <table className="omnia-confronto-tabella" role="table">
              <caption className="omnia-solo-lettori">Confronto delle caratteristiche dei piani Starter, Professional ed Enterprise</caption>
              <thead role="rowgroup">
                <tr role="row">
                  <td role="cell" />
                  {PIANI_ORDINE.map((slug) => (
                    <th key={slug} scope="col" role="columnheader" className={catalogo[slug].inEvidenza ? "in-evidenza" : undefined}>
                      {catalogo[slug].nome}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody role="rowgroup">
                {righe.map((r) => (
                  <tr key={r.voce} role="row">
                    <th scope="row" role="rowheader">
                      {r.voce}
                    </th>
                    {PIANI_ORDINE.map((slug) => (
                      <td key={slug} role="cell">
                        {r.valori[slug]}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="omnia-confronto-nota">
            * Nelle gare del piano. Per le gare acquistate con i crediti il piano di lavoro si compra a parte, a{" "}
            {prezzoPianoLavoro} IVA inclusa per gara. Una generazione per gara; una seconda solo se i documenti indicano
            una proroga dei termini.
          </p>
          <p className="omnia-confronto-nota">
            {NOTA_PIANI_RICERCA_GARE}{" "}
            <Link href={PERCORSO_RICERCA_GARE}>Come funziona</Link>.
          </p>
          <p className="omnia-confronto-nota">
            <b>In programma, non ancora disponibile:</b> accesso API per il piano Enterprise.
          </p>
        </section>

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

        {/* Servizi della singola gara: per ciascuno, nello stesso punto, quando è compreso e quando si paga a parte */}
        <section className="omnia-regole-gare" aria-labelledby="omnia-a-parte-titolo">
          <h2 id="omnia-a-parte-titolo">Servizi della gara: compresi o a parte</h2>
          <ul className="omnia-regole-elenco">
            <li>
              <h3>Piano di lavoro in Excel</h3>
              <p>
                Per le gare di servizi di pulizia. Compreso con Professional ed Enterprise nelle gare del piano; con Starter e per
                le gare acquistate con i crediti costa <strong>{prezzoPianoLavoro}</strong> IVA inclusa per gara, nella pagina della
                gara.
              </p>
            </li>
            <li>
              <h3>Copertina della relazione</h3>
              <p>Compresa con Professional ed Enterprise; con Starter si acquista nella pagina della gara, dove trovi il prezzo.</p>
            </li>
            <li>
              <h3>Revisione umana</h3>
              <p>Un consulente rivede la relazione: è un servizio a pagamento, diverso dalle rielaborazioni di OMNIA AI comprese nel piano.</p>
            </li>
            <li>
              <h3>Crediti per gare in più</h3>
              <p>Si acquistano dall&apos;area riservata quando le gare incluse non bastano, senza cambiare piano.</p>
            </li>
          </ul>
        </section>

        {/* Cosa si può elaborare dentro una gara oltre alla relazione tecnica, per categoria. */}
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
