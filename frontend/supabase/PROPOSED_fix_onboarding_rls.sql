-- ============================================================================
-- PROPOSITION DE CORRECTION — NON APPLIQUÉE, À VALIDER AVANT EXÉCUTION
-- ============================================================================
-- Contexte (voir rapport d'audit V2, finding P0-1) :
--
-- 1. frontend/assets/onboarding.js écrit actuellement dans `profiles` des
--    colonnes qui n'existent nulle part dans le schéma SQL du projet :
--    `type_commerce`, `besoins`, `plan_choisi`, `onboarding_complete`.
--    Or `type_commerce` et `besoins` existent bien... mais sur la table
--    `entreprises` (ajoutés par upgrade_onboarding.sql), pas `profiles`.
--    `plan_choisi` et `onboarding_complete` n'existent nulle part (seule
--    `entreprises.onboarding_completed_at` existe, avec un nom différent).
--    => L'UPDATE échoue avec une erreur PostgREST "colonne introuvable" :
--       AUCUN utilisateur ne peut terminer l'onboarding depuis l'interface.
--
-- 2. Même en corrigeant les noms de colonnes, la policy RLS actuelle sur
--    `profiles` n'autorise l'UPDATE qu'aux super_admin
--    (policy `profiles_superadmin_update`). Un utilisateur normal ne peut
--    donc pas non plus mettre à jour son propre `has_recouvra` ni aucun
--    champ de son entreprise en écriture directe depuis le client.
--    (Ceci est plutôt une BONNE chose côté sécurité : ça empêche un
--    utilisateur de s'auto-attribuer has_recouvra=true ou role=super_admin
--    en modifiant la requête depuis le navigateur. Il ne faut donc PAS
--    ouvrir une policy UPDATE large sur `profiles` ou `entreprises` : la
--    bonne solution est une fonction SECURITY DEFINER dédiée, qui ne
--    touche que les colonnes autorisées.)
--
-- 3. onboarding.js écrit aussi directement dans `subscriptions` en statut
--    'active' sans aucun paiement, ce qui contourne entièrement le circuit
--    de vérification par le super-admin utilisé partout ailleurs dans
--    l'app (abonnement.html + confirm_subscription_payment()). C'est un
--    choix produit (essai gratuit à l'inscription ?) qu'on ne tranche pas
--    ici : la fonction ci-dessous reproduit le comportement actuel du
--    code (activation immédiate), à valider/ajuster selon votre décision.
--
-- Cette proposition ajoute UNE fonction RPC unique, appelée depuis le
-- client à la place des UPDATE directs, qui :
--   - écrit type_commerce / besoins / onboarding_completed_at sur
--     `entreprises` (bonne table) ;
--   - active has_recouvra sur `profiles` UNIQUEMENT si le plan choisi est
--     'recouvrement' (corrige le bug métier déjà signalé en 1ère passe) ;
--   - crée/active la subscription correspondante ;
--   - ne s'applique qu'à l'entreprise de l'utilisateur courant (impossible
--     de modifier une autre entreprise).
-- ============================================================================

create or replace function complete_onboarding(
    p_type_commerce text,
    p_besoins jsonb,
    p_plan_choisi text  -- 'simple' ou 'recouvrement'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_entreprise_id uuid;
    v_now timestamptz := now();
    v_plan varchar(30);
    v_monthly_fee integer;
begin
    v_entreprise_id := current_user_entreprise_id();
    if v_entreprise_id is null then
        raise exception 'Aucune entreprise associée à cet utilisateur';
    end if;

    if p_plan_choisi not in ('simple', 'recouvrement') then
        raise exception 'Plan invalide : %', p_plan_choisi;
    end if;

    update entreprises
    set type_commerce = p_type_commerce,
        besoins = coalesce(p_besoins, '[]'::jsonb),
        onboarding_completed_at = v_now
    where id = v_entreprise_id;

    -- Le module Recouvra n'est activé QUE si le plan choisi l'inclut
    -- (corrige le bug où has_recouvra était accordé pour tous les plans).
    update profiles
    set has_recouvra = (p_plan_choisi = 'recouvrement'),
        updated_at = v_now
    where entreprise_id = v_entreprise_id;

    -- NOTE : ceci reproduit le comportement ACTUEL du code (activation
    -- immédiate sans paiement). Si ce n'est pas le comportement souhaité,
    -- remplacez ce bloc par une simple redirection vers abonnement.html
    -- côté frontend et supprimez la partie subscriptions ci-dessous.
    v_plan := case when p_plan_choisi = 'recouvrement' then 'recouvra_pro' else null end;

    if v_plan is not null then
        insert into subscriptions (entreprise_id, plan, status, started_at, current_period_start, current_period_end)
        values (v_entreprise_id, v_plan, 'active', v_now, v_now, v_now + interval '1 month')
        on conflict (entreprise_id) do update set
            plan = excluded.plan,
            status = 'active',
            current_period_start = v_now,
            current_period_end = v_now + interval '1 month',
            updated_at = v_now;
    end if;
end;
$$;

-- Le rôle "authenticated" doit pouvoir exécuter cette fonction (l'accès aux
-- tables sous-jacentes reste, lui, entièrement contrôlé par le corps de la
-- fonction ci-dessus, pas par des policies RLS larges).
grant execute on function complete_onboarding(text, jsonb, text) to authenticated;

-- ============================================================================
-- Changement côté frontend nécessaire si cette migration est appliquée
-- (assets/onboarding.js, dans startTrial()) :
--
-- Remplacer le bloc qui fait :
--   supabaseClient.from('profiles').update({ type_commerce, besoins,
--       plan_choisi, onboarding_complete, updated_at }).eq('id', ...)
--   + les appels directs sur `subscriptions` et `profiles` qui suivent
--
-- Par un unique appel :
--   const { error } = await supabaseClient.rpc('complete_onboarding', {
--       p_type_commerce: selectedCommerce,
--       p_besoins: selectedBesoins,
--       p_plan_choisi: selectedPlan,
--   });
--   if (error) throw error;
--
-- Cette modification frontend n'a pas été appliquée automatiquement : elle
-- dépend de cette migration SQL, qui doit d'abord être relue et exécutée
-- manuellement sur votre projet Supabase.
-- ============================================================================
