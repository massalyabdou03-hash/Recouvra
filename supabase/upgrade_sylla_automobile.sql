-- Upgrade Sylla Automobile uniquement.
-- A executer APRES migration_recouvra.sql sur l'instance Sylla.
-- Ce script ne modifie pas clients, pieces ni factures.
-- Remplacer la valeur ci-dessous par l'email reel du gerant avant execution.

do $$
declare
    v_email constant text := 'email_du_gerant_sylla';
    v_user_id uuid;
    v_entreprise_id uuid;
begin
    if v_email = 'email_du_gerant_sylla' then
        raise exception 'Remplacez email_du_gerant_sylla par l email reel du gerant Sylla Automobile';
    end if;

    select id into v_user_id
    from auth.users
    where lower(email) = lower(v_email);

    if v_user_id is null then
        raise exception 'Aucun compte Supabase Auth ne correspond a %', v_email;
    end if;

    select entreprise_id into v_entreprise_id
    from profiles
    where id = v_user_id
    for update;

    if v_entreprise_id is null then
        select id into v_entreprise_id
        from entreprises
        order by created_at
        limit 1;

        if v_entreprise_id is null then
            insert into entreprises (nom, created_by)
            values ('Sylla Automobile', v_user_id)
            returning id into v_entreprise_id;
        end if;

        insert into profiles (id, entreprise_id, role, has_recouvra)
        values (v_user_id, v_entreprise_id, 'admin', true)
        on conflict (id) do update set
            entreprise_id = excluded.entreprise_id,
            role = 'admin',
            has_recouvra = true,
            updated_at = now();
    else
        update profiles
        set role = 'admin', has_recouvra = true, updated_at = now()
        where id = v_user_id;
    end if;

    update entreprises
    set nom = 'Sylla Automobile'
    where id = v_entreprise_id;

    insert into entreprise_settings (
        entreprise_id,
        nom_commercial,
        primary_color,
        secondary_color,
        updated_at
    ) values (
        v_entreprise_id,
        'Sylla Automobile',
        '#e87516',
        '#20252b',
        now()
    )
    on conflict (entreprise_id) do update set
        nom_commercial = 'Sylla Automobile',
        primary_color = coalesce(entreprise_settings.primary_color, '#e87516'),
        secondary_color = coalesce(entreprise_settings.secondary_color, '#20252b'),
        updated_at = now();
end;
$$;

-- Controle apres execution.
select p.id, u.email, p.role, p.has_recouvra, p.entreprise_id, e.nom
from profiles p
join auth.users u on u.id = p.id
join entreprises e on e.id = p.entreprise_id
where lower(u.email) = lower('email_du_gerant_sylla');
