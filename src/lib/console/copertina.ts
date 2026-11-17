import { createAdminClient } from "@/lib/supabase/admin";
import { schemaAssente } from "@/lib/omnia-ai-incassi";
import { COLONNE_IMPOSTAZIONI_COPERTINA, generazioniContate, impostazioniDaRiga, usoDaRighe, type ImpostazioniCopertina, type RigaGenerazione } from "@/lib/copertina-diritto-calcoli";
import { CHIAVE_PREZZO_COPERTINA, CHIAVE_VENDITA_COPERTINA, PREZZO_COPERTINA } from "@/lib/copertina-acquisto-calcoli";
import { leggiImpostazioniVenditaCopertina, migrazioneCopertinaPacchettiEseguita } from "@/lib/copertina-vendita";
import { modalitaChiaveStripe, type ModalitaStripe } from "@/lib/omnia-ai-vendita";
import { SERVIZI, interpretaCatalogoPacchetti, type PacchettoCatalogo } from "@/lib/pacchetti-servizi-calcoli";
import type { PoliticaProva } from "@/lib/piano-lavoro-offerta-calcoli";
import { inBlocchi } from "./costi";
import { leggiOfferteDedicateConsole, type OfferteDedicateConsole } from "./offerte";
import type { ConcessioneConsole } from "./piano-lavoro";

// ───── la pagina «Copertina» (menu Sistema, 17/11/2026): la vendita a tutti, come il piano di lavoro ─────

export type ClienteCondizioniCopertina = { userId: string; email: string; descrizione: ImpostazioniCopertina };

export type DatiCopertinaConsole = {
  modalitaStripe: ModalitaStripe;
  interruttore: boolean;
  prezzoSingoloCentesimi: number;
  prezzoSingoloModificato: boolean;
  politicaProva: PoliticaProva;
  // la tabella degli acquisti della singola gara (migrazione 0107): senza, nessuno può comprare
  acquistiDisponibili: boolean;
  // migrazione 0130 (pacchetti e concessioni della copertina): "no" = da eseguire
  migrazione0130: "si" | "no" | "errore";
  // migrazione 0104 (tabelle dei pacchetti)
  pacchettiTabelle: boolean;
  pacchetti: PacchettoCatalogo[];
  pacchettiDiPartenza: boolean;
  unitaResidue: number | null;
  concessioni: ConcessioneConsole[];
  offerte: OfferteDedicateConsole;
  // i clienti con condizioni particolari attive (impostazioni per cliente: gratis o prezzo dedicato)
  clientiParticolari: ClienteCondizioniCopertina[];
  chiaveOpenAI: boolean;
};

export async function leggiCopertinaConsole(): Promise<DatiCopertinaConsole> {
  const admin = createAdminClient();
  const [vendita, migrazione0130, salvati] = await Promise.all([
    leggiImpostazioniVenditaCopertina(admin),
    migrazioneCopertinaPacchettiEseguita(admin),
    admin.from("console_impostazioni").select("chiave, valore").in("chiave", [CHIAVE_PREZZO_COPERTINA, CHIAVE_VENDITA_COPERTINA, SERVIZI.copertina.chiaveCatalogo]).returns<{ chiave: string; valore: string }[]>(),
  ]);
  const valori = new Map((salvati.data ?? []).map((r) => [r.chiave, r.valore]));
  const catalogoSalvato = valori.get(SERVIZI.copertina.chiaveCatalogo);
  let catalogoDiPartenza = true;
  try {
    catalogoDiPartenza = catalogoSalvato === undefined || !Array.isArray(JSON.parse(catalogoSalvato));
  } catch {
    catalogoDiPartenza = true;
  }

  const [acquistiQ, saldiQ, concessioniQ, particolariQ, offerte] = await Promise.all([
    admin.from("omnia_ai_copertine_acquisti").select("id", { count: "exact", head: true }),
    admin.from("omnia_ai_pacchetti_saldi").select("saldo").eq("servizio", "copertina").limit(5000).returns<{ saldo: number }[]>(),
    admin
      .from("omnia_ai_copertina_concessioni")
      .select("id, user_id, tipo, gara_titolo, gare_massime, scade_il, motivo, attiva, creata_il, creata_da_email, revocata_il, revocata_da_email")
      .order("creata_il", { ascending: false })
      .limit(300)
      .returns<
        { id: string; user_id: string; tipo: "tutte" | "gara"; gara_titolo: string | null; gare_massime: number | null; scade_il: string | null; motivo: string; attiva: boolean; creata_il: string; creata_da_email: string; revocata_il: string | null; revocata_da_email: string | null }[]
      >(),
    admin.from("omnia_ai_copertina_impostazioni").select(COLONNE_IMPOSTAZIONI_COPERTINA).eq("attivo", true).limit(500).returns<Record<string, unknown>[]>(),
    leggiOfferteDedicateConsole({ limite: 300 }),
  ]);
  if (saldiQ.error && !schemaAssente(saldiQ.error)) console.error("Console: lettura dei saldi delle copertine fallita", saldiQ.error.message);
  if (concessioniQ.error && !schemaAssente(concessioniQ.error)) console.error("Console: lettura delle concessioni della copertina fallita", concessioniQ.error.message);
  if (particolariQ.error && !schemaAssente(particolariQ.error)) console.error("Console: lettura delle condizioni particolari della copertina fallita", particolariQ.error.message);
  const concessioni = concessioniQ.error ? [] : (concessioniQ.data ?? []);
  const particolari = particolariQ.error ? [] : (particolariQ.data ?? []);

  // email dei clienti e gare già coperte da ciascuna concessione
  const email = new Map<string, string>();
  const usate = new Map<string, Set<string>>();
  const ids = [...new Set([...concessioni.map((c) => c.user_id), ...particolari.map((p) => String(p.user_id))])];
  try {
    if (ids.length > 0) for (const u of await inBlocchi<{ id: string; email: string }>(ids, (b) => admin.from("users").select("id, email").in("id", b))) email.set(u.id, u.email);
    if (concessioni.length > 0) {
      const righe = await admin
        .from("gara_copertine")
        .select("gara_id, concessione_id, stile, stato, fonte, creata_il")
        .in("concessione_id", concessioni.map((c) => c.id))
        .returns<(RigaGenerazione & { concessione_id: string })[]>();
      for (const r of generazioniContate(righe.error ? [] : (righe.data ?? []), new Date()) as (RigaGenerazione & { concessione_id: string })[]) {
        const gare = usate.get(r.concessione_id) ?? new Set<string>();
        gare.add(r.gara_id);
        usate.set(r.concessione_id, gare);
      }
    }
  } catch (e) {
    console.error("Console: lettura dei clienti della copertina fallita", e instanceof Error ? e.message : e);
  }

  return {
    modalitaStripe: modalitaChiaveStripe(process.env.STRIPE_SECRET_KEY_OMNIA_AI),
    interruttore: vendita.venditaAttiva,
    prezzoSingoloCentesimi: vendita.prezzoCentesimi,
    prezzoSingoloModificato: vendita.prezzoCentesimi !== PREZZO_COPERTINA.predefinitoCentesimi,
    politicaProva: vendita.politicaProva,
    acquistiDisponibili: !acquistiQ.error,
    migrazione0130,
    pacchettiTabelle: !saldiQ.error || !schemaAssente(saldiQ.error),
    pacchetti: interpretaCatalogoPacchetti("copertina", catalogoSalvato),
    pacchettiDiPartenza: catalogoDiPartenza,
    unitaResidue: saldiQ.error ? null : (saldiQ.data ?? []).reduce((somma, r) => somma + Math.max(0, Number(r.saldo) || 0), 0),
    concessioni: concessioni.map((r) => ({
      id: r.id,
      utente: email.get(r.user_id) ?? "(cliente non trovato)",
      tipo: r.tipo,
      garaTitolo: r.gara_titolo,
      gareMassime: r.gare_massime,
      gareUsate: usate.get(r.id)?.size ?? 0,
      scadeIl: r.scade_il,
      motivo: r.motivo,
      attiva: r.attiva,
      creataIl: r.creata_il,
      creataDa: r.creata_da_email,
      revocataIl: r.revocata_il,
      revocataDa: r.revocata_da_email,
    })),
    offerte: { disponibile: offerte.disponibile, elenco: offerte.elenco.filter((o) => o.servizio === "copertina") },
    clientiParticolari: particolari
      .map((p) => ({ userId: String(p.user_id), email: email.get(String(p.user_id)) ?? "(cliente non trovato)", descrizione: impostazioniDaRiga(p) }))
      .filter((c): c is ClienteCondizioniCopertina => c.descrizione !== null),
    chiaveOpenAI: Boolean(process.env.OPENAI_API_KEY),
  };
}

// Letture per il riquadro «Copertina della relazione tecnica» della scheda cliente (migrazione 0106): le impostazioni del cliente e ciò che ha già generato.
// Prima della migrazione le tabelle non ci sono: `disponibile: false`. Da chiamare solo dopo richiediAdminPagina().

export type CopertinaCliente = {
  disponibile: boolean;
  // null = mai configurato (servizio spento)
  impostazioni: ImpostazioniCopertina | null;
  aggiornataIl: string | null;
  aggiornataDa: string | null;
  // quante gare gratis ha già usato (gare distinte con almeno una copertina gratuita, pronta o in corso)
  gareGratisUsate: number;
  // le copertine generate (pronte), per stile, su tutte le sue gare
  generazioni: { stilizzato: number; realistico: number };
};

export async function leggiCopertinaCliente(userId: string): Promise<CopertinaCliente> {
  const admin = createAdminClient();
  const nonDisponibile: CopertinaCliente = { disponibile: false, impostazioni: null, aggiornataIl: null, aggiornataDa: null, gareGratisUsate: 0, generazioni: { stilizzato: 0, realistico: 0 } };

  const { data: riga, error } = await admin
    .from("omnia_ai_copertina_impostazioni")
    .select(COLONNE_IMPOSTAZIONI_COPERTINA)
    .eq("user_id", userId)
    .maybeSingle<Record<string, unknown>>();
  if (error) {
    if (!schemaAssente(error)) console.error("Console: lettura delle impostazioni della copertina fallita", error.message);
    return nonDisponibile;
  }

  const { data: righe, error: erroreRighe } = await admin.from("gara_copertine").select("gara_id, stile, stato, fonte, creata_il").eq("user_id", userId).limit(5000).returns<RigaGenerazione[]>();
  if (erroreRighe) {
    if (!schemaAssente(erroreRighe)) console.error("Console: lettura delle copertine generate fallita", erroreRighe.message);
    return nonDisponibile;
  }

  const adesso = new Date();
  const contate = generazioniContate(righe ?? [], adesso);
  const generazioni = { stilizzato: 0, realistico: 0 };
  for (const r of contate) if (r.stato === "pronta" && (r.stile === "stilizzato" || r.stile === "realistico")) generazioni[r.stile] += 1;

  return {
    disponibile: true,
    impostazioni: impostazioniDaRiga(riga),
    aggiornataIl: typeof riga?.aggiornata_il === "string" ? riga.aggiornata_il : null,
    aggiornataDa: typeof riga?.aggiornata_da_email === "string" ? riga.aggiornata_da_email : null,
    gareGratisUsate: usoDaRighe(righe ?? [], "", adesso).gareGratisUsate.length,
    generazioni,
  };
}
