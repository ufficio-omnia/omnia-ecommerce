import { createAdminClient } from "@/lib/supabase/admin";

// Lettura dei prodotti per la pagina Prodotti e sconti. Service role: da chiamare
// solo dopo richiediAdminPagina().

export type AnteprimaProdotto = { id: string; sortOrder: number; url: string };

export type FileProdotto = {
  id: string;
  etichetta: string;
  nome: string;
  ordine: number;
  anteprime: AnteprimaProdotto[];
};

export type ProdottoLetto = {
  id: string;
  titolo: string;
  categoria: string | null;
  descrizione: string | null;
  prezzo: number;
  attivo: boolean;
  scontoAttivo: boolean;
  prezzoScontato: number | null;
  creatoIl: string;
  file: FileProdotto[];
  ordini: { totali: number; pagati: number };
};

export type ProdottiLetti = { stato: "ok"; prodotti: ProdottoLetto[] } | { stato: "errore"; messaggio: string };

type ProdottoDb = {
  id: string;
  title: string;
  category: string | null;
  description: string | null;
  price: number | string;
  active: boolean;
  discount_active: boolean;
  discount_price: number | string | null;
  created_at: string;
  product_files: {
    id: string;
    label: string;
    file_path: string;
    sort_order: number;
    product_file_previews: { id: string; image_path: string; sort_order: number }[] | null;
  }[] | null;
};

// Il file nello storage si chiama «<millisecondi>-<nome>»: si mostra solo il nome.
function nomeDaPercorso(percorso: string): string {
  return (percorso.split("/").pop() ?? percorso).replace(/^\d+-/, "");
}

export async function leggiProdotti(): Promise<ProdottiLetti> {
  const admin = createAdminClient();
  const [prodottiQ, ordiniQ] = await Promise.all([
    admin
      .from("products")
      .select("id, title, category, description, price, active, discount_active, discount_price, created_at, product_files(id, label, file_path, sort_order, product_file_previews(id, image_path, sort_order))")
      .order("created_at", { ascending: false }),
    admin.from("orders").select("product_id, status").limit(20000),
  ]);

  if (prodottiQ.error) {
    console.error("Console: lettura prodotti fallita", prodottiQ.error.message);
    return { stato: "errore", messaggio: "Lettura dei prodotti non riuscita." };
  }
  if (ordiniQ.error) {
    console.error("Console: lettura ordini per prodotto fallita", ordiniQ.error.message);
    return { stato: "errore", messaggio: "Lettura degli ordini dei prodotti non riuscita." };
  }

  const ordiniPerProdotto = new Map<string, { totali: number; pagati: number }>();
  for (const o of (ordiniQ.data ?? []) as { product_id: string | null; status: string }[]) {
    if (!o.product_id) continue;
    const conteggio = ordiniPerProdotto.get(o.product_id) ?? { totali: 0, pagati: 0 };
    conteggio.totali += 1;
    if (o.status === "pagato") conteggio.pagati += 1;
    ordiniPerProdotto.set(o.product_id, conteggio);
  }

  // Le anteprime stanno in un bucket pubblico: l'indirizzo si costruisce, non si chiede.
  const urlAnteprima = (percorso: string) => admin.storage.from("product-previews").getPublicUrl(percorso).data.publicUrl;

  const prodotti = ((prodottiQ.data ?? []) as unknown as ProdottoDb[]).map<ProdottoLetto>((p) => ({
    id: p.id,
    titolo: p.title,
    categoria: p.category,
    descrizione: p.description,
    prezzo: Number(p.price),
    attivo: p.active,
    scontoAttivo: p.discount_active,
    prezzoScontato: p.discount_price === null ? null : Number(p.discount_price),
    creatoIl: p.created_at,
    file: [...(p.product_files ?? [])]
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((f) => ({
        id: f.id,
        etichetta: f.label,
        nome: nomeDaPercorso(f.file_path),
        ordine: f.sort_order,
        anteprime: [...(f.product_file_previews ?? [])]
          .sort((a, b) => a.sort_order - b.sort_order)
          .map((a) => ({ id: a.id, sortOrder: a.sort_order, url: urlAnteprima(a.image_path) })),
      })),
    ordini: ordiniPerProdotto.get(p.id) ?? { totali: 0, pagati: 0 },
  }));

  return { stato: "ok", prodotti };
}
