import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './types.js';

export type MoTaskBotClient = SupabaseClient<Database>;

export function createBrowserClient(url: string, anonKey: string): MoTaskBotClient {
  return createClient<Database>(url, anonKey, {
    auth: { persistSession: true, autoRefreshToken: true, storageKey: 'motaskbot-auth' },
    realtime: { params: { eventsPerSecond: 10 } },
  });
}

export function createServerClient(url: string, serviceKey: string): MoTaskBotClient {
  return createClient<Database>(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: true },
  });
}
