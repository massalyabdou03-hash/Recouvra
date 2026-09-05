// =============================================================================
// Recouvra — Exemple de configuration frontend
// Copier ce fichier en `config.js` et y placer les valeurs de votre projet
// (NE PAS committer vos clés privées / secrets).
// =============================================================================

// URL SUPABASE (ex: https://xyzcompany.supabase.co)
const SUPABASE_URL = "<YOUR_SUPABASE_URL_HERE>";

// Clé publique (anon/public) fournie par Supabase (publishable)
const SUPABASE_ANON_KEY = "<YOUR_SUPABASE_ANON_KEY_HERE>";

// Adresse e‑mail administrative utilisée pour des opérations locales (ex: tests)
// REMARQUE: Ne mettez ici aucune clé secrète ou mot de passe.
const ADMIN_EMAIL = "admin@example.com";

// Initialisation du client Supabase — ne modifiez pas si vous voulez garder
// le comportement actuel (le fichier réel `config.js` doit définir ces valeurs).
let supabaseClient = null;
if (typeof window !== "undefined" && window.supabase) {
  if (SUPABASE_URL && SUPABASE_ANON_KEY && SUPABASE_URL.indexOf('<') === -1) {
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  } else {
    // Le vrai frontend/assets/config.js dans le repo fournit les valeurs par défaut
    // pour le dev. Ce fichier est uniquement un modèle pour les déploiements.
    console.warn('config.example.js: SUPABASE_URL ou SUPABASE_ANON_KEY non fournis — copiez config.example.js en config.js pour exécuter l\'application.');
  }
}
