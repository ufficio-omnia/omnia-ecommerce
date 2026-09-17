import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { BASE_URL } from "@/lib/zone";
import AnteprimaDownloadCta from "@/components/anteprima-download-cta";
import { FlowDiagram, HubDiagram } from "@/components/offerta-tecnica-gare-pulizia/diagrams";
import Toc from "@/components/offerta-tecnica-gare-pulizia/toc";

const PAGE_PATH = "/offerta-tecnica-gare-appalto-pulizia";
const PAGE_URL = `${BASE_URL}${PAGE_PATH}`;
const PAGE_TITLE = "Offerta tecnica gara pulizie: come scrivere la relazione | OMNIA";
const PAGE_DESCRIPTION =
  "Come scrivere un'offerta tecnica per gare di pulizia: struttura, CAM, organico, controllo qualità, migliorie, errori da evitare ed esempio pratico.";

export const metadata: Metadata = {
  title: { absolute: PAGE_TITLE },
  description: PAGE_DESCRIPTION,
  alternates: { canonical: PAGE_URL },
  openGraph: {
    title: PAGE_TITLE,
    description: PAGE_DESCRIPTION,
    url: PAGE_URL,
    siteName: "OMNIA",
    locale: "it_IT",
    type: "article",
  },
  twitter: {
    card: "summary_large_image",
    title: PAGE_TITLE,
    description: PAGE_DESCRIPTION,
  },
};

const h2 =
  "mt-12 font-serif text-2xl text-ink sm:text-[1.75rem] before:content-[''] before:block before:h-1 before:w-10 before:rounded-full before:bg-forest before:mb-4";
const p = "mt-3 text-justify text-base leading-relaxed text-sage";
const ul =
  "mt-3 list-disc space-y-1.5 pl-5 text-base leading-relaxed text-sage marker:text-forest";
const ulWide =
  "mt-3 list-disc space-y-1.5 pl-5 text-base leading-relaxed text-sage marker:text-forest sm:columns-2 sm:gap-x-8 [&>li]:break-inside-avoid";
const link = "text-forest underline underline-offset-2 hover:text-forest-dark";

const TOC_ITEMS = [
  { id: "cosa-valuta", label: "Cosa valuta la Commissione" },
  { id: "struttura", label: "La struttura dell'offerta" },
  { id: "migliorie", label: "Migliorie che generano valore" },
  { id: "errori-frequenti", label: "Gli errori più frequenti" },
  { id: "controllo-finale", label: "Il controllo finale" },
  { id: "parti-da-una-base", label: "Parti da una base già pronta" },
  { id: "faq", label: "Domande frequenti" },
];

const faqs = [
  {
    domanda: "Quanto pesa l'offerta tecnica in una gara di pulizie?",
    risposta:
      "Dipende dalla documentazione di gara. Nei contratti ad alta intensità di manodopera il Codice dei Contratti Pubblici prevede un tetto massimo del 30% per il punteggio economico. La componente qualitativa assume quindi un peso particolarmente rilevante e può rappresentare almeno 70 punti sui 100 complessivi. La ripartizione esatta deve comunque essere verificata nel disciplinare della singola procedura.",
  },
  {
    domanda: "Posso utilizzare un fac-simile di relazione tecnica senza modificarlo?",
    risposta:
      "No. Un fac-simile può rappresentare un'ottima base di partenza, ma ogni offerta deve essere adattata ai criteri e sub-criteri della specifica gara. Organizzazione del servizio, personale, monte ore, macchinari, metodologie e migliorie devono essere coerenti con il capitolato e con le caratteristiche della commessa.",
  },
  {
    domanda: "Quali certificazioni servono per partecipare a una gara di pulizie?",
    risposta:
      "Non esiste una certificazione universalmente richiesta per tutte le gare. Requisiti e criteri premianti dipendono dalla singola procedura. Nel settore vengono frequentemente valorizzati sistemi di gestione quali ISO 9001, ISO 14001 e ISO 45001, ma occorre sempre verificare ciò che stabilisce il disciplinare.",
  },
  {
    domanda: "Cosa sono i CAM nelle gare di pulizia?",
    risposta:
      "I CAM sono i Criteri Ambientali Minimi previsti per determinate categorie di appalti pubblici. Per i servizi di pulizia e sanificazione il riferimento specifico è il D.M. 29 gennaio 2021. Riguardano diversi aspetti del servizio e dei prodotti utilizzati e devono essere analizzati già durante la progettazione dell'offerta tecnica, non soltanto nella fase esecutiva.",
  },
  {
    domanda: "Quanto tempo serve per preparare una relazione tecnica?",
    risposta:
      "Non esiste un tempo standard. Dipende dal numero dei criteri, dalla complessità della commessa, dal numero di immobili, dal limite di pagine, dalle migliorie da progettare e dalla quantità di documentazione da analizzare. Una relazione realmente personalizzata richiede prima di tutto l'analisi completa di disciplinare, capitolato, criteri di valutazione e allegati tecnici.",
  },
  {
    domanda: "Come posso capire se la mia relazione tecnica risponde correttamente al disciplinare?",
    risposta:
      "Il metodo più efficace consiste nel verificare ogni singolo criterio attraverso una matrice di corrispondenza. Per ogni sub-criterio devono essere individuati il contenuto richiesto, la risposta fornita, gli eventuali dati a supporto e la posizione all'interno della relazione. Se un criterio non trova una risposta immediatamente identificabile, quella sezione dovrebbe essere rivista.",
  },
  {
    domanda: "Posso far revisionare un'offerta tecnica già preparata?",
    risposta:
      "Sì. La revisione può essere utile per controllare completezza rispetto ai criteri di valutazione, coerenza dei dati, organizzazione dei contenuti, sostenibilità delle migliorie e rispetto delle prescrizioni formali della gara.",
  },
];

const articleJsonLd = {
  "@context": "https://schema.org",
  "@type": "Article",
  headline: "Offerta tecnica per gare d'appalto di pulizia: come si scrive una relazione tecnica efficace",
  description: PAGE_DESCRIPTION,
  datePublished: "2026-09-16",
  dateModified: "2026-09-17",
  mainEntityOfPage: { "@type": "WebPage", "@id": PAGE_URL },
  author: { "@type": "Organization", name: "Omnia Consulting", url: BASE_URL },
  publisher: {
    "@type": "Organization",
    name: "Omnia Consulting",
    logo: { "@type": "ImageObject", url: `${BASE_URL}/omnia-logo.png` },
  },
};

const faqJsonLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: faqs.map((faq) => ({
    "@type": "Question",
    name: faq.domanda,
    acceptedAnswer: { "@type": "Answer", text: faq.risposta },
  })),
};

function ChapterCard({
  number,
  title,
  children,
}: {
  number: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="mt-6 rounded-2xl border border-border bg-cream-soft p-6 shadow-sm transition-shadow hover:shadow-md sm:p-8">
      <div className="flex items-start gap-4 sm:gap-6">
        <span className="shrink-0 font-serif text-4xl leading-none text-forest sm:text-5xl">
          {number}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="font-serif text-lg text-ink">{title}</h3>
          {children}
        </div>
      </div>
    </div>
  );
}

function ErrorCard({
  number,
  title,
  children,
}: {
  number: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="mt-6 rounded-2xl border border-border-strong border-l-4 border-l-ink bg-cream-soft p-6 shadow-sm transition-shadow hover:shadow-md sm:p-8">
      <div className="flex items-start gap-4 sm:gap-6">
        <span className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ink font-mono text-xs text-cream">
          {number}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="font-serif text-lg text-ink">{title}</h3>
          {children}
        </div>
      </div>
    </div>
  );
}

function Callout({
  variant,
  eyebrow,
  children,
}: {
  variant: "highlight" | "summary" | "warning";
  eyebrow?: string;
  children: ReactNode;
}) {
  const styles = {
    highlight: "bg-forest text-cream",
    summary: "border-2 border-forest bg-cream-soft text-ink",
    warning: "bg-ink text-cream",
  };
  const eyebrowStyles = {
    highlight: "text-mint",
    summary: "text-forest",
    warning: "text-mint",
  };

  return (
    <div className={`my-6 rounded-2xl p-6 sm:p-8 ${styles[variant]}`}>
      {eyebrow && (
        <p className={`font-mono text-[11px] tracking-widest uppercase ${eyebrowStyles[variant]}`}>
          {eyebrow}
        </p>
      )}
      <p className="mt-2 font-serif text-xl leading-snug sm:text-2xl">{children}</p>
    </div>
  );
}

function DownloadCta({ variant }: { variant: "prima" | "seconda" }) {
  return (
    <div className="my-10 rounded-2xl bg-forest p-6 text-cream sm:p-10">
      {variant === "prima" ? (
        <>
          <p className="font-serif text-2xl">
            Guarda com&apos;è fatta una Relazione Tecnica completa
          </p>
          <p className="mt-4 text-justify text-base leading-relaxed text-cream/90">
            Vuoi vedere concretamente come viene strutturata un&apos;offerta
            tecnica professionale per una gara d&apos;appalto?
          </p>
          <p className="mt-4 text-justify text-base leading-relaxed text-cream/90">
            Scarica gratuitamente un&apos;anteprima con indice completo e
            alcune pagine esemplificative di una relazione tecnica
            strutturata per servizi di pulizia.
          </p>
          <p className="mt-4 text-justify text-base leading-relaxed text-cream/90">
            Potrai vedere come vengono organizzati criteri, metodologie,
            organigrammi, sistemi di controllo, migliorie e contenuti
            tecnici.
          </p>
        </>
      ) : (
        <>
          <p className="font-serif text-2xl">Guarda prima di acquistare</p>
          <p className="mt-4 text-justify text-base leading-relaxed text-cream/90">
            Scarica gratuitamente un&apos;anteprima della nostra Relazione
            Tecnica per servizi di pulizia.
          </p>
          <p className="mt-4 text-justify text-base leading-relaxed text-cream/90">
            Troverai:
          </p>
          <ul className="mt-4 list-disc space-y-2 pl-5 text-base leading-relaxed text-cream/90 marker:text-mint">
            <li>indice completo;</li>
            <li>struttura dei capitoli;</li>
            <li>alcune pagine reali del documento;</li>
            <li>esempi di impostazione tecnica;</li>
            <li>tabelle e schemi utilizzabili nella relazione.</li>
          </ul>
        </>
      )}

      <div className="mt-6">
        <AnteprimaDownloadCta onDark />
      </div>
      {variant === "prima" && (
        <p className="mt-2 font-mono text-[10px] tracking-wide text-cream/70 uppercase">
          Nessun acquisto richiesto
        </p>
      )}

      {variant === "seconda" && (
        <div className="mt-6 flex flex-col gap-3 border-t border-cream/20 pt-6 sm:flex-row sm:items-center sm:justify-between">
          <Link
            href="/prodotti"
            className="rounded-full border border-cream/40 px-5 py-2.5 text-center font-mono text-xs tracking-wide text-cream uppercase transition-colors hover:bg-cream hover:text-forest"
          >
            Scopri i pacchetti per le gare di pulizia
          </Link>
          <a
            href="https://omniaitalia.com#contatti"
            className="rounded-full border border-cream/40 px-5 py-2.5 text-center font-mono text-xs tracking-wide text-cream uppercase transition-colors hover:bg-cream hover:text-forest"
          >
            Richiedi supporto per la tua gara
          </a>
        </div>
      )}
    </div>
  );
}

export default function OffertaTecnicaGarePuliziaPage() {
  return (
    <main className="flex-1">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(articleJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />

      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20 lg:grid lg:grid-cols-[220px_1fr] lg:items-start lg:gap-x-16">
        {/* HERO — in colonna 2 come il resto del testo (lg:col-start-2),
            cosi' titolo e corpo condividono lo stesso margine sinistro
            invece di sembrare due blocchi scollegati. */}
        <div className="max-w-3xl lg:col-start-2">
          <p className="font-mono text-xs tracking-widest text-forest uppercase">
            Guida gare d&apos;appalto
          </p>
          <h1 className="mt-3 font-serif text-3xl text-ink sm:text-4xl">
            Offerta tecnica per gare d&apos;appalto di pulizia: come si
            scrive una relazione tecnica efficace
          </h1>
          <p className="mt-5 font-serif text-lg leading-relaxed text-ink sm:text-xl">
            Come strutturare un&apos;offerta tecnica che la Commissione può
            valutare punto per punto — criteri, organizzazione, migliorie e
            gli errori che costano punti nelle gare di pulizia.
          </p>
          <div className="mt-8">
            <a
              href="#anteprima-download-1"
              className="inline-flex items-center gap-2 rounded-full bg-forest px-8 py-4 font-mono text-sm tracking-wide text-cream uppercase shadow-lg shadow-forest/20 transition-all hover:scale-[1.02] hover:bg-forest-dark hover:shadow-xl"
            >
              Scarica l&apos;anteprima gratuita ↓
            </a>
            <p className="mt-3 font-mono text-xs tracking-wide text-sage uppercase">
              12 min di lettura · nessun acquisto richiesto
            </p>
          </div>
          <FlowDiagram
            steps={["Criteri di gara", "Organizzazione", "Controllo qualità", "Migliorie"]}
          />
        </div>

        {/* INDICE — colonna 1, alta quanto hero+corpo (lg:row-span-2),
            cosi' resta a fianco di entrambi invece che solo del corpo. */}
        <div className="mt-8 lg:sticky lg:top-24 lg:col-start-1 lg:row-span-2 lg:row-start-1 lg:mt-0">
          <Toc items={TOC_ITEMS} />
        </div>

        {/* CORPO — colonna 2, riga 2 (sotto l'hero) */}
        <div className="mt-10 max-w-3xl lg:col-start-2 lg:mt-16">
            <p className={p}>
              Nelle gare d&apos;appalto per servizi di pulizia, la qualità
              dell&apos;offerta tecnica può determinare in maniera decisiva
              il risultato della procedura.
            </p>
            <p className={p}>
              Quando il servizio rientra tra i contratti ad alta intensità
              di manodopera, l&apos;aggiudicazione avviene sulla base
              dell&apos;offerta economicamente più vantaggiosa secondo il
              miglior rapporto qualità/prezzo e il punteggio attribuibile
              alla componente economica non può superare il 30%. Nella
              pratica, quindi,{" "}
              <strong className="text-ink">
                70, 80 o più punti possono dipendere dalla qualità del
                progetto tecnico presentato
              </strong>
              , secondo quanto stabilito dal disciplinare di gara.
            </p>
            <p className={p}>Ed è proprio qui che molte imprese perdono punti.</p>
            <p className={p}>
              Non necessariamente perché dispongano di
              un&apos;organizzazione inadeguata, di personale insufficiente
              o di attrezzature poco performanti. Molto più spesso perché{" "}
              <strong className="text-ink">
                non riescono a trasformare la propria organizzazione in un
                progetto tecnico facilmente valutabile dalla Commissione
              </strong>
              .
            </p>
            <p className={p}>
              Una buona relazione tecnica non deve semplicemente
              &quot;raccontare&quot; l&apos;azienda.
            </p>
            <p className={p}>
              Deve consentire alla Commissione di individuare, criterio
              dopo criterio, cosa viene offerto, come verrà realizzato, con
              quali risorse, con quali risultati attesi e attraverso quali
              strumenti sarà possibile verificarlo.
            </p>

            <div id="anteprima-download-1">
              <DownloadCta variant="prima" />
            </div>

            <h2 id="cosa-valuta" className={h2}>
              Cosa valuta davvero la Commissione in un&apos;offerta tecnica
            </h2>
            <p className={p}>
              Uno degli errori più comuni è considerare la relazione
              tecnica come una presentazione generale dell&apos;impresa.
              Non lo è: il punto di partenza deve essere sempre la griglia
              di valutazione prevista dal disciplinare di gara.
            </p>
            <p className={p}>
              Ogni criterio e ogni sub-criterio rappresentano una domanda
              alla quale l&apos;offerta deve fornire una risposta precisa.
              Se, ad esempio, vengono attribuiti 8 punti
              all&apos;organizzazione del personale, descrivere per cinque
              pagine la storia dell&apos;azienda non contribuirà
              necessariamente a ottenere quegli 8 punti: la Commissione
              deve poter individuare rapidamente gli elementi che
              consentono l&apos;attribuzione del punteggio.
            </p>
            <p className={p}>
              Per questo una relazione tecnica efficace dovrebbe
              privilegiare:
            </p>
            <ul className={ulWide}>
              <li>informazioni concrete e verificabili;</li>
              <li>dati quantitativi;</li>
              <li>tabelle e schemi di sintesi;</li>
              <li>responsabilità chiaramente individuate;</li>
              <li>frequenze e tempistiche definite;</li>
              <li>indicatori di performance;</li>
              <li>procedure operative;</li>
              <li>sistemi di controllo;</li>
              <li>strumenti di tracciabilità;</li>
              <li>soluzioni migliorative realmente applicabili alla commessa.</li>
            </ul>

            <Callout variant="highlight" eyebrow="La regola più importante">
              Ogni affermazione dovrebbe rispondere alla domanda:
              &quot;Come può la Commissione verificare ciò che stiamo
              dichiarando?&quot;
            </Callout>
            <p className={p}>
              Dire di garantire &quot;un servizio di elevata qualità&quot;
              ha poco valore.
            </p>
            <p className={p}>
              Indicare invece frequenza dei controlli, responsabile, KPI
              utilizzati, soglie di accettabilità, procedura di gestione
              delle non conformità e tempi di risoluzione rende quella
              stessa promessa concreta e valutabile.
            </p>

            <h2 id="struttura" className={h2}>
              La struttura di un&apos;offerta tecnica per una gara di
              pulizie
            </h2>
            <p className={p}>Non esiste un indice valido per qualsiasi gara.</p>
            <p className={p}>
              La struttura definitiva deve sempre essere costruita sui
              criteri e sub-criteri contenuti nel disciplinare.
            </p>
            <p className={p}>
              Esistono però alcuni capitoli che ricorrono frequentemente
              negli appalti di pulizia.
            </p>

            <ChapterCard number="01" title="Presentazione dell'operatore economico">
              <p className={p}>
                La presentazione aziendale deve essere sintetica e
                funzionale alla gara.
              </p>
              <p className={p}>Possono essere indicati:</p>
              <ul className={ul}>
                <li>esperienza maturata nel settore;</li>
                <li>dimensione e organizzazione aziendale;</li>
                <li>servizi analoghi eseguiti;</li>
                <li>struttura territoriale;</li>
                <li>certificazioni possedute;</li>
                <li>sistemi di gestione adottati;</li>
                <li>eventuali elementi distintivi direttamente collegati alla commessa.</li>
              </ul>
              <p className={p}>
                Tra le certificazioni frequentemente presenti nel settore
                rientrano, ad esempio, ISO 9001 per la qualità, ISO 14001
                per la gestione ambientale e ISO 45001 per la salute e
                sicurezza sul lavoro.
              </p>
              <p className={p}>
                Attenzione però: una certificazione non attribuisce
                automaticamente punteggio.
              </p>
              <p className={p}>
                Il suo valore dipende sempre da quanto previsto dalla
                documentazione di gara e dal collegamento concreto con il
                criterio oggetto di valutazione.
              </p>
            </ChapterCard>

            <ChapterCard number="02" title="Analisi del contesto e del capitolato">
              <p className={p}>
                Una relazione tecnica efficace deve dimostrare che il
                servizio è stato progettato per quella specifica commessa.
              </p>
              <p className={p}>Occorre quindi analizzare:</p>
              <ul className={ul}>
                <li>numero e tipologia degli immobili;</li>
                <li>superfici;</li>
                <li>destinazioni d&apos;uso;</li>
                <li>affluenza degli utenti;</li>
                <li>fasce orarie disponibili;</li>
                <li>aree maggiormente sensibili;</li>
                <li>pavimentazioni e superfici particolari;</li>
                <li>interferenze con le attività dell&apos;ente;</li>
                <li>eventuali vincoli logistici;</li>
                <li>criticità operative.</li>
              </ul>
              <p className={p}>
                Un edificio comunale, un aeroporto, una scuola, un
                deposito, un ospedale e un ufficio aperto al pubblico non
                possono essere trattati attraverso la stessa descrizione
                standard.
              </p>
              <p className={p}>
                È proprio in questa sezione che emerge la differenza tra
                un progetto realmente studiato sulla gara e un modello
                semplicemente riutilizzato.
              </p>
            </ChapterCard>

            <ChapterCard number="03" title="Organizzazione del servizio e metodologie operative">
              <p className={p}>È uno dei capitoli centrali dell&apos;offerta.</p>
              <p className={p}>
                Non è sufficiente affermare che verranno utilizzate
                &quot;metodologie innovative&quot;.
              </p>
              <p className={p}>
                Occorre spiegare concretamente:{" "}
                <strong className="text-ink">
                  chi fa cosa, dove, quando, come e con quali strumenti
                </strong>
                .
              </p>
              <p className={p}>La relazione può quindi dettagliare:</p>
              <ul className={ul}>
                <li>attività previste;</li>
                <li>frequenze;</li>
                <li>procedure operative;</li>
                <li>sequenza delle lavorazioni;</li>
                <li>fasce orarie;</li>
                <li>sistemi di segregazione delle aree;</li>
                <li>metodologie per tipologia di ambiente;</li>
                <li>codifica delle attrezzature;</li>
                <li>sistemi di prevenzione della contaminazione crociata;</li>
                <li>gestione delle emergenze;</li>
                <li>interventi periodici e straordinari.</li>
              </ul>
              <p className={p}>
                Quando necessario, il livello di dettaglio può arrivare
                fino alla singola tipologia di ambiente, soprattutto
                quando le caratteristiche dei locali determinano
                metodologie e frequenze differenti.
              </p>
            </ChapterCard>

            <ChapterCard number="04" title="Organigramma di commessa, personale e monte ore">
              <p className={p}>L&apos;organizzazione proposta deve risultare credibile.</p>
              <p className={p}>
                L&apos;organigramma dovrebbe individuare chiaramente
                almeno:
              </p>
              <ul className={ul}>
                <li>responsabile di commessa;</li>
                <li>eventuali capisquadra o referenti;</li>
                <li>addetti operativi;</li>
                <li>responsabili del controllo qualità;</li>
                <li>funzioni di supporto;</li>
                <li>sostituti e reperibilità.</li>
              </ul>
              <p className={p}>
                Particolare attenzione deve essere prestata alla coerenza
                tra numero di addetti, monte ore, turnazioni, frequenze e
                quantità delle attività dichiarate.
              </p>
              <p className={p}>
                È frequente trovare offerte molto convincenti sotto il
                profilo descrittivo ma non coerenti matematicamente con le
                risorse effettivamente previste.
              </p>
              <p className={p}>
                Quando il monte ore costituisce elemento di valutazione,
                questa coerenza diventa ancora più importante.
              </p>
              <p className={p}>Devono inoltre essere affrontati aspetti come:</p>
              <ul className={ul}>
                <li>gestione di ferie e assenze;</li>
                <li>sostituzioni;</li>
                <li>continuità operativa;</li>
                <li>formazione;</li>
                <li>inserimento di nuovo personale;</li>
                <li>presidio delle emergenze;</li>
                <li>passaggio di consegne.</li>
              </ul>
              <HubDiagram
                hub="Responsabile di commessa"
                spokes={[
                  "Capisquadra / referenti",
                  "Addetti operativi",
                  "Controllo qualità",
                  "Sostituti e reperibilità",
                ]}
              />
            </ChapterCard>

            <ChapterCard number="05" title="Attrezzature, macchinari e prodotti">
              <p className={p}>Un elenco di macchinari non basta.</p>
              <p className={p}>
                Per ogni attrezzatura significativa è preferibile spiegare
                perché viene utilizzata in quella specifica commessa e
                quale vantaggio operativo produce.
              </p>
              <p className={p}>Ad esempio:</p>
              <ul className={ul}>
                <li>incremento della produttività;</li>
                <li>riduzione dei consumi;</li>
                <li>minore rumorosità;</li>
                <li>miglioramento ergonomico;</li>
                <li>riduzione dell&apos;utilizzo di detergente;</li>
                <li>maggiore sicurezza;</li>
                <li>maggiore efficacia su determinate pavimentazioni.</li>
              </ul>
              <p className={p}>
                Anche per prodotti e detergenti devono essere considerate
                le prescrizioni previste dalla documentazione di gara e
                dai Criteri Ambientali Minimi applicabili al servizio di
                pulizia.
              </p>
              <p className={p}>
                Per il settore il riferimento è costituito dal D.M. 29
                gennaio 2021 relativo ai CAM per servizi di pulizia e
                sanificazione di edifici e ambienti ad uso civile e
                sanitario e per i relativi prodotti detergenti.
              </p>
              <p className={p}>
                Una relazione tecnica professionale non si limita quindi a
                dichiarare genericamente &quot;il rispetto dei CAM&quot;,
                ma dimostra come tale conformità viene assicurata e
                documentata.
              </p>
            </ChapterCard>

            <ChapterCard number="06" title="Sistema di controllo della qualità">
              <p className={p}>
                Un buon piano di controllo trasforma la qualità da
                concetto astratto a risultato misurabile.
              </p>
              <p className={p}>Il sistema dovrebbe chiarire:</p>
              <ul className={ul}>
                <li>cosa viene controllato;</li>
                <li>chi effettua il controllo;</li>
                <li>con quale frequenza;</li>
                <li>attraverso quale strumento;</li>
                <li>quali indicatori vengono utilizzati;</li>
                <li>quale soglia determina una non conformità;</li>
                <li>entro quanto tempo viene effettuata l&apos;azione correttiva;</li>
                <li>come vengono registrati gli esiti.</li>
              </ul>
              <p className={p}>
                Tra i riferimenti tecnici utilizzabili nel settore rientra
                la UNI EN 13549:2003, relativa ai requisiti e alle
                raccomandazioni di base per i sistemi di misurazione della
                qualità delle prestazioni di pulizia.
              </p>
              <p className={p}>
                La norma rappresenta un riferimento utile per costruire
                sistemi di controllo basati su criteri misurabili, senza
                sostituire naturalmente quanto specificamente richiesto
                dalla singola gara.
              </p>
              <FlowDiagram
                steps={["Controllo", "Misurazione (KPI)", "Non conformità?", "Azione correttiva"]}
                note="Il ciclo si ripete a ogni verifica programmata"
              />
            </ChapterCard>

            <ChapterCard number="07" title="Gestione ambientale del servizio">
              <p className={p}>
                La sostenibilità non dovrebbe essere trattata con formule
                generiche.
              </p>
              <p className={p}>
                Un piano ambientale efficace può affrontare concretamente:
              </p>
              <ul className={ul}>
                <li>riduzione dei consumi idrici;</li>
                <li>riduzione dell&apos;utilizzo di sostanze chimiche;</li>
                <li>sistemi di dosaggio;</li>
                <li>utilizzo di prodotti a ridotto impatto ambientale;</li>
                <li>riduzione dei rifiuti;</li>
                <li>gestione degli imballaggi;</li>
                <li>riduzione dei consumi energetici;</li>
                <li>ottimizzazione degli spostamenti;</li>
                <li>utilizzo di macchinari ad alta efficienza;</li>
                <li>monitoraggio delle performance ambientali.</li>
              </ul>
              <p className={p}>
                Quando possibile, è preferibile esprimere gli obiettivi
                attraverso indicatori misurabili anziché utilizzare
                esclusivamente dichiarazioni qualitative.
              </p>
              <FlowDiagram
                steps={["Produzione", "Separazione", "Stoccaggio", "Conferimento", "Tracciabilità"]}
              />
            </ChapterCard>

            <h2 id="migliorie" className={h2}>
              Migliorie: quali possono realmente generare valore
            </h2>
            <p className={p}>
              La miglioria migliore non è necessariamente quella che costa
              di più: è quella che risolve una criticità della commessa e
              consente alla Commissione di individuarne chiaramente il
              beneficio.
            </p>
            <p className={p}>
              Possono risultare particolarmente interessanti, quando
              coerenti con i criteri di gara:
            </p>
            <ul className={ulWide}>
              <li>sistemi digitali di controllo e tracciabilità;</li>
              <li>reportistica periodica;</li>
              <li>QR code o sistemi NFC per registrare attività e controlli;</li>
              <li>macchinari più performanti rispetto ai requisiti minimi;</li>
              <li>sistemi evoluti di dosaggio;</li>
              <li>formazione aggiuntiva del personale;</li>
              <li>protocolli specifici per aree sensibili;</li>
              <li>sistemi di gestione delle segnalazioni;</li>
              <li>tempi migliorativi di intervento;</li>
              <li>rafforzamento del controllo qualità;</li>
              <li>soluzioni per ridurre consumi, rifiuti o impatto ambientale;</li>
              <li>organizzazione migliorativa delle sostituzioni e delle emergenze.</li>
            </ul>
            <p className={p}>
              Al contrario, proporre servizi aggiuntivi scollegati dalle
              esigenze dell&apos;appalto può aumentare i costi senza
              generare un corrispondente incremento di punteggio.
            </p>
            <Callout variant="summary">
              Una miglioria deve avere sempre una funzione, un
              destinatario e un risultato.
            </Callout>

            <h2 id="errori-frequenti" className={h2}>
              Gli errori più frequenti nelle offerte tecniche di pulizia
            </h2>
            <p className={p}>
              Dopo aver analizzato e predisposto numerose offerte
              tecniche, alcuni errori tendono a ripetersi.
            </p>

            <ErrorCard number="1" title="Scrivere una relazione generica">
              <p className={p}>È probabilmente l&apos;errore più grave.</p>
              <p className={p}>
                Cambiare il nome della stazione appaltante in un documento
                già utilizzato per un&apos;altra gara non significa
                personalizzare un&apos;offerta tecnica.
              </p>
              <p className={p}>
                La personalizzazione deve riguardare organizzazione,
                metodologie, personale, attrezzature, controlli e
                migliorie.
              </p>
            </ErrorCard>

            <ErrorCard number="2" title="Non seguire esattamente criteri e sub-criteri">
              <p className={p}>
                Se il disciplinare divide la valutazione in 12
                sub-criteri, la relazione dovrebbe consentire di
                identificare chiaramente la risposta fornita a ciascuno
                di essi.
              </p>
              <p className={p}>
                Un metodo particolarmente efficace consiste nel
                costruire, prima ancora di iniziare la redazione, una
                matrice criterio → contenuto → evidenza → pagina della
                relazione.
              </p>
              <p className={p}>
                Riduce il rischio di dimenticare elementi potenzialmente
                decisivi.
              </p>
            </ErrorCard>

            <ErrorCard number="3" title="Utilizzare dichiarazioni non misurabili">
              <p className={p}>&quot;Massima qualità.&quot;</p>
              <p className={p}>&quot;Personale altamente qualificato.&quot;</p>
              <p className={p}>&quot;Macchinari innovativi.&quot;</p>
              <p className={p}>&quot;Controlli costanti.&quot;</p>
              <p className={p}>
                Sono affermazioni deboli se non vengono accompagnate da
                dati.
              </p>
              <p className={p}>Meglio indicare:</p>
              <ul className={ul}>
                <li>quale formazione;</li>
                <li>quante ore;</li>
                <li>quale macchinario;</li>
                <li>quale produttività;</li>
                <li>quale frequenza di controllo;</li>
                <li>quale KPI;</li>
                <li>quale tempo di intervento.</li>
              </ul>
            </ErrorCard>

            <ErrorCard number="4" title="Creare incoerenze tra i diversi capitoli">
              <p className={p}>
                Cinque addetti nell&apos;organigramma, sei nella
                turnazione.
              </p>
              <p className={p}>
                Un monte ore indicato in una tabella e un valore
                differente in un&apos;altra.
              </p>
              <p className={p}>
                Un macchinario citato nella metodologia ma assente
                nell&apos;elenco delle attrezzature.
              </p>
              <p className={p}>
                Sono piccoli errori che possono compromettere la
                credibilità complessiva della proposta.
              </p>
              <p className={p}>
                Una relazione tecnica deve essere controllata anche
                orizzontalmente, verificando la coerenza di tutti i dati
                presenti nel documento.
              </p>
            </ErrorCard>

            <ErrorCard number="5" title="Ignorare i limiti redazionali">
              <p className={p}>
                Numero massimo di pagine, font, corpo carattere,
                interlinea, margini, dimensioni degli allegati e modalità
                di sottoscrizione devono essere verificati prima di
                iniziare.
              </p>
              <p className={p}>
                Il mancato rispetto delle prescrizioni può comportare,
                secondo quanto stabilito dalla documentazione di gara, la
                mancata valutazione delle parti eccedenti, penalizzazioni
                o altre conseguenze previste dalla lex specialis.
              </p>
              <Callout variant="warning" eyebrow="Attenzione">
                Non bisogna arrivare alla fine della redazione per
                scoprire che una relazione di 45 pagine deve essere
                ridotta a 25.
              </Callout>
            </ErrorCard>

            <ErrorCard number="6" title="Limitarsi a dichiarare la conformità ai CAM">
              <p className={p}>
                Scrivere &quot;tutti i prodotti saranno conformi ai
                CAM&quot; non equivale a dimostrarlo.
              </p>
              <p className={p}>
                Occorre verificare quali prescrizioni siano applicabili,
                quali prodotti e processi siano interessati e quale
                documentazione permetta di comprovarne il rispetto.
              </p>
            </ErrorCard>

            <ErrorCard number="7" title="Proporre migliorie economicamente insostenibili">
              <p className={p}>
                Ogni miglioria promessa diventa, in caso di
                aggiudicazione, un impegno contrattuale nei termini
                previsti dalla gara.
              </p>
              <p className={p}>
                Per questo il progetto tecnico deve essere verificato
                anche sotto il profilo economico.
              </p>
              <p className={p}>
                Promettere personale, servizi, macchinari o prestazioni
                aggiuntive senza calcolarne il costo può trasformare una
                gara vinta in una commessa non sostenibile.
              </p>
            </ErrorCard>

            <h2 id="controllo-finale" className={h2}>
              Prima di consegnare: il controllo finale dell&apos;offerta
            </h2>
            <p className={p}>
              Prima del caricamento sulla piattaforma di gara è
              consigliabile effettuare almeno quattro controlli distinti:
            </p>
            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              {[
                {
                  nome: "Controllo tecnico",
                  domanda: "Ogni criterio ha ricevuto una risposta completa?",
                },
                {
                  nome: "Controllo numerico",
                  domanda:
                    "Ore, addetti, turni, frequenze e quantità sono coerenti tra loro?",
                },
                {
                  nome: "Controllo formale",
                  domanda:
                    "Pagine, font, allegati e prescrizioni del disciplinare sono rispettati?",
                },
                {
                  nome: "Controllo economico",
                  domanda:
                    "Le migliorie e le prestazioni dichiarate sono realmente sostenibili?",
                },
              ].map((controllo) => (
                <div
                  key={controllo.nome}
                  className="rounded-2xl border border-border bg-cream-soft p-5"
                >
                  <p className="font-mono text-xs tracking-wide text-forest uppercase">
                    {controllo.nome}
                  </p>
                  <p className="mt-2 text-sm leading-relaxed text-ink">
                    {controllo.domanda}
                  </p>
                </div>
              ))}
            </div>
            <p className={p}>
              Solo dopo questi controlli il documento può essere
              considerato pronto per la presentazione.
            </p>

            <h2 id="parti-da-una-base" className={h2}>
              Vuoi partire da una relazione tecnica già strutturata?
            </h2>
            <p className={p}>
              Ora conosci gli elementi principali che compongono
              un&apos;offerta tecnica per una gara di servizi di pulizia.
            </p>
            <p className={p}>
              Puoi partire da un documento vuoto e costruire ogni sezione
              da zero oppure utilizzare{" "}
              <Link href="/prodotti" className={link}>
                una struttura professionale già predisposta
              </Link>{" "}
              da chi lavora quotidianamente sulle gare d&apos;appalto.
            </p>

            <div id="anteprima-download-2">
              <DownloadCta variant="seconda" />
            </div>

            <h2 id="faq" className={h2}>
              Domande frequenti sull&apos;offerta tecnica per gare di
              pulizia
            </h2>
            <div className="mt-6 divide-y divide-border">
              {faqs.map((faq) => (
                <details key={faq.domanda} className="group py-5 first:pt-0">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-serif text-lg text-ink">
                    {faq.domanda}
                    <span className="shrink-0 font-mono text-xl text-forest transition-transform group-open:rotate-45">
                      +
                    </span>
                  </summary>
                  <p className={p}>{faq.risposta}</p>
                </details>
              ))}
            </div>
        </div>
      </div>
    </main>
  );
}
