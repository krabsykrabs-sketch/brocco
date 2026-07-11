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
  const [addingList, setAddingList] = useState(false);
  // Edit form state
  const [title, setTitle] = useState(recipe.title);
  const [servings, setServings] = useState(recipe.servings?.toString() || "");
  const [timeMin, setTimeMin] = useState(recipe.timeMin?.toString() || "");
  const [tags, setTags] = useState(recipe.tags.join(", "));
  const [ingredients, setIngredients] = useState(recipe.ingredients.join("\n"));
  const [steps, setSteps] = useState(recipe.steps.join("\n"));

  const inputCls = "w-full px-3 py-2 bg-gray-950 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-green-500";

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

  async function handleShoppingList() {
    const unchecked = recipe.ingredients.filter((_, i) => !checked.has(i));
    const items = unchecked.length > 0 && unchecked.length < recipe.ingredients.length ? unchecked : recipe.ingredients;
    setAddingList(true);
    try {
      let ok = 0;
      for (const ing of items) {
        const res = await fetch("/api/tasks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: ing, listName: "Groceries" }),
        });
        if (res.ok) ok++;
      }
      emitToast({
        text: ok === items.length ? `${ok} ingredient${ok === 1 ? "" : "s"} → Groceries 🛒` : `Added ${ok}/${items.length} — some failed.`,
        kind: ok === items.length ? "success" : "error",
      });
    } finally {
      setAddingList(false);
    }
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
      <div className="absolute inset-0 bg-black/60" onClick={isNewScan ? undefined : onClose} />
      <div className="relative w-full md:max-w-lg bg-gray-900 border border-gray-700 rounded-t-2xl md:rounded-2xl max-h-[92vh] flex flex-col safe-bottom">
        <div className="flex items-center justify-between px-4 pt-4 pb-2 flex-shrink-0">
          <h2 className="text-sm font-semibold text-white">
            {isNewScan ? "📸 Scanned — check it over" : editing ? "Edit recipe" : ""}
          </h2>
          {!isNewScan && (
            <button onClick={onClose} className="text-gray-500 hover:text-white text-xl leading-none">&times;</button>
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
                <label className="block text-[10px] text-gray-500 uppercase mb-1">Ingredients — one per line</label>
                <textarea value={ingredients} onChange={(e) => setIngredients(e.target.value)} rows={6} className={inputCls} />
              </div>
              <div>
                <label className="block text-[10px] text-gray-500 uppercase mb-1">Steps — one per line</label>
                <textarea value={steps} onChange={(e) => setSteps(e.target.value)} rows={8} className={inputCls} />
              </div>
              <div className="flex gap-2 pt-1">
                {isNewScan ? (
                  <button onClick={handleDiscardScan} className="px-4 py-2.5 bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm rounded-xl transition-colors">Discard</button>
                ) : (
                  <button onClick={() => setEditing(false)} className="px-4 py-2.5 bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm rounded-xl transition-colors">Cancel</button>
                )}
                <button
                  onClick={handleSaveEdit}
                  disabled={saving || !title.trim()}
                  className="flex-1 py-2.5 bg-green-600 hover:bg-green-700 disabled:opacity-40 text-white text-sm font-medium rounded-xl transition-colors"
                >
                  {saving ? "Saving…" : isNewScan ? "Looks right — save" : "Save"}
                </button>
              </div>
            </div>
          ) : (
            <>
              <h1 className="text-lg font-bold text-white mb-1">{recipe.title}</h1>
              <p className="text-xs text-gray-500 mb-3">
                {[
                  recipe.servings ? `${recipe.servings} servings` : null,
                  recipe.timeMin ? `${recipe.timeMin} min` : null,
                  recipe.timesCooked > 0 ? `cooked ${recipe.timesCooked}×` : null,
                ].filter(Boolean).join(" · ")}
                {recipe.tags.length > 0 && (
                  <span className="ml-2">
                    {recipe.tags.map((t) => (
                      <span key={t} className="inline-block px-1.5 py-0.5 bg-gray-800 rounded-full text-[10px] text-gray-400 mr-1">{t}</span>
                    ))}
                  </span>
                )}
              </p>

              <h3 className="text-[10px] font-bold text-gray-600 uppercase tracking-widest mb-1.5">Ingredients</h3>
              <div className="space-y-1 mb-4">
                {recipe.ingredients.map((ing, i) => (
                  <button
                    key={i}
                    onClick={() => setChecked((prev) => { const n = new Set(prev); if (n.has(i)) n.delete(i); else n.add(i); return n; })}
                    className="flex items-start gap-2.5 w-full text-left group"
                  >
                    <span className={`mt-0.5 w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center text-[10px] transition-colors ${
                      checked.has(i) ? "bg-green-600 border-green-600 text-white" : "border-gray-600 group-hover:border-green-500"
                    }`}>
                      {checked.has(i) && "✓"}
                    </span>
                    <span className={`text-sm ${checked.has(i) ? "text-gray-600 line-through" : "text-gray-200"}`}>{ing}</span>
                  </button>
                ))}
              </div>

              <h3 className="text-[10px] font-bold text-gray-600 uppercase tracking-widest mb-1.5">Steps</h3>
              <ol className="space-y-2.5 mb-4">
                {recipe.steps.map((step, i) => (
                  <li key={i} className="flex gap-2.5">
                    <span className="flex-shrink-0 w-5 h-5 bg-gray-800 rounded-full text-[11px] text-green-400 font-semibold flex items-center justify-center mt-0.5">{i + 1}</span>
                    <p className="text-sm text-gray-200 leading-relaxed">{step}</p>
                  </li>
                ))}
              </ol>

              {recipe.notes && (
                <p className="text-xs text-gray-500 italic mb-4 border-l-2 border-gray-700 pl-2">{recipe.notes}</p>
              )}

              <div className="space-y-2 pt-1">
                <button
                  onClick={handleShoppingList}
                  disabled={addingList}
                  className="w-full py-2.5 bg-gray-800 hover:bg-gray-700 disabled:opacity-40 text-gray-200 text-sm font-medium rounded-xl transition-colors"
                >
                  {addingList ? "Adding…" : `🛒 Add ${checked.size > 0 && checked.size < recipe.ingredients.length ? "missing" : "all"} to shopping list`}
                </button>
                <p className="text-[10px] text-gray-600 text-center -mt-1">Tick what you already have — only the rest gets added.</p>
                <div className="flex gap-2">
                  <button onClick={handleCooked} className="flex-1 py-2.5 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-xl transition-colors">
                    I cooked this 🥦
                  </button>
                  <button onClick={() => setEditing(true)} className="px-4 py-2.5 bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm rounded-xl transition-colors">Edit</button>
                  <button onClick={handleDelete} className="px-4 py-2.5 bg-red-900/40 hover:bg-red-900/60 text-red-300 text-sm rounded-xl transition-colors">Delete</button>
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
            className="flex flex-col items-center gap-1 bg-gray-900 border border-gray-700 hover:border-gray-600 disabled:opacity-60 rounded-xl px-4 py-4 transition-colors"
          >
            <span className="text-2xl">📸</span>
            <span className="text-sm font-medium text-white">Scan a recipe</span>
            <span className="text-[10px] text-gray-500">Photo a cookbook page — multi-page works too</span>
          </button>
          <Link
            href={`/chat?msg=${encodeURIComponent("What can I cook tonight? Here's what I have: ")}`}
            className="flex flex-col items-center gap-1 bg-green-600/90 hover:bg-green-600 border border-green-500/30 rounded-xl px-4 py-4 transition-colors"
          >
            <span className="text-2xl">🥦</span>
            <span className="text-sm font-medium text-white">What can I cook?</span>
            <span className="text-[10px] text-green-200/70">Tell Brocco your ingredients</span>
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
          <div className="bg-gray-900 border border-green-800/50 rounded-xl p-3" data-testid="scan-tray">
            <p className="text-xs font-medium text-gray-300 mb-2">
              📄 Recipe pages ({pages.length}/{MAX_PAGES})
            </p>
            <div className="flex gap-2 mb-3 overflow-x-auto">
              {pages.map((p, i) => (
                <div key={p.url} className="relative flex-shrink-0">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.url} alt={`Page ${i + 1}`} className="w-16 h-20 object-cover rounded-lg border border-gray-700" />
                  <span className="absolute bottom-0.5 left-0.5 px-1 bg-black/70 rounded text-[9px] text-gray-300">{i + 1}</span>
                  <button
                    onClick={() => removePage(i)}
                    disabled={scanning}
                    aria-label={`Remove page ${i + 1}`}
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-gray-800 border border-gray-600 rounded-full text-gray-300 hover:text-red-400 text-xs leading-none"
                  >
                    ×
                  </button>
                </div>
              ))}
              {pages.length < MAX_PAGES && (
                <button
                  onClick={() => fileRef.current?.click()}
                  disabled={scanning}
                  className="flex-shrink-0 w-16 h-20 border border-dashed border-gray-600 hover:border-green-500 rounded-lg text-gray-500 hover:text-green-400 text-xs transition-colors"
                >
                  + Add<br />page
                </button>
              )}
            </div>
            <div className="flex gap-2">
              <button
                onClick={clearPages}
                disabled={scanning}
                className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm rounded-xl transition-colors disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                onClick={scanPages}
                disabled={scanning}
                className="flex-1 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white text-sm font-medium rounded-xl transition-colors"
              >
                {scanning ? "Reading pages…" : `Scan recipe (${pages.length} page${pages.length === 1 ? "" : "s"})`}
              </button>
            </div>
          </div>
        )}

        {/* Search */}
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search recipes, ingredients, tags…"
          className="w-full px-3 py-2.5 bg-gray-900 border border-gray-800 rounded-xl text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-green-500"
        />

        {/* Library */}
        {loading ? (
          <p className="text-center text-sm text-gray-600 py-8">Loading…</p>
        ) : recipes.length === 0 ? (
          <div className="text-center py-10">
            <p className="text-3xl mb-2">🍳</p>
            <p className="text-sm text-gray-400">{query ? "No recipes match." : "Your recipe library is empty."}</p>
            {!query && (
              <p className="text-xs text-gray-600 mt-1">Photograph a recipe from a cookbook, or ask Brocco to save one from chat.</p>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {recipes.map((r) => (
              <button
                key={r.id}
                onClick={() => setOpen({ recipe: r, isNewScan: false })}
                className="w-full text-left bg-gray-900 border border-gray-800 hover:border-gray-700 rounded-xl px-4 py-3 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-gray-100 truncate flex-1">{r.title}</p>
                  {r.source === "photo" && <span className="text-[10px] flex-shrink-0">📸</span>}
                  {r.timesCooked > 0 && <span className="text-[10px] text-gray-600 flex-shrink-0">{r.timesCooked}×</span>}
                </div>
                <p className="text-xs text-gray-500 truncate mt-0.5">
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
