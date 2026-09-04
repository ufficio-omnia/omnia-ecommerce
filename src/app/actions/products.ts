"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/require-admin";

export async function createProduct(formData: FormData) {
  if (!(await requireAdmin())) return;

  const title = String(formData.get("title") ?? "").trim();
  const category = String(formData.get("category") ?? "").trim();
  const price = Number(formData.get("price"));
  const description = String(formData.get("description") ?? "").trim();

  if (!title || !price || price <= 0) return;

  const admin = createAdminClient();
  const { error } = await admin.from("products").insert({
    title,
    category: category || null,
    price,
    description: description || null,
  });

  if (error) {
    console.error("Errore creazione prodotto:", error);
    return;
  }

  revalidatePath("/admin/prodotti");
}

export async function updateProduct(formData: FormData) {
  if (!(await requireAdmin())) return;

  const productId = String(formData.get("productId") ?? "");
  const price = Number(formData.get("price"));
  const description = String(formData.get("description") ?? "").trim();

  if (!productId || !price || price <= 0) return;

  const admin = createAdminClient();
  const { error } = await admin
    .from("products")
    .update({ price, description: description || null })
    .eq("id", productId);

  if (error) {
    console.error("Errore aggiornamento prodotto:", error);
    return;
  }

  revalidatePath("/admin/prodotti");
  revalidatePath("/prodotti");
}

export async function toggleProductActive(formData: FormData) {
  if (!(await requireAdmin())) return;

  const productId = String(formData.get("productId") ?? "");
  const active = formData.get("active") === "true";

  if (!productId) return;

  const admin = createAdminClient();
  const { error } = await admin
    .from("products")
    .update({ active: !active })
    .eq("id", productId);

  if (error) {
    console.error("Errore attivazione/disattivazione prodotto:", error);
    return;
  }

  revalidatePath("/admin/prodotti");
  revalidatePath("/prodotti");
}

export async function addProductFile(formData: FormData) {
  if (!(await requireAdmin())) return;

  const productId = String(formData.get("productId") ?? "");
  const label = String(formData.get("label") ?? "").trim();
  const file = formData.get("file") as File | null;
  const sortOrder = Number(formData.get("sortOrder") ?? 0) || 0;

  if (!productId || !label || !file || file.size === 0) return;

  // Stessa scelta di uploadInvoice: service role per l'upload, dopo aver
  // verificato l'admin lato sessione (vedi nota in src/app/actions/admin.ts
  // sul comportamento RLS non chiaro con la sessione authenticated).
  const admin = createAdminClient();
  const filePath = `${productId}/${Date.now()}-${file.name}`;

  const { error: uploadError } = await admin.storage
    .from("documents")
    .upload(filePath, file);

  if (uploadError) {
    console.error("Errore upload file prodotto:", uploadError);
    return;
  }

  const { error: insertError } = await admin.from("product_files").insert({
    product_id: productId,
    label,
    file_path: filePath,
    sort_order: sortOrder,
  });

  if (insertError) {
    console.error("Errore salvataggio file prodotto:", insertError);
    return;
  }

  revalidatePath("/admin/prodotti");
}

export async function removeProductFile(formData: FormData) {
  if (!(await requireAdmin())) return;

  const fileId = String(formData.get("fileId") ?? "");
  if (!fileId) return;

  const admin = createAdminClient();

  const { data: file } = await admin
    .from("product_files")
    .select("file_path")
    .eq("id", fileId)
    .single<{ file_path: string }>();

  const { error: deleteError } = await admin
    .from("product_files")
    .delete()
    .eq("id", fileId);

  if (deleteError) {
    console.error("Errore rimozione file prodotto:", deleteError);
    return;
  }

  if (file?.file_path) {
    await admin.storage.from("documents").remove([file.file_path]);
  }

  revalidatePath("/admin/prodotti");
}
