// Autotest della sezione DEMO della console (richiesta dell'utente, 04/11/2026): richieste ricevute, prenotazioni confermate, casi da
// verificare, stato delle importazioni Google Ads e GA4, errori. Si controlla che:
//   - i riepiloghi (richieste, Ads, GA4) siano calcolati giusti e le richieste «sostituite» non gonfino il tasso di conferma;
//   - lo stato delle integrazioni non mostri MAI un valore segreto (solo «sì/no» e modalità);
//   - la lettura funzioni sul database finto, anche con tabelle non ancora create o guasti, e non scriva niente;
//   - la pagina sia solo per l'admin, senza azioni (sola lettura) e senza nessun accesso del browser ai dati.
import fs from "fs";
import path from "path";
import { randomUUID } from "node:crypto";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import DemoVista from "../src/app/site-console/_componenti/demo-vista";
import { calcolaPeriodo } from "../src/lib/console/periodo";
import { FintoDatabase, type Riga } from "./demo-finto-supabase";
import {
  ETICHETTA_MOTIVO_CASO,
  ETICHETTA_STATO_ADS,
  MINUTI_SINCRONIZZAZIONE_FERMA,
  STATI_ADS,
  TONO_STATO_ADS,
  avvisiIntegrazioni,
  etichettaMotivoCaso,
  riepilogoAds,
  riepilogoGa4,
  riepilogoRichieste,
  sintesiSincronizzazione,
  statoIntegrazioni,
  type RigaRichiestaDemo,
} from "../src/lib/console/demo-calcoli";
import { leggiDemo } from "../src/lib/console/demo";

const fallimenti: string[] = [];
function atteso(nome: string, ok: boolean, dettaglio = "") {
  console.log(`${ok ? "ok    " : "FALLITO"} ${nome}${ok ? "" : ` — ${dettaglio}`}`);
  if (!ok) fallimenti.push(nome);
}
const radice = path.join(__dirname, "..");
const leggi = (relativo: string) => fs.readFileSync(path.join(radice, relativo), "utf-8").replace(/\r\n/g, "\n");

const riga = (extra: Partial<RigaRichiestaDemo> = {}): RigaRichiestaDemo => ({
  id: randomUUID(), creataIl: "2026-11-10T09:00:00.000Z", nome: "Mario Rossi", azienda: "Rossi Srl", email: "mario@esempio.it", settore: "Multiservizi", stato: "pending",
  primaPrenotazioneIl: null, conClic: false, utmSource: null, utmCampaign: null, haClientId: false, ga4InviatoIl: null, ga4Tentativi: 0, statoAds: "not_ready",
  adsTentativi: 0, adsErrore: null, adsInviatoIl: null, adsProssimoTentativo: null, ...extra,
});

async function main() {
  console.log("--- Riepiloghi ---");
  {
    const righe = [
      riga({ stato: "confirmed", email: "a@x.it", conClic: true }),
      riga({ stato: "confirmed", email: "b@x.it" }),
      riga({ stato: "pending", email: "c@x.it" }),
      riga({ stato: "cancelled", email: "d@x.it" }),
      riga({ stato: "superseded", email: "c@x.it" }),
      riga({ stato: "pending", email: "C@x.it " }),
    ];
    const r = riepilogoRichieste(righe);
    atteso("richieste: ricevute, persone distinte (email normalizzata), in attesa, confermate, annullate, sostituite, da annunci", r.ricevute === 6 && r.persone === 4 && r.inAttesa === 2 && r.confermate === 2 && r.annullate === 1 && r.sostituite === 1 && r.conClic === 1, JSON.stringify(r));
    atteso("tasso di conferma = confermate / (ricevute − sostituite): le sostituite non contano (la persona ne ha fatta una più recente)", r.tassoConferma !== null && Math.abs(r.tassoConferma - 2 / 5) < 1e-9, String(r.tassoConferma));
    atteso("nessuna richiesta (o solo sostituite): tasso assente, niente divisioni per zero", riepilogoRichieste([]).tassoConferma === null && riepilogoRichieste([riga({ stato: "superseded" })]).tassoConferma === null && riepilogoRichieste([]).ricevute === 0);

    const ads = riepilogoAds([{ statoAds: "ready" }, { statoAds: "ready" }, { statoAds: "validated" }, { statoAds: "sent" }, { statoAds: "accepted" }, { statoAds: "accepted" }, { statoAds: "failed" }, { statoAds: "skipped_no_consent" }, { statoAds: "skipped_no_identifier" }, { statoAds: "skipped_cancelled" }, { statoAds: "not_ready" }]);
    atteso("Google Ads: conteggi per stato e raggruppamenti (pronte, verificate, inviate, accettate, fallite, saltate, da controllare)", ads.pronte === 2 && ads.verificate === 1 && ads.inviate === 1 && ads.accettate === 2 && ads.fallite === 1 && ads.saltate === 3 && ads.daControllare === 1 && ads.perStato.not_ready === 1 && Object.values(ads.perStato).reduce((a, b) => a + b, 0) === 11);
    atteso("ogni stato Ads ha un'etichetta in italiano e un tono; «failed» è l'unico in errore, «accepted» l'unico verde", STATI_ADS.every((s) => ETICHETTA_STATO_ADS[s].length > 3 && TONO_STATO_ADS[s]) && STATI_ADS.filter((s) => TONO_STATO_ADS[s] === "errore").join() === "failed" && STATI_ADS.filter((s) => TONO_STATO_ADS[s] === "ok").join() === "accepted");
    atteso("uno stato sconosciuto non gonfia i conteggi né rompe il riepilogo", Object.values(riepilogoAds([{ statoAds: "boh" as never }]).perStato).reduce((a, b) => a + b, 0) === 0);

    const g = riepilogoGa4([
      { stato: "confirmed", ga4InviatoIl: "2026-11-10T10:00:00.000Z", ga4Tentativi: 0, haClientId: true },
      { stato: "confirmed", ga4InviatoIl: null, ga4Tentativi: 1, haClientId: true },
      { stato: "confirmed", ga4InviatoIl: null, ga4Tentativi: 5, haClientId: true },
      { stato: "confirmed", ga4InviatoIl: null, ga4Tentativi: 0, haClientId: false },
      { stato: "pending", ga4InviatoIl: null, ga4Tentativi: 0, haClientId: true },
      { stato: "cancelled", ga4InviatoIl: null, ga4Tentativi: 0, haClientId: true },
    ]);
    atteso("GA4: solo le richieste CONFERMATE contano; inviati, in attesa (c'è il client_id e restano tentativi), non inviabili (senza client_id o tentativi esauriti)", g.inviati === 1 && g.inAttesa === 1 && g.nonInviabili === 2, JSON.stringify(g));
  }

  console.log("\n--- Casi da verificare ---");
  {
    const motivi = ["nessun_lead", "piu_lead", "prenotazione_duplicata", "fuori_finestra", "senza_partecipante", "email_non_valida"];
    atteso("ogni motivo di caso del calendario ha un'etichetta in italiano; uno sconosciuto si mostra com'è", motivi.every((m) => !!ETICHETTA_MOTIVO_CASO[m] && etichettaMotivoCaso(m) === ETICHETTA_MOTIVO_CASO[m]) && etichettaMotivoCaso("altro_motivo") === "altro_motivo");
    const mig = leggi("supabase/migrations/0098_demo_leads.sql");
    const dalDb = /motivo in \(([^)]*)\)/.exec(mig.replace(/--.*$/gm, ""))?.[1].match(/'([a-z_]+)'/g)?.map((x) => x.replace(/'/g, "")) ?? [];
    atteso("i motivi della migrazione e quelli della console coincidono (nessun caso resterebbe senza spiegazione)", dalDb.length === motivi.length && dalDb.every((m) => motivi.includes(m)), dalDb.join(","));
  }

  console.log("\n--- Stato delle integrazioni: mai un segreto ---");
  {
    const tuttoSpento = statoIntegrazioni({});
    atteso("senza nessuna variabile: tutto spento, nessun segreto, Ads in «solo verifica»", !tuttoSpento.richieste.attive && !tuttoSpento.richieste.segretoFirma && !tuttoSpento.calendario.acceso && !tuttoSpento.ga4.acceso && !tuttoSpento.ads.acceso && tuttoSpento.ads.modalita === "solo_verifica");
    const SEGRETI = ["segreto-cron-xyz", "client-segreto-xyz", "rt-xyz", "ads-rt-xyz", "ga-api-xyz", "firma-xyz", "cal-id@group.calendar.google.com"];
    const env = {
      DEMO_LEADS_ATTIVO: "1", CRON_SECRET: SEGRETI[0], DEMO_CONSENT_SIGNING_SECRET: SEGRETI[5],
      DEMO_CALENDAR_SYNC_ENABLED: "1", GOOGLE_OAUTH_CLIENT_ID: "client-id", GOOGLE_OAUTH_CLIENT_SECRET: SEGRETI[1], GOOGLE_CALENDAR_REFRESH_TOKEN: SEGRETI[2], GOOGLE_CALENDAR_ID: SEGRETI[6],
      DEMO_GA4_MP_ENABLED: "1", GA4_API_SECRET: SEGRETI[4],
      DEMO_ADS_IMPORT_ENABLED: "1", GOOGLE_ADS_CUSTOMER_ID: "1234567890", GOOGLE_ADS_DEMO_CONVERSION_ACTION_ID: "987654321", GOOGLE_ADS_REFRESH_TOKEN: SEGRETI[3],
    };
    const s = statoIntegrazioni(env);
    atteso("tutto configurato: richieste attive con segreto, calendario con credenziali, GA4 con segreto API, Ads con configurazione e credenziali (ancora in «solo verifica»)", s.richieste.attive && s.richieste.segretoFirma && s.calendario.acceso && s.calendario.credenziali && s.calendario.idCalendario && s.ga4.acceso && s.ga4.segretoApi && s.ads.acceso && s.ads.configurazione && s.ads.credenziali && s.ads.modalita === "solo_verifica", JSON.stringify(s));
    atteso("lo stato è fatto solo di sì/no e modalità: nessun valore segreto compare nel risultato né negli avvisi", !SEGRETI.some((x) => JSON.stringify(s).includes(x) || JSON.stringify(avvisiIntegrazioni(s)).includes(x)) && Object.values(s).every((gruppo) => Object.values(gruppo).every((v) => typeof v === "boolean" || v === "solo_verifica" || v === "reale")));
    atteso("modalità reale solo con DEMO_ADS_VALIDATE_ONLY=0", statoIntegrazioni({ ...env, DEMO_ADS_VALIDATE_ONLY: "0" }).ads.modalita === "reale" && statoIntegrazioni({ ...env, DEMO_ADS_VALIDATE_ONLY: "1" }).ads.modalita === "solo_verifica" && statoIntegrazioni({ ...env, DEMO_ADS_VALIDATE_ONLY: "" }).ads.modalita === "solo_verifica");
    const av = (e: Record<string, string | undefined>) => avvisiIntegrazioni(statoIntegrazioni(e)).map((a) => a.testo);
    atteso("avvisi: registrazione spenta; accesa senza segreto; calendario/GA4/Ads accesi ma incompleti; Ads in sola verifica e in modalità reale", av({}).some((t) => /Registrazione delle richieste SPENTA/.test(t)) && avvisiIntegrazioni(statoIntegrazioni({ DEMO_LEADS_ATTIVO: "1" })).some((a) => a.tono === "errore" && /segreto/.test(a.testo)) && av({ DEMO_CALENDAR_SYNC_ENABLED: "1" }).some((t) => /Sincronizzazione del calendario accesa/.test(t)) && av({ DEMO_GA4_MP_ENABLED: "1" }).some((t) => /GA4 acceso ma manca/.test(t)) && av({ DEMO_ADS_IMPORT_ENABLED: "1" }).some((t) => /Importazione Google Ads accesa/.test(t)) && av(env).some((t) => /SOLA VERIFICA/.test(t)) && av({ ...env, DEMO_ADS_VALIDATE_ONLY: "0" }).some((t) => /modalità REALE/.test(t)));
    atteso("con tutto a posto e tutto spento tranne la registrazione, c'è solo l'avviso utile (niente falsi allarmi)", avvisiIntegrazioni(statoIntegrazioni({ DEMO_LEADS_ATTIVO: "1", CRON_SECRET: "x" })).length === 0);

    const adesso = new Date("2026-11-10T10:00:00.000Z");
    const sync = (minutiFa: number | null, errore: string | null = null) => ({ ultimaEsecuzioneIl: minutiFa === null ? null : new Date(adesso.getTime() - minutiFa * 60_000).toISOString(), ultimoSuccessoIl: null, ultimoErrore: errore, bloccoFinoA: null });
    atteso("sincronizzazione: spenta, mai eseguita, in funzione, con errore, ferma oltre mezz'ora", sintesiSincronizzazione(false, null, adesso).testo === "spenta" && sintesiSincronizzazione(true, null, adesso).tono === "avviso" && sintesiSincronizzazione(true, sync(null), adesso).testo === "accesa ma non ancora eseguita" && sintesiSincronizzazione(true, sync(5), adesso).tono === "ok" && sintesiSincronizzazione(true, sync(5, "errori_su_eventi"), adesso).tono === "errore" && sintesiSincronizzazione(true, sync(MINUTI_SINCRONIZZAZIONE_FERMA + 1), adesso).tono === "errore" && sintesiSincronizzazione(true, sync(MINUTI_SINCRONIZZAZIONE_FERMA), adesso).tono === "ok");
  }

  console.log("\n--- Lettura (database finto) ---");
  {
    const lead = (id: string, extra: Riga = {}): Riga => ({
      id, contatto_id: "c", idempotency_key: `chiave-${id}-xxxxxxxxxxxx`, created_at: "2026-11-05T09:00:00.000Z", updated_at: "2026-11-05T09:00:00.000Z", full_name: `Nome ${id}`, company: `Azienda ${id}`, email: `${id}@esempio.it`, email_norm: `${id}@esempio.it`,
      phone: "+393331234567", sector: "Multiservizi", booking_status: "pending", prima_prenotazione_il: null, gclid: null, gbraid: null, wbraid: null, utm_source: null, utm_campaign: null, ga_client_id: null,
      ga4_sent_at: null, ga4_attempts: 0, ads_import_status: "not_ready", ads_attempts: 0, ads_next_attempt_at: null, ads_sent_at: null, ads_last_error: null, ...extra,
    });
    const periodo = { daIso: "2026-11-01T00:00:00.000Z", aIso: "2026-12-01T00:00:00.000Z" };
    const db = new FintoDatabase({
      demo_contatti: [{ id: "c", email_norm: "x", email: "x", full_name: "x", company: "x", sector: "x", ultima_richiesta_il: "2026-11-05T09:00:00.000Z" }],
      demo_leads: [
        lead("a", { booking_status: "confirmed", prima_prenotazione_il: "2026-11-05T10:00:00.000Z", gclid: "GCLID_secret_12345", ga_client_id: "123.456", ads_import_status: "ready", created_at: "2026-11-05T09:00:00.000Z" }),
        lead("b", { booking_status: "cancelled", created_at: "2026-11-06T09:00:00.000Z" }),
        lead("c1", { created_at: "2026-11-07T09:00:00.000Z" }),
        lead("vecchia", { created_at: "2026-09-01T09:00:00.000Z", booking_status: "confirmed", prima_prenotazione_il: "2026-09-02T10:00:00.000Z", ads_import_status: "failed", ads_last_error: "HTTP_500 INTERNAL", ads_attempts: 6, updated_at: "2026-09-03T00:00:00.000Z" }),
      ],
      demo_prenotazioni: [
        { id: "p1", lead_id: "a", calendar_id: "cal", calendar_event_id: "e1", stato: "confirmed", booked_at: "2026-11-05T10:00:00.000Z", starts_at: "2026-11-08T09:00:00.000Z", starts_at_originale: "2026-11-07T09:00:00.000Z", riprogrammata_il: "2026-11-06T09:00:00.000Z", cancelled_at: null },
        { id: "p0", lead_id: "vecchia", calendar_id: "cal", calendar_event_id: "e0", stato: "confirmed", booked_at: "2026-09-02T10:00:00.000Z", starts_at: null, starts_at_originale: null, riprogrammata_il: null, cancelled_at: null },
      ],
      demo_calendar_casi: [
        { id: "k1", created_at: "2026-11-05T12:00:00.000Z", calendar_id: "cal", calendar_event_id: "e9", motivo: "nessun_lead", attendee_email_norm: "ignoto@x.it", event_created_at: null, event_starts_at: null, risolto: false, note: "n" },
        { id: "k2", created_at: "2026-11-05T13:00:00.000Z", calendar_id: "cal", calendar_event_id: "e8", motivo: "piu_lead", attendee_email_norm: null, event_created_at: null, event_starts_at: null, risolto: true, note: null },
      ],
      demo_sync_stato: [{ id: 1, sync_token: "SEGRETO-TOKEN", last_run_at: "2026-11-10T09:55:00.000Z", last_success_at: "2026-11-10T09:55:00.000Z", last_error: null, lock_until: null }],
    });
    const operazioniPrima = db.operazioni.length;
    const r = await leggiDemo(periodo, db.comeClient(), { DEMO_LEADS_ATTIVO: "1", CRON_SECRET: "x" });
    atteso("lettura ok con le richieste del periodo (la richiesta di settembre non c'è), in ordine dalla più recente", r.stato === "ok" && r.dati.richieste.length === 3 && r.dati.richieste.map((x) => x.id).join() === "c1,b,a", r.stato === "ok" ? r.dati.richieste.map((x) => x.id).join() : r.stato);
    if (r.stato === "ok") {
      const d = r.dati;
      atteso("riepilogo del periodo: 3 richieste, 1 confermata, 1 annullata, 1 in attesa; la richiesta con clic è contata come «da annuncio» senza mostrarne il valore", d.riepilogo.ricevute === 3 && d.riepilogo.confermate === 1 && d.riepilogo.annullate === 1 && d.riepilogo.inAttesa === 1 && d.riepilogo.conClic === 1 && !JSON.stringify(d).includes("GCLID_secret_12345"));
      atteso("prenotazioni del periodo con azienda, email e spostamento (la prenotazione di settembre non c'è)", d.prenotazioni.length === 1 && d.prenotazioni[0].azienda === "Azienda a" && d.prenotazioni[0].email === "a@esempio.it" && d.prenotazioni[0].inizioOriginale === "2026-11-07T09:00:00.000Z" && d.prenotazioni[0].riprogrammataIl !== null);
      atteso("casi da verificare: solo quelli aperti (di qualunque periodo)", d.casi.length === 1 && d.casi[0].id === "k1" && d.casi[0].email === "ignoto@x.it");
      atteso("stato di Google Ads e GA4 su TUTTE le richieste confermate (anche fuori periodo): una pronta e una in errore", d.confermateTotali === 2 && d.ads.pronte === 1 && d.ads.fallite === 1 && d.ads.daControllare === 1 && d.ga4.inAttesa === 1);
      atteso("errori di importazione: la richiesta fuori periodo con l'errore di Google compare, col codice e i tentativi", d.erroriAds.length === 1 && d.erroriAds[0].adsErrore === "HTTP_500 INTERNAL" && d.erroriAds[0].adsTentativi === 6);
      atteso("stato della sincronizzazione letto, e il «sync token» (segreto interno) NON esce", d.sync?.ultimoSuccessoIl === "2026-11-10T09:55:00.000Z" && !JSON.stringify(d).includes("SEGRETO-TOKEN"));
      atteso("le integrazioni arrivano come sì/no (qui: registrazione attiva con segreto)", d.integrazioni.richieste.attive && d.integrazioni.richieste.segretoFirma && !d.integrazioni.calendario.acceso);
    }
    atteso("la lettura NON scrive nulla (solo select)", db.operazioni.slice(operazioniPrima).every((o) => o.tipo === "select"));

    const dbVuoto = new FintoDatabase();
    const rv = await leggiDemo(periodo, dbVuoto.comeClient(), {});
    atteso("database vuoto: tutto a zero, nessun errore", rv.stato === "ok" && rv.dati.richieste.length === 0 && rv.dati.riepilogo.tassoConferma === null && rv.dati.casi.length === 0 && rv.dati.ads.daControllare === 0);
    const dbMancante = new FintoDatabase();
    dbMancante.errori.demo_leads = { code: "42P01", message: "x" };
    atteso("migrazione non eseguita: «tabella_assente» (la pagina lo spiega), non un errore", (await leggiDemo(periodo, dbMancante.comeClient(), {})).stato === "tabella_assente");
    const dbPrenMancante = new FintoDatabase();
    dbPrenMancante.errori.demo_prenotazioni = { code: "PGRST205", message: "x" };
    atteso("anche se manca solo un'altra tabella (es. le prenotazioni) la pagina dice «tabella_assente», non mostra dati a metà", (await leggiDemo(periodo, dbPrenMancante.comeClient(), {})).stato === "tabella_assente");
    const dbGuasto = new FintoDatabase();
    dbGuasto.errori.demo_calendar_casi = { code: "XX000", message: "Mario Rossi boom" };
    const registrati: string[] = [];
    const originale = console.error;
    console.error = (...a: unknown[]) => registrati.push(a.map(String).join(" "));
    const rg = await leggiDemo(periodo, dbGuasto.comeClient(), {});
    console.error = originale;
    atteso("guasto vero: «errore» con un messaggio generico, e nel log solo il codice (mai il messaggio del database)", rg.stato === "errore" && /non riuscita/.test(rg.messaggio) && registrati.some((l) => /XX000/.test(l)) && !registrati.some((l) => /Mario|boom/.test(l)), registrati.join("|"));
    const dbMolte = new FintoDatabase({ demo_leads: Array.from({ length: 503 }, (_, i) => lead(`m${String(i).padStart(3, "0")}`, { created_at: `2026-11-05T09:${String(Math.floor(i / 60)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}.000Z` })) });
    const rm = await leggiDemo(periodo, dbMolte.comeClient(), {});
    atteso("oltre 500 richieste nel periodo: se ne mostrano 500 e la pagina avvisa che l'elenco è troncato", rm.stato === "ok" && rm.dati.richieste.length === 500 && rm.dati.troncato === true);

    // la vista si disegna davvero (un errore di rendering qui passerebbe inosservato fino alla produzione)
    const periodoVista = calcolaPeriodo({}, new Date("2026-11-10T10:00:00.000Z"));
    const adessoVista = Date.parse("2026-11-10T10:00:00.000Z");
    const disegna = (risultato: Parameters<typeof DemoVista>[0]["risultato"]) => renderToStaticMarkup(createElement(DemoVista, { periodo: periodoVista, risultato, adessoMs: adessoVista }));
    const htmlDati = disegna(r);
    atteso("la vista si disegna con i dati veri della lettura: tessere, casi, prenotazioni, richieste e il pulsante della verifica in sola validazione; nessun valore segreto", htmlDati.length > 3000 && /Richieste ricevute/.test(htmlDati) && /Casi da verificare \(1\)/.test(htmlDati) && /Prenotazioni confermate sul calendario \(1\)/.test(htmlDati) && /Verifica Google Ads \(solo validazione\)/.test(htmlDati) && !/GCLID_secret_12345|SEGRETO-TOKEN/.test(htmlDati));
    atteso("la vista si disegna anche con le tabelle assenti (messaggio sulla migrazione 0098) e con un errore di lettura", /migrazione 0098/.test(disegna({ stato: "tabella_assente" })) && /Lettura non riuscita/.test(disegna({ stato: "errore", messaggio: "Lettura non riuscita." })));
  }

  console.log("\n--- Pagina: solo admin, sola lettura ---");
  {
    const pagina = leggi("src/app/site-console/(app)/demo/page.tsx");
    atteso("la pagina controlla l'admin come PRIMA operazione asincrona", pagina.indexOf("await richiediAdminPagina()") > 0 && pagina.indexOf("await richiediAdminPagina()") < pagina.indexOf("await searchParams") && pagina.indexOf("await richiediAdminPagina()") < pagina.indexOf("await leggiDemo("));
    const vista = leggi("src/app/site-console/_componenti/demo-vista.tsx");
    const lettura = leggi("src/lib/console/demo.ts");
    atteso("SOLA LETTURA sui dati: la vista non ha azioni del server né moduli (il solo pulsante è un componente a parte, vedi la verifica della Data Manager), la lettura non scrive nessuna riga", !/"use server"|"use client"/.test(vista) && !/<form|<button|ModuloAzione|PulsanteAzione/.test(vista) && !/\.(insert|update|upsert|delete)\(/.test(lettura));
    const fileAzioni = fs.readdirSync(path.join(radice, "src/app/site-console/azioni")).map((f) => [f, leggi(`src/app/site-console/azioni/${f}`)] as const);
    atteso("nessuna azione della console tocca le tabelle DEMO (nessuna lettura, nessuna scrittura): l'unica azione sulla DEMO è la verifica della Data Manager in sola validazione, che non usa il database", !fileAzioni.some(([, t]) => /from\("demo_|demo_leads|demo_contatti|demo_prenotazioni|demo_consensi|demo_calendar_casi|demo_sync_stato/.test(t)) && fileAzioni.some(([f]) => f === "demo-ads.ts") && !/supabase|createAdminClient/.test(fileAzioni.find(([f]) => f === "demo-ads.ts")?.[1] ?? "supabase"));
    atteso("la vista non nomina né mostra identificativi di clic o il token di sincronizzazione (gclid, gbraid, wbraid, sync_token)", !/gclid|gbraid|wbraid|sync_token/.test(vista));
    atteso("la lettura non seleziona mai il sync_token né le chiavi (solo stato e date della sincronizzazione)", !/sync_token/.test(lettura.replace(/\/\/.*$/gm, "")) && /last_run_at, last_success_at, last_error, lock_until/.test(lettura));
    atteso("la voce «DEMO e Google Ads» è nella barra laterale e la pagina esiste", /href: "\/demo", etichetta: "DEMO e Google Ads", pronto: true/.test(leggi("src/app/site-console/_componenti/navigazione.ts")) && fs.existsSync(path.join(radice, "src/app/site-console/(app)/demo/page.tsx")));
    atteso("nessun riferimento alla console dai due siti pubblici (il modulo e il sito non importano nulla della console)", ![leggi("src/components/omnia-ai/demo-form.tsx"), leggi("src/app/actions/omnia-ai-demo.ts"), leggi("src/app/site-omnia-ai/demo/page.tsx")].some((t) => /lib\/console|site-console|console\.omniaitalia/.test(t)));
    atteso("il test è nella catena verifica:livello1", /tsx scripts\/verifica-console-demo\.ts/.test(leggi("package.json")));
  }

  if (fallimenti.length > 0) {
    console.error(`\n${fallimenti.length} controllo/i fallito/i:\n- ${fallimenti.join("\n- ")}`);
    process.exit(1);
  }
  console.log("\nVerifica della sezione DEMO della console: tutti i casi ok.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
