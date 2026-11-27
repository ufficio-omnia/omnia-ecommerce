import { randomBytes, randomUUID } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizzaContenuto } from "./contenuto";
import { IMPOSTAZIONI_PREDEFINITE, type Edizione, type Impostazioni, type Invio, type Iscritto, type StatoEdizione } from "./tipi";

// Accesso ai dati della newsletter, in un posto solo. Due archivi con la stessa interfaccia:
//  - Supabase (sempre in produzione e di base anche in sviluppo): tabelle della migrazione 0141, service role;
//  - «locale»: un file JSON nella cartella temporanea, SOLO in sviluppo con NEWSLETTER_ARCHIVIO=locale. Serve a
//    collaudare console, anteprime e flussi senza applicare la 0141 al database (che in locale è quello reale).
//    In produzione o su Vercel la variabile viene rifiutata con un errore, non ignorata.
// Da chiamare solo dal server, dopo il controllo dell'amministratore (o dal cron / webhook / pagina di disiscrizione).

export type CampiEdizione = Partial<Omit<Edizione, "id" | "numero" | "creata_il" | "aggiornata_il" | "versione">>;

export interface ArchivioNewsletter {
  tipo: "supabase" | "locale";
  leggiImpostazioni(): Promise<Impostazioni>;
  salvaImpostazioni(i: Impostazioni, autore: string | null): Promise<void>;
  elencoEdizioni(): Promise<Edizione[]>;
  leggiEdizione(id: string): Promise<Edizione | null>;
  edizioneDellaSettimana(settimana: string): Promise<Edizione | null>;
  creaEdizione(campi: CampiEdizione & { data_edizione: string }, autore: string | null): Promise<Edizione>;
  // aggiorna solo se lo stato attuale è tra quelli ammessi; null = nessuna riga (stato cambiato nel frattempo)
  aggiornaEdizione(id: string, campi: CampiEdizione, statiAmmessi: StatoEdizione[]): Promise<Edizione | null>;
  edizioniDaInviare(adesso: Date): Promise<Edizione[]>;
  elencoIscritti(): Promise<Iscritto[]>;
  iscrittoPerEmail(email: string): Promise<Iscritto | null>;
  iscrittoPerToken(token: string): Promise<Iscritto | null>;
  aggiungiIscritto(i: Omit<Iscritto, "id" | "token_disiscrizione" | "creato_il" | "disiscritto_il" | "motivo_uscita">, autore: string | null): Promise<Iscritto>;
  aggiornaIscritto(id: string, campi: Partial<Pick<Iscritto, "stato" | "disiscritto_il" | "motivo_uscita" | "base_giuridica" | "prova_base" | "base_dal" | "nome" | "categoria">>): Promise<void>;
  // inserisce le righe ignorando quelle già presenti (stesso iscritto e stessa edizione): idempotente
  accodaInvii(righe: Omit<Invio, "id" | "creato_il" | "resend_id" | "errore" | "inviato_il" | "consegnato_il" | "aperto_il" | "cliccato_il" | "clic">[]): Promise<void>;
  inviiDellEdizione(edizioneId: string): Promise<Invio[]>;
  tuttiGliInvii(limite: number): Promise<Invio[]>;
  aggiornaInvio(id: string, campi: Partial<Invio>): Promise<void>;
  invioPerResendId(resendId: string): Promise<Invio | null>;
  // false = evento già registrato (rinvio del webhook)
  registraEvento(e: { svix_id: string; tipo: string; resend_id: string | null; invio_id: string | null; dati: unknown }): Promise<boolean>;
  annota(edizioneId: string | null, azione: string, dettaglio: Record<string, unknown>, autore: string | null): Promise<void>;
  registro(edizioneId: string, limite: number): Promise<{ azione: string; dettaglio: Record<string, unknown>; creato_il: string }[]>;
}

function edizioneDaRiga(r: Record<string, unknown>): Edizione {
  const d = (r.destinatari ?? {}) as Record<string, unknown>;
  return {
    ...(r as unknown as Edizione),
    contenuto: normalizzaContenuto(r.contenuto),
    destinatari: { abbonati_attivi: d.abbonati_attivi !== false, altri_autorizzati: d.altri_autorizzati !== false },
    data_edizione: String(r.data_edizione).slice(0, 10),
  };
}

// ───────────────────────── Supabase ─────────────────────────

function erroreDb(contesto: string, e: { message: string; code?: string } | null): never {
  throw new Error(`Newsletter, ${contesto}: ${e?.message ?? "errore sconosciuto"}${e?.code ? ` (${e.code})` : ""}`);
}

function archivioSupabase(): ArchivioNewsletter {
  const db = () => createAdminClient();
  return {
    tipo: "supabase",
    async leggiImpostazioni() {
      const { data, error } = await db().from("newsletter_impostazioni").select("*").eq("id", 1).maybeSingle();
      if (error) erroreDb("lettura impostazioni", error);
      return { ...IMPOSTAZIONI_PREDEFINITE, ...(data ?? {}) } as Impostazioni;
    },
    async salvaImpostazioni(i, autore) {
      const { error } = await db().from("newsletter_impostazioni").upsert({ id: 1, ...i, aggiornato_il: new Date().toISOString(), aggiornato_da: autore });
      if (error) erroreDb("salvataggio impostazioni", error);
    },
    async elencoEdizioni() {
      const { data, error } = await db().from("newsletter_edizioni").select("*").order("numero", { ascending: false }).limit(200);
      if (error) erroreDb("elenco edizioni", error);
      return (data ?? []).map(edizioneDaRiga);
    },
    async leggiEdizione(id) {
      const { data, error } = await db().from("newsletter_edizioni").select("*").eq("id", id).maybeSingle();
      if (error) erroreDb("lettura edizione", error);
      return data ? edizioneDaRiga(data) : null;
    },
    async edizioneDellaSettimana(settimana) {
      const { data, error } = await db().from("newsletter_edizioni").select("*").eq("settimana", settimana).maybeSingle();
      if (error) erroreDb("edizione della settimana", error);
      return data ? edizioneDaRiga(data) : null;
    },
    async creaEdizione(campi, autore) {
      // il numero progressivo è unico nel database: due creazioni contemporanee non possono avere lo stesso numero
      for (let tentativo = 0; tentativo < 3; tentativo++) {
        const { data: ultima } = await db().from("newsletter_edizioni").select("numero").order("numero", { ascending: false }).limit(1).maybeSingle();
        const numero = ((ultima?.numero as number | undefined) ?? 0) + 1;
        const { data, error } = await db()
          .from("newsletter_edizioni")
          .insert({ ...campi, numero, creata_da: autore })
          .select("*")
          .single();
        if (!error) return edizioneDaRiga(data);
        if (error.code !== "23505") erroreDb("creazione edizione", error);
        if (campi.settimana) {
          const esistente = await this.edizioneDellaSettimana(campi.settimana);
          if (esistente) return esistente;
        }
      }
      throw new Error("Newsletter: numero di edizione conteso, riprovare.");
    },
    async aggiornaEdizione(id, campi, statiAmmessi) {
      const { data, error } = await db().from("newsletter_edizioni").update(campi).eq("id", id).in("stato", statiAmmessi).select("*");
      if (error) erroreDb("aggiornamento edizione", error);
      return data && data.length > 0 ? edizioneDaRiga(data[0]) : null;
    },
    async edizioniDaInviare(adesso) {
      const { data, error } = await db()
        .from("newsletter_edizioni")
        .select("*")
        .eq("stato", "programmata")
        .not("approvata_il", "is", null)
        .lte("programmata_per", adesso.toISOString())
        .order("programmata_per")
        .limit(3);
      if (error) erroreDb("edizioni da inviare", error);
      return (data ?? []).map(edizioneDaRiga);
    },
    async elencoIscritti() {
      const { data, error } = await db().from("newsletter_iscritti").select("*").order("creato_il", { ascending: false }).limit(5000);
      if (error) erroreDb("elenco iscritti", error);
      return (data ?? []) as Iscritto[];
    },
    async iscrittoPerEmail(email) {
      const { data, error } = await db().from("newsletter_iscritti").select("*").eq("email", email.trim().toLowerCase()).maybeSingle();
      if (error) erroreDb("iscritto per email", error);
      return (data as Iscritto | null) ?? null;
    },
    async iscrittoPerToken(token) {
      if (!/^[a-f0-9]{32,64}$/.test(token)) return null;
      const { data, error } = await db().from("newsletter_iscritti").select("*").eq("token_disiscrizione", token).maybeSingle();
      if (error) erroreDb("iscritto per token", error);
      return (data as Iscritto | null) ?? null;
    },
    async aggiungiIscritto(i, autore) {
      const { data, error } = await db().from("newsletter_iscritti").insert({ ...i, email: i.email.trim().toLowerCase(), registrato_da: autore }).select("*").single();
      if (error) erroreDb(error.code === "23505" ? "indirizzo già presente" : "aggiunta iscritto", error);
      return data as Iscritto;
    },
    async aggiornaIscritto(id, campi) {
      const { error } = await db().from("newsletter_iscritti").update({ ...campi, aggiornato_il: new Date().toISOString() }).eq("id", id);
      if (error) erroreDb("aggiornamento iscritto", error);
    },
    async accodaInvii(righe) {
      if (righe.length === 0) return;
      const reali = righe.filter((r) => r.tipo === "reale");
      const prove = righe.filter((r) => r.tipo === "prova");
      if (reali.length > 0) {
        const { error } = await db().from("newsletter_invii").upsert(reali, { onConflict: "edizione_id,iscritto_id", ignoreDuplicates: true });
        if (error) erroreDb("coda degli invii", error);
      }
      if (prove.length > 0) {
        const { error } = await db().from("newsletter_invii").insert(prove);
        if (error) erroreDb("coda delle prove", error);
      }
    },
    async inviiDellEdizione(edizioneId) {
      const { data, error } = await db().from("newsletter_invii").select("*").eq("edizione_id", edizioneId).order("creato_il").limit(20000);
      if (error) erroreDb("invii dell'edizione", error);
      return (data ?? []) as Invio[];
    },
    async tuttiGliInvii(limite) {
      const { data, error } = await db().from("newsletter_invii").select("*").eq("tipo", "reale").order("creato_il", { ascending: false }).limit(limite);
      if (error) erroreDb("invii", error);
      return (data ?? []) as Invio[];
    },
    async aggiornaInvio(id, campi) {
      const { error } = await db().from("newsletter_invii").update(campi).eq("id", id);
      if (error) erroreDb("aggiornamento invio", error);
    },
    async invioPerResendId(resendId) {
      const { data, error } = await db().from("newsletter_invii").select("*").eq("resend_id", resendId).maybeSingle();
      if (error) erroreDb("invio per id", error);
      return (data as Invio | null) ?? null;
    },
    async registraEvento(e) {
      const { error } = await db().from("newsletter_eventi").insert(e);
      if (error?.code === "23505") return false;
      if (error) erroreDb("registrazione evento", error);
      return true;
    },
    async annota(edizioneId, azione, dettaglio, autore) {
      const { error } = await db().from("newsletter_registro").insert({ edizione_id: edizioneId, azione, dettaglio, autore });
      if (error) console.error("Newsletter: registro non scritto", azione, error.message);
    },
    async registro(edizioneId, limite) {
      const { data, error } = await db().from("newsletter_registro").select("azione, dettaglio, creato_il").eq("edizione_id", edizioneId).order("creato_il", { ascending: false }).limit(limite);
      if (error) return [];
      return (data ?? []) as { azione: string; dettaglio: Record<string, unknown>; creato_il: string }[];
    },
  };
}

// ───────────────────────── locale (solo sviluppo) ─────────────────────────

type DatiLocali = {
  impostazioni: Impostazioni;
  edizioni: Edizione[];
  iscritti: Iscritto[];
  invii: Invio[];
  eventi: { svix_id: string }[];
  registro: { edizione_id: string | null; azione: string; dettaglio: Record<string, unknown>; creato_il: string }[];
};

const STATI_PER_TRIGGER: StatoEdizione[] = ["in_invio", "inviata", "invio_parziale"];

function archivioLocale(): ArchivioNewsletter {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require("fs") as typeof import("fs");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require("path") as typeof import("path");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const os = require("os") as typeof import("os");
  const file = process.env.NEWSLETTER_ARCHIVIO_FILE || path.join(os.tmpdir(), "omnia-newsletter-locale.json");
  const leggi = (): DatiLocali => {
    try {
      return JSON.parse(fs.readFileSync(file, "utf8")) as DatiLocali;
    } catch {
      return { impostazioni: { ...IMPOSTAZIONI_PREDEFINITE }, edizioni: [], iscritti: [], invii: [], eventi: [], registro: [] };
    }
  };
  const scrivi = (d: DatiLocali) => fs.writeFileSync(file, JSON.stringify(d, null, 1));
  const adesso = () => new Date().toISOString();
  // stesse regole del trigger della 0141
  const applicaGuardia = (vecchia: Edizione, nuova: Edizione): Edizione => {
    const cambiato = ["contenuto", "oggetto", "preheader", "destinatari", "data_edizione"].some(
      (k) => JSON.stringify((vecchia as Record<string, unknown>)[k]) !== JSON.stringify((nuova as Record<string, unknown>)[k]),
    );
    if (cambiato) {
      if (STATI_PER_TRIGGER.includes(vecchia.stato)) throw new Error("Edizione già inviata o in invio: il contenuto non si modifica");
      nuova.versione = vecchia.versione + 1;
      if ((vecchia.stato === "approvata" || vecchia.stato === "programmata") && nuova.stato === vecchia.stato) {
        Object.assign(nuova, { stato: "in_revisione", approvata_il: null, approvata_da: null, programmata_per: null });
      }
    }
    if ((nuova.stato === "programmata" || nuova.stato === "in_invio") && !nuova.approvata_il) throw new Error("Edizione non approvata");
    nuova.aggiornata_il = adesso();
    return nuova;
  };
  return {
    tipo: "locale",
    async leggiImpostazioni() {
      return leggi().impostazioni;
    },
    async salvaImpostazioni(i) {
      const d = leggi();
      d.impostazioni = i;
      scrivi(d);
    },
    async elencoEdizioni() {
      return leggi().edizioni.sort((a, b) => b.numero - a.numero).map((e) => edizioneDaRiga(e as unknown as Record<string, unknown>));
    },
    async leggiEdizione(id) {
      const e = leggi().edizioni.find((x) => x.id === id);
      return e ? edizioneDaRiga(e as unknown as Record<string, unknown>) : null;
    },
    async edizioneDellaSettimana(settimana) {
      return leggi().edizioni.find((x) => x.settimana === settimana) ?? null;
    },
    async creaEdizione(campi, autore) {
      void autore;
      const d = leggi();
      if (campi.settimana && d.edizioni.some((e) => e.settimana === campi.settimana)) return d.edizioni.find((e) => e.settimana === campi.settimana)!;
      const numero = Math.max(0, ...d.edizioni.map((e) => e.numero)) + 1;
      const e = edizioneDaRiga({
        id: randomUUID(),
        numero,
        settimana: null,
        stato: "bozza",
        oggetto: "",
        preheader: "",
        origine: "manuale",
        note_generazione: null,
        versione: 1,
        approvata_il: null,
        approvata_da: null,
        programmata_per: null,
        invio_iniziato_il: null,
        invio_concluso_il: null,
        creata_il: adesso(),
        aggiornata_il: adesso(),
        ...campi,
      });
      d.edizioni.push(e);
      scrivi(d);
      return e;
    },
    async aggiornaEdizione(id, campi, statiAmmessi) {
      const d = leggi();
      const i = d.edizioni.findIndex((x) => x.id === id);
      if (i < 0 || !statiAmmessi.includes(d.edizioni[i].stato)) return null;
      const nuova = applicaGuardia(d.edizioni[i], { ...d.edizioni[i], ...campi } as Edizione);
      d.edizioni[i] = nuova;
      scrivi(d);
      return edizioneDaRiga(nuova as unknown as Record<string, unknown>);
    },
    async edizioniDaInviare(ora) {
      return leggi().edizioni.filter((e) => e.stato === "programmata" && e.approvata_il && e.programmata_per && Date.parse(e.programmata_per) <= ora.getTime());
    },
    async elencoIscritti() {
      return leggi().iscritti;
    },
    async iscrittoPerEmail(email) {
      return leggi().iscritti.find((x) => x.email === email.trim().toLowerCase()) ?? null;
    },
    async iscrittoPerToken(token) {
      return leggi().iscritti.find((x) => x.token_disiscrizione === token) ?? null;
    },
    async aggiungiIscritto(i) {
      const d = leggi();
      const email = i.email.trim().toLowerCase();
      if (d.iscritti.some((x) => x.email === email)) throw new Error("Newsletter, indirizzo già presente");
      const nuovo: Iscritto = { ...i, email, id: randomUUID(), token_disiscrizione: randomBytes(24).toString("hex"), creato_il: adesso(), disiscritto_il: null, motivo_uscita: null };
      d.iscritti.unshift(nuovo);
      scrivi(d);
      return nuovo;
    },
    async aggiornaIscritto(id, campi) {
      const d = leggi();
      const x = d.iscritti.find((r) => r.id === id);
      if (x) Object.assign(x, campi);
      scrivi(d);
    },
    async accodaInvii(righe) {
      const d = leggi();
      for (const r of righe) {
        if (r.tipo === "reale" && d.invii.some((x) => x.edizione_id === r.edizione_id && x.iscritto_id === r.iscritto_id)) continue;
        d.invii.push({ ...r, id: randomUUID(), creato_il: adesso(), resend_id: null, errore: null, inviato_il: null, consegnato_il: null, aperto_il: null, cliccato_il: null, clic: 0 });
      }
      scrivi(d);
    },
    async inviiDellEdizione(edizioneId) {
      return leggi().invii.filter((x) => x.edizione_id === edizioneId);
    },
    async tuttiGliInvii(limite) {
      return leggi().invii.filter((x) => x.tipo === "reale").slice(-limite);
    },
    async aggiornaInvio(id, campi) {
      const d = leggi();
      const x = d.invii.find((r) => r.id === id);
      if (x) Object.assign(x, campi);
      scrivi(d);
    },
    async invioPerResendId(resendId) {
      return leggi().invii.find((x) => x.resend_id === resendId) ?? null;
    },
    async registraEvento(e) {
      const d = leggi();
      if (d.eventi.some((x) => x.svix_id === e.svix_id)) return false;
      d.eventi.push({ svix_id: e.svix_id });
      scrivi(d);
      return true;
    },
    async annota(edizioneId, azione, dettaglio) {
      const d = leggi();
      d.registro.push({ edizione_id: edizioneId, azione, dettaglio, creato_il: adesso() });
      scrivi(d);
    },
    async registro(edizioneId, limite) {
      return leggi()
        .registro.filter((r) => r.edizione_id === edizioneId)
        .reverse()
        .slice(0, limite);
    },
  };
}

export function archivioNewsletter(): ArchivioNewsletter {
  if (process.env.NEWSLETTER_ARCHIVIO === "locale") {
    if (process.env.NODE_ENV === "production" || process.env.VERCEL) {
      throw new Error("NEWSLETTER_ARCHIVIO=locale in un ambiente di produzione: rifiutato. L'archivio locale è solo per i collaudi in sviluppo.");
    }
    return archivioLocale();
  }
  return archivioSupabase();
}
