-- Unites de mesure et ventes en lots pour le SaaS.
-- A executer apres schema.sql et migration_recouvra.sql.

alter table pieces add column if not exists unite_mesure varchar(20) not null default 'PCS';
alter table pieces add column if not exists permettre_fractionnement boolean not null default false;
alter table pieces add column if not exists unite_gros_facteur numeric(12,3);
alter table pieces add column if not exists unite_gros varchar(20);
alter table pieces drop constraint if exists pieces_unite_mesure_check;
alter table pieces add constraint pieces_unite_mesure_check check (unite_mesure in ('PCS','M','M2','KG','L','ROULEAU','CARTON','PAQUET'));
alter table pieces drop constraint if exists pieces_unite_gros_facteur_check;
alter table pieces add constraint pieces_unite_gros_facteur_check check (unite_gros_facteur is null or unite_gros_facteur > 0);

alter table pieces alter column quantite_stock type numeric(12,3) using quantite_stock::numeric;
alter table mouvements_stock alter column quantite type numeric(12,3) using quantite::numeric;
alter table mouvements_stock alter column quantite_avant type numeric(12,3) using quantite_avant::numeric;
alter table mouvements_stock alter column quantite_apres type numeric(12,3) using quantite_apres::numeric;
alter table factures_lignes alter column quantite type numeric(12,3) using quantite::numeric;
alter table factures_lignes add column if not exists quantite_affichee numeric(12,3);
alter table factures_lignes add column if not exists unite_mesure varchar(20);
alter table factures_lignes add column if not exists vente_par_lot boolean not null default false;
alter table factures_lignes add column if not exists unite_gros varchar(20);

create or replace function enregistrer_mouvement_stock(p_piece_id bigint, p_type varchar, p_quantite numeric, p_motif varchar)
returns void language plpgsql security definer set search_path = public as $$
declare v_stock_actuel numeric(12,3); v_nouveau_stock numeric(12,3);
begin
    select quantite_stock into v_stock_actuel from pieces where id = p_piece_id for update;
    if v_stock_actuel is null then raise exception 'Article introuvable'; end if;
    if p_quantite <= 0 then raise exception 'Quantite invalide'; end if;
    if p_type = 'ENTREE' then v_nouveau_stock := v_stock_actuel + p_quantite;
    elsif p_type = 'SORTIE' then
        if v_stock_actuel < p_quantite then raise exception 'Stock insuffisant'; end if;
        v_nouveau_stock := v_stock_actuel - p_quantite;
    elsif p_type = 'AJUSTEMENT' then v_nouveau_stock := p_quantite;
    else raise exception 'Type de mouvement invalide'; end if;
    update pieces set quantite_stock = v_nouveau_stock, updated_at = now() where id = p_piece_id;
    insert into mouvements_stock(piece_id,type_mouvement,quantite,quantite_avant,quantite_apres,motif)
    values(p_piece_id,p_type,case when p_type='AJUSTEMENT' then greatest(abs(v_nouveau_stock-v_stock_actuel),0.001) else p_quantite end,v_stock_actuel,v_nouveau_stock,p_motif);
end;
$$;

alter table factures add column if not exists echeance_type varchar(10);
alter table factures drop constraint if exists factures_echeance_type_check;
alter table factures add constraint factures_echeance_type_check check (echeance_type is null or echeance_type in ('SEMAINE','MOIS'));

-- Remplace la version a 2 parametres (schema.sql) : le frontend (facture-detail.html,
-- factures.html, app.js) appelle valider_facture avec p_echeance_type depuis la mise en
-- place du credit Recouvra, mais cette 3e signature n'avait jamais ete deployee - la
-- validation d'une vente a credit echouait donc en production (fonction introuvable),
-- et montant_paye/montant_restant/statut_paiement n'etaient jamais initialises (une
-- facture validee restait invisible dans le tableau Recouvra, qui filtre sur
-- montant_restant > 0).
drop function if exists valider_facture(bigint, varchar);
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
        montant_paye=case when p_mode_paiement='CREDIT' then 0 else montant_total end,
        montant_restant=case when p_mode_paiement='CREDIT' then montant_total else 0 end,
        statut_paiement=case when p_mode_paiement='CREDIT' then 'NON_PAYEE' else 'PAYEE' end,
        validated_at=now(),
        updated_at=now()
    where id=p_facture_id;
end;
$$;
