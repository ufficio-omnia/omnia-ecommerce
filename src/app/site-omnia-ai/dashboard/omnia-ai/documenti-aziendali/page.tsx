import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { downloadGaraDocumento } from "@/app/actions/download";
import OpenInNewTabButton from "@/components/open-in-new-tab-button";

type DocumentoRow = {
  id: string;
  nome_file: string;
  created_at: string;
  gara_id: string;
  gara_titolo: string | null;
};

// Sola lettura: l'unico modo di caricare un documento resta la pagina
// della singola gara. Qui è solo una vista aggregata di quello che c'è
// già, senza un secondo percorso di upload da tenere sincronizzato.
export default async function DocumentiAziendaliPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: documenti } = await supabase
    .from("gara_documenti")
    .select("id, nome_file, created_at, gara_id")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .returns<Omit<DocumentoRow, "gara_titolo">[]>();

  const gareIds = [...new Set((documenti ?? []).map((d) => d.gara_id))];
  const { data: gareRaw } =
    gareIds.length > 0
      ? await supabase.from("gare").select("id, titolo").in("id", gareIds).returns<{ id: string; titolo: string }[]>()
      : { data: [] as { id: string; titolo: string }[] };
  const titoloPerGara = new Map((gareRaw ?? []).map((g) => [g.id, g.titolo] as const));

  const righe: DocumentoRow[] = (documenti ?? []).map((d) => ({
    ...d,
    gara_titolo: titoloPerGara.get(d.gara_id) ?? null,
  }));

  return (
    <div className="omnia-app-shell">
      <Link href="/dashboard/omnia-ai" className="omnia-torna">
        ← OMNIA AI
      </Link>

      <h1 className="omnia-app-titolo">Documenti aziendali</h1>
      <p className="omnia-app-sottotitolo">
        Tutti i documenti caricati nelle tue gare, in un unico elenco. Per aggiungerne di nuovi vai
        nella singola gara.
      </p>

      <div className="omnia-riquadro">
        {righe.length ? (
          righe.map((d) => (
            <div key={d.id} className="omnia-doc">
              <span style={{ display: "flex", minWidth: 0, flexDirection: "column" }}>
                <span className="nome">{d.nome_file}</span>
                <span style={{ fontSize: 11.5, color: "var(--fioco)" }}>
                  {d.gara_titolo ? (
                    <Link href={`/dashboard/omnia-ai/gare/${d.gara_id}`}>{d.gara_titolo}</Link>
                  ) : (
                    "Gara eliminata"
                  )}
                  {" — "}
                  {new Date(d.created_at).toLocaleDateString("it-IT")}
                </span>
              </span>
              <div className="omnia-doc-azioni">
                <OpenInNewTabButton
                  action={downloadGaraDocumento}
                  hiddenFields={{ docId: d.id }}
                  label="Scarica"
                  className="omnia-btn omnia-btn-s omnia-btn-piccolo"
                />
              </div>
            </div>
          ))
        ) : (
          <p className="omnia-elenco-vuoto">Nessun documento caricato ancora.</p>
        )}
      </div>
    </div>
  );
}
