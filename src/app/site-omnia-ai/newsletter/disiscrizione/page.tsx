import type { Metadata } from "next";
import { redirect } from "next/navigation";
import PageShell from "@/components/omnia-ai/page-shell";
import { archivioNewsletter } from "@/lib/newsletter/archivio";
import { disiscriviConToken, mascheraEmail, riattivaConToken } from "@/lib/newsletter/disiscrizione";

export const metadata: Metadata = {
  title: "Iscrizione a Tender Weekly — OMNIA AI",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

// Pagina del link personale presente in ogni newsletter. La disiscrizione si conferma con un pulsante (POST): i filtri
// antivirus e le anteprime dei link aprono gli indirizzi con GET e non devono disiscrivere nessuno per sbaglio.
// La disiscrizione «in un clic» dei client di posta (intestazione List-Unsubscribe-Post) passa invece da /api/newsletter/disiscrizione.

const TOKEN = /^[a-f0-9]{32,64}$/;

async function confermaDisiscrizione(formData: FormData) {
  "use server";
  const t = String(formData.get("t") ?? "");
  if (!TOKEN.test(t)) redirect("/newsletter/disiscrizione");
  const motivo = String(formData.get("motivo") ?? "").slice(0, 200) || "dal link nella newsletter";
  await disiscriviConToken(t, motivo);
  redirect(`/newsletter/disiscrizione?t=${t}&fatto=1`);
}

async function iscriviDiNuovo(formData: FormData) {
  "use server";
  const t = String(formData.get("t") ?? "");
  if (!TOKEN.test(t)) redirect("/newsletter/disiscrizione");
  await riattivaConToken(t);
  redirect(`/newsletter/disiscrizione?t=${t}&riattivato=1`);
}

export default async function PaginaDisiscrizione({ searchParams }: { searchParams: Promise<{ t?: string; fatto?: string; riattivato?: string }> }) {
  const { t = "", fatto, riattivato } = await searchParams;
  const iscritto = TOKEN.test(t) ? await archivioNewsletter().iscrittoPerToken(t).catch(() => null) : null;

  let corpo: React.ReactNode;
  if (!iscritto) {
    corpo = (
      <>
        <h1>Link non valido</h1>
        <p className="omnia-sotto">Il link è incompleto o non è più valido. Per disiscriverti scrivi a <a href="mailto:info@omniaitalia.com?subject=Disiscrizione%20Tender%20Weekly">info@omniaitalia.com</a>: provvediamo subito.</p>
      </>
    );
  } else if (iscritto.stato === "iscritto") {
    corpo = (
      <>
        <h1>{riattivato ? "Iscrizione confermata" : "Vuoi disiscriverti da Tender Weekly?"}</h1>
        <p className="omnia-sotto">
          {riattivato ? "Riceverai di nuovo la newsletter all'indirizzo " : "Indirizzo: "}
          <strong>{mascheraEmail(iscritto.email)}</strong>
          {riattivato ? "." : ". Non riceverai più la newsletter. Le comunicazioni di servizio legate al tuo account, se ne hai uno, continueranno ad arrivare."}
        </p>
        {!riattivato && (
          <form action={confermaDisiscrizione} style={{ marginTop: 28 }}>
            <input type="hidden" name="t" value={t} />
            <label style={{ display: "block", marginBottom: 14 }}>
              <span style={{ display: "block", marginBottom: 6 }}>Motivo (facoltativo)</span>
              <select name="motivo" className="omnia-campo" defaultValue="">
                <option value="">Preferisco non dirlo</option>
                <option value="troppe email">Ricevo troppe email</option>
                <option value="contenuti non pertinenti">I contenuti non mi interessano</option>
                <option value="non mi sono iscritto">Non ricordo di essermi iscritto</option>
              </select>
            </label>
            <button type="submit" className="omnia-btn omnia-btn-p">
              Conferma la disiscrizione
            </button>
          </form>
        )}
      </>
    );
  } else if (iscritto.stato === "disiscritto") {
    corpo = (
      <>
        <h1>{fatto ? "Disiscrizione completata" : "Non sei iscritto"}</h1>
        <p className="omnia-sotto">
          L&apos;indirizzo <strong>{mascheraEmail(iscritto.email)}</strong> non riceverà più Tender Weekly. Ci dispiace vederti andare.
        </p>
        <form action={iscriviDiNuovo} style={{ marginTop: 28 }}>
          <input type="hidden" name="t" value={t} />
          <button type="submit" className="omnia-btn omnia-btn-s">
            Mi sono disiscritto per errore: iscrivimi di nuovo
          </button>
        </form>
      </>
    );
  } else {
    corpo = (
      <>
        <h1>Indirizzo non attivo</h1>
        <p className="omnia-sotto">
          L&apos;indirizzo <strong>{mascheraEmail(iscritto.email)}</strong> non riceve la newsletter. Per informazioni scrivi a <a href="mailto:info@omniaitalia.com">info@omniaitalia.com</a>.
        </p>
      </>
    );
  }

  return (
    <PageShell>
      <section className="omnia-pagina-hero">
        <p className="omnia-occhiello omnia-occhiello-centro">Tender Weekly</p>
        {corpo}
      </section>
    </PageShell>
  );
}
