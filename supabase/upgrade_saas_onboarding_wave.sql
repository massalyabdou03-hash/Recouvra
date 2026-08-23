-- Onboarding SaaS et abonnements Recouvra.
-- A executer apres schema.sql et migration_recouvra.sql.

alter table entreprises add column if not exists gerant_nom varchar(150);
alter table entreprises add column if not exists telephone varchar(30);

create table if not exists demandes_abonnement (
    id uuid primary key default gen_random_uuid(),
    entreprise_id uuid not null references entreprises(id) on delete cascade,
    reference_wave varchar(120) not null,
    montant numeric(10,2) not null default 15000 check (montant = 15000),
    status varchar(15) not null default 'en_attente' check (status in ('en_attente', 'validee', 'refusee')),
    submitted_by uuid not null references auth.users(id) on delete cascade,
    reviewed_by uuid references auth.users(id) on delete set null,
    reviewed_at timestamptz,
    created_at timestamptz not null default now()
);

create unique index if not exists one_pending_subscription
on demandes_abonnement(entreprise_id) where status = 'en_attente';

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

    return new;
end;
$$;

drop trigger if exists on_auth_user_created_create_company on auth.users;
create trigger on_auth_user_created_create_company
after insert on auth.users
for each row execute function create_company_for_new_user();

alter table demandes_abonnement enable row level security;
drop policy if exists subscription_self_insert on demandes_abonnement;
create policy subscription_self_insert on demandes_abonnement for insert to authenticated
with check (submitted_by = auth.uid() and entreprise_id = current_user_entreprise_id());
drop policy if exists subscription_self_read on demandes_abonnement;
create policy subscription_self_read on demandes_abonnement for select to authenticated
using (submitted_by = auth.uid() or entreprise_id = current_user_entreprise_id() or current_user_is_super_admin());
drop policy if exists subscription_superadmin_update on demandes_abonnement;
create policy subscription_superadmin_update on demandes_abonnement for update to authenticated
using (current_user_is_super_admin()) with check (current_user_is_super_admin());

grant execute on function create_company_for_new_user() to service_role;
