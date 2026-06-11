"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { PageHeader } from "../nav";
import { useScreenContext, useDataChanged } from "@/lib/capture-context";

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

function TaskRow({
  task, today, subtasks, onToggle, onDelete,
}: {
  task: Task; today: string; subtasks: Task[];
  onToggle: (t: Task) => void; onDelete: (t: Task) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const due = task.dueDate ? fmtDue(task.dueDate, today) : null;
  const prio = task.priority === "high" ? "border-l-red-500" : task.priority === "medium" ? "border-l-amber-500" : "border-l-transparent";
  const openSubs = subtasks.filter((s) => !s.done).length;

  return (
    <div className={`bg-gray-900/70 border border-gray-800/60 border-l-2 ${prio} rounded-xl overflow-hidden`}>
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
        <button onClick={() => setExpanded((v) => !v)} className="flex-1 min-w-0 text-left">
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
      {expanded && (task.notes || subtasks.length > 0) && (
        <div className="px-3.5 pb-2.5 pl-12 space-y-1.5">
          {task.notes && <p className="text-xs text-gray-400 whitespace-pre-wrap">{task.notes}</p>}
          {subtasks.map((s) => (
            <div key={s.id} className="flex items-center gap-2">
              <button
                onClick={() => onToggle(s)}
                className={`w-4 h-4 rounded border-2 flex-shrink-0 flex items-center justify-center ${
                  s.done ? "bg-green-600 border-green-600" : "border-gray-600 hover:border-green-500"
                }`}
              >
                {s.done && <span className="text-white text-[9px] leading-none">✓</span>}
              </button>
              <span className={`text-xs ${s.done ? "text-gray-600 line-through" : "text-gray-300"}`}>{s.title}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function TasksView() {
  const [tab, setTab] = useState<TabKey>("today");
  const [activeListId, setActiveListId] = useState<string | "inbox" | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [lists, setLists] = useState<TaskListInfo[]>([]);
  const [inboxCount, setInboxCount] = useState(0);
  const [today, setToday] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [adding, setAdding] = useState(false);

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
    },
    [tab, activeListName, today]
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
    await fetch(`/api/tasks/${task.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ done: newDone }),
    });
    // Recurring tasks spawn a successor; refresh shortly after to show it
    if (task.recurrence !== "none" || newDone) setTimeout(refetchAll, 400);
  }

  async function handleDelete(task: Task) {
    setTasks((prev) => prev.filter((t) => t.id !== task.id && t.parentId !== task.id));
    await fetch(`/api/tasks/${task.id}`, { method: "DELETE" });
    fetchLists();
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
    const name = prompt("List name");
    if (!name?.trim()) return;
    const res = await fetch("/api/task-lists", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim() }),
    });
    if (res.ok) fetchLists();
  }

  async function handleDeleteList(list: TaskListInfo) {
    if (!confirm(`Delete "${list.name}"? Its tasks move to the Inbox.`)) return;
    await fetch(`/api/task-lists/${list.id}`, { method: "DELETE" });
    if (activeListId === list.id) setActiveListId(null);
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
              <button onClick={() => handleDeleteList(l)} className="text-gray-700 hover:text-red-400 px-2" aria-label={`Delete list ${l.name}`}>✕</button>
            </div>
          ))}
          <button onClick={handleCreateList} className="w-full py-2.5 border border-dashed border-gray-700 hover:border-gray-500 text-gray-500 hover:text-gray-300 text-sm rounded-xl transition-colors">
            + New list
          </button>
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
            <button onClick={handleAdd} disabled={!newTitle.trim() || adding} className="px-3.5 bg-green-600 hover:bg-green-700 disabled:opacity-40 text-white rounded-xl text-sm transition-colors">+</button>
          </div>

          <div className="space-y-1.5">
            {tab === "today" && overdue.length > 0 && (
              <>
                <h2 className="text-[10px] font-bold text-red-400/80 uppercase tracking-widest pt-1">Overdue</h2>
                {overdue.map((t) => (
                  <TaskRow key={t.id} task={t} today={today} subtasks={subtasksByParent.get(t.id) || []} onToggle={handleToggle} onDelete={handleDelete} />
                ))}
                <h2 className="text-[10px] font-bold text-gray-600 uppercase tracking-widest pt-2">Today</h2>
              </>
            )}
            {(tab === "today" ? [...dueToday, ...rest.filter((t) => !t.dueDate)] : parents).map((t) => (
              <TaskRow key={t.id} task={t} today={today} subtasks={subtasksByParent.get(t.id) || []} onToggle={handleToggle} onDelete={handleDelete} />
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
    </main>
  );
}
