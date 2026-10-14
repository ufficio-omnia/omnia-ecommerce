// Autotest di «utenti creati dalla console e gare gratuite» (migrazione 0084): controllo dei campi
// del modulo, generatore di password, calcolo delle gare gratuite, stato «prova» dell'area cliente
// (con un client finto), ordine del consumo, migrazione e guardie di sicurezza.
// Gratuito, nessun database né rete: gira nel livello 1, quindi in prebuild.
import fs from "fs";
import path from "path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getOmniaAiAccessState, requireOmniaAiWriteAccess, MESSAGGIO_SOLA_LETTURA } from "../src/lib/omnia-ai-access";
import { MAX_GARE_GRATUITE, applicaVariazione, calcolaGareGratuite, testoAvvisoProva } from "../src/lib/omnia-ai-gare-gratuite";
import { PASSWORD_MAX, PASSWORD_MIN, generaPassword, resetPasswordPermesso, statoPasswordCliente, testoEmailResetPassword, validaNuovoUtente } from "../src/lib/console/utenti-console-calcoli";

const fallimenti: string[] = [];
function atteso(nome: string, ok: boolean, dettaglio = "") {
  console.log(`${ok ? "ok    " : "FALLITO"} ${nome}${ok ? "" : ` — ${dettaglio}`}`);
  if (!ok) fallimenti.push(nome);
}
function uguale<T>(nome: string, ottenuto: T, previsto: T) {
  atteso(nome, JSON.stringify(ottenuto) === JSON.stringify(previsto), `ottenuto ${JSON.stringify(ottenuto)}, previsto ${JSON.stringify(previsto)}`);
}
const leggi = (relativo: string) => fs.readFileSync(path.join(__dirname, "..", relativo), "utf-8").replace(/\r\n/g, "\n");
const primaDi = (sorgente: string, a: string, b: string) => sorgente.indexOf(a) !== -1 && sorgente.indexOf(a) < sorgente.indexOf(b);

// Client finto: restituisce, per tabella, la riga (o l'errore) scelta dal test.
type Scenario = { abbonamento: { status: string; current_period_end: string | null } | null; gratuite: { assegnate: number; usate: number } | null | "tabella_assente" };
function clienteFinto(s: Scenario): SupabaseClient {
  return {
    from: (tabella: string) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const q: any = {
        select: () => q,
        eq: () => q,
        order: () => q,
        limit: () => q,
        maybeSingle: async () => {
          if (tabella === "subscriptions") return { data: s.abbonamento, error: null };
          if (tabella === "omnia_ai_gare_gratuite") return s.gratuite === "tabella_assente" ? { data: null, error: { code: "42P01", message: "manca" } } : { data: s.gratuite, error: null };
          return { data: null, error: null };
        },
      };
      return q;
    },
  } as unknown as SupabaseClient;
}

async function main() {
  console.log("--- Nuovo utente: controllo dei campi ---");
  const base = { email: "Cliente@Esempio.IT", password: "Tr0vaMi-subito-2026", gare: "2" };
  const ok = validaNuovoUtente(base);
  atteso("un modulo completo è accettato", ok.ok);
  if (ok.ok) {
    uguale("l'email si normalizza in minuscolo", ok.valori.email, "cliente@esempio.it");
    uguale("le gare gratuite sono un numero", ok.valori.gare, 2);
  }
  const errore = (campi: Partial<typeof base>) => {
    const r = validaNuovoUtente({ ...base, ...campi });
    return r.ok ? null : r.errore;
  };
  atteso("email non valida", errore({ email: "non-una-email" }) !== null);
  atteso("email vuota", errore({ email: "  " }) !== null);
  atteso(`password sotto i ${PASSWORD_MIN} caratteri`, errore({ password: "Corta1" }) !== null);
  atteso(`password oltre i ${PASSWORD_MAX} caratteri`, errore({ password: `a1${"x".repeat(PASSWORD_MAX)}` }) !== null);
  atteso("password solo lettere", errore({ password: "soloLettereMaLunga" }) !== null);
  atteso("password solo cifre", errore({ password: "12345678901234" }) !== null);
  atteso("password uguale all'email", errore({ email: "mario.rossi@esempio.it", password: "mario.rossi@esempio.it" }) !== null);
  atteso("password che contiene la parte locale dell'email", errore({ email: "mariorossi@esempio.it", password: "xx-mariorossi-99" }) !== null);
  atteso("password con una parte locale corta (< 4) non è considerata contenuta", errore({ email: "ab@esempio.it", password: "ab-Lunga-Davvero-77" }) === null);
  uguale("gare vuote = 0", (validaNuovoUtente({ ...base, gare: "" }) as { valori: { gare: number } }).valori.gare, 0);
  atteso("gare negative", errore({ gare: "-1" }) !== null);
  atteso("gare con decimali", errore({ gare: "1.5" }) !== null);
  atteso("gare non numeriche", errore({ gare: "tre" }) !== null);
  atteso(`gare oltre ${MAX_GARE_GRATUITE}`, errore({ gare: String(MAX_GARE_GRATUITE + 1) }) !== null);
  atteso(`gare = ${MAX_GARE_GRATUITE} accettate`, errore({ gare: String(MAX_GARE_GRATUITE) }) === null);

  console.log("--- Generatore di password ---");
  const generate = Array.from({ length: 300 }, () => generaPassword(Math.random));
  atteso("sedici caratteri", generate.every((p) => p.length === 16));
  atteso("sempre con una lettera e una cifra", generate.every((p) => /[A-Za-z]/.test(p) && /\d/.test(p)));
  atteso("senza caratteri ambigui (0 O 1 l I)", generate.every((p) => !/[0O1lI]/.test(p)));
  atteso("superano la validazione del modulo", generate.every((p) => validaNuovoUtente({ email: "zzzz@altro.it", password: p, gare: "1" }).ok));
  atteso("non sono tutte uguali", new Set(generate).size > 290);
  atteso("determinista con un generatore dato", generaPassword(() => 0.5) === generaPassword(() => 0.5));
  atteso("regge i valori estremi del generatore (0 e quasi 1)", generaPassword(() => 0).length === 16 && generaPassword(() => 0.9999999).length === 16);

  console.log("--- Gare gratuite: calcoli ---");
  uguale("senza riga: nessun contatore", calcolaGareGratuite(null), null);
  uguale("3 assegnate, 1 usata: ne restano 2", calcolaGareGratuite({ assegnate: 3, usate: 1 }), { assegnate: 3, usate: 1, rimanenti: 2 });
  uguale("mai sotto zero", calcolaGareGratuite({ assegnate: 1, usate: 5 })?.rimanenti, 0);
  uguale("assegna 2 a chi non ha nulla", applicaVariazione(null, 2), { assegnate: 2 });
  uguale("aggiunge a quelle esistenti", applicaVariazione({ assegnate: 3, usate: 1 }, 2), { assegnate: 5 });
  uguale("toglie fino al numero già usato", applicaVariazione({ assegnate: 3, usate: 1 }, -2), { assegnate: 1 });
  atteso("non scende sotto le gare già usate", "errore" in applicaVariazione({ assegnate: 3, usate: 2 }, -2));
  atteso("variazione zero rifiutata", "errore" in applicaVariazione({ assegnate: 3, usate: 0 }, 0));
  atteso("variazione non intera rifiutata", "errore" in applicaVariazione({ assegnate: 3, usate: 0 }, 1.5));
  atteso("oltre il massimo rifiutata", "errore" in applicaVariazione({ assegnate: MAX_GARE_GRATUITE, usate: 0 }, 1));
  const avviso1 = testoAvvisoProva({ assegnate: 3, usate: 2, rimanenti: 1 });
  atteso("avviso con una gara rimasta (singolare)", !avviso1.esaurite && /ti resta 1 gara gratuita su 3/.test(avviso1.testo));
  atteso("avviso con più gare rimaste", /ti restano 2 gare gratuite su 3/.test(testoAvvisoProva({ assegnate: 3, usate: 1, rimanenti: 2 }).testo));
  const avviso0 = testoAvvisoProva({ assegnate: 3, usate: 3, rimanenti: 0 });
  atteso("a gare finite: avviso di esaurimento con l'invito ad abbonarsi", avviso0.esaurite && /Hai usato tutte le gare gratuite/.test(avviso0.testo) && /serve un abbonamento/.test(avviso0.testo));

  console.log("--- Stato «prova» dell'area cliente ---");
  const futuro = new Date(Date.now() + 10 * 86_400_000).toISOString();
  const passato = new Date(Date.now() - 100 * 86_400_000).toISOString();
  const stato = (s: Scenario) => getOmniaAiAccessState("u", clienteFinto(s));
  const logOriginale = console.error;
  const errori: unknown[][] = [];
  console.error = (...a: unknown[]) => void errori.push(a);
  const a = await stato({ abbonamento: null, gratuite: { assegnate: 3, usate: 1 } });
  uguale("senza abbonamento e con 3 gare (1 usata): prova, 2 rimaste", a, { stato: "prova", gare: { assegnate: 3, usate: 1, rimanenti: 2 } });
  uguale("gare tutte usate: ancora «prova» (consulta e scarica), 0 rimaste", (await stato({ abbonamento: null, gratuite: { assegnate: 3, usate: 3 } })), { stato: "prova", gare: { assegnate: 3, usate: 3, rimanenti: 0 } });
  uguale("senza abbonamento e senza gare gratuite: come prima (pagina di attivazione)", await stato({ abbonamento: null, gratuite: null }), { stato: "cessato", avevaAbbonamento: false });
  uguale("tabella delle gare gratuite assente (migrazione non eseguita): come prima", await stato({ abbonamento: null, gratuite: "tabella_assente" }), { stato: "cessato", avevaAbbonamento: false });
  atteso("e senza rumore nel log", errori.length === 0, JSON.stringify(errori));
  uguale("con abbonamento attivo le gare gratuite non contano: attivo", await stato({ abbonamento: { status: "attivo", current_period_end: futuro }, gratuite: { assegnate: 3, usate: 0 } }), { stato: "attivo" });
  atteso("con un abbonamento scaduto (cessato) NON si torna in prova", (await stato({ abbonamento: { status: "annullato", current_period_end: passato }, gratuite: { assegnate: 3, usate: 0 } })).stato === "cessato");
  atteso("con un abbonamento da poco scaduto: sola lettura, non prova", (await stato({ abbonamento: { status: "annullato", current_period_end: new Date(Date.now() - 5 * 86_400_000).toISOString() }, gratuite: { assegnate: 3, usate: 0 } })).stato === "sola_lettura");
  console.error = logOriginale;

  const scrittura = (s: Scenario) => requireOmniaAiWriteAccess("u", clienteFinto(s));
  uguale("in prova si può lavorare (nessun blocco)", await scrittura({ abbonamento: null, gratuite: { assegnate: 2, usate: 0 } }), null);
  uguale("in prova a gare finite si può ancora lavorare sulle gare già avviate (il limite è all'avvio dell'analisi)", await scrittura({ abbonamento: null, gratuite: { assegnate: 2, usate: 2 } }), null);
  uguale("senza abbonamento né gare gratuite resta bloccato", await scrittura({ abbonamento: null, gratuite: null }), MESSAGGIO_SOLA_LETTURA);

  console.log("--- Consumo delle gare gratuite ---");
  const consumo = leggi("src/lib/gara-consumo.ts");
  const posCrediti = consumo.indexOf('tipo: "credito"');
  const posGratuite = consumo.indexOf("consumaGaraGratuita({ admin");
  const posNotificaFinale = consumo.indexOf('tipo: "gare_piano_esaurite"');
  atteso("le gare gratuite si usano dopo piano e crediti e prima del rifiuto per quota esaurita", posCrediti !== -1 && posCrediti < posGratuite && posGratuite < posNotificaFinale);
  atteso("solo per chi non ha MAI avuto un abbonamento (nessuna riga in subscriptions)", /abbonamentiAvuti \?\? 0\) === 0\) \{\s*const gratuita = await consumaGaraGratuita/.test(consumo));
  atteso("il consumo si registra con tipo «gratuita»", /tipo: "gratuita"/.test(consumo));
  atteso("prima si registra il consumo (indice unico = idempotenza), poi si incrementa «usate» con una guardia", consumo.indexOf('tipo: "gratuita"') < consumo.indexOf(".update({ usate: riga.usate + 1") && /\.eq\("usate", riga\.usate\)/.test(consumo));
  atteso("a gare finite si rifiuta con il messaggio dedicato", /gare\.rimanenti <= 0\) \{\s*await notificaGareGratuiteEsaurite\(userId, gare\.assegnate\);\s*return \{ error: MESSAGGIO_GARE_GRATUITE_ESAURITE \}/.test(consumo));
  atteso("la notifica «gare gratuite esaurite» è unica per ciclo di gare assegnate", /chiaveDedup: `\$\{userId\}:gratuite:\$\{assegnate\}`/.test(consumo));
  atteso("l'ultima gara usata genera subito la notifica", /gare\.rimanenti - 1 <= 0\) await notificaGareGratuiteEsaurite/.test(consumo));

  console.log("--- Migrazione 0084 ---");
  const mig = leggi("supabase/migrations/0084_omnia_ai_utenti_console_gare_gratuite.sql");
  const sql = mig.split("\n").filter((r) => !r.trimStart().startsWith("--")).join("\n");
  atteso("aggiunge il valore «gratuita» al tipo di consumo, in modo idempotente", /alter type public\.gara_consumo_tipo add value if not exists 'gratuita'/.test(sql));
  for (const t of ["omnia_ai_utenti_console", "omnia_ai_gare_gratuite", "omnia_ai_gare_gratuite_log"]) {
    atteso(`tabella ${t}: creata se manca, con la RLS attiva`, new RegExp(`create table if not exists public\\.${t}\\b`).test(sql) && new RegExp(`alter table public\\.${t} enable row level security`).test(sql));
  }
  atteso("le tre tabelle si cancellano con l'utente (on delete cascade): niente utenti di prova non cancellabili", (sql.match(/references public\.users \(id\) on delete cascade/g) ?? []).length === 3);
  atteso("il cliente legge SOLO il proprio contatore di gare gratuite", /create policy "omnia_ai_gare_gratuite_select_own"[\s\S]*?user_id = auth\.uid\(\)/.test(sql) && /grant select on public\.omnia_ai_gare_gratuite to authenticated/.test(sql));
  atteso("nessun permesso al cliente su utenti_console e sul registro dei movimenti", !/to authenticated/.test(sql.replace(/grant select on public\.omnia_ai_gare_gratuite to authenticated/, "")));
  atteso("il cliente non può scrivere nulla (nessun insert/update/delete a authenticated o anon)", !/grant[^;]*\b(insert|update|delete)\b[^;]*to (authenticated|anon)/i.test(sql));
  atteso("il registro dei movimenti è solo in aggiunta (select e insert, mai update/delete)", /grant select, insert on public\.omnia_ai_gare_gratuite_log to service_role/.test(sql));
  atteso("non si possono avere più gare usate che assegnate (vincolo)", /check \(usate <= assegnate\)/.test(sql));
  atteso("nessuna cancellazione di dati", !/\b(delete\s+from|truncate|drop\s+table|drop\s+column)\b/i.test(sql));
  atteso("le colonne per il reset password del blocco successivo ci sono", /reset_richiesto_il/.test(sql) && /password_consegnata_il/.test(sql));
  atteso("nessuna password né segreto in nessuna colonna", !/password_hash|password text|secret/i.test(sql));

  console.log("--- Console: azioni e pagine ---");
  const azioni = leggi("src/app/site-console/azioni/utenti-console.ts");
  const corpoCrea = azioni.slice(azioni.indexOf("export async function creaUtenteDaConsole"), azioni.indexOf("export async function modificaGareGratuite"));
  const corpoModifica = azioni.slice(azioni.indexOf("export async function modificaGareGratuite"));
  atteso("creaUtenteDaConsole parte dal controllo admin", primaDi(corpoCrea, "await richiediAdminAzione()", "validaNuovoUtente("));
  atteso("modificaGareGratuite parte dal controllo admin", primaDi(corpoModifica, "await richiediAdminAzione()", "formData.get"));
  atteso(
    "e se non è admin l'azione si ferma subito («Non autorizzato»), in entrambe",
    [corpoCrea, corpoModifica].every((c) => /const sessione = await richiediAdminAzione\(\);\s*if \(!sessione\) return \{ errore: "Non autorizzato\." \};/.test(c)),
  );
  atteso("le tabelle della migrazione si controllano PRIMA di creare l'utente", primaDi(corpoCrea, "omnia_ai_utenti_console\").select(\"user_id\"", "auth.admin.createUser"));
  atteso("controlla che l'email non esista già prima di crearlo", primaDi(corpoCrea, 'from("users").select("id").eq("email", email)', "auth.admin.createUser"));
  atteso("l'utente si crea con l'email già confermata e senza ruolo speciale (mai admin)", /createUser\(\{ email, password, email_confirm: true \}\)/.test(corpoCrea) && !/role/.test(corpoCrea));
  atteso("se un passo fallisce l'utente appena creato si cancella (mai un account a metà)", (corpoCrea.match(/return annulla\(/g) ?? []).length === 2 && /auth\.admin\.deleteUser\(id\)/.test(corpoCrea));
  atteso(
    "la password non viene scritta in nessuna tabella né nel log (solo Supabase Auth la riceve)",
    ![...corpoCrea.matchAll(/\.insert\(\{[^}]*\}\)/g)].some((m) => /password/i.test(m[0])) && ![...corpoCrea.matchAll(/console\.(error|log|warn)\([^)]*\)/g)].some((m) => /password/i.test(m[0])) && (corpoCrea.match(/createUser\(\{ email, password/g) ?? []).length === 1,
  );
  atteso("il cliente creato si registra come «creato da console» con l'email di chi l'ha creato", /from\("omnia_ai_utenti_console"\)\.insert\(\{ user_id: id, creato_da_email: sessione\.email \}\)/.test(corpoCrea));
  atteso("le gare gratuite le assegna solo la console, con una riga di registro per ogni movimento", /from\("omnia_ai_gare_gratuite_log"\)\.insert/.test(corpoCrea) && /from\("omnia_ai_gare_gratuite_log"\)\.insert/.test(corpoModifica));
  atteso("le gare gratuite si modificano solo a chi non ha mai avuto un abbonamento e non a un admin", /utente\.role === "admin"/.test(corpoModifica) && /abbonamenti \?\? 0\) > 0/.test(corpoModifica));
  atteso("l'aggiornamento del contatore ha la guardia contro modifiche contemporanee", /\.eq\("assegnate", attuale\.assegnate\)[\s\S]*?\.eq\("usate", attuale\.usate\)/.test(corpoModifica));
  const nuovo = leggi("src/app/site-console/(app)/utenti/nuovo/page.tsx");
  atteso("pagina «Nuovo utente»: controllo admin come prima istruzione", /export default async function PaginaNuovoUtente\(\) \{\s*await richiediAdminPagina\(\);/.test(nuovo));
  atteso("la lista utenti ha il pulsante «Nuovo utente»", /href="\/utenti\/nuovo"/.test(leggi("src/app/site-console/_componenti/utenti-vista.tsx")));
  atteso("il modulo avverte che la password non si può rivedere e non parte nessuna email", /dopo non potrai più rivederla/.test(leggi("src/app/site-console/_componenti/form-nuovo-utente.tsx")) && /Nessuna email parte da qui/.test(leggi("src/app/site-console/_componenti/form-nuovo-utente.tsx")));
  atteso("la scheda cliente ha il riquadro «Prova gratuita» con il modulo e il registro dei movimenti", /titolo="Prova gratuita"/.test(leggi("src/app/site-console/_componenti/scheda-cliente-vista.tsx")) && /modificaGareGratuite/.test(leggi("src/app/site-console/_componenti/scheda-cliente-vista.tsx")));
  atteso("dopo la creazione la scheda mostra l'avviso «Utente creato»", /utente_creato/.test(leggi("src/app/site-console/_componenti/avviso-esito.tsx")) && /esito=utente_creato/.test(corpoCrea));

  console.log("--- Password: reset e consegna al cliente ---");
  uguale("password iniziale (mai toccata)", statoPasswordCliente({ resetRichiestoIl: null, passwordConsegnataIl: null }), "iniziale");
  uguale("reset inviato, il cliente non ha ancora scelto", statoPasswordCliente({ resetRichiestoIl: "2026-10-14T10:00:00Z", passwordConsegnataIl: null }), "reset_inviato");
  uguale("il cliente ha scelto la sua", statoPasswordCliente({ resetRichiestoIl: "2026-10-14T10:00:00Z", passwordConsegnataIl: "2026-10-14T11:00:00Z" }), "consegnata");
  uguale("la consegna vale anche senza un reset (il cliente ha cambiato la password da solo)", statoPasswordCliente({ resetRichiestoIl: null, passwordConsegnataIl: "2026-10-14T11:00:00Z" }), "consegnata");
  atteso("il reset è permesso prima della consegna (anche per rinviare l'email)", resetPasswordPermesso("iniziale") && resetPasswordPermesso("reset_inviato"));
  atteso("dopo la consegna la console non può più fare nulla", !resetPasswordPermesso("consegnata"));
  const mail = testoEmailResetPassword("https://omnia-ai.it/attiva-account?token_hash=abc&type=magiclink", (t) => t.replace(/&/g, "&amp;"));
  atteso("l'email contiene il link (con i caratteri speciali protetti), dice che la password è solo del cliente e il link è a tempo", mail.html.includes('href="https://omnia-ai.it/attiva-account?token_hash=abc&amp;type=magiclink"') && /nessuno di Omnia potrà vederla né modificarla/.test(mail.html) && /valido per un tempo limitato/.test(mail.html));
  const resetFn = leggi("src/app/site-console/azioni/utenti-console.ts");
  const corpoReset = resetFn.slice(resetFn.indexOf("export async function resetPasswordCliente"));
  atteso("il reset parte dal controllo admin e si ferma subito se non lo è", /const sessione = await richiediAdminAzione\(\);\s*if \(!sessione\) return \{ errore: "Non autorizzato\." \};/.test(corpoReset));
  atteso("vale solo per clienti (non admin) creati dalla console", /utente\.role !== "cliente"/.test(corpoReset) && /if \(!riga\) return \{ errore: "Questo cliente non è stato creato dalla console/.test(corpoReset));
  atteso("DOPO la consegna il server rifiuta, PRIMA di toccare qualsiasi cosa", primaDi(corpoReset, "if (!resetPasswordPermesso(stato)) return { errore: MESSAGGIO_PASSWORD_GIA_CONSEGNATA }", "updateUserById") && primaDi(corpoReset, "if (!resetPasswordPermesso(stato))", "generateLink") && primaDi(corpoReset, "if (!resetPasswordPermesso(stato))", "sendEmail("));
  atteso("la password che subentra è casuale (randomBytes), mai quella del modulo né mostrata", /randomBytes\(32\)/.test(corpoReset) && /updateUserById\(userId, \{ password: casuale \}\)/.test(corpoReset) && !/formData\.get\("password"\)/.test(corpoReset));
  atteso("la password si azzera PRIMA di generare il link (nessuna operazione sull'utente può invalidarlo)", primaDi(corpoReset, "updateUserById(userId", "generateLink("));
  atteso("il link porta alla pagina di attivazione del sito OMNIA AI (non alla console) e va solo nell'email", /\$\{OMNIA_AI_BASE_URL\}\/attiva-account\?token_hash=/.test(corpoReset) && !/CONSOLE_BASE_URL|console\.omniaitalia/.test(corpoReset) && /html: email\.html/.test(corpoReset));
  atteso("il link e il token non finiscono nel log né nella risposta", ![...corpoReset.matchAll(/console\.(error|log|warn)\([^)]*\)/g)].some((m) => /\b(url|token|casuale|link\b)/.test(m[0].replace(/"[^"]*"/g, ""))) && !/return \{[^}]*\burl\b/.test(corpoReset));
  atteso("se l'email non parte lo dice (e si può rinviare)", /l'email NON è partita: premi di nuovo/.test(corpoReset));
  atteso("registra quando è stato richiesto il reset", /reset_richiesto_il: new Date\(\)\.toISOString\(\)/.test(corpoReset));
  const consolePassword: string[] = [];
  const cerca = (dir: string) => {
    for (const voce of fs.readdirSync(path.join(__dirname, "..", dir), { withFileTypes: true })) {
      const relativo = `${dir}/${voce.name}`;
      if (voce.isDirectory()) cerca(relativo);
      else if (/\.(ts|tsx)$/.test(voce.name)) {
        const t = leggi(relativo);
        for (const m of t.matchAll(/(updateUserById|updateUser|createUser)\(([^)]*)\)/g)) if (/password/.test(m[2])) consolePassword.push(`${relativo}: ${m[1]}`);
      }
    }
  };
  cerca("src/app/site-console");
  cerca("src/lib/console");
  // I soli punti della console che scrivono una password: crearla (createUser), azzerarla (reset) e la
  // chiusura dell'account (anonimizzazione), che la sostituisce con una casuale e blocca l'accesso:
  // non è un modo di impostare una password conosciuta.
  uguale("la console scrive una password solo in tre punti: creazione, reset e anonimizzazione", consolePassword.sort(), [
    "src/app/site-console/azioni/utenti-console.ts: createUser",
    "src/app/site-console/azioni/utenti-console.ts: updateUserById",
    "src/app/site-console/azioni/utenti.ts: updateUserById",
  ]);
  atteso(
    "l'anonimizzazione mette una password casuale e blocca l'account (nessuna password conosciuta)",
    /password: `\$\{randomUUID\(\)\}\$\{randomUUID\(\)\}`,\s*email_confirm: true,\s*ban_duration/.test(leggi("src/app/site-console/azioni/utenti.ts")),
  );
  for (const [file, aspettativa] of [
    ["src/app/actions/omnia-ai-auth.ts", /await segnaPasswordConsegnata\(data\.user\?\.id\);\s*redirect\("\/dashboard\/omnia-ai"\)/],
    ["src/app/actions/omnia-ai-account-settings.ts", /await segnaPasswordConsegnata\(data\.user\?\.id\);\s*return \{ success: "Password aggiornata\." \}/],
    ["src/app/actions/auth.ts", /await segnaPasswordConsegnata\(data\.user\?\.id\);\s*redirect\("\/dashboard"\)/],
  ] as const) {
    atteso(`${file.split("/").pop()}: quando il cliente sceglie la sua password si registra la consegna (solo dopo il successo)`, aspettativa.test(leggi(file)));
  }
  const consegna = leggi("src/lib/omnia-ai-password-consegnata.ts");
  atteso("la consegna si registra una volta sola e solo per gli utenti da console (update con .is(null) sulla tabella degli utenti da console)", /from\("omnia_ai_utenti_console"\)[\s\S]*?\.update\(\{ password_consegnata_il:[\s\S]*?\.eq\("user_id", userId\)[\s\S]*?\.is\("password_consegnata_il", null\)/.test(consegna));
  atteso("non solleva mai errori al cliente (try/catch, tabella assente tollerata)", /try \{/.test(consegna) && /catch \(e\)/.test(consegna) && /42P01/.test(consegna));
  atteso("il codice dell'area cliente non rimanda alla console", !/console\.omniaitalia\.com|CONSOLE_BASE_URL|site-console|lib\/console/.test(consegna));
  const schedaVista = leggi("src/app/site-console/_componenti/scheda-cliente-vista.tsx");
  const pannelloPassword = schedaVista.slice(schedaVista.indexOf("Password del cliente creato dalla console"), schedaVista.indexOf("Accessi ai suoi dati (registro promesso"));
  atteso("scheda: il pannello Password c'è solo per i clienti creati dalla console", /prova\.creatoDaConsole && s\.utente\.ruolo !== "admin"/.test(pannelloPassword));
  atteso("scheda: dopo la consegna non c'è nessun pulsante, solo la spiegazione", /statoPassword === "consegnata"[\s\S]*?return \([\s\S]*?non può più modificarla né azzerarla[\s\S]*?\);\s*\}/.test(pannelloPassword) && pannelloPassword.indexOf("PulsanteAzione") > pannelloPassword.indexOf('statoPassword === "consegnata"'));
  atteso("scheda: la conferma avverte che dopo la scelta non si potrà più modificare", /Dopo che l'avrà scelta, da qui non potrai più modificarla/.test(pannelloPassword));

  console.log("--- Area cliente in prova ---");
  const layout = leggi("src/app/site-omnia-ai/dashboard/omnia-ai/layout.tsx");
  atteso("avviso in cima a ogni pagina per il cliente in prova, con il pulsante verso Abbonamento", /stato\.stato === "prova" && <ProvaAvviso gare=\{stato\.gare\}/.test(layout) && /\/dashboard\/omnia-ai\/abbonamento/.test(layout.slice(layout.indexOf("function ProvaAvviso"), layout.indexOf("export default async function"))));
  atteso("il cliente in prova vede l'area (non la pagina di attivazione): il blocco riguarda solo «cessato»", /if \(stato\.stato === "cessato"\) \{/.test(layout));
  const abb = leggi("src/app/site-omnia-ai/dashboard/omnia-ai/abbonamento/page.tsx");
  atteso("la pagina Abbonamento per chi è in prova spiega i piani e porta al modulo di acquisto", /inProva = stato\.stato === "prova"/.test(abb) && /Scegli il tuo abbonamento/.test(abb) && /una gara si consuma quando parte l'analisi/.test(abb) && /<ActivateSubscriptionForm/.test(abb));
  const cards = leggi("src/components/omnia-ai/status-cards.tsx");
  atteso("la dashboard mostra le gare gratuite al posto delle gare del piano", /Gare gratuite/.test(cards) && /gareGratuite \? \(/.test(cards) && /gareGratuite=\{statoAccesso\.stato === "prova"/.test(leggi("src/app/site-omnia-ai/dashboard/omnia-ai/page.tsx")));
  const sezione = leggi("src/app/site-omnia-ai/dashboard/omnia-ai/gare/[id]/extraction-section.tsx");
  atteso("a gare finite, nell'analisi, il cliente in prova trova «Scegli un abbonamento» e non il confronto crediti/piani", /state\.quotaEsaurita && inProva/.test(sezione) && /Scegli un abbonamento/.test(sezione) && /state\.quotaEsaurita && !inProva/.test(sezione) && /inProva=\{statoAccesso\.stato === "prova"\}/.test(leggi("src/app/site-omnia-ai/dashboard/omnia-ai/gare/[id]/page.tsx")));
  atteso("il campanello porta «gare gratuite esaurite» alla pagina Abbonamento", /gare_gratuite_esaurite: "\/dashboard\/omnia-ai\/abbonamento"/.test(leggi("src/components/omnia-ai/notification-bell.tsx")));
  atteso("nessuna accettazione richiesta al primo accesso: si accettano al primo abbonamento (modulo di acquisto con le caselle)", /ConsensiAbbonamento/.test(leggi("src/app/site-omnia-ai/dashboard/omnia-ai/activate-subscription-form.tsx")));
  atteso("l'area cliente e le pagine pubbliche non rimandano alla console", ![layout, abb, cards, sezione, leggi("src/lib/omnia-ai-gare-gratuite.ts")].some((t) => /console\.omniaitalia\.com|CONSOLE_BASE_URL|site-console|lib\/console/.test(t)));

  console.log("");
  if (fallimenti.length > 0) {
    console.error(`${fallimenti.length} controlli falliti:\n - ${fallimenti.join("\n - ")}`);
    process.exit(1);
  }
  console.log("Tutti i controlli sono andati a buon fine.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
