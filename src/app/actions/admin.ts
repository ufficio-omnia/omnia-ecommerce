"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function markOrderAsPaid(formData: FormData) {
  const orderId = String(formData.get("orderId") ?? "");
  if (!orderId) return;

  const supabase = await createClient();

  // La RLS ("orders_update_admin") impedisce comunque l'update a chi non
  // è admin: questo update fallisce silenziosamente (0 righe modificate)
  // se l'utente corrente non ha il ruolo admin.
  await supabase.from("orders").update({ status: "pagato" }).eq("id", orderId);

  revalidatePath("/admin");
}
