"use client";

import { useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

const SHOP_ID = "00000000-0000-4000-8000-000000000001";
const regions = ["Metro Manila", "Luzon", "Visayas", "Mindanao"] as const;
type Region = (typeof regions)[number];
type Settings = {
  shipping_rates: Partial<Record<Region, number>>;
  payment_instructions: string;
  policies: string;
  size_chart_url: string | null;
};

async function compressSizeChart(file: File): Promise<File> {
  if (!file.type.startsWith("image/")) throw new Error("Please choose an image file.");
  const image = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(image.width, image.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(image.width * scale);
  canvas.height = Math.round(image.height * scale);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Could not prepare the size chart image.");
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  image.close();
  for (const quality of [0.86, 0.72, 0.58, 0.44, 0.3]) {
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/webp", quality)
    );
    if (blob && blob.size <= 300_000) {
      return new File([blob], "size-chart.webp", { type: "image/webp" });
    }
  }
  throw new Error("Choose a simpler or smaller size chart image (maximum 300 KB after compression).");
}

function storagePathFromPublicUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const marker = "/storage/v1/object/public/product-images/";
    const pathname = new URL(value).pathname;
    const index = pathname.indexOf(marker);
    return index < 0 ? null : decodeURIComponent(pathname.slice(index + marker.length));
  } catch {
    return null;
  }
}

export function SettingsForm({
  initialSettings,
  initialError,
}: {
  initialSettings: Settings | null;
  initialError: string;
}) {
  const [settings, setSettings] = useState<Settings>({
    shipping_rates: initialSettings?.shipping_rates ?? {},
    payment_instructions: initialSettings?.payment_instructions ?? "",
    policies: initialSettings?.policies ?? "",
    size_chart_url: initialSettings?.size_chart_url ?? null,
  });
  const [sizeChartFile, setSizeChartFile] = useState<File | null>(null);
  const [storedChartUrl, setStoredChartUrl] = useState(initialSettings?.size_chart_url ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(initialError);
  const [notice, setNotice] = useState("");

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const supabase = createSupabaseBrowserClient();
      const previousUrl = storedChartUrl;
      let sizeChartUrl = settings.size_chart_url;
      let uploadedPath: string | null = null;
      if (sizeChartFile) {
        const compressed = await compressSizeChart(sizeChartFile);
        uploadedPath = `size-charts/${SHOP_ID}/${crypto.randomUUID()}.webp`;
        const { error: uploadError } = await supabase.storage
          .from("product-images")
          .upload(uploadedPath, compressed, { contentType: "image/webp" });
        if (uploadError) throw uploadError;
        sizeChartUrl = supabase.storage.from("product-images")
          .getPublicUrl(uploadedPath).data.publicUrl;
      }
      const { error: saveError } = await supabase.from("shop_settings")
        .upsert({ shop_id: SHOP_ID, ...settings, size_chart_url: sizeChartUrl }, { onConflict: "shop_id" });
      if (saveError) {
        if (uploadedPath) await supabase.storage.from("product-images").remove([uploadedPath]);
        throw saveError;
      }
      const previousPath = storagePathFromPublicUrl(previousUrl);
      const nextPath = storagePathFromPublicUrl(sizeChartUrl);
      if (previousPath && previousPath !== nextPath)
        await supabase.storage.from("product-images").remove([previousPath]);
      setSettings((current) => ({ ...current, size_chart_url: sizeChartUrl }));
      setStoredChartUrl(sizeChartUrl);
      setSizeChartFile(null);
      setNotice("Shop settings saved po.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save shop settings.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page-content">
      <div className="page-heading">
        <div>
          <p className="eyebrow">YOUR SHOP</p>
          <h1>Settings</h1>
          <p className="muted">
            Keep delivery, payment, and shop policies up to date po.
          </p>
        </div>
      </div>
      {(error || notice) && (
        <p
          className={error ? "form-error" : "catalog-notice"}
          role={error ? "alert" : "status"}
        >
          {error || notice}
        </p>
      )}
      <form
        className="panel settings-form"
        onSubmit={(event) => void save(event)}
      >
        <section>
          <p className="eyebrow">DELIVERY</p>
          <h2>Shipping rates</h2>
          <p className="muted">
            Enter the delivery fee for each area in pesos.
          </p>
          <div className="shipping-grid">
            {regions.map((region) => (
              <label key={region}>
                {region}
                <span className="currency-input">
                  ₱
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={settings.shipping_rates[region] ?? ""}
                    onChange={(event) =>
                      setSettings({
                        ...settings,
                        shipping_rates: {
                          ...settings.shipping_rates,
                          [region]:
                            event.target.value === ""
                              ? undefined
                              : Number(event.target.value),
                        },
                      })
                    }
                  />
                </span>
              </label>
            ))}
          </div>
        </section>
        <section>
          <p className="eyebrow">CUSTOMER HELP</p>
          <h2>Size chart</h2>
          <p className="muted">
            Upload a size chart image. The assistant will send it when customers ask to see the chart.
          </p>
          {settings.size_chart_url && !sizeChartFile && (
            <div className="size-chart-preview">
              {/* eslint-disable-next-line @next/next/no-img-element -- Supabase Storage image URL. */}
              <img src={settings.size_chart_url} alt="Uploaded shop size chart" />
              <button
                className="text-button"
                type="button"
                onClick={() => setSettings({ ...settings, size_chart_url: null })}
              >
                Remove size chart
              </button>
            </div>
          )}
          <label className="settings-label">
            {sizeChartFile ? `Selected: ${sizeChartFile.name}` : "Upload size chart image"}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(event) => setSizeChartFile(event.target.files?.[0] ?? null)}
            />
          </label>
          {sizeChartFile && (
            <button className="text-button" type="button" onClick={() => setSizeChartFile(null)}>
              Cancel selected image
            </button>
          )}
          <p className="muted">Images are compressed to fit the shop storage limit.</p>
        </section>
        <section>
          <p className="eyebrow">PAYMENT</p>
          <h2>Payment instructions</h2>
          <label className="settings-label">
            Instructions customers will receive
            <textarea
              rows={4}
              value={settings.payment_instructions}
              onChange={(event) =>
                setSettings({
                  ...settings,
                  payment_instructions: event.target.value,
                })
              }
              placeholder="Share your accepted payment methods and where to send proof of payment."
            />
          </label>
        </section>
        <section>
          <p className="eyebrow">SHOP POLICIES</p>
          <h2>Policies</h2>
          <label className="settings-label">
            Returns, exchanges, and other policies
            <textarea
              rows={5}
              value={settings.policies}
              onChange={(event) =>
                setSettings({ ...settings, policies: event.target.value })
              }
              placeholder="Add the policies you want the assistant and seller to reference."
            />
          </label>
        </section>
        <button className="button button-primary" disabled={busy}>
          {busy ? "Saving…" : "Save settings"}
        </button>
      </form>
    </div>
  );
}
