"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { richiediTitolareAzione } from "@/lib/omnia-ai-account-guardie";

export type CompanyProfileState = { error?: string; success?: boolean };

const ESTENSIONE_PER_TIPO: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

const LIMITE_BYTE_LOGO = 5 * 1024 * 1024;

// Carica un logo (aziendale o del software gestionale) nel bucket
// privato "company-assets", sotto la cartella dell'utente (richiesto
// dalla policy RLS basata sul primo segmento del path) — usato per
// inserire i loghi reali nell'organigramma generato da OMNIA AI, invece
// di caselle di testo generiche. Un logo non valido o non caricato è un
// ERRORE detto all'utente: prima restituiva null e il salvataggio
// cancellava in silenzio il logo già presente.
async function caricaLogo(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  file: File,
  nomeFile: "logo" | "software-logo",
): Promise<{ path: string } | { error: string }> {
  const estensione = ESTENSIONE_PER_TIPO[file.type];
  if (!estensione) return { error: `Il file «${file.name}» non è un formato supportato: carica un logo PNG, JPG o WebP.` };
  if (file.size > LIMITE_BYTE_LOGO) return { error: `Il file «${file.name}» supera i 5 MB: riducilo e riprova.` };

  const path = `${userId}/${nomeFile}.${estensione}`;
  const { error } = await supabase.storage
    .from("company-assets")
    .upload(path, file, { contentType: file.type, upsert: true });

  if (error) {
    console.error(`Errore upload ${nomeFile}:`, error);
    return { error: "Errore nel caricamento del logo. Riprova tra qualche istante." };
  }
  return { path };
}

// Il nuovo logo può avere un'estensione diversa dal precedente (logo.png →
// logo.jpg): il vecchio file non serve più e si toglie, senza mai fallire il
// salvataggio per questo.
async function eliminaLogoSostituito(percorsoVecchio: string | null | undefined, percorsoNuovo: string | undefined) {
  if (!percorsoVecchio || !percorsoNuovo || percorsoVecchio === percorsoNuovo) return;
  try {
    await createAdminClient().storage.from("company-assets").remove([percorsoVecchio]);
  } catch (err) {
    console.error("Errore rimozione del logo sostituito:", err);
  }
}

function optionalText(formData: FormData, key: string): string | null {
  const value = String(formData.get(key) ?? "").trim();
  return value || null;
}

function optionalInt(formData: FormData, key: string): number | null {
  const value = String(formData.get(key) ?? "").trim();
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function optionalNumeric(formData: FormData, key: string): number | null {
  const value = String(formData.get(key) ?? "").trim();
  if (!value) return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function saveCompanyProfile(
  _prevState: CompanyProfileState,
  formData: FormData,
): Promise<CompanyProfileState> {
  const supabase = await createClient();
  // Solo il titolare: l'Ufficio Gare non può usare questa azione (la barra laterale nasconde la voce, il controllo vero è qui).
  const guardia = await richiediTitolareAzione();
  if (!guardia.ok) return { error: guardia.errore };
  const { user } = guardia;

  const ragioneSociale = optionalText(formData, "ragioneSociale");
  const partitaIva = optionalText(formData, "partitaIva");

  if (!ragioneSociale || !partitaIva) {
    return { error: "Ragione sociale e P.IVA sono obbligatorie." };
  }

  const logoFile = formData.get("logo") as File | null;
  const softwareLogoFile = formData.get("softwareLogo") as File | null;

  // Percorsi attuali: servono a togliere il file sostituito.
  const { data: attuali } = await supabase
    .from("companies")
    .select("logo_path, software_logo_path")
    .eq("user_id", user.id)
    .maybeSingle<{ logo_path: string | null; software_logo_path: string | null }>();

  // Se un logo selezionato non si può caricare si ferma tutto con un messaggio
  // chiaro: il profilo non viene salvato a metà e il logo che c'è già resta.
  let logoPath: string | undefined;
  let softwareLogoPath: string | undefined;
  if (logoFile && logoFile.size > 0) {
    const esito = await caricaLogo(supabase, user.id, logoFile, "logo");
    if ("error" in esito) return { error: esito.error };
    logoPath = esito.path;
  }
  if (softwareLogoFile && softwareLogoFile.size > 0) {
    const esito = await caricaLogo(supabase, user.id, softwareLogoFile, "software-logo");
    if ("error" in esito) return { error: esito.error };
    softwareLogoPath = esito.path;
  }

  const riga = {
      user_id: user.id,
      ragione_sociale: ragioneSociale,
      partita_iva: partitaIva,
      codice_fiscale: optionalText(formData, "codiceFiscale"),
      indirizzo: optionalText(formData, "indirizzo"),
      codice_sdi: optionalText(formData, "codiceSdi"),
      pec: optionalText(formData, "pec"),
      forma_giuridica: optionalText(formData, "formaGiuridica"),
      anno_costituzione: optionalInt(formData, "annoCostituzione"),
      numero_dipendenti: optionalInt(formData, "numeroDipendenti"),
      fatturato_medio_annuo: optionalNumeric(formData, "fatturatoMedioAnnuo"),
      certificazioni: optionalText(formData, "certificazioni"),
      referenze: optionalText(formData, "referenze"),
      settori_attivita: optionalText(formData, "settoriAttivita"),
      presentazione: optionalText(formData, "presentazione"),
      sito_web: optionalText(formData, "sitoWeb"),
      telefono_aziendale: optionalText(formData, "telefonoAziendale"),
      software_nome: optionalText(formData, "softwareNome"),
      // Aggiorna il path solo se è stato caricato un nuovo file in questo
      // salvataggio: altrimenti l'upsert lo lascerebbe implicitamente a
      // null perdendo un logo già caricato in precedenza.
      ...(logoPath !== undefined ? { logo_path: logoPath } : {}),
      ...(softwareLogoPath !== undefined ? { software_logo_path: softwareLogoPath } : {}),
  };

  // Campi facoltativi aggiunti da migrazioni successive: livello di direzione
  // dell'organigramma (0071) e funzioni della piattaforma (0072). Se una
  // colonna non esiste ancora il salvataggio degli altri campi non deve
  // fallire: si riprova togliendo i campi nuovi.
  const campiOrganigramma = {
    funzioni_direzione: optionalText(formData, "funzioniDirezione"),
    uffici_gestione: optionalText(formData, "ufficiGestione"),
  };
  const campiPiattaforma = { funzioni_piattaforma: optionalText(formData, "funzioniPiattaforma") };
  let { error } = await supabase.from("companies").upsert({ ...riga, ...campiOrganigramma, ...campiPiattaforma }, { onConflict: "user_id" });
  if (error && /funzioni_piattaforma/.test(error.message)) {
    ({ error } = await supabase.from("companies").upsert({ ...riga, ...campiOrganigramma }, { onConflict: "user_id" }));
  }
  if (error && /funzioni_direzione|uffici_gestione/.test(error.message)) {
    ({ error } = await supabase.from("companies").upsert(riga, { onConflict: "user_id" }));
  }

  if (error) {
    console.error("Errore salvataggio profilo azienda:", error);
    return { error: "Errore nel salvataggio del profilo azienda." };
  }

  await eliminaLogoSostituito(attuali?.logo_path, logoPath);
  await eliminaLogoSostituito(attuali?.software_logo_path, softwareLogoPath);

  revalidatePath("/dashboard/profilo-azienda");
  revalidatePath("/dashboard/omnia-ai/profilo-azienda");
  return { success: true };
}
