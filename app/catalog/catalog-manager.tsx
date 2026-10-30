"use client";
/* eslint-disable @next/next/no-img-element -- Storage image URLs are configured per Supabase project. */

import { useEffect, useMemo, useState } from "react";
import { quote, type QuotePromo } from "@/supabase/functions/_shared/quote";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type Variant = { id: string; size: string; stock: number };
type Product = {
  id: string;
  name: string;
  aliases: string[];
  description: string;
  image_url: string | null;
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
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  image.close();
  for (const quality of [0.82, 0.68, 0.52, 0.38]) {
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/webp", quality),
    );
    if (blob && blob.size < 300_000)
      return new File([blob], `${crypto.randomUUID()}.webp`, {
        type: "image/webp",
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
  const [products, setProducts] = useState(
    initialProducts.map((product) => ({
      ...product,
      promos: initialPromos.filter((promo) => promo.product_id === product.id),
    })),
  );
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState(loadError);
  const [previewQty, setPreviewQty] = useState(1);
  const [photo, setPhoto] = useState<File | null>(null);
  const [form, setForm] = useState({
    name: initialName,
    aliases: "",
    description: "",
    price: "",
    sizes: "One size:0",
    active: true,
    discountType: "" as "" | "percent" | "fixed",
    discountValue: "",
  });
  useEffect(() => {
    if (initialName) document.querySelector(".catalog-form")?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [initialName]);
  const preview = useMemo(
    () =>
      quote(
        {
          price: Number(form.price) || 0,
          discount_type: form.discountType || null,
          discount_value: Number(form.discountValue) || null,
        },
        previewQty,
        new Date(),
      ),
    [form.price, form.discountType, form.discountValue, previewQty],
  );

  function resetForm() {
    setEditingId(null);
    setPhoto(null);
    setForm({
      name: "",
      aliases: "",
      description: "",
      price: "",
      sizes: "One size:0",
      active: true,
      discountType: "",
      discountValue: "",
    });
  }

  function editProduct(product: Product) {
    setEditingId(product.id);
    setPhoto(null);
    setForm({
      name: product.name,
      aliases: product.aliases.join(", "),
      description: product.description,
      price: String(product.price),
      sizes: product.variants
        .map((variant) => `${variant.size}:${variant.stock}`)
        .join(", "),
      active: product.active,
      discountType: product.discount_type ?? "",
      discountValue:
        product.discount_value == null ? "" : String(product.discount_value),
    });
    setNotice("");
    setError("");
  }

  async function saveProduct(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setNotice("");
    setError("");
    try {
      const supabase = createSupabaseBrowserClient();
      let imageUrl = editingId
        ? (products.find((p) => p.id === editingId)?.image_url ?? null)
        : null;
      if (photo) {
        const compressed = await compressImage(photo);
        const path = `${crypto.randomUUID()}.webp`;
        const { error: uploadError } = await supabase.storage
          .from("product-images")
          .upload(path, compressed, { contentType: "image/webp" });
        if (uploadError) throw uploadError;
        imageUrl = supabase.storage.from("product-images").getPublicUrl(path)
          .data.publicUrl;
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
      };
      let productId = editingId;
      if (productId) {
        const { error: updateError } = await supabase
          .from("products")
          .update(fields)
          .eq("id", productId);
        if (updateError) throw updateError;
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
        const [size, stock] = entry.split(":");
        if (!size?.trim() || !/^\d+$/.test(stock?.trim() ?? ""))
          throw new Error("Enter sizes as Size:stock, for example S:4, M:2.");
        return {
          product_id: productId,
          size: size.trim(),
          stock: Number(stock),
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
        throw new Error("Set removed sizes to zero stock before removing them po.");
      for (const variant of removedVariants) {
        const { error: removeError } = await supabase
          .from("variants")
          .delete()
          .eq("id", variant.id);
        if (removeError) throw removeError;
      }
      setNotice(editingId ? "Product updated po." : "Product added po.");
      resetForm();
      window.history.replaceState(null, "", "/catalog");
      window.location.reload();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not save this product.",
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
      setError(updateError?.message ?? "Stock could not be changed. Refresh and try again po.");
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
    <div className="page-content">
      <div className="page-heading">
        <div>
          <p className="eyebrow">YOUR SHOP</p>
          <h1>Catalog</h1>
          <p className="muted">
            Manage products, sizes, and live customer prices po.
          </p>
        </div>
        <button className="button button-primary" onClick={resetForm}>
          + Add product
        </button>
      </div>
      {(error || notice) && (
        <p
          className={error ? "form-error" : "catalog-notice"}
          role={error ? "alert" : "status"}
        >
          {error || notice}
        </p>
      )}
      <section className="catalog-grid">
        <div className="catalog-products">
          {products.length === 0 ? (
            <div className="panel catalog-empty">
              {loadError
                ? "Could not load products. Check your connection and try again po."
                : "No products yet. Add your first item po."}
            </div>
          ) : (
            products.map((product) => {
              const offer = quote(product, 1, new Date(), product.promos ?? []);
              return (
                <article className="panel product-card" key={product.id}>
                  {product.image_url ? (
                    <img
                      className="product-photo"
                      src={product.image_url}
                      alt=""
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
                        {offer.label ? (
                          <del>{currency(product.price)}</del>
                        ) : null}
                        <strong>{currency(offer.unit)}</strong>
                      </div>
                    </div>
                    {product.aliases.length > 0 && (
                      <p className="muted product-aliases">
                        Also called: {product.aliases.join(", ")}
                      </p>
                    )}
                    <div className="size-chips">
                      {product.variants.map((variant) => (
                        <span className="size-chip" key={variant.id}>
                          <b>{variant.size}</b>
                          <span>{variant.stock} in stock</span>
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
              <p className="eyebrow">
                {editingId ? "UPDATE ITEM" : "NEW ITEM"}
              </p>
              <h2>{editingId ? "Edit product" : "Add product"}</h2>
            </div>
            {editingId && (
              <button type="button" className="text-button" onClick={resetForm}>
                Cancel
              </button>
            )}
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
          <label>
            Sizes and stock <small>Format: S:4, M:2 or One size:8</small>
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
          <button
            className="button button-primary catalog-save"
            disabled={busy}
          >
            {busy ? "Saving…" : editingId ? "Save changes" : "Add to catalog"}
          </button>
        </form>
      </section>
    </div>
  );
}
