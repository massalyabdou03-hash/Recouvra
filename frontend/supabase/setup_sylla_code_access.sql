-- Script d'activation du login simple par code pour Sylla Automobile.
-- Ce tableau permet d'associer un code simple a un vrai compte Supabase Auth existant.
-- Cela permet de garder le code simple pour l'app principale, tout en conservant
-- le login email/mot de passe pour Recouvra et les autres comptes autorises.

create table if not exists sylla_access_codes (
    id uuid primary key default gen_random_uuid(),
    code text not null unique,
    email text not null,
    password text not null,
    active boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

-- Exemple : le code "1234" ouvre l'application avec le compte du proprietaire.
-- Remplacer par le vrai email/mot de passe du compte Supabase du proprietaire.
insert into sylla_access_codes (code, email, password, active)
values (
    '1234',
    'proprietaire@sylla.local',
    'sylla123',
    true
)
on conflict (code) do update
set email = excluded.email,
    password = excluded.password,
    active = excluded.active,
    updated_at = now();

-- Autoriser Recouvra pour ce compte si c'est le proprietaire.
update profiles
set role = 'admin',
    has_recouvra = true,
    updated_at = now()
where id = (
    select id from auth.users where lower(email) = lower('proprietaire@sylla.local')
);

select * from sylla_access_codes;
