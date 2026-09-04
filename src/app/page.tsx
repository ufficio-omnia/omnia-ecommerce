import Link from "next/link";

export default function Home() {
  return (
    <main className="flex flex-1 items-center justify-center px-4">
      <div className="text-center">
        <h1 className="text-3xl font-semibold">OMNIA</h1>
        <p className="mt-2 text-gray-600">Area riservata</p>

        <div className="mt-8 flex justify-center gap-3">
          <Link
            href="/login"
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium hover:bg-gray-50"
          >
            Accedi
          </Link>
          <Link
            href="/registrati"
            className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white"
          >
            Registrati
          </Link>
        </div>

        <Link
          href="/prodotti"
          className="mt-4 inline-block text-sm text-gray-600 underline"
        >
          Vedi i documenti disponibili
        </Link>
      </div>
    </main>
  );
}
