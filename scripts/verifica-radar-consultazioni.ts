// Verifica del tipo di opportunità «consultazione_preliminare» (Fase 2; decisione dell'utente del 26/11, opzione (a) del coordinamento:
// interruttore PER FONTE nel codice). Lato lettura pronto per tutte le pagine (etichetta, filtro «Consultazioni» distinto, scheda, email);
// produzione del tipo SOLO dalle fonti in FONTI_CON_CONSULTAZIONI (start, empulia, siaps), dopo la 0140 PROPOSTA (mai applicata). SATER e
// SardegnaCAT (in produzione) restano IDENTICHE: stessa regola delle opportunità, stesse uscite sugli stessi elementi. Dati [SINTETICI],
// nessuna rete, nessun database.
// Uso: npx tsx scripts/verifica-radar-consultazioni.ts → codice 0 se passa.
import fs from "node:fs";
import path from "node:path";
import { ETICHETTA_OPPORTUNITA, FONTI_CON_CONSULTAZIONI, PARTECIPAZIONE, consultazioniAccese, entraInOpportunita, opportunita, opportunitaAflink, opportunitaDaTipoAvviso, perArchivio } from "../src/lib/radar/opportunita-calcoli";
import { CATEGORIA_CONSULTAZIONI, CATEGORIA_DEL_TIPO, CATEGORIE_TIPO, CONSULTAZIONI_IN_CERCA, COME_SI_PARTECIPA_CONSULTAZIONE, ETICHETTA_TIPO, condizioneTipi, eCategoriaTipo, tipoDellaGara } from "../src/lib/radar/tipo-gara-calcoli";
import { leggiElementoAflink, type ElementoAflink } from "../src/lib/radar/fonti/aflink-calcoli";
import { leggiGaraStart, type EsclusioneStart } from "../src/lib/radar/fonti/start-calcoli";
import { FONTI_UNITE } from "../src/lib/radar/unione-calcoli";

let ok = 0;
const falliti: string[] = [];
function controlla(nome: string, condizione: boolean, dettaglio?: unknown): void {
  if (condizione) ok++;
  else falliti.push(`${nome}${dettaglio === undefined ? "" : ` → ${JSON.stringify(dettaglio).slice(0, 600)}`}`);
}
globalThis.fetch = (async () => {
  throw new Error("rete vietata nella verifica");
}) as typeof fetch;
const radice = path.join(__dirname, "..");
const leggi = (f: string) => fs.readFileSync(path.join(radice, f), "utf8");
const ADESSO = new Date("2026-11-26T10:00:00Z");

// ═════ A. il tipo nuovo ═════
const c = opportunita("consultazione_preliminare");
controlla("tipo nuovo: partecipazione LIBERA, etichetta «Consultazione preliminare di mercato», entra nell'archivio", PARTECIPAZIONE.consultazione_preliminare === "libera" && ETICHETTA_OPPORTUNITA.consultazione_preliminare === "Consultazione preliminare di mercato" && entraInOpportunita(c) && perArchivio(c)?.tipo === "consultazione_preliminare");
controlla("TED e PVL invariati: nessun tipo di avviso diventa una consultazione", ["cn-standard", "pin-cfc-standard", "qu-sy", "P1_10", "P2_16", "P7_1_3", "P7_3", "P7_2", "", "can-standard"].every((t) => opportunitaDaTipoAvviso(t)?.tipo !== "consultazione_preliminare"));

// ═════ B. interruttore PER FONTE (nel codice) ═════
controlla("fonti che possono produrre consultazioni: SOLO start, empulia, siaps (nel codice, non in una variabile d'ambiente)", JSON.stringify(FONTI_CON_CONSULTAZIONI) === JSON.stringify(["start", "empulia", "siaps"]) && ["start", "empulia", "siaps"].every(consultazioniAccese));
controlla("SATER, SardegnaCAT, Sintel, TuttoGare, PVL e TED: spente (nessun cambiamento in produzione)", FONTI_UNITE.filter((f) => !["start"].includes(f)).every((f) => !consultazioniAccese(f)) && !consultazioniAccese("sater") && !consultazioniAccese("sardegnacat"));
controlla("l'interruttore non dipende dall'ambiente: nessuna lettura di variabili", !/process\.env/.test(leggi("src/lib/radar/opportunita-calcoli.ts")));

// ═════ C. lato lettura: tipo mostrato, etichette, filtro distinto ═════
controlla("la colonna «consultazione_preliminare» si mostra col suo tipo e la sua etichetta (prima: tipo vuoto)", tipoDellaGara({ tipo_opportunita: "consultazione_preliminare", tipo_avviso: "Avviso" }) === "consultazione_preliminare" && ETICHETTA_TIPO.consultazione_preliminare === "Consultazione preliminare di mercato");
controlla("ogni tipo mostrato ha un'etichetta non vuota e una categoria", Object.entries(ETICHETTA_TIPO).every(([k, v]) => v.length > 3 && k in CATEGORIA_DEL_TIPO));
controlla("categoria «consultazioni» DISTINTA da bandi, candidature e iscrizioni, con la sua voce pronta", CATEGORIA_DEL_TIPO.consultazione_preliminare === "consultazioni" && CATEGORIA_CONSULTAZIONI.id === "consultazioni" && CATEGORIA_CONSULTAZIONI.breve === "Consultazioni");
controlla("voce «Consultazioni» in «Cerca» SPENTA (si accende con la decisione dell'utente, insieme alla pagina pubblica «Ricerca gare»): tre caselle, parametro non accettato", CONSULTAZIONI_IN_CERCA === false && CATEGORIE_TIPO.length === 3 && !CATEGORIE_TIPO.some((x) => x.id === "consultazioni") && !eCategoriaTipo("consultazioni"));
const cond = (k: Parameters<typeof condizioneTipi>[0][number]) => condizioneTipi([k]);
controlla("filtro nel database: «consultazioni» = solo la colonna; bandi, candidature e iscrizioni NON la comprendono", cond("consultazioni") === "tipo_opportunita.eq.consultazione_preliminare" && !cond("bandi").includes("consultazione") && !cond("candidature").includes("consultazione") && !cond("iscrizioni").includes("consultazione"));
controlla("candidature invariate (manifestazioni, indagini, preinformazioni)", cond("candidature").startsWith("tipo_opportunita.in.(manifestazione_interesse,indagine_mercato)"));
const scheda = leggi("src/app/site-omnia-ai/dashboard/omnia-ai/opportunita/gara/[id]/page.tsx");
controlla("scheda della gara: per una consultazione la riga «Che cos'è» (non è una gara né una candidatura)", /tipo === "consultazione_preliminare" && <Dato etichetta="Che cos'è" valore=\{COME_SI_PARTECIPA_CONSULTAZIONE\} \/>/.test(scheda) && /Non è una gara né una candidatura/.test(COME_SI_PARTECIPA_CONSULTAZIONE) && !/\d{1,2}:\d{2}/.test(COME_SI_PARTECIPA_CONSULTAZIONE));
controlla("riga della gara ed email: l'etichetta arriva da ETICHETTA_TIPO (nessun testo a parte)", /ETICHETTA_TIPO\[d\.tipo\]/.test(leggi("src/components/omnia-ai/opportunita/riga-gara.tsx")) && /ETICHETTA_TIPO\[mostrato\]/.test(leggi("src/lib/radar/notifiche/eventi-calcoli.ts")));

// ═════ C-bis. «Per te» ed email (decisione dell'utente del 26/11: come le candidature) ═════
const profilo = leggi("src/lib/radar/profilo-calcoli.ts");
const eventi = leggi("src/lib/radar/notifiche/eventi-calcoli.ts");
const filtroNuove = eventi.slice(eventi.indexOf("const candidate = x.nuove.filter("), eventi.indexOf("const perId = new Map(candidate"));
controlla("«Per te»: tutti i tipi (nessun filtro di tipo dal profilo), quindi anche le consultazioni, ognuna con la sua etichetta", /\/\/ «Per te» mostra tutti i tipi, ognuno con la sua etichetta \(C5\)\s*\n\s*tipi: \[\],/.test(profilo));
controlla("avvisi email delle nuove opportunità: nessun filtro di tipo (le consultazioni entrano come le candidature; email oggi spente)", filtroNuove.length > 100 && !/tipo_opportunita|tipoDellaGara|candidatur|consultazion/.test(filtroNuove));

// ═════ D. NON REGRESSIONE della famiglia AF (SATER, SardegnaCAT): la regola delle opportunità dà ESATTAMENTE i valori di prima ═════
const casi: [string, string, string, string | null][] = [
  ["Bando", "Aperta", "Servizio di pulizia", "bando"],
  ["Bando", "Negoziata", "Servizio di pulizia", "riservata"],
  ["Bando", "Affidamento Diretto", "Servizio di pulizia", "affidamento_diretto"],
  ["Avviso", "", "Avviso di manifestazione di interesse per il servizio di vigilanza", "manifestazione_interesse"],
  ["Avviso", "", "Indagine di mercato per il servizio di portierato", "indagine_mercato"],
  // il difetto noto (punto 2 del coordinamento): un «Avviso» di consultazione resta «manifestazione», NON si corregge ora su SATER in produzione
  ["Avviso", "", "Consultazione preliminare di mercato per il servizio di lavanolo", "manifestazione_interesse"],
  ["Consultazione Preliminare di Mercato", "", "Consultazione preliminare di mercato per il servizio di vigilanza", null],
  ["Bando", "", "Servizio di pulizia", null],
];
const diversi = casi.filter(([t, p, o, atteso]) => (opportunitaAflink(t, p, o)?.tipo ?? null) !== atteso).map(([t, p, o, atteso]) => ({ t, p, o, atteso, avuto: opportunitaAflink(t, p, o)?.tipo ?? null }));
controlla("SATER e SardegnaCAT: opportunitaAflink invariata sugli stessi casi (consultazioni comprese: «Avviso» → manifestazione, tipo «Consultazione…» → escluso)", diversi.length === 0, diversi);
const elemento = (tipo: string, oggetto: string): ElementoAflink => ({ IdMsg: "1031830", Oggetto: oggetto, DenominazioneEnte: "Comune di Provasintetica", DtScadenzaBandoTecnical: "2026-12-10T10:00:00", Tipo: tipo, TipoProcedura: tipo === "Bando" ? "Aperta" : "", statoFunzionale: "Pubblicato", dataUltimaModifica: "2026-11-20T09:00:00", CPV: "90910000-9 - Servizi di pulizia", a_base_asta: "100.000,00", Contratto: "Servizi", link: "https://sardegnacat.regione.sardegna.it/Application/CustomDoc/DettaglioProcedura.asp?ID=1031830" });
const sardegna = leggiElementoAflink("sardegnacat", elemento("Consultazione Preliminare di Mercato", "Consultazione preliminare di mercato per i servizi di pulizia"), ADESSO);
const sardegnaAvviso = leggiElementoAflink("sardegnacat", elemento("Avviso", "Consultazione preliminare di mercato per i servizi di pulizia"), ADESSO);
controlla("SardegnaCAT (elementi [SINTETICI]): tipo «Consultazione…» escluso come prima; «Avviso» di consultazione entra come manifestazione come prima; mai il tipo nuovo", sardegna.tipo === "esclusione" && sardegna.motivo === "tipo_sconosciuto" && sardegnaAvviso.tipo === "bando" && sardegnaAvviso.opportunita.tipo === "manifestazione_interesse", { sardegna: sardegna.tipo === "esclusione" ? sardegna.motivo : sardegna.opportunita, avviso: sardegnaAvviso.tipo === "bando" ? sardegnaAvviso.opportunita : sardegnaAvviso.motivo });
controlla("il connettore AF non usa ancora l'interruttore (EmPULIA e SIAPS non sono ancora costruite): nessun cambio al percorso di SATER e SardegnaCAT", !/consultazioniAccese|consultazione_preliminare/.test(leggi("src/lib/radar/fonti/aflink-calcoli.ts")) && !/consultazioniAccese|consultazione_preliminare/.test(leggi("src/lib/radar/fonti/intercenter-calcoli.ts")));

// ═════ E. START: per ora le consultazioni restano escluse (il suo collaudo non dipende dalla 0140) ═════
const rigaStart = { numero: "100005-2026", collegamento: null, ente: "Comune di Provasintetica", oggetto: "Consultazione preliminare di mercato per il servizio di portierato", procedura: "Consultazione preliminare di mercato", tipo: "Servizi", cig: "n/a", importo: null, stato: "In corso", pubblicazione: "20/11/2026", impronta: "x" };
const s = leggiGaraStart(rigaStart, ADESSO) as EsclusioneStart;
controlla("START: consultazione ancora esclusa e contata a parte (passa al tipo nuovo nella fase EmPULIA/SIAPS, dopo la 0140)", s.tipo === "esclusione" && s.motivo === "consultazione_preliminare");

// ═════ F. 0140 PROPOSTA (mai applicata) ═════
const sql = leggi("supabase/migrations/0140_radar_tipo_consultazione_preliminare.sql");
const istruzioni = sql.split("\n").filter((r) => !/^\s*--/.test(r)).join("\n");
const vecchi = leggi("supabase/migrations/0120_radar_multifonte.sql").match(/tipo_opportunita in \(([^)]+)\)/)?.[1] ?? "";
// richiesta del coordinamento (26/11): i valori del vincolo ricreato vengono dalla definizione CORRENTE (mai riscritti a memoria); il
// controllo finale verifica che ci siano tutti quelli della 0120 più quello nuovo
const valori0120 = [...vecchi.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
controlla("0140: valori ricavati dalla definizione CORRENTE del vincolo (regexp_matches su pg_get_constraintdef), più «consultazione_preliminare»; nessun elenco scritto a memoria nel vincolo ricreato", /regexp_matches\(vincolo\.definizione, '''\(\[a-z0-9_\]\+\)''', 'g'\)/.test(istruzioni) && /valori := valori \|\| 'consultazione_preliminare'::text;/.test(istruzioni) && /check \(tipo_opportunita is null or tipo_opportunita in \(%s\)\)', elenco\)/.test(istruzioni) && !/tipo_opportunita in \('/.test(istruzioni));
controlla("0140: controllo finale = un solo vincolo, con TUTTI i valori della 0120 e quello nuovo; idempotente; begin/commit", valori0120.length === 4 && istruzioni.includes(`array[${[...valori0120, "consultazione_preliminare"].map((v) => `'${v}'`).join(", ")}]`) && /totale <> 1/.test(istruzioni) && /if exists \([\s\S]*consultazione_preliminare%'[\s\S]*\) then\s*return;/.test(istruzioni) && /raise exception '0140/.test(istruzioni) && /^begin;$/m.test(istruzioni) && /^commit;$/m.test(istruzioni), valori0120);
controlla("0140: additiva, nessuna istruzione sui dati né sulla partecipazione né sulle fonti", !/\bdelete\b|\btruncate\b|\bupdate\b|\binsert\b|drop table|drop column|partecipazione in|radar_fonti_stato|radar_esecuzioni/i.test(istruzioni));

console.log(`Verifica del tipo «consultazione preliminare» (Fase 2): ${ok} ok, ${falliti.length} falliti`);
for (const f of falliti) console.log(`  FALLITO: ${f}`);
process.exit(falliti.length ? 1 : 0);
