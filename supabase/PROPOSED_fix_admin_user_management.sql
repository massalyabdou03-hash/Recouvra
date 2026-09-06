-- ============================================================================
-- ÉTAPE 0 (recommandée) — DIAGNOSTIC EN LECTURE SEULE, SANS RISQUE
-- À lancer d'abord pour vérifier la signature réellement déployée de
-- admin_create_user (le DROP plus bas suppose "text, text, text, uuid,
-- varchar, boolean" — à ajuster si le résultat ci-dessous est différent) :
--
-- select pg_get_function_identity_arguments(p.oid) as arguments
-- from pg_proc p
-- join pg_namespace n on n.oid = p.pronamespace
-- where n.nspname = 'public' and p.proname = 'admin_create_user';
-- ============================================================================

-- ============================================================================
-- PROPOSITION DE CORRECTION — NON APPLIQUÉE, À VALIDER AVANT EXÉCUTION
-- ============================================================================
-- Contexte (audit V2, passe 3) : super-admin.html appelle trois fonctions RPC
-- qui n'existent nulle part dans le projet :
--   - admin_create_user(p_email, p_password, p_nom, p_entreprise_id, p_role, p_has_recouvra)
--   - admin_delete_user(p_user_id)
--   - admin_reset_password(p_user_id, p_new_password)
--
-- Résultat actuel : ces 3 actions échouent systématiquement ("function does
-- not exist") — la création de compte, la suppression et la réinitialisation
-- de mot de passe depuis l'espace super-admin sont non fonctionnelles.
--
-- ATTENTION — ARBITRAGE DE SÉCURITÉ IMPORTANT :
-- Modifier auth.users (créer un utilisateur, définir un mot de passe) est une
-- opération sensible. Deux approches existent :
--
--   (A) Fonction SQL security definer manipulant directement auth.users avec
--       pgcrypto (crypt/gen_salt) — proposée ci-dessous car elle reste dans
--       le même style que le reste du projet (aucun déploiement supplémentaire
--       requis). Mais le hachage doit rester compatible avec ce qu'attend
--       GoTrue (Supabase Auth) : cela fonctionne sur les versions actuelles
--       de Supabase (bcrypt via pgcrypto), mais n'est PAS documenté/garanti
--       stable par Supabase dans le temps, contrairement à l'API Admin.
--
--   (B) Edge Function utilisant la clé service_role + l'API Admin Auth de
--       Supabase (supabase.auth.admin.createUser / deleteUser / updateUserById)
--       — RECOMMANDÉ par Supabase, plus robuste, mais nécessite de déployer
--       une Edge Function séparée (hors périmètre de ce fichier SQL).
--
-- Je fournis (A) ci-dessous pour rester cohérent avec l'architecture actuelle
-- du projet, mais je recommande explicitement (B) si vous avez la possibilité
-- de déployer une Edge Function. À tester en environnement de non-production
-- avant toute mise en ligne, quel que soit le choix retenu.
-- ============================================================================

-- ============================================================================
-- CORRECTION CRITIQUE : conflit avec le trigger d'auto-création d'entreprise
-- ============================================================================
-- Le trigger on_auth_user_created_create_company (upgrade_saas_onboarding_wave.sql,
-- redéfini dans upgrade_wave_paiement_manuel.sql) se déclenche sur TOUT insert
-- dans auth.users, y compris celui fait ci-dessous par admin_create_user().
-- Sans garde-fou, il crée sa propre entreprise "Nouvelle entreprise" et son
-- propre profil AVANT que admin_create_user() ne fasse le sien → conflit de
-- clé primaire sur profiles.id, pour CHAQUE utilisateur créé depuis le
-- super-admin (pas seulement le cas "nouvelle entreprise").
--
-- On neutralise le trigger uniquement pour les comptes créés par
-- admin_create_user(), via un indicateur dans raw_app_meta_data (non
-- modifiable par un utilisateur normal, contrairement à raw_user_meta_data
-- que ce même trigger lit déjà pour l'inscription libre — donc aucun risque
-- qu'un utilisateur se l'attribue lui-même).
create or replace function create_company_for_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
    company_id uuid;
    metadata jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
begin
    if coalesce(new.raw_app_meta_data->>'skip_auto_onboarding', 'false') = 'true' then
        return new;
    end if;

    insert into entreprises (nom, gerant_nom, telephone, created_by)
    values (
        coalesce(nullif(metadata->>'entreprise_nom', ''), 'Nouvelle entreprise'),
        nullif(metadata->>'gerant_nom', ''),
        nullif(metadata->>'telephone', ''),
        new.id
    ) returning id into company_id;

    insert into profiles (id, entreprise_id, role, has_recouvra)
    values (new.id, company_id, 'admin', false);

    insert into entreprise_settings (entreprise_id, nom_commercial, telephone)
    values (company_id, coalesce(nullif(metadata->>'entreprise_nom', ''), 'Nouvelle entreprise'), nullif(metadata->>'telephone', ''));

    insert into subscriptions (entreprise_id, status)
    values (company_id, 'pending')
    on conflict do nothing;

    return new;
end;
$$;
-- Le trigger lui-même n'a pas besoin d'être recréé : il pointe déjà vers
-- cette fonction par son nom, "create or replace" suffit à le mettre à jour.

-- ============================================================================
-- CORRECTION #2 (découverte en testant en conditions réelles) : il existe
-- un DEUXIÈME trigger sur auth.users, "on_auth_user_created" → handle_new_user(),
-- qui n'apparaît dans AUCUN fichier .sql de ce dépôt — créé directement dans
-- le dashboard Supabase à un moment donné, jamais versionné. Il exige que
-- raw_user_meta_data contienne déjà un entreprise_id, sinon il lève
-- exactement l'exception "entreprise_id is required to create a profile".
-- Comme il se déclenche AVANT create_company_for_new_user() (ordre
-- alphabétique des noms de trigger), il bloquait admin_create_user() avant
-- même que le garde-fou ci-dessus n'entre en jeu. Aucun signUp() n'existe
-- dans le code actuel du projet : ce trigger semble être un reliquat d'une
-- architecture antérieure. On lui applique le même garde-fou plutôt que de
-- le supprimer, par prudence (impossible de garantir qu'aucun processus
-- externe n'en dépend).
create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_entreprise_id uuid;
begin
  if coalesce(new.raw_app_meta_data->>'skip_auto_onboarding', 'false') = 'true' then
    return new;
  end if;

  v_entreprise_id := nullif(new.raw_user_meta_data->>'entreprise_id', '')::uuid;

  if v_entreprise_id is null then
    raise exception 'entreprise_id is required to create a profile';
  end if;

  insert into public.profiles (id, entreprise_id)
  values (new.id, v_entreprise_id);

  return new;
end;
$$;

create extension if not exists pgcrypto;
-- Correction (suite au test réel) : Supabase installe pgcrypto par défaut
-- dans le schéma "extensions", pas "public". Comme nos fonctions fixent
-- explicitement leur search_path (bonne pratique de sécurité pour les
-- fonctions security definer), elles ne trouvaient pas gen_salt()/crypt()
-- tant que "extensions" n'y figurait pas — d'où l'erreur
-- "function gen_salt(unknown) does not exist". Le search_path des 3
-- fonctions ci-dessous inclut donc désormais extensions.

-- Si vous avez déjà exécuté une version précédente de ce fichier, l'ancienne
-- fonction à 6 paramètres doit être supprimée avant de recréer la nouvelle
-- version à 7 paramètres (PostgreSQL les traiterait sinon comme deux
-- fonctions différentes coexistantes, l'une d'elles restant obsolète).
drop function if exists admin_create_user(text, text, text, uuid, varchar, boolean);

-- ----------------------------------------------------------------------------
-- admin_create_user : crée un compte auth + son profil, réservé au super_admin
-- Correction (audit V4) : p_entreprise_id était obligatoire, mais le
-- formulaire "Créer un utilisateur" de super-admin.html ne propose qu'une
-- liste d'entreprises déjà existantes — impossible d'ajouter un utilisateur
-- pour une entreprise qui n'existe pas encore. Résultat : en laissant le
-- champ vide, l'insertion échouait avec une erreur de contrainte NOT NULL
-- sur profiles.entreprise_id. p_entreprise_id devient donc optionnel : si
-- absent, on crée la nouvelle entreprise à partir de p_nouvelle_entreprise_nom.
-- ----------------------------------------------------------------------------
create or replace function admin_create_user(
    p_email text,
    p_password text,
    p_nom text,
    p_entreprise_id uuid,
    p_role varchar,
    p_has_recouvra boolean default false,
    p_nouvelle_entreprise_nom text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
    v_user_id uuid := gen_random_uuid();
    v_entreprise_id uuid := p_entreprise_id;
begin
    if not current_user_is_super_admin() then
        raise exception 'Accès refusé : réservé au super administrateur';
    end if;

    if length(p_password) < 8 then
        raise exception 'Le mot de passe doit contenir au moins 8 caractères';
    end if;

    if p_role not in ('vendeur', 'magasinier', 'admin', 'super_admin') then
        raise exception 'Rôle invalide : %', p_role;
    end if;

    if v_entreprise_id is null then
        if p_nouvelle_entreprise_nom is null or trim(p_nouvelle_entreprise_nom) = '' then
            raise exception 'Choisissez une entreprise existante ou indiquez le nom de la nouvelle entreprise';
        end if;
        insert into entreprises (nom, created_by)
        values (trim(p_nouvelle_entreprise_nom), auth.uid())
        returning id into v_entreprise_id;
    end if;

    insert into auth.users (
        id, instance_id, aud, role, email, encrypted_password,
        email_confirmed_at, raw_user_meta_data, raw_app_meta_data, created_at, updated_at
    )
    values (
        v_user_id,
        '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', p_email,
        crypt(p_password, gen_salt('bf')),
        now(),
        jsonb_build_object('nom', p_nom),
        jsonb_build_object('skip_auto_onboarding', true),
        now(), now()
    );

    insert into profiles (id, entreprise_id, role, has_recouvra)
    values (v_user_id, v_entreprise_id, p_role, p_has_recouvra);

    return v_user_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- admin_delete_user : supprime un compte (profil + auth), réservé au super_admin
-- ----------------------------------------------------------------------------
create or replace function admin_delete_user(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
begin
    if not current_user_is_super_admin() then
        raise exception 'Accès refusé : réservé au super administrateur';
    end if;

    if p_user_id = auth.uid() then
        raise exception 'Vous ne pouvez pas supprimer votre propre compte';
    end if;

    delete from profiles where id = p_user_id;
    delete from auth.users where id = p_user_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- admin_reset_password : réinitialise un mot de passe, réservé au super_admin
-- ----------------------------------------------------------------------------
create or replace function admin_reset_password(p_user_id uuid, p_new_password text)
returns void
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
begin
    if not current_user_is_super_admin() then
        raise exception 'Accès refusé : réservé au super administrateur';
    end if;

    if length(p_new_password) < 8 then
        raise exception 'Le mot de passe doit contenir au moins 8 caractères';
    end if;

    update auth.users
    set encrypted_password = crypt(p_new_password, gen_salt('bf')),
        updated_at = now()
    where id = p_user_id;
end;
$$;

revoke all on function admin_create_user(text, text, text, uuid, varchar, boolean, text) from public, anon;
revoke all on function admin_delete_user(uuid) from public, anon;
revoke all on function admin_reset_password(uuid, text) from public, anon;
grant execute on function admin_create_user(text, text, text, uuid, varchar, boolean, text) to authenticated;
grant execute on function admin_delete_user(uuid) to authenticated;
grant execute on function admin_reset_password(uuid, text) to authenticated;

-- Chaque fonction revérifie current_user_is_super_admin() en interne : même si
-- un utilisateur non-admin appelle la fonction, l'exécution est bloquée par
-- l'exception levée en premier — le grant "to authenticated" seul ne suffit
-- donc pas à autoriser un utilisateur normal à s'en servir.

-- ============================================================================
-- AMÉLIORATION OPTIONNELLE (non requise, non appliquée) : la page Utilisateurs
-- de super-admin.html affiche l'UUID de chaque utilisateur à la place de son
-- email, car `profiles` ne stocke pas l'email et `auth.users` n'est pas
-- exposée via PostgREST côté client. La fonction ci-dessous permettrait
-- d'afficher le vrai email si vous le souhaitez ; le frontend n'en dépend
-- pas actuellement (il continue de fonctionner sans elle).
--
-- create or replace function admin_list_users()
-- returns table (id uuid, email text, entreprise_id uuid, role varchar, has_recouvra boolean, created_at timestamptz)
-- language plpgsql security definer set search_path = public, auth, extensions
-- as $$
-- begin
--     if not current_user_is_super_admin() then
--         raise exception 'Accès refusé : réservé au super administrateur';
--     end if;
--     return query
--         select p.id, u.email, p.entreprise_id, p.role, p.has_recouvra, p.created_at
--         from profiles p join auth.users u on u.id = p.id;
-- end;
-- $$;
-- grant execute on function admin_list_users() to authenticated;
-- ============================================================================

-- ============================================================================
-- AMÉLIORATION OPTIONNELLE #2 (non requise, non appliquée) : la fonction
-- confirm_subscription_payment() (upgrade_wave_paiement_manuel.sql) ne met
-- à jour QUE subscription_payments et subscriptions — elle ne touche jamais
-- profiles.has_recouvra. Le code frontend (super-admin.html, confirmPayment())
-- fait donc un appel supplémentaire séparé pour ce champ après le RPC, ce qui
-- reste correct mais n'est pas parfaitement atomique. Si vous voulez que
-- l'activation soit une seule opération atomique, ajoutez dans le bloc
-- "if p_decision = 'confirmed' then ... end if;" de cette fonction :
--
--   update profiles set has_recouvra = true, updated_at = now()
--   where entreprise_id = (select entreprise_id from subscription_payments where id = p_payment_id);
--
-- (et la même chose avec has_recouvra = false dans un futur RPC d'annulation,
-- si vous décidez d'en créer un pour remplacer annulerPaiement() côté client,
-- qui reste aujourd'hui une séquence de 3 requêtes non atomiques).
-- ============================================================================
