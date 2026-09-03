import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/app/actions/auth";

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .single();

  return (
    <main className="flex flex-1 flex-col px-4 py-16">
      <div className="mx-auto w-full max-w-2xl">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Dashboard</h1>
          <form action={signOut}>
            <button
              type="submit"
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium hover:bg-gray-50"
            >
              Esci
            </button>
          </form>
        </div>

        <p className="mt-4 text-sm text-gray-600">
          Accesso effettuato come <span className="font-medium">{user.email}</span>.
        </p>

        {profile?.role === "admin" && (
          <Link
            href="/admin"
            className="mt-6 inline-block text-sm font-medium underline"
          >
            Vai al pannello admin
          </Link>
        )}
      </div>
    </main>
  );
}
