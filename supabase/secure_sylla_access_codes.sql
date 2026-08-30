-- Corrige un trou de securite trouve lors de l'audit du 30/08/2026 : le script
-- setup_sylla_code_access.sql cree la table sylla_access_codes(code, email,
-- password, ...) SANS jamais activer row level security dessus. Cette table
-- stocke un mot de passe Supabase Auth en clair. Sans RLS, elle est exposee
-- via l'API REST (PostgREST) a quiconque possede la cle anon/publishable --
-- qui est deja publique par construction (elle est commitee dans
-- frontend/assets/config.js).
--
-- Verification faite le 30/08/2026 : une requete anon sur cette table renvoie
-- 0 ligne (Content-Range: */0), donc aucune donnee n'est exposee ACTUELLEMENT.
-- Mais l'absence de RLS reste un trou reel : la prochaine ligne inseree dans
-- cette table serait immediatement lisible par n'importe qui.
--
-- Cette table n'est plus utilisee par le frontend actuel : la connexion par
-- "code d'acces" reellement en place passe par codeToEmail() (frontend/assets/app.js),
-- qui convertit le code en email technique "{code}@acces.local" pour un vrai
-- compte Supabase Auth -- pas par cette table.
--
-- A executer dans le SQL Editor du projet Supabase concerne (Sylla Automobile
-- et tout autre projet ayant deja execute setup_sylla_code_access.sql).

alter table if exists sylla_access_codes enable row level security;

-- RLS activee sans aucune policy = deni total pour tout role autre que le
-- proprietaire de la table (postgres). C'est deliberement plus strict qu'une
-- policy "using(false)" explicite : aucune policy future ajoutee par erreur
-- ne pourra rouvrir l'acces sans qu'on l'ait explicitement voulu.

-- Filet de securite supplementaire : retire les droits par defaut que Supabase
-- accorde aux roles anon/authenticated sur les tables du schema public, au cas
-- ou RLS serait desactivee par erreur plus tard.
revoke all on sylla_access_codes from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Etape suivante recommandee, PAS executee automatiquement par ce script :
-- une fois confirme qu'aucun autre systeme (Edge Function, script externe,
-- usage manuel) ne depend de cette table, la supprimer purement et simplement
-- retire le risque au lieu de se contenter de le neutraliser :
--
--   drop table if exists sylla_access_codes;
--
-- Ne decommenter/executer cette ligne qu'apres verification.
-- ---------------------------------------------------------------------------
