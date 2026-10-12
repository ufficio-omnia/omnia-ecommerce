"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { richiediAdminAzione } from "@/lib/console/accesso";
import { STATI_FATTURA, leggiFiltroFattura, type StatoFattura } from "@/lib/console/fatturazione-calcoli";
import { dataRoma } from "@/lib/console/giorni-lavorativi";
import { schemaAssente } from "@/lib/omnia-ai-incassi";

// Stato di fatturazione degli incassi OMNIA AI e degli acquisti di crediti, segnato
// a mano. Ogni azione parte da richiediAdminAzione(). Tocca SOLO le colonne di
// fatturazione: importi, date di incasso e id Stripe non si modificano mai da qui.

export type StatoAzioneFattura = { errore?: string };

const CHIAVE = /^(incasso|crediti):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GIORNO = /^\d{4}-\d{2}-\d{2}$/;
const TABELLE = { incasso: "omnia_ai_incassi", crediti: "omnia_ai_credit_purchases" } as const;
const MASSIMO_RIGHE = 200;
const DATA_MINIMA = "2020-01-01";

type Valori = { stato: StatoFattura; numero: string | null; data: string | null; note: string | null };

// Legge e controlla i campi del modulo. Restituisce i valori da scrivere o il
// messaggio di errore da mostrare.
function leggiModulo(formData: FormData, conNumero: boolean): Valori | string {
  const stato = String(formData.get("stato") ?? "");
  if (!(STATI_FATTURA as string[]).includes(stato)) return "Stato non valido.";

  const note = String(formData.get("note") ?? "").trim().slice(0, 500);
  const numero = conNumero ? String(formData.get("numero") ?? "").trim() : "";
  const data = String(formData.get("data") ?? "").trim();

  if (stato === "fatturata") {
    if (!GIORNO.test(data) || Number.isNaN(Date.parse(`${data}T00:00:00Z`))) return "Indica la data della fattura.";
    if (data < DATA_MINIMA || data > dataRoma(new Date())) return "La data della fattura non può essere futura né anteriore al 2020.";
    if (numero.length > 60) return "Il numero della fattura è troppo lungo (massimo 60 caratteri).";
    return { stato, numero: numero === "" ? null : numero, data, note: note === "" ? null : note };
  }
  if (stato === "non_dovuta" && note.length < 3) return "Per una riga «non dovuta» scrivi nelle note perché (es. «duplicato», «storno»).";
  // da fatturare: il numero e la data di una fattura non hanno più senso
  return { stato: stato as StatoFattura, numero: null, data: null, note: note === "" ? null : note };
}

// Aggiorna le righe indicate (chiavi "incasso:<uuid>" / "crediti:<uuid>"). Ritorna
// il numero di righe aggiornate o un messaggio di errore.
async function applica(chiavi: string[], v: Valori, userId: string): Promise<number | string> {
  const perTabella: Record<keyof typeof TABELLE, string[]> = { incasso: [], crediti: [] };
  for (const chiave of new Set(chiavi)) {
    if (!CHIAVE.test(chiave)) return "Riga non valida.";
    const [tipo, id] = chiave.split(":") as [keyof typeof TABELLE, string];
    perTabella[tipo].push(id);
  }

  const admin = createAdminClient();
  const adesso = new Date().toISOString();
  let aggiornate = 0;

  for (const tipo of Object.keys(perTabella) as (keyof typeof TABELLE)[]) {
    const ids = perTabella[tipo];
    if (ids.length === 0) continue;
    const { data, error } = await admin
      .from(TABELLE[tipo])
      .update({
        stato_fattura: v.stato,
        numero_fattura: v.numero,
        data_fattura: v.data,
        note_fattura: v.note,
        fatturazione_aggiornata_il: adesso,
        fatturazione_aggiornata_da: userId,
      })
      .in("id", ids)
      .select("id");

    if (error) {
      console.error("Console: aggiornamento stato fattura fallito", error.message);
      return schemaAssente(error) ? "Stato di fatturazione non disponibile: eseguire la migrazione 0079." : "Aggiornamento non riuscito.";
    }
    aggiornate += data?.length ?? 0;
  }

  return aggiornate;
}

function tornaAllElenco(aggiornate: number, stato: StatoFattura, formData: FormData): never {
  revalidatePath("/site-console", "layout");
  const parametri = new URLSearchParams({ esito: "aggiornate", n: String(aggiornate), nuovo: stato });
  const filtro = leggiFiltroFattura(String(formData.get("filtro") ?? ""));
  if (filtro !== "da_fatturare") parametri.set("stato", filtro);
  if (formData.get("prova") === "1") parametri.set("prova", "1");
  redirect(`/fatturazione?${parametri.toString()}`);
}

export async function aggiornaStatoFattura(_stato: StatoAzioneFattura, formData: FormData): Promise<StatoAzioneFattura> {
  const sessione = await richiediAdminAzione();
  if (!sessione) return { errore: "Non autorizzato." };

  const valori = leggiModulo(formData, true);
  if (typeof valori === "string") return { errore: valori };

  const esito = await applica([String(formData.get("riga") ?? "")], valori, sessione.userId);
  if (typeof esito === "string") return { errore: esito };
  if (esito === 0) return { errore: "Riga non trovata." };

  tornaAllElenco(esito, valori.stato, formData);
}

// Per più righe insieme (es. tutte le righe di un mese): stessa data e stesse note
// per tutte, senza numero (il numero è di una fattura sola: si aggiunge poi riga per riga).
export async function aggiornaStatoFatturaMultiplo(_stato: StatoAzioneFattura, formData: FormData): Promise<StatoAzioneFattura> {
  const sessione = await richiediAdminAzione();
  if (!sessione) return { errore: "Non autorizzato." };

  const righe = formData.getAll("righe").map(String);
  if (righe.length === 0) return { errore: "Seleziona almeno una riga." };
  if (righe.length > MASSIMO_RIGHE) return { errore: `Troppe righe insieme (massimo ${MASSIMO_RIGHE}).` };

  const valori = leggiModulo(formData, false);
  if (typeof valori === "string") return { errore: valori };

  const esito = await applica(righe, valori, sessione.userId);
  if (typeof esito === "string") return { errore: esito };

  tornaAllElenco(esito, valori.stato, formData);
}
