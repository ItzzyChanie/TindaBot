"use client";
/* eslint-disable @next/next/no-img-element -- Storage image URLs are configured per Supabase project. */

import { useEffect, useMemo, useState } from "react";
import { formatOfferDateTime, offerTiming, quote, type QuotePromo } from "@/supabase/functions/_shared/quote";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type Variant = { id: string; size: string; stock: number; reserved_stock: number; price: number | null };
type Product = {
  id: string;
  name: string;
  aliases: string[];
  description: string;
  image_url: string | null;
  colors: string[];
  material: string;
  fabric_details: string;
  fit_notes: string;
  size_guidance: string;
  restock_note: string;
  model_details: string;
  photos_are_actual: boolean;
  additional_images: string[];
  video_url: string;
  price: number;
  active: boolean;
  discount_type: "percent" | "fixed" | null;
  discount_value: number | null;
  discount_starts: string | null;
  discount_ends: string | null;
  variants: Variant[];
  promos?: QuotePromo[];
};
type ProductPromo = QuotePromo & { product_id?: string };
const currency = (amount: number) =>
  `₱${amount.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

async function compressImage(file: File): Promise<File> {
  const image = await createImageBitmap(file);
  const scale = Math.min(1, 1400 / Math.max(image.width, image.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(image.width * scale);
  canvas.height = Math.round(image.height * scale);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Could not prepare this photo.");
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  image.close();
  for (const quality of [0.82, 0.68, 0.52, 0.38]) {
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", quality),
    );
    if (blob && blob.size < 300_000)
      return new File([blob], `${crypto.randomUUID()}.jpg`, {
        type: "image/jpeg",
      });
  }
  throw new Error("Choose a smaller photo. Photos must compress under 300 KB.");
}

export function CatalogManager({
  initialProducts,
  initialPromos,
  loadError,
  initialName,
}: {
  initialProducts: Product[];
  initialPromos: ProductPromo[];
  loadError: string;
  initialName: string;
}) {
  const [products, setProducts] = useState<Product[]>(
    initialProducts.map((product) => ({
      ...product,
      promos: initialPromos.filter((promo) => promo.product_id === product.id),
    })),
  );
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState(loadError);
  const [query, setQuery] = useState("");
  const [previewQty, setPreviewQty] = useState(1);
  const [currentTime, setCurrentTime] = useState(() => new Date());
  const [photo, setPhoto] = useState<File | null>(null);
  const [extraPhotos, setExtraPhotos] = useState<File[]>([]);
  const [form, setForm] = useState({
    name: initialName,
    aliases: "",
    description: "",
    price: "",
    sizes: "One size:0",
    active: true,
    discountType: "" as "" | "percent" | "fixed",
    discountValue: "",
    discountStarts: "",
    discountEnds: "",
    colors: "",
    material: "",
    fabricDetails: "",
    fitNotes: "",
    sizeGuidance: "",
    restockNote: "",
    modelDetails: "",
    photosAreActual: false,
    additionalImages: "",
    videoUrl: "",
  });
  const editingProduct = products.find((product) => product.id === editingId);
  useEffect(() => {
    const timer = window.setInterval(() => setCurrentTime(new Date()), 10_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (initialName)
      document
        .querySelector(".catalog-form")
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [initialName]);
  const preview = useMemo(
    () =>
      quote(
        {
          price: Number(form.price) || 0,
          discount_type: form.discountType || null,
          discount_value: Number(form.discountValue) || null,
          discount_starts: form.discountStarts ? `${form.discountStarts}:00+08:00` : null,
          discount_ends: form.discountEnds ? `${form.discountEnds}:00+08:00` : null,
        },
        previewQty,
        currentTime,
        editingProduct?.promos ?? [],
      ),
    [form.price, form.discountType, form.discountValue, form.discountStarts, form.discountEnds, previewQty, editingProduct, currentTime],
  );
  const visibleProducts = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return products;
    return products.filter((product) =>
      `${product.name} ${product.description} ${product.aliases.join(" ")}`
        .toLocaleLowerCase()
        .includes(normalized),
    );
  }, [products, query]);

  function resetForm() {
    setEditingId(null);
    setPhoto(null);
    setExtraPhotos([]);
    setForm({
      name: "",
      aliases: "",
      description: "",
      price: "",
      sizes: "One size:0",
      active: true,
      discountType: "",
      discountValue: "",
      discountStarts: "",
      discountEnds: "",
      colors: "",
      material: "",
      fabricDetails: "",
      fitNotes: "",
      sizeGuidance: "",
      restockNote: "",
      modelDetails: "",
      photosAreActual: false,
      additionalImages: "",
      videoUrl: "",
    });
  }

  function editProduct(product: Product) {
    setEditingId(product.id);
    setPhoto(null);
    setExtraPhotos([]);
    setForm({
      name: product.name,
      aliases: product.aliases.join(", "),
      description: product.description,
      price: String(product.price),
      sizes: product.variants
        .map((variant) => `${variant.size}:${variant.stock}${variant.price == null ? "" : `:${variant.price}`}`)
        .join(", "),
      active: product.active,
      discountType: product.discount_type ?? "",
      discountValue:
        product.discount_value == null ? "" : String(product.discount_value),
      discountStarts: product.discount_starts ? toManilaDateTimeInput(product.discount_starts) : "",
      discountEnds: product.discount_ends ? toManilaDateTimeInput(product.discount_ends) : "",
      colors: (product.colors ?? []).join(", "),
      material: product.material ?? "",
      fabricDetails: product.fabric_details ?? "",
      fitNotes: product.fit_notes ?? "",
      sizeGuidance: product.size_guidance ?? "",
      restockNote: product.restock_note ?? "",
      modelDetails: product.model_details ?? "",
      photosAreActual: product.photos_are_actual ?? false,
      additionalImages: (product.additional_images ?? []).join("\n"),
      videoUrl: product.video_url ?? "",
    });
    setNotice("");
    setError("");
  }

  function toManilaDateTimeInput(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(date);
    const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
    return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
  }

  async function saveProduct(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setNotice("");
    setError("");
    try {
      if (form.discountType && (!form.discountStarts || !form.discountEnds))
        throw new Error("Add the offer start and end date/time po.");
      if (form.discountType && new Date(`${form.discountEnds}:00+08:00`) <= new Date(`${form.discountStarts}:00+08:00`))
        throw new Error("Offer end date/time must be after its start date/time po.");
      const supabase = createSupabaseBrowserClient();
      let imageUrl = editingId
        ? (products.find((p) => p.id === editingId)?.image_url ?? null)
        : null;
      if (photo) {
        const compressed = await compressImage(photo);
        const path = `${crypto.randomUUID()}.jpg`;
        const { error: uploadError } = await supabase.storage
          .from("product-images")
          .upload(path, compressed, { contentType: "image/jpeg" });
        if (uploadError) throw uploadError;
        imageUrl = supabase.storage.from("product-images").getPublicUrl(path)
          .data.publicUrl;
      }
      const additionalImages = form.additionalImages.split(/\r?\n/).map((url) => url.trim()).filter(Boolean);
      if (extraPhotos.length + additionalImages.length > 8)
        throw new Error("Use up to 8 additional product photos.");
      const uploadedImages: string[] = [];
      for (const file of extraPhotos) {
        const compressed = await compressImage(file);
        const path = `${crypto.randomUUID()}.jpg`;
        const { error: uploadError } = await supabase.storage
          .from("product-images")
          .upload(path, compressed, { contentType: "image/jpeg" });
        if (uploadError) throw uploadError;
        uploadedImages.push(supabase.storage.from("product-images").getPublicUrl(path).data.publicUrl);
      }
      const allAdditionalImages = [...additionalImages, ...uploadedImages];
      for (const url of allAdditionalImages) {
        try {
          if (new URL(url).protocol !== "https:") throw new Error();
        } catch {
          throw new Error("Additional photo links must be valid HTTPS URLs.");
        }
      }
      if (form.videoUrl.trim()) {
        try {
          if (new URL(form.videoUrl.trim()).protocol !== "https:") throw new Error();
        } catch {
          throw new Error("The video link must be a valid HTTPS URL.");
        }
      }
      const fields = {
        name: form.name.trim(),
        aliases: form.aliases
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean),
        description: form.description.trim(),
        price: Number(form.price),
        active: form.active,
        image_url: imageUrl,
        discount_type: form.discountType || null,
        discount_value: form.discountType ? Number(form.discountValue) : null,
        discount_starts: form.discountType ? `${form.discountStarts}:00+08:00` : null,
        discount_ends: form.discountType ? `${form.discountEnds}:00+08:00` : null,
        colors: form.colors.split(",").map((value) => value.trim()).filter(Boolean),
        material: form.material.trim(),
        fabric_details: form.fabricDetails.trim(),
        fit_notes: form.fitNotes.trim(),
        size_guidance: form.sizeGuidance.trim(),
        restock_note: form.restockNote.trim(),
        model_details: form.modelDetails.trim(),
        photos_are_actual: form.photosAreActual,
        additional_images: allAdditionalImages,
        video_url: form.videoUrl.trim(),
      };
      let productId = editingId;
      if (productId) {
        const { data: updatedProduct, error: updateError } = await supabase
          .from("products")
          .update(fields)
          .eq("id", productId)
          .select("id,price")
          .maybeSingle();
        if (updateError) throw updateError;
        if (!updatedProduct || Number(updatedProduct.price) !== Number(fields.price))
          throw new Error("The product price was not saved. Refresh and try again po.");
      } else {
        const { data, error: insertError } = await supabase
          .from("products")
          .insert(fields)
          .select("id")
          .single();
        if (insertError) throw insertError;
        productId = data.id;
      }
      const variants = form.sizes.split(",").map((entry) => {
        const [size, stock, price] = entry.split(":").map((part) => part.trim());
        if (!size || !/^\d+$/.test(stock ?? "") || (price && (!/^\d+(\.\d{1,2})?$/.test(price) || Number(price) < 0)))
          throw new Error("Enter sizes as Size:stock[:price], for example S:4:350, M:2. Leave price blank to use the product price.");
        return {
          product_id: productId,
          size,
          stock: Number(stock),
          price: price ? Number(price) : null,
        };
      });
      const savedId = productId;
      if (!savedId) throw new Error("Product could not be saved.");
      const previousVariants =
        products.find((product) => product.id === savedId)?.variants ?? [];
      for (const variant of variants) {
        const previous = previousVariants.find(
          (item) => item.size === variant.size,
        );
        if (!previous) {
          const { error: insertVariantError } = await supabase
            .from("variants")
            .insert(variant);
          if (insertVariantError) throw insertVariantError;
        } else {
          if (previous.price !== variant.price) {
            const { data: priceUpdated, error: priceError } = await supabase.rpc(
              "set_variant_price",
              { p_variant: previous.id, p_price: variant.price },
            );
            if (priceError) throw priceError;
            if (!priceUpdated)
              throw new Error(`Could not update the ${variant.size} price. Refresh and try again po.`);
          }
          const delta = variant.stock - previous.stock;
          if (delta !== 0) {
            const { data: stock, error: stockError } = await supabase.rpc(
              "adjust_variant_stock",
              { p_variant: previous.id, p_delta: delta },
            );
            if (stockError) throw stockError;
            if (stock === null)
              throw new Error(
                `Could not update ${variant.size} stock. Refresh and try again po.`,
              );
          }
        }
      }
      const retainedSizes = new Set(variants.map((variant) => variant.size));
      const removedVariants = previousVariants.filter(
        (variant) => !retainedSizes.has(variant.size),
      );
      if (removedVariants.some((variant) => variant.stock > 0))
        throw new Error(
          "Set removed sizes to zero stock before removing them po.",
        );
      for (const variant of removedVariants) {
        const { error: removeError } = await supabase
          .from("variants")
          .delete()
          .eq("id", variant.id);
        if (removeError) throw removeError;
      }
      setNotice(editingId ? "Product updated po." : "Product added po.");
      const { data: refreshedProducts, error: refreshError } = await supabase
        .from("products")
        .select(
        "*, variants(id,size,stock,reserved_stock,price), promos(label,kind,min_qty,value,starts_at,ends_at,active)",
        )
        .order("updated_at", { ascending: false })
        .order("created_at", { ascending: false });
      if (refreshError)
        setNotice("Saved po. Refresh this page to update the product list.");
      else setProducts((refreshedProducts ?? []) as unknown as Product[]);
      resetForm();
      window.history.replaceState(null, "", "/catalog");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : typeof cause === "object" && cause !== null && "message" in cause
            ? String(cause.message)
            : "Could not save this product.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function adjustStock(variant: Variant, change: number) {
    setError("");
    const { data: stock, error: updateError } =
      await createSupabaseBrowserClient().rpc("adjust_variant_stock", {
        p_variant: variant.id,
        p_delta: change,
      });
    if (updateError || stock === null) {
      setError(
        updateError?.message ??
          "Stock could not be changed. Refresh and try again po.",
      );
      return;
    }
    setProducts((current) =>
      current.map((product) => ({
        ...product,
        variants: product.variants.map((item) =>
          item.id === variant.id ? { ...item, stock } : item,
        ),
      })),
    );
  }

  async function deleteProduct(product: Product) {
    if (!window.confirm(`Delete ${product.name}?`)) return;
    const { error: deleteError } = await createSupabaseBrowserClient()
      .from("products")
      .delete()
      .eq("id", product.id);
    if (deleteError) {
      setError(deleteError.message);
      return;
    }
    setProducts((current) => current.filter((item) => item.id !== product.id));
  }

  return (
    <div className="page-content catalog-page">
      <section className="catalog-hero">
        <div>
          <p className="eyebrow">PRODUCT MANAGEMENT</p>
          <h1>Your catalog</h1>
          <p>
            Keep product details, sizes, and stock accurate. Changes update the
            customer shop.
          </p>
        </div>
        <div className="catalog-hero-count">
          <strong>{products.length}</strong>
          <span>listed styles</span>
        </div>
      </section>
      {(error || notice) && (
        <p
          className={error ? "form-error" : "catalog-notice"}
          role={error ? "alert" : "status"}
        >
          {error || notice}
        </p>
      )}
      <div className="panel catalog-toolbar">
        <label>
          <span className="sr-only">Search products</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search products and aliases"
          />
        </label>
        <span className="muted">
          {visibleProducts.length} of {products.length} products
        </span>
      </div>
      <section className="catalog-grid">
        <div className="catalog-products">
          {products.length === 0 ? (
            <div className="panel catalog-empty">
              {loadError
                ? "Could not load products. Check your connection and try again po."
                : "No products yet. Add your first item po."}
            </div>
          ) : visibleProducts.length === 0 ? (
            <div className="panel catalog-empty">
              No products match “{query}”.
            </div>
          ) : (
            visibleProducts.map((product) => {
              const offer = quote(product, 1, currentTime, product.promos ?? []);
              const timing = offerTiming(product.discount_starts, product.discount_ends, currentTime);
              const offerStart = formatOfferDateTime(product.discount_starts);
              const offerEnd = formatOfferDateTime(product.discount_ends);
              return (
                <article className="panel product-card" key={product.id}>
                  {product.image_url ? (
                    <img
                      className="product-photo"
                      src={product.image_url}
                      alt={product.name}
                      width={184}
                      height={208}
                      loading="lazy"
                      decoding="async"
                    />
                  ) : (
                    <div
                      className="product-photo product-photo-placeholder"
                      aria-hidden="true"
                    >
                      ◇
                    </div>
                  )}
                  <div className="product-info">
                    <div className="product-heading">
                      <div>
                        <h2>{product.name}</h2>
                        <span
                          className={
                            product.active ? "stock-status" : "inactive-status"
                          }
                        >
                          {product.active ? "Active" : "Hidden"}
                        </span>
                      </div>
                      <div className="product-price">
                        {product.discount_type && offerStart && offerEnd && (
                          <small className={`offer-schedule${timing.active && timing.daysLeft !== null && timing.daysLeft <= 3 ? " offer-ending-soon" : ""}`}>
                            {offerStart} – {offerEnd}
                            {timing.active && timing.daysLeft !== null && timing.daysLeft <= 3 && (
                              <b className="offer-urgency">
                                {timing.daysLeft <= 1 ? "Ends today. Buy now!" : `${timing.daysLeft} days left. Buy now!`}
                              </b>
                            )}
                          </small>
                        )}
                        {offer.label ? (
                          <>
                            <span className="offer-badge">{offer.label}</span>
                            <del>{currency(product.price)}</del>
                          </>
                        ) : null}
                        <strong>{currency(offer.unit)}</strong>
                      </div>
                    </div>
                    {product.aliases.length > 0 && (
                      <p className="muted product-aliases">
                        Also called: {product.aliases.join(", ")}
                      </p>
                    )}
                    {product.colors?.length > 0 && <p className="muted product-aliases">Colors: {product.colors.join(", ")}</p>}
                    <div className="size-chips">
                      {product.variants.map((variant) => (
                        <span className="size-chip" key={variant.id}>
                          <b>{variant.size}</b>
                          <span>{currency(variant.price ?? product.price)}</span>
                          <span>{variant.stock} in stock</span>
                          <span>{variant.reserved_stock ?? 0} reserved</span>
                          <button
                            onClick={() => void adjustStock(variant, -1)}
                            aria-label={`Remove one ${variant.size} from stock`}
                            disabled={variant.stock === 0}
                          >
                            −
                          </button>
                          <button
                            onClick={() => void adjustStock(variant, 1)}
                            aria-label={`Add one ${variant.size} to stock`}
                          >
                            +
                          </button>
                        </span>
                      ))}
                    </div>
                    <div className="product-actions">
                      <button
                        className="text-button"
                        onClick={() => editProduct(product)}
                      >
                        Edit
                      </button>
                      <button
                        className="text-button danger-text"
                        onClick={() => void deleteProduct(product)}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </article>
              );
            })
          )}
        </div>
        <form
          className="panel catalog-form"
          onSubmit={(event) => void saveProduct(event)}
        >
          <div className="panel-heading">
            <div>
              <span className="catalog-form-number">
                {editingId ? "EDIT" : "NEW"}
              </span>
              <p className="eyebrow">
                {editingId ? "UPDATE ITEM" : "ADD TO YOUR SHOP"}
              </p>
              <h2>{editingId ? "Edit product" : "Add product"}</h2>
            </div>
          </div>
          <label>
            Product name
            <input
              required
              value={form.name}
              onChange={(event) =>
                setForm({ ...form, name: event.target.value })
              }
            />
          </label>
          <label>
            Other names customers use
            <input
              value={form.aliases}
              placeholder="linen blouse, Isla top"
              onChange={(event) =>
                setForm({ ...form, aliases: event.target.value })
              }
            />
          </label>
          <label>
            Description
            <textarea
              value={form.description}
              onChange={(event) =>
                setForm({ ...form, description: event.target.value })
              }
              rows={2}
            />
          </label>
          <label>
            Price
            <input
              type="number"
              min="0"
              step="0.01"
              required
              value={form.price}
              onChange={(event) =>
                setForm({ ...form, price: event.target.value })
              }
            />
          </label>
          <div className="discount-fields">
            <label>
              Offer
              <select
                value={form.discountType}
                onChange={(event) =>
                  setForm({
                    ...form,
                    discountType: event.target.value as
                      | ""
                      | "percent"
                      | "fixed",
                  })
                }
              >
                <option value="">No offer</option>
                <option value="percent">Percent off</option>
                <option value="fixed">Fixed ₱ off</option>
              </select>
            </label>
            {form.discountType && (
              <label>
                Value
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.discountValue}
                  onChange={(event) =>
                    setForm({ ...form, discountValue: event.target.value })
                  }
                />
              </label>
            )}
          </div>
          {form.discountType && (
            <div className="discount-window-fields">
              <label>
                Offer starts (PHT)
                <input type="datetime-local" required value={form.discountStarts} onChange={(event) => setForm({ ...form, discountStarts: event.target.value })} />
              </label>
              <label>
                Offer ends (PHT)
                <input type="datetime-local" required value={form.discountEnds} onChange={(event) => setForm({ ...form, discountEnds: event.target.value })} />
              </label>
            </div>
          )}
          <label>
            Sizes, stock, and optional price <small>Format: S:4:350, M:2; omitted price uses the product price</small>
            <input
              required
              value={form.sizes}
              onChange={(event) =>
                setForm({ ...form, sizes: event.target.value })
              }
            />
          </label>
          <label className="photo-input">
            Product photo <small>Compressed to under 300 KB</small>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(event) => setPhoto(event.target.files?.[0] ?? null)}
            />
          </label>
          <label>
            Available colors <small>Keep this list current for the bot</small>
            <input value={form.colors} onChange={(event) => setForm({ ...form, colors: event.target.value })} placeholder="Black, cream, sage" />
          </label>
          <label>
            Material
            <input maxLength={160} value={form.material} onChange={(event) => setForm({ ...form, material: event.target.value })} placeholder="Cotton blend" />
          </label>
          <label>
            Thickness, opacity, and stretch notes
            <textarea rows={2} maxLength={500} value={form.fabricDetails} onChange={(event) => setForm({ ...form, fabricDetails: event.target.value })} placeholder="Seller-verified details only" />
          </label>
          <label>
            Fit notes <small>For true-to-size or loose/tight sizing questions</small>
            <textarea rows={2} maxLength={500} value={form.fitNotes} onChange={(event) => setForm({ ...form, fitNotes: event.target.value })} />
          </label>
          <label>
            Size guidance <small>Include only ranges you have verified, e.g. height and weight</small>
            <textarea rows={3} maxLength={1000} value={form.sizeGuidance} onChange={(event) => setForm({ ...form, sizeGuidance: event.target.value })} />
          </label>
          <label>
            Restock update <small>Leave blank if there is no confirmed update</small>
            <input maxLength={240} value={form.restockNote} onChange={(event) => setForm({ ...form, restockNote: event.target.value })} placeholder="Expected around mid-November" />
          </label>
          <label>
            Model details
            <input maxLength={300} value={form.modelDetails} onChange={(event) => setForm({ ...form, modelDetails: event.target.value })} placeholder="Height, weight, and size worn (if confirmed)" />
          </label>
          <label>
            Additional product photos <small>Upload or paste one HTTPS URL per line (up to 8)</small>
            <textarea rows={3} maxLength={2000} value={form.additionalImages} onChange={(event) => setForm({ ...form, additionalImages: event.target.value })} placeholder="https://..." />
            <input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(event) => setExtraPhotos(Array.from(event.target.files ?? []))} />
            {extraPhotos.length > 0 && <small>{extraPhotos.length} additional photo(s) selected</small>}
          </label>
          <label className="active-toggle">
            <input type="checkbox" checked={form.photosAreActual} onChange={(event) => setForm({ ...form, photosAreActual: event.target.checked })} />
            Seller confirms photos show the actual item
          </label>
          <label>
            Product video link <small>HTTPS link only</small>
            <input type="url" value={form.videoUrl} onChange={(event) => setForm({ ...form, videoUrl: event.target.value })} placeholder="https://..." />
          </label>
          <label className="active-toggle">
            <input
              type="checkbox"
              checked={form.active}
              onChange={(event) =>
                setForm({ ...form, active: event.target.checked })
              }
            />{" "}
            Show as active
          </label>
          <div className="price-preview">
            <span>Customer price preview</span>
            <label>
              Qty{" "}
              <input
                aria-label="Preview quantity"
                type="number"
                min="1"
                max="99"
                value={previewQty}
                onChange={(event) =>
                  setPreviewQty(Math.max(1, Number(event.target.value) || 1))
                }
              />
            </label>
            <strong>{currency(preview.total)}</strong>
            {preview.label && <small>{preview.label}</small>}
          </div>
          <div className="catalog-form-actions">
            <button type="button" className="text-button" onClick={resetForm}>
              Cancel
            </button>
            <button
              className="button button-primary catalog-save"
              disabled={busy}
            >
              {busy ? "Saving…" : editingId ? "Save changes" : "Add to catalog"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
