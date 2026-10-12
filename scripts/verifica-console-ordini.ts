// Autotest della console: giorni lavorativi e scadenza dei bonifici, e conferma
// di un bonifico. Gratuito, nessun database né rete (un client Supabase finto
// registra le chiamate): gira nel livello 1, quindi in prebuild.
import fs from "fs";
import path from "path";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  aggiungiGiorniLavorativi,
  contaGiorniLavorativi,
  dataRoma,
  eGiornoLavorativo,
  scadenzaBonifico,
} from "../src/lib/console/giorni-lavorativi";
import { causaleOrdine, confermaPagamentoBonifico, filtraOrdini, type RigaOrdine } from "../src/lib/console/ordini";

const fallimenti: string[] = [];
function atteso(nome: string, ok: boolean, dettaglio = "") {
  console.log(`${ok ? "ok    " : "FALLITO"} ${nome}${ok ? "" : ` — ${dettaglio}`}`);
  if (!ok) fallimenti.push(nome);
}
function uguale<T>(nome: string, ottenuto: T, previsto: T) {
  atteso(nome, JSON.stringify(ottenuto) === JSON.stringify(previsto), `ottenuto ${JSON.stringify(ottenuto)}, previsto ${JSON.stringify(previsto)}`);
}

console.log("--- Embed tra ordini e utenti ---");
// orders ha due chiavi verso users (user_id e, se presente, paid_by): un select
// con users(email) senza suggerimento fallisce con PGRST201 ("more than one
// relationship"). Ogni embed deve scrivere users!user_id(...). Difetto reale, già
// capitato: dopo la migrazione 0075 il vecchio pannello admin mostrava zero ordini.
function fileSorgente(cartella: string): string[] {
  return fs.readdirSync(cartella, { withFileTypes: true }).flatMap((voce) => {
    const percorso = path.join(cartella, voce.name);
    if (voce.isDirectory()) return fileSorgente(percorso);
    return /\.(ts|tsx)$/.test(voce.name) ? [percorso] : [];
  });
}
const senzaSuggerimento = fileSorgente(path.join(__dirname, "..", "src")).filter((f) => /[\s,"'`]users\(/.test(fs.readFileSync(f, "utf-8")));
atteso(
  "nessun select incrocia orders e users senza indicare la chiave (users!user_id)",
  senzaSuggerimento.length === 0,
  senzaSuggerimento.map((f) => path.relative(path.join(__dirname, ".."), f)).join(", "),
);

console.log("--- Giorni lavorativi ---");
uguale("sabato e domenica non sono lavorativi", [eGiornoLavorativo("2026-10-10"), eGiornoLavorativo("2026-10-11")], [false, false]);
uguale("un lunedì qualunque è lavorativo", eGiornoLavorativo("2026-10-12"), true);
uguale("festività fisse: 1 maggio, 2 giugno, 8 dicembre, 26 dicembre", ["2026-05-01", "2026-06-02", "2026-12-08", "2026-12-26"].map(eGiornoLavorativo), [false, false, false, false]);
uguale("il 25 aprile 2026 è un sabato: il lunedì dopo è lavorativo", eGiornoLavorativo("2026-04-27"), true);
uguale("lunedì dell'Angelo 2026 (Pasqua il 5 aprile)", eGiornoLavorativo("2026-04-06"), false);
uguale("lunedì dell'Angelo 2027 (Pasqua il 28 marzo)", eGiornoLavorativo("2027-03-29"), false);
uguale("sette giorni lavorativi dopo lunedì 5 ottobre 2026 = mercoledì 14", aggiungiGiorniLavorativi("2026-10-05", 7), "2026-10-14");
uguale("con l'8 dicembre in mezzo: 7 gg lav. dopo venerdì 4 dicembre 2026 = mercoledì 16", aggiungiGiorniLavorativi("2026-12-04", 7), "2026-12-16");
uguale("con il lunedì dell'Angelo in mezzo: 3 gg lav. dopo giovedì 2 aprile 2026 = mercoledì 8", aggiungiGiorniLavorativi("2026-04-02", 3), "2026-04-08");
uguale("un ordine del sabato parte dal lunedì: 1 g lav. dopo sabato 10 ottobre = lunedì 12", aggiungiGiorniLavorativi("2026-10-10", 1), "2026-10-12");
uguale("conteggio venerdì → lunedì = 1", contaGiorniLavorativi("2026-10-09", "2026-10-12"), 1);
uguale("conteggio all'indietro = -1", contaGiorniLavorativi("2026-10-12", "2026-10-09"), -1);
uguale("conteggio dello stesso giorno = 0", contaGiorniLavorativi("2026-10-12", "2026-10-12"), 0);
uguale("conteggio venerdì → sabato = 0 (non -0)", Object.is(contaGiorniLavorativi("2026-10-09", "2026-10-10"), 0), true);

console.log("--- Fuso di Roma ---");
uguale("le 22:30 UTC di un giorno d'ottobre sono già il giorno dopo a Roma (ora legale)", dataRoma(new Date("2026-10-05T22:30:00Z")), "2026-10-06");
uguale("le 23:30 UTC di dicembre sono già il giorno dopo a Roma (ora solare)", dataRoma(new Date("2026-12-07T23:30:00Z")), "2026-12-08");
uguale("le 21:30 UTC d'ottobre sono ancora lo stesso giorno a Roma", dataRoma(new Date("2026-10-05T21:30:00Z")), "2026-10-05");
uguale("ordine alle 00:30 di Roma del 6 ottobre: scade giovedì 15, non mercoledì 14", scadenzaBonifico(new Date("2026-10-05T22:30:00Z"), new Date("2026-10-06T10:00:00Z")).scadenza, "2026-10-15");

console.log("--- Scadenza del bonifico ---");
const ordinato = new Date("2026-10-05T10:00:00Z"); // lunedì
const stato = (oggi: string) => {
  const s = scadenzaBonifico(ordinato, new Date(`${oggi}T10:00:00Z`));
  return [s.stato, s.giorniLavorativi, s.giorniRimasti, s.scadenza];
};
uguale("lo stesso giorno: in tempo, 0 gg trascorsi, 7 rimasti, termine mercoledì 14", stato("2026-10-05"), ["in_tempo", 0, 7, "2026-10-14"]);
uguale("dopo 4 gg lav.: ancora in tempo (3 rimasti)", stato("2026-10-09"), ["in_tempo", 4, 3, "2026-10-14"]);
uguale("lunedì 12: 2 rimasti = in scadenza", stato("2026-10-12"), ["in_scadenza", 5, 2, "2026-10-14"]);
uguale("il giorno del termine: in scadenza, 0 rimasti", stato("2026-10-14"), ["in_scadenza", 7, 0, "2026-10-14"]);
uguale("il giorno dopo: scaduto, -1", stato("2026-10-15"), ["scaduto", 8, -1, "2026-10-14"]);
uguale("sabato dopo il termine: scaduto, 9 gg lav. trascorsi (4 + 5) e -2 rispetto al termine", stato("2026-10-17"), ["scaduto", 9, -2, "2026-10-14"]);
uguale("ordinato di sabato e guardato di domenica: 0 gg lav. trascorsi", [scadenzaBonifico(new Date("2026-10-10T10:00:00Z"), new Date("2026-10-11T10:00:00Z")).giorniLavorativi], [0]);
uguale("la causale è quella delle istruzioni del bonifico", causaleOrdine("1a2b3c4d-1111-2222-3333-444455556666"), "Ordine 1a2b3c4d");

console.log("--- Conferma di un bonifico (client finto) ---");

type Ordine = { id: string; status: string; payment_method: string | null; users: { email: string } | null; products: { title: string } | null };
type Chiamata = { op: "select" | "update"; valori?: Record<string, unknown>; filtri: [string, unknown][] };

function clienteFinto(config: { ordine: Ordine | null; colonneAssenti?: boolean; righeAggiornate?: number }) {
  const chiamate: Chiamata[] = [];
  const client = {
    from() {
      const chiamata: Chiamata = { op: "select", filtri: [] };
      const costruttore = {
        select() {
          return costruttore;
        },
        update(valori: Record<string, unknown>) {
          chiamata.op = "update";
          chiamata.valori = valori;
          return costruttore;
        },
        eq(colonna: string, valore: unknown) {
          chiamata.filtri.push([colonna, valore]);
          return costruttore;
        },
        maybeSingle() {
          chiamate.push(chiamata);
          return Promise.resolve({ data: config.ordine, error: null });
        },
        then(risolvi: (r: unknown) => unknown) {
          chiamate.push(chiamata);
          if (config.colonneAssenti && chiamata.valori && "paid_at" in chiamata.valori) {
            return risolvi({ data: null, error: { code: "PGRST204", message: "Could not find the 'paid_at' column of 'orders' in the schema cache" } });
          }
          const n = config.righeAggiornate ?? 1;
          return risolvi({ data: Array.from({ length: n }, () => ({ id: "x" })), error: null });
        },
      };
      return costruttore;
    },
  };
  return { client: client as unknown as SupabaseClient, chiamate };
}

function emailFinta(esito = true) {
  const inviate: { to: string; subject: string; html: string }[] = [];
  const invia = async (m: { to: string; subject: string; html: string }) => {
    inviate.push(m);
    return esito;
  };
  return { invia, inviate };
}

const ORDINE_BONIFICO: Ordine = { id: "ord-1", status: "in_attesa", payment_method: "bonifico", users: { email: "cliente@example.com" }, products: { title: "Piano <di> lavoro & più" } };
const aggiornamenti = (c: Chiamata[]) => c.filter((x) => x.op === "update");

async function main() {
{
  const { client, chiamate } = clienteFinto({ ordine: ORDINE_BONIFICO });
  const { invia, inviate } = emailFinta();
  const esito = await confermaPagamentoBonifico(client, { orderId: "ord-1", adminId: "admin-1" }, invia);
  atteso("bonifico in attesa: confermato", esito.ok === true && esito.emailInviata === true && esito.dataRegistrata === true, JSON.stringify(esito));
  const u = aggiornamenti(chiamate)[0];
  atteso("registra stato, data e autore della conferma", u?.valori?.status === "pagato" && typeof u.valori.paid_at === "string" && !Number.isNaN(Date.parse(u.valori.paid_at as string)) && u.valori.paid_by === "admin-1", JSON.stringify(u?.valori));
  atteso("l'aggiornamento è condizionato a id E a stato 'in_attesa' (niente doppia conferma)", JSON.stringify(u?.filtri) === JSON.stringify([["id", "ord-1"], ["status", "in_attesa"]]), JSON.stringify(u?.filtri));
  atteso("una sola email, al cliente", inviate.length === 1 && inviate[0].to === "cliente@example.com", JSON.stringify(inviate.map((e) => e.to)));
  atteso("il titolo del prodotto nell'email è con caratteri speciali neutralizzati", inviate[0].html.includes("Piano &lt;di&gt; lavoro &amp; più") && !inviate[0].html.includes("<di>"), inviate[0].html);
  atteso("l'email rimanda alla dashboard dell'e-commerce", /\/dashboard"/.test(inviate[0].html) && !/console\./.test(inviate[0].html), inviate[0].html);
}
{
  const { client, chiamate } = clienteFinto({ ordine: { ...ORDINE_BONIFICO, status: "pagato" } });
  const { invia, inviate } = emailFinta();
  const esito = await confermaPagamentoBonifico(client, { orderId: "ord-1", adminId: "admin-1" }, invia);
  atteso("ordine già pagato: rifiutato, nessun aggiornamento, nessuna email", esito.ok === false && aggiornamenti(chiamate).length === 0 && inviate.length === 0, JSON.stringify(esito));
}
{
  const { client, chiamate } = clienteFinto({ ordine: { ...ORDINE_BONIFICO, payment_method: "carta" } });
  const { invia, inviate } = emailFinta();
  const esito = await confermaPagamentoBonifico(client, { orderId: "ord-1", adminId: "admin-1" }, invia);
  atteso("ordine con carta: rifiutato, nessun aggiornamento, nessuna email", esito.ok === false && aggiornamenti(chiamate).length === 0 && inviate.length === 0, JSON.stringify(esito));
}
{
  const { client } = clienteFinto({ ordine: null });
  const { invia, inviate } = emailFinta();
  const esito = await confermaPagamentoBonifico(client, { orderId: "ord-1", adminId: "admin-1" }, invia);
  atteso("ordine inesistente: rifiutato", esito.ok === false && inviate.length === 0, JSON.stringify(esito));
}
{
  const { client } = clienteFinto({ ordine: ORDINE_BONIFICO, righeAggiornate: 0 });
  const { invia, inviate } = emailFinta();
  const esito = await confermaPagamentoBonifico(client, { orderId: "ord-1", adminId: "admin-1" }, invia);
  atteso("conferma contemporanea da un'altra scheda (0 righe aggiornate): rifiutata, nessuna email doppia", esito.ok === false && inviate.length === 0, JSON.stringify(esito));
}
{
  const { client, chiamate } = clienteFinto({ ordine: ORDINE_BONIFICO, colonneAssenti: true });
  const { invia, inviate } = emailFinta();
  const esito = await confermaPagamentoBonifico(client, { orderId: "ord-1", adminId: "admin-1" }, invia);
  const aggiorn = aggiornamenti(chiamate);
  atteso("migrazione 0075 non eseguita: si conferma lo stesso, dichiarando che la data non è registrata", esito.ok === true && esito.dataRegistrata === false && inviate.length === 1, JSON.stringify(esito));
  atteso("il secondo tentativo scrive solo lo stato, con gli stessi filtri", aggiorn.length === 2 && JSON.stringify(aggiorn[1].valori) === JSON.stringify({ status: "pagato" }) && JSON.stringify(aggiorn[1].filtri) === JSON.stringify([["id", "ord-1"], ["status", "in_attesa"]]), JSON.stringify(aggiorn.map((a) => a.valori)));
}
{
  const { client } = clienteFinto({ ordine: ORDINE_BONIFICO });
  const { invia } = emailFinta(false);
  const esito = await confermaPagamentoBonifico(client, { orderId: "ord-1", adminId: "admin-1" }, invia);
  atteso("email non partita: l'ordine è comunque confermato e l'esito lo dice", esito.ok === true && esito.emailInviata === false, JSON.stringify(esito));
}

console.log("--- Filtro dell'elenco ordini ---");
const riga = (id: string, stato: RigaOrdine["stato"], email: string, prodotto: string): RigaOrdine => ({
  id,
  userId: "u",
  email,
  prodotto,
  stato,
  metodo: "bonifico",
  importo: 10,
  creatoIl: "2026-10-01T10:00:00Z",
  pagatoIl: null,
  fatturaCaricata: false,
});
const elenco = [riga("aaaa1111-0", "pagato", "mario@example.com", "Piano di lavoro"), riga("bbbb2222-0", "in_attesa", "Anna@Example.com", "Organigramma")];
uguale("filtro 'pagato'", filtraOrdini(elenco, "pagato", "").map((r) => r.id), ["aaaa1111-0"]);
uguale("filtro 'in attesa'", filtraOrdini(elenco, "in_attesa", "").map((r) => r.id), ["bbbb2222-0"]);
uguale("ricerca per email senza badare alle maiuscole", filtraOrdini(elenco, "tutti", "anna@").map((r) => r.id), ["bbbb2222-0"]);
uguale("ricerca per inizio dell'id ordine", filtraOrdini(elenco, "tutti", "aaaa").map((r) => r.id), ["aaaa1111-0"]);
uguale("ricerca per prodotto", filtraOrdini(elenco, "tutti", "organigr").map((r) => r.id), ["bbbb2222-0"]);
uguale("stato e testo insieme", filtraOrdini(elenco, "pagato", "anna").map((r) => r.id), []);

if (fallimenti.length > 0) {
  console.error(`\n${fallimenti.length} controllo/i fallito/i:\n- ${fallimenti.join("\n- ")}`);
  process.exit(1);
}
console.log("\nAutotest della console (ordini e bonifici): tutti i casi ok.");
}

main().catch((errore) => {
  console.error(errore);
  process.exit(1);
});
