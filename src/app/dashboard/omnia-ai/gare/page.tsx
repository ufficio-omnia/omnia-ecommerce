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
    <main className="flex-1">
      <div className="mx-auto max-w-2xl px-4 py-16 sm:px-6">
        <Link
          href="/dashboard/omnia-ai"
          className="font-mono text-xs tracking-wide text-sage uppercase hover:text-ink"
        >
          ← OMNIA AI
        </Link>

        <h1 className="mt-4 font-serif text-3xl text-ink">Le tue gare</h1>
        <p className="mt-2 text-justify text-sm text-sage">
          Crea una gara per ogni bando su cui stai lavorando: sarà la tua
          stanza di lavoro dedicata dove caricare bando, disciplinare,
          capitolato e tutti i documenti collegati.
        </p>

        <div className="mt-6">
          <CreateGaraForm />
        </div>

        <ul className="mt-8 space-y-3">
          {gare?.length ? (
            gare.map((g) => (
              <li key={g.id}>
                <Link
                  href={`/dashboard/omnia-ai/gare/${g.id}`}
                  className="block rounded-2xl border border-border bg-cream-soft p-5 transition-colors hover:border-forest"
                >
                  <p className="font-serif text-lg text-ink">{g.titolo}</p>
                  <p className="mt-1 text-xs text-sage">
                    Creata il{" "}
                    {new Date(g.created_at).toLocaleDateString("it-IT")}
                  </p>
                </Link>
              </li>
            ))
          ) : (
            <p className="text-sm text-sage">Nessuna gara creata ancora.</p>
          )}
        </ul>
      </div>
    </main>
  );
}
