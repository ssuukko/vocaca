import { createClient } from '@supabase/supabase-js';

type ViteEnv = {
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_ANON_KEY?: string;
};

const REMEMBER_LOGIN_STORAGE_KEY = 'vocaca_remember_login';

const viteEnv = (import.meta as ImportMeta & { env: ViteEnv }).env;
const supabaseUrl = viteEnv.VITE_SUPABASE_URL;
const supabaseAnonKey = viteEnv.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables.');
}

const authStorage = {
  getItem(key: string) {
    if (typeof window === 'undefined') {
      return null;
    }

    return window.localStorage.getItem(key) ?? window.sessionStorage.getItem(key);
  },
  setItem(key: string, value: string) {
    if (typeof window === 'undefined') {
      return;
    }

    const shouldRemember = window.localStorage.getItem(REMEMBER_LOGIN_STORAGE_KEY) === 'true';

    if (shouldRemember) {
      window.sessionStorage.removeItem(key);
      window.localStorage.setItem(key, value);
      return;
    }

    window.localStorage.removeItem(key);
    window.sessionStorage.setItem(key, value);
  },
  removeItem(key: string) {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.removeItem(key);
    window.sessionStorage.removeItem(key);
  },
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storage: authStorage,
  },
});
