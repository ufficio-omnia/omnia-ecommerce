"use client";

import { deleteProduct } from "@/app/actions/products";

export function DeleteProductButton({
  productId,
  productTitle,
}: {
  productId: string;
  productTitle: string;
}) {
  return (
    <form
      action={deleteProduct}
      onSubmit={(e) => {
        if (
          !confirm(
            `Eliminare definitivamente "${productTitle}"? L'operazione non è reversibile.`,
          )
        ) {
          e.preventDefault();
        }
      }}
    >
      <input type="hidden" name="productId" value={productId} />
      <button
        type="submit"
        className="rounded-full border border-red-700/40 px-2 py-1 font-mono text-[10px] tracking-wide text-red-700 uppercase hover:bg-red-700 hover:text-cream"
      >
        Elimina
      </button>
    </form>
  );
}
