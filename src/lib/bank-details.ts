import { createAdminClient } from "@/lib/supabase/admin";

export type BankDetails = { iban: string; intestatario: string };

const FALLBACK: BankDetails = { iban: "", intestatario: "" };

export async function getBankDetails(): Promise<BankDetails> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("bank_settings")
    .select("iban, intestatario")
    .eq("id", 1)
    .single<BankDetails>();

  if (error || !data) {
    console.error("Errore lettura dati bancari:", error);
    return FALLBACK;
  }

  return data;
}
