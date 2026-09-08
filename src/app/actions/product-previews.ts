"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/require-admin";

const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_SIZE_BYTES = 3 * 1024 * 1024; // 3MB

export async function addProductFilePreviews(formData: FormData) {
  if (!(await requireAdmin())) return;

  const productFileId = String(formData.get("productFileId") ?? "");
  if (!productFileId) return;

  const files = formData
    .getAll("images")
    .filter(
      (f): f is File =>
        f instanceof File &&
        f.size > 0 &&
        f.size <= MAX_SIZE_BYTES &&
        ALLOWED_TYPES.has(f.type),
    );

  if (files.length === 0) return;

  const admin = createAdminClient();

  const { data: existing } = await admin
    .from("product_file_previews")
    .select("sort_order")
    .eq("product_file_id", productFileId)
    .order("sort_order", { ascending: false })
    .limit(1);

  let nextSortOrder = (existing?.[0]?.sort_order ?? -1) + 1;

  for (const file of files) {
    const imagePath = `${productFileId}/${Date.now()}-${file.name}`;

    const { error: uploadError } = await admin.storage
      .from("product-previews")
      .upload(imagePath, file);

    if (uploadError) {
      console.error("Errore upload anteprima:", uploadError);
      continue;
    }

    const { error: insertError } = await admin
      .from("product_file_previews")
      .insert({
        product_file_id: productFileId,
        image_path: imagePath,
        sort_order: nextSortOrder,
      });

    if (insertError) {
      console.error("Errore salvataggio anteprima:", insertError);
      continue;
    }

    nextSortOrder += 1;
  }

  revalidatePath("/admin/prodotti");
  revalidatePath("/prodotti");
}

export async function removeProductFilePreview(formData: FormData) {
  if (!(await requireAdmin())) return;

  const previewId = String(formData.get("previewId") ?? "");
  if (!previewId) return;

  const admin = createAdminClient();

  const { data: preview } = await admin
    .from("product_file_previews")
    .select("image_path")
    .eq("id", previewId)
    .single<{ image_path: string }>();

  const { error: deleteError } = await admin
    .from("product_file_previews")
    .delete()
    .eq("id", previewId);

  if (deleteError) {
    console.error("Errore rimozione anteprima:", deleteError);
    return;
  }

  if (preview?.image_path) {
    await admin.storage.from("product-previews").remove([preview.image_path]);
  }

  revalidatePath("/admin/prodotti");
  revalidatePath("/prodotti");
}

export async function moveProductFilePreview(formData: FormData) {
  if (!(await requireAdmin())) return;

  const previewId = String(formData.get("previewId") ?? "");
  const productFileId = String(formData.get("productFileId") ?? "");
  const direction = String(formData.get("direction") ?? "");

  if (
    !previewId ||
    !productFileId ||
    (direction !== "up" && direction !== "down")
  ) {
    return;
  }

  const admin = createAdminClient();

  const { data: previews } = await admin
    .from("product_file_previews")
    .select("id, sort_order")
    .eq("product_file_id", productFileId)
    .order("sort_order", { ascending: true })
    .returns<{ id: string; sort_order: number }[]>();

  if (!previews) return;

  const index = previews.findIndex((p) => p.id === previewId);
  const swapIndex = direction === "up" ? index - 1 : index + 1;

  if (index === -1 || swapIndex < 0 || swapIndex >= previews.length) return;

  const current = previews[index];
  const swap = previews[swapIndex];

  await admin
    .from("product_file_previews")
    .update({ sort_order: swap.sort_order })
    .eq("id", current.id);
  await admin
    .from("product_file_previews")
    .update({ sort_order: current.sort_order })
    .eq("id", swap.id);

  revalidatePath("/admin/prodotti");
  revalidatePath("/prodotti");
}
