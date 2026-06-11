"use client";

import { useState, useEffect, useCallback } from "react";
import { PageHeader } from "../nav";
import { useScreenContext, useDataChanged } from "@/lib/capture-context";

interface Note {
  id: string; title: string; body: string; tags: string[]; updatedAt: string;
}

function NoteEditor({
  note,
  onClose,
  onSaved,
  onDeleted,
}: {
  note: Note | null; // null = new note
  onClose: () => void;
  onSaved: () => void;
  onDeleted: () => void;
}) {
  const [title, setTitle] = useState(note?.title || "");
  const [body, setBody] = useState(note?.body || "");
  const [tags, setTags] = useState(note?.tags.join(", ") || "");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!title.trim()) return;
    setSaving(true);
    const payload = {
      title: title.trim(),
      body,
      tags: tags.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean),
    };
    const res = note
      ? await fetch(`/api/notes/${note.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })
      : await fetch("/api/notes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    setSaving(false);
    if (res.ok) { onSaved(); onClose(); }
  }

  async function handleDelete() {
    if (!note || !confirm("Delete this note?")) return;
    const res = await fetch(`/api/notes/${note.id}`, { method: "DELETE" });
    if (res.ok) { onDeleted(); onClose(); }
  }

  const inputCls = "w-full px-3 py-2 bg-gray-950 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-green-500";

  return (
    <div className="fixed inset-0 z-[80] flex items-end md:items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative w-full md:max-w-md bg-gray-900 border border-gray-700 rounded-t-2xl md:rounded-2xl p-4 max-h-[90vh] overflow-y-auto safe-bottom">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-white">{note ? "Edit note" : "New note"}</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-white text-xl leading-none">&times;</button>
        </div>
        <div className="space-y-2.5">
          <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" className={inputCls} />
          <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Write anything…" rows={8} className={inputCls} />
          <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="Tags, comma-separated (optional)" className={inputCls} />
          <div className="flex gap-2">
            {note && (
              <button onClick={handleDelete} className="px-4 py-2.5 bg-red-900/40 hover:bg-red-900/60 text-red-300 text-sm rounded-xl transition-colors">Delete</button>
            )}
            <button
              onClick={handleSave}
              disabled={saving || !title.trim()}
              className="flex-1 py-2.5 bg-green-600 hover:bg-green-700 disabled:opacity-40 text-white text-sm font-medium rounded-xl transition-colors"
            >
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function NotesView() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Note | null | "new">(null);
  const [loading, setLoading] = useState(true);

  const fetchNotes = useCallback(() => {
    fetch(`/api/notes${query ? `?q=${encodeURIComponent(query)}` : ""}`)
      .then((r) => r.json())
      .then((d) => setNotes(d.notes || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [query]);

  useEffect(() => {
    const t = setTimeout(fetchNotes, query ? 250 : 0);
    return () => clearTimeout(t);
  }, [fetchNotes, query]);
  useDataChanged(["notes"], fetchNotes);
  useScreenContext({ name: "notes" }, []);

  return (
    <main className="min-h-screen max-w-2xl mx-auto px-4 pb-28 md:pb-12">
      <PageHeader title="Notes" />

      <div className="flex gap-2 mt-2 mb-3">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search notes…"
          className="flex-1 px-3 py-2 bg-gray-900 border border-gray-700 rounded-xl text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-green-500"
        />
        <button onClick={() => setEditing("new")} className="px-3.5 bg-green-600 hover:bg-green-700 text-white rounded-xl text-sm transition-colors">+</button>
      </div>

      {loading ? (
        <div className="text-gray-500 text-center py-12">Loading...</div>
      ) : notes.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-4xl mb-3">📝</p>
          <p className="text-gray-400 text-sm">{query ? "No notes match." : "No notes yet."}</p>
          <p className="text-gray-600 text-xs mt-1">Tell Brocco things like &ldquo;my locker code is 4821&rdquo; — they land here.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {notes.map((n) => (
            <button
              key={n.id}
              onClick={() => setEditing(n)}
              className="w-full text-left bg-gray-900 border border-gray-800 hover:border-gray-700 rounded-xl px-4 py-3 transition-colors"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium text-gray-200 truncate">{n.title}</p>
                <p className="text-[10px] text-gray-600 flex-shrink-0">
                  {new Date(n.updatedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                </p>
              </div>
              {n.body && <p className="text-xs text-gray-500 mt-1 line-clamp-2 whitespace-pre-wrap">{n.body}</p>}
              {n.tags.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {n.tags.map((t) => (
                    <span key={t} className="text-[10px] text-gray-500 bg-gray-800 px-1.5 py-0.5 rounded-full">#{t}</span>
                  ))}
                </div>
              )}
            </button>
          ))}
        </div>
      )}

      {editing !== null && (
        <NoteEditor
          note={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={fetchNotes}
          onDeleted={fetchNotes}
        />
      )}
    </main>
  );
}
