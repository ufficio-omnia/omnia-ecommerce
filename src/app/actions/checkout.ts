"use server";

import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";

export type ActionState = { error?: string };

export async function startBankTransferOrder(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const email = String(formData.get("email") ?? "").trim();
  const productId = String(formData.get("productId") ?? "");

  if (!email) {
    return { error: "Inserisci un indirizzo email." };
  }

  const admin = createAdminClient();

  const { data: product, error: productError } = await admin
    .from("products")
    .select("id, price")
    .eq("id", productId)
    .single();

  if (productError || !product) {
    return { error: "Prodotto non trovato." };
  }

  const { error: createError } = await admin.auth.admin.createUser({
    email,
    email_confirm: false,
  });

  if (createError && !/already.*registered|already exists/i.test(createError.message)) {
    return { error: `Errore nella creazione dell'account: ${createError.message}` };
  }

  const { data: profile, error: profileError } = await admin
    .from("users")
    .select("id")
    .eq("email", email)
    .single();

  if (profileError || !profile) {
    return { error: "Errore nel recupero del profilo utente." };
  }

  const { data: order, error: orderError } = await admin
    .from("orders")
    .insert({
      user_id: profile.id,
      product_id: product.id,
      status: "in_attesa",
      payment_method: "bonifico",
      total_amount: product.price,
    })
    .select("id")
    .single();

  if (orderError || !order) {
    return { error: "Errore nella creazione dell'ordine." };
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const { error: otpError } = await admin.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: `${siteUrl}/auth/callback?next=/imposta-password`,
    },
  });

  if (otpError) {
    console.error("Errore nell'invio dell'email di attivazione:", otpError);
  }

  redirect(`/checkout/bonifico-istruzioni/${order.id}`);
}
