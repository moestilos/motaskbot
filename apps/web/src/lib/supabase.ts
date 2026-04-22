import { createBrowserClient, type MoTaskBotClient } from '@motaskbot/shared/supabase';

declare global {
  interface Window {
    __MOTASKBOT_SUPABASE__?: MoTaskBotClient;
    __MOTASKBOT_ENV__: { url: string; anon: string };
  }
}

export function getSupabase(): MoTaskBotClient {
  if (typeof window === 'undefined') throw new Error('Client-only');
  if (!window.__MOTASKBOT_SUPABASE__) {
    const { url, anon } = window.__MOTASKBOT_ENV__;
    window.__MOTASKBOT_SUPABASE__ = createBrowserClient(url, anon);
  }
  return window.__MOTASKBOT_SUPABASE__;
}
