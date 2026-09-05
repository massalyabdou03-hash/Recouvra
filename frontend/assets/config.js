// =============================================================================
// A CONFIGURER : colle ici l'URL et la clé "anon public" de ton projet Supabase
// (Supabase Dashboard > Project Settings > API)
// =============================================================================
const SUPABASE_URL = "https://xnncexqksrsxqcmxdxsb.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_4T4GDgHejAfvqEQwyy2BQw_uWi_42pp";

// Adresse e‑mail de l'administrateur utilisée par la connexion par mot de passe
// Remplace par l'adresse admin réelle de ton projet Supabase
const ADMIN_EMAIL = "1203@acces.local";

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
