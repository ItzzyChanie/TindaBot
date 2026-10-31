import { createSupabaseServerClient } from "@/lib/supabase/server";
import { SettingsForm } from "./settings-form";

const SHOP_ID = "00000000-0000-4000-8000-000000000001";

export default async function SettingsPage() {
  const supabase = await createSupabaseServerClient();
  const [{ data: userData }, { data, error }] = await Promise.all([
    supabase.auth.getUser(),
    supabase
      .from("shop_settings")
      .select(
        "shipping_rates,payment_instructions,policies,size_chart_url,greeting_text,shipping_text,faq_answers,bot_options",
      )
      .eq("shop_id", SHOP_ID)
      .maybeSingle(),
  ]);
  const emailName = userData.user?.email?.split("@")[0] ?? "";
  const sellerName = String(
    userData.user?.user_metadata?.full_name ??
      userData.user?.user_metadata?.name ??
      emailName.charAt(0).toUpperCase() + emailName.slice(1),
  );
  return (
    <SettingsForm
      initialSettings={data}
      initialError={error?.message ?? ""}
      sellerName={sellerName}
      sellerEmail={userData.user?.email ?? ""}
    />
  );
}
