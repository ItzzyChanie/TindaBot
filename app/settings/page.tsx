import { createSupabaseServerClient } from "@/lib/supabase/server";
import { SettingsForm } from "./settings-form";

const SHOP_ID = "00000000-0000-4000-8000-000000000001";

export default async function SettingsPage() {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("shop_settings")
    .select("shipping_rates,payment_instructions,policies,size_chart_url")
    .eq("shop_id", SHOP_ID)
    .maybeSingle();
  return (
    <SettingsForm initialSettings={data} initialError={error?.message ?? ""} />
  );
}
