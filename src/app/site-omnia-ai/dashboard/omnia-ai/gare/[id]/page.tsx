import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { downloadGaraDocumento } from "@/app/actions/download";
import { deleteGara, removeGaraDocumento } from "@/app/actions/gare";
import OpenInNewTabButton from "@/components/open-in-new-tab-button";
import DeleteButton from "@/components/delete-button";
import UploadDocumentoForm from "./upload-documento-form";
import LogoClienteForm from "./logo-cliente-form";
import ExtractionSection, { type Estrazione } from "./extraction-section";
import ChatSection, { type GaraMessaggio } from "./chat-section";

type Gara = {
  id: string;
  titolo: string;
  created_at: string;
  logo_cliente_path: string | null;
} & Estrazione;

type Documento = {
  id: string;
  nome_file: string;
  created_at: string;
};

export default async function GaraPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // La RLS ("gare_all_own") garantisce che questa query restituisca la
  // gara solo se appartiene all'utente corrente.
  const { data: gara, error: garaError } = await supabase
    .from("gare")
    .select(
      "id, titolo, created_at, logo_cliente_path, scadenza, importo, criteri_valutazione, requisiti, limiti_formattazione, relazione_font, relazione_dimensione_carattere, relazione_interlinea, limite_pagine_totale, punteggio_tecnico_max, punteggio_economico_max, criteri_riepilogo, requisiti_chiave, estrazione_stato, estrazione_aggiornata_il",
    )
    .eq("id", id)
    .single<Gara>();

  // Un errore del database (es. una migrazione non ancora applicata, con
  // colonne mancanti) va distinto da "gara non trovata": altrimenti
  // diventa un 404 silenzioso senza nessuna indicazione della vera causa
  // (bug osservato in pratica, ha richiesto un'indagine manuale).
  if (garaError) {
    console.error("Errore caricamento gara:", garaError);
    throw new Error(
      `Errore nel caricamento della gara: ${garaError.message}. Controlla che tutte le migrazioni del database siano state applicate.`,
    );
  }

  if (!gara) {
    notFound();
  }

  const [{ data: documenti }, { data: messaggiRaw }, { data: chunksRaw }, { data: allegatiRaw }] =
    await Promise.all([
      supabase
        .from("gara_documenti")
        .select("id, nome_file, created_at")
        .eq("gara_id", id)
        .order("created_at", { ascending: false })
        .returns<Documento[]>(),
      supabase
        .from("gara_messaggi")
        .select("id, ruolo, contenuto, created_at, file_nome, file_path")
        .eq("gara_id", id)
        .order("created_at", { ascending: true })
        .returns<Omit<GaraMessaggio, "allegati">[]>(),
      supabase
        .from("gara_documenti_chunks")
        .select("documento_id")
        .eq("gara_id", id)
        .returns<{ documento_id: string }[]>(),
      supabase
        .from("gara_messaggio_allegati")
        .select("id, messaggio_id, nome_file")
        .eq("gara_id", id)
        .order("created_at", { ascending: true })
        .returns<{ id: string; messaggio_id: string; nome_file: string }[]>(),
    ]);

  const allegatiPerMessaggio = new Map<string, { id: string; nome_file: string }[]>();
  for (const a of allegatiRaw ?? []) {
    const lista = allegatiPerMessaggio.get(a.messaggio_id) ?? [];
    lista.push({ id: a.id, nome_file: a.nome_file });
    allegatiPerMessaggio.set(a.messaggio_id, lista);
  }
  const messaggi: GaraMessaggio[] = (messaggiRaw ?? []).map((m) => ({
    ...m,
    allegati: allegatiPerMessaggio.get(m.id) ?? [],
  }));

  const chunkCountPerDocumento = new Map<string, number>();
  for (const chunk of chunksRaw ?? []) {
    chunkCountPerDocumento.set(
      chunk.documento_id,
      (chunkCountPerDocumento.get(chunk.documento_id) ?? 0) + 1,
    );
  }

  return (
    <main className="flex-1">
      <div className="mx-auto max-w-4xl px-4 py-16 sm:px-6">
        <Link
          href="/dashboard/omnia-ai/gare"
          className="font-mono text-xs tracking-wide text-sage uppercase hover:text-ink"
        >
          ← Le tue gare
        </Link>

        <div className="mt-4 flex items-start justify-between gap-4">
          <div>
            <h1 className="font-serif text-3xl text-ink">{gara.titolo}</h1>
            <p className="mt-1 text-xs text-sage">
              Creata il {new Date(gara.created_at).toLocaleDateString("it-IT")}
            </p>
          </div>
          <DeleteButton
            action={deleteGara}
            hiddenFields={{ garaId: gara.id }}
            confirmMessage={`Eliminare definitivamente la gara "${gara.titolo}" e tutti i documenti caricati? L'operazione non è reversibile.`}
            label="Elimina gara"
            className="shrink-0 rounded-full border border-red-700 px-4 py-1.5 font-mono text-xs tracking-wide text-red-700 uppercase hover:bg-red-700 hover:text-cream"
          />
        </div>

        <section className="mt-8 rounded-2xl border border-border bg-cream-soft p-5">
          <h2 className="font-mono text-xs tracking-wide text-sage uppercase">
            Documenti
          </h2>
          <p className="mt-1 text-xs text-sage">
            Carica bando, disciplinare, capitolato e ogni altro documento
            collegato a questa gara.
          </p>

          <ul className="mt-4 space-y-2">
            {documenti?.length ? (
              documenti.map((d) => (
                <li
                  key={d.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border bg-cream px-3 py-2 text-sm"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-ink">{d.nome_file}</span>
                    {(() => {
                      const n = chunkCountPerDocumento.get(d.id) ?? 0;
                      return n > 0 ? (
                        <span className="shrink-0 rounded-full bg-forest/10 px-2 py-0.5 font-mono text-[10px] tracking-wide text-forest uppercase">
                          Indicizzato ({n})
                        </span>
                      ) : (
                        <span className="shrink-0 rounded-full bg-red-700/10 px-2 py-0.5 font-mono text-[10px] tracking-wide text-red-700 uppercase">
                          Non indicizzato
                        </span>
                      );
                    })()}
                  </span>
                  <div className="flex shrink-0 items-center gap-2">
                    <OpenInNewTabButton
                      action={downloadGaraDocumento}
                      hiddenFields={{ docId: d.id }}
                      label="Scarica"
                      className="rounded-full border border-border-strong px-2 py-1 font-mono text-[10px] tracking-wide text-ink uppercase hover:bg-ink hover:text-cream"
                    />
                    <DeleteButton
                      action={removeGaraDocumento}
                      hiddenFields={{ docId: d.id, garaId: gara.id }}
                      confirmMessage="Eliminare questo documento?"
                      label="Elimina"
                      className="font-mono text-[10px] tracking-wide text-red-700 uppercase hover:underline"
                    />
                  </div>
                </li>
              ))
            ) : (
              <p className="text-sm text-sage">Nessun documento caricato.</p>
            )}
          </ul>

          <div className="mt-5 border-t border-border pt-5">
            <UploadDocumentoForm garaId={gara.id} />
          </div>

          <LogoClienteForm garaId={gara.id} loghiCaricato={!!gara.logo_cliente_path} />
        </section>

        <ExtractionSection garaId={gara.id} estrazione={gara} />

        <ChatSection garaId={gara.id} messaggi={messaggi} />
      </div>
    </main>
  );
}
