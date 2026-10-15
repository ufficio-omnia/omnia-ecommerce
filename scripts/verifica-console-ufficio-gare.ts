// Autotest dell'Ufficio Gare nella console (blocco 4):
//   - l'elenco utenti e i conteggi: un Ufficio Gare non è un cliente a sé e lo si vede legato al suo titolare;
//   - la lettura del legame (scheda cliente, controlli delle azioni): un errore non diventa mai «nessun legame»;
//   - le azioni: niente abbonamento a mano né gare gratuite a un Ufficio Gare; eliminando o anonimizzando un titolare
//     si elimina anche il suo Ufficio Gare, e solo DOPO che il titolare è stato eliminato;
//   - le viste dell'elenco e della scheda.
// Gratuito, nessun database né rete: gira nel livello 1, quindi in prebuild.
import fs from "fs";
import path from "path";
import { conteggiPerTipo, costruisciRigheUtenti, filtraUtenti, type DatiElencoUtenti } from "../src/lib/console/utenti-calcoli";
import { MESSAGGIO_E_UN_UFFICIO_GARE, leggiLegameUfficioGare, leggiMembroDelTitolare, leggiTitolareDelMembro } from "../src/lib/console/ufficio-gare";

const fallimenti: string[] = [];
function atteso(nome: string, ok: boolean, dettaglio = "") {
  console.log(`${ok ? "ok    " : "FALLITO"} ${nome}${ok ? "" : ` — ${dettaglio}`}`);
  if (!ok) fallimenti.push(nome);
}
function uguale<T>(nome: string, ottenuto: T, previsto: T) {
  atteso(nome, JSON.stringify(ottenuto) === JSON.stringify(previsto), `ottenuto ${JSON.stringify(ottenuto)}, previsto ${JSON.stringify(previsto)}`);
}
const leggi = (relativo: string) => fs.readFileSync(path.join(__dirname, "..", relativo), "utf-8").replace(/\r\n/g, "\n");
const funzione = (sorgente: string, nome: string) => {
  const i = sorgente.indexOf(`export async function ${nome}(`);
  const j = sorgente.indexOf("export async function ", i + 10);
  return sorgente.slice(i, j === -1 ? sorgente.length : j);
};

const ADESSO = new Date("2026-10-16T10:00:00Z");
const T = "11111111-1111-4111-8111-111111111111"; // titolare con azienda
const M = "22222222-2222-4222-8222-222222222222"; // il suo Ufficio Gare
const T2 = "33333333-3333-4333-8333-333333333333"; // titolare senza azienda
const M2 = "44444444-4444-4444-8444-444444444444"; // il suo Ufficio Gare (sospeso)
const V = "55555555-5555-4555-8555-555555555555"; // utente vuoto

const dati: DatiElencoUtenti = {
  utenti: [
    { id: T, email: "titolare@azienda.it", role: "cliente", created_at: "2026-09-01T00:00:00Z" },
    { id: M, email: "gare@azienda.it", role: "cliente", created_at: "2026-09-02T00:00:00Z" },
    { id: T2, email: "titolare2@altra.it", role: "cliente", created_at: "2026-09-03T00:00:00Z" },
    { id: M2, email: "gare2@altra.it", role: "cliente", created_at: "2026-09-04T00:00:00Z" },
    { id: V, email: "vuoto@x.it", role: "cliente", created_at: "2026-09-05T00:00:00Z" },
  ],
  aziende: [{ user_id: T, ragione_sociale: "Azienda Srl", partita_iva: null, codice_fiscale: null, buyer_type: "azienda" }],
  ordini: [],
  ordiniConAccettazioni: new Set(),
  abbonamenti: [],
  abbonamentiConAccettazioni: new Set(),
  crediti: [],
  messaggi: [],
  accessi: new Map(),
  membri: [
    { membro_id: M, titolare_id: T, attivo: true },
    { membro_id: M2, titolare_id: T2, attivo: false },
  ],
};

async function main() {
  console.log("--- Elenco utenti ---");
  const righe = costruisciRigheUtenti(dati, ADESSO);
  const riga = (id: string) => righe.find((r) => r.id === id)!;
  uguale("l'Ufficio Gare è legato al suo titolare (azienda)", riga(M).ufficioGareDi, { titolareId: T, titolare: "Azienda Srl", attivo: true });
  uguale("se il titolare non ha profilo azienda si usa la sua email", riga(M2).ufficioGareDi, { titolareId: T2, titolare: "titolare2@altra.it", attivo: false });
  uguale("il titolare sa di avere un Ufficio Gare", [riga(T).ufficioGare, riga(T2).ufficioGare], [{ id: M, email: "gare@azienda.it", attivo: true }, { id: M2, email: "gare2@altra.it", attivo: false }]);
  uguale("un Ufficio Gare non ha a sua volta un Ufficio Gare, e un titolare non è l'Ufficio Gare di nessuno", [riga(M).ufficioGare, riga(T).ufficioGareDi], [null, null]);
  uguale("un utente senza legami non ne ha", [riga(V).ufficioGare, riga(V).ufficioGareDi], [null, null]);
  uguale("senza la tabella dei legami (migrazione 0092 non eseguita) nessuno è un Ufficio Gare", costruisciRigheUtenti({ ...dati, membri: undefined }, ADESSO).map((r) => [r.ufficioGare, r.ufficioGareDi]), righe.map(() => [null, null]));
  uguale("un legame verso un titolare che non c'è più mostra l'identificativo, senza rompere l'elenco", costruisciRigheUtenti({ ...dati, utenti: dati.utenti.filter((u) => u.id !== T), aziende: [], membri: [{ membro_id: M, titolare_id: T, attivo: true }] }, ADESSO).find((r) => r.id === M)?.ufficioGareDi, { titolareId: T, titolare: T, attivo: true });

  console.log("--- Filtri e conteggi ---");
  uguale("filtro «Uffici Gare»: solo gli Uffici Gare, non i titolari", filtraUtenti(righe, "ufficio_gare", "").map((r) => r.id), [M, M2]);
  uguale("«Senza attività» non comprende gli Uffici Gare (lavorano) ma comprende chi non fa nulla", filtraUtenti(righe, "senza_attivita", "").map((r) => r.id).sort(), [T, T2, V].sort());
  uguale("conteggi per tipo", conteggiPerTipo(righe), { tutti: 5, ecommerce: 0, omnia_ai: 0, ufficio_gare: 2, da_rispondere: 0, senza_accettazioni: 0, senza_attivita: 3, admin: 0 });
  uguale("la ricerca per azienda trova il titolare", filtraUtenti(righe, "tutti", "azienda srl").map((r) => r.id), [T]);

  console.log("--- Lettura del legame (scheda e controlli) ---");
  type Risposta = { data: unknown; error: { code?: string; message: string } | null };
  function fintoAdmin(opz: { comeMembro?: Risposta; comeTitolare?: Risposta; utenti?: Record<string, { email: string }>; aziende?: Record<string, { ragione_sociale: string | null }>; ultimoAccesso?: string | null }) {
    const chiamate: string[] = [];
    const admin = {
      from: (tabella: string) => {
        let filtro = "";
        const catena = {
          select: (colonne: string) => {
            chiamate.push(`${tabella}.select(${colonne})`);
            return catena;
          },
          eq: (colonna: string, valore: string) => {
            filtro = `${colonna}=${valore}`;
            chiamate.push(`${tabella}.eq(${filtro})`);
            return catena;
          },
          maybeSingle: async (): Promise<Risposta> => {
            if (tabella === "omnia_ai_membri") return (filtro.startsWith("membro_id") ? opz.comeMembro : opz.comeTitolare) ?? { data: null, error: null };
            if (tabella === "users") return { data: opz.utenti?.[filtro.split("=")[1]] ?? null, error: null };
            if (tabella === "companies") return { data: opz.aziende?.[filtro.split("=")[1]] ?? null, error: null };
            throw new Error(`tabella inattesa ${tabella}`);
          },
        };
        return catena;
      },
      auth: { admin: { getUserById: async () => ({ data: { user: { last_sign_in_at: opz.ultimoAccesso ?? null } }, error: null }) } },
    };
    return { chiamate, admin: admin as unknown as Parameters<typeof leggiTitolareDelMembro>[1] };
  }
  const riga0 = { membro_id: M, titolare_id: T, attivo: true, creato_il: "2026-10-10T08:00:00Z", invito_inviato_il: "2026-10-10T08:00:00Z" };
  {
    const { admin } = fintoAdmin({});
    uguale("nessun legame: null", await leggiLegameUfficioGare(V, admin), null);
  }
  {
    const { admin } = fintoAdmin({ comeMembro: { data: riga0, error: null }, utenti: { [T]: { email: "titolare@azienda.it" } }, aziende: { [T]: { ragione_sociale: "Azienda Srl" } } });
    uguale("è un Ufficio Gare: il titolare con azienda ed email", await leggiLegameUfficioGare(M, admin), { ruolo: "ufficio_gare", attivo: true, creatoIl: "2026-10-10T08:00:00Z", titolare: { id: T, email: "titolare@azienda.it", azienda: "Azienda Srl" } });
  }
  {
    const { admin } = fintoAdmin({ comeTitolare: { data: riga0, error: null }, utenti: { [M]: { email: "gare@azienda.it" } }, ultimoAccesso: "2026-10-12T09:00:00Z" });
    uguale("è un titolare: l'Ufficio Gare con stato e ultimo accesso", await leggiLegameUfficioGare(T, admin), { ruolo: "titolare", ufficioGare: { id: M, email: "gare@azienda.it", attivo: true, creatoIl: "2026-10-10T08:00:00Z", invitoInviatoIl: "2026-10-10T08:00:00Z", ultimoAccesso: "2026-10-12T09:00:00Z" } });
  }
  for (const codice of ["42P01", "PGRST205"]) {
    const errore = { data: null, error: { code: codice, message: "assente" } };
    const { admin } = fintoAdmin({ comeMembro: errore, comeTitolare: errore });
    uguale(`tabella assente (${codice}): nessun legame, non un errore`, [await leggiLegameUfficioGare(V, admin), await leggiTitolareDelMembro(V, admin), await leggiMembroDelTitolare(V, admin)], [null, null, null]);
  }
  {
    const vecchioErrore = console.error;
    console.error = () => {};
    try {
      const guasto = fintoAdmin({ comeMembro: { data: null, error: { code: "57014", message: "timeout" } }, comeTitolare: { data: null, error: { code: "57014", message: "timeout" } } });
      uguale("errore di lettura: «errore», mai «nessun legame»", [await leggiLegameUfficioGare(V, guasto.admin), await leggiTitolareDelMembro(V, guasto.admin), await leggiMembroDelTitolare(V, guasto.admin)], ["errore", "errore", "errore"]);
      const guastoTitolare = fintoAdmin({ comeTitolare: { data: null, error: { code: "57014", message: "timeout" } } });
      uguale("errore nella lettura come titolare: «errore»", await leggiLegameUfficioGare(V, guastoTitolare.admin), "errore");
    } finally {
      console.error = vecchioErrore;
    }
  }
  {
    const { admin, chiamate } = fintoAdmin({ comeMembro: { data: { titolare_id: T }, error: null } });
    uguale("di chi è l'Ufficio Gare: il titolare", await leggiTitolareDelMembro(M, admin), T);
    uguale("cerca per membro nella tabella giusta", chiamate, ["omnia_ai_membri.select(titolare_id)", `omnia_ai_membri.eq(membro_id=${M})`]);
    const { admin: a2, chiamate: c2 } = fintoAdmin({ comeTitolare: { data: { membro_id: M }, error: null } });
    uguale("l'Ufficio Gare di un titolare: il suo identificativo", await leggiMembroDelTitolare(T, a2), M);
    uguale("cerca per titolare", c2, ["omnia_ai_membri.select(membro_id)", `omnia_ai_membri.eq(titolare_id=${T})`]);
  }

  console.log("--- Azioni della console ---");
  const utenti = leggi("src/app/site-console/azioni/utenti.ts");
  const utentiConsole = leggi("src/app/site-console/azioni/utenti-console.ts");
  {
    const c = funzione(utenti, "impostaAbbonamentoManuale");
    atteso("abbonamento a mano: rifiutato a un Ufficio Gare, e anche se il controllo non riesce", /leggiTitolareDelMembro\(userId, admin\);\n\s*if \(titolareDelMembro === "errore"\) return \{ errore: MESSAGGIO_CONTROLLO_UFFICIO_GARE_NON_RIUSCITO \};\n\s*if \(titolareDelMembro\) return \{ errore: MESSAGGIO_E_UN_UFFICIO_GARE \};/.test(c));
    atteso("abbonamento a mano: il controllo viene PRIMA di scrivere sugli abbonamenti", c.indexOf("leggiTitolareDelMembro") !== -1 && c.indexOf("leggiTitolareDelMembro") < c.indexOf('from("subscriptions")'));
    const g = funzione(utentiConsole, "modificaGareGratuite");
    atteso("gare gratuite: rifiutate a un Ufficio Gare, e anche se il controllo non riesce", /leggiTitolareDelMembro\(userId, admin\);\n\s*if \(titolareDelMembro === "errore"\) return \{ errore: MESSAGGIO_CONTROLLO_UFFICIO_GARE_NON_RIUSCITO \};\n\s*if \(titolareDelMembro\) return \{ errore: MESSAGGIO_E_UN_UFFICIO_GARE \};/.test(g));
    atteso("gare gratuite: il controllo viene PRIMA di scrivere sul contatore", g.indexOf("leggiTitolareDelMembro") !== -1 && g.indexOf("leggiTitolareDelMembro") < g.indexOf("omnia_ai_gare_gratuite"));
  }
  {
    const e = funzione(utenti, "eliminaUtente");
    atteso("eliminazione: l'Ufficio Gare si cerca PRIMA di eliminare il titolare (dopo, il legame non c'è più)", e.indexOf("leggiMembroDelTitolare(bersaglio.id, admin)") !== -1 && e.indexOf("leggiMembroDelTitolare") < e.indexOf("deleteUser(bersaglio.id)"));
    atteso("eliminazione: se il controllo non riesce non si tocca nulla", /membroDelTitolare === "errore"\) return \{ errore: MESSAGGIO_CONTROLLO_UFFICIO_GARE_NON_RIUSCITO \}/.test(e) && e.indexOf('membroDelTitolare === "errore"') < e.indexOf("deleteUser(bersaglio.id)"));
    atteso("eliminazione: l'Ufficio Gare si elimina DOPO il titolare, e solo se il titolare è stato eliminato", e.indexOf("deleteUser(membroDelTitolare)") > e.indexOf("deleteUser(bersaglio.id)") && e.indexOf("deleteUser(membroDelTitolare)") > e.indexOf('if (error) {') && /if \(membroDelTitolare\) \{/.test(e));
    atteso("eliminazione: se l'Ufficio Gare non si elimina lo dice con l'identificativo, non finge che sia andato tutto bene", /erroreMembro\) \{[\s\S]*?return \{ errore: `Il cliente è stato eliminato, ma il suo Ufficio Gare \(id \$\{membroDelTitolare\}\) NO/.test(e) && e.indexOf("erroreMembro") < e.indexOf('redirect("/utenti?esito=eliminato")'));
    atteso("eliminazione: si elimina SOLO l'Ufficio Gare letto dal database (mai un identificativo della richiesta)", [...e.matchAll(/deleteUser\(([^)]*)\)/g)].map((m) => m[1]).sort().join("|") === "bersaglio.id|membroDelTitolare");
    const a = funzione(utenti, "anonimizzaUtente");
    atteso("anonimizzazione: l'Ufficio Gare si cerca prima, e se il controllo non riesce non si tocca nulla", a.indexOf("leggiMembroDelTitolare(bersaglio.id, admin)") !== -1 && a.indexOf("leggiMembroDelTitolare") < a.indexOf("updateUserById") && /membroDelTitolare === "errore"\) return \{ errore: MESSAGGIO_CONTROLLO_UFFICIO_GARE_NON_RIUSCITO \}/.test(a));
    atteso("anonimizzazione: l'Ufficio Gare si elimina dopo l'anonimizzazione del titolare", a.indexOf("deleteUser(membroDelTitolare)") > a.indexOf('from("companies").delete()') && /Il cliente è stato anonimizzato, ma il suo Ufficio Gare/.test(a) && a.indexOf("erroreMembro") < a.indexOf('redirect("/utenti?esito=anonimizzato")'));
    atteso("anonimizzazione: si elimina solo l'Ufficio Gare letto dal database", [...a.matchAll(/deleteUser\(([^)]*)\)/g)].map((m) => m[1]).join("|") === "membroDelTitolare");
  }
  atteso("i messaggi della console sono chiari", MESSAGGIO_E_UN_UFFICIO_GARE.includes("Ufficio Gare") && MESSAGGIO_E_UN_UFFICIO_GARE.includes("titolare"));

  console.log("--- Viste ---");
  const elenco = leggi("src/app/site-console/_componenti/utenti-vista.tsx");
  atteso("elenco: tessera degli Uffici Gare, badge sul membro (legato al titolare) e sul titolare, filtro", elenco.includes('etichetta="Uffici Gare"') && elenco.includes("{r.ufficioGareDi && (") && elenco.includes("{r.ufficioGare && (") && elenco.includes("<Link href={`/utenti/${r.ufficioGareDi.titolareId}`}>") && elenco.includes("ha un Ufficio Gare") && elenco.includes("sospeso"));
  const scheda = leggi("src/app/site-console/_componenti/scheda-cliente-vista.tsx");
  atteso("scheda: pannello «Ufficio Gare» per il titolare e per il membro, con i collegamenti reciproci", scheda.includes("{s.legameUfficioGare && (") && scheda.includes('<Pannello titolo="Ufficio Gare">') && scheda.includes("s.legameUfficioGare.titolare.id") && scheda.includes("s.legameUfficioGare.ufficioGare.id") && scheda.includes("in attesa del primo accesso"));
  atteso("scheda: se la lettura del legame non riesce lo dice", scheda.includes("{s.legameUfficioGareNonLetto && ("));
  atteso("scheda di un Ufficio Gare: abbonamento a mano e gare gratuite sostituiti dal messaggio", (scheda.match(/MESSAGGIO_E_UN_UFFICIO_GARE/g) ?? []).length >= 3 && scheda.includes('const eMembro = s.legameUfficioGare?.ruolo === "ufficio_gare";') && /\{eMembro \? \(\s*<p className="cn-nota" style=\{\{ padding: 14 \}\}>\s*\{MESSAGGIO_E_UN_UFFICIO_GARE\}/.test(scheda));
  const lettura = leggi("src/lib/console/utenti.ts");
  atteso("lettura dell'elenco: i legami si leggono con tolleranza della tabella assente, un altro errore non passa per «nessun legame»", lettura.includes('from("omnia_ai_membri").select("membro_id, titolare_id, attivo")') && /membriQ\.error && !schemaAssente\(membriQ\.error\) \? null/.test(lettura) && lettura.includes("membri: membriLetti ?? []"));
  atteso("lettura della scheda: il legame si legge e un errore si dice", lettura.includes("leggiLegameUfficioGare(id)") && lettura.includes('legameUfficioGareNonLetto: legame === "errore"'));
  const pagina = leggi("src/app/site-console/(app)/utenti/page.tsx");
  atteso("la pagina dell'elenco parte dalla guardia dell'amministratore", /richiediAdminPagina\(\)/.test(pagina));

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
