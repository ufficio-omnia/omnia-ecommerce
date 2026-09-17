"use server";

import { createClient } from "@/lib/supabase/server";

export type AccountSettingsState = { error?: string; success?: string };

// Solo dati account (email, password): i dati azienda restano
// esclusivamente in Profilo azienda, non duplicati qui.
export async function updateAccountEmail(
  _prevState: AccountSettingsState,
  formData: FormData,
): Promise<AccountSettingsState> {
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();

  if (!email || !email.includes("@")) {
    return { error: "Inserisci un indirizzo email valido." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ email });

  if (error) {
    return { error: error.message };
  }

  return {
    success:
      "Ti abbiamo inviato un'email di conferma al nuovo indirizzo: il cambio sarà effettivo dopo averla confermata.",
  };
}

export async function updateAccountPassword(
  _prevState: AccountSettingsState,
  formData: FormData,
): Promise<AccountSettingsState> {
  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");

  if (password.length < 8) {
    return { error: "La password deve avere almeno 8 caratteri." };
  }

  if (password !== confirmPassword) {
    return { error: "Le password non coincidono." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });

  if (error) {
    return { error: error.message };
  }

  return { success: "Password aggiornata." };
}
