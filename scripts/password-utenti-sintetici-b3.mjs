// Password SINTETICHE per l'accesso online alla Preview di Tender Intelligence (scelta A + B dell'utente, 18/11/2026): due password
// casuali per i SOLI titolari di prova già esistenti dello STAGING, per entrare dal normale modulo «Accedi» di OMNIA AI. Nessun accesso
// alternativo, nessuna email, nessun token. La console resta collaudata in locale. Scrive sullo staging (password di 2 utenti): parte SOLO
// con un'autorizzazione registrata del coordinatore, lanciato da esegui-autorizzato.mjs.
//
//   node scripts/password-utenti-sintetici-b3.mjs imposta <file delle variabili> [--file <percorso>]   → due password nuove, scritte nel file
//   node scripts/password-utenti-sintetici-b3.mjs ruota   <file delle variabili> [--file <percorso>]   → sostituite con altre nuove, stesso file
//   node scripts/password-utenti-sintetici-b3.mjs ruota   <file delle variabili> --scarta              → sostituite con altre casuali che non si
//                                                                                                         salvano da nessuna parte; file cancellato
//
// In ordine, fermandosi al primo problema PRIMA di qualunque scrittura:
//   1. porta delle autorizzazioni (TI_REGISTRO, controllaPorta);
//   2. guardia dello staging (file delle variabili fuori dal repository, SOLO lo staging, nessun riferimento alla produzione);
//   3. file delle credenziali FUORI dal progetto e da qualunque repository git (di base nella cartella personale), creato vuoto e con permessi
//      ristretti al solo utente PRIMA di scriverci;
//   4. i due utenti cercati per email esatta con l'API di amministrazione (solo lettura); se ne manca uno, nessuna scrittura;
//   5. per ciascuno SOLO updateUserById(id, { password }): né email, né metadati, né ruoli;
//   6. le password vanno SOLO nel file: a schermo solo il percorso e gli id abbreviati, mai una password.
// Le prove sono solo a secco (verifica-password-utenti-sintetici-b3.ts), con un'API finta: mai contro lo staging.
import { spawnSync } from "node:child_process";
import { randomBytes, randomInt } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { Fermo, STAGING_URL, dentro, erroriAmbiente, leggiVariabili } from "./collaudo-accesso-b3.mjs";

export const NOME_SCRIPT = "password-utenti-sintetici-b3.mjs";
export const UTENTI_SINTETICI = ["ti-titolare@prova.test", "ti-titolare2@prova.test"];
export const LUNGHEZZA_PASSWORD = 24;
export const FILE_PREDEFINITO = path.join(os.homedir(), "OMNIA-credenziali-anteprima", "utenti-sintetici-preview.txt");

const MINUSCOLE = "abcdefghijkmnopqrstuvwxyz";
const MAIUSCOLE = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const CIFRE = "23456789";
const SIMBOLI = "-_.!";

/** Una password casuale di 24 caratteri (crypto.randomBytes), con almeno una minuscola, una maiuscola, una cifra e un simbolo. */
export function generaPassword() {
  const caratteri = randomBytes(LUNGHEZZA_PASSWORD).toString("base64url").slice(0, LUNGHEZZA_PASSWORD).split("");
  const posizioni = new Set();
  while (posizioni.size < 4) posizioni.add(randomInt(LUNGHEZZA_PASSWORD));
  const classi = [MINUSCOLE, MAIUSCOLE, CIFRE, SIMBOLI];
  [...posizioni].forEach((p, i) => (caratteri[p] = classi[i][randomInt(classi[i].length)]));
  return caratteri.join("");
}

export const idBreve = (id) => `${String(id).slice(0, 8)}…`;

/** true se `cartella` o una delle cartelle sopra contiene un repository git. */
export function dentroUnRepository(cartella) {
  let c = path.resolve(cartella);
  for (;;) {
    if (fs.existsSync(path.join(c, ".git"))) return true;
    const su = path.dirname(c);
    if (su === c) return false;
    c = su;
  }
}

/** Permessi del file ristretti al solo utente che esegue (Windows: icacls senza ereditarietà; altrove: 600). */
export function restringiPermessi(file) {
  if (process.platform === "win32") {
    const utente = `${process.env.USERDOMAIN ? `${process.env.USERDOMAIN}\\` : ""}${os.userInfo().username}`;
    const r = spawnSync("icacls", [file, "/inheritance:r", "/grant:r", `${utente}:F`], { encoding: "utf8" });
    if (r.status !== 0) throw new Fermo("permessi del file delle credenziali non ristretti: nessuna password scritta");
  } else {
    fs.chmodSync(file, 0o600);
  }
}

export const INTESTAZIONE_FILE = "OMNIA Tender Intelligence — credenziali SINTETICHE della Preview (solo staging, solo utenti di prova)";

function testoFile({ righe, stato, autorizzazione, comandoRotazione }) {
  return [
    INTESTAZIONE_FILE,
    `Stato: ${stato}`,
    `Data: ${new Date().toISOString()}${autorizzazione ? ` · autorizzazione ${autorizzazione}` : ""}`,
    "Accesso dal normale modulo «Accedi» di OMNIA AI sulla Preview protetta. NON copiare in chat, email, documenti o git.",
    "",
    ...righe,
    "",
    `A fine collaudo, rotazione (con una nuova autorizzazione): ${comandoRotazione}`,
    "",
  ].join("\n");
}

function argomenti(argv) {
  const [comando, fileVariabili, ...resto] = argv;
  let file = null;
  let scarta = false;
  for (let i = 0; i < resto.length; i++) {
    if (resto[i] === "--scarta") scarta = true;
    else if (resto[i] === "--file") file = resto[++i] ?? null;
    else throw new Fermo(`argomento sconosciuto: ${resto[i]}`);
  }
  if (comando !== "imposta" && comando !== "ruota") throw new Fermo("comando: imposta | ruota");
  if (scarta && comando !== "ruota") throw new Fermo("--scarta vale solo con «ruota»");
  return { comando, fileVariabili, file: file ?? FILE_PREDEFINITO, scarta };
}

/** L'esecuzione. Iniettabili per le prove a secco: controllaPorta, fetchFn, cartella, restringi, dentroRepo, scrivi. */
export async function esegui(argv, env, opzioni = {}) {
  const cartella = opzioni.cartella ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const { comando, fileVariabili, file, scarta } = argomenti(argv);
  const stampa = opzioni.stampa ?? ((r) => console.log(r));

  // 1. porta delle autorizzazioni
  let controllaPorta = opzioni.controllaPorta;
  if (!controllaPorta) {
    if (!env.TI_REGISTRO) throw new Fermo("lanciare con esegui-autorizzato.mjs (autorizzazione registrata del coordinatore)");
    ({ controllaPorta } = await import(pathToFileURL(path.join(env.TI_REGISTRO, "registro.mjs")).href));
  }
  let porta;
  try {
    porta = controllaPorta({ script: NOME_SCRIPT });
  } catch (e) {
    throw new Fermo(e instanceof Error ? e.message : String(e));
  }

  // 2. guardia dello staging
  if (!fileVariabili || !fs.existsSync(fileVariabili)) throw new Fermo("file delle variabili mancante");
  if (dentro(fileVariabili, cartella)) throw new Fermo("il file delle variabili deve stare FUORI dalla cartella del progetto");
  const variabili = leggiVariabili(fs.readFileSync(fileVariabili, "utf8"));
  const errori = erroriAmbiente(variabili);
  if (errori.length) throw new Fermo(`ambiente non autorizzato: ${errori.join("; ")}`);

  // 3. file delle credenziali: fuori dal progetto e da qualunque repository, permessi ristretti prima di scriverci
  const dentroRepo = opzioni.dentroRepo ?? dentroUnRepository;
  const restringi = opzioni.restringi ?? restringiPermessi;
  if (!scarta) {
    if (dentro(file, cartella) || dentroRepo(path.dirname(file))) throw new Fermo("il file delle credenziali deve stare FUORI da qualunque repository");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "", { mode: 0o600 });
    restringi(file);
  }

  // 4. i due utenti, per email esatta (sola lettura)
  const admin = createClient(STAGING_URL, variabili.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: opzioni.fetchFn ?? fetch },
  });
  const { data: elenco, error: erroreElenco } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (erroreElenco) throw new Fermo(`elenco degli utenti non letto (${erroreElenco.status ?? "errore"})`);
  const utenti = UTENTI_SINTETICI.map((email) => {
    const trovati = (elenco?.users ?? []).filter((u) => String(u.email ?? "").toLowerCase() === email);
    if (trovati.length !== 1) throw new Fermo(`utente ${email} non trovato (o non univoco): nessuna password cambiata`);
    return { email, id: trovati[0].id };
  });

  // 5–6. password nuove: prima nel file (già ristretto), poi sullo staging; a schermo mai una password
  const nuove = utenti.map((u) => ({ ...u, password: generaPassword() }));
  const comandoRotazione = `node scripts/${NOME_SCRIPT} ruota <file delle variabili>${file === FILE_PREDEFINITO ? "" : ` --file ${file}`}  (oppure: ruota <file delle variabili> --scarta)`;
  const scrivi = opzioni.scrivi ?? ((testo) => fs.writeFileSync(file, testo, { mode: 0o600 }));
  const righe = (stati) => nuove.map((u, i) => `${u.email}  ${u.password}  (${stati[i]})`);
  if (!scarta) scrivi(testoFile({ righe: righe(nuove.map(() => "in aggiornamento")), stato: "in aggiornamento", autorizzazione: porta?.id, comandoRotazione }));
  const esiti = [];
  for (const u of nuove) {
    const { error } = await admin.auth.admin.updateUserById(u.id, { password: u.password });
    esiti.push(error ? `NON aggiornata (${error.status ?? "errore"})` : "attiva");
    stampa(`${u.email} (${idBreve(u.id)}): password ${error ? `NON aggiornata (${error.status ?? "errore"})` : comando === "imposta" ? "impostata" : "ruotata"}`);
    if (error) break;
  }
  while (esiti.length < nuove.length) esiti.push("non toccata");
  const tutte = esiti.every((e) => e === "attiva");
  if (scarta) {
    // si cancella solo un file di credenziali di questo strumento, mai un file qualunque
    if (fs.existsSync(file) && fs.readFileSync(file, "utf8").startsWith(INTESTAZIONE_FILE)) fs.rmSync(file, { force: true });
    stampa(`Password sostituite con valori casuali NON salvati da nessuna parte; file delle credenziali ${fs.existsSync(file) ? "NON cancellato (non è un file di questo strumento)" : "assente o cancellato"} (${file}).`);
  } else {
    scrivi(testoFile({ righe: righe(esiti), stato: tutte ? "attive" : "INCOMPLETO: vedi le righe", autorizzazione: porta?.id, comandoRotazione }));
    stampa(`Credenziali nel file ${file} (permessi ristretti al solo utente). Nessuna password stampata.`);
  }
  if (!tutte) throw new Fermo("aggiornamento incompleto: vedi le righe sopra (nessuna password stampata)");
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  esegui(process.argv.slice(2), process.env)
    .then((codice) => process.exit(codice))
    .catch((e) => {
      console.error(`FERMATO: ${e instanceof Error ? e.message : e}`);
      process.exit(2);
    });
}
