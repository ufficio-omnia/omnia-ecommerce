// Console «Tender Intelligence»: l'elenco delle gare «da verificare» (schema S4, 49C §4.2). Solo server, chiave di servizio: le tabelle della
// 0121 si leggono con il solo service_role, e la pagina della console parte dalla guardia degli amministratori. Tre letture per l'intero
// elenco (stati, gare, righe attive), mai una per gara. Senza le tabelle della 0121 o con un errore: null (la sezione non si mostra).
// Finché la 0133 non è applicata e B2 non scrive «da_verificare», l'elenco è semplicemente vuoto.
import type { SupabaseClient } from "@supabase/supabase-js";
import { schemaAssente } from "@/lib/omnia-ai-incassi";
import { nomeSettore } from "@/lib/radar/settori";
import { vociCatalogo } from "@/lib/radar/settori-catalogo";
import { CASO_LEGGIBILE, candidatoDaRighe, eSettoreRadar, type RigaAttivaConsole } from "./gare-in-verifica-calcoli";

export type GaraInVerificaConsole = {
  id: string;
  titolo: string;
  ente: string | null;
  urlAvviso: string | null;
  chiave: string;
  settoreCandidato: string | null;
  nomeSettoreCandidato: string | null;
  caso: string | null;
  casoLeggibile: string | null;
  motivo: string | null;
  // le righe attive di oggi, comprese le C calcolate (spiegazione per chi decide)
  righe: { settore: string; nomeSettore: string; rilevanza: string; regole: string[]; motivi: string[]; origine: string }[];
  // le sottocategorie del catalogo del settore candidato (vuoto senza candidato: le offre il modulo dopo la scelta del settore)
  sottocategorie: { id: string; nome: string }[];
  versione: string | null;
  il: string;
};

export const MASSIMO_ELENCO_IN_VERIFICA = 100;

export async function leggiGareInVerifica(admin: SupabaseClient): Promise<GaraInVerificaConsole[] | null> {
  const { data: stati, error } = await admin
    .from("radar_classificazioni_stato")
    .select("procedura_id, versione_regole, aggiornata_il")
    .eq("stato", "da_verificare")
    .order("aggiornata_il", { ascending: false })
    .limit(MASSIMO_ELENCO_IN_VERIFICA)
    .returns<{ procedura_id: string; versione_regole: string | null; aggiornata_il: string }[]>();
  if (error) {
    if (!schemaAssente(error)) console.error("Console Tender Intelligence: lettura delle gare da verificare non riuscita", error.message);
    return null;
  }
  const ids = (stati ?? []).map((s) => s.procedura_id);
  if (ids.length === 0) return [];
  const [{ data: gare, error: e1 }, { data: righe, error: e2 }] = await Promise.all([
    admin.from("radar_procedure").select("id, oggetto, oggetto_breve, sa_denominazione, url_avviso, chiave").in("id", ids).returns<{ id: string; oggetto: string; oggetto_breve: string | null; sa_denominazione: string | null; url_avviso: string | null; chiave: string }[]>(),
    admin.from("radar_classificazioni").select("procedura_id, settore, rilevanza, regole, motivi, origine").in("procedura_id", ids).eq("attiva", true).returns<(RigaAttivaConsole & { procedura_id: string })[]>(),
  ]);
  if (e1 || e2) {
    console.error("Console Tender Intelligence: lettura delle gare da verificare non riuscita", (e1 ?? e2)?.message);
    return null;
  }
  const garaDi = new Map((gare ?? []).map((g) => [g.id, g]));
  return (stati ?? []).flatMap((s) => {
    const g = garaDi.get(s.procedura_id);
    if (!g) return [];
    const suoi = (righe ?? []).filter((r) => r.procedura_id === s.procedura_id);
    const c = candidatoDaRighe(suoi);
    return [
      {
        id: g.id,
        titolo: g.oggetto_breve ?? g.oggetto,
        ente: g.sa_denominazione,
        urlAvviso: g.url_avviso,
        chiave: g.chiave,
        settoreCandidato: c.settore,
        nomeSettoreCandidato: c.settore ? nomeSettore(c.settore) : null,
        caso: c.caso,
        casoLeggibile: c.caso ? (CASO_LEGGIBILE[c.caso] ?? c.caso.replace(/_/g, " ")) : null,
        motivo: c.motivo,
        righe: suoi.map((r) => ({ settore: r.settore, nomeSettore: eSettoreRadar(r.settore) ? nomeSettore(r.settore) : r.settore, rilevanza: r.rilevanza, regole: r.regole ?? [], motivi: r.motivi ?? [], origine: r.origine })),
        sottocategorie: c.settore ? vociCatalogo(c.settore).map((v) => ({ id: v.id, nome: v.nome })) : [],
        versione: s.versione_regole,
        il: s.aggiornata_il,
      },
    ];
  });
}
