import { Fragment } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { richiediOpportunitaPagina } from "@/lib/radar/guardie-opportunita";
import { dirittoRadarOppure404, RADICE_OPPORTUNITA } from "@/lib/radar/area-cliente";
import { perTeAttivo } from "@/lib/radar/interruttori-b4";
import { leggiProfiloRadar } from "@/lib/radar/profilo";
import { filtriDaProfilo, motivoPerTe, ordinaEPaginaDaParametri, parametriPerTe, profiloVuoto } from "@/lib/radar/profilo-calcoli";
import { cercaGare, type RisultatoRicerca } from "@/lib/radar/ricerca";
import { leggiFontiGare, leggiSalvataggi } from "@/lib/radar/gara";
import { contaUtilizziRadar, registraUtilizzoRadar } from "@/lib/radar/utilizzi";
import { inizioFinestra, limiteEffettivo, verificaLimite } from "@/lib/radar/diritto-calcoli";
import { etichettaRicerca, etichettaStatoClassificazione, settoriDellaRiga, type Ordinamento } from "@/lib/radar/ricerca-calcoli";
import { classificazioniAttive } from "@/lib/radar/ambiente";
import { etichettaFontiElenco } from "@/lib/radar/fonti-gara-calcoli";
import { tipoDellaGara } from "@/lib/radar/tipo-gara-calcoli";
import { nomeSettore } from "@/lib/radar/settori";
import { nomeRegione } from "@/lib/radar/territorio";
import TestataOpportunita from "@/components/omnia-ai/opportunita/testata-opportunita";
import RigaGara, { hrefGara } from "@/components/omnia-ai/opportunita/riga-gara";
import { importoBreve } from "@/components/omnia-ai/opportunita/formato";

// «Per te» (fase B4, grado 1, RADAR_PER_TE: staging o deploy di produzione, interruttori-b4.ts): le gare aperte pertinenti al profilo dell'impresa. È la STESSA ricerca di
// «Cerca» (UNA richiesta all'archivio) con i filtri del profilo, più le regole del contratto in memoria: solo pertinenti (A), le correlate (B)
// solo se il profilo lo chiede, mai le non pertinenti (C). Le gare senza luogo compaiono (decisione del 19/11). Non conta nel limite delle
// ricerche: si registra come statistica «per_te». Nessun aggiornamento periodico: si calcola all'apertura della pagina.

const ORDINAMENTI_ETICHETTE: Record<Ordinamento, string> = { rilevanza: "Rilevanza", recenti: "Più recenti", scadenza: "Scadenza più vicina", importo: "Importo più alto" };

export default async function PerTePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sessione = await richiediOpportunitaPagina();
  if (!sessione) return null;
  const { contesto } = sessione;
  const { diritto, parametri, cliente } = await dirittoRadarOppure404(contesto.accountId);
  if (!perTeAttivo(process.env)) notFound();
  const { ordina, pagina } = ordinaEPaginaDaParametri(await searchParams);
  const titolare = contesto.ruolo === "titolare";
  const supabase = await createClient();
  const { disponibile, profilo } = await leggiProfiloRadar(supabase, contesto.accountId);
  const classificazioni = classificazioniAttive(process.env);
  const admin = createAdminClient();
  const adesso = new Date();
  const base = `${RADICE_OPPORTUNITA}/per-te`;
  const filtri = profilo ? filtriDaProfilo(profilo, ordina, pagina) : null;

  let risultato: RisultatoRicerca | null = null;
  let limitata = false;
  if (disponibile && profilo && filtri && !profiloVuoto(profilo) && classificazioni && diritto.operativo) {
    // stesso limite tecnico al minuto di Cerca, contato a parte («per_te» non è una ricerca commerciale); un conteggio non riuscito non concede
    const usate = await contaUtilizziRadar(admin, contesto.accountId, "per_te", inizioFinestra("ricerche_minuto", adesso) as Date);
    if (usate === null || !verificaLimite(usate, limiteEffettivo(parametri, cliente, "ricerche_minuto")).consentito) {
      limitata = true;
    } else {
      risultato = await cercaGare(admin, filtri, adesso, { classificazioni: true, perTe: profilo });
      after(() => registraUtilizzoRadar({ accountId: contesto.accountId, membroId: contesto.userId, azione: "per_te" }));
    }
  }

  const ids = (risultato?.righe ?? []).map((r) => r.id);
  const [salvataggi, fontiGare] = await Promise.all([leggiSalvataggi(supabase, ids), leggiFontiGare(admin, ids)]);
  const riassunto = profilo && filtri
    ? [
        filtri.settori.map(nomeSettore).join(", "),
        profilo.regioni.length ? profilo.regioni.map((r) => nomeRegione(r) ?? r).join(", ") : "tutta Italia",
        profilo.importoMin !== null || profilo.importoMax !== null
          ? [profilo.importoMin !== null ? `da ${importoBreve(profilo.importoMin)}` : "", profilo.importoMax !== null ? `fino a ${importoBreve(profilo.importoMax)}` : ""].filter(Boolean).join(" ")
          : "",
        profilo.vedereCorrelate ? "con le gare correlate" : "",
      ].filter(Boolean)
    : [];

  return (
    <div className="omnia-app-shell largo">
      <TestataOpportunita attiva="per-te" sottotitolo="Le gare aperte in linea con il profilo dell'impresa. Ogni gara dice perché compare, da quale fonte viene e quando è stata aggiornata." />

      {!diritto.operativo && <p className="omnia-messaggio-stato avviso">{diritto.messaggioSolaLettura}</p>}
      {limitata && <p className="omnia-messaggio-stato avviso">Troppe aperture nell&apos;ultimo minuto: riprova tra qualche secondo.</p>}

      {!disponibile ? (
        <p className="omnia-messaggio-stato avviso">Il profilo di ricerca non è ancora disponibile.</p>
      ) : profiloVuoto(profilo) ? (
        <div>
          <p className="omnia-opp-prosa">
            {titolare
              ? "Per vedere le gare in linea con l'impresa, indica nel profilo di ricerca i settori che segui (e, se vuoi, regioni, importi e procedure)."
              : "Il titolare dell'impresa non ha ancora compilato il profilo di ricerca: quando lo farà, qui troverai le gare in linea con l'impresa."}
          </p>
          <p>
            <Link href={`${RADICE_OPPORTUNITA}/profilo`} prefetch={false} className="omnia-btn omnia-btn-p omnia-btn-piccolo">
              {titolare ? "Compila il profilo di ricerca" : "Vedi il profilo di ricerca"}
            </Link>
          </p>
        </div>
      ) : !classificazioni ? (
        <p className="omnia-messaggio-stato avviso">«Per te» propone solo gare già classificate per settore: la classificazione non è ancora attiva. Nel frattempo usa «Cerca».</p>
      ) : (
        <>
          <p className="omnia-opp-nota">
            Profilo: {riassunto.join(" · ")}.{" "}
            <Link href={`${RADICE_OPPORTUNITA}/profilo`} prefetch={false}>
              {titolare ? "Modifica il profilo" : "Vedi il profilo"}
            </Link>
          </p>

          {risultato && (
            <div className="omnia-opp-conteggio">
              <span>
                {risultato.errore
                  ? "Ricerca non riuscita: riprova tra poco."
                  : risultato.candidati === 0
                    ? "Nessuna gara aperta in linea con il profilo, per ora."
                    : `${risultato.candidati.toLocaleString("it-IT")}${risultato.oltreTetto ? "+" : ""} ${risultato.candidati === 1 ? "gara aperta" : "gare aperte"}`}
              </span>
              <span className="omnia-opp-ordina">
                Ordina:{" "}
                {(Object.keys(ORDINAMENTI_ETICHETTE) as Ordinamento[]).map((o) =>
                  o === ordina ? (
                    <strong key={o}>{ORDINAMENTI_ETICHETTE[o]}</strong>
                  ) : (
                    <Link key={o} href={`${base}${parametriPerTe(o, 1)}`} prefetch={false}>
                      {ORDINAMENTI_ETICHETTE[o]}
                    </Link>
                  ),
                )}
              </span>
            </div>
          )}
          {risultato?.oltreTetto && <p className="omnia-opp-nota">Più di 500 gare: vedi le più recenti. Restringi il profilo (regioni, importi, sottocategorie) per vederle tutte.</p>}

          <div className="omnia-opp-elenco">
            {(risultato?.righe ?? []).map((r, i, righe) => {
              const s = salvataggi.get(r.id);
              const o = risultato?.perTe?.[r.id];
              const primaCorrelata = o?.tipo === "correlata" && (i === 0 || risultato?.perTe?.[righe[i - 1].id]?.tipo !== "correlata");
              return (
                <Fragment key={r.id}>
                  {primaCorrelata && (
                    <div className="omnia-opp-separatore" role="separator">
                      <strong>Gare correlate</strong> Appalti misti, concessioni o gestioni complesse che comprendono il servizio: da valutare per intero.
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
                      motivi: [...(o && profilo ? [motivoPerTe(o, profilo, r.luogo_regioni)] : []), ...r.punteggio.motivi],
                      rilevanza: etichettaRicerca(r, filtri ?? { settori: [] }),
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
              {pagina > 1 && (
                <Link href={`${base}${parametriPerTe(ordina, pagina - 1)}`} prefetch={false}>
                  ← Precedente
                </Link>
              )}
              <span>
                Pagina {Math.min(pagina, risultato.pagine)} di {risultato.pagine}
              </span>
              {pagina < risultato.pagine && (
                <Link href={`${base}${parametriPerTe(ordina, pagina + 1)}`} prefetch={false}>
                  Successiva →
                </Link>
              )}
            </nav>
          )}
        </>
      )}
    </div>
  );
}
