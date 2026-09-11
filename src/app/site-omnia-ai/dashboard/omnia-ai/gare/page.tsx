import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import CreateGaraForm from "./create-gara-form";

type GaraRow = {
  id: string;
  titolo: string;
  created_at: string;
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
    .select("id, titolo, created_at")
    .order("created_at", { ascending: false })
    .returns<GaraRow[]>();

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

      <div className="omnia-elenco-riquadri">
        {gare?.length ? (
          gare.map((g) => (
            <Link key={g.id} href={`/dashboard/omnia-ai/gare/${g.id}`} className="omnia-riga-link">
              <div className="titolo">{g.titolo}</div>
              <p className="meta">Creata il {new Date(g.created_at).toLocaleDateString("it-IT")}</p>
            </Link>
          ))
        ) : (
          <p className="omnia-elenco-vuoto">Nessuna gara creata ancora.</p>
        )}
      </div>
    </div>
  );
}
