-- Reconciliation du suivi des paiements : "Emprunts" (credits.html, clients.html) utilise
-- un flag simple factures.paye/paye_at qui n'a jamais ete cree en base, alors que
-- "Recouvra" (paiements.html, recouvra.js, enregistrer_paiement) utilise deja
-- montant_paye/montant_restant/statut_paiement (migration_recouvra.sql). Consequence en
-- production : credits.html et clients.html interrogeaient une colonne inexistante
-- (factures.paye) et echouaient silencieusement (stats a 0, page Emprunts vide).
-- A executer apres schema.sql, migration_recouvra.sql et upgrade_units_mesure.sql.

alter table factures add column if not exists paye boolean not null default false;
alter table factures add column if not exists paye_at timestamptz;

-- Les factures deja validees et payees comptant (cash) sont considerees payees ;
-- les ventes a credit deja soldees (montant_restant = 0) aussi.
update factures set paye = true, paye_at = coalesce(paye_at, validated_at, now())
where statut = 'VALIDEE' and paye = false and (mode_paiement <> 'CREDIT' or montant_restant <= 0);

-- Garde les deux modeles de suivi (paye/paye_at cote Emprunts, montant_paye/
-- montant_restant/statut_paiement cote Recouvra) synchronises quel que soit le cote qui
-- ecrit : credits.html ne touche que paye/paye_at, enregistrer_paiement (Recouvra) ne
-- touche que montant_paye/montant_restant/statut_paiement.
create or replace function sync_facture_payment_fields()
returns trigger language plpgsql as $$
begin
    if new.paye is distinct from old.paye then
        if new.paye then
            new.montant_paye := new.montant_total;
            new.montant_restant := 0;
            new.statut_paiement := 'PAYEE';
            if new.paye_at is null then new.paye_at := now(); end if;
        else
            new.montant_paye := 0;
            new.montant_restant := new.montant_total;
            new.statut_paiement := case when new.date_echeance is not null and new.date_echeance < now() then 'EN_RETARD' else 'NON_PAYEE' end;
            new.paye_at := null;
        end if;
    elsif new.statut_paiement is distinct from old.statut_paiement or new.montant_restant is distinct from old.montant_restant then
        new.paye := (new.statut_paiement = 'PAYEE');
        if new.paye then
            if new.paye_at is null then new.paye_at := now(); end if;
        else
            new.paye_at := null;
        end if;
    end if;
    return new;
end;
$$;

drop trigger if exists trg_sync_facture_payment on factures;
create trigger trg_sync_facture_payment before update on factures for each row execute function sync_facture_payment_fields();

-- valider_facture (upgrade_units_mesure.sql) initialise deja montant_paye/montant_restant/
-- statut_paiement selon le mode de paiement : on aligne paye/paye_at sur la meme regle des
-- la validation (le trigger ci-dessus prendra ensuite le relais pour les mises a jour
-- ulterieures, des deux cotes).
create or replace function valider_facture(p_facture_id bigint, p_mode_paiement varchar, p_echeance_type varchar default null)
returns void language plpgsql security definer set search_path = public as $$
declare
    v_annee integer := extract(year from now()); v_numero integer; v_ligne record; v_stock numeric(12,3);
    v_date_echeance timestamptz;
begin
    if not exists(select 1 from factures where id=p_facture_id and statut='BROUILLON') then raise exception 'Facture introuvable ou deja traitee'; end if;
    if p_mode_paiement = 'CREDIT' then
        v_date_echeance := case p_echeance_type when 'SEMAINE' then now() + interval '7 days' when 'MOIS' then now() + interval '1 month' else null end;
    end if;
    insert into compteur_factures(annee,dernier_numero) values(v_annee,0) on conflict(annee) do nothing;
    update compteur_factures set dernier_numero=dernier_numero+1 where annee=v_annee returning dernier_numero into v_numero;
    for v_ligne in select fl.piece_id,fl.quantite,p.quantite_stock,p.designation from factures_lignes fl join pieces p on p.id=fl.piece_id where fl.facture_id=p_facture_id loop
        if v_ligne.quantite_stock < v_ligne.quantite then raise exception 'Stock insuffisant pour %',v_ligne.designation; end if;
    end loop;
    for v_ligne in select piece_id,quantite from factures_lignes where facture_id=p_facture_id order by piece_id loop
        select quantite_stock into v_stock from pieces where id=v_ligne.piece_id for update;
        update pieces set quantite_stock=quantite_stock-v_ligne.quantite,updated_at=now() where id=v_ligne.piece_id;
        insert into mouvements_stock(piece_id,type_mouvement,quantite,quantite_avant,quantite_apres,motif,facture_id)
        values(v_ligne.piece_id,'SORTIE',v_ligne.quantite,v_stock,v_stock-v_ligne.quantite,'Vente - facture validee',p_facture_id);
    end loop;
    update factures set
        statut='VALIDEE',
        numero_facture='FA-'||v_annee||'-'||lpad(v_numero::text,4,'0'),
        mode_paiement=p_mode_paiement,
        echeance_type=p_echeance_type,
        date_echeance=v_date_echeance,
        paye=(p_mode_paiement<>'CREDIT'),
        paye_at=case when p_mode_paiement<>'CREDIT' then now() else null end,
        montant_paye=case when p_mode_paiement='CREDIT' then 0 else montant_total end,
        montant_restant=case when p_mode_paiement='CREDIT' then montant_total else 0 end,
        statut_paiement=case when p_mode_paiement='CREDIT' then 'NON_PAYEE' else 'PAYEE' end,
        validated_at=now(),
        updated_at=now()
    where id=p_facture_id;
end;
$$;
