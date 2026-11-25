// Verifica dei testi di «Opportunità» sugli avvisi email (25/11/2026, richiesta del coordinamento dopo l'accensione delle email, F8):
//   A1 invito ad attivare gli avvisi (logica pura, componente vero su un database finto, posizione nelle pagine);
//   A2 spiegazione di «Salvate» e «Monitorate».
// Le frasi devono dire SOLO ciò che fa il motore di B2: qui si controlla anche che il motore lavori ancora così (se cambia, i testi vanno
// rivisti e questa prova fallisce). Nessuna rete, nessun database vero; dati SINTETICI.
// Uso: npx tsx scripts/verifica-testi-opportunita.ts → codice 0 se tutto passa.
import fs from "node:fs";
import Module, { createRequire } from "node:module";
import path from "node:path";

const RADICE = path.resolve(__dirname, "..");
const richiedi = createRequire(path.join(RADICE, "package.json"));
const src = (rel: string) => path.join(RADICE, "src", ...rel.split("/"));
const leggi = (rel: string) => fs.readFileSync(path.join(RADICE, rel), "utf8");

let ok = 0;
const falliti: string[] = [];
function controlla(nome: string, condizione: boolean, dettaglio?: unknown): void {
  if (condizione) ok++;
  else falliti.push(`${nome}${dettaglio === undefined ? "" : ` → ${JSON.stringify(dettaglio).slice(0, 500)}`}`);
}

let chiamateRete = 0;
globalThis.fetch = (async () => {
  chiamateRete++;
  throw new Error("rete vietata nella prova");
}) as typeof fetch;

// ───── database finto per il componente: solo le due letture dell'avviso, con il conteggio ─────
type Riga = Record<string, unknown>;
const mondo = { tabelle: {} as Record<string, Riga[]>, richieste: [] as string[], guasto: false, client: 0 };
function query(tabella: string) {
  const filtri: [string, unknown][] = [];
  let metodo = "select";
  const q = {
    select() {
      return q;
    },
    insert() {
      metodo = "insert";
      return q;
    },
    update() {
      metodo = "update";
      return q;
    },
    upsert() {
      metodo = "upsert";
      return q;
    },
    eq(c: string, v: unknown) {
      filtri.push([c, v]);
      return q;
    },
    async maybeSingle() {
      mondo.richieste.push(`${metodo}:${tabella}:${filtri.map(([c]) => c).join(",")}`);
      if (mondo.guasto) return { data: null, error: { code: "XX000", message: "guasto simulato" } };
      const righe = (mondo.tabelle[tabella] ?? []).filter((r) => filtri.every(([c, v]) => r[c] === v));
      return { data: righe[0] ?? null, error: null };
    },
  };
  return q;
}
function sostituisci(file: string, esporta: Record<string, unknown>): void {
  const m = new Module(file);
  m.filename = file;
  m.loaded = true;
  m.exports = esporta;
  richiedi.cache[file] = m;
}
sostituisci(src("lib/supabase/server.ts"), {
  createClient: async () => {
    mondo.client++;
    return { from: (t: string) => query(t) };
  },
});

type Elemento = { type: unknown; props: Record<string, unknown> };
function elementi(nodo: unknown, out: Elemento[] = []): Elemento[] {
  if (Array.isArray(nodo)) for (const x of nodo) elementi(x, out);
  else if (nodo && typeof nodo === "object" && "type" in nodo && "props" in nodo) {
    out.push(nodo as Elemento);
    elementi((nodo as Elemento).props.children, out);
  }
  return out;
}
function testi(nodo: unknown, out: string[] = []): string[] {
  if (typeof nodo === "string") out.push(nodo);
  else if (Array.isArray(nodo)) for (const x of nodo) testi(x, out);
  else if (nodo && typeof nodo === "object" && "props" in nodo) testi((nodo as Elemento).props.children, out);
  return out;
}

async function principale(): Promise<void> {
  const T = richiedi(src("lib/opportunita-testi-calcoli.ts")) as typeof import("../src/lib/opportunita-testi-calcoli");
  const { GIORNI_PROMEMORIA, CATEGORIA_DEL_TIPO } = richiedi(src("lib/radar/notifiche/tipi.ts")) as typeof import("../src/lib/radar/notifiche/tipi");
  const prefCalc = richiedi(src("lib/radar/notifiche-preferenze-calcoli.ts")) as typeof import("../src/lib/radar/notifiche-preferenze-calcoli");
  const { PROGETTO_STAGING } = richiedi(src("lib/radar/ambiente.ts")) as { PROGETTO_STAGING: string };
  const { RADICE_OPPORTUNITA } = richiedi(src("lib/radar/area-cliente.ts")) as { RADICE_OPPORTUNITA: string };

  // ═════ A1. logica dell'avviso ═════
  const TUTTE = { nuove_opportunita: true, scadenze: true, rettifiche: true };
  const NESSUNA = { nuove_opportunita: false, scadenze: false, rettifiche: false };
  const UNA = { nuove_opportunita: false, scadenze: true, rettifiche: false };
  const base = { motoreAcceso: true, paginaNotifiche: true, operativo: true, lettura: true, ruolo: "titolare" as const, emailImpresaAttive: false, preferenze: null };
  const forma = (s: Partial<Parameters<typeof T.avvisoNotifiche>[0]>) => {
    const a = T.avvisoNotifiche({ ...base, ...s });
    return a ? `${a.forma}|${a.testo === T.TESTO_AVVISI ? "AVVISI" : a.testo}|${a.pulsante}` : null;
  };
  const INVITO = `invito|AVVISI|${T.PULSANTE_NOTIFICHE}`;
  controlla("A1.1 nessun avviso con il motore spento, senza la pagina «Notifiche», in sola lettura o con una lettura non riuscita", [
    forma({ motoreAcceso: false }),
    forma({ paginaNotifiche: false }),
    forma({ operativo: false }),
    forma({ lettura: false }),
  ].every((x) => x === null));
  controlla(
    "A1.2 titolare: invito ben visibile se gli avvisi dell'impresa sono spenti (con o senza preferenze) o se non ha mai scelto; nessun avviso se impresa accesa e almeno una categoria accesa",
    forma({ emailImpresaAttive: false, preferenze: null }) === INVITO &&
      forma({ emailImpresaAttive: false, preferenze: TUTTE }) === INVITO &&
      forma({ emailImpresaAttive: false, preferenze: NESSUNA }) === INVITO &&
      forma({ emailImpresaAttive: true, preferenze: null }) === INVITO &&
      forma({ emailImpresaAttive: true, preferenze: UNA }) === null &&
      forma({ emailImpresaAttive: true, preferenze: TUTTE }) === null,
  );
  controlla(
    "A1.3 titolare che ha spento tutte le sue categorie (impresa accesa): una riga discreta, non il riquadro",
    forma({ emailImpresaAttive: true, preferenze: NESSUNA }) === `nota|${T.NOTA_TITOLARE_SPENTI}|${T.PULSANTE_NOTIFICHE}`,
  );
  const ufficio = { ruolo: "ufficio_gare" as const };
  controlla(
    "A1.4 Ufficio Gare: mai un invito ad agire; impresa spenta → «può attivarli il titolare»; proprie categorie spente o mai scelte → «può riattivarli il titolare»; attive → niente",
    forma({ ...ufficio, emailImpresaAttive: false, preferenze: TUTTE }) === `nota|${T.NOTA_UFFICIO_IMPRESA_SPENTA}|${T.PULSANTE_VEDI_NOTIFICHE}` &&
      forma({ ...ufficio, emailImpresaAttive: false, preferenze: null }) === `nota|${T.NOTA_UFFICIO_IMPRESA_SPENTA}|${T.PULSANTE_VEDI_NOTIFICHE}` &&
      forma({ ...ufficio, emailImpresaAttive: true, preferenze: NESSUNA }) === `nota|${T.NOTA_UFFICIO_PERSONALI_SPENTI}|${T.PULSANTE_VEDI_NOTIFICHE}` &&
      forma({ ...ufficio, emailImpresaAttive: true, preferenze: null }) === `nota|${T.NOTA_UFFICIO_PERSONALI_SPENTI}|${T.PULSANTE_VEDI_NOTIFICHE}` &&
      forma({ ...ufficio, emailImpresaAttive: true, preferenze: UNA }) === null &&
      !/attiva|accendi/i.test(T.PULSANTE_VEDI_NOTIFICHE),
  );

  // ═════ A1/A2. le frasi dicono ciò che fa il motore (se il motore cambia, questa parte fallisce: i testi vanno rivisti) ═════
  const giorni = Object.values(GIORNI_PROMEMORIA).sort((a, b) => b - a);
  const rettifiche = Object.entries(CATEGORIA_DEL_TIPO).filter(([, c]) => c === "rettifiche").map(([t]) => t).sort();
  const eventi = leggi("src/lib/radar/notifiche/eventi-calcoli.ts");
  controlla(
    "A1.5 «10, 5 e 1 giorno prima» = i promemoria del motore; le modifiche dette = rettifica, proroga, nuova scadenza, annullamento (la categoria ha anche «documenti», che il motore non manda mai)",
    JSON.stringify(giorni) === "[10,5,1]" &&
      T.TESTO_AVVISI.includes("(10, 5 e 1 giorno prima)") &&
      JSON.stringify(rettifiche) === JSON.stringify(["annullamento", "documenti", "modifica_scadenza", "proroga", "rettifica"]) &&
      /mai «documenti»/.test(eventi) &&
      T.TESTO_AVVISI.includes("rettifica, proroga, nuova scadenza o annullamento") &&
      ![T.TESTO_AVVISI, T.TESTO_LISTA_SALVATE, T.TESTO_PULSANTI_SALVA, T.NOTA_UFFICIO_IMPRESA_SPENTA].some((t) => /document/i.test(t)),
    { giorni, rettifiche },
  );
  const senzaCommenti = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  const motore = leggi("src/lib/radar/notifiche/motore.ts");
  controlla(
    "A2.1 «salvate e monitorate funzionano allo stesso modo» è vero: il motore legge tutte le salvate senza il campo «monitorata» (né in motore.ts né in eventi-calcoli.ts) e la lista calcola le novità per ogni riga",
    !/monitorat/.test(senzaCommenti(motore)) &&
      !/monitorat/.test(senzaCommenti(eventi)) &&
      fs
        .readdirSync(src("lib/radar/notifiche"))
        .filter((f) => f.endsWith(".ts"))
        .every((f) => !/monitorat/.test(senzaCommenti(leggi(`src/lib/radar/notifiche/${f}`)))) &&
      /export const COLONNE_SALVATA: string = "user_id, procedura_id, aggiunta_id, creata_il";/.test(eventi) &&
      /const novita = \(novitaRaw \?\? \[\]\)\.find\(\(n\) => n\.procedura_id === p\.id && Date\.parse\(n\.rilevato_il\) > visto\);/.test(leggi("src/app/site-omnia-ai/dashboard/omnia-ai/opportunita/monitorate/page.tsx")),
  );
  const ug = { userId: "u2", ruolo: "ufficio_gare" as const };
  const persone = { impresaId: "u1", membriAttivi: ["u2"] };
  const riaccendere = prefCalc.validaModificaPreferenze({ chiModifica: ug, destinatarioId: "u2", persone, attuali: { ...NESSUNA }, richieste: { ...UNA } });
  controlla(
    "A1.6 «può attivarli/riattivarli il titolare» è vero: l'Ufficio Gare non può riaccendere le proprie categorie e non cambia gli avvisi dell'impresa",
    riaccendere.ok === false &&
      prefCalc.modoModifica(ug, { userId: "u2" }, true) === "solo_spegnere" &&
      /<InterruttoreEmailImpresa attive=\{lettura\.emailAttive\} modificabile=\{titolare && /.test(leggi("src/app/site-omnia-ai/dashboard/omnia-ai/opportunita/notifiche/page.tsx")),
    riaccendere,
  );

  // ═════ A1. il componente vero, su un database finto ═════
  const AvvisoNotifiche = (richiedi(src("components/omnia-ai/opportunita/avviso-notifiche.tsx")) as { default: (p: unknown) => Promise<unknown> }).default;
  const STAGING = `https://${PROGETTO_STAGING}.supabase.co`;
  const ACCESO = { RADAR_NOTIFICHE_EMAIL: "attivo", RADAR_NOTIFICHE_PREFERENZE: "attivo", NEXT_PUBLIC_SUPABASE_URL: STAGING };
  const TITOLARE = { accountId: "00000000-0000-4000-8000-0000000000a1", userId: "00000000-0000-4000-8000-0000000000a1", ruolo: "titolare" };
  const MEMBRO = { accountId: TITOLARE.accountId, userId: "00000000-0000-4000-8000-0000000000b2", ruolo: "ufficio_gare" };
  const prova = async (contesto: typeof TITOLARE, env: Record<string, string>, tabelle: Record<string, Riga[]>, operativo = true, guasto = false) => {
    mondo.tabelle = tabelle;
    mondo.richieste = [];
    mondo.client = 0;
    mondo.guasto = guasto;
    const albero = await AvvisoNotifiche({ contesto, operativo, env });
    return { albero, richieste: [...mondo.richieste], client: mondo.client };
  };
  const spento = await prova(TITOLARE, { NEXT_PUBLIC_SUPABASE_URL: STAGING, RADAR_NOTIFICHE_PREFERENZE: "attivo" }, {});
  const senzaPagina = await prova(TITOLARE, { NEXT_PUBLIC_SUPABASE_URL: STAGING, RADAR_NOTIFICHE_EMAIL: "attivo" }, {});
  const solaLettura = await prova(TITOLARE, ACCESO, {}, false);
  controlla(
    "A1.7 componente: motore spento, pagina «Notifiche» assente o sola lettura → nessun avviso e NESSUNA lettura",
    [spento, senzaPagina, solaLettura].every((x) => x.albero === null && x.client === 0 && x.richieste.length === 0),
  );
  const impresaSpenta = await prova(TITOLARE, ACCESO, { omnia_ai_radar_notifiche_impresa: [{ impresa_id: TITOLARE.accountId, email_attive: false }] });
  const el = elementi(impresaSpenta.albero);
  const pulsante = el.find((e) => typeof e.props.href === "string");
  controlla(
    "A1.8 componente, titolare con gli avvisi dell'impresa spenti: riquadro con titolo, testo e pulsante verso «Notifiche»; solo due letture (impresa e propria riga), nessuna scrittura",
    el[0]?.type === "section" &&
      testi(impresaSpenta.albero).includes(T.TITOLO_INVITO) &&
      testi(impresaSpenta.albero).includes(T.TESTO_AVVISI) &&
      pulsante?.props.href === `${RADICE_OPPORTUNITA}/notifiche` &&
      JSON.stringify(impresaSpenta.richieste.sort()) === JSON.stringify(["select:omnia_ai_radar_notifiche_impresa:impresa_id", "select:omnia_ai_radar_notifiche_persone:impresa_id,user_id"]),
    impresaSpenta.richieste,
  );
  const attive = await prova(TITOLARE, ACCESO, {
    omnia_ai_radar_notifiche_impresa: [{ impresa_id: TITOLARE.accountId, email_attive: true }],
    omnia_ai_radar_notifiche_persone: [{ impresa_id: TITOLARE.accountId, user_id: TITOLARE.userId, nuove_opportunita: true, scadenze: true, rettifiche: true, email_bloccata_il: null, motivo_blocco: null }],
  });
  // le preferenze di UN'ALTRA persona non contano per chi guarda
  const altraPersona = await prova(MEMBRO, ACCESO, {
    omnia_ai_radar_notifiche_impresa: [{ impresa_id: TITOLARE.accountId, email_attive: true }],
    omnia_ai_radar_notifiche_persone: [{ impresa_id: TITOLARE.accountId, user_id: TITOLARE.userId, nuove_opportunita: true, scadenze: true, rettifiche: true, email_bloccata_il: null, motivo_blocco: null }],
  });
  const guasto = await prova(TITOLARE, ACCESO, {}, true, true);
  controlla(
    "A1.9 componente: avvisi attivi → niente; Ufficio Gare con le SOLE preferenze del titolare → riga «può riattivarli il titolare»; lettura non riuscita → niente",
    attive.albero === null &&
      testi(altraPersona.albero).includes(T.NOTA_UFFICIO_PERSONALI_SPENTI) &&
      elementi(altraPersona.albero)[0]?.type === "p" &&
      guasto.albero === null,
  );

  // ═════ posizione nelle pagine ═════
  const PAG = "src/app/site-omnia-ai/dashboard/omnia-ai/opportunita";
  const posizioni = ["per-te", "cerca", "monitorate"].map((p) => {
    const righe = leggi(`${PAG}/${p}/page.tsx`).split("\n");
    const i = righe.findIndex((r) => r.trimStart().startsWith(`<TestataOpportunita attiva="${p}"`));
    return [p, i >= 0 && righe[i + 1]?.trim() === "<AvvisoNotifiche contesto={contesto} operativo={diritto.operativo} />"];
  });
  controlla("A1.10 l'avviso è subito sotto la testata di «Per te», «Cerca» e «Salvate e monitorate»", posizioni.every(([, x]) => x === true), posizioni);
  const monitorate = leggi(`${PAG}/monitorate/page.tsx`).split("\n");
  const gara = leggi(`${PAG}/gara/[id]/page.tsx`).split("\n");
  const iAvviso = monitorate.findIndex((r) => r.includes("<AvvisoNotifiche "));
  const iAzioni = gara.findIndex((r) => r.trimStart().startsWith("<AzioniSalvataggio "));
  controlla(
    "A2.2 la spiegazione è visibile nella lista (subito dopo l'avviso) e accanto ai pulsanti «Salva» e «Monitora» della scheda",
    monitorate[iAvviso + 1]?.trim() === '<p className="omnia-opp-spiega">{TESTO_LISTA_SALVATE}</p>' && gara[iAzioni + 1]?.trim() === '<p className="omnia-opp-spiega">{TESTO_PULSANTI_SALVA}</p>',
  );
  const aggiunta = leggi(`${PAG}/aggiunta/[id]/page.tsx`).split("\n");
  const iAzioniAggiunta = aggiunta.findIndex((r) => r.trimStart().startsWith("<AzioniSalvataggio "));
  controlla(
    "A2.3 la stessa spiegazione accanto ai pulsanti nella scheda di una gara aggiunta a mano",
    iAzioniAggiunta >= 0 && aggiunta[iAzioniAggiunta + 1]?.trim() === '<p className="omnia-opp-spiega">{TESTO_PULSANTI_SALVA}</p>',
  );
  // pagina «Notifiche»: la categoria «Rettifiche e modifiche» dice ciò che il motore manda (mai «documenti»); il testo è solo della pagina
  const motoreUsaTesti = fs
    .readdirSync(src("lib/radar/notifiche"))
    .filter((f) => f.endsWith(".ts"))
    .filter((f) => /TESTI_CATEGORIA|notifiche-preferenze-calcoli/.test(leggi(`src/lib/radar/notifiche/${f}`)));
  controlla(
    "A1.11 «Notifiche», categoria «Rettifiche e modifiche»: «Rettifiche, proroghe, cambi di scadenza e annullamenti delle gare salvate o monitorate.», nessun «documenti»; il motore non usa questi testi",
    prefCalc.TESTI_CATEGORIA.rettifiche.descrizione === "Rettifiche, proroghe, cambi di scadenza e annullamenti delle gare salvate o monitorate." &&
      !Object.values(prefCalc.TESTI_CATEGORIA).some((t) => /document/i.test(t.descrizione)) &&
      motoreUsaTesti.length === 0,
    { descrizione: prefCalc.TESTI_CATEGORIA.rettifiche.descrizione, motoreUsaTesti },
  );
  controlla("A3. nessuna richiesta di rete in tutta la prova", chiamateRete === 0, chiamateRete);
}

principale()
  .catch((e) => falliti.push(`eccezione: ${e instanceof Error ? e.stack?.split("\n").slice(0, 3).join(" | ") : String(e)}`))
  .finally(() => {
    console.log(`Verifica dei testi di Opportunità (avvisi email, salvate e monitorate; dati sintetici): ${ok} ok, ${falliti.length} falliti`);
    for (const f of falliti) console.log(`FALLITO ${f}`);
    process.exit(falliti.length ? 1 : 0);
  });
