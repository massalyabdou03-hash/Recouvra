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

create extension if not exists pgcrypto;

-- ----------------------------------------------------------------------------
-- admin_create_user : crée un compte auth + son profil, réservé au super_admin
-- ----------------------------------------------------------------------------
create or replace function admin_create_user(
    p_email text,
    p_password text,
    p_nom text,
    p_entreprise_id uuid,
    p_role varchar,
    p_has_recouvra boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
    v_user_id uuid := gen_random_uuid();
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

    insert into auth.users (
        id, instance_id, aud, role, email, encrypted_password,
        email_confirmed_at, raw_user_meta_data, created_at, updated_at
    )
    values (
        v_user_id,
        '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', p_email,
        crypt(p_password, gen_salt('bf')),
        now(),
        jsonb_build_object('nom', p_nom),
        now(), now()
    );

    insert into profiles (id, entreprise_id, role, has_recouvra)
    values (v_user_id, p_entreprise_id, p_role, p_has_recouvra);

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
set search_path = public, auth
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
set search_path = public, auth
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

revoke all on function admin_create_user(text, text, text, uuid, varchar, boolean) from public, anon;
revoke all on function admin_delete_user(uuid) from public, anon;
revoke all on function admin_reset_password(uuid, text) from public, anon;
grant execute on function admin_create_user(text, text, text, uuid, varchar, boolean) to authenticated;
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
-- language plpgsql security definer set search_path = public, auth
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
