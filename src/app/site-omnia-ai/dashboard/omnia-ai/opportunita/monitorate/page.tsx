import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { richiediTitolarePagina } from "@/lib/omnia-ai-account-guardie";
import { dirittoRadarOppure404, RADICE_OPPORTUNITA } from "@/lib/radar/area-cliente";
import { COLONNE_RISULTATO, type RigaRisultato } from "@/lib/radar/ricerca";
import { statoMostrato, type StatoProcedura } from "@/lib/radar/importa-calcoli";
import { giorniAllaScadenza, scadenzaLeggibile } from "@/lib/radar/sintesi-calcoli";
import TestataOpportunita from "@/components/omnia-ai/opportunita/testata-opportunita";
import RigaGara, { hrefGara, type DatiRigaGara } from "@/components/omnia-ai/opportunita/riga-gara";
import { giorno } from "@/components/omnia-ai/opportunita/formato";

// «Salvate e monitorate» (fase B1): le gare che l'impresa segue, pubbliche e aggiunte a mano, raggruppate per scadenza, con le novità
// rilevate dall'ultima apertura della scheda (rettifiche, proroghe, annullamenti, esiti). Tutto letto al caricamento della pagina:
// nessun controllo periodico nel browser. Le notifiche nella campanella e i promemoria arrivano in B2.

type Salvata = { id: string; procedura_id: string | null; aggiunta_id: string | null; monitorata: boolean; ultimo_aggiornamento_visto_il: string | null; creata_il: string };
type Aggiunta = { id: string; cig: string | null; url: string | null; oggetto: string | null; ente: string | null; scadenza_offerte: string | null; scadenza_ora_indicata: boolean; importo: number | string | null; procedura_id: string | null };
type Novita = { procedura_id: string; tipo: string; campo: string | null; valore_nuovo: string | null; id_fonte: string | null; rilevato_il: string };

function testoNovita(n: Novita): string {
  const quando = giorno(n.rilevato_il);
  if (n.tipo === "annullamento") return `Novità del ${quando}: gara annullata dalla fonte.`;
  if (n.tipo === "esito") return `Novità del ${quando}: esito pubblicato (${n.valore_nuovo === "aggiudicata" ? "aggiudicata" : "chiusa senza aggiudicazione"}).`;
  if (n.campo === "scadenza_offerte") return `${n.tipo === "proroga" ? "Proroga" : "Rettifica"} del ${quando}: scadenza ora ${scadenzaLeggibile(n.valore_nuovo, true) ?? "non indicata"}.`;
  return `Rettifica del ${quando} (avviso ${n.id_fonte ?? ""}).`;
}

export default async function MonitoratePage() {
  const sessione = await richiediTitolarePagina();
  if (!sessione) return null;
  const { contesto } = sessione;
  const { diritto } = await dirittoRadarOppure404(contesto.accountId);
  const supabase = await createClient();
  const admin = createAdminClient();
  const adesso = new Date();

  const { data: salvateRaw } = await supabase
    .from("omnia_ai_radar_salvate")
    .select("id, procedura_id, aggiunta_id, monitorata, ultimo_aggiornamento_visto_il, creata_il")
    .order("creata_il", { ascending: false })
    .limit(500)
    .returns<Salvata[]>();
  const salvate = salvateRaw ?? [];
  const idAggiunte = salvate.map((s) => s.aggiunta_id).filter((x): x is string => !!x);
  const { data: aggiunteRaw } = idAggiunte.length
    ? await supabase.from("omnia_ai_radar_gare_aggiunte").select("id, cig, url, oggetto, ente, scadenza_offerte, scadenza_ora_indicata, importo, procedura_id").in("id", idAggiunte).returns<Aggiunta[]>()
    : { data: [] as Aggiunta[] };
  const aggiunte = new Map((aggiunteRaw ?? []).map((a) => [a.id, a]));

  const idProcedure = [...new Set([...salvate.map((s) => s.procedura_id), ...(aggiunteRaw ?? []).map((a) => a.procedura_id)].filter((x): x is string => !!x))];
  const [{ data: procedureRaw }, { data: novitaRaw }] = idProcedure.length
    ? await Promise.all([
        admin.from("radar_procedure").select(COLONNE_RISULTATO).in("id", idProcedure).returns<RigaRisultato[]>(),
        admin
          .from("radar_aggiornamenti")
          .select("procedura_id, tipo, campo, valore_nuovo, id_fonte, rilevato_il")
          .in("procedura_id", idProcedure)
          .in("tipo", ["rettifica", "proroga", "annullamento", "esito"])
          .order("rilevato_il", { ascending: false })
          .limit(1000)
          .returns<Novita[]>(),
      ])
    : [{ data: [] as RigaRisultato[] }, { data: [] as Novita[] }];
  const procedure = new Map((procedureRaw ?? []).map((p) => [p.id, { ...p, valore_stimato: p.valore_stimato === null ? null : Number(p.valore_stimato) }]));

  const righe: (DatiRigaGara & { chiave: string; scadenzaOrd: number; gruppo: "settimana" | "prossime" | "senza_data" | "chiuse" })[] = [];
  for (const s of salvate) {
    const aggiunta = s.aggiunta_id ? aggiunte.get(s.aggiunta_id) : undefined;
    const p = s.procedura_id ? procedure.get(s.procedura_id) : aggiunta?.procedura_id ? procedure.get(aggiunta.procedura_id) : undefined;
    let d: DatiRigaGara;
    if (p) {
      const visto = s.ultimo_aggiornamento_visto_il ? Date.parse(s.ultimo_aggiornamento_visto_il) : 0;
      const novita = (novitaRaw ?? []).find((n) => n.procedura_id === p.id && Date.parse(n.rilevato_il) > visto);
      d = {
        href: hrefGara(p.id),
        titolo: p.oggetto_breve ?? p.oggetto,
        ente: p.sa_denominazione,
        comune: p.sa_comune,
        provincia: p.sa_provincia,
        regioni: p.luogo_regioni,
        scadenza: p.scadenza_offerte,
        scadenzaOraIndicata: p.scadenza_ora_indicata,
        valore: p.valore_stimato,
        tipoValore: "Valore stimato",
        durataMesi: p.durata_mesi,
        nLotti: p.n_lotti,
        settori: p.settori,
        tipoProcedura: p.tipo_procedura,
        stato: p.stato,
        rettificata: p.rettificata,
        motivi: aggiunta ? ["aggiunta da te, poi trovata nelle fonti"] : [],
        fonte: "TED",
        verificataIl: p.ultima_rilevazione_il,
        salvata: true,
        monitorata: s.monitorata,
        novita: novita ? testoNovita(novita) : null,
      };
    } else if (aggiunta) {
      d = {
        href: `${RADICE_OPPORTUNITA}/aggiunta/${aggiunta.id}`,
        titolo: aggiunta.oggetto ?? (aggiunta.cig ? `Gara con CIG ${aggiunta.cig}` : "Gara aggiunta a mano"),
        ente: aggiunta.ente,
        comune: null,
        provincia: null,
        regioni: [],
        scadenza: aggiunta.scadenza_offerte,
        scadenzaOraIndicata: aggiunta.scadenza_ora_indicata,
        valore: aggiunta.importo === null ? null : Number(aggiunta.importo),
        tipoValore: "Importo indicato da te",
        durataMesi: null,
        nLotti: null,
        settori: [],
        tipoProcedura: null,
        stato: "aperta" as StatoProcedura,
        rettificata: false,
        motivi: [],
        fonte: "Aggiunta a mano",
        verificataIl: null,
        salvata: true,
        monitorata: s.monitorata,
      };
    } else continue;
    const stato = statoMostrato(d.stato, d.scadenza, adesso);
    const g = giorniAllaScadenza(d.scadenza, adesso);
    const gruppo = stato !== "aperta" ? "chiuse" : g === null ? "senza_data" : g <= 7 ? "settimana" : "prossime";
    righe.push({ ...d, chiave: s.id, scadenzaOrd: d.scadenza ? Date.parse(d.scadenza) : Number.POSITIVE_INFINITY, gruppo });
  }

  const gruppi = [
    { id: "settimana", titolo: "Scadono entro 7 giorni" },
    { id: "prossime", titolo: "Prossime scadenze" },
    { id: "senza_data", titolo: "Scadenza non indicata" },
    { id: "chiuse", titolo: "Scadute, annullate o chiuse" },
  ] as const;

  return (
    <div className="omnia-app-shell largo">
      <TestataOpportunita attiva="monitorate" sottotitolo="Le gare che segui. Le novità rilevate nelle fonti compaiono qui finché non apri la scheda." />
      {!diritto.operativo && <p className="omnia-messaggio-stato avviso">{diritto.messaggioSolaLettura}</p>}
      {righe.length === 0 ? (
        <div className="omnia-riquadro">
          <p className="omnia-opp-prosa">Non segui ancora nessuna gara.</p>
          <p className="omnia-opp-nota">
            Cercale in <Link href={`${RADICE_OPPORTUNITA}/cerca`}>Cerca</Link> e usa «Salva» o «Monitora», oppure <Link href={`${RADICE_OPPORTUNITA}/aggiungi`}>aggiungine una a mano</Link> con il CIG o il collegamento.
          </p>
        </div>
      ) : (
        gruppi.map((gr) => {
          const elenco = righe.filter((r) => r.gruppo === gr.id).sort((a, b) => (gr.id === "chiuse" ? b.scadenzaOrd - a.scadenzaOrd : a.scadenzaOrd - b.scadenzaOrd));
          if (elenco.length === 0) return null;
          return (
            <section key={gr.id} className="omnia-opp-gruppo-monitorate" aria-label={gr.titolo}>
              <h2 className="omnia-opp-sottotitolo">
                {gr.titolo} <span className="omnia-opp-nota">({elenco.length})</span>
              </h2>
              <div className="omnia-opp-elenco">
                {elenco.map((r) => (
                  <RigaGara key={r.chiave} d={r} adesso={adesso} />
                ))}
              </div>
            </section>
          );
        })
      )}
    </div>
  );
}
