import type { Metadata } from "next";
import Link from "next/link";
import PageShell from "@/components/omnia-ai/page-shell";
import { confermaTenderWeekly } from "@/app/actions/omnia-ai-newsletter";

export const metadata: Metadata = {
  title: "Conferma l'iscrizione a Tender Weekly — OMNIA AI",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

// Pagina del link di conferma (doppia conferma). Il link apre questa pagina; la conferma parte SOLO dal pulsante (POST):
// i filtri antivirus e le anteprime che aprono i link non confermano nessuno. Dopo la conferma: messaggio di benvenuto
// con la data del prossimo invio (giorno e ora della console, fuso di Roma).

function dataInvio(iso: string): { giorno: string; data: string } | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const giorno = new Intl.DateTimeFormat("it-IT", { timeZone: "Europe/Rome", weekday: "long" }).format(d);
  const data = new Intl.DateTimeFormat("it-IT", { timeZone: "Europe/Rome", day: "numeric", month: "long" }).format(d);
  return { giorno, data };
}

export default async function PaginaConferma({ searchParams }: { searchParams: Promise<{ t?: string; esito?: string; il?: string }> }) {
  const { t = "", esito, il } = await searchParams;
  let corpo: React.ReactNode;

  if (esito === "ok") {
    const invio = il ? dataInvio(il) : null;
    const giorno = invio?.giorno ?? "venerdì";
    corpo = (
      <>
        <p className="omnia-occhiello omnia-occhiello-centro">Iscrizione confermata</p>
        <h1>Benvenuto in Tender Weekly!</h1>
        <p>Grazie per esserti iscritto alla newsletter di OMNIA AI.</p>
        <p>
          Da {giorno}
          {invio ? ` ${invio.data}` : ""} riceverai direttamente nella tua casella di posta le principali novità del mondo degli appalti pubblici.
        </p>
        <p className="omnia-tw-frase">Il tuo prossimo {giorno} inizia con Tender Weekly.</p>
        <div className="omnia-azioni" style={{ marginTop: 24 }}>
          <Link className="omnia-btn omnia-btn-s" href="/">
            Scopri OMNIA AI
          </Link>
        </div>
      </>
    );
  } else if (esito === "scaduto" || esito === "non_valido" || esito === "errore") {
    corpo = (
      <>
        <p className="omnia-occhiello omnia-occhiello-centro">Tender Weekly</p>
        <h1>{esito === "scaduto" ? "Il link è scaduto" : esito === "errore" ? "Qualcosa non ha funzionato" : "Link non valido o già usato"}</h1>
        <p>
          {esito === "errore"
            ? "Non siamo riusciti a registrare la conferma. Riprova tra qualche minuto."
            : "Se hai già confermato, sei iscritto: non serve altro. Altrimenti richiedi di nuovo l'iscrizione: ti invieremo un nuovo link."}
        </p>
        <div className="omnia-azioni" style={{ marginTop: 24 }}>
          <Link className="omnia-btn omnia-btn-p" href="/newsletter">
            Torna all&apos;iscrizione
          </Link>
        </div>
      </>
    );
  } else if (/^[a-f0-9]{48}$/.test(t)) {
    corpo = (
      <>
        <p className="omnia-occhiello omnia-occhiello-centro">Tender Weekly</p>
        <h1>Conferma la tua iscrizione</h1>
        <p>Manca un clic: conferma che vuoi ricevere Tender Weekly, la newsletter settimanale di OMNIA AI sul mondo degli appalti pubblici.</p>
        <form action={confermaTenderWeekly} style={{ marginTop: 24 }}>
          <input type="hidden" name="t" value={t} />
          <button type="submit" className="omnia-btn omnia-btn-p">
            Conferma l&apos;iscrizione
          </button>
        </form>
      </>
    );
  } else {
    corpo = (
      <>
        <h1>Link non valido</h1>
        <p>Il link di conferma è incompleto.</p>
        <div className="omnia-azioni" style={{ marginTop: 24 }}>
          <Link className="omnia-btn omnia-btn-p" href="/newsletter">
            Vai all&apos;iscrizione
          </Link>
        </div>
      </>
    );
  }

  return (
    <PageShell>
      <section className="omnia-pagina-corpo" style={{ paddingTop: 56 }}>
        <div className="omnia-tw-conferma">{corpo}</div>
      </section>
    </PageShell>
  );
}
