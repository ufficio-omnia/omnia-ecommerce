import type { Metadata } from "next";
import { MarchioStatoProvider } from "@/components/omnia-ai/marchio-stato-context";
import SiteHeader from "@/components/omnia-ai/site-header";
import HeroDemo from "@/components/omnia-ai/hero-demo";
import FaqAccordion from "@/components/omnia-ai/faq-accordion";
import SiteFooter from "@/components/omnia-ai/site-footer";

export const metadata: Metadata = {
  title: "OMNIA AI — l'assistente per le gare di facility management",
  description:
    "OMNIA AI legge bando, disciplinare e capitolato e restituisce la relazione tecnica già impaginata in Word. Il metodo di dieci anni di offerte tecniche per soft e hard facility management, in mano a te.",
};

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
      "Sì. Ogni gara vive in uno spazio privato accessibile solo dal tuo account, e i tuoi documenti non vengono usati per addestrare modelli. La documentazione la puoi eliminare quando vuoi.",
  },
  {
    domanda: "Come funzionano abbonamento e crediti?",
    risposta:
      "L'accesso è ad abbonamento mensile, con un pacchetto di crediti incluso. Ogni operazione — analisi dei documenti, generazione di un criterio, revisione — consuma crediti in base al lavoro richiesto, e se finiscono puoi ricaricarli senza cambiare piano.",
  },
  {
    domanda: "Posso far rivedere il testo da un consulente vero?",
    risposta:
      "Sì. Da dentro la piattaforma puoi richiedere la revisione umana di Omnia Consulting sul documento generato, oppure affidarci la redazione completa dell'offerta. È un servizio a pagamento separato dall'abbonamento.",
  },
];

export default function OmniaAiHomePage() {
  return (
    <MarchioStatoProvider>
      <SiteHeader />
      <HeroDemo />

      <div className="omnia-wrap">
        <section className="omnia-section" id="funziona">
          <div className="omnia-duo">
            <div>
              <p className="omnia-citazione">
                In gara l&apos;impaginazione non è estetica: la commissione legge decine di
                offerte e quella che si legge meglio prende punti.
              </p>
            </div>
            <div>
              <h2>Il file esce già impaginato.</h2>
              <p className="omnia-guida">
                Non un testo da riformattare, ma un documento Word costruito come lo costruirebbe
                un consulente prima di consegnarlo.
              </p>
              <ul className="omnia-elenco">
                <li>Intestazione e piè di pagina con il tuo logo, su tutte le pagine</li>
                <li>Indice con collegamenti reali alle sezioni</li>
                <li>Tabelle a piena larghezza con intestazioni colorate</li>
                <li>Titoli di sezione, numerazione ed elenchi già impostati</li>
                <li>Parole chiave evidenziate per criterio di valutazione</li>
              </ul>
            </div>
          </div>
        </section>

        <section className="omnia-section">
          <h2>Cosa sa, che un&apos;AI generica non sa.</h2>
          <p className="omnia-guida">
            La differenza non è il modello linguistico. È sapere come si vince una gara di
            facility management.
          </p>
          <div className="omnia-tre">
            <div className="omnia-cella">
              <b>La griglia di valutazione</b>
              <p>
                Riconosce criteri, sotto-criteri, pesi e formule di attribuzione dentro il
                disciplinare, e ragiona sui punti anziché sul numero di pagine.
              </p>
            </div>
            <div className="omnia-cella">
              <b>Il vocabolario del settore</b>
              <p>
                CAM, Ecolabel, UNI EN 13549, LQA e KPI, monte ore, DPI, non conformità: termini
                usati come li usa una commissione, non come li usa un dizionario.
              </p>
            </div>
            <div className="omnia-cella">
              <b>Quanto scrivere, e dove</b>
              <p>
                Lo spazio dedicato a ogni criterio è calcolato sul suo peso e sul limite di
                pagine imposto dalla gara. Niente sezioni gonfie e criteri pesanti liquidati in
                tre righe.
              </p>
            </div>
          </div>
        </section>

        <section className="omnia-section">
          <div className="omnia-dietro">
            <div>
              <h2>Chi c&apos;è dietro.</h2>
              <p className="omnia-guida" style={{ fontSize: 15.5 }}>
                Se la bozza non ti basta, la rivediamo noi.
              </p>
            </div>
            <div>
              <p className="omnia-firma">
                <strong>Omnia Consulting SRLS</strong> redige offerte tecniche per gare di soft e
                hard facility management da oltre dieci anni: pulizie, facchinaggio,
                ausiliariato, manutenzioni. OMNIA AI nasce da quel lavoro — è il metodo di uno
                studio di consulenza messo in mano a te.
                <br />
                <br />
                Quando la posta in gioco è alta, puoi affidare il documento generato ai nostri
                consulenti per una revisione completa, oppure commissionarci l&apos;intera
                offerta.
              </p>
              <div className="omnia-azioni" style={{ justifyContent: "flex-start", marginTop: 28 }}>
                <a className="omnia-btn omnia-btn-s" href="https://omniaitalia.com">
                  Scopri Omnia Consulting
                </a>
              </div>
            </div>
          </div>
        </section>

        <section className="omnia-section" id="piani">
          <h2>Domande frequenti</h2>
          <FaqAccordion voci={FAQ} />
        </section>

        <section className="omnia-section omnia-finale" id="demo">
          <h2>Portaci una gara vera. Ti mostriamo cosa esce.</h2>
          <p className="omnia-guida">
            Nessuna presentazione preconfezionata: lavoriamo su un bando che ti interessa
            davvero.
          </p>
          <div className="omnia-azioni">
            <a className="omnia-btn omnia-btn-p" href="#">
              Richiedi la demo
            </a>
          </div>
        </section>

        <SiteFooter />
      </div>
    </MarchioStatoProvider>
  );
}
