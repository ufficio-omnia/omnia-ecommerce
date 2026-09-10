// Header ridotto per le pagine di pagamento (Stripe Checkout esterno,
// conferma ordine, istruzioni bonifico): solo il marchio, non cliccabile,
// nessun collegamento verso l'esterno — ogni via d'uscita durante il
// pagamento è un ordine perso.
export default function CheckoutHeader() {
  return (
    <header className="border-b border-border bg-cream-soft/90">
      <div className="mx-auto flex max-w-5xl items-center gap-2.5 px-4 py-3 sm:px-6">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/omnia-logo.png" alt="" className="h-8 w-8" />
        <span className="font-serif text-lg font-semibold tracking-tight text-ink">
          OMNIA
        </span>
      </div>
    </header>
  );
}
