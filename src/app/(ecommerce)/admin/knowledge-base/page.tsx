import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { deleteKnowledgeBaseDocumento } from "@/app/actions/knowledge-base";
import DeleteButton from "@/components/delete-button";
import KnowledgeBaseUploadForm from "./upload-form";
import RicalcolaStrutturaButton from "./recalculate-structure-button";

type Documento = {
  id: string;
  nome_file: string;
  stato: string;
  created_at: string;
  nota_stile: string | null;
  struttura_titoli: string | null;
};

const STATO_LABEL: Record<string, string> = {
  in_elaborazione: "In elaborazione...",
  pronto: "Pronto",
  errore: "Errore o nessun testo estratto",
};

const PLACEHOLDER_REGEX = /(\[[^[\]]+\])/g;

function renderConEvidenziazione(testo: string) {
  const parti = testo.split(PLACEHOLDER_REGEX);
  return parti.map((parte, i) =>
    PLACEHOLDER_REGEX.test(parte) ? (
      <mark
        key={i}
        className="rounded bg-forest/20 px-1 font-medium text-forest-dark"
      >
        {parte}
      </mark>
    ) : (
      <span key={i}>{parte}</span>
    ),
  );
}

export default async function KnowledgeBasePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "admin") {
    redirect("/dashboard");
  }

  const { data: documenti } = await supabase
    .from("knowledge_base_documenti")
    .select("id, nome_file, stato, created_at, nota_stile, struttura_titoli")
    .order("created_at", { ascending: false })
    .returns<Documento[]>();

  const documentiPronti = (documenti ?? [])
    .filter((d) => d.stato === "pronto")
    .map((d) => d.id);

  const { data: chunksAnteprima } = documentiPronti.length
    ? await supabase
        .from("knowledge_base_chunks")
        .select("documento_id, chunk_index, contenuto")
        .in("documento_id", documentiPronti)
        .lt("chunk_index", 2)
        .order("chunk_index", { ascending: true })
        .returns<{ documento_id: string; chunk_index: number; contenuto: string }[]>()
    : { data: [] };

  const anteprimaPerDocumento = new Map<string, string>();
  for (const chunk of chunksAnteprima ?? []) {
    const attuale = anteprimaPerDocumento.get(chunk.documento_id) ?? "";
    anteprimaPerDocumento.set(chunk.documento_id, `${attuale} ${chunk.contenuto}`.trim());
  }

  return (
    <main className="flex-1">
      <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
        <Link
          href="/admin"
          className="font-mono text-xs tracking-wide text-sage uppercase hover:text-ink"
        >
          ← Pannello admin
        </Link>

        <h1 className="mt-4 font-serif text-3xl text-ink">
          Knowledge base OMNIA AI
        </h1>
        <p className="mt-2 text-justify text-sm text-sage">
          Carica progetti tecnici già svolti (PDF o Word) da usare come
          esempio di stile e qualità per OMNIA AI in tutte le chat dei
          clienti. Ogni documento viene automaticamente anonimizzato
          (nomi, aziende, indirizzi, dati identificativi sostituiti con
          segnaposto generici, evidenziati in verde nell&apos;anteprima)
          prima di essere indicizzato, e viene analizzato anche per
          impaginazione, indice/struttura e stile (titoli, tabelle, tono)
          — l&apos;AI usa tutto (testo, struttura, stile) come riferimento
          di qualità da <strong>tutti</strong> i documenti caricati, nessuno
          vale più degli altri, mai per copiare dati specifici in
          un&apos;offerta di un altro cliente.
        </p>

        <KnowledgeBaseUploadForm />

        <ul className="mt-6 space-y-2">
          {documenti?.length ? (
            documenti.map((d) => {
              const anteprima = anteprimaPerDocumento.get(d.id);
              return (
                <li
                  key={d.id}
                  className="rounded-lg border border-border bg-cream-soft px-4 py-3 text-sm"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-ink">{d.nome_file}</p>
                      <p className="mt-0.5 text-xs text-sage">
                        {STATO_LABEL[d.stato] ?? d.stato} ·{" "}
                        {new Date(d.created_at).toLocaleString("it-IT")}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      {d.stato === "pronto" && <RicalcolaStrutturaButton docId={d.id} />}
                      <DeleteButton
                        action={deleteKnowledgeBaseDocumento}
                        hiddenFields={{ docId: d.id }}
                        confirmMessage={`Eliminare "${d.nome_file}" dalla knowledge base?`}
                        label="Elimina"
                        className="font-mono text-[10px] tracking-wide text-red-700 uppercase hover:underline"
                      />
                    </div>
                  </div>

                  {d.struttura_titoli && (
                    <details className="mt-2 border-t border-border pt-2">
                      <summary className="cursor-pointer font-mono text-[10px] tracking-wide text-forest uppercase">
                        Indice/struttura rilevati
                      </summary>
                      <pre className="mt-2 whitespace-pre-wrap text-xs text-ink">
                        {d.struttura_titoli}
                      </pre>
                    </details>
                  )}

                  {d.nota_stile && (
                    <details className="mt-2 border-t border-border pt-2">
                      <summary className="cursor-pointer font-mono text-[10px] tracking-wide text-sage uppercase">
                        Stile e impaginazione rilevati
                      </summary>
                      <p className="mt-2 text-justify text-xs text-ink">
                        {d.nota_stile}
                      </p>
                    </details>
                  )}

                  {anteprima ? (
                    <details className="mt-2 border-t border-border pt-2">
                      <summary className="cursor-pointer font-mono text-[10px] tracking-wide text-sage uppercase">
                        Anteprima testo anonimizzato indicizzato
                      </summary>
                      <p className="mt-2 text-justify text-xs text-sage">
                        {renderConEvidenziazione(anteprima.slice(0, 800))}
                        {anteprima.length > 800 ? "…" : ""}
                      </p>
                    </details>
                  ) : (
                    d.stato === "pronto" && (
                      <p className="mt-2 border-t border-border pt-2 text-xs text-sage">
                        Nessun estratto disponibile per l&apos;anteprima.
                      </p>
                    )
                  )}
                </li>
              );
            })
          ) : (
            <p className="text-sm text-sage">Nessun documento caricato.</p>
          )}
        </ul>
      </div>
    </main>
  );
}
