import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { downloadGaraDocumento } from "@/app/actions/download";
import { deleteGara, removeGaraDocumento } from "@/app/actions/gare";
import OpenInNewTabButton from "@/components/open-in-new-tab-button";
import DeleteButton from "@/components/delete-button";
import UploadDocumentoForm from "./upload-documento-form";
import LogoClienteForm from "./logo-cliente-form";
import GaraTitolo from "./gara-titolo";
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
    <div className="omnia-app-shell largo">
      <Link href="/dashboard/omnia-ai/gare" className="omnia-torna">
        ← Le tue gare
      </Link>

      <div className="omnia-app-intestazione" style={{ marginTop: 16 }}>
        <div>
          <GaraTitolo garaId={gara.id} titolo={gara.titolo} />
          <p className="omnia-eyebrow" style={{ marginTop: 6 }}>
            Creata il {new Date(gara.created_at).toLocaleDateString("it-IT")}
          </p>
        </div>
        <DeleteButton
          action={deleteGara}
          hiddenFields={{ garaId: gara.id }}
          confirmMessage={
            gara.estrazione_stato === "completata"
              ? `Eliminare definitivamente la gara "${gara.titolo}" e tutti i documenti caricati? Questa gara ha già consumato una gara della tua quota (piano o credito): eliminarla non te la restituisce. L'operazione non è reversibile.`
              : `Eliminare definitivamente la gara "${gara.titolo}" e tutti i documenti caricati? L'operazione non è reversibile.`
          }
          label="Elimina gara"
          className="omnia-btn omnia-btn-s omnia-btn-piccolo"
        />
      </div>

      <section className="omnia-riquadro">
        <span className="omnia-eyebrow">Documenti</span>
        <p className="omnia-riquadro-nota">
          Carica bando, disciplinare, capitolato e ogni altro documento collegato a questa gara.
        </p>

        {documenti?.length ? (
          <div style={{ marginTop: 16 }}>
            {documenti.map((d) => {
              const n = chunkCountPerDocumento.get(d.id) ?? 0;
              return (
                <div key={d.id} className="omnia-doc">
                  <span style={{ display: "flex", minWidth: 0, alignItems: "center", gap: 10 }}>
                    <span className="nome">{d.nome_file}</span>
                    {n > 0 ? (
                      <span className="omnia-badge verde">Indicizzato ({n})</span>
                    ) : (
                      <span className="omnia-badge ambra">Non indicizzato</span>
                    )}
                  </span>
                  <div className="omnia-doc-azioni">
                    <OpenInNewTabButton
                      action={downloadGaraDocumento}
                      hiddenFields={{ docId: d.id }}
                      label="Scarica"
                      className="omnia-btn omnia-btn-s omnia-btn-piccolo"
                    />
                    <DeleteButton
                      action={removeGaraDocumento}
                      hiddenFields={{ docId: d.id, garaId: gara.id }}
                      confirmMessage="Eliminare questo documento?"
                      label="Elimina"
                      className="omnia-btn omnia-btn-s omnia-btn-piccolo"
                    />
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="omnia-elenco-vuoto" style={{ marginTop: 16 }}>
            Nessun documento caricato.
          </p>
        )}

        <div style={{ marginTop: 20, paddingTop: 20, borderTop: "1px solid var(--bordo)" }}>
          <UploadDocumentoForm garaId={gara.id} />
        </div>

        <LogoClienteForm garaId={gara.id} loghiCaricato={!!gara.logo_cliente_path} />
      </section>

      <ExtractionSection garaId={gara.id} estrazione={gara} />

      <ChatSection garaId={gara.id} messaggi={messaggi} />
    </div>
  );
}
