"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { PageHeader } from "../nav";
import { emitToast } from "@/lib/toast";

/**
 * Kitchen helper: scan recipes from cookbook photos (Claude vision extracts
 * the text — the photo isn't stored), browse/search the library, and cook
 * from a detail view with an ingredient checklist. "What can I cook?" hands
 * off to Brocco in chat, where dictating ingredients already works via voice.
 */

interface Recipe {
  id: string;
  title: string;
  ingredients: string[];
  steps: string[];
  tags: string[];
  servings: number | null;
  timeMin: number | null;
  source: string;
  notes: string | null;
  timesCooked: number;
  updatedAt: string;
}

/** Downscale a photo to ~1400px JPEG so uploads stay small and scans fast. */
async function resizeImage(file: File): Promise<{ data: string; mediaType: string }> {
  const bitmap = await createImageBitmap(file);
  const maxDim = 1400;
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const dataUrl = canvas.toDataURL("image/jpeg", 0.82);
  return { data: dataUrl.split(",")[1], mediaType: "image/jpeg" };
}

function RecipeSheet({
  recipe,
  isNewScan,
  onClose,
  onChanged,
}: {
  recipe: Recipe;
  isNewScan: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [saving, setSaving] = useState(false);
  // Edit form state
  const [title, setTitle] = useState(recipe.title);
  const [servings, setServings] = useState(recipe.servings?.toString() || "");
  const [timeMin, setTimeMin] = useState(recipe.timeMin?.toString() || "");
  const [tags, setTags] = useState(recipe.tags.join(", "));
  const [ingredients, setIngredients] = useState(recipe.ingredients.join("\n"));
  const [steps, setSteps] = useState(recipe.steps.join("\n"));

  const inputCls = "field";

  async function handleSaveEdit() {
    setSaving(true);
    try {
      const res = await fetch(`/api/recipes/${recipe.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          servings: servings ? Number(servings) : null,
          timeMin: timeMin ? Number(timeMin) : null,
          tags: tags.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean),
          ingredients: ingredients.split("\n").map((i) => i.trim()).filter(Boolean),
          steps: steps.split("\n").map((s) => s.trim()).filter(Boolean),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        emitToast({ text: data.error || "Couldn't save — check the fields.", kind: "error" });
        return;
      }
      emitToast({ text: `Saved: ${title.trim()}`, kind: "success" });
      onChanged();
      onClose();
    } finally {
      setSaving(false);
    }
  }

  async function handleDiscardScan() {
    await fetch(`/api/recipes/${recipe.id}`, { method: "DELETE" }).catch(() => {});
    onChanged();
    onClose();
  }

  async function handleDelete() {
    const res = await fetch(`/api/recipes/${recipe.id}`, { method: "DELETE" });
    if (!res.ok) {
      emitToast({ text: "Couldn't delete — try again.", kind: "error" });
      return;
    }
    onChanged();
    onClose();
    const snapshot = {
      title: recipe.title, ingredients: recipe.ingredients, steps: recipe.steps,
      tags: recipe.tags, servings: recipe.servings, timeMin: recipe.timeMin, notes: recipe.notes, source: recipe.source,
    };
    emitToast({
      text: `Deleted: ${recipe.title}`,
      kind: "info",
      action: {
        label: "Undo",
        run: async () => {
          await fetch("/api/recipes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(snapshot) });
          onChanged();
        },
      },
    });
  }


  async function handleCooked() {
    const res = await fetch(`/api/recipes/${recipe.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cooked: true }),
    });
    if (res.ok) {
      emitToast({ text: `Enjoy! 🥦 Logged: ${recipe.title}`, kind: "success" });
      onChanged();
      onClose();
    }
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-end md:items-center justify-center">
      <div className="absolute inset-0 bg-ink/40" onClick={isNewScan ? undefined : onClose} />
      <div className="relative w-full md:max-w-lg bg-paper border-2 border-ink rounded-t-2xl md:rounded-2xl md:shadow-[4px_4px_0_var(--color-shade)] max-h-[92vh] flex flex-col safe-bottom">
        <div className="flex items-center justify-between px-4 pt-4 pb-2 flex-shrink-0">
          <h2 className="text-sm font-extrabold text-ink">
            {isNewScan ? "📸 Scanned — check it over" : editing ? "Edit recipe" : ""}
          </h2>
          {!isNewScan && (
            <button onClick={onClose} className="text-moss hover:text-ink text-xl leading-none">&times;</button>
          )}
        </div>

        <div className="px-4 pb-4 overflow-y-auto">
          {editing || isNewScan ? (
            <div className="space-y-2.5">
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" className={inputCls} />
              <div className="grid grid-cols-2 gap-2">
                <input type="number" value={servings} onChange={(e) => setServings(e.target.value)} placeholder="Servings" className={inputCls} />
                <input type="number" value={timeMin} onChange={(e) => setTimeMin(e.target.value)} placeholder="Time (min)" className={inputCls} />
              </div>
              <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="Tags, comma-separated" className={inputCls} />
              <div>
                <label className="label-xs block mb-1">Ingredients — one per line</label>
                <textarea value={ingredients} onChange={(e) => setIngredients(e.target.value)} rows={6} className={inputCls} />
              </div>
              <div>
                <label className="label-xs block mb-1">Steps — one per line</label>
                <textarea value={steps} onChange={(e) => setSteps(e.target.value)} rows={8} className={inputCls} />
              </div>
              <div className="flex gap-2 pt-1">
                {isNewScan ? (
                  <button onClick={handleDiscardScan} className="btn-quiet px-4 py-2.5 text-sm">Discard</button>
                ) : (
                  <button onClick={() => setEditing(false)} className="btn-quiet px-4 py-2.5 text-sm">Cancel</button>
                )}
                <button
                  onClick={handleSaveEdit}
                  disabled={saving || !title.trim()}
                  className="btn-brocco flex-1 py-2.5 text-sm"
                >
                  {saving ? "Saving…" : isNewScan ? "Looks right — save" : "Save"}
                </button>
              </div>
            </div>
          ) : (
            <>
              <h1 className="text-lg font-extrabold text-ink mb-1">{recipe.title}</h1>
              <p className="text-xs text-moss font-semibold mb-3">
                {[
                  recipe.servings ? `${recipe.servings} servings` : null,
                  recipe.timeMin ? `${recipe.timeMin} min` : null,
                  recipe.timesCooked > 0 ? `cooked ${recipe.timesCooked}×` : null,
                ].filter(Boolean).join(" · ")}
                {recipe.tags.length > 0 && (
                  <span className="ml-2">
                    {recipe.tags.map((t) => (
                      <span key={t} className="inline-block px-1.5 py-0.5 bg-ghost rounded-full text-[10px] text-moss font-bold mr-1">{t}</span>
                    ))}
                  </span>
                )}
              </p>

              <h3 className="label-xs mb-1.5">Ingredients</h3>
              <div className="space-y-1 mb-4">
                {recipe.ingredients.map((ing, i) => (
                  <button
                    key={i}
                    onClick={() => setChecked((prev) => { const n = new Set(prev); if (n.has(i)) n.delete(i); else n.add(i); return n; })}
                    className="flex items-start gap-2.5 w-full text-left group"
                  >
                    <span className={`mt-0.5 w-4 h-4 rounded-md border-2 flex-shrink-0 flex items-center justify-center text-[10px] font-bold transition-colors ${
                      checked.has(i) ? "bg-brocco border-ink text-ink" : "border-ink bg-card group-hover:bg-sprout"
                    }`}>
                      {checked.has(i) && "✓"}
                    </span>
                    <span className={`text-sm ${checked.has(i) ? "text-sage line-through" : "text-ink font-semibold"}`}>{ing}</span>
                  </button>
                ))}
              </div>

              <h3 className="label-xs mb-1.5">Steps</h3>
              <ol className="space-y-2.5 mb-4">
                {recipe.steps.map((step, i) => (
                  <li key={i} className="flex gap-2.5">
                    <span className="flex-shrink-0 w-5 h-5 bg-sprout border border-ink/60 rounded-full text-[11px] text-leaf font-bold flex items-center justify-center mt-0.5 tabular-nums">{i + 1}</span>
                    <p className="text-sm text-ink font-semibold leading-relaxed">{step}</p>
                  </li>
                ))}
              </ol>

              {recipe.notes && (
                <p className="text-xs text-moss font-semibold italic mb-4 border-l-2 border-shade pl-2">{recipe.notes}</p>
              )}

              <div className="space-y-2 pt-1">
                <div className="flex gap-2">
                  <button onClick={handleCooked} className="btn-brocco flex-1 py-2.5 text-sm">
                    I cooked this 🥦
                  </button>
                  <button onClick={() => setEditing(true)} className="btn-quiet px-4 py-2.5 text-sm">Edit</button>
                  <button onClick={handleDelete} className="btn-danger px-4 py-2.5 text-sm">Delete</button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const MAX_PAGES = 4;

/**
 * "Always in stock" pantry staples — ingredients Brocco assumes are available
 * in every recipe suggestion without the user listing them (curry paste,
 * chickpeas, …). Stored on the profile; also editable via chat
 * (manage_recipe staples_add/staples_remove).
 */
function StaplesSection() {
  const [staples, setStaples] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch("/api/recipes/staples")
      .then((r) => r.json())
      .then((d) => setStaples(d.staples || []))
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  async function save(next: string[]) {
    const prev = staples;
    setStaples(next);
    try {
      const res = await fetch("/api/recipes/staples", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ staples: next }),
      });
      if (!res.ok) throw new Error();
      const d = await res.json();
      setStaples(d.staples || next);
    } catch {
      setStaples(prev);
      emitToast({ text: "Couldn't save staples — try again.", kind: "error" });
    }
  }

  function addFromInput() {
    // Allow comma-separated entry: "curry paste, chickpeas, coconut milk"
    const items = input.split(",").map((s) => s.trim()).filter(Boolean);
    if (items.length === 0) return;
    setInput("");
    save([...staples, ...items]);
  }

  return (
    <div className="sticker px-4 py-3">
      <p className="text-sm font-bold text-ink">🧂 Always in stock</p>
      <p className="text-[11px] text-moss font-semibold mt-0.5 mb-2">
        Brocco assumes these in every recipe idea — no need to list them each time.
      </p>
      {loaded && staples.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {staples.map((s) => (
            <span
              key={s}
              className="inline-flex items-center gap-1 bg-ghost border-2 border-ink rounded-full pl-2.5 pr-1 py-0.5 text-xs text-ink font-bold"
            >
              {s}
              <button
                onClick={() => save(staples.filter((x) => x !== s))}
                aria-label={`Remove ${s}`}
                className="w-4 h-4 flex items-center justify-center rounded-full text-moss hover:text-clay"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") addFromInput(); }}
          placeholder="curry paste, chickpeas…"
          className="field flex-1"
        />
        <button
          onClick={addFromInput}
          disabled={!input.trim()}
          className="btn-quiet px-3 text-xs disabled:opacity-40"
        >
          Add
        </button>
      </div>
    </div>
  );
}

export default function KitchenView() {
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [open, setOpen] = useState<{ recipe: Recipe; isNewScan: boolean } | null>(null);
  // Staged cookbook pages: on phones the camera submits after ONE shot, so
  // multi-page recipes need a tray to collect shots before a single scan.
  const [pages, setPages] = useState<{ file: File; url: string }[]>([]);
  const pagesRef = useRef(pages);
  pagesRef.current = pages;
  const fileRef = useRef<HTMLInputElement>(null);

  // Release thumbnail object URLs when leaving the page mid-staging
  useEffect(() => {
    return () => pagesRef.current.forEach((p) => URL.revokeObjectURL(p.url));
  }, []);

  const fetchRecipes = useCallback(() => {
    fetch(`/api/recipes${query ? `?q=${encodeURIComponent(query)}` : ""}`)
      .then((r) => r.json())
      .then((d) => setRecipes(d.recipes || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [query]);

  useEffect(() => {
    const t = setTimeout(fetchRecipes, query ? 250 : 0);
    return () => clearTimeout(t);
  }, [fetchRecipes, query]);

  function addFiles(files: FileList | null) {
    // Snapshot NOW: a FileList is a live view into the input, and the value
    // reset below empties it before React's state updater runs.
    const picked = files ? Array.from(files) : [];
    if (fileRef.current) fileRef.current.value = "";
    if (picked.length === 0) return;
    setPages((prev) => {
      const next = [...prev];
      for (const file of picked) {
        if (next.length >= MAX_PAGES) {
          emitToast({ text: `Max ${MAX_PAGES} pages per recipe.`, kind: "info" });
          break;
        }
        next.push({ file, url: URL.createObjectURL(file) });
      }
      return next;
    });
  }

  function removePage(index: number) {
    setPages((prev) => {
      const removed = prev[index];
      if (removed) URL.revokeObjectURL(removed.url);
      return prev.filter((_, i) => i !== index);
    });
  }

  function clearPages() {
    setPages((prev) => {
      prev.forEach((p) => URL.revokeObjectURL(p.url));
      return [];
    });
  }

  async function scanPages() {
    if (pages.length === 0) return;
    setScanning(true);
    try {
      const images = await Promise.all(pages.map((p) => resizeImage(p.file)));
      const res = await fetch("/api/recipes/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ images }),
      });
      const data = await res.json();
      if (!res.ok) {
        emitToast({ text: data.error || "Scan failed — try again.", kind: "error" });
        return; // keep the staged pages so a retry doesn't mean re-photographing
      }
      clearPages();
      fetchRecipes();
      setOpen({ recipe: data.recipe, isNewScan: true });
    } catch {
      emitToast({ text: "Couldn't read those photos — try again.", kind: "error" });
    } finally {
      setScanning(false);
    }
  }

  return (
    <main className="min-h-screen max-w-2xl mx-auto px-4">
      <PageHeader title="Kitchen" />

      <div className="mt-4 space-y-4 pb-8">
        {/* Actions */}
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => fileRef.current?.click()}
            disabled={scanning || pages.length >= MAX_PAGES}
            className="sticker sticker-press flex flex-col items-center gap-1 disabled:opacity-60 px-4 py-4"
          >
            <span className="text-2xl">📸</span>
            <span className="text-sm font-bold text-ink">Scan a recipe</span>
            <span className="text-[10px] text-moss font-semibold">Photo a cookbook page — multi-page works too</span>
          </button>
          <Link
            href={`/chat?msg=${encodeURIComponent("What can I cook tonight? Here's what I have: ")}`}
            className="btn-brocco flex flex-col items-center gap-1 px-4 py-4"
          >
            <span className="text-2xl">🥦</span>
            <span className="text-sm font-extrabold">What can I cook?</span>
            <span className="text-[10px] text-leaf font-bold">Tell Brocco your ingredients</span>
          </Link>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="environment"
          multiple
          onChange={(e) => addFiles(e.target.files)}
          className="hidden"
          aria-label="Scan recipe photos"
        />

        {/* Staged pages tray — collect all pages of a recipe, then scan once */}
        {pages.length > 0 && (
          <div className="sticker bg-sprout p-3" data-testid="scan-tray">
            <p className="text-xs font-bold text-ink mb-2">
              📄 Recipe pages ({pages.length}/{MAX_PAGES})
            </p>
            <div className="flex gap-2 mb-3 overflow-x-auto">
              {pages.map((p, i) => (
                <div key={p.url} className="relative flex-shrink-0">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.url} alt={`Page ${i + 1}`} className="w-16 h-20 object-cover rounded-lg border-2 border-ink" />
                  <span className="absolute bottom-0.5 left-0.5 px-1 bg-ink/80 rounded text-[9px] text-cream font-bold">{i + 1}</span>
                  <button
                    onClick={() => removePage(i)}
                    disabled={scanning}
                    aria-label={`Remove page ${i + 1}`}
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-card border-2 border-ink rounded-full text-ink hover:text-clay text-xs leading-none"
                  >
                    ×
                  </button>
                </div>
              ))}
              {pages.length < MAX_PAGES && (
                <button
                  onClick={() => fileRef.current?.click()}
                  disabled={scanning}
                  className="flex-shrink-0 w-16 h-20 border-2 border-dashed border-ink/40 hover:border-ink rounded-lg text-moss hover:text-ink text-xs font-bold transition-colors"
                >
                  + Add<br />page
                </button>
              )}
            </div>
            <div className="flex gap-2">
              <button
                onClick={clearPages}
                disabled={scanning}
                className="btn-quiet px-4 py-2 text-sm disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                onClick={scanPages}
                disabled={scanning}
                className="btn-brocco flex-1 py-2 text-sm"
              >
                {scanning ? "Reading pages…" : `Scan recipe (${pages.length} page${pages.length === 1 ? "" : "s"})`}
              </button>
            </div>
          </div>
        )}

        {/* Pantry staples */}
        <StaplesSection />

        {/* Search */}
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search recipes, ingredients, tags…"
          className="field"
        />

        {/* Library */}
        {loading ? (
          <p className="text-center text-sm text-moss font-semibold py-8">Loading…</p>
        ) : recipes.length === 0 ? (
          <div className="text-center py-10">
            <p className="text-3xl mb-2">🍳</p>
            <p className="text-sm text-ink font-bold">{query ? "No recipes match." : "Your recipe library is empty."}</p>
            {!query && (
              <p className="text-xs text-moss font-semibold mt-1">Photograph a recipe from a cookbook, or ask Brocco to save one from chat.</p>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {recipes.map((r) => (
              <button
                key={r.id}
                onClick={() => setOpen({ recipe: r, isNewScan: false })}
                className="sticker sticker-press w-full text-left px-4 py-3"
              >
                <div className="flex items-center gap-2">
                  <p className="text-sm font-bold text-ink truncate flex-1">{r.title}</p>
                  {r.source === "photo" && <span className="text-[10px] flex-shrink-0">📸</span>}
                  {r.timesCooked > 0 && <span className="text-[10px] text-sage font-bold flex-shrink-0 tabular-nums">{r.timesCooked}×</span>}
                </div>
                <p className="text-xs text-moss font-semibold truncate mt-0.5">
                  {[r.timeMin ? `${r.timeMin} min` : null, r.servings ? `${r.servings} servings` : null, ...r.tags.slice(0, 3)]
                    .filter(Boolean).join(" · ") || `${r.ingredients.length} ingredients`}
                </p>
              </button>
            ))}
          </div>
        )}
      </div>

      {open && (
        <RecipeSheet
          recipe={open.recipe}
          isNewScan={open.isNewScan}
          onClose={() => setOpen(null)}
          onChanged={fetchRecipes}
        />
      )}
    </main>
  );
}
