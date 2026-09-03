import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import SetPasswordForm from "./set-password-form";

export default async function ImpostaPasswordPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold">Imposta la tua password</h1>
        <p className="mt-2 text-sm text-gray-600">
          Account attivato per <span className="font-medium">{user.email}</span>.
          Scegli ora una password per accedere in futuro.
        </p>

        <SetPasswordForm />
      </div>
    </main>
  );
}
