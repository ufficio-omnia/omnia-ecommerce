import Link from "next/link";
import { notFound } from "next/navigation";
import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { richiediTitolarePagina } from "@/lib/omnia-ai-account-guardie";
import { dirittoRadarOppure404, RADICE_OPPORTUNITA } from "@/lib/radar/area-cliente";
import { leggiGaraPubblica, leggiSalvataggi, type AggiornamentoGara } from "@/lib/radar/gara";
import { ETICHETTA_STATO, statoMostrato } from "@/lib/radar/importa-calcoli";
import { sintesiDeterministica, scadenzaLeggibile, euro, giorniAllaScadenza } from "@/lib/radar/sintesi-calcoli";
import { confrontaConSoglia, sogliaApplicabile } from "@/lib/radar/soglie-ue";
import { tipoEnteTed, fusoItaliano } from "@/lib/radar/fonti/ted-calcoli";
import { nomeSettore, voceCpv, type SettoreRadar } from "@/lib/radar/settori";
import TestataOpportunita from "@/components/omnia-ai/opportunita/testata-opportunita";
import AzioniSalvataggio from "@/components/omnia-ai/opportunita/azioni-salvataggio";
import { giorno, regioniLeggibili, settoriLeggibili } from "@/components/omnia-ai/opportunita/formato";

// Scheda di una gara del Radar (fase B1): «In sintesi» con le quattro informazioni chiave, panoramica senza modello (solo i dati
// dell'avviso), lotti, soglia UE spiegata, fonti verificabili (avviso ufficiale, versioni lette, date di verifica), cambiamenti rilevati.
// Ogni dato assente dice «non indicato dalla fonte». Requisiti, intelligence e documenti arrivano nelle fasi successive.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NON_INDICATO = "non indicato dalla fonte";

const MOTIVI_MODIFICA: Record<string, string> = {
  "update-add": "aggiornamento",
  "cor-buy": "correzione dell'ente",
  "cor-pub": "correzione dell'Ufficio delle pubblicazioni",
  "cor-esen": "correzione del servizio di invio",
  cancel: "annullamento",
  "cancel-intent": "intenzione di annullare",
  "info-release": "informazioni rese disponibili",
};

function descriviAggiornamento(a: AggiornamentoGara): string {
  const quando = giorno(a.rilevato_il);
  if (a.tipo === "nuova") return `Gara entrata nell'archivio il ${quando} (avviso ${a.id_fonte ?? ""}).`;
  if (a.tipo === "annullamento") return `Annullata secondo l'avviso ${a.id_fonte ?? ""}.`;
  if (a.tipo === "esito") return `Esito pubblicato (avviso ${a.id_fonte ?? ""}): ${a.valore_nuovo === "aggiudicata" ? "aggiudicata" : "chiusa senza aggiudicazione"}.`;
  const verbo = a.tipo === "proroga" ? "Proroga" : "Rettifica";
  if (a.campo === "scadenza_offerte") return `${verbo} (avviso ${a.id_fonte ?? ""}): scadenza da ${scadenzaLeggibile(a.valore_precedente, true) ?? "non indicata"} a ${scadenzaLeggibile(a.valore_nuovo, true) ?? "non indicata"}.`;
  if (a.campo === "valore_stimato") return `${verbo} (avviso ${a.id_fonte ?? ""}): valore stimato da ${euro(a.valore_precedente ? Number(a.valore_precedente) : null) ?? "non indicato"} a ${euro(a.valore_nuovo ? Number(a.valore_nuovo) : null) ?? "non indicato"}.`;
  if (a.campo === "oggetto") return `${verbo} (avviso ${a.id_fonte ?? ""}): oggetto modificato.`;
  if (a.campo === "url_documenti") return `${verbo} (avviso ${a.id_fonte ?? ""}): cambiato il collegamento ai documenti.`;
  if (a.campo === "n_lotti") return `${verbo} (avviso ${a.id_fonte ?? ""}): lotti da ${a.valore_precedente} a ${a.valore_nuovo}.`;
  return `${verbo} (avviso ${a.id_fonte ?? ""}).`;
}

function Dato({ etichetta, valore, nota }: { etichetta: string; valore: React.ReactNode; nota?: React.ReactNode }) {
  return (
    <div className="omnia-opp-sintesi-riga">
      <div className="omnia-opp-sintesi-etichetta">{etichetta}</div>
      <div className="omnia-opp-sintesi-valore">
        {valore}
        {nota && <div className="omnia-opp-nota">{nota}</div>}
      </div>
    </div>
  );
}

export default async function SchedaGaraPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sessione = await richiediTitolarePagina();
  if (!sessione) return null;
  const { contesto } = sessione;
  const { diritto } = await dirittoRadarOppure404(contesto.accountId);
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const da = (await searchParams).da;

  const admin = createAdminClient();
  const supabase = await createClient();
  const [dati, salvataggi] = await Promise.all([leggiGaraPubblica(admin, id), leggiSalvataggi(supabase, [id])]);
  if (!dati) notFound();
  const { gara: g, lotti, provenienze, aggiornamenti } = dati;
  const salvataggio = salvataggi.get(id) ?? null;
  const adesso = new Date();
  // aperta la scheda, le novità di una gara salvata risultano viste (dopo la risposta, senza rallentare la pagina)
  if (salvataggio) {
    after(async () => {
      await supabase.from("omnia_ai_radar_salvate").update({ ultimo_aggiornamento_visto_il: new Date().toISOString() }).eq("id", salvataggio.id);
    });
  }

  const stato = statoMostrato(g.stato, g.scadenza_offerte, adesso);
  const giorni = stato === "aperta" ? giorniAllaScadenza(g.scadenza_offerte, adesso) : null;
  const numeroAvviso = g.ultima_versione_id;
  const primoAvviso = [...provenienze].filter((p) => p.tipo_avviso?.startsWith("cn") || p.tipo_avviso?.startsWith("pin") || p.tipo_avviso?.startsWith("qu")).sort((a, b) => (a.pubblicato_il ?? "").localeCompare(b.pubblicato_il ?? ""))[0];
  const settori = g.settori as SettoreRadar[];
  const sintesi = sintesiDeterministica({
    oggetto: g.oggetto,
    settori,
    cpvPrincipale: g.cpv_principale,
    ente: g.sa_denominazione,
    comune: g.sa_comune,
    provincia: g.sa_provincia,
    valoreStimato: g.valore_stimato,
    durataMesi: g.durata_mesi,
    nLotti: g.n_lotti,
    tipoProcedura: g.tipo_procedura,
    criterio: g.criterio_aggiudicazione,
    scadenza: g.scadenza_offerte,
    scadenzaOraIndicata: g.scadenza_ora_indicata,
    fonte: "TED",
    numeroAvviso: primoAvviso?.id_fonte ?? numeroAvviso,
    dataPubblicazione: primoAvviso?.pubblicato_il ?? g.data_pubblicazione,
  });
  const soglia = sogliaApplicabile({
    natura: g.natura_contratto === "misto" ? null : g.natura_contratto,
    tipoEnte: tipoEnteTed(g.settori_speciali ? ["32014L0025"] : [], g.ente_tipo ? [g.ente_tipo] : []),
    cpvPrincipale: g.cpv_principale,
    dataPubblicazione: g.data_pubblicazione ?? adesso.toISOString().slice(0, 10),
  });
  const confronto = confrontaConSoglia(g.valore_stimato, soglia);
  const cpvTutti = g.cpv_tutti.map((c) => ({ c, voce: voceCpv(c) }));

  return (
    <div className="omnia-app-shell largo">
      <TestataOpportunita attiva={null} />
      <nav className="omnia-opp-briciole" aria-label="Percorso">
        <Link href={`${RADICE_OPPORTUNITA}/cerca`}>Opportunità</Link>
        {settori[0] && (
          <>
            {" "}
            › <Link href={`${RADICE_OPPORTUNITA}/cerca?settore=${settori[0]}`}>{nomeSettore(settori[0])}</Link>
          </>
        )}
        {g.luogo_regioni[0] && <> › {regioniLeggibili([g.luogo_regioni[0]])}</>}
      </nav>

      {da === "aggiungi" && <p className="omnia-messaggio-stato successo">Questa gara è già nell&apos;archivio pubblico: l&apos;abbiamo aggiunta alle tue gare monitorate.</p>}

      <h2 className="omnia-opp-scheda-titolo">{g.oggetto_breve ?? g.oggetto}</h2>
      <details className="omnia-opp-ufficiale">
        <summary>Titolo dell&apos;avviso ufficiale</summary>
        <p>{g.oggetto}</p>
      </details>

      <div className="omnia-opp-scheda-corpo">
        <section className="omnia-riquadro omnia-opp-insintesi" aria-labelledby="insintesi">
          <span id="insintesi" className="omnia-eyebrow">
            In sintesi
          </span>
          <Dato etichetta="Cosa" valore={voceCpv(g.cpv_principale)?.descrizione ? `${voceCpv(g.cpv_principale)?.descrizione} (CPV ${g.cpv_principale})` : g.cpv_principale ? `CPV ${g.cpv_principale}` : settoriLeggibili(settori) || NON_INDICATO} nota={settori.length ? `Settore: ${settoriLeggibili(settori)}${g.metodo_settore === "parole_chiave" ? " (trovato per parola chiave nell'oggetto)" : ""}` : undefined} />
          <Dato etichetta="Chi" valore={g.sa_denominazione ?? NON_INDICATO} nota={[g.sa_comune ? `${g.sa_comune}${g.sa_provincia ? ` (${g.sa_provincia})` : ""}` : null, g.sa_codice_fiscale ? `C.F. ${g.sa_codice_fiscale}` : null].filter(Boolean).join(" · ") || undefined} />
          <Dato
            etichetta="Quanto"
            valore={g.valore_stimato !== null ? `${euro(g.valore_stimato)} valore stimato` : `Valore stimato ${NON_INDICATO}`}
            nota={[g.durata_mesi ? `${g.durata_mesi} mesi` : null, g.n_lotti && g.n_lotti > 1 ? `${g.n_lotti} lotti` : null, "il valore stimato TED comprende di solito opzioni e rinnovi: non è la base di gara"].filter(Boolean).join(" · ")}
          />
          <Dato
            etichetta="Entro quando"
            valore={g.scadenza_offerte ? `${scadenzaLeggibile(g.scadenza_offerte, g.scadenza_ora_indicata)}${giorni !== null && giorni >= 0 ? ` · tra ${giorni} giorni` : ""}` : `Scadenza ${NON_INDICATO}`}
            nota={!fusoItaliano(g.scadenza_fonte) ? `Ora convertita in ora italiana; come scritta su TED: ${g.scadenza_fonte}. Verificala sull'avviso ufficiale.` : g.rettificata ? "Dati aggiornati all'ultima rettifica letta" : undefined}
          />
          <Dato etichetta="Stato" valore={ETICHETTA_STATO[stato]} />
          <Dato etichetta="Requisiti" valore="Non ancora analizzati" nota="L'analisi dei requisiti sui documenti di gara arriverà nelle prossime fasi." />
          <Dato
            etichetta="Fonte"
            valore={
              g.url_avviso ? (
                <a href={g.url_avviso} target="_blank" rel="noopener noreferrer">
                  TED, avviso {numeroAvviso}
                </a>
              ) : (
                "TED"
              )
            }
            nota={`Prima rilevazione ${giorno(g.prima_rilevazione_il)} · verificata il ${giorno(g.ultima_rilevazione_il)}`}
          />
        </section>

        <aside className="omnia-riquadro omnia-opp-scheda-azioni">
          <span className="omnia-eyebrow">Azioni</span>
          {g.url_documenti ? (
            <a href={g.url_documenti} target="_blank" rel="noopener noreferrer" className="omnia-btn omnia-btn-p">
              Apri i documenti sulla piattaforma
            </a>
          ) : (
            <p className="omnia-opp-nota">La fonte non indica dove sono i documenti di gara: cercali dall&apos;avviso ufficiale.</p>
          )}
          {g.piattaforma_host && <p className="omnia-opp-nota">Piattaforma: {g.piattaforma_host}. Non apriamo e non scarichiamo nulla in automatico.</p>}
          <AzioniSalvataggio proceduraId={g.id} salvata={!!salvataggio} monitorata={!!salvataggio?.monitorata} operativo={diritto.operativo} />
          <p className="omnia-opp-nota">«Analizza requisiti» e «Crea offerta tecnica» arriveranno nelle prossime fasi.</p>
        </aside>
      </div>

      <section className="omnia-riquadro" aria-labelledby="panoramica">
        <span id="panoramica" className="omnia-eyebrow">
          Panoramica
        </span>
        <div className="omnia-opp-prosa">
          {sintesi.map((f) => (
            <p key={f}>{f}</p>
          ))}
        </div>
        <p className="omnia-opp-nota">Sintesi costruita solo con i dati dell&apos;avviso, senza intelligenza artificiale.</p>

        <div className="omnia-dati-griglia">
          <div className="omnia-dato">
            <div className="omnia-dato-etichetta">Procedura</div>
            <div className="omnia-dato-valore">{g.tipo_procedura ?? NON_INDICATO}</div>
          </div>
          <div className="omnia-dato">
            <div className="omnia-dato-etichetta">Criterio</div>
            <div className="omnia-dato-valore">{g.criterio_aggiudicazione ?? NON_INDICATO}</div>
          </div>
          <div className="omnia-dato">
            <div className="omnia-dato-etichetta">Durata</div>
            <div className="omnia-dato-valore">{g.durata_mesi ? `${g.durata_mesi} mesi` : NON_INDICATO}</div>
          </div>
          <div className="omnia-dato">
            <div className="omnia-dato-etichetta">Luogo di esecuzione</div>
            <div className="omnia-dato-valore">{g.luogo_regioni.length ? regioniLeggibili(g.luogo_regioni) : NON_INDICATO}</div>
          </div>
          <div className="omnia-dato">
            <div className="omnia-dato-etichetta">Pubblicata</div>
            <div className="omnia-dato-valore">{giorno(g.data_pubblicazione) ?? NON_INDICATO}</div>
          </div>
          <div className="omnia-dato">
            <div className="omnia-dato-etichetta">Settori speciali</div>
            <div className="omnia-dato-valore">{g.settori_speciali === null ? NON_INDICATO : g.settori_speciali ? "Sì (direttiva 2014/25)" : "No"}</div>
          </div>
        </div>

        <h3 className="omnia-opp-sottotitolo">Soglia europea</h3>
        <p className="omnia-opp-prosa">{confronto.frase}</p>
        <p className="omnia-opp-nota">Una gara sotto soglia può comunque comparire su TED se l&apos;ente sceglie di pubblicarla.</p>

        <h3 className="omnia-opp-sottotitolo">CPV</h3>
        <ul className="omnia-opp-elenco-semplice">
          {cpvTutti.length === 0 && <li>{NON_INDICATO}</li>}
          {cpvTutti.map(({ c, voce }) => (
            <li key={c}>
              {c}
              {voce ? ` — ${voce.descrizione}` : ""}
              {c === g.cpv_principale ? " (principale)" : ""}
            </li>
          ))}
        </ul>

        <h3 className="omnia-opp-sottotitolo">Lotti</h3>
        {lotti.length === 0 ? (
          <p className="omnia-opp-nota">La fonte non elenca i lotti.</p>
        ) : (
          <div className="omnia-tabella-scroll">
            <table>
              <thead>
                <tr>
                  <th>Lotto</th>
                  <th>Oggetto</th>
                  <th className="num">Valore stimato</th>
                  <th>Scadenza</th>
                  <th>CIG</th>
                </tr>
              </thead>
              <tbody>
                {lotti.map((l) => (
                  <tr key={l.id}>
                    <td>{l.numero_lotto ?? "—"}</td>
                    <td>{l.oggetto ?? NON_INDICATO}</td>
                    <td className="num">{euro(l.valore_stimato) ?? "—"}</td>
                    <td>{scadenzaLeggibile(l.scadenza_offerte, l.scadenza_ora_indicata) ?? "—"}</td>
                    <td>{l.cig ?? "non indicato"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {lotti.length > 0 && lotti.every((l) => !l.cig) && <p className="omnia-opp-nota">Nei bandi TED il CIG quasi sempre manca: lo trovi nei documenti di gara.</p>}
      </section>

      <section className="omnia-riquadro" aria-labelledby="attivita">
        <span id="attivita" className="omnia-eyebrow">
          Attività e fonti
        </span>
        <p className="omnia-opp-prosa">{salvataggio ? (salvataggio.monitorata ? "Stai monitorando questa gara." : "Hai salvato questa gara.") : "Non stai seguendo questa gara."}</p>
        <h3 className="omnia-opp-sottotitolo">Cambiamenti rilevati</h3>
        <ul className="omnia-opp-elenco-semplice">
          {aggiornamenti.length === 0 && <li>Nessun cambiamento rilevato.</li>}
          {aggiornamenti.map((a) => (
            <li key={a.id}>{descriviAggiornamento(a)}</li>
          ))}
        </ul>
        <h3 className="omnia-opp-sottotitolo">Avvisi letti</h3>
        <ul className="omnia-opp-elenco-semplice">
          {provenienze.map((p) => (
            <li key={p.id_fonte}>
              {p.url ? (
                <a href={p.url} target="_blank" rel="noopener noreferrer">
                  TED {p.id_fonte}
                </a>
              ) : (
                `TED ${p.id_fonte}`
              )}
              {p.pubblicato_il ? ` · pubblicato il ${giorno(p.pubblicato_il)}` : ""}
              {p.versione ? ` · versione ${p.versione}` : ""}
              {p.motivo_modifica ? ` · ${MOTIVI_MODIFICA[p.motivo_modifica] ?? p.motivo_modifica}` : ""}
              {p.tipo_avviso?.startsWith("can") ? " · esito" : ""}
            </li>
          ))}
        </ul>
        <p className="omnia-opp-nota">Fonte: TED, Ufficio delle pubblicazioni dell&apos;Unione europea (riuso libero citando la fonte). Fa fede solo l&apos;avviso ufficiale.</p>
      </section>
    </div>
  );
}
