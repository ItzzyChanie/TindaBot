import { createBrowserClient } from "@supabase/ssr";
import { getSupabasePublicEnv } from "./env";

let browserClient: ReturnType<typeof createBrowserClient> | undefined;

export function createSupabaseBrowserClient() {
  if (!browserClient) {
    const { url, supabaseKey } = getSupabasePublicEnv();
    browserClient = createBrowserClient(url, supabaseKey);
  }
  return browserClient;
}
