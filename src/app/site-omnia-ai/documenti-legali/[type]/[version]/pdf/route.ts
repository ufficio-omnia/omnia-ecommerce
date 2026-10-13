import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { dataOraRoma, dataRoma } from "@/lib/data-it";
import { TIPO_DB_PER_SLUG, TITOLO_PER_TIPO_DB, impronta, leggiMarkdownLegale, nomeFilePdf } from "@/lib/legal-documenti";
import { compilaSegnaposto, dataEstesa, interpretaMarkdown } from "@/lib/legal-markdown";
import { valoriSegnaposto, type ProfiloFatturazione } from "@/lib/omnia-ai-documenti-contrattuali";
import { generaPdfLegale } from "@/lib/pdf-documento-legale";

// PDF di una versione pubblicata di un documento legale di OMNIA AI.
//
// Il testo viene dal file in legal/ indicato dalla riga di legal_documents, e prima di
// generare si controlla che l'impronta SHA-256 del file sia quella registrata: un file
// alterato non diventa mai un PDF.
//
// Pubblico: chiunque può scaricare il modello (all'Allegato A restano righe da compilare).
// Se chi scarica è un cliente collegato, l'Allegato A si compila con i dati del suo profilo
// di fatturazione; e con ?abbonamento=<id> il PDF riporta data e ora in cui quel cliente ha
// accettato quella versione (la lettura è soggetta alla RLS: vede solo le sue).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function errore(stato: number, messaggio: string) {
  return new NextResponse(messaggio, { status: stato, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ type: string; version: string }> }) {
  const { type, version } = await params;
  const tipoDb = TIPO_DB_PER_SLUG[type];
  const numero = Number(version);
  if (!tipoDb || !Number.isInteger(numero) || numero < 1) return errore(404, "Documento non trovato.");

  const supabase = await createClient();
  const { data: doc } = await supabase
    .from("legal_documents")
    .select("id, file_path, sha256, effective_date")
    .eq("document_type", tipoDb)
    .eq("version", numero)
    .maybeSingle<{ id: string; file_path: string; sha256: string; effective_date: string }>();
  if (!doc) return errore(404, "Documento non trovato.");

  // il percorso arriva dal database: si accetta solo un file markdown dentro legal/
  const nomeFile = doc.file_path.match(/^legal\/([a-z0-9-]+\.md)$/)?.[1];
  if (!nomeFile) return errore(500, "Documento non disponibile.");

  let markdown: string;
  try {
    markdown = leggiMarkdownLegale(nomeFile);
  } catch (e) {
    console.error("PDF legale: file non leggibile", doc.file_path, e);
    return errore(500, "Documento non disponibile.");
  }
  if (impronta(markdown) !== doc.sha256) {
    console.error("PDF legale: l'impronta del file non corrisponde a quella registrata", doc.file_path);
    return errore(500, "Documento non disponibile.");
  }

  let profilo: ProfiloFatturazione | null = null;
  let accettatoIl: string | null = null;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) {
    if (tipoDb === "omnia_ai_allegato_a") {
      const { data } = await supabase
        .from("companies")
        .select("ragione_sociale, partita_iva, codice_fiscale, indirizzo")
        .eq("user_id", user.id)
        .maybeSingle<ProfiloFatturazione>();
      profilo = data;
    }

    const abbonamentoId = request.nextUrl.searchParams.get("abbonamento");
    if (abbonamentoId && UUID.test(abbonamentoId)) {
      const { data } = await supabase
        .from("omnia_ai_legal_acceptances")
        .select("accepted_at")
        .eq("subscription_id", abbonamentoId)
        .eq("legal_document_id", doc.id)
        .order("accepted_at", { ascending: true })
        .limit(1)
        .maybeSingle<{ accepted_at: string }>();
      accettatoIl = data?.accepted_at ?? null;
    }
  }

  const testo = compilaSegnaposto(markdown, valoriSegnaposto(profilo, dataEstesa(doc.effective_date)), "linea");
  const pdf = await generaPdfLegale(interpretaMarkdown(testo), {
    titolo: TITOLO_PER_TIPO_DB[tipoDb] ?? "Documento",
    versione: numero,
    impronta: doc.sha256,
    accettatoIl: accettatoIl ? dataOraRoma(accettatoIl) : null,
    generatoIl: dataRoma(new Date()),
  });

  return new NextResponse(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${nomeFilePdf(tipoDb, numero)}"`,
      // personalizzato o no, non va tenuto in una cache condivisa; e non ha senso nei risultati di ricerca
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex",
    },
  });
}
