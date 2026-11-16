import type { Metadata } from "next";
import Link from "next/link";
import { MarchioStatoProvider } from "@/components/omnia-ai/marchio-stato-context";
import SiteHeader from "@/components/omnia-ai/site-header";
import HeroDemo from "@/components/omnia-ai/hero-demo";
import AnteprimaRelazione from "@/components/omnia-ai/anteprima-relazione";
import FaqAccordion from "@/components/omnia-ai/faq-accordion";
import SchermataPiattaforma from "@/components/omnia-ai/schermata-piattaforma";
import SiteFooter from "@/components/omnia-ai/site-footer";
import { OMNIA_AI_BASE_URL } from "@/lib/zone";
import { PIANI, PIANI_ORDINE } from "@/lib/omnia-ai-plans";
import { SITO_FAQ_PIANO_LAVORO, SITO_HOME_PIANO_LAVORO } from "@/lib/piano-lavoro-testi";
import {
  OMNIA_AI_LOGO_URL,
  OMNIA_AI_NOME,
  OMNIA_AI_NOMI_ALTERNATIVI,
  paginaMetadata,
} from "@/lib/omnia-ai-seo";

// Title entro ~60 caratteri, description entro ~155: oltre, Google li taglia.
export const metadata: Metadata = paginaMetadata({
  title: "OMNIA AI — Intelligenza artificiale per gare d'appalto",
  description:
    "AI per gare d'appalto: OMNIA AI analizza bando, disciplinare e capitolato e genera l'offerta tecnica in Word. Dieci anni di esperienza nelle gare.",
  path: "/",
});

// Dati strutturati della home: Organization (chi è), SoftwareApplication
// (cos'è il prodotto) e WebSite (il nome che Google mostra nei risultati),
// collegati tra loro da @id. Nessun `offers` né `aggregateRating`: non ci
// sono recensioni da citare, e senza rating Google non mostra comunque il
// rich result del software.
const ORGANIZATION_ID = `${OMNIA_AI_BASE_URL}/#organization`;

const JSON_LD = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": ORGANIZATION_ID,
      name: OMNIA_AI_NOME,
      alternateName: OMNIA_AI_NOMI_ALTERNATIVI,
      url: OMNIA_AI_BASE_URL,
      logo: { "@type": "ImageObject", url: OMNIA_AI_LOGO_URL, width: 512, height: 512 },
      slogan: "TECH WHEN POSSIBLE. HUMAN WHEN IT MATTERS.",
      // Altri profili ufficiali (LinkedIn, ecc.) vanno aggiunti qui.
      sameAs: ["https://omniaitalia.com"],
    },
    {
      "@type": "SoftwareApplication",
      "@id": `${OMNIA_AI_BASE_URL}/#software`,
      name: OMNIA_AI_NOME,
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      inLanguage: "it",
      url: `${OMNIA_AI_BASE_URL}/`,
      description:
        "OMNIA AI è il software di intelligenza artificiale per gare d'appalto: analizza bando, disciplinare e capitolato e genera l'offerta tecnica (relazione tecnica) già impaginata in Word, per gare di soft e hard facility management; per le gare di servizi di pulizia costruisce anche il piano di lavoro in Excel.",
      publisher: { "@id": ORGANIZATION_ID },
    },
    {
      "@type": "WebSite",
      "@id": `${OMNIA_AI_BASE_URL}/#website`,
      name: OMNIA_AI_NOME,
      alternateName: OMNIA_AI_NOMI_ALTERNATIVI,
      url: `${OMNIA_AI_BASE_URL}/`,
      inLanguage: "it",
      publisher: { "@id": ORGANIZATION_ID },
    },
  ],
};

// I tre passi di «Come funziona» nella home. Nessuna promessa di conformità o di aggiudicazione: la verifica resta a chi firma.
const PASSI = [
  {
    titolo: "Carichi i documenti di gara",
    testo: "Bando, disciplinare, capitolato e allegati, in PDF o Word: gli stessi file che scarichi dalla piattaforma della stazione appaltante.",
  },
  {
    titolo: "OMNIA AI analizza ed elabora",
    testo: "Individua scadenze, criteri, punteggi, formattazione richiesta e limite di pagine, e imposta l'offerta tecnica sulla griglia di valutazione.",
  },
  {
    titolo: "Scarichi e perfezioni",
    testo: "Ottieni il documento Word strutturato e modificabile: lo completi con i dati della tua azienda e fai la verifica finale prima della consegna.",
  },
];

// Strumenti realmente disponibili (verificati sul codice il 16/11/2026), divisi tra ciò che l'abbonamento comprende e i servizi
// aggiuntivi. Ciò che è ancora in sviluppo non compare (accesso API, scouting dei bandi). Nessun prezzo: stanno nella pagina dei piani.
const COMPRESI = [
  {
    titolo: "Offerta tecnica in Word",
    testo: "La relazione completa, organizzata per criterio, con indice, intestazioni con il tuo logo, stili e numerazione già impostati.",
  },
  {
    titolo: "Analisi dei documenti di gara",
    testo: "Criteri, sotto-criteri e punteggi, scadenze e proroghe; un assistente a cui fare domande sui documenti, con i riferimenti delle risposte.",
  },
  {
    titolo: "Tabelle, schemi e indicatori",
    testo: "Tabelle formattate, cronoprogrammi, organigrammi, schemi di processo e quadri di indicatori (KPI), inseriti nel documento dove servono.",
  },
];
const AGGIUNTIVI = [
  {
    titolo: "Piano di lavoro in Excel",
    testo: "Per le gare di servizi di pulizia: monte ore, organico e attrezzature con formule attive.",
    stato: "Compreso o acquistabile, secondo il piano",
    href: "#piano-di-lavoro",
  },
  {
    titolo: "Copertina della relazione",
    testo: "La copertina grafica in PDF e PNG, con i loghi che carichi, da rifinire chiedendo le modifiche in chat.",
    stato: "Compresa o acquistabile, secondo il piano",
    href: "/piani",
  },
  {
    titolo: "Revisione umana",
    testo: "I consulenti di Omnia Consulting rivedono il documento generato prima della consegna.",
    stato: "Servizio a pagamento",
    href: "/piani",
  },
];

// Perché OMNIA AI: quattro differenze verificabili (il formato Word e la revisione umana sono già spiegati sopra).
const PERCHE = [
  {
    titolo: "Il metodo di chi scrive offerte tecniche",
    testo: "Nasce dall'esperienza di professionisti che da oltre dieci anni preparano offerte tecniche per gare di facility management.",
  },
  {
    titolo: "Ragiona sulla griglia di valutazione",
    testo: "Riconosce criteri, sotto-criteri, pesi e formule di attribuzione, e dimensiona ogni criterio sul suo peso e sul limite di pagine.",
  },
  {
    titolo: "Il vocabolario del settore",
    testo: "CAM, Ecolabel, UNI EN 13549, LQA e KPI, monte ore, DPI, non conformità: termini usati come li usa una commissione.",
  },
  {
    titolo: "Riservatezza dei documenti",
    testo: "Ogni gara resta nel tuo spazio privato; i documenti non vengono usati per addestrare modelli e puoi cancellarli quando vuoi.",
  },
];

// Le risposte rispettano le Condizioni di abbonamento (art. 5: quando si consuma una gara, crediti aggiuntivi) e la pagina Riservatezza.
const FAQ = [
  {
    domanda: "Su quali gare funziona davvero?",
    risposta:
      "Su gare di soft e hard facility management: pulizie e sanificazione, facchinaggio, ausiliariato, portierato, manutenzione edile, idrica ed elettrica, sorveglianza armata e non armata, gestione e manutenzione di elisuperfici. È una specializzazione verticale, non una piattaforma buona per tutto: fuori da questi settori non ti darebbe lo stesso livello di dettaglio, e preferiamo dirtelo prima.",
  },
  {
    domanda: "Il documento è pronto da consegnare in gara?",
    risposta:
      "È una bozza avanzata, già impaginata e coerente con la griglia di valutazione. Restano da inserire i dati specifici della tua azienda e da verificare i riferimenti al bando: nessuna offerta dovrebbe essere consegnata senza il controllo di chi la firma. Il tempo che risparmi è quello della stesura e dell'impaginazione, non quello della responsabilità.",
  },
  {
    domanda: "Che formato esce, e posso modificarlo?",
    risposta:
      "Un file Word .docx completamente modificabile, con stili, indice, intestazioni, piè di pagina e tabelle già impostati. Lo apri, lo adatti, lo consegni.",
  },
  {
    domanda: "I documenti di gara che carico restano riservati?",
    risposta:
      "Sì. Ogni gara vive in uno spazio privato del tuo account, e i tuoi documenti non vengono usati per addestrare modelli. Il nostro personale può accedervi solo nei casi indicati nella pagina Riservatezza (per esempio l'assistenza o la revisione umana che richiedi tu), e ogni accesso è registrato. Puoi cancellare una gara e i suoi documenti quando vuoi.",
  },
  {
    domanda: "Come funzionano abbonamento, gare e crediti?",
    risposta:
      "L'abbonamento è mensile e comprende un numero di gare al mese, diverso per piano. Una gara si consuma quando avvii l'analisi dei documenti: da quel momento generazioni, revisioni e rielaborazioni della stessa gara sono comprese, senza altri consumi. Le gare non usate non si cumulano al mese successivo. Se te ne servono di più puoi acquistare crediti aggiuntivi, che non scadono a fine mese e restano validi finché l'abbonamento è attivo. I servizi aggiuntivi della gara e la revisione umana hanno condizioni proprie, indicate nella pagina dei piani.",
  },
  // il piano di lavoro in Excel (testo in piano-lavoro-testi.ts, lo stesso che si fa vedere al legale)
  SITO_FAQ_PIANO_LAVORO,
  {
    domanda: "Che differenza c'è tra le rielaborazioni e la revisione umana?",
    risposta:
      "Le rielaborazioni sono le modifiche che chiedi a OMNIA AI sulla stessa gara: sono comprese nell'abbonamento. La revisione umana è un servizio a pagamento, separato dall'abbonamento: la richiedi dalla piattaforma e i consulenti di Omnia Consulting rivedono il documento generato. Puoi anche affidarci la redazione completa dell'offerta.",
  },
];

export default function OmniaAiHomePage() {
  return (
    <MarchioStatoProvider>
      {/* "<" viene sostituito con < nel JSON serializzato, come indica
          la guida JSON-LD di Next.js: nessuna stringa può chiudere il tag. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD).replace(/</g, "\\u003c") }}
      />
      <SiteHeader />
      {/* Hero e «Scopri cosa genera OMNIA AI» (esempi consultabili) stanno nel componente client; l'anteprima del documento
          è un componente server passato come contenuto. */}
      <HeroDemo anteprimaDocumento={<AnteprimaRelazione />} />

      <div className="omnia-wrap">
        {/* Schermate vere dell'area riservata, rese anonime (vedi schermata-piattaforma.tsx) */}
        <section className="omnia-section" id="piattaforma" aria-labelledby="omnia-piattaforma-titolo">
          <p className="omnia-occhiello">Dentro la piattaforma</p>
          <h2 id="omnia-piattaforma-titolo">Uno spazio di lavoro pensato per chi prepara le gare</h2>
          <p className="omnia-guida">Interfaccia reale, dati sostituiti per riservatezza.</p>
          <div className="omnia-schermate">
            <SchermataPiattaforma
              schermata="dashboard"
              titolo="Tutte le gare sotto controllo"
              testo="Scadenze, gare del piano disponibili e stato di ogni relazione in una sola schermata."
              dettagli={["gare"]}
            />
            <SchermataPiattaforma
              schermata="datiGara"
              titolo="I dati della gara, già estratti"
              testo="Scadenza, formattazione richiesta, limite di pagine, criteri e requisiti ricavati dai documenti, pronti da verificare."
              dettagli={["vincoli", "criteri"]}
            />
          </div>
        </section>

        <section className="omnia-section" id="funziona" aria-labelledby="omnia-funziona-titolo">
          <p className="omnia-occhiello">Come funziona</p>
          <h2 id="omnia-funziona-titolo">Dai documenti di gara all&apos;offerta tecnica, in tre passaggi</h2>
          <ol className="omnia-tappe">
            {PASSI.map((p, i) => (
              <li key={p.titolo} className="omnia-tappa">
                <span className="omnia-tappa-numero" aria-hidden="true">
                  {i + 1}
                </span>
                <h3>{p.titolo}</h3>
                <p>{p.testo}</p>
              </li>
            ))}
          </ol>
          {/* richiamo intermedio alla demo: una riga, senza barre fisse */}
          <div className="omnia-richiamo">
            <p>
              <b>Vuoi vederlo su una gara a cui stai lavorando?</b> In demo partiamo da un bando che ti
              interessa.
            </p>
            <Link className="omnia-btn omnia-btn-p" href="/demo">
              Richiedi la demo
            </Link>
          </div>
        </section>

        <section className="omnia-section" id="strumenti" aria-labelledby="omnia-strumenti-titolo">
          <p className="omnia-occhiello">Strumenti e servizi</p>
          <h2 id="omnia-strumenti-titolo">Molto più di un&apos;offerta tecnica</h2>
          <h3 className="omnia-gruppo-titolo">Compreso nell&apos;abbonamento</h3>
          <ul className="omnia-schede">
            {COMPRESI.map((s) => (
              <li key={s.titolo} className="omnia-scheda">
                <h3>{s.titolo}</h3>
                <p>{s.testo}</p>
              </li>
            ))}
          </ul>
          <h3 className="omnia-gruppo-titolo">Servizi aggiuntivi, quando servono</h3>
          <ul className="omnia-schede omnia-schede-aggiuntive">
            {AGGIUNTIVI.map((s) => (
              <li key={s.titolo} className="omnia-scheda">
                <span className="omnia-scheda-stato">{s.stato}</span>
                <h3>{s.titolo}</h3>
                <p>{s.testo}</p>
                <Link className="omnia-scheda-link" href={s.href}>
                  {s.href === "#piano-di-lavoro" ? "Cosa contiene" : "Condizioni nella pagina dei piani"}
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <section className="omnia-section" id="piano-di-lavoro">
          <div className="omnia-duo">
            <div>
              <p className="omnia-occhiello">Servizi di pulizia</p>
              <h2>{SITO_HOME_PIANO_LAVORO.titolo}</h2>
              <p className="omnia-guida">{SITO_HOME_PIANO_LAVORO.guida}</p>
              <div className="omnia-azioni omnia-azioni-sinistra">
                <Link className="omnia-btn omnia-btn-s" href="/piani">
                  {SITO_HOME_PIANO_LAVORO.collegamento}
                </Link>
              </div>
            </div>
            <div>
              <ul className="omnia-elenco" style={{ marginTop: 0 }}>
                {SITO_HOME_PIANO_LAVORO.punti.map((punto) => (
                  <li key={punto}>{punto}</li>
                ))}
              </ul>
              <p className="micro omnia-nota-sinistra">{SITO_HOME_PIANO_LAVORO.nota}</p>
            </div>
          </div>
        </section>

        <section className="omnia-section" id="perche" aria-labelledby="omnia-perche-titolo">
          <p className="omnia-occhiello">Perché OMNIA AI</p>
          <h2 id="omnia-perche-titolo">Perché scegliere OMNIA AI e non un&apos;AI generica</h2>
          <p className="omnia-guida">
            La differenza non è il modello linguistico. È sapere come si prepara un&apos;offerta tecnica
            che una commissione legge, confronta e valuta.
          </p>
          <ul className="omnia-tre omnia-quattro">
            {PERCHE.map((v) => (
              <li key={v.titolo} className="omnia-cella">
                <h3>{v.titolo}</h3>
                <p>{v.testo}</p>
              </li>
            ))}
          </ul>
          <p className="omnia-nota-sezione">
            Come trattiamo i documenti che ci affidi:{" "}
            <Link href="/riservatezza">Riservatezza e trattamento dei dati</Link>.
          </p>
        </section>

        <section className="omnia-section">
          <div className="omnia-dietro">
            <div>
              <h2>Chi c&apos;è dietro</h2>
              <p className="omnia-slogan omnia-slogan-grande" lang="en">
                <span className="omnia-slogan-tech">TECH WHEN POSSIBLE.</span>{" "}
                <span className="omnia-slogan-human">HUMAN WHEN IT MATTERS.</span>
              </p>
            </div>
            <div>
              {/* Società, esperienza delle persone e metodo, tenuti distinti: i «dieci anni» sono l'esperienza dei professionisti,
                  non l'età della società (non verificata). */}
              <dl className="omnia-dietro-elenco">
                <div>
                  <dt>La società</dt>
                  <dd>
                    OMNIA AI è sviluppata da <strong>Omnia Consulting SRLS</strong>, società di consulenza per
                    le gare d&apos;appalto.
                  </dd>
                </div>
                <div>
                  <dt>Le persone</dt>
                  <dd>
                    Professionisti che da oltre dieci anni preparano offerte tecniche per gare di soft e hard
                    facility management: pulizie e sanificazione, facchinaggio, ausiliariato, portierato,
                    manutenzioni, vigilanza, elisuperfici.
                  </dd>
                </div>
                <div>
                  <dt>Il metodo</dt>
                  <dd>
                    OMNIA AI applica quel modo di lavorare: la tecnologia dove fa risparmiare tempo, le persone
                    dove serve giudizio, con la revisione dei consulenti quando la posta in gioco è alta.
                  </dd>
                </div>
              </dl>
              <div className="omnia-azioni omnia-azioni-sinistra">
                <a className="omnia-btn omnia-btn-s" href="https://omniaitalia.com">
                  Scopri Omnia Consulting
                </a>
              </div>
            </div>
          </div>
        </section>

        <section className="omnia-section" id="piani" aria-labelledby="omnia-piani-titolo">
          <p className="omnia-occhiello">Piani e abbonamenti</p>
          <h2 id="omnia-piani-titolo">Un piano per ogni ritmo di partecipazione</h2>
          <p className="omnia-guida">
            Abbonamento mensile con un numero di gare incluso. Una gara si consuma quando avvii
            l&apos;analisi dei documenti: da lì in poi generazioni e rielaborazioni sulla stessa gara sono
            comprese.
          </p>
          {/* Nomi, gare incluse e descrizioni dalla stessa costante della pagina dei piani; i prezzi NO: stanno solo lì, letti
              dalla console (sconti compresi), così la home non può mai mostrare un prezzo diverso. */}
          <ul className="omnia-piani-sintesi">
            {PIANI_ORDINE.map((slug) => {
              const p = PIANI[slug];
              return (
                <li key={slug} className={`omnia-piano-sintesi${p.inEvidenza ? " in-evidenza" : ""}`}>
                  <h3>{p.nome}</h3>
                  <p className="omnia-piano-gare">
                    <strong>{p.gareIncluse}</strong> gare incluse ogni mese
                  </p>
                  <p>{p.descrizione}</p>
                </li>
              );
            })}
          </ul>
          <div className="omnia-azioni">
            <Link className="omnia-btn omnia-btn-s" href="/piani">
              Confronta piani e prezzi
            </Link>
          </div>
          <p className="micro omnia-piani-nota-home">Puoi acquistare l&apos;abbonamento online dalla pagina dei piani; la demo è facoltativa.</p>
        </section>

        <section className="omnia-section" id="domande" aria-labelledby="omnia-faq-titolo">
          <p className="omnia-occhiello">Domande frequenti</p>
          <h2 id="omnia-faq-titolo">Le risposte, prima della demo</h2>
          <FaqAccordion voci={FAQ} />
        </section>

        <section className="omnia-section omnia-finale" id="demo">
          <h2>Portaci una gara vera. Ti mostriamo cosa esce</h2>
          <p className="omnia-guida">
            Nessuna presentazione preconfezionata: lavoriamo su un bando che ti interessa davvero.
            Compili il modulo e scegli subito giorno e ora nel calendario.
          </p>
          <div className="omnia-azioni">
            <Link className="omnia-btn omnia-btn-p" href="/demo">
              Richiedi la demo
            </Link>
          </div>
        </section>

        <SiteFooter />
      </div>
    </MarchioStatoProvider>
  );
}
