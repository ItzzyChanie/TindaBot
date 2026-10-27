import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabasePublicEnv, isSupabasePublicConfigured } from "./lib/supabase/env";

export async function middleware(request: NextRequest) {
  const isLogin = request.nextUrl.pathname === "/login";
  if (!isSupabasePublicConfigured()) {
    return isLogin
      ? NextResponse.next({ request })
      : NextResponse.redirect(new URL("/login", request.url));
  }

  const { url, supabaseKey } = getSupabasePublicEnv();
  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, supabaseKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  const { data: { user } } = await supabase.auth.getUser();

  if (!user && !isLogin) return NextResponse.redirect(new URL("/login", request.url));
  if (user && isLogin) return NextResponse.redirect(new URL("/", request.url));
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
