-- ============================================================================
-- CORRECTIF #3 — À EXÉCUTER APRÈS les deux scripts précédents
-- ============================================================================
-- Contexte : requireAuth() (assets/app.js) redirige tout utilisateur vers
-- abonnement.html tant que subscriptions.status <> 'active'. Comme
-- create_company_for_new_user() créait jusqu'ici la ligne subscriptions avec
-- status='pending', un nouveau compte tombait DIRECTEMENT sur la page de
-- paiement après l'inscription, sans jamais voir l'essai de 14 jours promis.
-- (Une tentative précédente avait déjà essayé de gérer un statut 'trial' /
-- une colonne trial_ends_at côté frontend, mais ni l'un ni l'autre n'existe
-- réellement en base — voir le commentaire dans app.js : ça échouait
-- systématiquement et avait été neutralisé, d'où la disparition silencieuse
-- de l'essai.)
--
-- Choix fait ici, pour rester sur les colonnes qui existent déjà : l'essai
-- est un abonnement status='active' normal, avec current_period_end fixé à
-- 14 jours après l'inscription. app.js vérifie maintenant cette date (voir
-- requireAuth()) au lieu de considérer "active" comme valable indéfiniment.
-- Quand le premier paiement est confirmé par un admin
-- (confirm_subscription_payment), current_period_end est repoussé de 30
-- jours de plus, donc l'essai s'efface naturellement dans le flux normal.
-- ============================================================================

create or replace function create_company_for_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
    company_id uuid;
    metadata jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
    v_now timestamptz := now();
begin
    insert into entreprises (nom, gerant_nom, telephone, created_by)
    values (
        coalesce(nullif(metadata->>'entreprise_nom', ''), 'Nouvelle entreprise'),
        nullif(metadata->>'gerant_nom', ''),
        nullif(metadata->>'telephone', ''),
        new.id
    ) returning id into company_id;

    insert into profiles (id, entreprise_id, role, has_recouvra)
    values (new.id, company_id, 'admin', false);

    begin
        insert into entreprise_settings (entreprise_id, nom_commercial, telephone)
        values (
            company_id,
            coalesce(nullif(metadata->>'entreprise_nom', ''), 'Nouvelle entreprise'),
            nullif(metadata->>'telephone', '')
        )
        on conflict (entreprise_id) do nothing;
    exception when others then
        raise warning 'create_company_for_new_user: entreprise_settings a échoué pour % : %', company_id, sqlerrm;
    end;

    begin
        -- Essai gratuit de 14 jours : actif tout de suite, sans paiement.
        insert into subscriptions (entreprise_id, status, started_at, current_period_start, current_period_end)
        values (company_id, 'active', v_now, v_now, v_now + interval '14 days')
        on conflict (entreprise_id) do nothing;
    exception when others then
        raise warning 'create_company_for_new_user: subscriptions a échoué pour % : %', company_id, sqlerrm;
    end;

    return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- Policy RLS obsolète : elle exigeait un montant exactement égal à 50000
-- (frais de mise en place) ou 10000 (mensualité), des valeurs d'une V1
-- antérieure à la tarification actuelle (frais de mise en place 10000/25000
-- selon le commerce + mensualité 10000/15000 selon le plan, cumulés en un
-- seul paiement — voir calculateSetupFee()/selectMonthlyPlan() dans
-- assets/abonnement.js). Résultat : la policy rejetait presque tous les
-- paiements réels. La vérification de l'exactitude du montant reste de toute
-- façon manuelle (l'admin confirme au vu de la preuve Wave, il n'y a pas de
-- webhook) : on se contente ici d'exiger un montant positif, déjà garanti
-- par la contrainte "check (amount > 0)" de la table, plus les vérifications
-- d'appartenance qui, elles, restent nécessaires.
-- ----------------------------------------------------------------------------
drop policy if exists subscription_payments_self_insert on subscription_payments;
create policy subscription_payments_self_insert on subscription_payments for insert to authenticated
    with check (
        submitted_by = auth.uid()
        and entreprise_id = current_user_entreprise_id()
        and status = 'pending'
        and payment_type in ('setup','subscription')
        and amount > 0
        and subscription_id = (select id from subscriptions where entreprise_id = current_user_entreprise_id())
    );
