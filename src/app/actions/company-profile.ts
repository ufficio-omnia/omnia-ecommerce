"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type CompanyProfileState = { error?: string; success?: boolean };

const ESTENSIONE_PER_TIPO: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

// Carica un logo (aziendale o del software gestionale) nel bucket
// privato "company-assets", sotto la cartella dell'utente (richiesto
// dalla policy RLS basata sul primo segmento del path) — usato per
// inserire i loghi reali nell'organigramma generato da OMNIA AI, invece
// di caselle di testo generiche.
async function caricaLogo(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  file: File,
  nomeFile: "logo" | "software-logo",
): Promise<string | null> {
  const estensione = ESTENSIONE_PER_TIPO[file.type];
  if (!estensione) return null;

  const path = `${userId}/${nomeFile}.${estensione}`;
  const { error } = await supabase.storage
    .from("company-assets")
    .upload(path, file, { contentType: file.type, upsert: true });

  if (error) {
    console.error(`Errore upload ${nomeFile}:`, error);
    return null;
  }
  return path;
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
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Sessione scaduta, ricarica la pagina." };

  const ragioneSociale = optionalText(formData, "ragioneSociale");
  const partitaIva = optionalText(formData, "partitaIva");

  if (!ragioneSociale || !partitaIva) {
    return { error: "Ragione sociale e P.IVA sono obbligatorie." };
  }

  const logoFile = formData.get("logo") as File | null;
  const softwareLogoFile = formData.get("softwareLogo") as File | null;

  const logoPath = logoFile && logoFile.size > 0 ? await caricaLogo(supabase, user.id, logoFile, "logo") : undefined;
  const softwareLogoPath =
    softwareLogoFile && softwareLogoFile.size > 0
      ? await caricaLogo(supabase, user.id, softwareLogoFile, "software-logo")
      : undefined;

  const { error } = await supabase.from("companies").upsert(
    {
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
    },
    { onConflict: "user_id" },
  );

  if (error) {
    console.error("Errore salvataggio profilo azienda:", error);
    return { error: "Errore nel salvataggio del profilo azienda." };
  }

  revalidatePath("/dashboard/profilo-azienda");
  return { success: true };
}
