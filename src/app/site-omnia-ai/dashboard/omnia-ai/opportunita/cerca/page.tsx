import { Fragment } from "react";
import Link from "next/link";
import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { richiediOpportunitaPagina } from "@/lib/radar/guardie-opportunita";
import { dirittoRadarOppure404, RADICE_OPPORTUNITA } from "@/lib/radar/area-cliente";
import { cercaGare, type RisultatoRicerca } from "@/lib/radar/ricerca";
import { leggiFontiGare, leggiSalvataggi } from "@/lib/radar/gara";
import { contaUtilizziRadar, registraUtilizzoRadar } from "@/lib/radar/utilizzi";
import { inizioFinestra, limiteEffettivo, verificaLimite } from "@/lib/radar/diritto-calcoli";
import {
  PROCEDURE_RICERCA,
  SCADENZE_RAPIDE,
  etichettaRicerca,
  etichettaStatoClassificazione,
  fasciaRilevanza,
  filtriAttivi,
  filtriDaParametri,
  parametriDaFiltri,
  settoriDellaRiga,
  type FiltriRicerca,
} from "@/lib/radar/ricerca-calcoli";
import { classificazioniAttive } from "@/lib/radar/ambiente";
import { SETTORI_RADAR, nomeSettore } from "@/lib/radar/settori";
import { REGIONI, nomeRegione } from "@/lib/radar/territorio";
import TestataOpportunita from "@/components/omnia-ai/opportunita/testata-opportunita";
import AvvisoNotifiche from "@/components/omnia-ai/opportunita/avviso-notifiche";
import RigaGara, { hrefGara } from "@/components/omnia-ai/opportunita/riga-gara";
import PannelloFiltri from "@/components/omnia-ai/opportunita/pannello-filtri";
import FontiRicerca, { type StatoFontePubblica } from "@/components/omnia-ai/opportunita/fonti-ricerca";
import { fontiNascosteAiClienti, fontiVisibiliDa } from "@/lib/radar/fonti-nascoste";
import { etichettaFontiElenco } from "@/lib/radar/fonti-gara-calcoli";
import { CATEGORIE_TIPO, tipoDellaGara } from "@/lib/radar/tipo-gara-calcoli";
import { importoBreve } from "@/components/omnia-ai/opportunita/formato";

// «Cerca» (fase B1): filtri deterministici applicati dal database, ricerca testuale in italiano con i sinonimi della mappa CPV (mostrati),
// rilevanza spiegata riga per riga. Nessuna chiamata a fonti esterne né a modelli. Lo stato dei filtri sta nell'indirizzo della pagina.

const ORDINAMENTI_ETICHETTE = { rilevanza: "Rilevanza", recenti: "Più recenti", scadenza: "Scadenza più vicina", importo: "Importo più alto" } as const;

// Fase B3: i titoletti delle fasce nell'ordinamento per rilevanza (solo con le classificazioni lette). Fascia 0 (pertinenti e non ancora
// classificate) senza titoletto.
const TITOLETTI_FASCIA: Record<number, { titolo: string; testo: string }> = {
  1: { titolo: "Gare correlate", testo: "Appalti misti, concessioni o gestioni complesse che comprendono il servizio: da valutare per intero." },
  2: { titolo: "Fuori dai settori monitorati", testo: "Compaiono perché corrispondono alla ricerca, ma non sono suggerite come opportunità dei settori." },
};

function FiltroRimovibile({ filtri, etichetta, senza }: { filtri: FiltriRicerca; etichetta: string; senza: Partial<FiltriRicerca> }) {
  return (
    <Link href={`${RADICE_OPPORTUNITA}/cerca${parametriDaFiltri(filtri, { ...senza, pagina: 1 })}`} className="omnia-opp-chip" aria-label={`Togli il filtro ${etichetta}`}>
      {etichetta} <span aria-hidden>✕</span>
    </Link>
  );
}

function filtriAttiviRimovibili(f: FiltriRicerca) {
  const chip: { etichetta: string; senza: Partial<FiltriRicerca> }[] = [];
  for (const s of f.settori) chip.push({ etichetta: nomeSettore(s), senza: { settori: f.settori.filter((x) => x !== s) } });
  for (const r of f.regioni) chip.push({ etichetta: nomeRegione(r) ?? r, senza: { regioni: f.regioni.filter((x) => x !== r) } });
  if (f.importoMin !== null) chip.push({ etichetta: `da ${importoBreve(f.importoMin)}`, senza: { importoMin: null } });
  if (f.importoMax !== null) chip.push({ etichetta: `fino a ${importoBreve(f.importoMax)}`, senza: { importoMax: null } });
  if (f.scadenzaEntroGiorni !== null) chip.push({ etichetta: `scade entro ${f.scadenzaEntroGiorni} gg`, senza: { scadenzaEntroGiorni: null } });
  if (f.pubblicataNegliUltimiGiorni !== null) chip.push({ etichetta: `pubblicata negli ultimi ${f.pubblicataNegliUltimiGiorni} gg`, senza: { pubblicataNegliUltimiGiorni: null } });
  for (const p of f.procedure) chip.push({ etichetta: PROCEDURE_RICERCA.find((x) => x.id === p)?.etichetta ?? p, senza: { procedure: f.procedure.filter((x) => x !== p) } });
  for (const t of f.tipi) chip.push({ etichetta: CATEGORIE_TIPO.find((c) => c.id === t)?.breve ?? t, senza: { tipi: f.tipi.filter((x) => x !== t) } });
  if (f.stato !== "aperte") chip.push({ etichetta: f.stato === "storico" ? "solo scadute e chiuse" : "aperte e storico", senza: { stato: "aperte" } });
  return chip;
}

export default async function CercaOpportunitaPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sessione = await richiediOpportunitaPagina();
  if (!sessione) return null;
  const { contesto } = sessione;
  const { diritto, parametri, cliente } = await dirittoRadarOppure404(contesto.accountId);
  const filtri = filtriDaParametri(await searchParams);
  const admin = createAdminClient();
  const adesso = new Date();

  // limite tecnico per impresa: ricerche al minuto (precisazione P4); un conteggio non riuscito non concede
  let risultato: RisultatoRicerca | null = null;
  let limitata = false;
  if (diritto.operativo) {
    const usate = await contaUtilizziRadar(admin, contesto.accountId, "ricerca", inizioFinestra("ricerche_minuto", adesso) as Date);
    if (usate === null || !verificaLimite(usate, limiteEffettivo(parametri, cliente, "ricerche_minuto")).consentito) {
      limitata = true;
    } else {
      // fase B2b: pertinenti (A) e correlate (B) distinte solo con le classificazioni accese (spente di base)
      risultato = await cercaGare(admin, filtri, adesso, { classificazioni: classificazioniAttive(process.env) });
      after(() => registraUtilizzoRadar({ accountId: contesto.accountId, membroId: contesto.userId, azione: "ricerca" }));
    }
  }

  const [salvataggi, { data: righeFonti }, fontiGare] = await Promise.all([
    leggiSalvataggi(await createClient(), (risultato?.righe ?? []).map((r) => r.id)),
    // solo le fonti mostrabili ai clienti (0120: una fonte si può nascondere dalla console; nessuna nascosta di base, decisione 48E)
    admin.from("radar_fonti_stato").select("fonte, attiva, dati_aggiornati_al, ultimo_successo_il").in("fonte", fontiVisibiliDa(await fontiNascosteAiClienti())).returns<{ fonte: StatoFontePubblica["fonte"]; attiva: boolean; dati_aggiornati_al: string | null; ultimo_successo_il: string | null }[]>(),
    leggiFontiGare(admin, (risultato?.righe ?? []).map((r) => r.id)),
  ]);
  const statiFonti = (righeFonti ?? []).map((f) => ({ fonte: f.fonte, attiva: f.attiva, datiAl: f.dati_aggiornati_al, ultimoSuccesso: f.ultimo_successo_il }));
  const attivi = filtriAttivi(filtri);
  const chip = filtriAttiviRimovibili(filtri);
  const sinonimi = (risultato?.domanda.espansioni ?? []).flatMap((e) => e.aggiunti.map((t) => ({ termine: t.termine, origine: t.origine, settore: e.settore })));
  const base = `${RADICE_OPPORTUNITA}/cerca`;

  return (
    <div className="omnia-app-shell largo">
      <TestataOpportunita attiva="cerca" sottotitolo="Cerca tra le gare pubbliche dei tuoi settori. Ogni risultato dice perché compare, da quale fonte viene e quando è stato verificato." />
      <AvvisoNotifiche contesto={contesto} operativo={diritto.operativo} />

      {!diritto.operativo && <p className="omnia-messaggio-stato avviso">{diritto.messaggioSolaLettura}</p>}
      {limitata && <p className="omnia-messaggio-stato avviso">Hai fatto molte ricerche nell&apos;ultimo minuto: riprova tra qualche secondo.</p>}

      <form action={base} method="get" className="omnia-opp-ricerca" role="search">
        <div className="omnia-opp-barra">
          <label htmlFor="opp-q" className="omnia-solo-lettori">
            Cerca per oggetto, ente o CIG
          </label>
          <input id="opp-q" name="q" type="search" defaultValue={filtri.q} placeholder="Cerca per oggetto, ente, codice fiscale dell'ente o CIG" className="omnia-input" maxLength={120} />
          <button type="submit" className="omnia-btn omnia-btn-p">
            Cerca
          </button>
        </div>

        <div className="omnia-opp-colonne">
          <PannelloFiltri attivi={attivi}>
            <fieldset className="omnia-opp-gruppo">
              <legend>Settore</legend>
              {SETTORI_RADAR.map((s) => (
                <label key={s.id} className="omnia-opp-scelta">
                  <input type="checkbox" name="settore" value={s.id} defaultChecked={filtri.settori.includes(s.id)} /> {s.nome}
                </label>
              ))}
            </fieldset>
            {/* C5 (analisi 49): bandi, candidature (manifestazioni, indagini, preinformazioni), iscrizioni; nessuna casella = tutti i tipi */}
            <fieldset className="omnia-opp-gruppo">
              <legend>Tipo</legend>
              {CATEGORIE_TIPO.map((c) => (
                <label key={c.id} className="omnia-opp-scelta">
                  <input type="checkbox" name="tipo" value={c.id} defaultChecked={filtri.tipi.includes(c.id)} /> {c.etichetta}
                </label>
              ))}
            </fieldset>
            <details className="omnia-opp-gruppo" open={filtri.regioni.length > 0}>
              <summary>Territorio{filtri.regioni.length ? ` (${filtri.regioni.length})` : ""}</summary>
              <div className="omnia-opp-regioni">
                {REGIONI.map((r) => (
                  <label key={r.id} className="omnia-opp-scelta">
                    <input type="checkbox" name="regione" value={r.id} defaultChecked={filtri.regioni.includes(r.id)} /> {r.nome}
                  </label>
                ))}
              </div>
              <p className="omnia-opp-nota">Luogo di esecuzione indicato nell&apos;avviso (o, se manca, la sede dell&apos;ente).</p>
            </details>
            <fieldset className="omnia-opp-gruppo">
              <legend>Importo stimato (€)</legend>
              <div className="omnia-opp-due">
                <label>
                  <span className="omnia-etichetta">da</span>
                  <input name="min" inputMode="numeric" defaultValue={filtri.importoMin ?? ""} className="omnia-input" placeholder="es. 100000" />
                </label>
                <label>
                  <span className="omnia-etichetta">fino a</span>
                  <input name="max" inputMode="numeric" defaultValue={filtri.importoMax ?? ""} className="omnia-input" placeholder="es. 5000000" />
                </label>
              </div>
            </fieldset>
            <fieldset className="omnia-opp-gruppo">
              <legend>Date</legend>
              <label>
                <span className="omnia-etichetta">Scade entro</span>
                <select name="scadenza" defaultValue={filtri.scadenzaEntroGiorni ?? ""} className="omnia-select">
                  <option value="">qualsiasi data</option>
                  {SCADENZE_RAPIDE.map((g) => (
                    <option key={g} value={g}>
                      {g} giorni
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className="omnia-etichetta">Pubblicata negli ultimi</span>
                <select name="pubblicata" defaultValue={filtri.pubblicataNegliUltimiGiorni ?? ""} className="omnia-select">
                  <option value="">qualsiasi data</option>
                  <option value="7">7 giorni</option>
                  <option value="30">30 giorni</option>
                  <option value="90">90 giorni</option>
                </select>
              </label>
            </fieldset>
            <details className="omnia-opp-gruppo" open={filtri.procedure.length > 0}>
              <summary>Procedura{filtri.procedure.length ? ` (${filtri.procedure.length})` : ""}</summary>
              {PROCEDURE_RICERCA.map((p) => (
                <label key={p.id} className="omnia-opp-scelta">
                  <input type="checkbox" name="procedura" value={p.id} defaultChecked={filtri.procedure.includes(p.id)} /> {p.etichetta}
                </label>
              ))}
            </details>
            <fieldset className="omnia-opp-gruppo">
              <legend>Stato</legend>
              <select name="stato" defaultValue={filtri.stato} className="omnia-select" aria-label="Stato delle gare">
                <option value="aperte">Solo aperte</option>
                <option value="storico">Solo scadute e chiuse (storico)</option>
                <option value="tutte">Aperte e storico</option>
              </select>
            </fieldset>
            <input type="hidden" name="ordina" value={filtri.ordina} />
            <button type="submit" className="omnia-btn omnia-btn-s omnia-btn-piccolo">
              Applica i filtri
            </button>
          </PannelloFiltri>

          <div className="omnia-opp-risultati">
            {(chip.length > 0 || filtri.q) && (
              <div className="omnia-opp-chip-riga">
                {chip.map((c) => (
                  <FiltroRimovibile key={c.etichetta} filtri={filtri} etichetta={c.etichetta} senza={c.senza} />
                ))}
                <Link href={base} className="omnia-opp-azzera">
                  Azzera
                </Link>
              </div>
            )}

            {sinonimi.length > 0 && (
              <p className="omnia-opp-sinonimi">
                Ho cercato anche: {sinonimi.map((s) => s.termine).join(", ")}{" "}
                <span className="omnia-opp-nota">(sinonimi del settore {nomeSettore(sinonimi[0].settore).toLowerCase()} presi dalla mappa CPV approvata e dalle parole chiave del settore)</span>
              </p>
            )}

            {risultato && (
              <div className="omnia-opp-conteggio">
                <span>
                  {risultato.errore
                    ? "Ricerca non riuscita: riprova tra poco."
                    : risultato.candidati === 0
                      ? "Nessuna gara con questi criteri."
                      : `${risultato.candidati.toLocaleString("it-IT")}${risultato.oltreTetto ? "+" : ""} ${risultato.candidati === 1 ? "gara" : "gare"}${filtri.stato === "aperte" ? " aperte" : ""}`}
                </span>
                <span className="omnia-opp-ordina">
                  Ordina:{" "}
                  {(Object.keys(ORDINAMENTI_ETICHETTE) as (keyof typeof ORDINAMENTI_ETICHETTE)[]).map((o) =>
                    o === filtri.ordina ? (
                      <strong key={o}>{ORDINAMENTI_ETICHETTE[o]}</strong>
                    ) : (
                      <Link key={o} href={`${base}${parametriDaFiltri(filtri, { ordina: o, pagina: 1 })}`}>
                        {ORDINAMENTI_ETICHETTE[o]}
                      </Link>
                    ),
                  )}
                </span>
              </div>
            )}
            {risultato?.oltreTetto && <p className="omnia-opp-nota">Più di 500 gare: vedi le 500 pubblicate più di recente. Restringi i filtri per vederle tutte.</p>}

            <div className="omnia-opp-elenco">
              {(risultato?.righe ?? []).map((r, i, righe) => {
                const s = salvataggi.get(r.id);
                // fase B3, requisiti 2 e 3: ordinando per rilevanza, un titoletto prima delle correlate (B) e prima di quelle fuori dai settori (C)
                const fascia = risultato?.classificazioni && filtri.ordina === "rilevanza" ? fasciaRilevanza(r, filtri) : 0;
                const titoletto = fascia > 0 && (i === 0 || fasciaRilevanza(righe[i - 1], filtri) !== fascia) ? TITOLETTI_FASCIA[fascia] : null;
                return (
                  <Fragment key={r.id}>
                  {titoletto && (
                    <div className="omnia-opp-separatore" role="separator">
                      <strong>{titoletto.titolo}</strong> {titoletto.testo}
                    </div>
                  )}
                  <RigaGara
                    adesso={adesso}
                    d={{
                      href: hrefGara(r.id),
                      titolo: r.oggetto_breve ?? r.oggetto,
                      ente: r.sa_denominazione,
                      comune: r.sa_comune,
                      provincia: r.sa_provincia,
                      regioni: r.luogo_regioni,
                      scadenza: r.scadenza_offerte,
                      scadenzaGiorno: r.scadenza_giorno,
                      valore: r.valore_stimato,
                      tipoValore: "Valore stimato",
                      durataMesi: r.durata_mesi,
                      nLotti: r.n_lotti,
                      settori: r.settori,
                      tipoProcedura: r.tipo_procedura,
                      stato: r.stato,
                      rettificata: r.rettificata,
                      motivi: r.punteggio.motivi,
                      rilevanza: etichettaRicerca(r, filtri),
                      settoriDettaglio: settoriDellaRiga(r),
                      statoClassificazione: etichettaStatoClassificazione(r),
                      fonte: etichettaFontiElenco(fontiGare.get(r.id)),
                      // C4/C5: il tipo della gara (ricavato dal tipo dell'avviso se la colonna è vuota), sempre scritto nella riga
                      tipo: tipoDellaGara(r),
                      verificataIl: r.ultima_rilevazione_il,
                      salvata: !!s,
                      monitorata: !!s?.monitorata,
                    }}
                  />
                  </Fragment>
                );
              })}
            </div>

            {risultato && risultato.pagine > 1 && (
              <nav className="omnia-opp-pagine" aria-label="Pagine dei risultati">
                {filtri.pagina > 1 && <Link href={`${base}${parametriDaFiltri(filtri, { pagina: filtri.pagina - 1 })}`}>← Precedente</Link>}
                <span>
                  Pagina {Math.min(filtri.pagina, risultato.pagine)} di {risultato.pagine}
                </span>
                {filtri.pagina < risultato.pagine && <Link href={`${base}${parametriDaFiltri(filtri, { pagina: filtri.pagina + 1 })}`}>Successiva →</Link>}
              </nav>
            )}

            <FontiRicerca fonti={statiFonti} />
          </div>
        </div>
      </form>
    </div>
  );
}
