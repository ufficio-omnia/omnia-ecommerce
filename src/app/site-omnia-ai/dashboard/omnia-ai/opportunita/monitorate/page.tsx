import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { richiediOpportunitaPagina } from "@/lib/radar/guardie-opportunita";
import { dirittoRadarOppure404, RADICE_OPPORTUNITA } from "@/lib/radar/area-cliente";
import { colonneElenco, conRilevanza, type RigaRisultato } from "@/lib/radar/ricerca";
import { COLONNA_RIGHE_ATTIVE, type ConClassificazioni } from "@/lib/radar/classificazioni-lettura";
import { etichettaRicerca, etichettaStatoClassificazione, settoriDellaRiga } from "@/lib/radar/ricerca-calcoli";
import { classificazioniAttive } from "@/lib/radar/ambiente";
import { leggiFontiGare } from "@/lib/radar/gara";
import { etichettaFontiElenco, type FonteGara } from "@/lib/radar/fonti-gara-calcoli";
import { tipoDellaGara } from "@/lib/radar/tipo-gara-calcoli";
import { statoMostrato, type StatoProcedura } from "@/lib/radar/importa-calcoli";
import { giorniAllaScadenza, leggibileDaValore } from "@/lib/radar/sintesi-calcoli";
import TestataOpportunita from "@/components/omnia-ai/opportunita/testata-opportunita";
import AvvisoNotifiche from "@/components/omnia-ai/opportunita/avviso-notifiche";
import { TESTO_LISTA_SALVATE } from "@/lib/opportunita-testi-calcoli";
import RigaGara, { hrefGara, type DatiRigaGara } from "@/components/omnia-ai/opportunita/riga-gara";
import { giorno } from "@/components/omnia-ai/opportunita/formato";
import { unoPerGaraMostrata } from "@/lib/radar/collegamenti-calcoli";
import { fontiNascosteAiClienti, fontiVisibiliDa } from "@/lib/radar/fonti-nascoste";
import { ufficioGareRadarAttivo } from "@/lib/radar/interruttori-b4";
import { chiHaSalvato } from "@/lib/radar/salvate-calcoli";

// «Salvate e monitorate» (fase B1): le gare che l'impresa segue, pubbliche e aggiunte a mano, raggruppate per scadenza, con le novità
// rilevate dall'ultima apertura della scheda (rettifiche, proroghe, annullamenti, esiti). Tutto letto al caricamento della pagina:
// nessun controllo periodico nel browser. Le notifiche nella campanella e i promemoria arrivano in B2.

type Salvata = { id: string; procedura_id: string | null; aggiunta_id: string | null; monitorata: boolean; ultimo_aggiornamento_visto_il: string | null; creata_il: string; salvata_da: string | null };
type Aggiunta = { id: string; cig: string | null; url: string | null; oggetto: string | null; ente: string | null; scadenza_giorno: string | null; scadenza_offerte: string | null; scadenza_ora_indicata: boolean; importo: number | string | null; procedura_id: string | null };
type Novita = { procedura_id: string; tipo: string; campo: string | null; valore_nuovo: string | null; id_fonte: string | null; rilevato_il: string };

function testoNovita(n: Novita): string {
  const quando = giorno(n.rilevato_il);
  if (n.tipo === "annullamento") return `Novità del ${quando}: gara annullata dalla fonte.`;
  if (n.tipo === "esito") return `Novità del ${quando}: esito pubblicato (${n.valore_nuovo === "aggiudicata" ? "aggiudicata" : "chiusa senza aggiudicazione"}).`;
  if (n.campo === "scadenza_offerte") return `${n.tipo === "proroga" ? "Proroga" : "Rettifica"} del ${quando}: scadenza ora ${leggibileDaValore(n.valore_nuovo) ?? "non indicata"}.`;
  return `Rettifica del ${quando} (avviso ${n.id_fonte ?? ""}).`;
}

export default async function MonitoratePage() {
  const sessione = await richiediOpportunitaPagina();
  if (!sessione) return null;
  const { contesto } = sessione;
  const { diritto } = await dirittoRadarOppure404(contesto.accountId);
  const supabase = await createClient();
  const admin = createAdminClient();
  const adesso = new Date();

  const { data: salvateRaw } = await supabase
    .from("omnia_ai_radar_salvate")
    .select("id, procedura_id, aggiunta_id, monitorata, ultimo_aggiornamento_visto_il, creata_il, salvata_da")
    .order("creata_il", { ascending: false })
    .limit(500)
    .returns<Salvata[]>();
  const salvate = salvateRaw ?? [];
  // fase B4 (grado 2): con l'Ufficio Gare sulle Opportunità, chi ha salvato la gara (il ruolo, mai il nome o l'email dell'altro)
  const conChi = ufficioGareRadarAttivo(process.env);
  const chi = (s: Salvata): string[] => {
    const testo = conChi ? chiHaSalvato(s.salvata_da, contesto.accountId, contesto.userId) : null;
    return testo ? [testo] : [];
  };
  const idAggiunte = salvate.map((s) => s.aggiunta_id).filter((x): x is string => !!x);
  const { data: aggiunteRaw } = idAggiunte.length
    ? await supabase.from("omnia_ai_radar_gare_aggiunte").select("id, cig, url, oggetto, ente, scadenza_giorno, scadenza_offerte, scadenza_ora_indicata, importo, procedura_id").in("id", idAggiunte).returns<Aggiunta[]>()
    : { data: [] as Aggiunta[] };
  const aggiunte = new Map((aggiunteRaw ?? []).map((a) => [a.id, a]));

  const idSalvati = [...new Set([...salvate.map((s) => s.procedura_id), ...(aggiunteRaw ?? []).map((a) => a.procedura_id)].filter((x): x is string => !!x))];
  // una gara salvata che poi è stata collegata a un'altra (stessa gara pubblicata due volte, 0117) si mostra come la gara che resta
  const { data: collegateRaw } = idSalvati.length
    ? await admin.from("radar_procedure").select("id, unita_a").in("id", idSalvati).not("unita_a", "is", null).returns<{ id: string; unita_a: string }[]>()
    : { data: [] as { id: string; unita_a: string }[] };
  const resta = new Map((collegateRaw ?? []).map((c) => [c.id, c.unita_a]));
  const mostrata = (id: string | null | undefined) => (id ? (resta.get(id) ?? id) : undefined);
  const idProcedure = [...new Set(idSalvati.map((id) => resta.get(id) ?? id))];
  // fonti non ancora mostrabili ai clienti (0120; la PVL dopo la L5a): come in «Cerca», una gara che ha SOLO fonti nascoste non si legge e
  // quindi non compare (documento 47 §3.1). Il salvataggio resta nel database, intatto: la gara ricompare quando la fonte torna visibile.
  const visibili = fontiVisibiliDa(await fontiNascosteAiClienti());
  // fase B3: con le classificazioni accese, stato e righe attive della 0121 nella STESSA richiesta delle gare (nessuna lettura in più)
  const conClassificazioni = classificazioniAttive(process.env);
  const leggiProcedure = async () => {
    const q = admin.from("radar_procedure").select(colonneElenco(conClassificazioni)).in("id", idProcedure).overlaps("fonti", visibili);
    const letta = await (conClassificazioni ? q.eq(COLONNA_RIGHE_ATTIVE, true) : q).returns<(RigaRisultato & ConClassificazioni)[]>();
    if (!letta.error || !conClassificazioni) return { data: (letta.data ?? []).map((p) => (conClassificazioni ? conRilevanza(p) : p)) };
    // tabelle della 0121 non leggibili: le gare come prima (con lo stesso filtro delle fonti)
    return admin.from("radar_procedure").select(colonneElenco(false)).in("id", idProcedure).overlaps("fonti", visibili).returns<RigaRisultato[]>();
  };
  const [{ data: procedureRaw }, { data: novitaRaw }, fontiGare] = idProcedure.length
    ? await Promise.all([
        leggiProcedure(),
        admin
          .from("radar_aggiornamenti")
          .select("procedura_id, tipo, campo, valore_nuovo, id_fonte, rilevato_il")
          .in("procedura_id", idProcedure)
          .in("tipo", ["rettifica", "proroga", "annullamento", "esito"])
          // mai novità da una fonte nascosta ai clienti (0120)
          .in("fonte", fontiVisibiliDa(await fontiNascosteAiClienti()))
          .order("rilevato_il", { ascending: false })
          .limit(1000)
          .returns<Novita[]>(),
        leggiFontiGare(admin, idProcedure),
      ])
    : [{ data: [] as RigaRisultato[] }, { data: [] as Novita[] }, new Map<string, FonteGara[]>()];
  const procedure = new Map((procedureRaw ?? []).map((p) => [p.id, { ...p, valore_stimato: p.valore_stimato === null ? null : Number(p.valore_stimato) }]));

  const righe: (DatiRigaGara & { chiave: string; scadenzaOrd: string; gruppo: "settimana" | "prossime" | "senza_data" | "chiuse" })[] = [];
  // la gara mostrata solo se è stata letta, cioè se ha almeno una fonte visibile: una gara con sole fonti nascoste non raggruppa nulla, così
  // un'aggiunta a mano collegata a lei resta una riga «Aggiunta a mano» con i dati scritti dall'impresa (e non sparisce col raggruppamento)
  const garaMostrata = (id: string | null | undefined) => {
    const m = mostrata(id);
    return m && procedure.has(m) ? m : undefined;
  };
  // una sola riga per gara mostrata: due salvataggi di copie poi collegate (0117) non danno due righe (nessun salvataggio cancellato)
  const salvateUniche = unoPerGaraMostrata(salvate, (s) => garaMostrata(s.procedura_id) ?? garaMostrata(s.aggiunta_id ? aggiunte.get(s.aggiunta_id)?.procedura_id : undefined));
  for (const s of salvateUniche) {
    const aggiunta = s.aggiunta_id ? aggiunte.get(s.aggiunta_id) : undefined;
    const idMostrato = garaMostrata(s.procedura_id) ?? garaMostrata(aggiunta?.procedura_id);
    const p = idMostrato ? procedure.get(idMostrato) : undefined;
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
        scadenzaGiorno: p.scadenza_giorno,
        valore: p.valore_stimato,
        tipoValore: "Valore stimato",
        durataMesi: p.durata_mesi,
        nLotti: p.n_lotti,
        settori: p.settori,
        tipoProcedura: p.tipo_procedura,
        stato: p.stato,
        rettificata: p.rettificata,
        motivi: [...(aggiunta ? ["aggiunta da te, poi trovata nelle fonti"] : []), ...chi(s)],
        // fase B3: rilevanza (correlata o fuori dai settori), settori con livello e sottocategorie, stato della classificazione
        rilevanza: etichettaRicerca(p, { settori: [] }),
        settoriDettaglio: settoriDellaRiga(p),
        statoClassificazione: etichettaStatoClassificazione(p),
        fonte: etichettaFontiElenco(fontiGare.get(p.id)),
        // C4/C5: il tipo della gara (ricavato dal tipo dell'avviso se la colonna è vuota)
        tipo: tipoDellaGara(p),
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
        scadenzaGiorno: aggiunta.scadenza_giorno,
        valore: aggiunta.importo === null ? null : Number(aggiunta.importo),
        tipoValore: "Importo indicato da te",
        durataMesi: null,
        nLotti: null,
        settori: [],
        tipoProcedura: null,
        stato: "aperta" as StatoProcedura,
        rettificata: false,
        motivi: chi(s),
        fonte: "Aggiunta a mano",
        verificataIl: null,
        salvata: true,
        monitorata: s.monitorata,
      };
    } else continue;
    const stato = statoMostrato(d.stato, { giorno: d.scadenzaGiorno, iso: d.scadenza }, adesso);
    const g = giorniAllaScadenza(d.scadenzaGiorno, adesso);
    const gruppo = stato !== "aperta" ? "chiuse" : g === null ? "senza_data" : g <= 7 ? "settimana" : "prossime";
    righe.push({ ...d, chiave: s.id, scadenzaOrd: `${d.scadenzaGiorno ?? "9999-99-99"}|${d.scadenza ?? "~"}`, gruppo });
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
      <AvvisoNotifiche contesto={contesto} operativo={diritto.operativo} />
      <p className="omnia-opp-spiega">{TESTO_LISTA_SALVATE}</p>
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
          const elenco = righe.filter((r) => r.gruppo === gr.id).sort((a, b) => (gr.id === "chiuse" ? b.scadenzaOrd.localeCompare(a.scadenzaOrd) : a.scadenzaOrd.localeCompare(b.scadenzaOrd)));
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
