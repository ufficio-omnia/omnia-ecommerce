"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

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
