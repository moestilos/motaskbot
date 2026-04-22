// End-to-end sanity test. Verifies:
//   1. Auth gate (anon denied, authenticated allowed)
//   2. DB CRUD (projects/chats/tasks)
//   3. Realtime events
//   4. Worker picks up task and runs Claude
//   5. Claude Code session scanner populated data
//
// Requires: worker running.

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const URL = process.env.SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL;
const ANON = process.env.PUBLIC_SUPABASE_ANON_KEY;
const EMAIL = process.env.MOTASKBOT_EMAIL;
const PASSWORD = process.env.MOTASKBOT_PASSWORD;

if (!URL || !ANON) {
  console.error('Missing SUPABASE_URL / PUBLIC_SUPABASE_ANON_KEY');
  process.exit(1);
}
if (!EMAIL || !PASSWORD) {
  console.error('Missing MOTASKBOT_EMAIL / MOTASKBOT_PASSWORD');
  process.exit(1);
}

let passed = 0;
let failed = 0;
const tag = (label, ok, extra = '') => {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? ' — ' + extra : ''}`);
};

async function main() {
  console.log('→ MoTaskBot E2E test\n');

  // ---- 1. Auth gate: anon must be denied ----
  const anonSb = createClient(URL, ANON, { auth: { persistSession: false } });
  const anonRead = await anonSb.from('projects').select('id').limit(1);
  tag('anon denied on projects', anonRead.error !== null || (anonRead.data ?? []).length === 0, anonRead.error?.message ?? '');

  // ---- 2. Sign in ----
  const sb = createClient(URL, ANON, { auth: { persistSession: false } });
  const { data: auth, error: authErr } = await sb.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
  tag('auth sign-in', !authErr && !!auth.session, authErr?.message ?? '');
  if (authErr) return finish();

  // ---- 3. Auth: reads allowed now ----
  const authedRead = await sb.from('projects').select('id').limit(1);
  tag('authenticated read allowed', !authedRead.error, authedRead.error?.message ?? '');

  // ---- 4. Claude Code sessions scanned? ----
  const sessCount = await sb.from('claude_sessions').select('session_id', { count: 'exact', head: true });
  const count = sessCount.count ?? 0;
  tag(`claude_sessions populated (${count} rows)`, count > 0);

  // ---- 5. Auto-synced projects from CC scan ----
  const ccProjects = await sb.from('projects').select('id').eq('source', 'claude_code');
  tag(`auto-synced CC projects (${ccProjects.data?.length ?? 0})`, (ccProjects.data?.length ?? 0) > 0);

  // ---- 6. CRUD project ----
  const pName = `e2e-${Date.now()}`;
  const p = await sb.from('projects').insert({ name: pName }).select().single();
  tag('create project', !p.error, p.error?.message);
  if (p.error) return finish();

  // ---- 7. CRUD chat ----
  const c = await sb.from('chats').insert({ project_id: p.data.id, name: 'e2e-chat' }).select().single();
  tag('create chat', !c.error, c.error?.message);
  if (c.error) {
    await sb.from('projects').delete().eq('id', p.data.id);
    return finish();
  }

  // ---- 8. Realtime subscribe, then insert ----
  let realtimeHit = false;
  const ch = sb.channel('e2e')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, () => { realtimeHit = true; })
    .subscribe();
  await wait(1500);

  const t = await sb.from('tasks').insert({
    project_id: p.data.id,
    chat_id: c.data.id,
    title: 'E2E smoke task',
    instructions: 'Reply with exactly one word: PONG',
  }).select().single();
  tag('create task', !t.error, t.error?.message);

  await wait(2500);
  tag('realtime event received', realtimeHit);

  // ---- 9. Worker processes task ----
  console.log('  waiting up to 90s for worker…');
  let final = null;
  for (let i = 0; i < 90; i++) {
    const { data } = await sb.from('tasks').select('*').eq('id', t.data.id).single();
    if (data && (data.status === 'completed' || data.status === 'failed')) {
      final = data;
      break;
    }
    await wait(1000);
  }
  if (!final) {
    tag('worker processed task', false, 'timeout (worker running?)');
  } else {
    tag(`worker status: ${final.status}`, final.status === 'completed', final.error ?? '');
    if (final.result) console.log(`  result: ${final.result.slice(0, 200)}`);
  }

  // ---- 10. Cleanup ----
  await sb.from('projects').delete().eq('id', p.data.id);
  ch.unsubscribe();
  tag('cleanup', true);

  finish();
}

function wait(ms) { return new Promise(r => setTimeout(r, ms)); }
function finish() {
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
