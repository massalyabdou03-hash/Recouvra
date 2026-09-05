-- Migration Recouvra: multi-entreprise, paiements, promesses, relances et branding.
-- A executer apres supabase/schema.sql.

create extension if not exists pgcrypto;

create table if not exists entreprises (
    id uuid primary key default gen_random_uuid(),
    nom varchar(150) not null,
    created_by uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now()
);

insert into entreprises (nom)
select 'Entreprise principale'
where not exists (select 1 from entreprises);

create table if not exists profiles (
    id uuid primary key references auth.users(id) on delete cascade,
    entreprise_id uuid not null references entreprises(id) on delete restrict,
    role varchar(20) not null default 'admin'
        check (role in ('super_admin', 'admin', 'vendeur', 'magasinier')),
    has_recouvra boolean not null default false,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

insert into profiles (id, entreprise_id, role)
select u.id, e.id, 'admin'
from auth.users u
cross join lateral (select id from entreprises order by created_at limit 1) e
where not exists (select 1 from profiles p where p.id = u.id)
on conflict (id) do nothing;

alter table pieces add column if not exists entreprise_id uuid;
alter table mouvements_stock add column if not exists entreprise_id uuid;
alter table clients add column if not exists entreprise_id uuid;
alter table factures add column if not exists entreprise_id uuid;
alter table factures_lignes add column if not exists entreprise_id uuid;
alter table compteur_factures add column if not exists entreprise_id uuid;

update pieces set entreprise_id = (select id from entreprises order by created_at limit 1)
where entreprise_id is null;
update mouvements_stock set entreprise_id = (select id from entreprises order by created_at limit 1)
where entreprise_id is null;
update clients set entreprise_id = (select id from entreprises order by created_at limit 1)
where entreprise_id is null;
update factures set entreprise_id = (select id from entreprises order by created_at limit 1)
where entreprise_id is null;
update factures_lignes fl set entreprise_id = f.entreprise_id
from factures f where f.id = fl.facture_id and fl.entreprise_id is null;
update compteur_factures set entreprise_id = (select id from entreprises order by created_at limit 1)
where entreprise_id is null;

alter table pieces drop constraint if exists pieces_entreprise_id_fkey;
alter table pieces add constraint pieces_entreprise_id_fkey foreign key (entreprise_id) references entreprises(id);
alter table mouvements_stock drop constraint if exists mouvements_stock_entreprise_id_fkey;
alter table mouvements_stock add constraint mouvements_stock_entreprise_id_fkey foreign key (entreprise_id) references entreprises(id);
alter table clients drop constraint if exists clients_entreprise_id_fkey;
alter table clients add constraint clients_entreprise_id_fkey foreign key (entreprise_id) references entreprises(id);
alter table factures drop constraint if exists factures_entreprise_id_fkey;
alter table factures add constraint factures_entreprise_id_fkey foreign key (entreprise_id) references entreprises(id);
alter table factures_lignes drop constraint if exists factures_lignes_entreprise_id_fkey;
alter table factures_lignes add constraint factures_lignes_entreprise_id_fkey foreign key (entreprise_id) references entreprises(id);
alter table compteur_factures drop constraint if exists compteur_factures_entreprise_id_fkey;
alter table compteur_factures add constraint compteur_factures_entreprise_id_fkey foreign key (entreprise_id) references entreprises(id);

create index if not exists idx_pieces_entreprise on pieces(entreprise_id);
create index if not exists idx_clients_entreprise on clients(entreprise_id);
create index if not exists idx_factures_entreprise on factures(entreprise_id);
create index if not exists idx_mouvements_entreprise on mouvements_stock(entreprise_id);

alter table factures add column if not exists montant_paye numeric(10,2) not null default 0 check (montant_paye >= 0);
alter table factures add column if not exists montant_restant numeric(10,2) not null default 0 check (montant_restant >= 0);
alter table factures add column if not exists statut_paiement varchar(25) not null default 'NON_PAYEE'
    check (statut_paiement in ('NON_PAYEE', 'PARTIELLEMENT_PAYEE', 'PAYEE', 'EN_RETARD'));
alter table factures add column if not exists date_echeance timestamptz;
alter table factures add column if not exists updated_at timestamptz not null default now();

update factures set montant_restant = greatest(montant_total - montant_paye, 0)
where montant_restant = 0 and montant_total > 0 and montant_paye = 0;
update factures set statut_paiement = case
    when montant_total <= 0 or montant_paye >= montant_total then 'PAYEE'
    when montant_paye > 0 then 'PARTIELLEMENT_PAYEE'
    else 'NON_PAYEE'
end;

create table if not exists paiements (
    id uuid primary key default gen_random_uuid(),
    entreprise_id uuid not null references entreprises(id) on delete restrict,
    facture_id bigint not null references factures(id) on delete restrict,
    montant numeric(10,2) not null check (montant > 0),
    methode varchar(20) not null check (methode in ('ESPECES', 'WAVE', 'ORANGE_MONEY', 'VIREMENT', 'CARTE', 'AUTRE')),
    reference varchar(100),
    note text,
    date_paiement timestamptz not null default now(),
    created_by uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now()
);

create table if not exists promesses_paiement (
    id uuid primary key default gen_random_uuid(),
    entreprise_id uuid not null references entreprises(id) on delete restrict,
    facture_id bigint not null references factures(id) on delete restrict,
    client_id bigint not null references clients(id) on delete restrict,
    montant_promis numeric(10,2) not null check (montant_promis > 0),
    date_promise timestamptz not null,
    statut varchar(20) not null default 'EN_ATTENTE'
        check (statut in ('EN_ATTENTE', 'RESPECTEE', 'NON_RESPECTEE', 'ANNULEE')),
    note text,
    created_by uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists relances (
    id uuid primary key default gen_random_uuid(),
    entreprise_id uuid not null references entreprises(id) on delete restrict,
    facture_id bigint not null references factures(id) on delete restrict,
    client_id bigint not null references clients(id) on delete restrict,
    canal varchar(20) not null check (canal in ('WHATSAPP', 'EMAIL', 'TELEPHONE', 'MANUEL')),
    message text,
    created_by uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now()
);

create table if not exists entreprise_settings (
    entreprise_id uuid primary key references entreprises(id) on delete cascade,
    nom_commercial varchar(150),
    logo_path text,
    telephone varchar(30),
    adresse text,
    email varchar(255),
    identifiant_fiscal varchar(100),
    numero_ninea varchar(100),
    numero_rccm varchar(100),
    primary_color varchar(7) not null default '#e87516' check (primary_color ~ '^#[0-9A-Fa-f]{6}$'),
    secondary_color varchar(7) not null default '#20252b' check (secondary_color ~ '^#[0-9A-Fa-f]{6}$'),
    dark_mode_enabled boolean not null default false,
    updated_at timestamptz not null default now()
);

create table if not exists recouvra_activation_requests (
    id uuid primary key default gen_random_uuid(),
    entreprise_id uuid not null references entreprises(id) on delete cascade,
    requested_by uuid not null references auth.users(id) on delete cascade,
    status varchar(12) not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
    reviewed_by uuid references auth.users(id) on delete set null,
    reviewed_at timestamptz,
    note text,
    created_at timestamptz not null default now()
);

create unique index if not exists one_pending_recouvra_request
on recouvra_activation_requests(requested_by) where status = 'pending';
create index if not exists idx_paiements_facture on paiements(facture_id, date_paiement desc);
create index if not exists idx_promesses_statut_date on promesses_paiement(statut, date_promise);
create index if not exists idx_relances_facture on relances(facture_id, created_at desc);

insert into entreprise_settings (entreprise_id, nom_commercial)
select id, nom from entreprises
on conflict (entreprise_id) do nothing;

create or replace function current_user_entreprise_id()
returns uuid language sql stable security definer set search_path = public as $$
    select entreprise_id from profiles where id = auth.uid()
$$;

create or replace function current_user_is_super_admin()
returns boolean language sql stable security definer set search_path = public as $$
    select exists (select 1 from profiles where id = auth.uid() and role = 'super_admin')
$$;

create or replace function current_user_has_recouvra()
returns boolean language sql stable security definer set search_path = public as $$
    select exists (select 1 from profiles where id = auth.uid() and has_recouvra = true)
$$;

create or replace function set_entreprise_on_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
    if new.entreprise_id is null then
        new.entreprise_id := current_user_entreprise_id();
    end if;
    if new.entreprise_id is null or (new.entreprise_id <> current_user_entreprise_id() and not current_user_is_super_admin()) then
        raise exception 'Entreprise invalide pour cet utilisateur';
    end if;
    return new;
end;
$$;

create or replace function set_facture_ligne_entreprise()
returns trigger language plpgsql security definer set search_path = public as $$
begin
    if new.entreprise_id is null then
        select entreprise_id into new.entreprise_id from factures where id = new.facture_id;
    end if;
    if new.entreprise_id is null or (new.entreprise_id <> current_user_entreprise_id() and not current_user_is_super_admin()) then
        raise exception 'Entreprise invalide pour cette ligne de facture';
    end if;
    return new;
end;
$$;

drop trigger if exists trg_pieces_entreprise on pieces;
create trigger trg_pieces_entreprise before insert on pieces for each row execute function set_entreprise_on_insert();
drop trigger if exists trg_mouvements_entreprise on mouvements_stock;
create trigger trg_mouvements_entreprise before insert on mouvements_stock for each row execute function set_entreprise_on_insert();
drop trigger if exists trg_clients_entreprise on clients;
create trigger trg_clients_entreprise before insert on clients for each row execute function set_entreprise_on_insert();
drop trigger if exists trg_factures_entreprise on factures;
create trigger trg_factures_entreprise before insert on factures for each row execute function set_entreprise_on_insert();
drop trigger if exists trg_compteur_entreprise on compteur_factures;
create trigger trg_compteur_entreprise before insert on compteur_factures for each row execute function set_entreprise_on_insert();
drop trigger if exists trg_lignes_entreprise on factures_lignes;
create trigger trg_lignes_entreprise before insert on factures_lignes for each row execute function set_facture_ligne_entreprise();

create or replace function refresh_facture_payment_state(p_facture_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare
    total_paye numeric(10,2);
    total_facture numeric(10,2);
    echeance timestamptz;
begin
    select montant_total, date_echeance into total_facture, echeance from factures where id = p_facture_id for update;
    select coalesce(sum(montant), 0) into total_paye from paiements where facture_id = p_facture_id;
    update factures set
        montant_paye = least(total_paye, total_facture),
        montant_restant = greatest(total_facture - total_paye, 0),
        statut_paiement = case
            when total_paye >= total_facture then 'PAYEE'
            when echeance is not null and echeance < now() and total_paye < total_facture then 'EN_RETARD'
            when total_paye > 0 then 'PARTIELLEMENT_PAYEE'
            else 'NON_PAYEE'
        end,
        updated_at = now()
    where id = p_facture_id;
end;
$$;

create or replace function enregistrer_paiement(
    p_facture_id bigint,
    p_montant numeric,
    p_methode varchar,
    p_reference varchar default null,
    p_note text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
    facture factures%rowtype;
    paiement_id uuid;
begin
    if auth.uid() is null or not current_user_has_recouvra() then raise exception 'Acces Recouvra refuse'; end if;
    if p_montant <= 0 then raise exception 'Le montant du paiement doit etre positif'; end if;
    select * into facture from factures where id = p_facture_id and entreprise_id = current_user_entreprise_id() for update;
    if facture.id is null then raise exception 'Facture introuvable'; end if;
    if facture.statut = 'ANNULEE' then raise exception 'Impossible de payer une facture annulee'; end if;
    perform refresh_facture_payment_state(p_facture_id);
    select * into facture from factures where id = p_facture_id for update;
    if p_montant > facture.montant_restant then raise exception 'Le paiement depasse le solde restant'; end if;
    insert into paiements(entreprise_id, facture_id, montant, methode, reference, note, created_by)
    values (facture.entreprise_id, p_facture_id, p_montant, upper(p_methode), p_reference, p_note, auth.uid())
    returning id into paiement_id;
    perform refresh_facture_payment_state(p_facture_id);
    return paiement_id;
end;
$$;

create or replace function verifier_promesses()
returns integer language plpgsql security definer set search_path = public as $$
declare total integer;
begin
    update promesses_paiement pp set statut = 'NON_RESPECTEE', updated_at = now()
    from factures f
    where pp.facture_id = f.id and pp.statut = 'EN_ATTENTE'
      and pp.date_promise < now() and f.montant_restant > 0
      and (pp.entreprise_id = current_user_entreprise_id() or current_user_is_super_admin());
    get diagnostics total = row_count;
    return total;
end;
$$;

create or replace function annuler_facture(p_facture_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare facture factures%rowtype; ligne record; stock integer;
begin
    if auth.uid() is null then raise exception 'Authentification requise'; end if;
    select * into facture from factures where id = p_facture_id and entreprise_id = current_user_entreprise_id() for update;
    if facture.id is null then raise exception 'Facture introuvable'; end if;
    if facture.statut <> 'VALIDEE' then raise exception 'Seule une facture validee peut etre annulee'; end if;
    for ligne in select piece_id, quantite from factures_lignes where facture_id = p_facture_id order by piece_id loop
        select quantite_stock into stock from pieces where id = ligne.piece_id for update;
        update pieces set quantite_stock = quantite_stock + ligne.quantite, updated_at = now() where id = ligne.piece_id;
        insert into mouvements_stock(piece_id, type_mouvement, quantite, quantite_avant, quantite_apres, motif, facture_id, entreprise_id)
        values (ligne.piece_id, 'ENTREE', ligne.quantite, stock, stock + ligne.quantite, 'Annulation facture', p_facture_id, facture.entreprise_id);
    end loop;
    update factures set statut = 'ANNULEE', updated_at = now() where id = p_facture_id;
end;
$$;

create or replace function supprimer_mouvement_stock(p_mouvement_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare mouvement mouvements_stock%rowtype; stock integer;
begin
    if auth.uid() is null or not exists (select 1 from profiles where id = auth.uid() and role in ('admin', 'super_admin')) then
        raise exception 'Permission refusee';
    end if;
    select * into mouvement from mouvements_stock where id = p_mouvement_id and entreprise_id = current_user_entreprise_id() for update;
    if mouvement.id is null then raise exception 'Mouvement introuvable'; end if;
    select quantite_stock into stock from pieces where id = mouvement.piece_id for update;
    if mouvement.type_mouvement = 'ENTREE' then stock := stock - mouvement.quantite; else stock := stock + mouvement.quantite; end if;
    if stock < 0 then raise exception 'Suppression impossible: stock negatif'; end if;
    update pieces set quantite_stock = stock, updated_at = now() where id = mouvement.piece_id;
    delete from mouvements_stock where id = p_mouvement_id;
end;
$$;

alter table entreprises enable row level security;
alter table profiles enable row level security;
alter table paiements enable row level security;
alter table promesses_paiement enable row level security;
alter table relances enable row level security;
alter table entreprise_settings enable row level security;
alter table recouvra_activation_requests enable row level security;

-- Remplacement des policies MVP ouvertes.
do $$ declare t text; begin
    foreach t in array array['pieces','mouvements_stock','clients','factures','factures_lignes','compteur_factures'] loop
        execute format('drop policy if exists "auth full access" on %I', t);
    end loop;
end $$;

drop policy if exists pieces_company_access on pieces;
create policy pieces_company_access on pieces for all to authenticated using (entreprise_id = current_user_entreprise_id() or current_user_is_super_admin()) with check (entreprise_id = current_user_entreprise_id() or current_user_is_super_admin());
drop policy if exists mouvements_company_access on mouvements_stock;
create policy mouvements_company_access on mouvements_stock for all to authenticated using (entreprise_id = current_user_entreprise_id() or current_user_is_super_admin()) with check (entreprise_id = current_user_entreprise_id() or current_user_is_super_admin());
drop policy if exists clients_company_access on clients;
create policy clients_company_access on clients for all to authenticated using (entreprise_id = current_user_entreprise_id() or current_user_is_super_admin()) with check (entreprise_id = current_user_entreprise_id() or current_user_is_super_admin());
drop policy if exists factures_company_access on factures;
create policy factures_company_access on factures for all to authenticated using (entreprise_id = current_user_entreprise_id() or current_user_is_super_admin()) with check (entreprise_id = current_user_entreprise_id() or current_user_is_super_admin());
drop policy if exists lignes_company_access on factures_lignes;
create policy lignes_company_access on factures_lignes for all to authenticated using (entreprise_id = current_user_entreprise_id() or current_user_is_super_admin()) with check (entreprise_id = current_user_entreprise_id() or current_user_is_super_admin());
drop policy if exists compteur_company_access on compteur_factures;
create policy compteur_company_access on compteur_factures for all to authenticated using (entreprise_id = current_user_entreprise_id() or current_user_is_super_admin()) with check (entreprise_id = current_user_entreprise_id() or current_user_is_super_admin());
drop policy if exists entreprises_company_access on entreprises;
create policy entreprises_company_access on entreprises for select to authenticated using (id = current_user_entreprise_id() or current_user_is_super_admin());
drop policy if exists profiles_self_or_superadmin on profiles;
create policy profiles_self_or_superadmin on profiles for select to authenticated using (id = auth.uid() or current_user_is_super_admin());
drop policy if exists profiles_superadmin_update on profiles;
create policy profiles_superadmin_update on profiles for update to authenticated using (current_user_is_super_admin()) with check (current_user_is_super_admin());
drop policy if exists paiements_recouvra_access on paiements;
create policy paiements_recouvra_access on paiements for select to authenticated using ((entreprise_id = current_user_entreprise_id() and current_user_has_recouvra()) or current_user_is_super_admin());
drop policy if exists promesses_recouvra_access on promesses_paiement;
create policy promesses_recouvra_access on promesses_paiement for all to authenticated using ((entreprise_id = current_user_entreprise_id() and current_user_has_recouvra()) or current_user_is_super_admin()) with check ((entreprise_id = current_user_entreprise_id() and current_user_has_recouvra()) or current_user_is_super_admin());
drop policy if exists relances_recouvra_access on relances;
create policy relances_recouvra_access on relances for all to authenticated using ((entreprise_id = current_user_entreprise_id() and current_user_has_recouvra()) or current_user_is_super_admin()) with check ((entreprise_id = current_user_entreprise_id() and current_user_has_recouvra()) or current_user_is_super_admin());
drop policy if exists settings_company_access on entreprise_settings;
create policy settings_company_access on entreprise_settings for all to authenticated using (entreprise_id = current_user_entreprise_id() or current_user_is_super_admin()) with check (entreprise_id = current_user_entreprise_id() or current_user_is_super_admin());
drop policy if exists activation_self_or_superadmin on recouvra_activation_requests;
create policy activation_self_or_superadmin on recouvra_activation_requests for all to authenticated using (requested_by = auth.uid() or current_user_is_super_admin()) with check (requested_by = auth.uid() or current_user_is_super_admin());

revoke all on function enregistrer_paiement(bigint, numeric, varchar, varchar, text) from public, anon;
grant execute on function enregistrer_paiement(bigint, numeric, varchar, varchar, text) to authenticated;
revoke all on function verifier_promesses() from public, anon;
grant execute on function verifier_promesses() to authenticated;
revoke all on function annuler_facture(bigint) from public, anon;
grant execute on function annuler_facture(bigint) to authenticated;
revoke all on function supprimer_mouvement_stock(bigint) from public, anon;
grant execute on function supprimer_mouvement_stock(bigint) to authenticated;

-- Le bucket doit etre cree dans Storage. Ces policies seront appliquees apres creation du bucket.
insert into storage.buckets (id, name, public)
values ('company-logos', 'company-logos', false)
on conflict (id) do update set public = false;

drop policy if exists company_logo_read on storage.objects;
create policy company_logo_read on storage.objects for select to authenticated
using (bucket_id = 'company-logos' and (name like current_user_entreprise_id()::text || '/%' or current_user_is_super_admin()));
drop policy if exists company_logo_insert on storage.objects;
create policy company_logo_insert on storage.objects for insert to authenticated
with check (bucket_id = 'company-logos' and (name like current_user_entreprise_id()::text || '/%' or current_user_is_super_admin()));
drop policy if exists company_logo_update on storage.objects;
create policy company_logo_update on storage.objects for update to authenticated
using (bucket_id = 'company-logos' and (name like current_user_entreprise_id()::text || '/%' or current_user_is_super_admin()))
with check (bucket_id = 'company-logos' and (name like current_user_entreprise_id()::text || '/%' or current_user_is_super_admin()));
drop policy if exists company_logo_delete on storage.objects;
create policy company_logo_delete on storage.objects for delete to authenticated
using (bucket_id = 'company-logos' and (name like current_user_entreprise_id()::text || '/%' or current_user_is_super_admin()));
