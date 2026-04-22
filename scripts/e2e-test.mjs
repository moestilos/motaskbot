// End-to-end sanity test. Does NOT require the worker to be running;
// only verifies DB + realtime flow. If the worker is running, this will
// also observe task completion.

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const URL = process.env.SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.PUBLIC_SUPABASE_ANON_KEY;

if (!URL || !KEY) {
  console.error('Missing SUPABASE env vars');
  process.exit(1);
}

const sb = createClient(URL, KEY, { auth: { persistSession: false } });

const tag = (label, ok, extra = '') => console.log(`${ok ? '✓' : '✗'} ${label}${extra ? ' — ' + extra : ''}`);

async function main() {
  console.log('→ MoTaskBot E2E test');

  // 1. insert project
  const pName = `e2e-${Date.now()}`;
  const p = await sb.from('projects').insert({ name: pName }).select().single();
  tag('create project', !p.error, p.error?.message);
  if (p.error) process.exit(1);

  // 2. insert chat
  const c = await sb.from('chats').insert({ project_id: p.data.id, name: 'test-chat' }).select().single();
  tag('create chat', !c.error, c.error?.message);
  if (c.error) process.exit(1);

  // 3. subscribe to tasks BEFORE insert (realtime smoke)
  let realtimeHit = false;
  const channel = sb
    .channel('e2e')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, () => {
      realtimeHit = true;
    })
    .subscribe();

  await new Promise((r) => setTimeout(r, 1500));

  // 4. insert task
  const t = await sb
    .from('tasks')
    .insert({
      project_id: p.data.id,
      chat_id: c.data.id,
      title: 'E2E smoke task',
      instructions: 'Reply with exactly: PONG',
    })
    .select()
    .single();
  tag('create task', !t.error, t.error?.message);
  if (t.error) process.exit(1);

  await new Promise((r) => setTimeout(r, 2000));
  tag('realtime event received', realtimeHit);

  // 5. wait up to 60s for worker to process
  console.log('→ waiting up to 60s for worker to process task…');
  let final = null;
  for (let i = 0; i < 60; i++) {
    const { data } = await sb.from('tasks').select('*').eq('id', t.data.id).single();
    if (data && (data.status === 'completed' || data.status === 'failed')) {
      final = data;
      break;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (!final) {
    tag('worker processed task', false, 'timeout (is worker running?)');
  } else {
    tag(`worker processed task → ${final.status}`, final.status === 'completed', final.error ?? '');
    if (final.result) console.log('  result preview:', final.result.slice(0, 200));
  }

  // 6. cleanup
  await sb.from('projects').delete().eq('id', p.data.id);
  tag('cleanup', true);

  channel.unsubscribe();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
