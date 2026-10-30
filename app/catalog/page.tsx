import { createSupabaseServerClient } from "@/lib/supabase/server";
import { CatalogManager } from "./catalog-manager";

export default async function CatalogPage({ searchParams }: { searchParams: Promise<{ newProduct?: string }> }) {
  const params = await searchParams;
  const supabase = await createSupabaseServerClient();
  const [{ data: products, error }, { data: promos }] = await Promise.all([
    supabase
      .from("products")
      .select(
        "*, variants(id,size,stock), promos(label,kind,min_qty,value,starts_at,ends_at,active)",
      )
      .order("created_at", { ascending: false }),
    supabase
      .from("promos")
      .select("product_id,label,kind,min_qty,value,starts_at,ends_at,active"),
  ]);
  return (
    <CatalogManager
      initialProducts={error ? [] : (products ?? [])}
      initialPromos={promos ?? []}
      loadError={error?.message ?? ""}
      initialName={params.newProduct?.slice(0, 120) ?? ""}
    />
  );
}
