-- Configuration du compte administrateur du projet de test Recouvra.
-- A executer APRES schema.sql et migration_recouvra.sql.
-- Le compte doit deja exister dans Authentication > Users.

do $$
declare
    v_email constant text := 'massalyabdou03@gmail.com';
    v_user_id uuid;
    v_entreprise_id uuid;
begin
    select id into v_user_id
    from auth.users
    where lower(email) = lower(v_email);

    if v_user_id is null then
        raise exception 'Le compte % doit etre cree dans Authentication > Users avant ce script', v_email;
    end if;

    select id into v_entreprise_id
    from entreprises
    where lower(nom) = 'recouvra'
    order by created_at
    limit 1;

    if v_entreprise_id is null then
        select id into v_entreprise_id
        from entreprises
        order by created_at
        limit 1;
    end if;

    if v_entreprise_id is null then
        insert into entreprises (nom, created_by)
        values ('Recouvra', v_user_id)
        returning id into v_entreprise_id;
    else
        update entreprises set nom = 'Recouvra'
        where id = v_entreprise_id;
    end if;

    insert into profiles (id, entreprise_id, role, has_recouvra)
    values (v_user_id, v_entreprise_id, 'super_admin', true)
    on conflict (id) do update set
        entreprise_id = excluded.entreprise_id,
        role = 'super_admin',
        has_recouvra = true,
        updated_at = now();

    insert into entreprise_settings (entreprise_id, nom_commercial, primary_color, secondary_color, updated_at)
    values (v_entreprise_id, 'Recouvra', '#e87516', '#20252b', now())
    on conflict (entreprise_id) do update set
        nom_commercial = 'Recouvra',
        updated_at = now();
end;
$$;

select p.id, u.email, p.role, p.has_recouvra, p.entreprise_id, e.nom
from profiles p
join auth.users u on u.id = p.id
join entreprises e on e.id = p.entreprise_id
where lower(u.email) = lower('massalyabdou03@gmail.com');
