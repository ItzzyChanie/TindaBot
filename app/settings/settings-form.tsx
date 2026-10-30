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
  greeting_text: string;
  shipping_text: string;
  faq_answers: Record<string, string>;
};

async function compressSizeChart(file: File): Promise<File> {
  if (!file.type.startsWith("image/"))
    throw new Error("Please choose an image file.");
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
      canvas.toBlob(resolve, "image/webp", quality),
    );
    if (blob && blob.size <= 300_000) {
      return new File([blob], "size-chart.webp", { type: "image/webp" });
    }
  }
  throw new Error(
    "Choose a simpler or smaller size chart image (maximum 300 KB after compression).",
  );
}

function storagePathFromPublicUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const marker = "/storage/v1/object/public/product-images/";
    const pathname = new URL(value).pathname;
    const index = pathname.indexOf(marker);
    return index < 0
      ? null
      : decodeURIComponent(pathname.slice(index + marker.length));
  } catch {
    return null;
  }
}

export function SettingsForm({
  initialSettings,
  initialError,
  sellerName,
  sellerEmail,
}: {
  initialSettings: Settings | null;
  initialError: string;
  sellerName: string;
  sellerEmail: string;
}) {
  const [settings, setSettings] = useState<Settings>({
    shipping_rates: initialSettings?.shipping_rates ?? {},
    payment_instructions: initialSettings?.payment_instructions ?? "",
    policies: initialSettings?.policies ?? "",
    size_chart_url: initialSettings?.size_chart_url ?? null,
    greeting_text: initialSettings?.greeting_text ?? "",
    shipping_text: initialSettings?.shipping_text ?? "",
    faq_answers: initialSettings?.faq_answers ?? {},
  });
  const [name, setName] = useState(sellerName);
  const [sizeChartFile, setSizeChartFile] = useState<File | null>(null);
  const [storedChartUrl, setStoredChartUrl] = useState(
    initialSettings?.size_chart_url ?? null,
  );
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
      const { error: profileError } = await supabase.auth.updateUser({
        data: { full_name: name.trim() },
      });
      if (profileError) throw profileError;
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
        sizeChartUrl = supabase.storage
          .from("product-images")
          .getPublicUrl(uploadedPath).data.publicUrl;
      }
      const { error: saveError } = await supabase
        .from("shop_settings")
        .upsert(
          { shop_id: SHOP_ID, ...settings, size_chart_url: sizeChartUrl },
          { onConflict: "shop_id" },
        );
      if (saveError) {
        if (uploadedPath)
          await supabase.storage.from("product-images").remove([uploadedPath]);
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
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not save shop settings.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page-content settings-page">
      <section className="settings-hero">
        <div>
          <p className="eyebrow">SHOP CONFIGURATION</p>
          <h1>Settings</h1>
          <p>Keep your customer-facing answers accurate and useful.</p>
        </div>
        <span className="settings-hero-note">
          <span className="online-dot" />
          Changes save to your live shop
        </span>
      </section>
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
        <nav className="settings-index" aria-label="Settings sections">
          <a href="#seller-profile">Profile</a>
          <a href="#assistant-replies">Assistant replies</a>
          <a href="#delivery-rates">Delivery</a>
          <a href="#customer-help">Size chart</a>
          <a href="#payment-details">Payment</a>
          <a href="#shop-policies">Policies</a>
        </nav>
        <section>
          <div id="seller-profile" className="settings-anchor" />
          <p className="eyebrow">SELLER PROFILE</p>
          <h2>General information</h2>
          <label className="settings-label">
            Full name
            <input
              required
              maxLength={120}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label className="settings-label">
            Account email
            <input
              type="email"
              value={sellerEmail}
              readOnly
              aria-readonly="true"
            />
          </label>
        </section>
        <section>
          <div id="assistant-replies" className="settings-anchor" />
          <p className="eyebrow">AUTOMATED REPLIES</p>
          <h2>Seller-editable answers</h2>
          <p className="muted">
            These answers are used for matching questions. Replies stay limited
            to the catalog and shop details.
          </p>
          <label className="settings-label">
            Greeting
            <textarea
              rows={3}
              maxLength={1000}
              value={settings.greeting_text}
              onChange={(event) =>
                setSettings({ ...settings, greeting_text: event.target.value })
              }
              placeholder="Kumusta po! Ano pong item ang gusto ninyong itanong?"
            />
          </label>
          <label className="settings-label">
            Shipping details
            <textarea
              rows={3}
              maxLength={1500}
              value={settings.shipping_text}
              onChange={(event) =>
                setSettings({ ...settings, shipping_text: event.target.value })
              }
              placeholder="Add dispatch timing and delivery details that apply to your shop."
            />
          </label>
          <label className="settings-label">
            How to order
            <textarea
              rows={3}
              maxLength={1000}
              value={settings.faq_answers.order_help ?? ""}
              onChange={(event) =>
                setSettings({
                  ...settings,
                  faq_answers: {
                    ...settings.faq_answers,
                    order_help: event.target.value,
                  },
                })
              }
              placeholder="Tell customers what details they should send to place an order."
            />
          </label>
          <label className="settings-label">
            Payment FAQ answer
            <textarea
              rows={3}
              maxLength={1000}
              value={settings.faq_answers.payment ?? ""}
              onChange={(event) =>
                setSettings({
                  ...settings,
                  faq_answers: {
                    ...settings.faq_answers,
                    payment: event.target.value,
                  },
                })
              }
              placeholder="Leave blank to use the payment instructions below."
            />
          </label>
        </section>
        <section>
          <div id="delivery-rates" className="settings-anchor" />
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
        <p className="muted settings-privacy-note">
          Chat messages are retained for 90 days. Customers see a privacy notice
          when chat starts.
        </p>
        <section>
          <div id="customer-help" className="settings-anchor" />
          <p className="eyebrow">CUSTOMER HELP</p>
          <h2>Size chart</h2>
          <p className="muted">
            Upload a size chart image. The assistant will send it when customers
            ask to see the chart.
          </p>
          {settings.size_chart_url && !sizeChartFile && (
            <div className="size-chart-preview">
              {/* eslint-disable-next-line @next/next/no-img-element -- Supabase Storage image URL. */}
              <img
                src={settings.size_chart_url}
                alt="Uploaded shop size chart"
              />
              <button
                className="text-button"
                type="button"
                onClick={() =>
                  setSettings({ ...settings, size_chart_url: null })
                }
              >
                Remove size chart
              </button>
            </div>
          )}
          <label className="settings-label">
            {sizeChartFile
              ? `Selected: ${sizeChartFile.name}`
              : "Upload size chart image"}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(event) =>
                setSizeChartFile(event.target.files?.[0] ?? null)
              }
            />
          </label>
          {sizeChartFile && (
            <button
              className="text-button"
              type="button"
              onClick={() => setSizeChartFile(null)}
            >
              Cancel selected image
            </button>
          )}
          <p className="muted">
            Images are compressed to fit the shop storage limit.
          </p>
        </section>
        <section>
          <div id="payment-details" className="settings-anchor" />
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
          <div id="shop-policies" className="settings-anchor" />
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
