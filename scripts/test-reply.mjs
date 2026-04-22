#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load .env
const envPath = path.resolve(__dirname, '../.env');
const envContent = fs.readFileSync(envPath, 'utf-8');
const env = {};
envContent.split('\n').forEach((line) => {
  const [key, val] = line.split('=');
  if (key && val) env[key.trim()] = val.trim();
});

const URL = env.SUPABASE_URL || env.PUBLIC_SUPABASE_URL;
const ANON = env.PUBLIC_SUPABASE_ANON_KEY;
const EMAIL = env.MOTASKBOT_EMAIL;
const PASSWORD = env.MOTASKBOT_PASSWORD;

if (!URL || !ANON || !EMAIL || !PASSWORD) {
  console.error('Missing .env variables');
  process.exit(1);
}

async function test() {
  console.log('→ MoTaskBot Reply Feature Test\n');

  let testProject = null;
  let testChat = null;
  let err = null;
  let sb = null;

  try {
    // Sign in
    sb = createClient(URL, ANON, { auth: { persistSession: false } });
    const { data: auth, error: authErr } = await sb.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
    if (authErr || !auth.session) throw new Error('Sign-in failed: ' + authErr?.message);
    console.log(`✓ Signed in as ${EMAIL}`);

    // 1. Create test project
    const { data: p, error: pErr } = await sb
      .from('projects')
      .insert({ name: `reply-test-${Date.now()}` })
      .select('id')
      .single();
    if (pErr) throw pErr;
    testProject = p.id;
    console.log(`✓ Created test project: ${testProject}`);

    // 2. Create test chat
    const { data: c, error: cErr } = await sb
      .from('chats')
      .insert({ project_id: testProject, name: 'Reply Test' })
      .select('id')
      .single();
    if (cErr) throw cErr;
    testChat = c.id;
    console.log(`✓ Created test chat: ${testChat}`);

    // 3. Create task that expects a reply
    const { data: task1, error: err1 } = await sb
      .from('tasks')
      .insert({
        project_id: testProject,
        chat_id: testChat,
        title: 'Test Question',
        instructions: 'Respond with: I am ready to continue.',
      })
      .select('id')
      .single();

    if (err1) throw err1;
    const task1_id = task1.id;
    console.log(`✓ Created task 1: ${task1_id}`);

    // 4. Wait for worker to respond
    console.log('  waiting up to 30s for worker…');
    let task1_response = null;
    for (let i = 0; i < 30; i++) {
      const { data } = await sb.from('tasks').select('result, status').eq('id', task1_id).single();
      if (data && (data.status === 'completed' || data.status === 'failed')) {
        task1_response = data.result;
        break;
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    if (!task1_response) throw new Error('Worker did not respond to task 1');
    console.log(`✓ Task 1 completed. Result: ${task1_response.substring(0, 80)}`);

    // 5. Create reply task (same chat, will trigger --resume)
    const { data: task2, error: err2 } = await sb
      .from('tasks')
      .insert({
        project_id: testProject,
        chat_id: testChat, // same chat = same session context
        title: 'Continue with this',
        instructions: 'Now respond with exactly: PONG',
      })
      .select('id')
      .single();

    if (err2) throw err2;
    const task2_id = task2.id;
    console.log(`✓ Created reply task 2: ${task2_id} (same chat = --resume)`);

    // 6. Wait for worker to process reply
    console.log('  waiting up to 30s for worker to process reply…');
    let task2_response = null;
    for (let i = 0; i < 30; i++) {
      const { data } = await sb.from('tasks').select('result, status').eq('id', task2_id).single();
      if (data && (data.status === 'completed' || data.status === 'failed')) {
        task2_response = data.result;
        break;
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    if (!task2_response) throw new Error('Worker did not respond to reply task 2');
    console.log(`✓ Task 2 completed. Result: ${task2_response.substring(0, 50)}`);

    console.log('\n✓ Reply feature test passed!');
  } catch (e) {
    err = e;
    console.error('✗ Error:', e.message);
  } finally {
    // Cleanup
    if (testProject) {
      await sb.from('projects').delete().eq('id', testProject);
      console.log('✓ Cleaned up test data');
    }
    process.exit(!err ? 0 : 1);
  }
}

test();
