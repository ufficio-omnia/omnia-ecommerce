"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getOmniaAiRequestOrigin } from "@/lib/omnia-ai-request";

export type OmniaAiAuthState = { error?: string };

// Azione dedicata alla zona omnia-ai.it: stesso Supabase dell'e-commerce,
// ma il reindirizzamento dopo l'accesso resta dentro questa zona
// (/dashboard/omnia-ai), non su /dashboard dell'e-commerce.
export async function loginOmniaAi(
  _prevState: OmniaAiAuthState,
  formData: FormData,
): Promise<OmniaAiAuthState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "Inserisci email e password." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return { error: "Email o password non corrette." };
  }

  redirect("/dashboard/omnia-ai");
}

export type OmniaAiRegisterState = { error?: string; success?: string };

// Registrazione libera, senza pagamento: il cliente sceglie e paga un
// piano dopo, da dentro l'area riservata (o da /abbonati/[piano],
// percorso di acquisto diretto senza login preventivo). Stesso schema di
// registerWithEmail (src/app/actions/auth.ts, e-commerce): signInWithOtp
// crea l'account al volo se l'email non esiste ancora. Azione separata,
// non riuso diretto, solo perché il link generato deve restare sul
// dominio di QUESTA zona (getOmniaAiRequestOrigin), mai su quello fisso
// dell'e-commerce.
export async function registerOmniaAi(
  _prevState: OmniaAiRegisterState,
  formData: FormData,
): Promise<OmniaAiRegisterState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();

  if (!email) {
    return { error: "Inserisci un indirizzo email." };
  }

  const supabase = await createClient();
  const origin = await getOmniaAiRequestOrigin();

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: `${origin}/auth/callback?next=/imposta-password`,
    },
  });

  if (error) {
    return { error: error.message };
  }

  return {
    success:
      "Controlla la tua casella email: ti abbiamo inviato un link per attivare l'account e impostare la password.",
  };
}

// Mirror di setInitialPassword (src/app/actions/auth.ts): unica
// differenza il reindirizzamento finale, dentro questa zona invece che
// su /dashboard dell'e-commerce.
export async function setInitialPasswordOmniaAi(
  _prevState: OmniaAiAuthState,
  formData: FormData,
): Promise<OmniaAiAuthState> {
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

  redirect("/dashboard/omnia-ai");
}
