import Link from "next/link";

export default function CartaSuccessoPage() {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="w-full max-w-md text-center">
        <h1 className="text-2xl font-semibold">Pagamento ricevuto</h1>
        <p className="mt-3 text-sm text-gray-600">
          Grazie per il tuo acquisto. Controlla la tua email: appena
          confermiamo il pagamento riceverai le istruzioni per accedere al
          documento nella tua area riservata.
        </p>

        <Link
          href="/"
          className="mt-6 inline-block text-sm font-medium underline"
        >
          Torna alla home
        </Link>
      </div>
    </main>
  );
}
