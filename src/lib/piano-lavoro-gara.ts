import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { createAnthropicClient, operazionePerRegistro } from "@/lib/anthropic";
import { logAiUsage } from "@/lib/ai-usage";
import { calcolaCostoStimato } from "@/lib/ai-pricing";
import { ordinaPerCaricamento } from "@/lib/gara-documenti-elenco";
import { schemaAssente } from "@/lib/omnia-ai-incassi";
import { estraiPianoLavoro, type UsoModello } from "@/lib/piano-lavoro-estrazione";
import { costruisciExcelPianoLavoro } from "@/lib/piano-lavoro-excel";
import type { DocumentoIn } from "@/lib/piano-lavoro-documenti";
import {
  COLONNE_PIANO,
  MIME_XLSX,
  MINUTI_GENERAZIONE_INTERROTTA,
  costruisciRiepilogo,
  erroreBreve,
  generazioneInterrotta,
  nomeFilePiano,
  percorsoFilePiano,
  riepilogoValido,
  type FonteDiritto,
  type PianoRiga,
} from "@/lib/piano-lavoro-gara-calcoli";

// Piano di lavoro dentro la gara: la generazione lato server. Prende i documenti della gara dallo storage, li fa leggere al modello
// (estraiPianoLavoro), costruisce l'Excel, lo mette nello storage e registra riga e costi. Tutto ciò che tocca l'esterno (database,
// storage, modello, registro dei costi) arriva da `dipendenze`, così scripts/verifica-piano-lavoro-gara-omnia-ai.ts lo prova senza rete.
//
// Un errore in qualunque punto lascia la riga in stato «errore» (con un testo breve) e NON consuma la versione: il cliente riprova.

// Una ricerca web del modello si paga a parte, per ricerca (stima di listino)
export const COSTO_STIMATO_RICERCA_WEB = 0.01;

export type DipendenzePiano = {
  admin: SupabaseClient;
  anthropic: Anthropic;
  registraCosto: typeof logAiUsage;
  estrai: typeof estraiPianoLavoro;
  costruisciExcel: typeof costruisciExcelPianoLavoro;
  adesso: () => Date;
};

export function dipendenzeReali(): DipendenzePiano {
  return { admin: createAdminClient(), anthropic: createAnthropicClient(), registraCosto: logAiUsage, estrai: estraiPianoLavoro, costruisciExcel: costruisciExcelPianoLavoro, adesso: () => new Date() };
}

export type EsitoGenerazione = { ok: true; versione: number } | { ok: false; errore: string };

// I piani della gara per la scheda. `disponibile` false = la tabella non c'è ancora (migrazione 0096 non eseguita) o non si legge: la
// scheda non compare e la pagina funziona come sempre.
export async function leggiPianiGara(client: SupabaseClient, garaId: string): Promise<{ disponibile: boolean; piani: PianoRiga[] }> {
  const { data, error } = await client.from("gara_piani_lavoro").select(COLONNE_PIANO).eq("gara_id", garaId).order("versione", { ascending: true });
  if (error) {
    if (!schemaAssente(error)) console.error("Piano di lavoro: lettura dei piani non riuscita", error.message);
    return { disponibile: false, piani: [] };
  }
  const piani = (data ?? []).map((r) => {
    const x = r as Record<string, unknown>;
    return {
      id: String(x.id),
      versione: Number(x.versione),
      stato: x.stato as PianoRiga["stato"],
      creata_il: String(x.creata_il),
      completata_il: (x.completata_il as string | null) ?? null,
      file_nome: (x.file_nome as string | null) ?? null,
      errore: (x.errore as string | null) ?? null,
      riepilogo: riepilogoValido(x.riepilogo),
    } satisfies PianoRiga;
  });
  return { disponibile: true, piani };
}

type RigaEsistente = { id: string; stato: string; creata_il: string };

// Apre la riga della versione: nuova, oppure — se l'ultimo tentativo è finito in errore o è rimasto interrotto — la stessa riga rimessa «in corso».
// Mai due generazioni insieme: se la riga è pronta o davvero in corso, si rifiuta.
async function apriGenerazione(
  d: DipendenzePiano,
  { garaId, accountId, versione, fonte, concessioneId }: { garaId: string; accountId: string; versione: number; fonte: FonteDiritto; concessioneId?: string | null },
): Promise<{ ok: true; id: string } | { ok: false; errore: string }> {
  const adesso = d.adesso();
  // la colonna della concessione (migrazione 0101) si scrive solo quando serve: le altre fonti funzionano anche senza la migrazione
  const colonnaConcessione = concessioneId ? { concessione_id: concessioneId } : {};
  const { data: nuova, error } = await d.admin
    .from("gara_piani_lavoro")
    .insert({ gara_id: garaId, user_id: accountId, versione, stato: "in_corso", fonte_diritto: fonte, ...colonnaConcessione, creata_il: adesso.toISOString() })
    .select("id")
    .maybeSingle<{ id: string }>();
  if (nuova) return { ok: true, id: nuova.id };
  if (error && error.code !== "23505") return { ok: false, errore: "Non riesco ad avviare la generazione del piano di lavoro. Riprova tra qualche istante." };

  const { data: esistente } = await d.admin.from("gara_piani_lavoro").select("id, stato, creata_il").eq("gara_id", garaId).eq("versione", versione).maybeSingle<RigaEsistente>();
  if (!esistente) return { ok: false, errore: "Non riesco ad avviare la generazione del piano di lavoro. Riprova tra qualche istante." };
  if (esistente.stato === "pronto") return { ok: false, errore: "Il piano di lavoro di questa versione è già stato generato." };
  if (esistente.stato === "in_corso" && !generazioneInterrotta({ stato: "in_corso", creata_il: esistente.creata_il }, adesso)) {
    return { ok: false, errore: `Una generazione è già in corso (se è ferma da più di ${MINUTI_GENERAZIONE_INTERROTTA} minuti si può riprovare).` };
  }
  // si riprende la riga solo se nel frattempo nessuno l'ha già ripresa (condizione sullo stato letto)
  const { data: ripresa } = await d.admin
    .from("gara_piani_lavoro")
    .update({ stato: "in_corso", errore: null, creata_il: adesso.toISOString(), fonte_diritto: fonte, ...colonnaConcessione })
    .eq("id", esistente.id)
    .eq("stato", esistente.stato)
    .eq("creata_il", esistente.creata_il)
    .select("id")
    .maybeSingle<{ id: string }>();
  if (!ripresa) return { ok: false, errore: "Una generazione è già in corso." };
  return { ok: true, id: ripresa.id };
}

export async function generaPianoLavoro(
  { garaId, accountId, versione, fonte, concessioneId }: { garaId: string; accountId: string; versione: number; fonte: FonteDiritto; concessioneId?: string | null },
  d: DipendenzePiano = dipendenzeReali(),
): Promise<EsitoGenerazione> {
  // la gara dev'essere dell'azienda (la chiave di servizio non conosce la RLS: il filtro è qui)
  const { data: gara } = await d.admin.from("gare").select("id, titolo").eq("id", garaId).eq("user_id", accountId).maybeSingle<{ id: string; titolo: string }>();
  if (!gara) return { ok: false, errore: "Gara non trovata." };

  const { data: documenti } = await d.admin
    .from("gara_documenti")
    .select("id, nome_file, file_path, created_at")
    .eq("gara_id", garaId)
    .returns<{ id: string; nome_file: string; file_path: string; created_at: string }[]>();
  if (!documenti || documenti.length === 0) return { ok: false, errore: "Questa gara non ha documenti: caricali e analizzali prima di generare il piano di lavoro." };

  const apertura = await apriGenerazione(d, { garaId, accountId, versione, fonte, concessioneId });
  if (!apertura.ok) return apertura;

  const usi: UsoModello[] = [];
  try {
    // i documenti dallo storage, in ordine cronologico di caricamento (le rettifiche vincono sulle versioni precedenti)
    const letti: DocumentoIn[] = [];
    const nonScaricati: string[] = [];
    for (const doc of ordinaPerCaricamento(documenti)) {
      const { data: file, error } = await d.admin.storage.from("gare").download(doc.file_path);
      if (error || !file) {
        nonScaricati.push(doc.nome_file);
        continue;
      }
      letti.push({ nome: doc.nome_file, buffer: Buffer.from(await file.arrayBuffer()) });
    }
    if (letti.length === 0) throw new Error("Nessun documento della gara si riesce a leggere dallo storage.");

    const esito = await d.estrai(letti, {
      anthropic: d.anthropic,
      cercaWeb: true,
      registraUso: async (u) => {
        usi.push(u);
        await d.registraCosto({
          userId: accountId,
          garaId,
          operazione: operazionePerRegistro(u.operazione),
          provider: "anthropic",
          model: u.model,
          inputTokens: u.inputTokens,
          outputTokens: u.outputTokens,
          cacheCreationTokens: u.cacheCreationTokens,
          cacheReadTokens: u.cacheReadTokens,
        });
      },
    });
    const dati = esito.dati;
    // i documenti che non si sono potuti scaricare vanno in copertina insieme agli altri non letti
    for (const nome of nonScaricati) dati.documenti.nonLetti.push({ nome, motivo: "non scaricabile dallo storage" });

    const { buffer } = await d.costruisciExcel(dati, { generatoIl: d.adesso() });
    const percorso = percorsoFilePiano(garaId, versione);
    const nomeFile = nomeFilePiano(gara.titolo, versione);
    const { error: erroreCaricamento } = await d.admin.storage.from("gare").upload(percorso, buffer, { contentType: MIME_XLSX, upsert: true });
    if (erroreCaricamento) throw new Error(`Salvataggio del file non riuscito: ${erroreCaricamento.message}`);

    const ricercheWeb = usi.reduce((s, u) => s + (u.ricercheWeb ?? 0), 0);
    const costo = usi.reduce((s, u) => s + (calcolaCostoStimato(u.model, u.inputTokens, u.outputTokens, { creazione: u.cacheCreationTokens, lettura: u.cacheReadTokens }) ?? 0), 0) + ricercheWeb * COSTO_STIMATO_RICERCA_WEB;

    const { error: erroreRiga } = await d.admin
      .from("gara_piani_lavoro")
      .update({
        stato: "pronto",
        file_path: percorso,
        file_nome: nomeFile,
        dimensione_byte: buffer.length,
        riepilogo: costruisciRiepilogo(dati),
        dati,
        costo_stimato: Math.round(costo * 10000) / 10000,
        richieste_modello: usi.length,
        ricerche_web: ricercheWeb,
        errore: null,
        completata_il: d.adesso().toISOString(),
      })
      .eq("id", apertura.id);
    if (erroreRiga) throw new Error(`Registrazione del piano non riuscita: ${erroreRiga.message}`);
    return { ok: true, versione };
  } catch (e) {
    console.error("Piano di lavoro: generazione non riuscita", e);
    await d.admin.from("gara_piani_lavoro").update({ stato: "errore", errore: erroreBreve(e) }).eq("id", apertura.id);
    return { ok: false, errore: "La generazione del piano di lavoro non è riuscita. Riprova: non è stata conteggiata." };
  }
}

// Il link temporaneo per scaricare il file di un piano pronto (il nome del file va passato a { download }, come per i documenti di gara)
export async function urlScaricoPiano(admin: SupabaseClient, piano: { file_path: string | null; file_nome: string | null }): Promise<{ url: string } | { errore: string }> {
  if (!piano.file_path || !piano.file_nome) return { errore: "Il file del piano di lavoro non è disponibile." };
  const { data, error } = await admin.storage.from("gare").createSignedUrl(piano.file_path, 60, { download: piano.file_nome });
  if (error || !data) return { errore: "Errore nella generazione del link di download." };
  return { url: data.signedUrl };
}
