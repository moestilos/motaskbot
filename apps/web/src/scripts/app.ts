import { getSupabase } from '../lib/supabase';
import type { Project, Chat, Task, ClaudeSession } from '@motaskbot/shared/types';

const sb = getSupabase();

type Tab = 'tasks' | 'projects' | 'sessions';

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
function renderTasks() {
  const ul = $('tasks-feed');
  const empty = $('tasks-empty');
  const q = state.searchQuery.toLowerCase();
  const tasks = state.tasks
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
      return `
      <li>
        <button data-id="${t.id}" class="task-item w-full text-left card px-4 py-3 active:bg-bg-elevated transition-colors">
          <div class="flex items-start gap-3">
            <span class="status-dot status-${t.status} mt-1.5 flex-shrink-0"></span>
            <div class="flex-1 min-w-0">
              <div class="flex items-baseline justify-between gap-2">
                <div class="text-sm font-medium truncate">${escapeHtml(t.title)}</div>
                <div class="text-[11px] text-fg-dim flex-shrink-0">${relDate(t.updated_at)}</div>
              </div>
              <div class="text-xs text-fg-muted line-clamp-2 mt-0.5">${escapeHtml(preview)}</div>
              <div class="text-[11px] text-fg-dim mt-1.5 flex items-center gap-1.5">
                <span class="uppercase tracking-wide">${t.status}</span>
                ${projectBit ? '<span>·</span>' + projectBit : ''}
                ${chatBit}
              </div>
            </div>
          </div>
        </button>
      </li>`;
    })
    .join('');

  ul.querySelectorAll<HTMLButtonElement>('.task-item').forEach((btn) => {
    btn.addEventListener('click', () => openDetail(btn.dataset.id!));
  });
}

// ---------- Rendering: Projects feed ----------
function renderProjects() {
  const ul = $('projects-feed');
  const q = state.searchQuery.toLowerCase();
  const projects = state.projects
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
  ['tasks', 'projects', 'sessions'].forEach((t) => {
    $(`view-${t}`).classList.toggle('hidden', t !== tab);
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
  renderDesktopSidebar();
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

  const { error } = await sb.from('tasks').insert({ project_id, chat_id, title, instructions });
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
