import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import GaraRiga, { type GaraRigaProps } from "@/components/omnia-ai/gara-riga";
import CreateGaraForm from "./create-gara-form";

type GaraRow = {
  id: string;
  titolo: string;
  stazione_appaltante: string | null;
  scadenza: string | null;
  estrazione_stato: string;
};

export default async function GarePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: gare } = await supabase
    .from("gare")
    .select("id, titolo, stazione_appaltante, scadenza, estrazione_stato")
    .order("scadenza", { ascending: true, nullsFirst: false })
    .returns<GaraRow[]>();

  const gareIds = (gare ?? []).map((g) => g.id);

  const [{ data: documentiRaw }, { data: sezioniRaw }] = await Promise.all([
    supabase
      .from("gara_documenti")
      .select("gara_id")
      .eq("user_id", user.id)
      .returns<{ gara_id: string }[]>(),
    gareIds.length > 0
      ? supabase
          .from("gara_relazione_sezioni")
          .select("gara_id")
          .in("gara_id", gareIds)
          .returns<{ gara_id: string }[]>()
      : Promise.resolve({ data: [] as { gara_id: string }[] }),
  ]);

  const gareConDocumenti = new Set((documentiRaw ?? []).map((d) => d.gara_id));
  const gareConRelazione = new Set((sezioniRaw ?? []).map((s) => s.gara_id));

  const gareRighe: GaraRigaProps[] = (gare ?? []).map((g) => ({
    id: g.id,
    titolo: g.titolo,
    stazioneAppaltante: g.stazione_appaltante,
    scadenza: g.scadenza,
    estrazioneStato: g.estrazione_stato,
    documentiCaricati: gareConDocumenti.has(g.id),
    relazioneGenerata: gareConRelazione.has(g.id),
  }));

  return (
    <div className="omnia-app-shell">
      <Link href="/dashboard/omnia-ai" className="omnia-torna">
        ← OMNIA AI
      </Link>

      <h1 className="omnia-app-titolo">Le tue gare</h1>
      <p className="omnia-app-sottotitolo">
        Crea una gara per ogni bando su cui stai lavorando: sarà la tua stanza di lavoro dedicata
        dove caricare bando, disciplinare, capitolato e tutti i documenti collegati.
      </p>

      <div className="omnia-riquadro">
        <CreateGaraForm />
      </div>

      <div className="omnia-gare-elenco" style={{ marginTop: 24 }}>
        {gareRighe.length ? (
          gareRighe.map((g) => <GaraRiga key={g.id} {...g} />)
        ) : (
          <p className="omnia-elenco-vuoto">Nessuna gara creata ancora.</p>
        )}
      </div>
    </div>
  );
}
