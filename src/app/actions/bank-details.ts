"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/require-admin";

export async function updateBankDetails(formData: FormData) {
  if (!(await requireAdmin())) return;

  const iban = String(formData.get("iban") ?? "").trim();
  const intestatario = String(formData.get("intestatario") ?? "").trim();

  if (!iban || !intestatario) return;

  const admin = createAdminClient();
  const { error } = await admin
    .from("bank_settings")
    .update({ iban, intestatario, updated_at: new Date().toISOString() })
    .eq("id", 1);

  if (error) {
    console.error("Errore aggiornamento dati bancari:", error);
    return;
  }

  revalidatePath("/admin/impostazioni");
  revalidatePath("/dashboard");
}
