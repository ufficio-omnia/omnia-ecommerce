export type Discountable = {
  price: number;
  discount_active: boolean;
  discount_price: number | null;
};

// Unico punto che decide quale prezzo si applica: usato ovunque un
// prodotto venga mostrato o addebitato, cosi non c'e mai un valore
// scontato "dimenticato" in un punto e non in un altro.
export function effectivePrice(product: Discountable): number {
  if (product.discount_active && product.discount_price != null) {
    return Number(product.discount_price);
  }
  return Number(product.price);
}
