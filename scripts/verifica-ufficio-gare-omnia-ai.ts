// Autotest dell'Ufficio Gare di OMNIA AI (un utente secondario per azienda, solo sulle gare):
//   - quali pagine e quali voci di menu spettano al titolare e all'Ufficio Gare;
//   - la validazione dell'invito (email, consenso del titolare);
//   - chi è l'utente loggato: titolare, Ufficio Gare, sospeso. Un errore di lettura NON diventa mai «titolare»;
//   - il giorno di Roma e la chiave dell'avviso (al massimo uno al giorno);
//   - i testi: nessuna cifra, nessun HTML iniettabile, i link giusti;
//   - la migrazione 0092: le regole nuove nascono prima delle vecchie, le tabelle amministrative non si toccano.
// Gratuito, nessun database né rete: gira nel livello 1, quindi in prebuild.
import fs from "fs";
import path from "path";
import {
  ETICHETTA_STATO_UFFICIO_GARE,
  SECONDI_TRA_DUE_INVII,
  MESSAGGIO_UFFICIO_GARE_ABBONAMENTO_NON_ATTIVO,
  MESSAGGIO_UFFICIO_GARE_GARE_FINITE,
  RADICE_AREA,
  VOCI_MENU_TITOLARE,
  VOCI_MENU_UFFICIO_GARE,
  chiaveAvviso,
  eAvvisoGiaInviato,
  giornoRoma,
  messaggioPerUfficioGare,
  normalizzaEmail,
  percorsoConsentito,
  rinvioLinkPermesso,
  statoUfficioGare,
  validaInvitoUfficioGare,
  vociMenuPer,
} from "../src/lib/omnia-ai-account-calcoli";
import { leggiUfficioGare, mandaLinkPasswordUfficioGare } from "../src/lib/omnia-ai-ufficio-gare";
import { ErroreContestoAccount, eUfficioGare, risolviContestoAccount } from "../src/lib/omnia-ai-account";
import {
  URL_ABBONAMENTO,
  emailAvvisoGareFinite,
  emailAvvisoRevisioneRichiesta,
  emailInvitoUfficioGare,
  urlRevisioneGara,
} from "../src/lib/omnia-ai-email-ufficio-gare-calcoli";

const fallimenti: string[] = [];
function atteso(nome: string, ok: boolean, dettaglio = "") {
  console.log(`${ok ? "ok    " : "FALLITO"} ${nome}${ok ? "" : ` — ${dettaglio}`}`);
  if (!ok) fallimenti.push(nome);
}
function uguale<T>(nome: string, ottenuto: T, previsto: T) {
  atteso(nome, JSON.stringify(ottenuto) === JSON.stringify(previsto), `ottenuto ${JSON.stringify(ottenuto)}, previsto ${JSON.stringify(previsto)}`);
}
const leggi = (relativo: string) => fs.readFileSync(path.join(__dirname, "..", relativo), "utf-8").replace(/\r\n/g, "\n");

type RispostaMembro = { data: { titolare_id: string; ruolo: string; attivo: boolean } | null; error: { code?: string; message: string } | null };
function fintoClient(risposta: RispostaMembro | "lancia") {
  const chiamate: string[] = [];
  const client = {
    from: (tabella: string) => ({
      select: (colonne: string) => ({
        eq: (colonna: string, valore: string) => ({
          maybeSingle: async () => {
            chiamate.push(`${tabella}|${colonne}|${colonna}=${valore}`);
            if (risposta === "lancia") throw new Error("rete caduta");
            return risposta;
          },
        }),
      }),
    }),
  };
  return { chiamate, client: client as unknown as Parameters<typeof risolviContestoAccount>[1] };
}

async function main() {
  console.log("--- Pagine consentite ---");
  const AMMINISTRATIVE = ["abbonamento", "pagamenti", "pagamenti/fattura/ordine/123", "documenti-contrattuali", "documenti-aziendali", "profilo-azienda", "impostazioni", "ufficio-gare"];
  uguale(
    "il titolare vede tutto",
    [RADICE_AREA, `${RADICE_AREA}/gare`, ...AMMINISTRATIVE.map((s) => `${RADICE_AREA}/${s}`)].map((p) => percorsoConsentito("titolare", p)),
    [true, true, ...AMMINISTRATIVE.map(() => true)],
  );
  uguale(
    "l'Ufficio Gare vede dashboard, gare (anche la singola) e supporto",
    [RADICE_AREA, `${RADICE_AREA}/`, `${RADICE_AREA}/gare`, `${RADICE_AREA}/gare/abc`, `${RADICE_AREA}/assistenza`, `${RADICE_AREA}?x=1`].map((p) => percorsoConsentito("ufficio_gare", p)),
    [true, true, true, true, true, true],
  );
  uguale(
    "la pagina di richiesta della revisione (pagamento) è del solo titolare: l'Ufficio Gare ha il pulsante che avvisa, dentro la gara",
    [`${RADICE_AREA}/gare/abc/revisione`, `${RADICE_AREA}/gare/abc/revisione/`, `${RADICE_AREA}/gare/abc/revisione?richiesta=1`, `${RADICE_AREA}/gare/revisione`, `${RADICE_AREA}/gare/abc/revisione/x`].map((p) => percorsoConsentito("ufficio_gare", p)),
    [false, false, false, false, false],
  );
  atteso("il titolare invece apre la pagina della revisione", percorsoConsentito("titolare", `${RADICE_AREA}/gare/abc/revisione`));
  uguale(
    "l'Ufficio Gare NON vede nessuna pagina amministrativa",
    AMMINISTRATIVE.map((s) => percorsoConsentito("ufficio_gare", `${RADICE_AREA}/${s}`)),
    AMMINISTRATIVE.map(() => false),
  );
  uguale(
    "sezioni dal nome simile a «gare» non passano per il prefisso; nemmeno percorsi strani",
    [
      `${RADICE_AREA}/gare-segrete`,
      `${RADICE_AREA}/gareX`,
      `${RADICE_AREA}/assistenza-pagamenti`,
      `${RADICE_AREA}/gare/../abbonamento`,
      `${RADICE_AREA}/gare/%2e%2e/abbonamento`,
      `${RADICE_AREA}/gare/%2E%2E/pagamenti`,
      `${RADICE_AREA}/gare//abbonamento`,
      `${RADICE_AREA}/gare/./x`,
      `${RADICE_AREA}/gare/%E0%A4%A`,
      "/dashboard",
      "/",
      "",
      "/login",
    ].map((p) => percorsoConsentito("ufficio_gare", p)),
    [false, false, false, false, false, false, false, false, false, false, false, false, false],
  );
  uguale("la query string non cambia l'esito", [percorsoConsentito("ufficio_gare", `${RADICE_AREA}/abbonamento?x=${RADICE_AREA}/gare`), percorsoConsentito("ufficio_gare", `${RADICE_AREA}/gare?next=/abbonamento`)], [false, true]);

  console.log("--- Menu ---");
  uguale("menu dell'Ufficio Gare: solo Dashboard e Gare", VOCI_MENU_UFFICIO_GARE.map((v) => v.label), ["Dashboard", "Gare"]);
  atteso("ogni voce del menu dell'Ufficio Gare è una pagina che può aprire", VOCI_MENU_UFFICIO_GARE.every((v) => percorsoConsentito("ufficio_gare", v.href)));
  atteso(
    "nel menu del titolare compaiono le voci di sempre più «Ufficio Gare»",
    ["Dashboard", "Gare", "Documenti aziendali", "Profilo azienda", "Abbonamento", "Pagamenti e fatture", "Documenti contrattuali", "Ufficio Gare", "Impostazioni"].every((l, i) => VOCI_MENU_TITOLARE[i]?.label === l) && VOCI_MENU_TITOLARE.length === 9,
  );
  atteso("vociMenuPer sceglie il menu giusto", vociMenuPer("ufficio_gare") === VOCI_MENU_UFFICIO_GARE && vociMenuPer("titolare") === VOCI_MENU_TITOLARE);
  // ogni cartella dell'area riservata è o aperta all'Ufficio Gare o nel menu del titolare (nessuna pagina "dimenticata")
  const cartelle = fs
    .readdirSync(path.join(__dirname, "../src/app/site-omnia-ai/dashboard/omnia-ai"), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    // «ufficio-gare» nasce nel blocco successivo: finché la cartella non esiste non c'è nulla da cercare
    .sort();
  atteso(
    "ogni sezione dell'area riservata è aperta all'Ufficio Gare o compare nel menu del titolare",
    cartelle.every((c) => percorsoConsentito("ufficio_gare", `${RADICE_AREA}/${c}`) || VOCI_MENU_TITOLARE.some((v) => v.href === `${RADICE_AREA}/${c}`)),
    `sezioni senza voce: ${cartelle.filter((c) => !percorsoConsentito("ufficio_gare", `${RADICE_AREA}/${c}`) && !VOCI_MENU_TITOLARE.some((v) => v.href === `${RADICE_AREA}/${c}`)).join(", ")}`,
  );

  console.log("--- Invito ---");
  const buono = { email: "  Gare@Azienda.IT ", emailTitolare: "titolare@azienda.it", consenso: true };
  uguale("email normalizzata in minuscolo e senza spazi", validaInvitoUfficioGare(buono), { ok: true, email: "gare@azienda.it" });
  uguale("normalizzaEmail", normalizzaEmail("  A@B.it  "), "a@b.it");
  const errore = (v: Parameters<typeof validaInvitoUfficioGare>[0]) => {
    const e = validaInvitoUfficioGare(v);
    return e.ok ? null : e.errore;
  };
  atteso("email vuota rifiutata, con il messaggio che dice cosa inserire", /^Inserisci/.test(errore({ ...buono, email: "   " }) ?? ""));
  atteso("email senza chiocciola rifiutata", !!errore({ ...buono, email: "gare.azienda.it" }));
  atteso("email con spazi dentro rifiutata", !!errore({ ...buono, email: "ga re@azienda.it" }));
  atteso("email senza dominio rifiutata", !!errore({ ...buono, email: "gare@azienda" }));
  atteso("email troppo lunga rifiutata", !!errore({ ...buono, email: `${"a".repeat(250)}@azienda.it` }));
  atteso("la stessa email del titolare è rifiutata, anche con maiuscole e spazi", !!errore({ ...buono, email: " TITOLARE@Azienda.it " }));
  atteso("la stessa email del titolare è rifiutata anche se il titolare ha maiuscole nell'indirizzo", !!errore({ ...buono, email: "titolare@azienda.it", emailTitolare: " Titolare@Azienda.IT " }));
  atteso("senza il consenso del titolare niente invito", !!errore({ ...buono, consenso: false }));
  atteso("titolare senza email noto: l'invito vale se il resto è a posto", validaInvitoUfficioGare({ ...buono, emailTitolare: null }).ok);

  console.log("--- Chi è l'utente loggato ---");
  {
    const { client, chiamate } = fintoClient({ data: null, error: null });
    const c = await risolviContestoAccount("utente-1", client);
    uguale("nessun legame: è titolare di se stesso", c, { userId: "utente-1", accountId: "utente-1", ruolo: "titolare", sospeso: false });
    uguale("cerca il legame per l'utente loggato, nella tabella giusta", chiamate, ["omnia_ai_membri|titolare_id, ruolo, attivo|membro_id=utente-1"]);
    atteso("eUfficioGare falso per il titolare", !eUfficioGare(c));
  }
  {
    const { client } = fintoClient({ data: { titolare_id: "titolare-9", ruolo: "ufficio_gare", attivo: true }, error: null });
    const c = await risolviContestoAccount("membro-2", client);
    uguale("membro attivo: i dati sono del titolare, il ruolo è Ufficio Gare", c, { userId: "membro-2", accountId: "titolare-9", ruolo: "ufficio_gare", sospeso: false });
    atteso("eUfficioGare vero", eUfficioGare(c));
  }
  {
    const { client } = fintoClient({ data: { titolare_id: "titolare-9", ruolo: "ufficio_gare", attivo: false }, error: null });
    const c = await risolviContestoAccount("membro-2", client);
    uguale("membro sospeso: resta Ufficio Gare ma sospeso", [c.ruolo, c.sospeso, c.accountId], ["ufficio_gare", true, "titolare-9"]);
  }
  for (const codice of ["42P01", "PGRST205"]) {
    const { client } = fintoClient({ data: null, error: { code: codice, message: "tabella assente" } });
    const c = await risolviContestoAccount("utente-1", client);
    uguale(`tabella assente (${codice}, migrazione non eseguita): tutti titolari come prima`, [c.ruolo, c.accountId], ["titolare", "utente-1"]);
  }
  {
    // IL punto di sicurezza: un errore qualunque NON deve far passare per titolare chi potrebbe essere un Ufficio Gare
    let sollevato = false;
    try {
      await risolviContestoAccount("membro-2", fintoClient({ data: null, error: { code: "57014", message: "timeout" } }).client);
    } catch (e) {
      sollevato = e instanceof ErroreContestoAccount;
    }
    atteso("errore di lettura imprevisto: solleva, non restituisce «titolare»", sollevato);
    let sollevato2 = false;
    try {
      await risolviContestoAccount("membro-2", fintoClient({ data: null, error: { message: "senza codice" } }).client);
    } catch (e) {
      sollevato2 = e instanceof ErroreContestoAccount;
    }
    atteso("errore senza codice: solleva", sollevato2);
    let sollevato3 = false;
    try {
      await risolviContestoAccount("membro-2", fintoClient({ data: { titolare_id: "t", ruolo: "contabile", attivo: true }, error: null }).client);
    } catch (e) {
      sollevato3 = e instanceof ErroreContestoAccount;
    }
    atteso("ruolo sconosciuto: solleva, non lo si tratta da titolare", sollevato3);
  }

  console.log("--- Avvisi al titolare ---");
  uguale("giorno di Roma d'estate (22:30 UTC = 00:30 del giorno dopo)", giornoRoma(new Date("2026-07-15T22:30:00Z")), "2026-07-16");
  uguale("giorno di Roma d'estate (21:30 UTC = 23:30 dello stesso giorno)", giornoRoma(new Date("2026-07-15T21:30:00Z")), "2026-07-15");
  uguale("giorno di Roma d'inverno (23:30 UTC = 00:30 del giorno dopo)", giornoRoma(new Date("2026-12-31T23:30:00Z")), "2027-01-01");
  uguale("giorno di Roma d'inverno (22:30 UTC = 23:30 dello stesso giorno)", giornoRoma(new Date("2026-12-31T22:30:00Z")), "2026-12-31");
  uguale("la quota ha chiave vuota (una al giorno in tutto)", chiaveAvviso("quota_esaurita", "gara-1"), "");
  uguale("la revisione ha come chiave la gara (una al giorno per gara)", chiaveAvviso("revisione_richiesta", "gara-1"), "gara-1");
  atteso("duplicato del database = avviso già partito", eAvvisoGiaInviato({ code: "23505" }) && !eAvvisoGiaInviato({ code: "23503" }) && !eAvvisoGiaInviato(null) && !eAvvisoGiaInviato(undefined));
  uguale("messaggio per le gare finite", messaggioPerUfficioGare("gare_finite"), MESSAGGIO_UFFICIO_GARE_GARE_FINITE);
  uguale("messaggio per l'abbonamento non attivo", messaggioPerUfficioGare("abbonamento_non_attivo"), MESSAGGIO_UFFICIO_GARE_ABBONAMENTO_NON_ATTIVO);
  atteso("il messaggio delle gare finite dice di ricordarlo all'amministratore e non offre acquisti", /amministratore/.test(MESSAGGIO_UFFICIO_GARE_GARE_FINITE) && /ricorda/i.test(MESSAGGIO_UFFICIO_GARE_GARE_FINITE) && !/Acquista crediti|Scegli un abbonamento/.test(MESSAGGIO_UFFICIO_GARE_GARE_FINITE));

  console.log("--- Email ---");
  const cattivo = `<script>alert(1)</script>"'&`;
  const invito = emailInvitoUfficioGare({ linkPassword: "https://omnia-ai.it/attiva-account?token_hash=abc&type=magiclink", nomeAzienda: cattivo, emailTitolare: "t@a.it" });
  atteso("invito: contiene il link per la password", invito.html.includes("token_hash=abc") && invito.html.includes("Scegli la tua password"));
  atteso("invito: il nome dell'azienda non inietta HTML", !invito.html.includes("<script>") && invito.html.includes("&lt;script&gt;"));
  atteso("invito: oggetto non vuoto e senza HTML", invito.oggetto.length > 5 && !/[<>]/.test(invito.oggetto));
  atteso("invito: senza nome azienda usa l'email del titolare", emailInvitoUfficioGare({ linkPassword: "x", nomeAzienda: null, emailTitolare: "t@a.it" }).html.includes("t@a.it"));
  for (const motivo of ["gare_finite", "abbonamento_non_attivo"] as const) {
    const e = emailAvvisoGareFinite({ emailUfficioGare: cattivo, motivo });
    atteso(`avviso ${motivo}: link all'abbonamento`, e.html.includes(URL_ABBONAMENTO) && URL_ABBONAMENTO === "https://omnia-ai.it/dashboard/omnia-ai/abbonamento");
    atteso(`avviso ${motivo}: l'email dell'Ufficio Gare non inietta HTML`, !e.html.includes("<script>") && e.html.includes("&lt;script&gt;"));
    atteso(`avviso ${motivo}: nessuna cifra`, !/€|euro|\d+\s*%/i.test(e.html) && !/€/.test(e.oggetto));
    atteso(`avviso ${motivo}: dice che è al massimo una al giorno`, /al massimo una volta al giorno/.test(e.html));
  }
  atteso("avviso gare finite e abbonamento non attivo hanno oggetti diversi", emailAvvisoGareFinite({ emailUfficioGare: "a@b.it", motivo: "gare_finite" }).oggetto !== emailAvvisoGareFinite({ emailUfficioGare: "a@b.it", motivo: "abbonamento_non_attivo" }).oggetto);
  const revisione = emailAvvisoRevisioneRichiesta({ emailUfficioGare: "a@b.it", titoloGara: cattivo, garaId: "id con spazi/e?x" });
  atteso("revisione: il titolo della gara non inietta HTML", !revisione.html.includes("<script>") && revisione.html.includes("&lt;script&gt;"));
  atteso("revisione: il link alla gara codifica l'identificativo", revisione.html.includes(urlRevisioneGara("id con spazi/e?x")) && urlRevisioneGara("id con spazi/e?x") === "https://omnia-ai.it/dashboard/omnia-ai/gare/id%20con%20spazi%2Fe%3Fx/revisione");
  atteso("revisione: nessuna cifra e dice che paga il titolare", !/€/.test(revisione.html) && /la richiedi e la paghi tu/.test(revisione.html));

  console.log("--- Migrazione 0092 ---");
  const sql = leggi("supabase/migrations/0092_omnia_ai_ufficio_gare.sql");
  const senzaCommenti = sql.replace(/^\s*--.*$/gm, "");
  atteso("simboli $$ in numero pari", (senzaCommenti.match(/\$\$/g) ?? []).length % 2 === 0);
  const TABELLE_LAVORO = ["gare", "gara_documenti", "gara_documenti_chunks", "gara_messaggi", "gara_messaggio_allegati", "gara_relazione_sezioni"];
  for (const t of TABELLE_LAVORO) {
    const nuova = `create policy "${t}_all_account" on public.${t}`;
    const vecchia = `drop policy if exists "${t}_all_own" on public.${t};`;
    const iNuova = senzaCommenti.indexOf(nuova);
    const iVecchia = senzaCommenti.indexOf(vecchia);
    atteso(`${t}: la regola nuova si crea PRIMA di togliere la vecchia`, iNuova !== -1 && iVecchia !== -1 && iNuova < iVecchia);
    atteso(`${t}: la regola nuova è protetta da «not exists» (rieseguibile)`, new RegExp(`not exists \\(select 1 from pg_policies where schemaname = 'public' and tablename = '${t}' and policyname = '${t}_all_account'\\)`).test(senzaCommenti));
  }
  atteso(
    "gara_consumi: nuova regola di sola lettura prima della vecchia",
    senzaCommenti.indexOf('create policy "gara_consumi_select_account"') !== -1 &&
      senzaCommenti.indexOf('create policy "gara_consumi_select_account"') < senzaCommenti.indexOf('drop policy if exists "gara_consumi_select_own"') &&
      /create policy "gara_consumi_select_account" on public\.gara_consumi\s+for select/.test(senzaCommenti),
  );
  atteso("ogni regola di lavoro passa dalla funzione del titolare effettivo, calcolata una volta (select ...)", (senzaCommenti.match(/\(select public\.omnia_ai_titolare_effettivo\(\)\) = user_id/g) ?? []).length === TABELLE_LAVORO.length * 2 + 1);
  for (const t of ["subscriptions", "credits", "companies", "invoices", "orders", "omnia_ai_incassi", "omnia_ai_credit_purchases", "omnia_ai_revisioni", "omnia_ai_legal_acceptances", "legal_acceptances", "omnia_ai_notifiche", "assistenza_messaggi", "omnia_ai_gare_gratuite", "users", "omnia_ai_fatture_cliente"]) {
    atteso(`${t}: la migrazione non tocca le sue regole`, !new RegExp(`(policy|table)\\s+(if exists\\s+)?("[a-z_]+"\\s+on\\s+)?public\\.${t}\\b`, "i").test(senzaCommenti));
  }
  atteso("la funzione di ricerca nei documenti usa il titolare effettivo e non auth.uid()", /gara_documenti_chunks\.user_id = \(select public\.omnia_ai_titolare_effettivo\(\)\)/.test(senzaCommenti) && !/gara_documenti_chunks\.user_id = auth\.uid\(\)/.test(senzaCommenti));
  atteso("la funzione del titolare effettivo ignora i membri sospesi", /m\.membro_id = auth\.uid\(\) and m\.attivo/.test(senzaCommenti));
  atteso("la funzione del titolare effettivo ha un percorso di ricerca fisso e non è eseguibile da tutti", /omnia_ai_titolare_effettivo\(\)\s+returns uuid\s+language sql\s+stable\s+security definer\s+set search_path = public/.test(senzaCommenti) && /revoke all on function public\.omnia_ai_titolare_effettivo\(\) from public;/.test(senzaCommenti));
  atteso("un solo utente per ruolo e per titolare (indice unico)", /create unique index if not exists omnia_ai_membri_un_ruolo_per_titolare on public\.omnia_ai_membri \(titolare_id, ruolo\)/.test(senzaCommenti));
  atteso("il membro non può essere il proprio titolare (vincolo)", /check \(membro_id <> titolare_id\)/.test(senzaCommenti));
  atteso("trigger contro le catene, su inserimento e modifica", /create trigger omnia_ai_membri_no_catene\s+before insert or update of membro_id, titolare_id on public\.omnia_ai_membri/.test(senzaCommenti));
  atteso("la tabella dei membri ha la RLS e solo la lettura per authenticated", /alter table public\.omnia_ai_membri enable row level security/.test(senzaCommenti) && /grant select on public\.omnia_ai_membri to authenticated;/.test(senzaCommenti) && !/grant[^;]*(insert|update|delete)[^;]*public\.omnia_ai_membri to authenticated/.test(senzaCommenti));
  atteso("la tabella dei membri è scrivibile dalla chiave di servizio", /grant select, insert, update, delete on public\.omnia_ai_membri to service_role;/.test(senzaCommenti));
  atteso("avvisi: RLS attiva, nessun permesso agli utenti, tutto alla chiave di servizio", /alter table public\.omnia_ai_membri_avvisi enable row level security/.test(senzaCommenti) && !/omnia_ai_membri_avvisi to authenticated/.test(senzaCommenti) && /grant select, insert, update, delete on public\.omnia_ai_membri_avvisi to service_role;/.test(senzaCommenti));
  atteso("avvisi: unicità titolare+tipo+chiave+giorno (l'«una al giorno» sta nel database)", /unique \(titolare_id, tipo, chiave, giorno\)/.test(senzaCommenti) && /'Europe\/Rome'/.test(senzaCommenti));
  atteso("avvisi: solo i due tipi previsti", /check \(tipo in \('quota_esaurita', 'revisione_richiesta'\)\)/.test(senzaCommenti));
  atteso("nessuna cancellazione di dati (niente delete/truncate/drop table)", !/\b(delete from|truncate|drop table|drop column)\b/i.test(senzaCommenti));

  console.log("--- Ufficio Gare visto dal titolare: stato e rinvio del link ---");
  uguale("stato: sospeso vince su tutto", statoUfficioGare({ attivo: false, ultimoAccesso: "2026-10-01T10:00:00Z" }), "sospeso");
  uguale("stato: mai entrato = in attesa", statoUfficioGare({ attivo: true, ultimoAccesso: null }), "in_attesa");
  uguale("stato: entrato = attivo", statoUfficioGare({ attivo: true, ultimoAccesso: "2026-10-01T10:00:00Z" }), "attivo");
  uguale("etichette dei tre stati", ETICHETTA_STATO_UFFICIO_GARE, { in_attesa: "In attesa del primo accesso", attivo: "Attivo", sospeso: "Sospeso" });
  const adesso = new Date("2026-10-16T10:00:00Z");
  const rinvio = (stato: Parameters<typeof rinvioLinkPermesso>[0]["stato"], invito: string | null) => rinvioLinkPermesso({ stato, invitoInviatoIl: invito, adesso });
  atteso("rinvio: in attesa e ultimo invio di un'ora fa = permesso", rinvio("in_attesa", "2026-10-16T09:00:00Z").ok);
  atteso("rinvio: in attesa senza data di invio = permesso", rinvio("in_attesa", null).ok);
  atteso("rinvio: 30 secondi dopo l'ultimo = rifiutato", !rinvio("in_attesa", "2026-10-16T09:59:30Z").ok);
  atteso("rinvio: 59 secondi dopo = rifiutato", !rinvio("in_attesa", "2026-10-16T09:59:01Z").ok);
  atteso("rinvio: esattamente 60 secondi dopo = permesso", rinvio("in_attesa", "2026-10-16T09:59:00Z").ok);
  atteso("rinvio: data di invio nel futuro (orologio sfasato) non blocca per sempre", rinvio("in_attesa", "2026-10-17T09:00:00Z").ok);
  uguale("l'intervallo minimo è di 60 secondi", SECONDI_TRA_DUE_INVII, 60);
  {
    const attivo = rinvio("attivo", null);
    atteso("rinvio: già entrato = rifiutato, con l'indicazione di «Password dimenticata»", !attivo.ok && /Password dimenticata/.test(attivo.ok ? "" : attivo.errore));
    const sospeso = rinvio("sospeso", null);
    atteso("rinvio: sospeso = rifiutato, con l'indicazione di riattivare", !sospeso.ok && /riattiva/i.test(sospeso.ok ? "" : sospeso.errore));
  }

  console.log("--- Lettura dell'Ufficio Gare ---");
  type Membro = { membro_id: string; attivo: boolean; creato_il: string; invito_inviato_il: string };
  type Opzioni = {
    membro?: { data: Membro | null; error: { code?: string; message: string } | null };
    utente?: { email: string } | null;
    ultimoAccesso?: string | null;
    link?: { token?: string | null; errore?: string };
    azienda?: string | null;
  };
  function fintoAdmin(o: Opzioni) {
    const chiamate: string[] = [];
    const admin = {
      from: (tabella: string) => {
        const catena = {
          select: (colonne: string) => {
            chiamate.push(`${tabella}.select(${colonne})`);
            return catena;
          },
          eq: (colonna: string, valore: string) => {
            chiamate.push(`${tabella}.eq(${colonna}=${valore})`);
            return catena;
          },
          maybeSingle: async () => {
            if (tabella === "omnia_ai_membri") return o.membro ?? { data: null, error: null };
            if (tabella === "users") return { data: o.utente ?? null, error: null };
            if (tabella === "companies") return { data: o.azienda === undefined ? null : { ragione_sociale: o.azienda }, error: null };
            throw new Error(`tabella inattesa: ${tabella}`);
          },
        };
        return catena;
      },
      auth: {
        admin: {
          getUserById: async (id: string) => {
            chiamate.push(`getUserById(${id})`);
            return { data: { user: { last_sign_in_at: o.ultimoAccesso ?? null } }, error: null };
          },
          generateLink: async (argomenti: { type: string; email: string }) => {
            chiamate.push(`generateLink(${argomenti.type},${argomenti.email})`);
            if (o.link?.errore) return { data: null, error: { message: o.link.errore } };
            return { data: { properties: { hashed_token: o.link?.token === undefined ? "tok/en+1" : o.link.token } }, error: null };
          },
        },
      },
    };
    return { chiamate, admin: admin as unknown as Parameters<typeof leggiUfficioGare>[1] };
  }
  const riga: Membro = { membro_id: "M1", attivo: true, creato_il: "2026-10-10T08:00:00Z", invito_inviato_il: "2026-10-10T08:00:00Z" };
  {
    const { admin, chiamate } = fintoAdmin({ membro: { data: null, error: null } });
    uguale("nessun Ufficio Gare: «assente»", await leggiUfficioGare("T1", admin), { esito: "assente" });
    uguale(
      "lo cerca per titolare e ruolo, nella tabella giusta",
      chiamate,
      ["omnia_ai_membri.select(membro_id, attivo, creato_il, invito_inviato_il)", "omnia_ai_membri.eq(titolare_id=T1)", "omnia_ai_membri.eq(ruolo=ufficio_gare)"],
    );
  }
  {
    const { admin, chiamate } = fintoAdmin({ membro: { data: riga, error: null }, utente: { email: "gare@azienda.it" }, ultimoAccesso: null });
    const l = await leggiUfficioGare("T1", admin);
    uguale("presente, mai entrato: in attesa", l.esito === "presente" ? [l.ufficio.membroId, l.ufficio.email, l.ufficio.stato, l.ufficio.ultimoAccesso] : l, ["M1", "gare@azienda.it", "in_attesa", null]);
    atteso("legge l'email dalla riga dell'utente e l'ultimo accesso dall'autenticazione", chiamate.includes("users.eq(id=M1)") && chiamate.includes("getUserById(M1)"));
  }
  {
    const { admin } = fintoAdmin({ membro: { data: riga, error: null }, utente: { email: "gare@azienda.it" }, ultimoAccesso: "2026-10-12T09:30:00Z" });
    const l = await leggiUfficioGare("T1", admin);
    uguale("presente, già entrato: attivo, con la data dell'ultimo accesso", l.esito === "presente" ? [l.ufficio.stato, l.ufficio.ultimoAccesso] : l, ["attivo", "2026-10-12T09:30:00Z"]);
  }
  {
    const { admin } = fintoAdmin({ membro: { data: { ...riga, attivo: false }, error: null }, utente: { email: "gare@azienda.it" }, ultimoAccesso: "2026-10-12T09:30:00Z" });
    const l = await leggiUfficioGare("T1", admin);
    uguale("presente e sospeso: sospeso", l.esito === "presente" ? [l.ufficio.stato, l.ufficio.attivo] : l, ["sospeso", false]);
  }
  for (const codice of ["42P01", "PGRST205"]) {
    const { admin } = fintoAdmin({ membro: { data: null, error: { code: codice, message: "assente" } } });
    uguale(`tabella assente (${codice}): «schema_assente»`, await leggiUfficioGare("T1", admin), { esito: "schema_assente" });
  }
  {
    const { admin } = fintoAdmin({ membro: { data: null, error: { code: "57014", message: "timeout" } } });
    uguale("errore imprevisto: «errore», non «assente»", (await leggiUfficioGare("T1", admin)).esito, "errore");
    const { admin: senzaUtente } = fintoAdmin({ membro: { data: riga, error: null }, utente: null });
    uguale("riga dell'utente mancante: «errore»", (await leggiUfficioGare("T1", senzaUtente)).esito, "errore");
  }

  console.log("--- Invio del link per scegliere la password ---");
  {
    const vecchioFetch = globalThis.fetch;
    const vecchiaChiave = process.env.RESEND_API_KEY;
    const vecchioErrore = console.error;
    const registrati: unknown[][] = [];
    const inviati: { url: string; corpo: { from: string; to: string[]; subject: string; html: string } }[] = [];
    let rispostaOk = true;
    process.env.RESEND_API_KEY = "chiave-di-prova";
    console.error = (...argomenti: unknown[]) => {
      registrati.push(argomenti);
    };
    globalThis.fetch = (async (url: string, init: { body: string }) => {
      inviati.push({ url: String(url), corpo: JSON.parse(init.body) });
      return { ok: rispostaOk, text: async () => "risposta del servizio" };
    }) as unknown as typeof fetch;
    try {
      const parametri = { emailUfficioGare: "gare@azienda.it", titolareId: "T1", emailTitolare: "titolare@azienda.it", origine: "https://omnia-ai.it" };

      const { admin, chiamate } = fintoAdmin({ azienda: "Azienda <b>Srl</b>" });
      const ok = await mandaLinkPasswordUfficioGare({ admin, ...parametri });
      atteso("link generato e email partita: true", ok === true && inviati.length === 1);
      const e = inviati[0];
      atteso("l'email va al servizio di posta, all'Ufficio Gare, a nome di OMNIA AI", e?.url === "https://api.resend.com/emails" && JSON.stringify(e.corpo.to) === JSON.stringify(["gare@azienda.it"]) && /OMNIA AI/.test(e.corpo.from));
      atteso("il link è quello dell'attivazione, con il token codificato e la pagina «imposta-password»", e?.corpo.html.includes("https://omnia-ai.it/attiva-account?token_hash=tok%2Fen%2B1&amp;type=magiclink&amp;next=%2Fimposta-password") || e?.corpo.html.includes("https://omnia-ai.it/attiva-account?token_hash=tok%2Fen%2B1&type=magiclink&next=%2Fimposta-password"), e?.corpo.html.slice(0, 400));
      atteso("il token grezzo non compare mai nell'email", !e?.corpo.html.includes("tok/en+1"));
      atteso("il nome dell'azienda nell'email è escapato", !e?.corpo.html.includes("<b>Srl</b>") && e?.corpo.html.includes("&lt;b&gt;Srl&lt;/b&gt;"));
      atteso("genera un link «magiclink» per l'email dell'Ufficio Gare e legge l'azienda del titolare", chiamate.includes("generateLink(magiclink,gare@azienda.it)") && chiamate.includes("companies.eq(user_id=T1)"));
      atteso("nessun errore registrato nel percorso riuscito", registrati.length === 0);

      // in locale il link porta con sé la zona (il cookie del browser può essere rimasto su «console»); sul sito vero no
      inviati.length = 0;
      await mandaLinkPasswordUfficioGare({ admin: fintoAdmin({}).admin, ...parametri, origine: "http://localhost:3000" });
      atteso("in locale il link apre OMNIA AI anche se il browser ricorda un'altra zona", inviati.length === 1 && (inviati[0].corpo.html.includes("http://localhost:3000/attiva-account?__zone=omnia-ai&amp;token_hash=") || inviati[0].corpo.html.includes("http://localhost:3000/attiva-account?__zone=omnia-ai&token_hash=")));
      inviati.length = 0;
      await mandaLinkPasswordUfficioGare({ admin: fintoAdmin({}).admin, ...parametri, origine: "https://omnia-ai.it" });
      atteso("sul sito vero il link non porta nessuna zona", inviati.length === 1 && !inviati[0].corpo.html.includes("__zone"));
      inviati.length = 0;
      await mandaLinkPasswordUfficioGare({ admin: fintoAdmin({}).admin, ...parametri, origine: "https://localhost.evil.example" });
      atteso("un dominio che solo comincia per «localhost» non è locale", inviati.length === 1 && !inviati[0].corpo.html.includes("__zone"));

      inviati.length = 0;
      const errore = await mandaLinkPasswordUfficioGare({ admin: fintoAdmin({ link: { errore: "boom" } }).admin, ...parametri });
      atteso("generazione del link fallita: false e nessuna email", errore === false && inviati.length === 0);
      const senzaToken = await mandaLinkPasswordUfficioGare({ admin: fintoAdmin({ link: { token: null } }).admin, ...parametri });
      atteso("link senza token: false e nessuna email", senzaToken === false && inviati.length === 0);

      rispostaOk = false;
      registrati.length = 0;
      const rifiutata = await mandaLinkPasswordUfficioGare({ admin: fintoAdmin({}).admin, ...parametri });
      atteso("il servizio di posta rifiuta l'invio: false", rifiutata === false && inviati.length === 1);
      atteso("il token del link non finisce mai nel registro degli errori", !JSON.stringify(registrati).includes("tok/en+1") && !JSON.stringify(registrati).includes("tok%2Fen"));

      rispostaOk = true;
      delete process.env.RESEND_API_KEY;
      inviati.length = 0;
      const senzaChiave = await mandaLinkPasswordUfficioGare({ admin: fintoAdmin({}).admin, ...parametri });
      atteso("senza chiave del servizio di posta: false", senzaChiave === false && inviati.length === 0);
    } finally {
      globalThis.fetch = vecchioFetch;
      console.error = vecchioErrore;
      if (vecchiaChiave === undefined) delete process.env.RESEND_API_KEY;
      else process.env.RESEND_API_KEY = vecchiaChiave;
    }
  }

  console.log("--- Azioni e pagina del titolare ---");
  const azioni = leggi("src/app/actions/omnia-ai-ufficio-gare.ts");
  const funzioni = [...azioni.matchAll(/export async function (\w+)\(/g)].map((m) => ({ nome: m[1], inizio: m.index ?? 0 }));
  uguale("le azioni esportate sono quelle previste", funzioni.map((f) => f.nome), ["creaUfficioGare", "rinviaLinkUfficioGare", "sospendiUfficioGare", "riattivaUfficioGare", "rimuoviUfficioGare"]);
  const corpoDi = (nome: string) => {
    const i = funzioni.findIndex((f) => f.nome === nome);
    return azioni.slice(funzioni[i].inizio, i + 1 < funzioni.length ? funzioni[i + 1].inizio : azioni.length);
  };
  for (const f of funzioni) {
    atteso(
      `${f.nome}: la prima cosa è la guardia del titolare`,
      /^export async function \w+\([^)]*\)[^{]*\{\n\s*const guardia = await richiediTitolareAzione\(\);\n\s*if \(!guardia\.ok\) return \{ error: guardia\.errore \};/.test(corpoDi(f.nome)),
    );
  }
  atteso("il file dichiara «use server» in testa", azioni.startsWith('"use server";'));
  atteso("nessuna azione legge l'Ufficio Gare da un dato della richiesta", !/formData\.get\("(membro|membroId|ufficio|userId|titolare)/i.test(azioni) && !/searchParams|headers\(\)\.get\("x-/.test(azioni));
  atteso("tutte le chiamate a leggiUfficioGare partono dal titolare loggato", [...azioni.matchAll(/leggiUfficioGare\(([^,]+),/g)].length === 5 && [...azioni.matchAll(/leggiUfficioGare\(([^,]+),/g)].every((m) => m[1] === "contesto.accountId"));
  {
    const aggiornamenti = [...azioni.matchAll(/from\("omnia_ai_membri"\)\s*\.update\(/g)].length;
    const conTitolare = [...azioni.matchAll(/from\("omnia_ai_membri"\)\s*\.update\([^;]*?\.eq\("titolare_id", contesto\.accountId\)/g)].length;
    atteso("ogni aggiornamento dei membri è limitato al titolare loggato", aggiornamenti === 4 && conTitolare === aggiornamenti, `aggiornamenti ${aggiornamenti}, limitati ${conTitolare}`);
    const eliminazioni = [...azioni.matchAll(/deleteUser\(([^)]*)\)/g)].map((m) => m[1]);
    uguale("si elimina solo l'utente appena creato o l'Ufficio Gare letto dal database", eliminazioni.sort(), ["lettura.ufficio.membroId", "membroId"]);
  }
  {
    const c = corpoDi("creaUfficioGare");
    const pos = (testo: string) => c.indexOf(testo);
    atteso("creazione: abbonamento controllato PRIMA di creare l'utente", pos("requireOmniaAiWriteAccess(contesto.accountId, admin)") !== -1 && pos("requireOmniaAiWriteAccess") < pos("createUser"));
    atteso("creazione: Ufficio Gare già presente e indirizzo già usato controllati PRIMA di creare l'utente", pos("leggiUfficioGare") < pos("createUser") && pos('from("users")') < pos("createUser"));
    atteso("creazione: il consenso è letto dalla casella e validato", c.includes('consenso: formData.get("consenso") === "on"') && c.includes("validaInvitoUfficioGare"));
    atteso("creazione: il consenso registra IP e user agent", c.includes("consenso_ip: meta.ip") && c.includes("consenso_user_agent"));
    atteso("creazione: il legame si scrive DOPO l'utente, con il titolare loggato e il ruolo fisso", pos("createUser") < pos('from("omnia_ai_membri").insert') && c.includes("titolare_id: contesto.accountId") && c.includes('ruolo: "ufficio_gare"'));
    atteso("creazione: se il legame fallisce l'utente si annulla (mai un account a metà)", /if \(erroreLegame\) \{[\s\S]*return annulla\(/.test(c));
    atteso("creazione: il link parte DOPO il legame", pos('from("omnia_ai_membri").insert') < pos("mandaLinkPasswordUfficioGare"));
    atteso("creazione: la password iniziale è casuale e non viene mai mostrata né registrata", c.includes("randomBytes(32)") && !/console\.(log|error)\([^)]*casuale/.test(c));
    atteso("creazione: l'errore per un indirizzo già usato non rivela se esiste un account", /MESSAGGIO_EMAIL_NON_UTILIZZABILE = "Questo indirizzo non può essere usato: scegline un altro\."/.test(azioni));
  }
  {
    const c = corpoDi("rinviaLinkUfficioGare");
    const pos = (testo: string) => c.indexOf(testo);
    atteso("rinvio: permesso verificato prima di registrare e mandare", pos("rinvioLinkPermesso") !== -1 && pos("rinvioLinkPermesso") < pos("invito_inviato_il") && pos("invito_inviato_il") < pos("mandaLinkPasswordUfficioGare"));
  }
  {
    const s = corpoDi("sospendiUfficioGare");
    atteso("sospensione: prima il segno nel database, poi il blocco del login", s.indexOf("attivo: false") !== -1 && s.indexOf("attivo: false") < s.indexOf("ban_duration"));
    const r = corpoDi("riattivaUfficioGare");
    atteso("riattivazione: prima si toglie il blocco del login, poi si riapre l'accesso ai dati", r.indexOf('ban_duration: "none"') !== -1 && r.indexOf('ban_duration: "none"') < r.indexOf("attivo: true"));
    const x = corpoDi("rimuoviUfficioGare");
    atteso("rimozione: prima si chiude l'accesso ai dati, poi si elimina l'utente", x.indexOf("attivo: false") !== -1 && x.indexOf("attivo: false") < x.indexOf("deleteUser"));
    atteso("rimozione: se l'eliminazione fallisce l'esito è un errore (l'accesso resta chiuso), mai un successo", /deleteUser\(lettura\.ufficio\.membroId\);\s*if \(error\) \{[\s\S]*?return \{ error: "Rimozione non riuscita: l'accesso resta sospeso/.test(x));
    atteso("sospensione: il blocco del login è di 100 anni e si applica davvero", /const DURATA_SOSPENSIONE = "876000h";/.test(azioni) && s.includes("{ ban_duration: DURATA_SOSPENSIONE }"));
    const ins = corpoDi("creaUfficioGare");
    atteso("creazione: se l'Ufficio Gare esiste già si rifiuta, con il messaggio che dice cosa fare", /if \(lettura\.esito === "presente"\) return \{ error: "Hai già un Ufficio Gare: se vuoi cambiarlo, rimuovilo prima/.test(ins));
    atteso("creazione: un indirizzo già registrato si rifiuta con il messaggio neutro", /if \(esistente\) return \{ error: MESSAGGIO_EMAIL_NON_UTILIZZABILE \};/.test(ins));
    atteso("creazione: l'indirizzo è dato per confermato (l'ha indicato il titolare: nessun link di conferma)", ins.includes("{ email, password: casuale, email_confirm: true }"));
    const rin = corpoDi("rinviaLinkUfficioGare");
    atteso("rinvio: si registra l'ora vera dell'invio", rin.includes(".update({ invito_inviato_il: new Date().toISOString() })") && !rin.includes("2000-01-01"));
  }
  const pagina = leggi("src/app/site-omnia-ai/dashboard/omnia-ai/ufficio-gare/page.tsx");
  atteso("la pagina parte dalla guardia del titolare e non legge la sessione per conto suo", pagina.includes("await richiediTitolarePagina()") && !pagina.includes("auth.getUser"));
  atteso("la pagina mostra il motivo se non si può creare (abbonamento non attivo, migrazione mancante)", pagina.includes("Con l'abbonamento non attivo") && pagina.includes("schema_assente"));
  const sidebar = leggi("src/components/omnia-ai/sidebar-nav.tsx");
  atteso("la barra laterale usa le voci del ruolo (titolare di default)", sidebar.includes("VOCI_MENU_TITOLARE") && sidebar.includes("voci.map("));
  atteso("la dashboard passa le voci alla barra laterale", leggi("src/components/omnia-ai/dashboard-shell.tsx").includes("<SidebarNav nomeAzienda={nomeAzienda} voci={voci} />"));
  const guardie = leggi("src/lib/omnia-ai-account-guardie.ts");
  atteso("guardia delle azioni: l'Ufficio Gare riceve il rifiuto e un errore di lettura non passa per titolare", guardie.includes('sessione.contesto.ruolo !== "titolare") return { ok: false') && guardie.includes("catch (e)") && guardie.includes("ErroreContestoAccount) return { ok: false"));
  atteso("guardia delle pagine: l'Ufficio Gare torna alla dashboard, senza sessione al login, errore di lettura = nessun accesso", guardie.includes("redirect(RADICE_AREA)") && guardie.includes('redirect("/login")') && /ErroreContestoAccount\) return null/.test(guardie));
  atteso("le guardie leggono il ruolo con la chiave di servizio e dalla sessione verificata", guardie.includes("risolviContestoAccount(user.id, createAdminClient())") && guardie.includes("auth.getUser()"));

  if (fallimenti.length > 0) {
    console.log(`\n${fallimenti.length} controlli falliti:\n- ${fallimenti.join("\n- ")}`);
    process.exit(1);
  }
  console.log("\nTutti i controlli sono andati a buon fine.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
