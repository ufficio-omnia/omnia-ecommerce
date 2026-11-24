// Fase B3 — CONTRATTO DATI del Radar personalizzato. SOLO PREDISPOSTO: nessuna pagina, azione, cron o notifica lo usa. Il Radar
// personalizzato NON esiste ancora e non va presentato come funzionante.
//
// Che cosa definisce: i tipi del profilo dell'impresa e delle opportunità, e le regole pure che diranno quali gare proporre e quali
// notificare. La parte database (dove salvare il profilo, quali gare sono già state proposte, quando ricalcolare) la integra B2; il piano e
// ciò che manca stanno nel resoconto 18 (§ Radar personalizzato).
//
// Regole fissate qui (decisioni dell'utente del 17/11 e D-C9):
//   1. si propongono SOLO gare CLASSIFICATE con una riga ATTIVA «A» (pertinente) in uno dei settori dell'impresa; mai B, mai C, mai gare in
//      attesa, con la classificazione fallita o senza stato (stessa regola di gareSuggeribili in classificazioni-calcoli.ts, di B2);
//   2. le correlate (B) restano un elenco SEPARATO, consultabile, mai notificato;
//   3. nessuna notifica di gare non pertinenti; si notificano solo le pertinenti NUOVE per quell'impresa (mai la stessa gara due volte);
//   4. multisettore: una gara pertinente in più settori dell'impresa è UNA sola opportunità, con tutti i settori;
//   5. multifonte: una gara collegata a un'altra (0117, unita_a) non si propone mai; si propone solo quella che resta;
//   6. preferenze dell'impresa (sottocategorie, tipologie di procedura, territori, importi) RESTRINGONO le pertinenti, non allargano mai;
//   7. nessuna interrogazione periodica nuova: il calcolo è pensato per girare quando arrivano gare nuove o cambiate (dopo un'importazione) o
//      quando l'impresa cambia il profilo, mai a tempo nel browser.
// Logica pura: nessun database, nessuna rete.

export type LivelloRilevanza = "A" | "B" | "C";

/** Il profilo del Radar di un'impresa (da salvare: tabella proposta a B2). */
export type ProfiloRadar = {
  impresaId: string;
  // settori di Tender Intelligence che l'impresa segue (identificativi di SETTORI_RADAR)
  settori: string[];
  // sottocategorie preferite per settore: vuoto = tutte quelle del settore
  sottocategorie: Partial<Record<string, string[]>>;
  // tipologie di procedura (identificativi di PROCEDURE_RICERCA): vuoto = tutte
  procedure: string[];
  // regioni del luogo di esecuzione: vuoto = tutta Italia
  regioni: string[];
  importoMin: number | null;
  importoMax: number | null;
  // mostrare (mai notificare) anche le correlate nei settori dell'impresa
  vedereCorrelate: boolean;
};

/** Una gara come la vede il Radar: solo ciò che serve a decidere, già letto dal server. */
export type GaraPerRadar = {
  id: string;
  unitaA: string | null;
  // «da_verificare» (0133, S4): come in attesa e fallita, mai in «Per te» (si propongono solo gare «classificata»)
  statoClassificazione: "classificata" | "in_attesa" | "fallita" | "da_verificare" | null;
  righe: { settore: string; rilevanza: LivelloRilevanza; sottocategorie: string[]; attiva: boolean }[];
  tipoProcedura: string | null;
  regioni: string[];
  valore: number | null;
  aperta: boolean;
};

export type OpportunitaRadar = {
  proceduraId: string;
  tipo: "pertinente" | "correlata";
  // settori dell'impresa in cui la gara è pertinente (o correlata), con le sottocategorie
  settori: { settore: string; sottocategorie: string[] }[];
};

function rispettaPreferenze(g: GaraPerRadar, p: ProfiloRadar): boolean {
  if (p.procedure.length && !p.procedure.includes(g.tipoProcedura ?? "")) return false;
  if (p.regioni.length && !g.regioni.some((r) => p.regioni.includes(r))) return false;
  if (p.importoMin !== null && (g.valore === null || g.valore < p.importoMin)) return false;
  if (p.importoMax !== null && g.valore !== null && g.valore > p.importoMax) return false;
  return true;
}

function sottocategorieAmmesse(settore: string, sottocategorie: string[], p: ProfiloRadar): boolean {
  const preferite = p.sottocategorie[settore];
  return !preferite || preferite.length === 0 || sottocategorie.some((s) => preferite.includes(s));
}

/**
 * Le opportunità di un'impresa tra le gare date: prima le pertinenti (A), poi, solo se l'impresa lo chiede, le correlate (B). Una gara al
 * massimo una volta (multisettore riuniti, copie collegate escluse). Solo gare aperte.
 */
export function opportunitaPerImpresa(gare: readonly GaraPerRadar[], p: ProfiloRadar): OpportunitaRadar[] {
  const settori = new Set(p.settori);
  const pertinenti: OpportunitaRadar[] = [];
  const correlate: OpportunitaRadar[] = [];
  const viste = new Set<string>();
  for (const g of gare) {
    if (viste.has(g.id) || g.unitaA || !g.aperta || g.statoClassificazione !== "classificata" || !rispettaPreferenze(g, p)) continue;
    const attive = g.righe.filter((r) => r.attiva && settori.has(r.settore));
    const a = attive.filter((r) => r.rilevanza === "A" && sottocategorieAmmesse(r.settore, r.sottocategorie, p));
    if (a.length) {
      pertinenti.push({ proceduraId: g.id, tipo: "pertinente", settori: a.map((r) => ({ settore: r.settore, sottocategorie: r.sottocategorie })) });
      viste.add(g.id);
      continue;
    }
    const b = attive.filter((r) => r.rilevanza === "B");
    if (p.vedereCorrelate && b.length) {
      correlate.push({ proceduraId: g.id, tipo: "correlata", settori: b.map((r) => ({ settore: r.settore, sottocategorie: r.sottocategorie })) });
      viste.add(g.id);
    }
  }
  return [...pertinenti, ...correlate];
}

/** Le gare da notificare: SOLO pertinenti e SOLO quelle mai notificate prima a quell'impresa. Mai correlate, mai non pertinenti. */
export function daNotificare(opportunita: readonly OpportunitaRadar[], giaNotificate: ReadonlySet<string>): string[] {
  return [...new Set(opportunita.filter((o) => o.tipo === "pertinente" && !giaNotificate.has(o.proceduraId)).map((o) => o.proceduraId))];
}

/**
 * Le gare da rivalutare per il Radar dopo un'importazione: solo quelle nuove o cambiate nel giro (nessuna scansione dell'archivio) e solo se
 * classificate. Il ricalcolo per un'impresa che cambia il profilo è invece limitato alle gare aperte.
 */
export function gareDaRivalutare(cambiateNelGiro: readonly GaraPerRadar[]): string[] {
  return cambiateNelGiro.filter((g) => g.statoClassificazione === "classificata" && !g.unitaA && g.aperta).map((g) => g.id);
}
