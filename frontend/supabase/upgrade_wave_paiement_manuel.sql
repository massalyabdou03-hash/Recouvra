-- Systeme d'abonnement V1 : lien de paiement Wave Business + validation manuelle
-- par un administrateur. Pas d'API, pas de webhook, pas de cle secrete -- juste
-- Supabase (RLS + une fonction de confirmation atomique cote serveur).
-- Coexiste avec l'ancien systeme (demandes_abonnement, 15 000 F/mois, module
-- Recouvra uniquement) sans le toucher : colonnes differentes, pas de conflit.
-- A executer apres schema.sql, migration_recouvra.sql, upgrade_saas_onboarding_wave.sql
-- et upgrade_onboarding.sql.

create table if not exists subscriptions (
    id uuid primary key default gen_random_uuid(),
    entreprise_id uuid not null references entreprises(id) on delete restrict,

    plan varchar(30) not null default 'recouvra_pro' check (plan in ('recouvra_pro')),
    status varchar(20) not null default 'pending'
        check (status in ('pending','active','past_due','cancelled','expired')),

    started_at timestamptz,
    current_period_start timestamptz,
    current_period_end timestamptz,

    payment_provider varchar(20) not null default 'wave',

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique(entreprise_id)
);

create table if not exists subscription_payments (
    id uuid primary key default gen_random_uuid(),
    entreprise_id uuid not null references entreprises(id) on delete restrict,
    subscription_id uuid not null references subscriptions(id) on delete restrict,
    submitted_by uuid references auth.users(id) on delete set null,

    payment_type varchar(20) not null check (payment_type in ('setup','subscription')),
    amount numeric(10,2) not null check (amount > 0),
    currency varchar(3) not null default 'XOF',

    provider varchar(20) not null default 'wave',
    payment_method varchar(20) not null default 'wave_link',
    payment_reference text,   -- reference ou commentaire libre tape par le client, facultatif
    proof_path text,          -- chemin dans le bucket payment-proofs, facultatif

    status varchar(20) not null default 'pending'
        check (status in ('pending','confirmed','rejected')),

    validated_by uuid references auth.users(id) on delete set null,
    validated_at timestamptz,
    rejection_reason text,  -- obligatoire quand status='rejected', impose dans confirm_subscription_payment()

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create unique index if not exists one_pending_payment_per_entreprise
    on subscription_payments(entreprise_id) where status = 'pending';
-- Meme garde-fou que l'ancien systeme (index partiel sur demandes_abonnement) :
-- un seul paiement en attente a la fois par entreprise.

create index if not exists idx_subscription_payments_entreprise
    on subscription_payments(entreprise_id, created_at desc);

-- Chaque nouvelle entreprise doit avoir une ligne subscriptions des sa creation,
-- sinon le client n'a rien a referencer au moment de declarer son paiement (la
-- policy d'insertion ci-dessous exige un subscription_id qui lui appartient).
-- create_company_for_new_user() existe deja (upgrade_saas_onboarding_wave.sql) ;
-- on la re-declare a l'identique avec un seul insert supplementaire.
create or replace function create_company_for_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
    company_id uuid;
    metadata jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
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

    insert into entreprise_settings (entreprise_id, nom_commercial, telephone)
    values (company_id, coalesce(nullif(metadata->>'entreprise_nom', ''), 'Nouvelle entreprise'), nullif(metadata->>'telephone', ''));

    insert into subscriptions (entreprise_id, status)
    values (company_id, 'pending');

    return new;
end;
$$;

drop trigger if exists on_auth_user_created_create_company on auth.users;
create trigger on_auth_user_created_create_company
after insert on auth.users
for each row execute function create_company_for_new_user();

grant execute on function create_company_for_new_user() to service_role;

alter table subscriptions enable row level security;
alter table subscription_payments enable row level security;

drop policy if exists subscriptions_read on subscriptions;
create policy subscriptions_read on subscriptions for select to authenticated
    using (entreprise_id = current_user_entreprise_id() or current_user_is_super_admin());
-- Aucune policy insert/update pour "authenticated" : la ligne subscriptions est
-- creee uniquement par create_company_for_new_user() et modifiee uniquement par
-- confirm_subscription_payment() ci-dessous -- jamais directement par un client.

drop policy if exists subscription_payments_read on subscription_payments;
create policy subscription_payments_read on subscription_payments for select to authenticated
    using (entreprise_id = current_user_entreprise_id() or current_user_is_super_admin());

drop policy if exists subscription_payments_self_insert on subscription_payments;
create policy subscription_payments_self_insert on subscription_payments for insert to authenticated
    with check (
        submitted_by = auth.uid()
        and entreprise_id = current_user_entreprise_id()
        and status = 'pending'
        and payment_type in ('setup','subscription')
        and amount = case payment_type when 'setup' then 50000 when 'subscription' then 10000 end
        and subscription_id = (select id from subscriptions where entreprise_id = current_user_entreprise_id())
        -- Empeche un client de referencer l'abonnement d'une AUTRE entreprise :
        -- sans cette ligne, entreprise_id serait correct mais subscription_id
        -- pourrait pointer ailleurs, et une confirmation admin activerait alors
        -- l'abonnement d'un tiers.
    );
-- Aucune policy update pour "authenticated" : impossible de passer sa propre
-- demande a "confirmed" depuis le navigateur, quel que soit le code JS modifie.

drop function if exists confirm_subscription_payment(uuid, varchar);
drop function if exists confirm_subscription_payment(uuid, varchar, text);
create or replace function confirm_subscription_payment(p_payment_id uuid, p_decision varchar, p_rejection_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
    v_payment subscription_payments%rowtype;
begin
    if not current_user_is_super_admin() then
        raise exception 'Reserve aux administrateurs';
    end if;
    if p_decision not in ('confirmed','rejected') then
        raise exception 'Decision invalide';
    end if;
    if p_decision = 'rejected' and coalesce(trim(p_rejection_reason), '') = '' then
        raise exception 'Un motif de rejet est obligatoire';
    end if;

    select * into v_payment from subscription_payments where id = p_payment_id for update;
    if not found then
        raise exception 'Paiement introuvable';
    end if;
    if v_payment.status <> 'pending' then
        raise exception 'Ce paiement a deja ete traite (statut actuel : %)', v_payment.status;
        -- Le "for update" ci-dessus verrouille la ligne, et ce controle de statut
        -- rend un deuxieme clic (ou un deuxieme onglet admin) inoffensif : c'est
        -- ce qui empeche la double validation.
    end if;

    update subscription_payments
    set status = p_decision, validated_by = auth.uid(), validated_at = now(), updated_at = now(),
        rejection_reason = case when p_decision = 'rejected' then p_rejection_reason else null end
    where id = p_payment_id;

    if p_decision = 'confirmed' then
        if v_payment.payment_type = 'setup' then
            update subscriptions
            set status = 'active',
                started_at = coalesce(started_at, now()),
                current_period_start = now(),
                current_period_end = now() + interval '30 days',
                updated_at = now()
            where id = v_payment.subscription_id;
        else
            update subscriptions
            set status = 'active',
                current_period_start = now(),
                current_period_end = greatest(coalesce(current_period_end, now()), now()) + interval '30 days',
                updated_at = now()
            where id = v_payment.subscription_id;
        end if;
    end if;
end;
$$;

grant execute on function confirm_subscription_payment(uuid, varchar, text) to authenticated;
-- Ouvert a "authenticated" sans risque : le controle current_user_is_super_admin()
-- a l'interieur de la fonction est la vraie barriere, pas le grant lui-meme.

-- Le bucket "payment-proofs" et ses policies existent deja (upgrade_saas_onboarding_wave.sql),
-- generiques a tout chemin "entreprise_id/...": rien a recreer pour l'upload facultatif
-- de la capture d'ecran de paiement depuis l'onboarding.
