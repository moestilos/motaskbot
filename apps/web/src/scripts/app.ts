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
};

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

function renderTasks() {
  renderTasksFilterOptions();
  const ul = $('tasks-feed');
  const empty = $('tasks-empty');
  const q = state.searchQuery.toLowerCase();
  const tasks = state.tasks
    .filter((t) => (t as any).kind !== 'chat')
    .filter((t) => !state.filterChat || t.chat_id === state.filterChat)
    .filter((t) => !state.filterStatus || t.status === state.filterStatus)
    .filter((t) => {
      if (!q) return true;
      return (t.title + ' ' + t.instructions + ' ' + (t.result ?? '')).toLowerCase().includes(q);
    })
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());

  if (tasks.length === 0) {
    ul.classList.add('hidden');
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');
  ul.classList.remove('hidden');

  ul.innerHTML = tasks
    .map((t) => {
      const chat = state.chats.find((c) => c.id === t.chat_id);
      const project = chat ? state.projects.find((p) => p.id === chat.project_id) : null;
      const preview = t.result
        ? t.result.slice(0, 180).replace(/\s+/g, ' ')
        : t.instructions.slice(0, 180).replace(/\s+/g, ' ');
      const projectBit = project ? `<span class="truncate">${escapeHtml(project.name)}</span>` : '';
      const chatBit = chat?.claude_session_id
        ? `<span class="text-accent">⎋</span>`
        : '';
      const deletable = t.status === 'completed' || t.status === 'failed';
      return `
      <li class="relative">
        <button data-id="${t.id}" class="task-item w-full text-left card px-4 py-3 active:bg-bg-elevated transition-colors">
          <div class="flex items-start gap-3">
            <span class="status-dot status-${t.status} mt-1.5 flex-shrink-0"></span>
            <div class="flex-1 min-w-0 pr-8">
              <div class="flex items-baseline justify-between gap-2">
                <div class="text-sm font-medium truncate">${escapeHtml(t.title)}</div>
                <div class="text-[11px] text-fg-dim flex-shrink-0">${relDate(t.updated_at)}</div>
              </div>
              <div class="text-xs text-fg-muted line-clamp-2 mt-0.5">${escapeHtml(preview)}</div>
              <div class="text-[11px] text-fg-dim mt-1.5 flex items-center gap-1.5 flex-wrap">
                <span class="uppercase tracking-wide">${t.status}</span>
                ${projectBit ? '<span>·</span>' + projectBit : ''}
                ${chatBit}
                ${(t as any).model ? `<span>·</span><span class="text-fg-muted">${escapeHtml((t as any).model)}</span>` : ''}
                ${(t as any).input_tokens ? `<span>·</span><span>${fmtNum(((t as any).input_tokens ?? 0) + ((t as any).output_tokens ?? 0))} tok</span>` : ''}
              </div>
            </div>
          </div>
        </button>
        ${deletable ? `<button data-del-id="${t.id}" aria-label="Delete task" class="task-del absolute top-2 right-2 btn-ghost !p-2 text-fg-dim hover:text-status-failed">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/></svg>
        </button>` : ''}
      </li>`;
    })
    .join('');

  ul.querySelectorAll<HTMLButtonElement>('.task-item').forEach((btn) => {
    btn.addEventListener('click', () => openDetail(btn.dataset.id!));
  });
  ul.querySelectorAll<HTMLButtonElement>('.task-del').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.dataset.delId!;
      if (!confirm('Delete this task?')) return;
      const { error } = await sb.from('tasks').delete().eq('id', id);
      if (error) alert(error.message);
    });
  });
}

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
                ${p.source === 'claude_code' ? '<span class="text-[10px] text-accent">⎋ CC</span>' : ''}
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
            <span>⎋ ${s.session_id.slice(0, 8)}</span>
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
  list.scrollTop = list.scrollHeight;
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
        <span class="text-fg-muted text-xs">${v.n} · ${fmtNum(v.i)}↓ ${fmtNum(v.o)}↑${v.cost > 0 ? ' · $' + v.cost.toFixed(4) : ''}</span>
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
    sub.textContent = state.target.sub || (state.target.kind === 'session' ? '⎋ Claude Code session' : '');
  } else {
    label.textContent = 'Choose a session or project';
    sub.textContent = 'Tap to pick';
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
  $('detail-meta').textContent = `${t.status.toUpperCase()} · ${relDate(t.updated_at)}`;
  $('detail-instructions').textContent = t.instructions;
  $('detail-result').textContent = t.result ?? '—';
  const errWrap = $('detail-error-wrap');
  if (t.error) {
    errWrap.classList.remove('hidden');
    $('detail-error').textContent = t.error;
  } else {
    errWrap.classList.add('hidden');
  }
  ($('detail-reply') as HTMLTextAreaElement).value = '';
  $('detail-modal').classList.remove('hidden');
  $('detail-modal').dataset.taskId = taskId;
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
}

function applyTheme(theme: string) {
  state.theme = theme;
  document.documentElement.dataset.theme = theme;
  localStorage.setItem('motaskbot-theme', theme);
  const options = document.querySelectorAll<HTMLButtonElement>('.theme-option');
  options.forEach(btn => {
    btn.classList.toggle('border-accent bg-bg-elevated', btn.dataset.theme === theme);
    btn.classList.toggle('border-border', btn.dataset.theme !== theme);
  });
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

$('tasks-filter-chat')?.addEventListener('change', (e) => {
  state.filterChat = (e.target as HTMLSelectElement).value;
  renderTasks();
});
$('tasks-filter-status')?.addEventListener('change', (e) => {
  state.filterStatus = (e.target as HTMLSelectElement).value;
  renderTasks();
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
