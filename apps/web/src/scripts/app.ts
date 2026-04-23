import { getSupabase } from '../lib/supabase';
import type { Project, Chat, Task, ClaudeSession } from '@motaskbot/shared/types';

const sb = getSupabase();

type Tab = 'tasks' | 'projects' | 'sessions' | 'chat' | 'usage';

interface Target {
  kind: 'session' | 'project';
  project_id?: string;
  chat_id?: string;
  session_id?: string;
  label: string;
  sub: string;
  working_dir?: string | null;
}

type SortBy = 'newest' | 'oldest' | 'cost' | 'duration';

const state = {
  projects: [] as Project[],
  chats: [] as Chat[],
  tasks: [] as Task[],
  sessions: [] as ClaudeSession[],
  tab: 'tasks' as Tab,
  searchOpen: false,
  searchQuery: '',
  target: null as Target | null,
  theme: 'dark' as string,
  filterChat: '' as string,
  filterStatus: '' as string,
  sortBy: 'newest' as SortBy,
  pinnedIds: new Set<string>(JSON.parse(localStorage.getItem('motaskbot-pinned') || '[]')),
};

function savePinned() {
  localStorage.setItem('motaskbot-pinned', JSON.stringify(Array.from(state.pinnedIds)));
}
function togglePin(id: string) {
  if (state.pinnedIds.has(id)) state.pinnedIds.delete(id);
  else state.pinnedIds.add(id);
  savePinned();
}

function dateGroupLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const dayMs = 86_400_000;
  const today0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const tday = d.getTime();
  if (tday >= today0) return 'Today';
  if (tday >= today0 - dayMs) return 'Yesterday';
  if (tday >= today0 - 7 * dayMs) return 'This week';
  if (tday >= today0 - 30 * dayMs) return 'This month';
  return 'Earlier';
}

function elapsed(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function relDate(iso: string) {
  const d = new Date(iso).getTime();
  const diff = Date.now() - d;
  const day = 86_400_000;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < day) return `${Math.floor(diff / 3_600_000)}h`;
  if (diff < 7 * day) return `${Math.floor(diff / day)}d`;
  return new Date(iso).toLocaleDateString();
}

// ---------- Rendering: Tasks feed ----------
function renderTasksFilterOptions() {
  const sel = $('tasks-filter-chat') as HTMLSelectElement | null;
  if (!sel) return;
  const prev = sel.value;
  const chats = state.chats
    .filter((c) => {
      const p = state.projects.find((x) => x.id === c.project_id);
      return p && p.name !== CHAT_PROJECT_NAME;
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  sel.innerHTML =
    '<option value="">All chats</option>' +
    chats
      .map((c) => {
        const p = state.projects.find((x) => x.id === c.project_id);
        const label = p ? `${p.name} · ${c.name}` : c.name;
        return `<option value="${c.id}">${escapeHtml(label)}</option>`;
      })
      .join('');
  if (prev && chats.some((c) => c.id === prev)) sel.value = prev;
}

function updateStatusChipCounts() {
  const pool = state.tasks
    .filter((t) => (t as any).kind !== 'chat')
    .filter((t) => !state.filterChat || t.chat_id === state.filterChat);
  const counts: Record<string, number> = {
    '': pool.length,
    running: pool.filter((t) => t.status === 'running').length,
    failed: pool.filter((t) => t.status === 'failed').length,
    pending: pool.filter((t) => t.status === 'pending').length,
    completed: pool.filter((t) => t.status === 'completed').length,
  };
  document.querySelectorAll<HTMLElement>('[data-status-count]').forEach((el) => {
    const k = el.dataset.statusCount ?? '';
    el.textContent = counts[k] === undefined ? '' : String(counts[k]);
  });
  document.querySelectorAll<HTMLButtonElement>('[data-status-chip]').forEach((btn) => {
    btn.classList.toggle('active', (btn.dataset.statusChip ?? '') === state.filterStatus);
  });
}

function taskCardHtml(t: Task): string {
  const chat = state.chats.find((c) => c.id === t.chat_id);
  const project = chat ? state.projects.find((p) => p.id === chat.project_id) : null;
  const preview = t.result
    ? t.result.slice(0, 180).replace(/\s+/g, ' ')
    : t.instructions.slice(0, 180).replace(/\s+/g, ' ');
  const projectBit = project ? `<span class="truncate">${escapeHtml(project.name)}</span>` : '';
  const chatBit = chat?.claude_session_id
    ? `<span class="text-accent inline-flex items-center" title="Claude Code session" aria-label="Claude Code"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg></span>`
    : '';
  const pinned = state.pinnedIds.has(t.id);
  const tokens = ((t as any).input_tokens ?? 0) + ((t as any).output_tokens ?? 0);
  const cost = Number((t as any).total_cost_usd ?? 0);
  const elapsedLabel =
    t.status === 'running'
      ? `<span class="text-status-running inline-flex items-center gap-0.5" data-elapsed="${t.created_at}"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>${elapsed(t.created_at)}</span><span>·</span>`
      : '';

  // Quick actions per status
  const actions: string[] = [];
  if (t.status === 'running') {
    actions.push(`<button data-cancel-id="${t.id}" class="task-action" aria-label="Cancel" title="Cancel">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="6" width="12" height="12" rx="1"/></svg>
    </button>`);
  }
  if (t.status === 'failed') {
    actions.push(`<button data-retry-id="${t.id}" class="task-action" aria-label="Retry" title="Retry">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>
    </button>`);
  }
  if (t.status === 'completed') {
    actions.push(`<button data-dupe-id="${t.id}" class="task-action" aria-label="Duplicate" title="Re-run">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
    </button>`);
  }
  if (t.status === 'completed' || t.status === 'failed') {
    actions.push(`<button data-del-id="${t.id}" class="task-action hover:!text-status-failed" aria-label="Delete" title="Delete">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/></svg>
    </button>`);
  }

  return `
    <li class="relative ${pinned ? 'pinned' : ''}">
      <span class="pin-star" aria-hidden="true"><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg></span>
      <button data-id="${t.id}" class="task-item w-full text-left card px-4 py-3 active:bg-bg-elevated transition-colors">
        <div class="flex items-start gap-3">
          <span class="status-dot status-${t.status} mt-1.5 flex-shrink-0"></span>
          <div class="flex-1 min-w-0 pr-2">
            <div class="flex items-baseline justify-between gap-2">
              <div class="text-sm font-medium truncate">${escapeHtml(t.title)}</div>
              <div class="text-[11px] text-fg-dim flex-shrink-0">${relDate(t.updated_at)}</div>
            </div>
            <div class="text-xs text-fg-muted line-clamp-2 mt-0.5">${escapeHtml(preview)}</div>
            <div class="text-[11px] text-fg-dim mt-1.5 flex items-center gap-1.5 flex-wrap">
              ${elapsedLabel}
              <span class="uppercase tracking-wide">${t.status}</span>
              ${projectBit ? '<span>·</span>' + projectBit : ''}
              ${chatBit}
              ${(t as any).model ? `<span>·</span><span class="text-fg-muted">${escapeHtml((t as any).model)}</span>` : ''}
              ${tokens ? `<span>·</span><span>${fmtNum(tokens)} tok</span>` : ''}
              ${cost > 0 ? `<span>·</span><span>$${cost.toFixed(4)}</span>` : ''}
            </div>
          </div>
        </div>
      </button>
      ${actions.length > 0
        ? `<div class="absolute top-2 right-2 flex items-center gap-1">${actions.join('')}</div>`
        : ''}
    </li>`;
}

function applySort(tasks: Task[]): Task[] {
  const arr = [...tasks];
  switch (state.sortBy) {
    case 'oldest':
      arr.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      break;
    case 'cost':
      arr.sort((a, b) => Number((b as any).total_cost_usd ?? 0) - Number((a as any).total_cost_usd ?? 0));
      break;
    case 'duration':
      arr.sort((a, b) => Number((b as any).duration_ms ?? 0) - Number((a as any).duration_ms ?? 0));
      break;
    case 'newest':
    default:
      arr.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
  }
  return arr;
}

function renderTasks() {
  renderTasksFilterOptions();
  updateStatusChipCounts();
  const ul = $('tasks-feed');
  const empty = $('tasks-empty');
  const q = state.searchQuery.toLowerCase();
  const filtered = state.tasks
    .filter((t) => (t as any).kind !== 'chat')
    .filter((t) => !state.filterChat || t.chat_id === state.filterChat)
    .filter((t) => !state.filterStatus || t.status === state.filterStatus)
    .filter((t) => {
      if (!q) return true;
      return (t.title + ' ' + t.instructions + ' ' + (t.result ?? '')).toLowerCase().includes(q);
    });

  if (filtered.length === 0) {
    ul.classList.add('hidden');
    empty.classList.remove('hidden');
    // Customize empty text when filter active
    const anyFilter = state.filterChat || state.filterStatus || q;
    if (anyFilter) {
      empty.innerHTML = `
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="mb-2 text-fg-muted"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
        <div>No tasks match these filters.</div>
        <button id="clear-filters-btn" class="text-accent text-xs mt-2 underline">Clear filters</button>
      `;
      $('clear-filters-btn')?.addEventListener('click', () => {
        state.filterChat = '';
        state.filterStatus = '';
        state.searchQuery = '';
        ($('tasks-filter-chat') as HTMLSelectElement).value = '';
        if ($('search-input')) ($('search-input') as HTMLInputElement).value = '';
        renderTasks();
      });
    } else {
      empty.innerHTML = `
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="mb-2 text-accent"><path d="M12 2v4"/><path d="M12 18v4"/><path d="m4.93 4.93 2.83 2.83"/><path d="m16.24 16.24 2.83 2.83"/><path d="M2 12h4"/><path d="M18 12h4"/><path d="m4.93 19.07 2.83-2.83"/><path d="m16.24 7.76 2.83-2.83"/></svg>
        <div>No tasks yet.</div>
        <div class="text-[11px]">Tap <span class="text-accent">+</span> to send one to Claude.</div>
      `;
    }
    return;
  }
  empty.classList.add('hidden');
  ul.classList.remove('hidden');

  // Pinned first, then sorted
  const pinned = filtered.filter((t) => state.pinnedIds.has(t.id));
  const rest = filtered.filter((t) => !state.pinnedIds.has(t.id));
  const sortedRest = applySort(rest);
  const sortedPinned = applySort(pinned);

  let html = '';
  if (sortedPinned.length > 0) {
    html += `<li class="date-group inline-flex items-center gap-1"><svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" class="inline-block"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>Pinned</li>`;
    html += sortedPinned.map(taskCardHtml).join('');
  }

  // Group rest by date bucket (only if sort=newest/oldest, otherwise no headers)
  if (state.sortBy === 'newest' || state.sortBy === 'oldest') {
    let lastGroup = '';
    for (const t of sortedRest) {
      const g = dateGroupLabel(t.created_at);
      if (g !== lastGroup) {
        html += `<li class="date-group">${g}</li>`;
        lastGroup = g;
      }
      html += taskCardHtml(t);
    }
  } else {
    html += sortedRest.map(taskCardHtml).join('');
  }

  ul.innerHTML = html;

  ul.querySelectorAll<HTMLButtonElement>('.task-item').forEach((btn) => {
    btn.addEventListener('click', () => openDetail(btn.dataset.id!));
  });
  ul.querySelectorAll<HTMLButtonElement>('[data-del-id]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.dataset.delId!;
      if (!confirm('Delete this task?')) return;
      const { error } = await sb.from('tasks').delete().eq('id', id);
      if (error) alert(error.message);
    });
  });
  ul.querySelectorAll<HTMLButtonElement>('[data-retry-id]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      retryTask(btn.dataset.retryId!);
    });
  });
  ul.querySelectorAll<HTMLButtonElement>('[data-dupe-id]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      duplicateTask(btn.dataset.dupeId!);
    });
  });
  ul.querySelectorAll<HTMLButtonElement>('[data-cancel-id]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      cancelTask(btn.dataset.cancelId!);
    });
  });
}

// Tick live elapsed counters every 2s
setInterval(() => {
  if (state.tab !== 'tasks') return;
  document.querySelectorAll<HTMLElement>('[data-elapsed]').forEach((el) => {
    const iso = el.dataset.elapsed!;
    // Preserve SVG by only updating the trailing text node
    const last = el.lastChild;
    if (last && last.nodeType === Node.TEXT_NODE) last.textContent = elapsed(iso);
    else el.innerHTML = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>${elapsed(iso)}`;
  });
}, 2000);

// ---------- Task actions ----------
async function retryTask(id: string) {
  const t = state.tasks.find((x) => x.id === id);
  if (!t) return;
  const { error } = await sb.from('tasks').insert({
    project_id: t.project_id,
    chat_id: t.chat_id,
    title: t.title,
    instructions: t.instructions,
    model: (t as any).model,
    kind: (t as any).kind,
  } as any);
  if (error) alert(error.message);
}

async function duplicateTask(id: string) {
  await retryTask(id);
}

async function cancelTask(id: string) {
  if (!confirm('Cancel this running task?')) return;
  const { error } = await sb
    .from('tasks')
    .update({ status: 'failed', error: 'Cancelled by user' } as any)
    .eq('id', id);
  if (error) alert(error.message);
}

async function editPendingTask(id: string, newInstructions: string) {
  const { error } = await sb
    .from('tasks')
    .update({ instructions: newInstructions, title: newInstructions.split('\n')[0].slice(0, 80) } as any)
    .eq('id', id)
    .eq('status', 'pending');
  if (error) alert(error.message);
}

// Auto-cancel stuck tasks: running > 15min → mark failed
async function sweepStuckTasks() {
  const cutoff = Date.now() - 15 * 60 * 1000;
  const stuck = state.tasks.filter(
    (t) => t.status === 'running' && new Date(t.updated_at).getTime() < cutoff,
  );
  for (const t of stuck) {
    await sb
      .from('tasks')
      .update({ status: 'failed', error: 'Timeout: running > 15min without updates' } as any)
      .eq('id', t.id);
  }
}
setInterval(sweepStuckTasks, 60_000);

// ---------- Rendering: Projects feed ----------
function renderProjects() {
  const ul = $('projects-feed');
  const q = state.searchQuery.toLowerCase();
  const projects = state.projects
    .filter((p) => p.name !== CHAT_PROJECT_NAME)
    .filter((p) => !q || p.name.toLowerCase().includes(q) || (p.working_dir ?? '').toLowerCase().includes(q))
    .sort((a, b) => a.name.localeCompare(b.name));

  if (projects.length === 0) {
    ul.innerHTML = `<li class="text-center text-fg-dim text-sm py-12">No projects.</li>`;
    return;
  }

  ul.innerHTML = projects
    .map((p) => {
      const chatCount = state.chats.filter((c) => c.project_id === p.id).length;
      const taskCount = state.tasks.filter((t) => t.project_id === p.id).length;
      const running = state.tasks.filter((t) => t.project_id === p.id && t.status === 'running').length;
      return `
      <li>
        <button data-id="${p.id}" class="project-item w-full text-left card px-4 py-3 active:bg-bg-elevated">
          <div class="flex items-center justify-between gap-3">
            <div class="min-w-0 flex-1">
              <div class="text-sm font-medium truncate flex items-center gap-1.5">
                ${escapeHtml(p.name)}
                ${p.source === 'claude_code' ? '<span class="text-[10px] text-accent font-semibold">CC</span>' : ''}
              </div>
              ${p.working_dir ? `<div class="text-[11px] text-fg-dim font-mono truncate mt-0.5">${escapeHtml(p.working_dir)}</div>` : ''}
              <div class="text-[11px] text-fg-muted mt-1">${chatCount} chats · ${taskCount} tasks</div>
            </div>
            ${running > 0 ? '<span class="status-dot status-running flex-shrink-0"></span>' : ''}
          </div>
        </button>
      </li>`;
    })
    .join('');

  ul.querySelectorAll<HTMLButtonElement>('.project-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      const p = state.projects.find((x) => x.id === btn.dataset.id);
      if (!p) return;
      // Pre-select project as target and open task modal
      state.target = {
        kind: 'project',
        project_id: p.id,
        label: p.name,
        sub: p.working_dir ?? 'no folder',
        working_dir: p.working_dir,
      };
      applyTarget();
      openTaskModal();
    });
  });
}

// ---------- Rendering: Sessions feed ----------
function renderSessions() {
  const ul = $('sessions-feed');
  const q = state.searchQuery.toLowerCase();
  const sessions = state.sessions
    .filter(
      (s) =>
        !q ||
        s.project_label.toLowerCase().includes(q) ||
        s.project_dir.toLowerCase().includes(q) ||
        (s.preview ?? '').toLowerCase().includes(q),
    )
    .sort((a, b) => new Date(b.last_activity_at).getTime() - new Date(a.last_activity_at).getTime());

  if (sessions.length === 0) {
    ul.innerHTML = `<li class="text-center text-fg-dim text-sm py-12">No Claude Code sessions found.</li>`;
    return;
  }

  ul.innerHTML = sessions
    .map((s) => {
      const preview = (s.preview ?? '(no preview)').slice(0, 140).replace(/\s+/g, ' ');
      return `
      <li>
        <button data-sid="${s.session_id}" class="session-item w-full text-left card px-4 py-3 active:bg-bg-elevated">
          <div class="flex items-center justify-between gap-2 mb-1">
            <div class="text-sm font-medium truncate">${escapeHtml(s.project_label)}</div>
            <div class="text-[11px] text-fg-dim flex-shrink-0">${relDate(s.last_activity_at)}</div>
          </div>
          <div class="text-xs text-fg-muted line-clamp-2">${escapeHtml(preview)}</div>
          <div class="text-[11px] text-fg-dim mt-1.5 flex items-center gap-1.5 flex-wrap">
            <span class="inline-flex items-center gap-1 text-accent"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>${s.session_id.slice(0, 8)}</span>
            <span>·</span>
            <span>${s.message_count} msg</span>
          </div>
        </button>
      </li>`;
    })
    .join('');

  ul.querySelectorAll<HTMLButtonElement>('.session-item').forEach((btn) => {
    btn.addEventListener('click', () => pickSessionAsTarget(btn.dataset.sid!));
  });
}

function pickSessionAsTarget(session_id: string) {
  const s = state.sessions.find((x) => x.session_id === session_id);
  if (!s) return;
  // Find (or will find at submit time) the chat for this session
  const chat = state.chats.find((c) => c.claude_session_id === session_id);
  state.target = {
    kind: 'session',
    session_id,
    chat_id: chat?.id,
    project_id: chat?.project_id,
    label: s.project_label,
    sub: s.project_dir,
    working_dir: s.project_dir,
  };
  applyTarget();
  openTaskModal();
}

// ---------- Desktop sidebar rendering ----------
function renderDesktopSidebar() {
  const ul = $('project-list-desktop');
  if (!ul) return;
  ul.innerHTML = state.projects
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(
      (p) => `
      <li>
        <button data-id="${p.id}" class="dproject-item w-full text-left px-2 py-1.5 rounded text-sm text-fg-muted hover:bg-bg-elevated hover:text-fg truncate">
          ${escapeHtml(p.name)}
        </button>
      </li>`,
    )
    .join('');
  ul.querySelectorAll<HTMLButtonElement>('.dproject-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      const p = state.projects.find((x) => x.id === btn.dataset.id);
      if (!p) return;
      state.target = { kind: 'project', project_id: p.id, label: p.name, sub: p.working_dir ?? '', working_dir: p.working_dir };
      applyTarget();
      openTaskModal();
    });
  });
}

// ---------- View switching ----------
function setTab(tab: Tab) {
  state.tab = tab;
  ['tasks', 'projects', 'sessions', 'chat', 'usage'].forEach((t) => {
    const el = document.getElementById(`view-${t}`);
    if (el) el.classList.toggle('hidden', t !== tab);
  });
  document.querySelectorAll<HTMLButtonElement>('.tab-btn').forEach((b) => {
    const active = b.dataset.tab === tab;
    b.classList.toggle('text-accent', active);
    b.classList.toggle('text-fg-muted', !active);
  });
  $('view-title').textContent = tab.charAt(0).toUpperCase() + tab.slice(1);
  $('search-input') && (($('search-input') as HTMLInputElement).placeholder = `Search ${tab}…`);
  // Chat input bar is fixed-positioned and only shown on chat tab
  const chatBar = document.getElementById('chat-input-bar');
  if (chatBar) chatBar.classList.toggle('hidden', tab !== 'chat');
  // Hide FAB on chat and usage (no "new task" context there)
  const fab = document.getElementById('fab-new-task');
  if (fab) fab.classList.toggle('hidden', tab === 'chat' || tab === 'usage');
  renderAll();
}

function renderAll() {
  if (state.tab === 'tasks') renderTasks();
  else if (state.tab === 'projects') renderProjects();
  else if (state.tab === 'sessions') renderSessions();
  else if (state.tab === 'chat') renderChatView();
  else if (state.tab === 'usage') renderUsage();
  renderDesktopSidebar();
}

// ---------- Chat view (pure Q&A) ----------
const CHAT_PROJECT_NAME = '__chat__';
async function ensureChatProject(): Promise<{ projectId: string; chatId: string }> {
  let p = state.projects.find((x) => x.name === CHAT_PROJECT_NAME);
  if (!p) {
    const res = await sb.from('projects').insert({ name: CHAT_PROJECT_NAME }).select().single();
    if (res.error) throw new Error(res.error.message);
    p = res.data;
    state.projects.unshift(p);
  }
  let c = state.chats.find((x) => x.project_id === p!.id && x.name === 'default');
  if (!c) {
    const res = await sb.from('chats').insert({ project_id: p!.id, name: 'default' }).select().single();
    if (res.error) throw new Error(res.error.message);
    c = res.data;
    state.chats.unshift(c);
  }
  return { projectId: p!.id, chatId: c!.id };
}

function renderChatView() {
  const list = $('chat-messages');
  const chatTasks = state.tasks
    .filter((t) => (t as any).kind === 'chat')
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

  if (chatTasks.length === 0) {
    list.innerHTML = `<div class="text-center text-fg-dim text-sm py-16">Ask Claude anything — no tools, no file edits.</div>`;
    return;
  }
  list.innerHTML = chatTasks
    .map((t) => {
      const status = t.status === 'running' ? '<span class="status-dot status-running ml-2"></span>' : '';
      const reply = t.result
        ? `<div class="mt-1.5 text-sm whitespace-pre-wrap">${escapeHtml(t.result)}</div>`
        : t.status === 'failed'
          ? `<div class="mt-1.5 text-xs text-status-failed">${escapeHtml(t.error ?? 'Failed')}</div>`
          : `<div class="mt-1.5 text-xs text-fg-dim italic">thinking…</div>`;
      const tokens = t.input_tokens || t.output_tokens
        ? `<div class="text-[10px] text-fg-dim mt-1">${t.model ?? ''} · ${t.input_tokens ?? 0} in · ${t.output_tokens ?? 0} out${t.duration_ms ? ' · ' + Math.round(t.duration_ms / 1000) + 's' : ''}</div>`
        : '';
      return `
      <div class="space-y-2">
        <div class="card p-3 bg-bg-elevated/60 ml-8 md:ml-16">
          <div class="text-[10px] uppercase tracking-wider text-fg-dim mb-1">You</div>
          <div class="text-sm whitespace-pre-wrap">${escapeHtml(t.instructions)}</div>
        </div>
        <div class="card p-3 mr-8 md:mr-16">
          <div class="text-[10px] uppercase tracking-wider text-accent mb-1 flex items-center">Claude${status}</div>
          ${reply}
          ${tokens}
        </div>
      </div>`;
    })
    .join('');
  // Scroll the parent section (which is the scroll container)
  const section = list.closest('section');
  if (section) section.scrollTop = section.scrollHeight;
  else list.scrollTop = list.scrollHeight;
}

async function sendChatMessage() {
  const ta = $('chat-input') as HTMLTextAreaElement;
  const text = ta.value.trim();
  if (!text) return;
  const model = ($('chat-model') as HTMLSelectElement).value;
  try {
    const { projectId, chatId } = await ensureChatProject();
    const title = text.split('\n')[0].slice(0, 60) || 'chat';
    const { error } = await sb.from('tasks').insert({
      project_id: projectId,
      chat_id: chatId,
      title,
      instructions: text,
      kind: 'chat',
      model,
    } as any);
    if (error) throw new Error(error.message);
    ta.value = '';
    ta.style.height = 'auto';
  } catch (e) {
    alert((e as Error).message);
  }
}

// ---------- Usage view (real-time, rolling windows) ----------
function getLimits() {
  const l5h = Number(localStorage.getItem('motaskbot-limit-5h') || 0);
  const lw = Number(localStorage.getItem('motaskbot-limit-week') || 0);
  return { l5h, lw };
}

function fmtDuration(ms: number): string {
  if (ms <= 0) return 'now';
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}

function renderUsage() {
  const now = Date.now();
  const h5Ago = now - 5 * 3_600_000;
  const weekAgo = now - 7 * 86_400_000;
  const monthAgo = now - 30 * 86_400_000;

  const win5h = state.tasks.filter((t) => new Date(t.created_at).getTime() >= h5Ago);
  const winWeek = state.tasks.filter((t) => new Date(t.created_at).getTime() >= weekAgo);
  const win30 = state.tasks.filter((t) => new Date(t.created_at).getTime() >= monthAgo);

  const sumTok = (arr: any[]) =>
    arr.reduce(
      (a, t) => a + ((t as any).input_tokens ?? 0) + ((t as any).output_tokens ?? 0),
      0,
    );
  const sumCost = (arr: any[]) =>
    arr.reduce((a, t) => a + Number((t as any).total_cost_usd ?? 0), 0);

  const { l5h, lw } = getLimits();

  // 5h window
  const tok5h = sumTok(win5h);
  const cost5h = sumCost(win5h);
  $('usage-5h-label').textContent = `${fmtNum(tok5h)} tokens · ${win5h.length} tasks${l5h ? ` / ${fmtNum(l5h)}` : ''}`;
  $('usage-5h-cost').textContent = cost5h > 0 ? `$${cost5h.toFixed(4)}` : '';
  const pct5h = l5h ? Math.min(100, (tok5h / l5h) * 100) : 0;
  $('usage-5h-bar').style.width = `${pct5h}%`;
  // Reset countdown: oldest task in window expires at createdAt + 5h
  const oldest5h = win5h.reduce<number | null>((min, t) => {
    const ts = new Date(t.created_at).getTime();
    return min === null || ts < min ? ts : min;
  }, null);
  const reset5h = oldest5h !== null ? oldest5h + 5 * 3_600_000 - now : 0;
  $('usage-5h-reset').textContent = reset5h > 0 ? `resets in ${fmtDuration(reset5h)}` : 'window empty';

  // Weekly rolling
  const tokW = sumTok(winWeek);
  const costW = sumCost(winWeek);
  $('usage-week-label').textContent = `${fmtNum(tokW)} tokens · ${winWeek.length} tasks${lw ? ` / ${fmtNum(lw)}` : ''}`;
  $('usage-week-cost').textContent = costW > 0 ? `$${costW.toFixed(4)}` : '';
  const pctW = lw ? Math.min(100, (tokW / lw) * 100) : 0;
  $('usage-week-bar').style.width = `${pctW}%`;
  const oldestWeek = winWeek.reduce<number | null>((min, t) => {
    const ts = new Date(t.created_at).getTime();
    return min === null || ts < min ? ts : min;
  }, null);
  const resetW = oldestWeek !== null ? oldestWeek + 7 * 86_400_000 - now : 0;
  $('usage-week-reset').textContent = resetW > 0 ? `resets in ${fmtDuration(resetW)}` : 'window empty';

  // Limits display
  $('usage-limit-5h-display').textContent = l5h ? fmtNum(l5h) + ' tok' : 'not set';
  $('usage-limit-week-display').textContent = lw ? fmtNum(lw) + ' tok' : 'not set';

  // Running task indicator
  const running = state.tasks
    .filter((t) => t.status === 'running')
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];
  const liveCard = $('usage-live');
  if (running) {
    liveCard.classList.remove('hidden');
    $('usage-live-title').textContent = running.title;
    $('usage-live-meta').textContent = `${(running as any).model ?? ''} · started ${relDate(running.created_at)}`;
  } else {
    liveCard.classList.add('hidden');
  }

  // By model 30d
  const byModel = new Map<string, { n: number; i: number; o: number; cost: number }>();
  for (const t of win30) {
    const m = (t as any).model ?? 'unknown';
    const cur = byModel.get(m) ?? { n: 0, i: 0, o: 0, cost: 0 };
    cur.n++;
    cur.i += (t as any).input_tokens ?? 0;
    cur.o += (t as any).output_tokens ?? 0;
    cur.cost += Number((t as any).total_cost_usd ?? 0);
    byModel.set(m, cur);
  }
  const ul = $('usage-by-model');
  if (byModel.size === 0) {
    ul.innerHTML = `<li class="text-fg-dim text-xs">No tasks in last 30d.</li>`;
  } else {
    ul.innerHTML = Array.from(byModel.entries())
      .sort((a, b) => b[1].n - a[1].n)
      .map(
        ([m, v]) => `<li class="flex items-center justify-between gap-2 py-1">
        <span class="font-medium">${escapeHtml(m)}</span>
        <span class="text-fg-muted text-xs">${v.n} · in ${fmtNum(v.i)} · out ${fmtNum(v.o)}${v.cost > 0 ? ' · $' + v.cost.toFixed(4) : ''}</span>
      </li>`,
      )
      .join('');
  }
}

// Refresh countdown every 15s when usage tab active
setInterval(() => {
  if (state.tab === 'usage') renderUsage();
}, 15_000);

// Plan limits modal
function openLimitsModal() {
  const { l5h, lw } = getLimits();
  ($('limits-5h') as HTMLInputElement).value = l5h ? String(l5h) : '';
  ($('limits-week') as HTMLInputElement).value = lw ? String(lw) : '';
  $('limits-modal').classList.remove('hidden');
}
function closeLimitsModal() {
  $('limits-modal').classList.add('hidden');
}
function saveLimits() {
  const l5h = Number(($('limits-5h') as HTMLInputElement).value || 0);
  const lw = Number(($('limits-week') as HTMLInputElement).value || 0);
  if (l5h > 0) localStorage.setItem('motaskbot-limit-5h', String(l5h));
  else localStorage.removeItem('motaskbot-limit-5h');
  if (lw > 0) localStorage.setItem('motaskbot-limit-week', String(lw));
  else localStorage.removeItem('motaskbot-limit-week');
  closeLimitsModal();
  renderUsage();
}

function fmtNum(n: number): string {
  if (!n) return '0';
  if (n < 1000) return n.toString();
  if (n < 1_000_000) return (n / 1000).toFixed(1) + 'k';
  return (n / 1_000_000).toFixed(2) + 'M';
}

// ---------- Task modal ----------
function openTaskModal() {
  ($('task-title') as HTMLInputElement).value = '';
  ($('task-instructions') as HTMLTextAreaElement).value = '';
  applyTarget();
  $('task-modal').classList.remove('hidden');
  setTimeout(() => ($('task-instructions') as HTMLTextAreaElement).focus(), 100);
}

function closeTaskModal() {
  $('task-modal').classList.add('hidden');
}

function applyTarget() {
  const label = $('target-label');
  const sub = $('target-sub');
  if (state.target) {
    label.textContent = state.target.label;
    sub.textContent = state.target.sub || (state.target.kind === 'session' ? 'Claude Code session' : '');
  } else {
    label.textContent = 'Choose a session or project';
    sub.textContent = 'Tap to pick';
  }
  // Show auto-push toggle only if target has a working_dir (git repo possible)
  const row = document.getElementById('auto-push-row');
  const input = document.getElementById('task-auto-push') as HTMLInputElement | null;
  if (row && input) {
    const hasDir = !!state.target?.working_dir;
    row.classList.toggle('hidden', !hasDir);
    if (hasDir) {
      // Pre-fill from existing chat's current auto_push flag
      const chat = state.chats.find(
        (c) =>
          (state.target!.chat_id && c.id === state.target!.chat_id) ||
          (state.target!.session_id && c.claude_session_id === state.target!.session_id) ||
          (state.target!.project_id && c.project_id === state.target!.project_id),
      );
      input.checked = !!(chat as any)?.auto_push;
    }
  }
}

// ---------- Target picker modal ----------
function openTargetModal() {
  renderTargetList();
  $('target-modal').classList.remove('hidden');
  ($('target-search') as HTMLInputElement).value = '';
  setTimeout(() => ($('target-search') as HTMLInputElement).focus(), 100);
}

function closeTargetModal() {
  $('target-modal').classList.add('hidden');
}

function renderTargetList() {
  const q = (($('target-search') as HTMLInputElement)?.value ?? '').toLowerCase();
  const list = $('target-list');
  const sessions = state.sessions
    .filter(
      (s) =>
        !q ||
        s.project_label.toLowerCase().includes(q) ||
        s.project_dir.toLowerCase().includes(q) ||
        (s.preview ?? '').toLowerCase().includes(q),
    )
    .sort((a, b) => new Date(b.last_activity_at).getTime() - new Date(a.last_activity_at).getTime())
    .slice(0, 50);

  const projects = state.projects
    .filter((p) => !q || p.name.toLowerCase().includes(q))
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, 20);

  list.innerHTML = `
    <div class="text-[10px] uppercase tracking-wider text-fg-muted px-3 py-2">Claude Code sessions</div>
    ${sessions
      .map(
        (s) => `
      <button data-sid="${s.session_id}" class="target-opt w-full text-left px-3 py-2.5 rounded-md hover:bg-bg-elevated active:bg-bg-elevated">
        <div class="flex items-center justify-between gap-2">
          <div class="text-sm font-medium truncate">${escapeHtml(s.project_label)}</div>
          <div class="text-[11px] text-fg-dim flex-shrink-0">${relDate(s.last_activity_at)}</div>
        </div>
        <div class="text-[11px] text-fg-muted truncate mt-0.5">${escapeHtml((s.preview ?? '').slice(0, 80))}</div>
      </button>`,
      )
      .join('')}
    <div class="text-[10px] uppercase tracking-wider text-fg-muted px-3 py-2 mt-3">Projects</div>
    ${projects
      .map(
        (p) => `
      <button data-pid="${p.id}" class="target-opt w-full text-left px-3 py-2.5 rounded-md hover:bg-bg-elevated active:bg-bg-elevated">
        <div class="text-sm font-medium truncate">${escapeHtml(p.name)}</div>
        ${p.working_dir ? `<div class="text-[11px] text-fg-dim font-mono truncate mt-0.5">${escapeHtml(p.working_dir)}</div>` : ''}
      </button>`,
      )
      .join('')}
    <button data-new-project="1" class="target-opt w-full text-left px-3 py-2.5 rounded-md hover:bg-bg-elevated active:bg-bg-elevated mt-3 border border-dashed border-border">
      <div class="text-sm font-medium text-accent">+ New project</div>
      <div class="text-[11px] text-fg-muted mt-0.5">Create a blank project</div>
    </button>
  `;

  list.querySelectorAll<HTMLButtonElement>('.target-opt').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (btn.dataset.newProject) {
        const name = prompt('Project name?');
        if (!name) return;
        const { data, error } = await sb.from('projects').insert({ name }).select().single();
        if (error) return alert(error.message);
        state.target = { kind: 'project', project_id: data.id, label: data.name, sub: '', working_dir: null };
      } else if (btn.dataset.sid) {
        const s = state.sessions.find((x) => x.session_id === btn.dataset.sid);
        if (!s) return;
        const chat = state.chats.find((c) => c.claude_session_id === s.session_id);
        state.target = {
          kind: 'session',
          session_id: s.session_id,
          chat_id: chat?.id,
          project_id: chat?.project_id,
          label: s.project_label,
          sub: s.project_dir,
          working_dir: s.project_dir,
        };
      } else if (btn.dataset.pid) {
        const p = state.projects.find((x) => x.id === btn.dataset.pid);
        if (!p) return;
        state.target = { kind: 'project', project_id: p.id, label: p.name, sub: p.working_dir ?? '', working_dir: p.working_dir };
      }
      applyTarget();
      closeTargetModal();
    });
  });
}

// ---------- Submit task ----------
async function submitTask() {
  const instructions = ($('task-instructions') as HTMLTextAreaElement).value.trim();
  if (!instructions) return alert('Write a prompt first.');
  if (!state.target) return alert('Pick a target (session or project).');

  let title = ($('task-title') as HTMLInputElement).value.trim();
  if (!title) {
    title = instructions.split('\n')[0].slice(0, 80).trim() || 'Untitled task';
  }

  let chat_id = state.target.chat_id;
  let project_id = state.target.project_id;

  // If session picked but no chat yet, create one
  if (state.target.kind === 'session' && !chat_id) {
    const session_id = state.target.session_id!;
    // Find or create project matching working_dir
    if (!project_id) {
      const existingProj = state.projects.find((p) => p.working_dir === state.target!.working_dir);
      if (existingProj) project_id = existingProj.id;
      else {
        const { data, error } = await sb
          .from('projects')
          .insert({ name: state.target.label, working_dir: state.target.working_dir ?? null, source: 'claude_code' })
          .select()
          .single();
        if (error) return alert(error.message);
        project_id = data.id;
      }
    }
    const { data, error } = await sb
      .from('chats')
      .insert({
        project_id: project_id!,
        name: state.target.label,
        claude_session_id: session_id,
        working_dir: state.target.working_dir ?? null,
      })
      .select()
      .single();
    if (error) return alert(error.message);
    chat_id = data.id;
  }

  // If only project picked, pick or create default chat under it
  if (!chat_id && project_id) {
    let chat = state.chats.find((c) => c.project_id === project_id && !c.claude_session_id);
    if (!chat) {
      const project = state.projects.find((p) => p.id === project_id);
      const { data, error } = await sb
        .from('chats')
        .insert({
          project_id,
          name: 'default',
          working_dir: project?.working_dir ?? null,
        })
        .select()
        .single();
      if (error) return alert(error.message);
      chat = data;
    }
    chat_id = chat!.id;
  }

  if (!chat_id || !project_id) return alert('Could not resolve target.');

  // Persist auto-push flag on chat if toggle visible + has working_dir
  const autoPushInput = document.getElementById('task-auto-push') as HTMLInputElement | null;
  if (autoPushInput && state.target?.working_dir) {
    const desired = autoPushInput.checked;
    const current = state.chats.find((c) => c.id === chat_id);
    if (current && (current as any).auto_push !== desired) {
      await sb.from('chats').update({ auto_push: desired } as any).eq('id', chat_id);
    }
  }

  const model = ($('task-model') as HTMLSelectElement)?.value || 'haiku';
  const { error } = await sb.from('tasks').insert({ project_id, chat_id, title, instructions, model } as any);
  if (error) return alert(error.message);

  closeTaskModal();
  state.target = null;
  setTab('tasks');
}

// ---------- Task detail ----------
function openDetail(taskId: string) {
  const t = state.tasks.find((x) => x.id === taskId);
  if (!t) return;
  $('detail-title').textContent = t.title;
  const meta = [`${t.status.toUpperCase()}`, relDate(t.updated_at)];
  if ((t as any).model) meta.push((t as any).model);
  const tokens = ((t as any).input_tokens ?? 0) + ((t as any).output_tokens ?? 0);
  if (tokens) meta.push(`${fmtNum(tokens)} tok`);
  const cost = Number((t as any).total_cost_usd ?? 0);
  if (cost > 0) meta.push(`$${cost.toFixed(4)}`);
  const dur = Number((t as any).duration_ms ?? 0);
  if (dur) meta.push(`${(dur / 1000).toFixed(1)}s`);
  $('detail-meta').textContent = meta.join(' · ');
  $('detail-instructions').textContent = t.instructions;
  $('detail-result').textContent = t.result ?? '—';
  const errWrap = $('detail-error-wrap');
  if (t.error) {
    errWrap.classList.remove('hidden');
    $('detail-error').textContent = t.error;
  } else {
    errWrap.classList.add('hidden');
  }
  // Toggle header action buttons per status
  const cancelBtn = document.getElementById('detail-cancel');
  const editBtn = document.getElementById('detail-edit');
  const retryBtn = document.getElementById('detail-retry');
  cancelBtn?.classList.toggle('hidden', t.status !== 'running');
  editBtn?.classList.toggle('hidden', t.status !== 'pending');
  retryBtn?.classList.toggle('hidden', t.status !== 'failed' && t.status !== 'completed');
  // Pin icon state
  const pinBtn = document.getElementById('detail-pin');
  if (pinBtn) {
    const pinned = state.pinnedIds.has(t.id);
    pinBtn.classList.toggle('text-accent', pinned);
    pinBtn.classList.toggle('text-fg-dim', !pinned);
    pinBtn.setAttribute('title', pinned ? 'Unpin' : 'Pin');
  }
  // Thread: other tasks in same chat
  renderDetailThread(t);
  ($('detail-reply') as HTMLTextAreaElement).value = '';
  $('detail-modal').classList.remove('hidden');
  $('detail-modal').dataset.taskId = taskId;
}

function renderDetailThread(current: Task) {
  const wrap = document.getElementById('detail-thread-wrap');
  const list = document.getElementById('detail-thread');
  if (!wrap || !list) return;
  const thread = state.tasks
    .filter((t) => t.chat_id === current.chat_id && t.id !== current.id)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 10);
  if (thread.length === 0) {
    wrap.classList.add('hidden');
    return;
  }
  wrap.classList.remove('hidden');
  list.innerHTML = thread
    .map(
      (t) => `
      <li>
        <button data-thread-id="${t.id}" class="thread-link w-full text-left px-2 py-1.5 rounded-md hover:bg-bg-elevated active:bg-bg-elevated flex items-center gap-2">
          <span class="status-dot status-${t.status} flex-shrink-0"></span>
          <span class="flex-1 truncate text-xs">${escapeHtml(t.title)}</span>
          <span class="text-[10px] text-fg-dim flex-shrink-0">${relDate(t.created_at)}</span>
        </button>
      </li>`,
    )
    .join('');
  list.querySelectorAll<HTMLButtonElement>('.thread-link').forEach((btn) => {
    btn.addEventListener('click', () => openDetail(btn.dataset.threadId!));
  });
}

// ---------- Load + Realtime ----------
async function load() {
  const [projects, chats, tasks, sessions] = await Promise.all([
    sb.from('projects').select('*').order('created_at', { ascending: false }),
    sb.from('chats').select('*').order('created_at', { ascending: false }),
    sb.from('tasks').select('*').order('created_at', { ascending: false }),
    sb.from('claude_sessions').select('*').order('last_activity_at', { ascending: false }),
  ]);
  state.projects = projects.data ?? [];
  state.chats = chats.data ?? [];
  state.tasks = tasks.data ?? [];
  state.sessions = sessions.data ?? [];
  renderAll();
}

function subscribeRealtime() {
  const ch = sb.channel('motaskbot');

  ch.on('postgres_changes', { event: '*', schema: 'public', table: 'projects' }, (payload) => {
    applyChange(state.projects, payload);
    renderAll();
  });
  ch.on('postgres_changes', { event: '*', schema: 'public', table: 'chats' }, (payload) => {
    applyChange(state.chats, payload);
    renderAll();
  });
  ch.on('postgres_changes', { event: '*', schema: 'public', table: 'claude_sessions' }, (payload) => {
    const row = (payload.new ?? payload.old) as ClaudeSession;
    const idx = state.sessions.findIndex((s) => s.session_id === row.session_id);
    if (payload.eventType === 'DELETE') {
      if (idx >= 0) state.sessions.splice(idx, 1);
    } else if (idx >= 0) state.sessions[idx] = payload.new as ClaudeSession;
    else state.sessions.unshift(payload.new as ClaudeSession);
    renderAll();
  });
  ch.on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, (payload) => {
    applyChange(state.tasks, payload);
    renderAll();
    const detailModal = $('detail-modal');
    if (!detailModal.classList.contains('hidden') && detailModal.dataset.taskId === (payload.new as any)?.id) {
      openDetail((payload.new as any).id);
    }
    setStatus(state.tasks.some((t) => t.status === 'running') ? 'running task…' : 'idle');
  });

  ch.subscribe((status) => {
    if (status === 'SUBSCRIBED') setStatus('connected');
  });
}

function applyChange<T extends { id: string }>(arr: T[], payload: any) {
  if (payload.eventType === 'INSERT') {
    if (!arr.find((x) => x.id === payload.new.id)) arr.unshift(payload.new);
  } else if (payload.eventType === 'UPDATE') {
    const i = arr.findIndex((x) => x.id === payload.new.id);
    if (i >= 0) arr[i] = payload.new;
    else arr.unshift(payload.new);
  } else if (payload.eventType === 'DELETE') {
    const i = arr.findIndex((x) => x.id === payload.old.id);
    if (i >= 0) arr.splice(i, 1);
  }
}

function setStatus(s: string) {
  document.querySelectorAll('[data-worker]').forEach((el) => (el.textContent = `realtime: ${s}`));
  const dsk = $('worker-status-desktop');
  if (dsk) dsk.textContent = `realtime: ${s}`;
}

// ---------- Theme management ----------
function loadTheme() {
  const saved = localStorage.getItem('motaskbot-theme');
  state.theme = saved || 'dark';
  applyTheme(state.theme);
  applyCustomAccent();
  // Sync custom accent input value
  const savedAccent = localStorage.getItem('motaskbot-custom-accent');
  const input = document.getElementById('custom-accent') as HTMLInputElement | null;
  if (input && savedAccent) input.value = savedAccent;
}

function applyTheme(theme: string) {
  state.theme = theme;
  document.documentElement.dataset.theme = theme;
  localStorage.setItem('motaskbot-theme', theme);
  const options = document.querySelectorAll<HTMLButtonElement>('.theme-option');
  options.forEach(btn => {
    btn.classList.toggle('border-accent', btn.dataset.theme === theme);
    btn.classList.toggle('bg-bg-elevated', btn.dataset.theme === theme);
    btn.classList.toggle('border-border', btn.dataset.theme !== theme);
  });
  // Re-apply custom accent on top of new theme if user has one set
  applyCustomAccent();
}

// Hex → "r g b" RGB tuple for CSS var
function hexToRgbTuple(hex: string): string | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
}

// Shift accent hex slightly darker for hover
function shiftHex(hex: string, amt = -15): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const r = Math.max(0, Math.min(255, ((n >> 16) & 255) + amt));
  const g = Math.max(0, Math.min(255, ((n >> 8) & 255) + amt));
  const b = Math.max(0, Math.min(255, (n & 255) + amt));
  return `${r} ${g} ${b}`;
}

function applyCustomAccent() {
  const hex = localStorage.getItem('motaskbot-custom-accent');
  if (!hex) {
    document.documentElement.style.removeProperty('--color-accent');
    document.documentElement.style.removeProperty('--color-accent-hover');
    return;
  }
  const rgb = hexToRgbTuple(hex);
  if (!rgb) return;
  document.documentElement.style.setProperty('--color-accent', rgb);
  document.documentElement.style.setProperty('--color-accent-hover', shiftHex(hex, -20));
}

function setCustomAccent(hex: string) {
  localStorage.setItem('motaskbot-custom-accent', hex);
  applyCustomAccent();
}

function resetCustomAccent() {
  localStorage.removeItem('motaskbot-custom-accent');
  applyCustomAccent();
}

function openThemeModal() {
  $('theme-modal').classList.remove('hidden');
}

function closeThemeModal() {
  $('theme-modal').classList.add('hidden');
}

// ---------- Wire up (safe: null elements are skipped) ----------
function on(id: string, ev: string, fn: (e: Event) => void) {
  const el = document.getElementById(id);
  if (el) el.addEventListener(ev, fn);
  else console.warn(`[motaskbot] element '${id}' not found — listener skipped`);
}

document.querySelectorAll<HTMLButtonElement>('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => setTab(btn.dataset.tab as Tab));
});

$('fab-new-task').addEventListener('click', openTaskModal);
$('usage-edit-limits')?.addEventListener('click', openLimitsModal);
$('limits-cancel')?.addEventListener('click', closeLimitsModal);
$('limits-save')?.addEventListener('click', saveLimits);
$('limits-modal')?.addEventListener('click', (e) => {
  if (e.target === $('limits-modal')) closeLimitsModal();
});

$('chat-send')?.addEventListener('click', sendChatMessage);
$('chat-input')?.addEventListener('keydown', (e: any) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendChatMessage();
  }
});
$('desktop-new-task')?.addEventListener('click', openTaskModal);
$('task-close').addEventListener('click', closeTaskModal);
$('task-create').addEventListener('click', submitTask);
$('task-modal').addEventListener('click', (e) => {
  if (e.target === $('task-modal')) closeTaskModal();
});

$('target-selected').addEventListener('click', openTargetModal);
$('target-close').addEventListener('click', closeTargetModal);
$('target-search').addEventListener('input', renderTargetList);
$('target-modal').addEventListener('click', (e) => {
  if (e.target === $('target-modal')) closeTargetModal();
});

async function sendReplyToTask(replyText: string) {
  const taskId = $('detail-modal').dataset.taskId;
  if (!taskId) return;
  const original = state.tasks.find((t) => t.id === taskId);
  if (!original) return;
  const text = replyText.trim();
  if (!text) return alert('Write a reply first.');

  const { error } = await sb.from('tasks').insert({
    project_id: original.project_id,
    chat_id: original.chat_id,
    title: text.split('\n')[0].slice(0, 80) || 'Reply',
    instructions: text,
  });
  if (error) return alert(error.message);

  ($('detail-reply') as HTMLTextAreaElement).value = '';
  $('detail-modal').classList.add('hidden');
  setTab('tasks');
}

$('detail-reply-send')?.addEventListener('click', () => {
  sendReplyToTask(($('detail-reply') as HTMLTextAreaElement).value);
});
$('detail-reply-yes')?.addEventListener('click', () => {
  sendReplyToTask('sí, procede');
});

$('detail-close').addEventListener('click', () => $('detail-modal').classList.add('hidden'));
$('detail-delete')?.addEventListener('click', async () => {
  const id = $('detail-modal').dataset.taskId;
  if (!id) return;
  if (!confirm('Delete this task?')) return;
  const { error } = await sb.from('tasks').delete().eq('id', id);
  if (error) return alert(error.message);
  $('detail-modal').classList.add('hidden');
});
$('detail-pin')?.addEventListener('click', () => {
  const id = $('detail-modal').dataset.taskId;
  if (!id) return;
  togglePin(id);
  const t = state.tasks.find((x) => x.id === id);
  if (t) openDetail(id);
  renderTasks();
});
$('detail-retry')?.addEventListener('click', async () => {
  const id = $('detail-modal').dataset.taskId;
  if (!id) return;
  await retryTask(id);
  $('detail-modal').classList.add('hidden');
});
$('detail-cancel')?.addEventListener('click', async () => {
  const id = $('detail-modal').dataset.taskId;
  if (!id) return;
  await cancelTask(id);
});
$('detail-edit')?.addEventListener('click', async () => {
  const id = $('detail-modal').dataset.taskId;
  if (!id) return;
  const t = state.tasks.find((x) => x.id === id);
  if (!t) return;
  const next = prompt('Edit prompt (only while pending):', t.instructions);
  if (next === null || next.trim() === '') return;
  await editPendingTask(id, next.trim());
});
$('detail-copy')?.addEventListener('click', async () => {
  const id = $('detail-modal').dataset.taskId;
  if (!id) return;
  const t = state.tasks.find((x) => x.id === id);
  if (!t?.result) return alert('No result to copy.');
  try {
    await navigator.clipboard.writeText(t.result);
    const btn = document.getElementById('detail-copy');
    if (btn) {
      const original = btn.innerHTML;
      btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
      setTimeout(() => (btn.innerHTML = original), 1200);
    }
  } catch {
    alert('Clipboard API unavailable.');
  }
});

$('tasks-filter-chat')?.addEventListener('change', (e) => {
  state.filterChat = (e.target as HTMLSelectElement).value;
  renderTasks();
});
$('tasks-sort')?.addEventListener('change', (e) => {
  state.sortBy = (e.target as HTMLSelectElement).value as SortBy;
  renderTasks();
});
document.querySelectorAll<HTMLButtonElement>('[data-status-chip]').forEach((btn) => {
  btn.addEventListener('click', () => {
    state.filterStatus = btn.dataset.statusChip ?? '';
    renderTasks();
  });
});
$('tasks-clear-completed')?.addEventListener('click', async () => {
  const visible = state.tasks
    .filter((t) => (t as any).kind !== 'chat')
    .filter((t) => !state.filterChat || t.chat_id === state.filterChat)
    .filter((t) => t.status === 'completed' || t.status === 'failed');
  if (visible.length === 0) return alert('Nothing to clear.');
  if (!confirm(`Delete ${visible.length} completed/failed task(s)?`)) return;
  const ids = visible.map((t) => t.id);
  const { error } = await sb.from('tasks').delete().in('id', ids);
  if (error) alert(error.message);
});
$('detail-modal').addEventListener('click', (e) => {
  if (e.target === $('detail-modal')) $('detail-modal').classList.add('hidden');
});

$('search-toggle').addEventListener('click', () => {
  state.searchOpen = !state.searchOpen;
  $('search-bar').classList.toggle('hidden', !state.searchOpen);
  if (state.searchOpen) setTimeout(() => ($('search-input') as HTMLInputElement).focus(), 50);
  else {
    state.searchQuery = '';
    ($('search-input') as HTMLInputElement).value = '';
    renderAll();
  }
});
$('search-input').addEventListener('input', (e) => {
  state.searchQuery = (e.target as HTMLInputElement).value;
  renderAll();
});

$('new-project-btn-desktop')?.addEventListener('click', async () => {
  const name = prompt('Project name?');
  if (!name) return;
  const { error } = await sb.from('projects').insert({ name });
  if (error) alert(error.message);
});

// Re-render "time ago" every minute
setInterval(() => renderAll(), 60_000);

// ---------- Auth gate ----------
async function initAuth() {
  const { data } = await sb.auth.getSession();
  if (data.session) showApp();
  else showLogin();

  sb.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') showLogin();
    if (event === 'SIGNED_IN') showApp();
  });
}

function showApp() {
  $('login-screen').classList.add('hidden');
  $('app-root').classList.remove('hidden');
  if (!(window as any).__motaskbot_loaded) {
    (window as any).__motaskbot_loaded = true;
    setTab('tasks');
    load().then(subscribeRealtime);
  }
}

function showLogin() {
  $('app-root').classList.add('hidden');
  $('login-screen').classList.remove('hidden');
}

$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = ($('login-email') as HTMLInputElement).value.trim();
  const password = ($('login-password') as HTMLInputElement).value;
  const errEl = $('login-error');
  errEl.classList.add('hidden');
  const submit = $('login-submit') as HTMLButtonElement;
  submit.disabled = true;
  submit.textContent = 'Signing in…';
  const { error } = await sb.auth.signInWithPassword({ email, password });
  submit.disabled = false;
  submit.textContent = 'Sign in';
  if (error) {
    errEl.textContent = error.message;
    errEl.classList.remove('hidden');
  }
});

$('logout-btn')?.addEventListener('click', async () => {
  await sb.auth.signOut();
});

$('theme-toggle').addEventListener('click', openThemeModal);
$('theme-close').addEventListener('click', closeThemeModal);
document.querySelectorAll<HTMLButtonElement>('.theme-option').forEach(btn => {
  btn.addEventListener('click', () => {
    applyTheme(btn.dataset.theme!);
    closeThemeModal();
  });
});
$('theme-modal').addEventListener('click', (e) => {
  if (e.target === $('theme-modal')) closeThemeModal();
});

// Custom accent pickers
document.getElementById('custom-accent')?.addEventListener('input', (e) => {
  setCustomAccent((e.target as HTMLInputElement).value);
});
document.getElementById('custom-accent-reset')?.addEventListener('click', () => {
  resetCustomAccent();
  const input = document.getElementById('custom-accent') as HTMLInputElement | null;
  if (input) input.value = '#7c5cff';
});

// Run auth gate FIRST so login screen shows even if later wire-up breaks.
try { loadTheme(); } catch (e) { console.error('loadTheme failed', e); }
// iOS install hint: show banner for Safari on iOS when not yet in standalone mode.
function maybeShowIosInstallBanner() {
  try {
    const ua = navigator.userAgent;
    const isIOS = /iPad|iPhone|iPod/.test(ua) && !(window as any).MSStream;
    const isSafari = /Safari/i.test(ua) && !/CriOS|FxiOS|EdgiOS/i.test(ua);
    const isStandalone =
      (window.navigator as any).standalone === true ||
      window.matchMedia('(display-mode: standalone)').matches;
    const dismissed = localStorage.getItem('motaskbot-ios-banner-dismissed') === '1';
    if (isIOS && isSafari && !isStandalone && !dismissed) {
      const banner = document.getElementById('ios-install-banner');
      if (banner) banner.classList.remove('hidden');
    }
  } catch {}
}
document.getElementById('ios-banner-close')?.addEventListener('click', () => {
  document.getElementById('ios-install-banner')?.classList.add('hidden');
  localStorage.setItem('motaskbot-ios-banner-dismissed', '1');
});
maybeShowIosInstallBanner();

initAuth().catch((e) => {
  console.error('initAuth failed, forcing login screen', e);
  showLogin();
});

// Final fallback: if neither screen is visible after 3s, force login.
setTimeout(() => {
  const loginHidden = $('login-screen').classList.contains('hidden');
  const appHidden = $('app-root').classList.contains('hidden');
  if (loginHidden && appHidden) {
    console.warn('[motaskbot] both screens hidden after 3s — forcing login');
    showLogin();
  }
}, 3000);
