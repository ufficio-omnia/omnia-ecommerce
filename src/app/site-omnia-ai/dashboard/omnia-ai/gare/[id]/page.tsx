import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getOmniaAiAccessState } from "@/lib/omnia-ai-access";
import { richiediAccountPagina } from "@/lib/omnia-ai-account-guardie";
import { clientePerAccount, dirittoGaraPerAccount } from "@/lib/omnia-ai-account-lavoro";
import { downloadGaraDocumento } from "@/app/actions/download";
import { deleteGara, removeGaraDocumento } from "@/app/actions/gare";
import OpenInNewTabButton from "@/components/open-in-new-tab-button";
import DeleteButton from "@/components/delete-button";
import UploadDocumentoForm from "./upload-documento-form";
import LogoClienteForm from "./logo-cliente-form";
import GaraTitolo from "./gara-titolo";
import ExtractionSection, { type Estrazione, type ProrogaGara } from "./extraction-section";
import { documentiDopoUltimaAnalisi, ordinaPerCaricamento, testoDataCaricamento } from "@/lib/gara-documenti-elenco";
import GaraBloccataAvviso from "./gara-bloccata-avviso";
import RevisionePanel from "./revisione-panel";
import { leggiContestoRevisione } from "@/lib/omnia-ai-revisione";
import { calcolaPrezzoRevisione } from "@/lib/omnia-ai-revisione-calcoli";
import ChatSection, { type GaraMessaggio } from "./chat-section";
import PianoLavoroPanel from "./piano-lavoro-panel";
import FoodMenuPanel from "./food-menu-panel";
import CopertinaPanel, { type CopertinaVista, type DocumentoScelta, type StatoStile } from "./copertina-panel";
import { dataDaMarca, STILI } from "@/lib/copertina-relazione-calcoli";
import { COPERTINE_PER_STILE, copertinaVisibile, righeGratisPerCliente } from "@/lib/copertina-diritto-calcoli";
import { decidi as decidiCopertina, leggiContestoCopertina, sviluppoLocale } from "@/lib/copertina-diritto";
import { interpretaRitornoCopertina, valutaOffertaCopertina, type OffertaCopertina, type RitornoPagamentoCopertina } from "@/lib/copertina-acquisto-calcoli";
import { documentoPredefinito, soloPdf } from "@/lib/copertina-lettura-calcoli";
import { elencaCopertine, leggiPercorsoLogoCliente, linkCopertina } from "@/lib/copertina-relazione";
import { normalizzaSettore, proponeFoodMenu, proponePianoLavoro } from "@/lib/gara-settore";
import { leggiPianiGara } from "@/lib/piano-lavoro-gara";
import { aperturaSviluppoAttiva, valutaDirittoPiano } from "@/lib/piano-lavoro-gara-calcoli";
import { leggiPrezzoPianoLavoro, venditaPianoLavoroAttiva } from "@/lib/piano-lavoro-acquisto";
import { leggiCatalogoPacchetti, leggiOfferteAttive, pacchettiDisponibili } from "@/lib/pacchetti-servizi";
import { proponiPacchettoPiuConveniente, type PacchettoNellaGara } from "@/lib/pacchetti-servizi-calcoli";
import { leggiDirittiPianoLavoro } from "@/lib/piano-lavoro-diritti";
import { interpretaRitornoPagamento, valutaOffertaAcquisto } from "@/lib/piano-lavoro-acquisto-calcoli";
import { getCurrentOmniaAiLegalDocuments } from "@/lib/omnia-ai-legal";

// sendGaraMessage (chiamato da questa pagina) fa sempre almeno due chiamate
// reali al modello in sequenza quando genera una bozza di sezione
// (generazione con "thinking: adaptive" + verificaDatiAziendali, altrettanto
// con ragionamento esteso): su un criterio grande, osservato in produzione
// ~150s ciascuna, a sufficienza da superare da sole il tetto di 300s del
// piano Hobby (504 "Vercel Runtime Timeout" reale, non teorico — due volte
// nello stesso giorno). Col piano Pro il tetto generale disponibile è 800s;
// Next.js applica il maxDuration della PAGINA anche ai Server Action
// richiamati da essa (non serve impostarlo sul file dell'azione).
export const maxDuration = 800;

type Gara = {
  id: string;
  titolo: string;
  created_at: string;
  logo_cliente_path: string | null;
} & Estrazione;

type Documento = {
  id: string;
  nome_file: string;
  created_at: string;
};

export default async function GaraPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ piano_lavoro?: string | string[]; copertina?: string | string[] }>;
}) {
  const { id } = await params;
  const { piano_lavoro: ritornoPianoLavoro, copertina: ritornoCopertina } = await searchParams;
  const supabase = await createClient();
  // Titolare o Ufficio Gare: la gara è dell'azienda (del titolare); le regole di accesso la mostrano a entrambi.
  const sessione = await richiediAccountPagina();
  if (!sessione) return null;
  const { user, contesto } = sessione;
  const ufficioGare = contesto.ruolo === "ufficio_gare";
  // abbonamento e piano si leggono sul titolare (l'Ufficio Gare non ha accesso a quelle tabelle)
  const clienteAbbonamento = clientePerAccount(contesto, supabase);

  // Serve solo per proporre il confronto "credito o piano superiore" nel
  // messaggio di quota esaurita (ExtractionSection, solo per il titolare): il gate vero e
  // proprio resta in consumeGaraQuotaIfNeeded, invariato.
  const statoAccesso = await getOmniaAiAccessState(contesto.accountId, clienteAbbonamento);
  const { data: subscriptionAttiva } = await clienteAbbonamento
    .from("subscriptions")
    .select("plan")
    .eq("user_id", contesto.accountId)
    .eq("status", "attivo")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ plan: string }>();

  // La RLS ("gare_all_own") garantisce che questa query restituisca la
  // gara solo se appartiene all'utente corrente.
  const { data: gara, error: garaError } = await supabase
    .from("gare")
    .select(
      "id, titolo, created_at, logo_cliente_path, scadenza, importo, criteri_valutazione, requisiti, limiti_formattazione, relazione_font, relazione_dimensione_carattere, relazione_interlinea, limite_pagine_totale, punteggio_tecnico_max, punteggio_economico_max, criteri_riepilogo, requisiti_chiave, estrazione_stato, estrazione_aggiornata_il",
    )
    .eq("id", id)
    .single<Gara>();

  // Un errore del database (es. una migrazione non ancora applicata, con
  // colonne mancanti) va distinto da "gara non trovata": altrimenti
  // diventa un 404 silenzioso senza nessuna indicazione della vera causa
  // (bug osservato in pratica, ha richiesto un'indagine manuale).
  if (garaError) {
    console.error("Errore caricamento gara:", garaError);
    throw new Error(
      `Errore nel caricamento della gara: ${garaError.message}. Controlla che tutte le migrazioni del database siano state applicate.`,
    );
  }

  if (!gara) {
    notFound();
  }

  const [{ data: documenti }, { data: messaggiConAvvisi, error: erroreMessaggi }, { data: chunksRaw }, { data: allegatiRaw }] =
    await Promise.all([
      supabase
        .from("gara_documenti")
        .select("id, nome_file, created_at")
        .eq("gara_id", id)
        .order("created_at", { ascending: true })
        .returns<Documento[]>(),
      supabase
        .from("gara_messaggi")
        .select("id, ruolo, contenuto, created_at, file_nome, file_path, pagine_stimate, avvisi_economici")
        .eq("gara_id", id)
        .order("created_at", { ascending: true })
        .returns<Omit<GaraMessaggio, "allegati">[]>(),
      supabase
        .from("gara_documenti_chunks")
        .select("documento_id")
        .eq("gara_id", id)
        .returns<{ documento_id: string }[]>(),
      supabase
        .from("gara_messaggio_allegati")
        .select("id, messaggio_id, nome_file")
        .eq("gara_id", id)
        .order("created_at", { ascending: true })
        .returns<{ id: string; messaggio_id: string; nome_file: string }[]>(),
    ]);

  // Documenti in ordine cronologico di caricamento (dal più vecchio), ciascuno con la data di caricamento; quelli già caricati in
  // passato hanno la loro data (gara_documenti.created_at c'è da sempre).
  const documentiOrdinati = ordinaPerCaricamento(documenti ?? []);
  const documentiNuovi = documentiDopoUltimaAnalisi(documentiOrdinati, gara.estrazione_stato === "completata" ? gara.estrazione_aggiornata_il : null);

  // Proroga dei termini di presentazione (migrazione 0095): colonne non ancora create → nessun dato, la scheda funziona come prima.
  const { data: prorogaRaw } = await supabase
    .from("gare")
    .select("proroga_stato, scadenza_originaria, scadenza_manuale")
    .eq("id", id)
    .maybeSingle<ProrogaGara>();

  // Ora della scadenza scritta a mano dal cliente (migrazione 0102), in una lettura a parte: senza la colonna nessuna ora risulta «a mano».
  const { data: oraManualeRaw } = await supabase.from("gare").select("scadenza_ora_manuale").eq("id", id).maybeSingle<{ scadenza_ora_manuale: boolean | null }>();

  // Settore della gara (migrazione 0103), in una lettura a parte: senza la colonna (o per una gara analizzata prima) il settore è «non classificato»
  // e la scheda si comporta come prima. Decide quale servizio aggiuntivo si propone oltre alla relazione tecnica (src/lib/gara-settore.ts).
  const { data: settoreRaw } = await supabase.from("gare").select("settore").eq("id", id).maybeSingle<{ settore: string | null }>();
  const settore = normalizzaSettore(settoreRaw?.settore);

  // Colonna avvisi_economici non ancora creata (migrazione 0070): senza
  // questo ripiego la query intera fallirebbe e la chat apparirebbe vuota.
  let messaggiRaw = messaggiConAvvisi;
  if (erroreMessaggi) {
    console.error("Lettura messaggi con avvisi_economici fallita, ripiego senza la colonna:", erroreMessaggi);
    const { data } = await supabase
      .from("gara_messaggi")
      .select("id, ruolo, contenuto, created_at, file_nome, file_path, pagine_stimate")
      .eq("gara_id", id)
      .order("created_at", { ascending: true })
      .returns<Omit<GaraMessaggio, "allegati" | "avvisi_economici">[]>();
    messaggiRaw = (data ?? []).map((m) => ({ ...m, avvisi_economici: null }));
  }

  const allegatiPerMessaggio = new Map<string, { id: string; nome_file: string }[]>();
  for (const a of allegatiRaw ?? []) {
    const lista = allegatiPerMessaggio.get(a.messaggio_id) ?? [];
    lista.push({ id: a.id, nome_file: a.nome_file });
    allegatiPerMessaggio.set(a.messaggio_id, lista);
  }
  const messaggi: GaraMessaggio[] = (messaggiRaw ?? []).map((m) => ({
    ...m,
    allegati: allegatiPerMessaggio.get(m.id) ?? [],
  }));

  // Gare del piano, crediti o gare gratuite finite e questa gara non ha mai consumato una gara:
  // chat e caricamento documenti restano spenti (il vero blocco è nelle azioni, qui solo la vista).
  // (per l'Ufficio Gare, a gare finite: il promemoria per l'amministratore, e al titolare parte l'email)
  const diritto = await dirittoGaraPerAccount({ contesto, user, garaId: gara.id });

  // «Richiedi revisione umana»: compare solo dopo la relazione tecnica FINALE, con il prezzo calcolato per questa gara.
  const contestoRevisione = await leggiContestoRevisione({ supabase, admin: createAdminClient(), userId: contesto.accountId, garaId: gara.id });
  const esitoRevisione = contestoRevisione?.relazione
    ? calcolaPrezzoRevisione({
        scadenza: gara.scadenza,
        scadenzaOra: contestoRevisione.gara.scadenza_ora,
        limitePagineDisciplinare: gara.limite_pagine_totale,
        pagineStimateRelazione: contestoRevisione.relazione.pagineStimate,
        adesso: new Date(),
      })
    : null;

  // «Piano di lavoro»: i piani già generati e chi può generare adesso (le regole stanno in piano-lavoro-gara-calcoli.ts; l'azione le ricontrolla).
  // Senza la migrazione 0096 la scheda non compare e la pagina funziona come sempre.
  const { disponibile: pianoLavoroDisponibile, piani: pianiLavoro } = await leggiPianiGara(supabase, gara.id);
  const adminPianoLavoro = createAdminClient();
  // da dove può venire il diritto (concessione, abbonamento con piano di lavoro, prova gratuita, acquisto): le stesse letture dell'azione
  const dirittiPianoLavoro = await leggiDirittiPianoLavoro({ admin: adminPianoLavoro, accountId: contesto.accountId, garaId: gara.id, statoAccesso });
  const dirittoPianoLavoro = valutaDirittoPiano({
    analisiCompleta: gara.estrazione_stato === "completata",
    garaUsabile: diritto.consentito,
    messaggioGaraBloccata: diritto.consentito ? undefined : diritto.messaggio,
    piani: pianiLavoro,
    prorogaStato: prorogaRaw?.proroga_stato ?? null,
    concessioneId: dirittiPianoLavoro.concessioneId,
    abbonamentoCopreGara: dirittiPianoLavoro.abbonamentoCopreGara,
    provaGratuita: dirittiPianoLavoro.provaGratuita,
    acquistoPagato: dirittiPianoLavoro.acquistoPagato,
    pacchettoSaldo: dirittiPianoLavoro.pacchettoSaldo,
    pacchettoGaraConsumata: dirittiPianoLavoro.pacchettoGaraConsumata,
    aperturaSviluppo: aperturaSviluppoAttiva(process.env),
    adesso: new Date(),
  });
  // Acquisto singolo: si offre solo se manca il diritto, la vendita è accesa, la console non l'ha escluso per la prova e (per comprare) si è il titolare
  const offertaPianoLavoro = valutaOffertaAcquisto({
    diritto: dirittoPianoLavoro,
    titolare: !ufficioGare,
    venditaAttiva: !dirittoPianoLavoro.ok && dirittoPianoLavoro.motivo === "non_attivo" && !dirittiPianoLavoro.provaBloccata ? await venditaPianoLavoroAttiva(adminPianoLavoro) : false,
    prezzoCentesimi: !dirittoPianoLavoro.ok && dirittoPianoLavoro.motivo === "non_attivo" ? await leggiPrezzoPianoLavoro(adminPianoLavoro) : 0,
  });
  // la Privacy policy in vigore, da linkare accanto all'accettazione delle avvertenze
  const documentiLegaliPianoLavoro = offertaPianoLavoro.stato === "acquistabile" ? await getCurrentOmniaAiLegalDocuments(adminPianoLavoro) : null;
  // Pacchetto prepagato: le unità residue, se questa gara ha già usato la sua e, a chi può comprare, il pacchetto più conveniente da proporre
  // accanto all'acquisto della singola gara (solo quando l'acquisto singolo è offerto).
  const pacchettoPianoLavoro: PacchettoNellaGara = {
    saldo: dirittiPianoLavoro.pacchettoSaldo,
    garaGiaConsumata: dirittiPianoLavoro.pacchettoGaraConsumata,
    proposta: offertaPianoLavoro.stato === "acquistabile" && (await pacchettiDisponibili(adminPianoLavoro)) ? proponiPacchettoPiuConveniente(await leggiCatalogoPacchetti("piano_lavoro", adminPianoLavoro), await leggiOfferteAttive(adminPianoLavoro, contesto.accountId)) : null,
  };

  // «Copertina relazione tecnica»: compare dopo l'analisi dei documenti, solo se la console ha acceso il servizio per questo cliente (o se ci sono già copertine
  // da scaricare: spegnere il servizio non toglie i file al cliente). Il cliente sceglie il PDF da cui leggere titolo e CIG (proposto: il disciplinare, poi il
  // capitolato); si mostrano quali loghi ci sono, quante generazioni restano per stile, ciò che resta del periodo gratuito e le copertine già generate.
  // Chi può generare lo decide l'azione, con le stesse regole (copertina-diritto-calcoli.ts).
  let copertinaPannello: {
    stazioneAppaltante: string | null;
    logoStazione: boolean;
    logoCliente: boolean;
    documenti: DocumentoScelta[];
    documentoPredefinito: string | null;
    stili: StatoStile[];
    righeGratis: string[];
    offerta: OffertaCopertina;
    ritorno: RitornoPagamentoCopertina;
    privacyVersione: number | null;
    acquistata: boolean;
    copertine: CopertinaVista[];
  } | null = null;
  if (gara.estrazione_stato === "completata") {
    const adminCopertina = createAdminClient();
    const [{ data: datiGaraCopertina }, percorsoLogoCliente, elencoCopertine, ctxCopertina] = await Promise.all([
      supabase.from("gare").select("stazione_appaltante").eq("id", id).maybeSingle<{ stazione_appaltante: string | null }>(),
      leggiPercorsoLogoCliente(adminCopertina, contesto.accountId),
      elencaCopertine(adminCopertina, gara.id),
      leggiContestoCopertina({ admin: adminCopertina, accountId: contesto.accountId, garaId: gara.id }),
    ]);
    const visibileCopertina = !ctxCopertina.errore && (copertinaVisibile({ impostazioni: ctxCopertina.impostazioni, schemaAssente: ctxCopertina.schemaAssente, sviluppoLocale: sviluppoLocale(process.env), acquistata: ctxCopertina.acquistata }) || elencoCopertine.length > 0);
    const pdfDellaGara = soloPdf(documentiOrdinati);
    const offertaCopertina: OffertaCopertina = valutaOffertaCopertina({ diritto: decidiCopertina(ctxCopertina, gara.id, "stilizzato"), titolare: !ufficioGare });
    // la Privacy policy in vigore, da linkare accanto all'accettazione delle condizioni (solo se si può comprare)
    const privacyCopertina = offertaCopertina.stato === "acquistabile" ? ((await getCurrentOmniaAiLegalDocuments(adminCopertina))?.privacyPolicy.version ?? null) : null;
    if (visibileCopertina) {
    const copertine: CopertinaVista[] = await Promise.all(
      elencoCopertine.slice(0, 8).map(async (c, i) => ({
        marca: c.marca,
        stile: c.stile,
        nomePng: c.png,
        nomePdf: c.pdf,
        generataIl: dataDaMarca(c.marca)?.toISOString() ?? null,
        // l'anteprima (il PNG intero) solo per le quattro più recenti (due per stile): le altre si scaricano e basta
        anteprimaUrl: i < 4 ? await linkCopertina(adminCopertina, gara.id, c.png) : null,
      })),
    );
    copertinaPannello = {
      stazioneAppaltante: datiGaraCopertina?.stazione_appaltante ?? null,
      logoStazione: Boolean(gara.logo_cliente_path),
      logoCliente: Boolean(percorsoLogoCliente),
      documenti: pdfDellaGara.map((d) => ({ id: d.id, nome_file: d.nome_file })),
      documentoPredefinito: documentoPredefinito(pdfDellaGara),
      // per ogni stile: quante generazioni ha fatto su questa gara e se può farne un'altra (con il perché, se no)
      stili: STILI.map((stile) => {
        const esito = decidiCopertina(ctxCopertina, gara.id, stile);
        return { stile, fatte: ctxCopertina.uso.perStile[stile], massime: COPERTINE_PER_STILE, consentito: esito.ok, motivo: esito.ok ? null : esito.motivo, messaggio: esito.ok ? null : esito.messaggio };
      }),
      righeGratis: righeGratisPerCliente(ctxCopertina.impostazioni, ctxCopertina.uso, gara.id),
      // servizio «a pagamento»: si offre l'acquisto a chi non ha ancora pagato questa gara e può pagare adesso (compra il titolare; l'Ufficio Gare vede che serve)
      offerta: offertaCopertina,
      ritorno: interpretaRitornoCopertina(ritornoCopertina),
      privacyVersione: privacyCopertina,
      acquistata: ctxCopertina.acquistata,
      copertine,
    };
    }
  }

  const chunkCountPerDocumento = new Map<string, number>();
  for (const chunk of chunksRaw ?? []) {
    chunkCountPerDocumento.set(
      chunk.documento_id,
      (chunkCountPerDocumento.get(chunk.documento_id) ?? 0) + 1,
    );
  }

  return (
    <div className="omnia-app-shell largo">
      <Link href="/dashboard/omnia-ai/gare" className="omnia-torna">
        ← Le tue gare
      </Link>

      <div className="omnia-app-intestazione" style={{ marginTop: 16 }}>
        <div>
          <GaraTitolo garaId={gara.id} titolo={gara.titolo} />
          <p className="omnia-eyebrow" style={{ marginTop: 6 }}>
            Creata il {new Date(gara.created_at).toLocaleDateString("it-IT")}
          </p>
        </div>
        <DeleteButton
          action={deleteGara}
          hiddenFields={{ garaId: gara.id }}
          confirmMessage={
            (gara.estrazione_stato === "completata"
              ? `Eliminare definitivamente la gara "${gara.titolo}" e tutti i documenti caricati? Questa gara ha già consumato una gara della tua quota (piano o credito): eliminarla non te la restituisce. L'operazione non è reversibile.`
              : `Eliminare definitivamente la gara "${gara.titolo}" e tutti i documenti caricati? L'operazione non è reversibile.`) +
            (pacchettoPianoLavoro.garaGiaConsumata ? " Per questa gara hai anche usato un piano di lavoro del tuo pacchetto: eliminarla non lo restituisce." : "")
          }
          label="Elimina gara"
          className="omnia-btn omnia-btn-s omnia-btn-piccolo"
        />
      </div>

      {!diritto.consentito && (
        <GaraBloccataAvviso
          messaggio={diritto.messaggio}
          motivo={diritto.motivo}
          pianoAttuale={subscriptionAttiva?.plan ?? null}
          ufficioGare={ufficioGare}
        />
      )}

      <section className="omnia-riquadro">
        <span className="omnia-eyebrow">Documenti</span>
        <p className="omnia-riquadro-nota">
          Carica bando, disciplinare, capitolato e ogni altro documento collegato a questa gara.
        </p>

        {documentiOrdinati.length ? (
          <div style={{ marginTop: 16 }}>
            {documentiOrdinati.map((d) => {
              const n = chunkCountPerDocumento.get(d.id) ?? 0;
              return (
                <div key={d.id} className="omnia-doc">
                  <span style={{ display: "flex", minWidth: 0, flexDirection: "column", gap: 2 }}>
                    <span style={{ display: "flex", minWidth: 0, alignItems: "center", gap: 10 }}>
                      <span className="nome">{d.nome_file}</span>
                      {n > 0 ? (
                        <span className="omnia-badge verde">Indicizzato ({n})</span>
                      ) : (
                        <span className="omnia-badge ambra">Non indicizzato</span>
                      )}
                    </span>
                    <span style={{ fontSize: 11.5, color: "var(--fioco)" }}>Caricato il {testoDataCaricamento(d.created_at)}</span>
                  </span>
                  <div className="omnia-doc-azioni">
                    <OpenInNewTabButton
                      action={downloadGaraDocumento}
                      hiddenFields={{ docId: d.id }}
                      label="Scarica"
                      className="omnia-btn omnia-btn-s omnia-btn-piccolo"
                    />
                    <DeleteButton
                      action={removeGaraDocumento}
                      hiddenFields={{ docId: d.id, garaId: gara.id }}
                      confirmMessage="Eliminare questo documento?"
                      label="Elimina"
                      className="omnia-btn omnia-btn-s omnia-btn-piccolo"
                    />
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="omnia-elenco-vuoto" style={{ marginTop: 16 }}>
            Nessun documento caricato.
          </p>
        )}

        {documentiNuovi.length > 0 && (
          <p className="omnia-riquadro-nota" style={{ marginTop: 12 }}>
            Dopo l&apos;ultima analisi hai caricato {documentiNuovi.length === 1 ? "1 documento" : `${documentiNuovi.length} documenti`}: premi «Rianalizza documenti» qui sotto per includer{documentiNuovi.length === 1 ? "lo" : "li"} nei dati
            estratti, comprese un&apos;eventuale proroga dei termini e la nuova scadenza.
          </p>
        )}

        <div style={{ marginTop: 20, paddingTop: 20, borderTop: "1px solid var(--bordo)" }}>
          {diritto.consentito ? (
            <UploadDocumentoForm garaId={gara.id} />
          ) : (
            <p className="omnia-riquadro-nota" style={{ margin: 0 }}>
              Il caricamento di nuovi documenti è disattivato per questa gara (vedi l&apos;avviso in alto).
            </p>
          )}
        </div>

        <LogoClienteForm garaId={gara.id} loghiCaricato={!!gara.logo_cliente_path} />
      </section>

      <ExtractionSection garaId={gara.id} estrazione={{ ...gara, scadenza_ora: contestoRevisione?.gara.scadenza_ora ?? null, scadenza_ora_manuale: Boolean(oraManualeRaw?.scadenza_ora_manuale) }} proroga={prorogaRaw ?? null} pianoAttuale={subscriptionAttiva?.plan ?? null} inProva={statoAccesso.stato === "prova"} ufficioGare={ufficioGare} />

      {/* Il servizio aggiuntivo giusto per questa gara, deciso dall'analisi dei documenti: il piano di lavoro per le gare di pulizia (anche per quelle non
          ancora classificate, come prima, e per chi ha già dei piani generati: non si toglie niente di ciò che c'è), «OMNIA FOOD MENU» (sta arrivando)
          per la ristorazione collettiva, nulla per gli altri settori. */}
      {gara.estrazione_stato === "completata" && proponeFoodMenu(settore) && <FoodMenuPanel />}
      {pianoLavoroDisponibile && (gara.estrazione_stato === "completata" || pianiLavoro.length > 0) && (proponePianoLavoro(settore) || pianiLavoro.length > 0) && <PianoLavoroPanel garaId={gara.id} piani={pianiLavoro} diritto={dirittoPianoLavoro} offerta={offertaPianoLavoro} pacchetto={pacchettoPianoLavoro} ritorno={interpretaRitornoPagamento(ritornoPianoLavoro)} privacyVersione={documentiLegaliPianoLavoro?.privacyPolicy.version ?? null} />}

      {copertinaPannello && <CopertinaPanel garaId={gara.id} {...copertinaPannello} />}

      <ChatSection garaId={gara.id} messaggi={messaggi} limitePagineTotale={gara.limite_pagine_totale} spenta={!diritto.consentito} />

      {contestoRevisione?.relazione && esitoRevisione && <RevisionePanel garaId={gara.id} esito={esitoRevisione} pagata={contestoRevisione.pagata} ufficioGare={ufficioGare} />}
    </div>
  );
}
