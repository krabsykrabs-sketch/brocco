"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { PageHeader } from "../nav";
import { useScreenContext, useDataChanged } from "@/lib/capture-context";
import { emitToast } from "@/lib/toast";

interface Task {
  id: string; listId: string | null; parentId: string | null; title: string; notes: string | null;
  dueDate: string | null; dueTime: string | null; priority: string | null;
  recurrence: string; done: boolean; position: number; createdAt: string;
}
interface TaskListInfo { id: string; name: string; emoji: string | null; openCount: number; }

type TabKey = "today" | "upcoming" | "lists";

function fmtDue(dueDate: string, today: string): { label: string; overdue: boolean } {
  if (dueDate < today) {
    const days = Math.round((new Date(today).getTime() - new Date(dueDate).getTime()) / 86400000);
    return { label: days === 1 ? "yesterday" : `${days}d overdue`, overdue: true };
  }
  if (dueDate === today) return { label: "today", overdue: false };
  const tomorrow = new Date(`${today}T00:00:00`); tomorrow.setDate(tomorrow.getDate() + 1);
  const tStr = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, "0")}-${String(tomorrow.getDate()).padStart(2, "0")}`;
  if (dueDate === tStr) return { label: "tomorrow", overdue: false };
  return {
    label: new Date(`${dueDate}T00:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }),
    overdue: false,
  };
}

// --- Task row ---

function TaskRow({
  task, today, subtasks, onToggle, onDelete, onEdit,
}: {
  task: Task; today: string; subtasks: Task[];
  onToggle: (t: Task) => void; onDelete: (t: Task) => void; onEdit: (t: Task) => void;
}) {
  const due = task.dueDate ? fmtDue(task.dueDate, today) : null;
  const prio = task.priority === "high" ? "border-l-red-500" : task.priority === "medium" ? "border-l-amber-500" : "border-l-transparent";
  const openSubs = subtasks.filter((s) => !s.done).length;

  return (
    <div className={`bg-gray-900/70 border border-gray-800/60 border-l-2 ${prio} rounded-xl`}>
      <div className="flex items-center gap-3 px-3.5 py-2.5">
        <button
          onClick={() => onToggle(task)}
          className={`w-5 h-5 rounded-md border-2 flex-shrink-0 flex items-center justify-center transition-colors ${
            task.done ? "bg-green-600 border-green-600" : "border-gray-600 hover:border-green-500"
          }`}
          aria-label={task.done ? "Mark not done" : "Mark done"}
        >
          {task.done && <span className="text-white text-xs leading-none">✓</span>}
        </button>
        <button onClick={() => onEdit(task)} className="flex-1 min-w-0 text-left" aria-label={`Edit ${task.title}`}>
          <p className={`text-sm truncate ${task.done ? "text-gray-500 line-through" : "text-gray-100"}`}>{task.title}</p>
          <p className="text-xs truncate space-x-1.5">
            {due && <span className={due.overdue ? "text-red-400/90 font-medium" : "text-gray-500"}>{due.label}{task.dueTime ? ` ${task.dueTime}` : ""}</span>}
            {task.recurrence !== "none" && <span className="text-gray-600">↻ {task.recurrence}</span>}
            {subtasks.length > 0 && <span className="text-gray-600">{subtasks.length - openSubs}/{subtasks.length} subtasks</span>}
            {task.notes && <span className="text-gray-600">…</span>}
          </p>
        </button>
        <button onClick={() => onDelete(task)} className="text-gray-700 hover:text-red-400 text-sm flex-shrink-0 px-1" aria-label="Delete task">✕</button>
      </div>
    </div>
  );
}

// --- Task edit sheet ---

function TaskEditSheet({
  task, subtasks, lists, today, onClose, onSaved, onDelete, onToggleSubtask,
}: {
  task: Task; subtasks: Task[]; lists: TaskListInfo[]; today: string;
  onClose: () => void; onSaved: () => void; onDelete: (t: Task) => void;
  onToggleSubtask: (t: Task) => void;
}) {
  const [title, setTitle] = useState(task.title);
  const [notes, setNotes] = useState(task.notes || "");
  const [dueDate, setDueDate] = useState(task.dueDate || "");
  const [dueTime, setDueTime] = useState(task.dueTime || "");
  const [priority, setPriority] = useState(task.priority || "");
  const [listId, setListId] = useState(task.listId || "");
  const [recurrence, setRecurrence] = useState(task.recurrence);
  const [saving, setSaving] = useState(false);

  const inputCls = "w-full px-3 py-2 bg-gray-950 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-green-500";

  async function handleSave() {
    if (!title.trim()) return;
    setSaving(true);
    const res = await fetch(`/api/tasks/${task.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: title.trim(),
        notes: notes.trim() || null,
        dueDate: dueDate || null,
        dueTime: dueTime || null,
        priority: priority || null,
        listId: listId || null,
        recurrence,
      }),
    });
    setSaving(false);
    if (res.ok) { onSaved(); onClose(); }
    else emitToast({ text: "Couldn't save — try again.", kind: "error" });
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-end md:items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative w-full md:max-w-md bg-gray-900 border border-gray-700 rounded-t-2xl md:rounded-2xl p-4 max-h-[90vh] overflow-y-auto safe-bottom">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-white">Edit task</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-white text-xl leading-none" aria-label="Close">&times;</button>
        </div>

        <div className="space-y-2.5">
          <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" className={inputCls} />

          <div className="flex gap-2">
            <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={inputCls} />
            <input type="time" value={dueTime} onChange={(e) => setDueTime(e.target.value)} className={inputCls} />
          </div>
          {dueDate && (
            <div className="flex gap-1.5 text-xs">
              <button onClick={() => { setDueDate(""); setDueTime(""); }} className="text-gray-500 hover:text-gray-300 underline underline-offset-2">Clear due date</button>
              {dueDate !== today && (
                <button onClick={() => setDueDate(today)} className="text-gray-500 hover:text-gray-300 underline underline-offset-2 ml-2">Today</button>
              )}
            </div>
          )}

          {/* Priority */}
          <div className="flex gap-1.5">
            {[["", "None"], ["low", "Low"], ["medium", "Medium"], ["high", "High"]].map(([val, label]) => (
              <button
                key={val}
                onClick={() => setPriority(val)}
                className={`px-3 py-1 rounded-full text-xs border transition-colors ${
                  priority === val
                    ? val === "high" ? "bg-red-500 border-red-500 text-white font-semibold"
                      : val === "medium" ? "bg-amber-500 border-amber-500 text-gray-950 font-semibold"
                      : val === "low" ? "bg-gray-400 border-gray-400 text-gray-950 font-semibold"
                      : "bg-gray-600 border-gray-600 text-white font-semibold"
                    : "border-gray-700 text-gray-400 hover:border-gray-500"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <select value={listId} onChange={(e) => setListId(e.target.value)} className={inputCls}>
            <option value="">📥 Inbox</option>
            {lists.map((l) => (
              <option key={l.id} value={l.id}>{l.emoji || "📋"} {l.name}</option>
            ))}
          </select>

          <select value={recurrence} onChange={(e) => setRecurrence(e.target.value)} className={inputCls}>
            <option value="none">Does not repeat</option>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
            <option value="yearly">Yearly</option>
          </select>

          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes (optional)" rows={2} className={inputCls} />

          {subtasks.length > 0 && (
            <div className="space-y-1.5 pt-1">
              <p className="text-[10px] font-bold text-gray-600 uppercase tracking-widest">Subtasks</p>
              {subtasks.map((s) => (
                <div key={s.id} className="flex items-center gap-2">
                  <button
                    onClick={() => onToggleSubtask(s)}
                    className={`w-4 h-4 rounded border-2 flex-shrink-0 flex items-center justify-center ${
                      s.done ? "bg-green-600 border-green-600" : "border-gray-600 hover:border-green-500"
                    }`}
                    aria-label={s.done ? `Mark ${s.title} not done` : `Mark ${s.title} done`}
                  >
                    {s.done && <span className="text-white text-[9px] leading-none">✓</span>}
                  </button>
                  <span className={`text-xs ${s.done ? "text-gray-600 line-through" : "text-gray-300"}`}>{s.title}</span>
                </div>
              ))}
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <button
              onClick={() => { onDelete(task); onClose(); }}
              className="px-4 py-2.5 bg-red-900/40 hover:bg-red-900/60 text-red-300 text-sm rounded-xl transition-colors"
            >
              Delete
            </button>
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

// --- Confirm sheet (styled replacement for window.confirm) ---

function ConfirmSheet({
  title, body, confirmLabel, onConfirm, onClose,
}: {
  title: string; body: string; confirmLabel: string;
  onConfirm: () => void; onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[80] flex items-end md:items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative w-full md:max-w-sm bg-gray-900 border border-gray-700 rounded-t-2xl md:rounded-2xl p-4 safe-bottom">
        <h2 className="text-sm font-semibold text-white mb-1">{title}</h2>
        <p className="text-xs text-gray-400 mb-4">{body}</p>
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 py-2.5 bg-gray-800 hover:bg-gray-700 text-gray-200 text-sm rounded-xl transition-colors">Cancel</button>
          <button onClick={() => { onConfirm(); onClose(); }} className="flex-1 py-2.5 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-xl transition-colors">{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

// --- Main view ---

export default function TasksView() {
  const [tab, setTab] = useState<TabKey>("today");
  const [activeListId, setActiveListId] = useState<string | "inbox" | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [lists, setLists] = useState<TaskListInfo[]>([]);
  const [inboxCount, setInboxCount] = useState(0);
  const [today, setToday] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Task | null>(null);
  const [newListOpen, setNewListOpen] = useState(false);
  const [newListName, setNewListName] = useState("");
  const [deleteListTarget, setDeleteListTarget] = useState<TaskListInfo | null>(null);

  const fetchTasks = useCallback(() => {
    let url = "/api/tasks?view=all";
    if (tab === "today") url = "/api/tasks?view=today";
    else if (tab === "upcoming") url = "/api/tasks?view=upcoming";
    else if (tab === "lists" && activeListId) url = `/api/tasks?listId=${activeListId}&includeDone=1`;
    fetch(url)
      .then((r) => r.json())
      .then((d) => { setTasks(d.tasks || []); if (d.today) setToday(d.today); })
      .catch(() => {});
  }, [tab, activeListId]);

  const fetchLists = useCallback(() => {
    fetch("/api/task-lists")
      .then((r) => r.json())
      .then((d) => { setLists(d.lists || []); setInboxCount(d.inbox?.openCount ?? 0); })
      .catch(() => {});
  }, []);

  useEffect(() => { fetchTasks(); }, [fetchTasks]);
  useEffect(() => { fetchLists(); }, [fetchLists]);
  const refetchAll = useCallback(() => { fetchTasks(); fetchLists(); }, [fetchTasks, fetchLists]);
  useDataChanged(["tasks"], refetchAll);

  const activeListName = activeListId === "inbox" ? "Inbox" : lists.find((l) => l.id === activeListId)?.name;
  useScreenContext(
    {
      name: "tasks",
      view: tab === "lists" && activeListName ? `list:${activeListName}` : tab,
      rangeStart: today || undefined,
      selectedItem: editing ? { type: "task", id: editing.id, title: editing.title } : undefined,
    },
    [tab, activeListName, today, editing?.id]
  );

  const { parents, subtasksByParent } = useMemo(() => {
    const parents = tasks.filter((t) => !t.parentId);
    const subtasksByParent = new Map<string, Task[]>();
    for (const t of tasks) {
      if (t.parentId) {
        if (!subtasksByParent.has(t.parentId)) subtasksByParent.set(t.parentId, []);
        subtasksByParent.get(t.parentId)!.push(t);
      }
    }
    return { parents, subtasksByParent };
  }, [tasks]);

  async function handleToggle(task: Task) {
    const newDone = !task.done;
    setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, done: newDone } : t)));
    try {
      const res = await fetch(`/api/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ done: newDone }),
      });
      if (!res.ok) throw new Error();
      // Recurring tasks spawn a successor; refresh shortly after to show it
      if (task.recurrence !== "none" || newDone) setTimeout(refetchAll, 400);
    } catch {
      // Roll back the optimistic toggle so the UI doesn't lie about server state
      setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, done: task.done } : t)));
    }
  }

  async function handleDelete(task: Task) {
    const subtasks = subtasksByParent.get(task.id) || [];
    // Optimistic removal (subtasks cascade server-side)
    setTasks((prev) => prev.filter((t) => t.id !== task.id && t.parentId !== task.id));
    const res = await fetch(`/api/tasks/${task.id}`, { method: "DELETE" });
    if (!res.ok) {
      refetchAll();
      emitToast({ text: "Couldn't delete — try again.", kind: "error" });
      return;
    }
    fetchLists();
    emitToast({
      text: `Deleted: ${task.title}`,
      kind: "info",
      action: {
        label: "Undo",
        run: async () => {
          // Re-create the task (new id) and its subtasks, restoring done states
          const res = await fetch("/api/tasks", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              title: task.title,
              notes: task.notes,
              dueDate: task.dueDate,
              dueTime: task.dueTime,
              priority: task.priority,
              listId: task.listId,
              recurrence: task.recurrence,
            }),
          });
          if (res.ok) {
            const { task: created } = await res.json();
            for (const s of subtasks) {
              const subRes = await fetch("/api/tasks", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ title: s.title, parentId: created.id, listId: task.listId }),
              });
              if (subRes.ok && s.done) {
                const { task: createdSub } = await subRes.json();
                await fetch(`/api/tasks/${createdSub.id}`, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ done: true }),
                });
              }
            }
            if (task.done) {
              await fetch(`/api/tasks/${created.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ done: true }),
              });
            }
          }
          refetchAll();
        },
      },
    });
  }

  async function handleAdd() {
    const title = newTitle.trim();
    if (!title || adding) return;
    setAdding(true);
    setNewTitle("");
    const payload: Record<string, unknown> = { title };
    if (tab === "today") payload.dueDate = today;
    if (tab === "lists" && activeListId && activeListId !== "inbox") payload.listId = activeListId;
    const res = await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setAdding(false);
    if (res.ok) refetchAll();
  }

  async function handleCreateList() {
    const name = newListName.trim();
    if (!name) return;
    setNewListName("");
    setNewListOpen(false);
    const res = await fetch("/api/task-lists", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (res.ok) fetchLists();
  }

  async function handleDeleteList(list: TaskListInfo) {
    if (activeListId === list.id) setActiveListId(null);
    setLists((prev) => prev.filter((l) => l.id !== list.id));
    const res = await fetch(`/api/task-lists/${list.id}`, { method: "DELETE" });
    if (!res.ok) emitToast({ text: "Couldn't delete list — try again.", kind: "error" });
    refetchAll();
  }

  const overdue = parents.filter((t) => t.dueDate && t.dueDate < today && !t.done);
  const dueToday = parents.filter((t) => t.dueDate === today);
  const rest = parents.filter((t) => !overdue.includes(t) && !dueToday.includes(t));

  return (
    <main className="min-h-screen max-w-2xl mx-auto px-4 pb-28 md:pb-12">
      <PageHeader title="Tasks" />

      {/* Tabs */}
      <div className="flex bg-gray-900 border border-gray-800 rounded-lg p-0.5 mt-2 mb-3">
        {([
          ["today", "Today"],
          ["upcoming", "Upcoming"],
          ["lists", "Lists"],
        ] as Array<[TabKey, string]>).map(([key, label]) => (
          <button
            key={key}
            onClick={() => { setTab(key); if (key !== "lists") setActiveListId(null); }}
            className={`flex-1 px-3 py-1.5 text-xs rounded-md transition-colors ${tab === key ? "bg-gray-700 text-white" : "text-gray-500 hover:text-gray-300"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Lists browser */}
      {tab === "lists" && !activeListId && (
        <div className="space-y-2">
          <button onClick={() => setActiveListId("inbox")} className="w-full flex items-center gap-3 bg-gray-900 border border-gray-800 hover:border-gray-700 rounded-xl px-4 py-3 transition-colors">
            <span className="text-lg">📥</span>
            <span className="text-sm font-medium text-gray-200 flex-1 text-left">Inbox</span>
            <span className="text-xs text-gray-500">{inboxCount}</span>
          </button>
          {lists.map((l) => (
            <div key={l.id} className="flex items-center gap-2">
              <button onClick={() => setActiveListId(l.id)} className="flex-1 flex items-center gap-3 bg-gray-900 border border-gray-800 hover:border-gray-700 rounded-xl px-4 py-3 transition-colors">
                <span className="text-lg">{l.emoji || "📋"}</span>
                <span className="text-sm font-medium text-gray-200 flex-1 text-left">{l.name}</span>
                <span className="text-xs text-gray-500">{l.openCount}</span>
              </button>
              <button onClick={() => setDeleteListTarget(l)} className="text-gray-700 hover:text-red-400 px-2" aria-label={`Delete list ${l.name}`}>✕</button>
            </div>
          ))}
          {newListOpen ? (
            <div className="flex gap-2">
              <input
                autoFocus
                value={newListName}
                onChange={(e) => setNewListName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreateList();
                  if (e.key === "Escape") { setNewListOpen(false); setNewListName(""); }
                }}
                placeholder="List name…"
                className="flex-1 px-3 py-2.5 bg-gray-900 border border-gray-700 rounded-xl text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-green-500"
              />
              <button onClick={handleCreateList} disabled={!newListName.trim()} className="px-3.5 bg-green-600 hover:bg-green-700 disabled:opacity-40 text-white rounded-xl text-sm transition-colors">Add</button>
            </div>
          ) : (
            <button onClick={() => setNewListOpen(true)} className="w-full py-2.5 border border-dashed border-gray-700 hover:border-gray-500 text-gray-500 hover:text-gray-300 text-sm rounded-xl transition-colors">
              + New list
            </button>
          )}
        </div>
      )}

      {/* Task list */}
      {(tab !== "lists" || activeListId) && (
        <>
          {tab === "lists" && activeListId && (
            <button onClick={() => setActiveListId(null)} className="text-xs text-gray-500 hover:text-gray-300 mb-2 flex items-center gap-1">
              ‹ All lists · <span className="text-gray-300 font-medium">{activeListName}</span>
            </button>
          )}

          {/* Quick add */}
          <div className="flex gap-2 mb-3">
            <input
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }}
              placeholder={tab === "today" ? "Add a task for today…" : "Add a task…"}
              className="flex-1 px-3 py-2 bg-gray-900 border border-gray-700 rounded-xl text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-green-500"
            />
            <button onClick={handleAdd} disabled={!newTitle.trim() || adding} className="px-3.5 bg-green-600 hover:bg-green-700 disabled:opacity-40 text-white rounded-xl text-sm transition-colors" aria-label="Add task">+</button>
          </div>

          <div className="space-y-1.5">
            {tab === "today" && overdue.length > 0 && (
              <>
                <h2 className="text-[10px] font-bold text-red-400/80 uppercase tracking-widest pt-1">Overdue</h2>
                {overdue.map((t) => (
                  <TaskRow key={t.id} task={t} today={today} subtasks={subtasksByParent.get(t.id) || []} onToggle={handleToggle} onDelete={handleDelete} onEdit={setEditing} />
                ))}
                <h2 className="text-[10px] font-bold text-gray-600 uppercase tracking-widest pt-2">Today</h2>
              </>
            )}
            {(tab === "today" ? [...dueToday, ...rest.filter((t) => !t.dueDate)] : parents).map((t) => (
              <TaskRow key={t.id} task={t} today={today} subtasks={subtasksByParent.get(t.id) || []} onToggle={handleToggle} onDelete={handleDelete} onEdit={setEditing} />
            ))}
            {parents.length === 0 && (
              <div className="text-center py-12">
                <p className="text-4xl mb-3">{tab === "today" ? "🎉" : "📋"}</p>
                <p className="text-gray-400 text-sm">{tab === "today" ? "Nothing due today." : "No tasks here."}</p>
                <p className="text-gray-600 text-xs mt-1">Add one above, or just tell Brocco via the mic.</p>
              </div>
            )}
          </div>
        </>
      )}

      {/* Edit sheet */}
      {editing && (
        <TaskEditSheet
          task={editing}
          subtasks={subtasksByParent.get(editing.id) || []}
          lists={lists}
          today={today}
          onClose={() => setEditing(null)}
          onSaved={refetchAll}
          onDelete={handleDelete}
          onToggleSubtask={handleToggle}
        />
      )}

      {/* List delete confirm */}
      {deleteListTarget && (
        <ConfirmSheet
          title={`Delete "${deleteListTarget.name}"?`}
          body="Tasks in this list move to the Inbox — nothing is lost."
          confirmLabel="Delete list"
          onConfirm={() => handleDeleteList(deleteListTarget)}
          onClose={() => setDeleteListTarget(null)}
        />
      )}
    </main>
  );
}
