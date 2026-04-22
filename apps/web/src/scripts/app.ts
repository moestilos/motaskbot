import { getSupabase } from '../lib/supabase';
import type { Project, Chat, Task } from '@motaskbot/shared/types';

const sb = getSupabase();

const state = {
  projects: [] as Project[],
  chats: [] as Chat[],
  tasks: [] as Task[],
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
        (c) => `
      <li>
        <button data-id="${c.id}" class="chat-item w-full text-left px-2 py-1.5 rounded text-sm ${c.id === state.currentChatId ? 'bg-bg-elevated text-fg' : 'text-fg-muted hover:bg-bg-elevated hover:text-fg'}">
          # ${escapeHtml(c.name)}
        </button>
      </li>`
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
  subtitle.textContent = chat ? `# ${chat.name}` : 'all chats';

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
}

function selectChat(id: string) {
  state.currentChatId = state.currentChatId === id ? null : id;
  renderChats();
  renderTasks();
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

async function createChat() {
  if (!state.currentProjectId) return;
  const name = prompt('Chat name?');
  if (!name) return;
  const { data, error } = await sb
    .from('chats')
    .insert({ project_id: state.currentProjectId, name })
    .select()
    .single();
  if (error) return alert(error.message);
  state.chats.unshift(data);
  selectChat(data.id);
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
  const [projects, chats, tasks] = await Promise.all([
    sb.from('projects').select('*').order('created_at', { ascending: false }),
    sb.from('chats').select('*').order('created_at', { ascending: false }),
    sb.from('tasks').select('*').order('created_at', { ascending: false }),
  ]);
  if (projects.error) console.error(projects.error);
  if (chats.error) console.error(chats.error);
  if (tasks.error) console.error(tasks.error);
  state.projects = projects.data ?? [];
  state.chats = chats.data ?? [];
  state.tasks = tasks.data ?? [];
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
    arr.unshift(payload.new);
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
$('new-project-btn').addEventListener('click', createProject);
$('new-chat-btn').addEventListener('click', createChat);
$('new-task-btn').addEventListener('click', openTaskModal);
$('task-cancel').addEventListener('click', () => $('task-modal').classList.add('hidden'));
$('task-create').addEventListener('click', createTask);
$('detail-close').addEventListener('click', () => $('detail-modal').classList.add('hidden'));
[$('task-modal'), $('detail-modal')].forEach((m) => {
  m.addEventListener('click', (e) => {
    if (e.target === m) m.classList.add('hidden');
  });
});

load().then(subscribeRealtime);
