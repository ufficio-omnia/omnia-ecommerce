// Autotest delle GARE IN OMAGGIO di OMNIA AI (migrazione 0131): dalla console si regalano a un cliente N gare in
// più rispetto al piano, valide dal giorno X al giorno Y (Roma, compresi). Si prova: il controllo del modulo, lo
// stato di un omaggio, la somma degli omaggi in corso, il punto unico che decide le gare di un abbonamento (con un
// finto database: ogni errore vale 0 gare in più, mai un blocco), la migrazione e i collegamenti della console.
// Gratuito, nessun database né rete: gira nel livello 1, quindi in prebuild.
import fs from "fs";
import path from "path";
import { GARE_OMAGGIO_MAX, gareOmaggioInCorso, giornoValido, statoOmaggio, testoGareOmaggio, validaNuovoOmaggio } from "../src/lib/omnia-ai-gare-omaggio-calcoli";
import { gareInclusePerAbbonamento } from "../src/lib/omnia-ai-pilot";

const fallimenti: string[] = [];
function atteso(nome: string, ok: boolean, dettaglio = "") {
  console.log(`${ok ? "ok    " : "FALLITO"} ${nome}${ok ? "" : ` — ${dettaglio}`}`);
  if (!ok) fallimenti.push(nome);
}
function uguale<T>(nome: string, ottenuto: T, previsto: T) {
  atteso(nome, JSON.stringify(ottenuto) === JSON.stringify(previsto), `ottenuto ${JSON.stringify(ottenuto)}, previsto ${JSON.stringify(previsto)}`);
}
const leggi = (relativo: string) => fs.readFileSync(path.join(__dirname, "..", relativo), "utf-8").replace(/\r\n/g, "\n");

const OGGI = "2026-11-18";

async function main() {
  console.log("--- Il modulo della console ---");
  const valida = (c: Partial<{ gare: string; dal: string; al: string; motivo: string }>) => validaNuovoOmaggio({ gare: "1", dal: OGGI, al: "2026-12-31", motivo: "", ...c }, OGGI);
  const errore = (c: Parameters<typeof valida>[0]) => {
    const r = valida(c);
    return r.ok ? null : r.errore;
  };
  uguale("caso tipico: 1 gara dal 18/11 al 31/12", valida({}), { ok: true, valori: { gare: 1, dal: OGGI, al: "2026-12-31", motivo: null } });
  uguale("«dal» vuoto vale oggi", (valida({ dal: "" }) as { valori: { dal: string } }).valori.dal, OGGI);
  uguale("un solo giorno (dal = al) va bene", valida({ al: OGGI }).ok, true);
  atteso("gare 0, negative, decimali, vuote o oltre il massimo: rifiutate", ["0", "-1", "1.5", "", "abc", String(GARE_OMAGGIO_MAX + 1)].every((g) => errore({ gare: g }) !== null));
  uguale("il massimo è accettato", valida({ gare: String(GARE_OMAGGIO_MAX) }).ok, true);
  atteso("inizio nel passato: rifiutato", /passato/.test(errore({ dal: "2026-11-17" }) ?? ""));
  atteso("fine prima dell'inizio: rifiutata", /prima di quella di inizio/.test(errore({ dal: "2026-12-10", al: "2026-12-01" }) ?? ""));
  atteso("fine mancante o non valida: rifiutata", errore({ al: "" }) !== null && errore({ al: "2026-02-30" }) !== null && errore({ al: "31/12/2026" }) !== null);
  atteso("più di due anni: rifiutato", /due anni/.test(errore({ al: "2028-12-31" }) ?? ""));
  uguale("il motivo si ripulisce e si taglia a 300 caratteri", (valida({ motivo: `  ${"x".repeat(400)}  ` }) as { valori: { motivo: string } }).valori.motivo.length, 300);
  atteso("giorni di calendario: 2028-02-29 sì, 2026-02-29 no", giornoValido("2028-02-29") && !giornoValido("2026-02-29"));

  console.log("--- Stato e somma degli omaggi ---");
  const o = (dal: string, al: string, gare: unknown = 1, revocato_il: string | null = null) => ({ dal, al, gare, revocato_il });
  uguale("stati: programmato / in corso (anche agli estremi) / concluso / revocato", [
    statoOmaggio(o("2026-11-19", "2026-11-30"), OGGI),
    statoOmaggio(o(OGGI, OGGI), OGGI),
    statoOmaggio(o("2026-11-01", OGGI), OGGI),
    statoOmaggio(o("2026-11-01", "2026-11-17"), OGGI),
    statoOmaggio(o("2026-11-01", "2026-12-31", 1, "2026-11-10T09:00:00Z"), OGGI),
  ], ["programmato", "in_corso", "in_corso", "concluso", "revocato"]);
  uguale("si sommano solo gli omaggi in corso", gareOmaggioInCorso([o("2026-11-01", "2026-12-31", 1), o(OGGI, OGGI, 2), o("2026-11-19", "2026-12-31", 5), o("2026-10-01", "2026-11-17", 5), o("2026-11-01", "2026-12-31", 4, "2026-11-10T09:00:00Z")], OGGI), 3);
  uguale("righe strane non regalano nulla", gareOmaggioInCorso([o("2026-11-01", "2026-12-31", "3"), o("2026-11-01", "2026-12-31", 0), o("2026-11-01", "2026-12-31", 1.5), o("boh", "2026-12-31", 2)], OGGI), 0);
  uguale("nessuna riga: 0", [gareOmaggioInCorso(null, OGGI), gareOmaggioInCorso([], OGGI)], [0, 0]);
  uguale("testi", [testoGareOmaggio(1), testoGareOmaggio(2)], ["1 gara in più", "2 gare in più"]);

  console.log("--- Il punto unico delle gare di un abbonamento (finto database) ---");
  type Risposta = { data: unknown; error: { code?: string; message?: string } | null };
  function finto(omaggi: Risposta, pilot: Risposta = { data: null, error: null }) {
    const tabelle: string[] = [];
    const admin = {
      from: (tabella: string) => {
        tabelle.push(tabella);
        const risposta = tabella === "omnia_ai_gare_omaggio" ? omaggi : pilot;
        const catena: Record<string, unknown> = {};
        for (const metodo of ["select", "eq", "not", "order", "limit"]) catena[metodo] = () => catena;
        catena.maybeSingle = async () => risposta;
        catena.then = (ok: (r: Risposta) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(risposta).then(ok, ko);
        return catena;
      },
    };
    return { admin: admin as unknown as Parameters<typeof gareInclusePerAbbonamento>[0]["admin"], tabelle };
  }
  const ADESSO = new Date("2026-11-18T10:00:00Z");
  const gare = async (omaggi: Risposta, p: Partial<{ piano: string | null; stripeSubscriptionId: string | null; adesso: Date }> = {}) => {
    const f = finto(omaggi);
    return gareInclusePerAbbonamento({ userId: "u1", piano: "starter", stripeSubscriptionId: "sub_AAA", adesso: ADESSO, ...p, admin: f.admin });
  };
  const riga = (dal: string, al: string, g = 1, revocato_il: string | null = null) => ({ gare: g, dal, al, revocato_il });
  uguale("Starter (3) + 1 in omaggio in corso = 4", await gare({ data: [riga("2026-11-01", "2026-11-30")], error: null }), 4);
  uguale("anche senza abbonamento Stripe (abbonamento a mano)", await gare({ data: [riga("2026-11-01", "2026-11-30", 2)], error: null }, { stripeSubscriptionId: null }), 5);
  uguale("omaggio concluso: 3", await gare({ data: [riga("2026-11-01", "2026-11-30")], error: null }, { adesso: new Date("2026-12-01T10:00:00Z") }), 3);
  uguale("l'ultimo giorno si conta il giorno di Roma (23:30 UTC del 30/11 è già il 1/12 a Roma): 3", await gare({ data: [riga("2026-11-01", "2026-11-30")], error: null }, { adesso: new Date("2026-11-30T23:30:00Z") }), 3);
  uguale("omaggio revocato: 3", await gare({ data: [riga("2026-11-01", "2026-11-30", 1, "2026-11-10T00:00:00Z")], error: null }), 3);
  uguale("tabella assente (migrazione 0131 non eseguita): 3, nessun blocco", await gare({ data: null, error: { code: "42P01", message: "relation does not exist" } }), 3);
  uguale("errore qualunque: 3, mai un blocco", await gare({ data: null, error: { code: "XX000", message: "boom" } }), 3);
  uguale("piano non riconosciuto: 0 anche con un omaggio (l'omaggio è «in più rispetto al piano»)", await gare({ data: [riga("2026-11-01", "2026-11-30")], error: null }, { piano: "gold" }), 0);
  {
    const f = finto({ data: [riga("2026-11-01", "2026-11-30")], error: null });
    await gareInclusePerAbbonamento({ userId: "u1", piano: "starter", stripeSubscriptionId: null, adesso: ADESSO, admin: f.admin });
    uguale("si legge solo la tabella degli omaggi, e una volta sola", f.tabelle, ["omnia_ai_gare_omaggio"]);
  }

  console.log("--- Migrazione 0131 ---");
  const sql = leggi("supabase/migrations/0131_omnia_ai_gare_omaggio.sql").split("\n").filter((r) => !r.trimStart().startsWith("--")).join("\n");
  atteso("crea la tabella solo se manca", /create table if not exists public\.omnia_ai_gare_omaggio/.test(sql));
  atteso("limiti nel database uguali a quelli del codice (gare 1–20, al ≥ dal)", /check \(gare between 1 and 20\)/.test(sql) && GARE_OMAGGIO_MAX === 20 && /check \(al >= dal\)/.test(sql));
  atteso("RLS attiva e permessi solo alla chiave di servizio", /enable row level security/.test(sql) && /grant select, insert, update on public\.omnia_ai_gare_omaggio to service_role/.test(sql) && !/\b(anon|authenticated|create policy)\b/.test(sql));
  atteso("nessun dato toccato, nessuna cancellazione", !/\b(update\s+public\.|delete\s+from|truncate|drop\s+(table|column)|insert\s+into)\b/i.test(sql));

  console.log("--- Collegamenti ---");
  const pilotLib = leggi("src/lib/omnia-ai-pilot.ts");
  const corpo = pilotLib.slice(pilotLib.indexOf("export async function gareInclusePerAbbonamento"), pilotLib.indexOf("// ───── Acquisto: dal webhook Stripe"));
  atteso("il punto unico somma gli omaggi in corso a piano/pilot", /leggiGareOmaggioInCorso\(params\.userId, adesso, params\.admin\)/.test(corpo) && /\+ omaggio;/.test(corpo));
  const azioni = leggi("src/app/site-console/azioni/gare-omaggio.ts");
  atteso("ogni azione della console parte dal controllo dell'amministratore", (azioni.match(/export async function/g) ?? []).length === (azioni.match(/await richiediAdminAzione\(\)/g) ?? []).length);
  atteso("l'azione usa lo stesso controllo provato qui e rifiuta l'Ufficio Gare", /validaNuovoOmaggio\(/.test(azioni) && /leggiTitolareDelMembro\(/.test(azioni) && /role !== "cliente"/.test(azioni));
  atteso("la revoca non tocca un omaggio già concluso o revocato", /\.is\("revocato_il", null\)/.test(azioni) && /\.gte\("al", /.test(azioni));
  atteso("un omaggio non si cancella (solo revoca)", !/\.delete\(/.test(azioni));
  const scheda = leggi("src/app/site-console/_componenti/scheda-cliente-vista.tsx");
  atteso("la scheda cliente ha il riquadro con modulo e revoca", /titolo="Gare in omaggio"/.test(scheda) && /azione=\{regalaGareOmaggio\}/.test(scheda) && /azione=\{revocaGareOmaggio\}/.test(scheda));
  atteso("la pagina della scheda legge gli omaggi", /leggiOmaggiCliente\(id\)/.test(leggi("src/app/site-console/(app)/utenti/[id]/page.tsx")));

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
