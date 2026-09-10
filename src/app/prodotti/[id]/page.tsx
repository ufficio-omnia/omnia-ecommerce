import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { effectivePrice } from "@/lib/products";
import BankTransferForm from "./bank-transfer-form";
import CardCheckoutForm from "./card-checkout-form";
import PreviewGalleryButton from "@/components/preview-gallery-button";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const supabase = await createClient();
  const { data: product } = await supabase
    .from("products")
    .select("title, description")
    .eq("id", id)
    .maybeSingle<{ title: string; description: string | null }>();

  if (!product) {
    return { title: "Pacchetto non trovato" };
  }

  return {
    title: `${product.title} — documenti per gare d'appalto`,
    description: product.description ?? undefined,
  };
}

export default async function ProdottoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: product } = await supabase
    .from("products")
    .select(
      "id, title, description, price, active, discount_active, discount_price, product_files(id, label, sort_order, product_file_previews(image_path, sort_order))",
    )
    .eq("id", id)
    .single<{
      id: string;
      title: string;
      description: string | null;
      price: number;
      active: boolean;
      discount_active: boolean;
      discount_price: number | null;
      product_files: {
        id: string;
        label: string;
        sort_order: number;
        product_file_previews: { image_path: string; sort_order: number }[];
      }[];
    }>();

  if (!product || !product.active) {
    notFound();
  }

  // "Vigente" = effective_date più recente non successiva ad oggi, non
  // il numero di versione più alto (stessa logica di
  // getCurrentLegalDocuments in src/lib/legal-acceptance.ts, duplicata
  // qui solo perché questa pagina usa il client di sessione, non quello
  // admin usato dalle server action di checkout).
  const today = new Date().toISOString().slice(0, 10);
  const { data: legalDocsRaw } = await supabase
    .from("legal_documents")
    .select("document_type, version, effective_date")
    .in("document_type", ["condizioni_vendita", "privacy_policy"])
    .lte("effective_date", today)
    .order("effective_date", { ascending: false })
    .returns<{ document_type: string; version: number; effective_date: string }[]>();

  const condizioniVersion =
    legalDocsRaw?.find((d) => d.document_type === "condizioni_vendita")
      ?.version ?? 1;
  const privacyVersion =
    legalDocsRaw?.find((d) => d.document_type === "privacy_policy")
      ?.version ?? 1;

  const files = [...(product.product_files ?? [])].sort(
    (a, b) => a.sort_order - b.sort_order,
  );
  const discounted = product.discount_active && product.discount_price != null;

  return (
    <main className="flex-1">
      <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
        <Link
          href="/prodotti"
          className="font-mono text-xs tracking-wide text-sage uppercase hover:text-ink"
        >
          ← Tutti i documenti
        </Link>

        <div className="mt-6 rounded-2xl border border-border bg-cream-soft p-6 sm:p-10">
          <h1 className="font-serif text-3xl text-ink sm:text-4xl">
            {product.title}
          </h1>
          <p className="mt-3 max-w-xl text-justify text-sage">{product.description}</p>

          <div className="mt-6">
            {discounted && (
              <span className="mb-1 inline-block rounded-full bg-forest/10 px-2 py-0.5 font-mono text-[10px] tracking-wide text-forest uppercase">
                Sconto momentaneo
              </span>
            )}
            <div className="flex items-baseline gap-3">
              {discounted && (
                <span className="text-lg text-sage line-through">
                  {Number(product.price).toLocaleString("it-IT", {
                    style: "currency",
                    currency: "EUR",
                  })}
                </span>
              )}
              <span className="font-serif text-3xl text-ink">
                {Number(effectivePrice(product)).toLocaleString("it-IT", {
                  style: "currency",
                  currency: "EUR",
                })}
              </span>
            </div>
            <p className="mt-0.5 font-mono text-[10px] tracking-wide text-sage uppercase">
              IVA inclusa
            </p>
          </div>

          {files.length > 0 && (
            <div className="mt-6 border-t border-border pt-6">
              <p className="font-mono text-xs tracking-wide text-sage uppercase">
                Contenuto del pacchetto
              </p>
              <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                {files.map((f) => {
                  const previewUrls = [...(f.product_file_previews ?? [])]
                    .sort((a, b) => a.sort_order - b.sort_order)
                    .map(
                      (preview) =>
                        supabase.storage
                          .from("product-previews")
                          .getPublicUrl(preview.image_path).data.publicUrl,
                    );

                  return (
                    <li
                      key={f.id}
                      className="flex items-center gap-2 text-sm text-ink"
                    >
                      <span className="text-forest">•</span>
                      <span>{f.label}</span>
                      <PreviewGalleryButton
                        images={previewUrls}
                        label={f.label}
                      />
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>

        <div className="mt-8 grid gap-6 sm:grid-cols-2">
          <div className="rounded-2xl border border-border bg-cream-soft p-6">
            <p className="font-serif text-lg text-ink">Paga con carta</p>
            <p className="mt-1 text-justify text-xs text-sage">
              Pagamento sicuro tramite Stripe. Il documento sarà sbloccato in
              dashboard subito dopo la conferma del pagamento.
            </p>
            <CardCheckoutForm
              productId={product.id}
              condizioniVersion={condizioniVersion}
              privacyVersion={privacyVersion}
            />
          </div>

          <div className="rounded-2xl border border-border bg-cream-soft p-6">
            <p className="font-serif text-lg text-ink">Bonifico bancario</p>
            <p className="mt-1 text-justify text-xs text-sage">
              L&apos;ordine resterà in attesa finché non confermiamo il
              pagamento.
            </p>
            <BankTransferForm
              productId={product.id}
              condizioniVersion={condizioniVersion}
              privacyVersion={privacyVersion}
            />
          </div>
        </div>
      </div>
    </main>
  );
}
