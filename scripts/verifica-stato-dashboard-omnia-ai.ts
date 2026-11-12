// Verifica del controllo periodico della dashboard di OMNIA AI (spia del marchio + campanella), con un orologio finto.
// Esegui: npx tsx scripts/verifica-stato-dashboard-omnia-ai.ts
import fs from "node:fs";
import {
  INTERVALLO_ELABORAZIONE_MS,
  INTERVALLO_MINIMO_RIPRESA_MS,
  INTERVALLO_ORDINARIO_MS,
  creaPollerStato,
  prossimoIntervallo,
} from "../src/lib/omnia-ai-stato-dashboard-calcoli";

const fallimenti: string[] = [];
function atteso(descrizione: string, ok: boolean, dettaglio = "") {
  if (ok) console.log(`  ok  ${descrizione}`);
  else {
    console.log(`  NO  ${descrizione}${dettaglio ? ` — ${dettaglio}` : ""}`);
    fallimenti.push(descrizione);
  }
}
const leggi = (f: string) => fs.readFileSync(f, "utf8");
const senzaCommenti = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const svuota = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

// Ambiente finto: tempo, timer e visibilità sotto controllo del test.
function ambienteFinto() {
  let adesso = 1_000_000;
  let prossimoId = 1;
  let visibile = true;
  const timer = new Map<number, { quando: number; fn: () => void }>();
  return {
    ambiente: {
      adesso: () => adesso,
      programma: (fn: () => void, ms: number) => {
        const id = prossimoId++;
        timer.set(id, { quando: adesso + ms, fn });
        return id;
      },
      annulla: (id: number) => {
        timer.delete(id);
      },
      visibile: () => visibile,
    },
    setVisibile: (v: boolean) => {
      visibile = v;
    },
    timerAttivi: () => timer.size,
    prossimoTra: () => (timer.size ? Math.min(...[...timer.values()].map((t) => t.quando)) - adesso : null),
    async avanza(ms: number) {
      const fine = adesso + ms;
      for (;;) {
        const dovuti = [...timer.entries()].filter(([, t]) => t.quando <= fine).sort((a, b) => a[1].quando - b[1].quando);
        if (!dovuti.length) break;
        const [id, t] = dovuti[0];
        adesso = t.quando;
        timer.delete(id);
        t.fn();
        await svuota();
      }
      adesso = fine;
      await svuota();
    },
  };
}

// controlla finto: conta le chiamate; con «sospeso» la risposta resta in attesa finché il test non la sblocca.
function controllaFinto() {
  let chiamate = 0;
  let inCorso = false;
  let errore = false;
  let sospeso = false;
  let sblocca: (() => void) | null = null;
  return {
    fn: async () => {
      chiamate++;
      if (sospeso) await new Promise<void>((r) => (sblocca = r));
      if (errore) throw new Error("rete");
      return { inCorso };
    },
    chiamate: () => chiamate,
    setInCorso: (v: boolean) => (inCorso = v),
    setErrore: (v: boolean) => (errore = v),
    setSospeso: (v: boolean) => (sospeso = v),
    sblocca: async () => {
      sospeso = false;
      sblocca?.();
      sblocca = null;
      await svuota();
    },
  };
}

async function main() {
  console.log("--- Ritmo ---");
  atteso("ritmo ordinario 30 s, 6 s (come prima) solo durante un'elaborazione, ripresa dopo almeno 5 s", INTERVALLO_ORDINARIO_MS === 30_000 && INTERVALLO_ELABORAZIONE_MS === 6_000 && INTERVALLO_MINIMO_RIPRESA_MS === 5_000 && prossimoIntervallo(false) === 30_000 && prossimoIntervallo(true) === 6_000);

  {
    const o = ambienteFinto();
    const c = controllaFinto();
    const p = creaPollerStato(c.fn, o.ambiente);
    p.avvia();
    await svuota();
    atteso("all'avvio parte subito un controllo", c.chiamate() === 1);
    atteso("dopo la risposta c'è un solo timer, a 30 s", o.timerAttivi() === 1 && o.prossimoTra() === 30_000);
    await o.avanza(29_999);
    atteso("prima dei 30 s nessun altro controllo", c.chiamate() === 1);
    await o.avanza(1);
    atteso("a 30 s il secondo controllo", c.chiamate() === 2);
    await o.avanza(5 * 60_000);
    atteso("in 5 minuti a scheda visibile e senza elaborazioni: 10 controlli (prima: 2 azioni ogni 6 s = 100)", c.chiamate() === 12);

    c.setInCorso(true);
    await o.avanza(30_000);
    atteso("quando un'elaborazione è in corso il prossimo controllo è a 6 s", o.prossimoTra() === 6_000);
    await o.avanza(60_000);
    atteso("durante l'elaborazione: 10 controlli al minuto (come prima: 1 ogni 6 s)", c.chiamate() === 23);
    c.setInCorso(false);
    await o.avanza(6_000);
    atteso("finita l'elaborazione si torna a 30 s", o.prossimoTra() === 30_000);
    p.ferma();
    atteso("ferma: nessun timer resta vivo", o.timerAttivi() === 0);
    const prima = c.chiamate();
    await o.avanza(10 * 60_000);
    atteso("dopo ferma nessun altro controllo", c.chiamate() === prima);
  }

  console.log("--- Scheda nascosta e ritorno ---");
  {
    const o = ambienteFinto();
    const c = controllaFinto();
    const p = creaPollerStato(c.fn, o.ambiente);
    p.avvia();
    await svuota();
    o.setVisibile(false);
    p.alCambioVisibilita();
    atteso("scheda nascosta: il timer si cancella", o.timerAttivi() === 0);
    await o.avanza(60 * 60_000);
    atteso("un'ora a scheda nascosta: nessun controllo (prima: 1.200 azioni a ritmo pieno)", c.chiamate() === 1);
    o.setVisibile(true);
    p.alCambioVisibilita();
    await svuota();
    atteso("al ritorno sulla scheda parte subito un controllo", c.chiamate() === 2);
    atteso("e poi riprende il ritmo di 30 s", o.timerAttivi() === 1 && o.prossimoTra() === 30_000);

    await o.avanza(2_000);
    o.setVisibile(false);
    p.alCambioVisibilita();
    await o.avanza(1_000);
    o.setVisibile(true);
    p.alCambioVisibilita();
    await svuota();
    atteso("ritorno dopo solo 3 s dall'ultimo controllo: nessun controllo immediato", c.chiamate() === 2);
    atteso("ma uno programmato appena trascorsi 5 s dall'ultimo", o.prossimoTra() === 2_000);
    await o.avanza(2_000);
    atteso("che parte a 5 s", c.chiamate() === 3);

    // visibilitychange ripetuti a scheda visibile non devono aggiungere timer
    p.alCambioVisibilita();
    p.alCambioVisibilita();
    atteso("eventi di visibilità ripetuti non duplicano i timer", o.timerAttivi() === 1);
    p.ferma();
  }

  console.log("--- Niente sovrapposizioni ---");
  {
    const o = ambienteFinto();
    const c = controllaFinto();
    c.setSospeso(true);
    const p = creaPollerStato(c.fn, o.ambiente);
    p.avvia();
    await svuota();
    atteso("controllo in attesa di risposta: nessun timer programmato", c.chiamate() === 1 && o.timerAttivi() === 0);
    o.setVisibile(false);
    p.alCambioVisibilita();
    o.setVisibile(true);
    p.alCambioVisibilita();
    p.avvia();
    await o.avanza(5 * 60_000);
    atteso("mentre un controllo è in volo non ne parte un secondo (né dal ritorno sulla scheda, né da un nuovo avvio)", c.chiamate() === 1);
    await c.sblocca();
    atteso("alla risposta riparte un solo timer", o.timerAttivi() === 1 && o.prossimoTra() === 30_000);
    p.ferma();
  }
  {
    const o = ambienteFinto();
    const c = controllaFinto();
    c.setSospeso(true);
    const p = creaPollerStato(c.fn, o.ambiente);
    p.avvia();
    await svuota();
    p.ferma();
    await c.sblocca();
    atteso("smontato mentre un controllo era in volo: la risposta tardiva non programma niente", o.timerAttivi() === 0);
  }
  {
    const o = ambienteFinto();
    const c = controllaFinto();
    c.setSospeso(true);
    const p = creaPollerStato(c.fn, o.ambiente);
    p.avvia();
    await svuota();
    o.setVisibile(false);
    p.alCambioVisibilita();
    await c.sblocca();
    atteso("scheda nascosta mentre un controllo era in volo: alla risposta nessun timer", o.timerAttivi() === 0);
    p.ferma();
  }

  console.log("--- Errori ---");
  {
    const o = ambienteFinto();
    const c = controllaFinto();
    const p = creaPollerStato(c.fn, o.ambiente);
    c.setInCorso(true);
    p.avvia();
    await svuota();
    c.setErrore(true);
    await o.avanza(6_000);
    atteso("un errore di rete non ferma il controllo: si riprova con l'ultimo ritmo noto", c.chiamate() === 2 && o.prossimoTra() === 6_000);
    c.setErrore(false);
    c.setInCorso(false);
    await o.avanza(6_000);
    atteso("e alla risposta buona riprende il ritmo giusto", c.chiamate() === 3 && o.prossimoTra() === 30_000);
    p.ferma();
  }

  console.log("--- Aggiorna subito (avvio e fine di un'analisi) ---");
  {
    const o = ambienteFinto();
    const c = controllaFinto();
    const p = creaPollerStato(c.fn, o.ambiente);
    p.avvia();
    await svuota();
    await o.avanza(3_000);
    p.aggiornaOra();
    await svuota();
    atteso("aggiornaOra: un controllo subito, senza aspettare i 30 s", c.chiamate() === 2);
    atteso("e un solo timer dopo, al ritmo giusto", o.timerAttivi() === 1 && o.prossimoTra() === 30_000);

    c.setSospeso(true);
    p.aggiornaOra();
    await svuota();
    p.aggiornaOra();
    p.aggiornaOra();
    p.aggiornaOra();
    await svuota();
    atteso("richieste ravvicinate mentre un controllo è in volo: nessun secondo controllo affiancato", c.chiamate() === 3);
    await c.sblocca();
    atteso("appena il primo risponde ne parte UNO solo (stato fresco), non tre", c.chiamate() === 4);
    await svuota();
    atteso("poi un solo timer al ritmo ordinario", o.timerAttivi() === 1 && o.prossimoTra() === 30_000);

    o.setVisibile(false);
    p.alCambioVisibilita();
    p.aggiornaOra();
    await svuota();
    atteso("a scheda nascosta aggiornaOra non fa nulla", c.chiamate() === 4 && o.timerAttivi() === 0);
    o.setVisibile(true);
    p.ferma();
    p.aggiornaOra();
    await svuota();
    atteso("dopo ferma aggiornaOra non fa nulla", c.chiamate() === 4 && o.timerAttivi() === 0);
  }

  console.log("--- Componenti e azione del server ---");
  const shell = leggi("src/components/omnia-ai/dashboard-shell.tsx");
  atteso("la shell monta un solo controllo periodico; l'Ufficio Gare (senza campanella) non chiede le notifiche", /<StatoDashboardProvider conNotifiche=\{!ufficioGare\}>/.test(shell) && !/MarchioStatoDriver/.test(shell));
  atteso("il vecchio driver del marchio con il timer da 6 s non esiste più", !fs.existsSync("src/components/omnia-ai/marchio-stato-driver.tsx"));
  const campanella = senzaCommenti(leggi("src/components/omnia-ai/notification-bell.tsx"));
  atteso("la campanella non ha più un timer suo: legge il contatore condiviso", !/setInterval|setTimeout|getConteggioNonLette/.test(campanella) && /useStatoDashboard\(\)/.test(campanella));
  const stato = senzaCommenti(leggi("src/components/omnia-ai/stato-dashboard.tsx"));
  atteso(
    "il componente usa il poller, ascolta la visibilità e allo smontaggio ferma tutto (poller, ascoltatore, timeout del verde)",
    /creaPollerStato\(/.test(stato) &&
      !/setInterval/.test(stato) &&
      /document\.addEventListener\("visibilitychange", alCambioDiVisibilita\)/.test(stato) &&
      /poller\.ferma\(\);/.test(stato) &&
      /document\.removeEventListener\("visibilitychange", alCambioDiVisibilita\)/.test(stato) &&
      /clearTimeout\(timeoutPronto\.current\)/.test(stato) &&
      /visibile: \(\) => document\.visibilityState === "visible"/.test(stato),
  );
  atteso(
    "segnale locale: accende subito l'ambra, a fine analisi chiede un controllo immediato; si spegne allo smontaggio; fuori dalla dashboard non fa nulla",
    /elaborazioniLocali\.current > 0/.test(stato) &&
      /pollerRef\.current\?\.aggiornaOra\(\)/.test(stato) &&
      /segnala\(true\);\s*return \(\) => segnala\(false\);/.test(stato) &&
      /const ctx = useContext\(StatoDashboardContext\);\s*const segnala = ctx\?\.segnalaElaborazioneLocale;/.test(stato),
  );
  atteso(
    "il verde («pronto») si accende solo quando il SERVER vede una gara passare da in corso a conclusa, mai alla sola fine del segnale locale (analisi rifiutata o finita con errore)",
    /const applica = useCallback\(\(concluseDalServer = false\) =>/.test(stato) &&
      /\} else if \(concluseDalServer\) \{\s*\/\/[^\n]*\n\s*setStato\("pronto"\);/.test(leggi("src/components/omnia-ai/stato-dashboard.tsx")) &&
      /applica\(eraInCorsoSulServer && !esito\.inCorso\)/.test(stato) &&
      /elaborazioniLocali\.current \+ \(attiva \? 1 : -1\)\);\s*applica\(\);/.test(stato),
  );
  atteso("il marchio passa ancora da elaborazione a verde e poi a riposo", /setStato\("elaborazione"\)/.test(stato) && /setStato\("pronto"\)/.test(stato) && /setStato\("riposo"\)/.test(stato));
  const azione = senzaCommenti(leggi("src/app/actions/omnia-ai-stato-sistema.ts"));
  atteso("l'azione unica: una sola lettura della sessione (la guardia), nessun getUser in più", (azione.match(/richiediAccountAzione\(\)/g) ?? []).length === 1 && !/auth\.getUser\(\)/.test(azione));
  atteso("gare in elaborazione dell'account effettivo (titolare per l'Ufficio Gare)", /\.eq\("user_id", guardia\.contesto\.accountId\)/.test(azione) && /\.eq\("estrazione_stato", "in_corso"\)/.test(azione));
  atteso("notifiche lette con la sessione dell'utente (regole di accesso), mai con la chiave di servizio", /createClient\(\)/.test(azione) && !/createAdminClient/.test(azione) && /conNotifiche === true/.test(azione));
  atteso("sessione non valida: nessun dato", /if \(!guardia\.ok\) return \{ inCorso: false, nonLette: null \};/.test(azione));
  const guardie = senzaCommenti(leggi("src/lib/omnia-ai-account-guardie.ts"));
  atteso("le pagine leggono la sessione una volta per richiesta (cache di React), sempre con getUser", /export const leggiSessioneAccountPerPagina = cache\(leggiSessioneAccount\);/.test(guardie) && /import \{ cache \} from "react";/.test(guardie) && /auth\.getUser\(\)/.test(guardie));
  {
    // Le guardie delle AZIONI sono usate anche dal motore (analisi, chat, piano di lavoro, copertina): devono restare quelle di prima.
    const corpi = (testo: string) =>
      ["leggiSessioneAccount", "richiediTitolareAzione", "richiediAccountAzione"]
        .map((n) => testo.replace(/\r\n/g, "\n").match(new RegExp(`export async function ${n}\\(\\)[\\s\\S]*?\\n\\}`))?.[0] ?? "")
        .join("\n");
    const { execSync } = await import("node:child_process");
    let master = "";
    try {
      master = execSync("git show master:src/lib/omnia-ai-account-guardie.ts", { encoding: "utf8" });
    } catch {
      master = "";
    }
    atteso("guardie delle azioni (usate dal motore) identiche a master, senza cache", master === "" || (corpi(master).length > 200 && corpi(master) === corpi(leggi("src/lib/omnia-ai-account-guardie.ts"))));
    const pagine = senzaCommenti(leggi("src/lib/omnia-ai-account-guardie.ts"));
    atteso("solo le guardie delle pagine e il layout usano la versione con cache", (pagine.match(/await leggiSessioneAccountPerPagina\(\)/g) ?? []).length === 2 && (pagine.match(/await leggiSessioneAccount\(\)/g) ?? []).length === 2 && /await leggiSessioneAccountPerPagina\(\)/.test(leggi("src/app/site-omnia-ai/dashboard/omnia-ai/layout.tsx")));
  }
  atteso("nessuna cache condivisa tra richieste (niente unstable_cache / use cache / variabili di modulo per la sessione)", !/unstable_cache|"use cache"|revalidate/.test(guardie));

  console.log("");
  if (fallimenti.length > 0) {
    console.error(`${fallimenti.length} controlli falliti:\n - ${fallimenti.join("\n - ")}`);
    process.exit(1);
  }
  console.log("Tutti i controlli sono andati a buon fine.");
}

void main();
