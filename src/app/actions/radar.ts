"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { richiediTitolareAzione } from "@/lib/omnia-ai-account-guardie";
import { leggiDirittoRadar } from "@/lib/radar/impostazioni";
import { registraUtilizzoRadar } from "@/lib/radar/utilizzi";
import { validaGaraAggiunta } from "@/lib/radar/aggiunte-calcoli";
import { MESSAGGIO_RADAR_NON_DISPONIBILE, RADICE_OPPORTUNITA } from "@/lib/radar/area-cliente";
import { schemaAssente } from "@/lib/omnia-ai-incassi";

// Azioni di Tender Intelligence nell'area riservata (fase B1, solo titolare): salvare e monitorare una gara, aggiungere una gara a mano.
// Ogni azione parte dalla guardia del titolare e dal diritto al modulo, ricalcolati qui (il pulsante nella pagina non è una garanzia).
// Le tabelle riservate si scrivono con la sessione dell'utente (regole di accesso del titolare effettivo, migrazione 0112); l'archivio
// pubblico si legge con la chiave di servizio solo per controllare che la gara esista.

export type StatoAzioneRadar = { errore?: string; ok?: boolean; messaggio?: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Dopo la guardia del titolare (chiamata da ogni azione): il diritto al modulo per il suo account.
async function conDiritto(guardia: Awaited<ReturnType<typeof richiediTitolareAzione>>) {
  if (!guardia.ok) return { ok: false as const, errore: guardia.errore };
  const diritto = await leggiDirittoRadar(guardia.contesto.accountId);
  if (!diritto.visibile) return { ok: false as const, errore: MESSAGGIO_RADAR_NON_DISPONIBILE };
  return { ok: true as const, user: guardia.user, contesto: guardia.contesto, diritto };
}

function ricarica(proceduraId?: string | null, aggiuntaId?: string | null) {
  revalidatePath(`${RADICE_OPPORTUNITA}/monitorate`);
  if (proceduraId) revalidatePath(`${RADICE_OPPORTUNITA}/gara/${proceduraId}`);
  if (aggiuntaId) revalidatePath(`${RADICE_OPPORTUNITA}/aggiunta/${aggiuntaId}`);
}

// azione: «salva», «monitora» (salva e monitora), «non_monitorare» (resta salvata), «rimuovi».
export async function aggiornaSalvataggio(_stato: StatoAzioneRadar, formData: FormData): Promise<StatoAzioneRadar> {
  const g = await conDiritto(await richiediTitolareAzione());
  if (!g.ok) return { errore: g.errore };
  const azione = String(formData.get("azione") ?? "");
  const proceduraId = String(formData.get("proceduraId") ?? "") || null;
  const aggiuntaId = String(formData.get("aggiuntaId") ?? "") || null;
  if (!["salva", "monitora", "non_monitorare", "rimuovi"].includes(azione)) return { errore: "Azione non valida." };
  if ((proceduraId ? 1 : 0) + (aggiuntaId ? 1 : 0) !== 1 || (proceduraId && !UUID.test(proceduraId)) || (aggiuntaId && !UUID.test(aggiuntaId))) return { errore: "Gara non valida." };
  // in sola lettura si può solo smettere di seguire, non iniziare
  if (!g.diritto.operativo && (azione === "salva" || azione === "monitora")) return { errore: g.diritto.messaggioSolaLettura ?? MESSAGGIO_RADAR_NON_DISPONIBILE };

  const supabase = await createClient();
  const filtro = proceduraId ? { colonna: "procedura_id", valore: proceduraId } : { colonna: "aggiunta_id", valore: aggiuntaId as string };

  if (azione === "rimuovi") {
    const { error } = await supabase.from("omnia_ai_radar_salvate").delete().eq(filtro.colonna, filtro.valore);
    if (error) return { errore: "Non è stato possibile togliere la gara dalle salvate." };
    ricarica(proceduraId, aggiuntaId);
    return { ok: true, messaggio: "Gara tolta dalle salvate." };
  }

  if (proceduraId) {
    const { data: esiste } = await createAdminClient().from("radar_procedure").select("id").eq("id", proceduraId).maybeSingle();
    if (!esiste) return { errore: "Gara non trovata." };
  }

  const monitorata = azione === "monitora" ? true : azione === "non_monitorare" ? false : undefined;
  const adesso = new Date().toISOString();
  const { data: esistente } = await supabase.from("omnia_ai_radar_salvate").select("id, monitorata").eq(filtro.colonna, filtro.valore).maybeSingle<{ id: string; monitorata: boolean }>();
  const { error } = esistente
    ? await supabase.from("omnia_ai_radar_salvate").update({ ...(monitorata === undefined ? {} : { monitorata }), aggiornata_il: adesso }).eq("id", esistente.id)
    : await supabase.from("omnia_ai_radar_salvate").insert({
        user_id: g.contesto.accountId,
        procedura_id: proceduraId,
        aggiunta_id: aggiuntaId,
        monitorata: monitorata ?? false,
        salvata_da: g.contesto.userId,
        ultimo_aggiornamento_visto_il: adesso,
      });
  if (error) {
    if (!schemaAssente(error)) console.error("Tender Intelligence: salvataggio della gara non riuscito", error.code);
    return { errore: "Non è stato possibile salvare la gara." };
  }
  if (monitorata === true && !esistente?.monitorata) await registraUtilizzoRadar({ accountId: g.contesto.accountId, membroId: g.contesto.userId, azione: "monitora", proceduraId });
  ricarica(proceduraId, aggiuntaId);
  return { ok: true, messaggio: monitorata === true ? "Gara monitorata." : monitorata === false ? "Monitoraggio tolto: la gara resta tra le salvate." : "Gara salvata." };
}

// «Aggiungi a mano»: CIG o collegamento + dati facoltativi. Se il CIG è già nell'archivio pubblico, si apre quella gara (e si salva): nessun
// doppione. Altrimenti nasce una gara riservata dell'impresa, salvata e monitorata, che si collegherà da sola quando il CIG comparirà in una fonte.
export async function aggiungiGaraAMano(_stato: StatoAzioneRadar, formData: FormData): Promise<StatoAzioneRadar> {
  const g = await conDiritto(await richiediTitolareAzione());
  if (!g.ok) return { errore: g.errore };
  if (!g.diritto.operativo) return { errore: g.diritto.messaggioSolaLettura ?? MESSAGGIO_RADAR_NON_DISPONIBILE };

  const campo = (n: string) => String(formData.get(n) ?? "");
  const esito = validaGaraAggiunta({ cig: campo("cig"), url: campo("url"), oggetto: campo("oggetto"), ente: campo("ente"), scadenzaGiorno: campo("scadenzaGiorno"), scadenzaOra: campo("scadenzaOra"), importo: campo("importo") });
  if (!esito.ok) return { errore: esito.errore };
  const v = esito.valori;
  const supabase = await createClient();
  const adesso = new Date().toISOString();

  let destinazione: string | null = null;
  if (v.cig) {
    const { data: lotto } = await createAdminClient().from("radar_lotti").select("procedura_id").eq("cig", v.cig).maybeSingle<{ procedura_id: string }>();
    if (lotto) {
      await supabase.from("omnia_ai_radar_salvate").upsert(
        { user_id: g.contesto.accountId, procedura_id: lotto.procedura_id, monitorata: true, salvata_da: g.contesto.userId, ultimo_aggiornamento_visto_il: adesso, aggiornata_il: adesso },
        { onConflict: "user_id,procedura_id" },
      );
      destinazione = `${RADICE_OPPORTUNITA}/gara/${lotto.procedura_id}?da=aggiungi`;
    } else {
      const { data: gia } = await supabase.from("omnia_ai_radar_gare_aggiunte").select("id").eq("cig", v.cig).maybeSingle<{ id: string }>();
      if (gia) destinazione = `${RADICE_OPPORTUNITA}/aggiunta/${gia.id}?da=gia`;
    }
  }

  if (!destinazione) {
    const { data: nuova, error } = await supabase
      .from("omnia_ai_radar_gare_aggiunte")
      .insert({ user_id: g.contesto.accountId, creata_da: g.contesto.userId, cig: v.cig, url: v.url, oggetto: v.oggetto, ente: v.ente, scadenza_offerte: v.scadenzaOfferte, scadenza_ora_indicata: v.scadenzaOraIndicata, importo: v.importo })
      .select("id")
      .single<{ id: string }>();
    if (error || !nuova) {
      if (error && !schemaAssente(error)) console.error("Tender Intelligence: gara aggiunta a mano non salvata", error.code);
      return { errore: "Non è stato possibile aggiungere la gara." };
    }
    const { error: erroreSalvata } = await supabase
      .from("omnia_ai_radar_salvate")
      .insert({ user_id: g.contesto.accountId, aggiunta_id: nuova.id, monitorata: true, salvata_da: g.contesto.userId, ultimo_aggiornamento_visto_il: adesso });
    if (erroreSalvata) console.error("Tender Intelligence: gara aggiunta non messa tra le salvate", erroreSalvata.code);
    destinazione = `${RADICE_OPPORTUNITA}/aggiunta/${nuova.id}?da=aggiungi`;
  }

  await registraUtilizzoRadar({ accountId: g.contesto.accountId, membroId: g.contesto.userId, azione: "aggiungi_manuale" });
  revalidatePath(`${RADICE_OPPORTUNITA}/monitorate`);
  redirect(destinazione);
}
