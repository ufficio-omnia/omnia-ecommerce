import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { CONSOLE_PERCORSI_PUBBLICI, type Zone } from "@/lib/zone";

export async function updateSession(request: NextRequest, zone: Zone = "ecommerce") {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // IMPORTANT: do not remove this call. It refreshes the auth token and
  // keeps server components in sync with the client's session cookie.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Sulla console TUTTO richiede una sessione, tranne i pochi percorsi di
  // accesso (lista in zone.ts): è solo la prima barriera, il ruolo admin lo
  // verifica poi ogni pagina e ogni azione (src/lib/console/accesso.ts).
  const isProtectedRoute =
    zone === "console"
      ? !CONSOLE_PERCORSI_PUBBLICI.includes(request.nextUrl.pathname)
      : request.nextUrl.pathname.startsWith("/dashboard") ||
        request.nextUrl.pathname.startsWith("/admin");

  if (!user && isProtectedRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
