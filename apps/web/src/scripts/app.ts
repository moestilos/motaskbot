import { getSupabase } from '../lib/supabase';
import type { Project, Chat, Task, ClaudeSession } from '@motaskbot/shared/types';

const sb = getSupabase();

const state = {
  projects: [] as Project[],
  chats: [] as Chat[],
  tasks: [] as Task[],
  sessions: [] as ClaudeSession[],
  currentProjectId: null as string | null,
  currentChatId: null as string | null,
};

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

// ---------- Rendering ----------
function renderProjects() {
  const ul = $('project-list');
  ul.innerHTML = state.projects
    .map(
      (p) => `
      <li>
        <button data-id="${p.id}" class="project-item w-full text-left px-2 py-1.5 rounded text-sm ${p.id === state.currentProjectId ? 'bg-bg-elevated text-fg' : 'text-fg-muted hover:bg-bg-elevated hover:text-fg'}">
          ${escapeHtml(p.name)}
        </button>
      </li>`
    )
    .join('');
  ul.querySelectorAll<HTMLButtonElement>('.project-item').forEach((btn) => {
    btn.addEventListener('click', () => selectProject(btn.dataset.id!));
  });
}

function renderChats() {
  const section = $('chats-section');
  const ul = $('chat-list');
  if (!state.currentProjectId) {
    section.classList.add('hidden');
    return;
  }
  section.classList.remove('hidden');
  const chats = state.chats.filter((c) => c.project_id === state.currentProjectId);
  ul.innerHTML =
    chats
      .map(
        (c) => {
          const tag = c.claude_session_id
            ? `<span class="text-[10px] text-accent ml-1">⎋ CC</span>`
            : '';
          return `
      <li>
        <button data-id="${c.id}" class="chat-item w-full text-left px-2 py-1.5 rounded text-sm ${c.id === state.currentChatId ? 'bg-bg-elevated text-fg' : 'text-fg-muted hover:bg-bg-elevated hover:text-fg'}">
          # ${escapeHtml(c.name)}${tag}
        </button>
      </li>`;
        },
      )
      .join('') ||
    `<li class="text-[11px] text-fg-dim px-2 py-1">No chats yet.</li>`;
  ul.querySelectorAll<HTMLButtonElement>('.chat-item').forEach((btn) => {
    btn.addEventListener('click', () => selectChat(btn.dataset.id!));
  });
}

function renderTasks() {
  const list = $('task-list');
  const empty = $('empty-state');
  const newBtn = $('new-task-btn');
  const title = $('main-title');
  const subtitle = $('main-subtitle');

  if (!state.currentProjectId) {
    list.classList.add('hidden');
    empty.classList.remove('hidden');
    empty.textContent = 'Create a project to get started.';
    newBtn.classList.add('hidden');
    title.textContent = 'Select a project';
    subtitle.textContent = '';
    return;
  }

  const project = state.projects.find((p) => p.id === state.currentProjectId);
  title.textContent = project?.name ?? '';
  const chat = state.chats.find((c) => c.id === state.currentChatId);
  if (chat) {
    const bits = [`# ${chat.name}`];
    if (chat.working_dir) bits.push(`📁 ${chat.working_dir}`);
    if (chat.claude_session_id) bits.push(`⎋ ${chat.claude_session_id.slice(0, 8)}`);
    subtitle.textContent = bits.join(' · ');
  } else {
    subtitle.textContent = 'all chats';
  }

  const chatsForProject = state.chats.filter((c) => c.project_id === state.currentProjectId);
  const tasks = state.tasks
    .filter((t) => t.project_id === state.currentProjectId)
    .filter((t) => (state.currentChatId ? t.chat_id === state.currentChatId : true))
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  newBtn.classList.toggle('hidden', chatsForProject.length === 0);

  if (tasks.length === 0) {
    list.classList.add('hidden');
    empty.classList.remove('hidden');
    empty.textContent =
      chatsForProject.length === 0 ? 'Create a chat first, then add tasks.' : 'No tasks yet. Click "New Task".';
    return;
  }
  empty.classList.add('hidden');
  list.classList.remove('hidden');
  list.innerHTML = tasks
    .map(
      (t) => `
      <li>
        <button data-id="${t.id}" class="task-item w-full text-left card hover:border-accent/50 transition-colors px-4 py-3 flex items-start gap-3">
          <span class="status-dot status-${t.status} mt-1.5 flex-shrink-0"></span>
          <div class="flex-1 min-w-0">
            <div class="flex items-center justify-between gap-3">
              <div class="text-sm font-medium truncate">${escapeHtml(t.title)}</div>
              <div class="text-[11px] text-fg-dim flex-shrink-0">${formatTime(t.updated_at)}</div>
            </div>
            <div class="text-xs text-fg-muted truncate mt-0.5">${escapeHtml(t.instructions.slice(0, 140))}</div>
            <div class="text-[11px] text-fg-dim mt-1">
              <span class="uppercase tracking-wide">${t.status}</span>
              ${chatLabel(t.chat_id)}
            </div>
          </div>
        </button>
      </li>`
    )
    .join('');
  list.querySelectorAll<HTMLButtonElement>('.task-item').forEach((btn) => {
    btn.addEventListener('click', () => openDetail(btn.dataset.id!));
  });
}

function chatLabel(chatId: string) {
  const c = state.chats.find((x) => x.id === chatId);
  return c ? ` · # ${escapeHtml(c.name)}` : '';
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function formatTime(iso: string) {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return d.toLocaleDateString();
}

// ---------- Selection ----------
function selectProject(id: string) {
  state.currentProjectId = id;
  state.currentChatId = null;
  renderProjects();
  renderChats();
  renderTasks();
  syncFab();
  if (window.matchMedia('(max-width: 767px)').matches) closeSidebar();
}

function selectChat(id: string) {
  state.currentChatId = state.currentChatId === id ? null : id;
  renderChats();
  renderTasks();
  syncFab();
  if (window.matchMedia('(max-width: 767px)').matches) closeSidebar();
}

// ---------- CRUD ----------
async function createProject() {
  const name = prompt('Project name?');
  if (!name) return;
  const { data, error } = await sb.from('projects').insert({ name }).select().single();
  if (error) return alert(error.message);
  state.projects.unshift(data);
  selectProject(data.id);
}

function openChatModal() {
  if (!state.currentProjectId) return;
  const sel = $<HTMLSelectElement>('chat-session');
  const sessions = [...state.sessions].sort(
    (a, b) => new Date(b.last_activity_at).getTime() - new Date(a.last_activity_at).getTime(),
  );
  sel.innerHTML =
    `<option value="">— None (fresh session) —</option>` +
    sessions
      .map((s) => {
        const preview = (s.preview ?? '').slice(0, 70).replace(/\s+/g, ' ').trim();
        const when = relDate(s.last_activity_at);
        const title = preview || '(no preview)';
        return `<option value="${s.session_id}" data-dir="${escapeAttr(s.project_dir)}" data-label="${escapeAttr(s.project_label)}">${escapeHtml(s.project_label)}  —  ${escapeHtml(title)}${preview.length >= 70 ? '…' : ''}  ·  ${when}</option>`;
      })
      .join('');

  // Folder dropdown: unique dirs from sessions + current project's dir
  const dirSelect = $<HTMLSelectElement>('chat-dir-select');
  const dirs = new Map<string, string>();
  const currentProject = state.projects.find((p) => p.id === state.currentProjectId);
  if (currentProject?.working_dir) dirs.set(currentProject.working_dir, currentProject.name);
  for (const s of sessions) if (!dirs.has(s.project_dir)) dirs.set(s.project_dir, s.project_label);

  dirSelect.innerHTML =
    `<option value="">— None —</option>` +
    Array.from(dirs.entries())
      .map(
        ([dir, label]) =>
          `<option value="${escapeAttr(dir)}">${escapeHtml(label)} — ${escapeHtml(dir)}</option>`,
      )
      .join('') +
    `<option value="__custom__">Custom path…</option>`;
  if (currentProject?.working_dir) dirSelect.value = currentProject.working_dir;

  ($('chat-name') as HTMLInputElement).value = '';
  ($('chat-working-dir') as HTMLInputElement).value = currentProject?.working_dir ?? '';
  $('chat-working-dir').classList.add('hidden');
  sel.onchange = onSessionPick;
  dirSelect.onchange = onDirPick;
  $('chat-modal').classList.remove('hidden');
}

function onDirPick(e: Event) {
  const sel = e.target as HTMLSelectElement;
  const custom = $<HTMLInputElement>('chat-working-dir');
  if (sel.value === '__custom__') {
    custom.classList.remove('hidden');
    custom.value = '';
    custom.focus();
  } else {
    custom.classList.add('hidden');
    custom.value = sel.value;
  }
}

function onSessionPick(e: Event) {
  const opt = (e.target as HTMLSelectElement).selectedOptions[0];
  const dir = opt?.dataset.dir ?? '';
  const label = opt?.dataset.label ?? '';
  if (dir) {
    const dirSelect = $<HTMLSelectElement>('chat-dir-select');
    // Ensure option exists, then select
    let exists = Array.from(dirSelect.options).some((o) => o.value === dir);
    if (!exists) {
      const opt = document.createElement('option');
      opt.value = dir;
      opt.textContent = `${label} — ${dir}`;
      dirSelect.insertBefore(opt, dirSelect.lastElementChild!);
    }
    dirSelect.value = dir;
    ($('chat-working-dir') as HTMLInputElement).value = dir;
    ($('chat-working-dir') as HTMLInputElement).classList.add('hidden');
  }
  if (!($('chat-name') as HTMLInputElement).value && label) {
    ($('chat-name') as HTMLInputElement).value = label;
  }
}

function relDate(iso: string) {
  const d = new Date(iso).getTime();
  const diff = Date.now() - d;
  const day = 86_400_000;
  if (diff < 3_600_000) return `${Math.max(1, Math.floor(diff / 60_000))}m ago`;
  if (diff < day) return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 7 * day) return `${Math.floor(diff / day)}d ago`;
  return new Date(iso).toLocaleDateString();
}

async function createChat() {
  if (!state.currentProjectId) return;
  const name = ($('chat-name') as HTMLInputElement).value.trim();
  const session_id = ($('chat-session') as HTMLSelectElement).value || null;
  const working_dir = ($('chat-working-dir') as HTMLInputElement).value.trim() || null;
  if (!name) return alert('Name required.');
  const { data, error } = await sb
    .from('chats')
    .insert({ project_id: state.currentProjectId, name, claude_session_id: session_id, working_dir })
    .select()
    .single();
  if (error) return alert(error.message);
  state.chats.unshift(data);
  $('chat-modal').classList.add('hidden');
  selectChat(data.id);
}

function escapeAttr(s: string) {
  return s.replace(/"/g, '&quot;');
}

function openTaskModal() {
  if (!state.currentProjectId) return;
  const chats = state.chats.filter((c) => c.project_id === state.currentProjectId);
  if (chats.length === 0) return alert('Create a chat first.');
  const select = $<HTMLSelectElement>('task-chat');
  select.innerHTML = chats.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
  if (state.currentChatId) select.value = state.currentChatId;
  ($('task-title') as HTMLInputElement).value = '';
  ($('task-instructions') as HTMLTextAreaElement).value = '';
  $('task-modal').classList.remove('hidden');
}

async function createTask() {
  const chat_id = ($('task-chat') as HTMLSelectElement).value;
  const title = ($('task-title') as HTMLInputElement).value.trim();
  const instructions = ($('task-instructions') as HTMLTextAreaElement).value.trim();
  if (!chat_id || !title || !instructions) return alert('All fields required.');
  const { error } = await sb
    .from('tasks')
    .insert({ project_id: state.currentProjectId!, chat_id, title, instructions });
  if (error) return alert(error.message);
  $('task-modal').classList.add('hidden');
}

function openDetail(taskId: string) {
  const t = state.tasks.find((x) => x.id === taskId);
  if (!t) return;
  $('detail-title').textContent = t.title;
  $('detail-meta').textContent = `${t.status.toUpperCase()} · ${formatTime(t.updated_at)}`;
  $('detail-instructions').textContent = t.instructions;
  $('detail-result').textContent = t.result ?? '—';
  const errWrap = $('detail-error-wrap');
  if (t.error) {
    errWrap.classList.remove('hidden');
    $('detail-error').textContent = t.error;
  } else {
    errWrap.classList.add('hidden');
  }
  $('detail-modal').classList.remove('hidden');
  $('detail-modal').dataset.taskId = taskId;
}

// ---------- Loading + Realtime ----------
async function load() {
  const [projects, chats, tasks, sessions] = await Promise.all([
    sb.from('projects').select('*').order('created_at', { ascending: false }),
    sb.from('chats').select('*').order('created_at', { ascending: false }),
    sb.from('tasks').select('*').order('created_at', { ascending: false }),
    sb.from('claude_sessions').select('*').order('last_activity_at', { ascending: false }),
  ]);
  if (projects.error) console.error(projects.error);
  if (chats.error) console.error(chats.error);
  if (tasks.error) console.error(tasks.error);
  if (sessions.error) console.error(sessions.error);
  state.projects = projects.data ?? [];
  state.chats = chats.data ?? [];
  state.tasks = tasks.data ?? [];
  state.sessions = sessions.data ?? [];
  if (!state.currentProjectId && state.projects[0]) state.currentProjectId = state.projects[0].id;
  renderProjects();
  renderChats();
  renderTasks();
}

function subscribeRealtime() {
  const ch = sb.channel('motaskbot');

  ch.on('postgres_changes', { event: '*', schema: 'public', table: 'projects' }, (payload) => {
    applyChange(state.projects, payload);
    renderProjects();
  });
  ch.on('postgres_changes', { event: '*', schema: 'public', table: 'chats' }, (payload) => {
    applyChange(state.chats, payload);
    renderChats();
    renderTasks();
  });
  ch.on('postgres_changes', { event: '*', schema: 'public', table: 'claude_sessions' }, (payload) => {
    const row = (payload.new ?? payload.old) as ClaudeSession;
    const idx = state.sessions.findIndex((s) => s.session_id === row.session_id);
    if (payload.eventType === 'DELETE') {
      if (idx >= 0) state.sessions.splice(idx, 1);
    } else if (idx >= 0) state.sessions[idx] = payload.new as ClaudeSession;
    else state.sessions.unshift(payload.new as ClaudeSession);
  });
  ch.on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, (payload) => {
    applyChange(state.tasks, payload);
    renderTasks();
    const detailModal = $('detail-modal');
    if (!detailModal.classList.contains('hidden') && detailModal.dataset.taskId === (payload.new as any)?.id) {
      openDetail((payload.new as any).id);
    }
    setWorkerStatus(state.tasks.some((t) => t.status === 'running') ? 'active' : 'idle');
  });

  ch.subscribe((status) => {
    console.log('[realtime]', status);
    if (status === 'SUBSCRIBED') setWorkerStatus('idle');
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

function setWorkerStatus(s: 'active' | 'idle' | 'unknown') {
  const label = s === 'active' ? 'running task…' : s === 'idle' ? 'connected' : 'unknown';
  $('worker-status').textContent = `realtime: ${label}`;
}

// ---------- Wire up ----------
// Sidebar drawer (mobile)
function openSidebar() {
  $('sidebar').classList.remove('-translate-x-full');
  const ov = $('sidebar-overlay');
  ov.classList.remove('hidden');
  ov.classList.add('flex');
}
function closeSidebar() {
  $('sidebar').classList.add('-translate-x-full');
  const ov = $('sidebar-overlay');
  ov.classList.add('hidden');
  ov.classList.remove('flex');
}
$('sidebar-open')?.addEventListener('click', openSidebar);
$('sidebar-close')?.addEventListener('click', closeSidebar);
$('sidebar-overlay')?.addEventListener('click', closeSidebar);

// Show FAB on mobile when project selected
function syncFab() {
  const fab = $('fab-new-task');
  const visible = !!state.currentProjectId && state.chats.some((c) => c.project_id === state.currentProjectId);
  fab.classList.toggle('hidden', !visible);
  fab.classList.toggle('md:hidden', true);
}
$('fab-new-task')?.addEventListener('click', openTaskModal);

$('new-project-btn').addEventListener('click', createProject);
$('new-chat-btn').addEventListener('click', openChatModal);
$('chat-cancel').addEventListener('click', () => $('chat-modal').classList.add('hidden'));
$('chat-cancel-x')?.addEventListener('click', () => $('chat-modal').classList.add('hidden'));
$('chat-create').addEventListener('click', createChat);
$('chat-modal').addEventListener('click', (e) => {
  if (e.target === $('chat-modal')) $('chat-modal').classList.add('hidden');
});
$('new-task-btn').addEventListener('click', openTaskModal);
$('task-cancel').addEventListener('click', () => $('task-modal').classList.add('hidden'));
$('task-cancel-x')?.addEventListener('click', () => $('task-modal').classList.add('hidden'));
$('task-create').addEventListener('click', createTask);
$('detail-close').addEventListener('click', () => $('detail-modal').classList.add('hidden'));
[$('task-modal'), $('detail-modal')].forEach((m) => {
  m.addEventListener('click', (e) => {
    if (e.target === m) m.classList.add('hidden');
  });
});

load().then(() => { subscribeRealtime(); syncFab(); });
