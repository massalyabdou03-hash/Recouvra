-- Schema MVP Gestion Stock & Facturation - a executer avant migration_recouvra.sql.
create extension if not exists pg_trgm;

create table if not exists pieces (
    id bigint generated always as identity primary key,
    reference_oem varchar(100) not null,
    reference_interne varchar(50) not null unique,
    code_barre varchar(50) unique,
    designation varchar(255) not null,
    marque varchar(100), categorie varchar(100), emplacement varchar(50),
    prix_achat numeric(10,2) not null default 0 check (prix_achat >= 0),
    prix_vente numeric(10,2) not null default 0 check (prix_vente >= 0),
    quantite_stock integer not null default 0 check (quantite_stock >= 0),
    seuil_alerte integer not null default 1 check (seuil_alerte >= 0),
    actif boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);
create index if not exists idx_pieces_reference_oem on pieces(reference_oem);
create index if not exists idx_pieces_designation_trgm on pieces using gin(designation gin_trgm_ops);

create table if not exists mouvements_stock (
    id bigint generated always as identity primary key,
    piece_id bigint not null references pieces(id) on delete restrict,
    type_mouvement varchar(20) not null check (type_mouvement in ('ENTREE','SORTIE','AJUSTEMENT')),
    quantite integer not null check (quantite > 0),
    quantite_avant integer not null,
    quantite_apres integer not null,
    motif varchar(255), facture_id bigint,
    created_at timestamptz not null default now()
);
create index if not exists idx_mouvements_piece on mouvements_stock(piece_id, created_at desc);

create table if not exists clients (
    id bigint generated always as identity primary key,
    nom varchar(150) not null,
    telephone varchar(20), email varchar(255), adresse text,
    created_at timestamptz not null default now()
);
create index if not exists idx_clients_nom_trgm on clients using gin(nom gin_trgm_ops);

create table if not exists factures (
    id bigint generated always as identity primary key,
    numero_facture varchar(30) unique,
    client_id bigint not null references clients(id) on delete restrict,
    statut varchar(20) not null default 'BROUILLON' check (statut in ('BROUILLON','VALIDEE','ANNULEE')),
    mode_paiement varchar(15) check (mode_paiement in ('ESPECES','CARTE','VIREMENT','CHEQUE','WAVE','OM','CREDIT')),
    montant_total numeric(10,2) not null default 0,
    created_at timestamptz not null default now(), validated_at timestamptz
);
create index if not exists idx_factures_statut on factures(statut);
create index if not exists idx_factures_date on factures(created_at desc);

create table if not exists factures_lignes (
    id bigint generated always as identity primary key,
    facture_id bigint not null references factures(id) on delete cascade,
    piece_id bigint not null references pieces(id) on delete restrict,
    designation varchar(255) not null,
    quantite integer not null check (quantite > 0),
    prix_unitaire numeric(10,2) not null check (prix_unitaire >= 0),
    montant numeric(10,2) not null
);
create index if not exists idx_factures_lignes_facture on factures_lignes(facture_id);
alter table mouvements_stock drop constraint if exists fk_mouvements_facture;
alter table mouvements_stock add constraint fk_mouvements_facture foreign key (facture_id) references factures(id) on delete set null;

create table if not exists compteur_factures (
    annee integer primary key,
    dernier_numero integer not null default 0
);

create or replace view vue_alertes_stock as
select id, reference_oem, reference_interne, designation, quantite_stock, seuil_alerte, marque, emplacement
from pieces where actif = true and quantite_stock <= seuil_alerte
order by (quantite_stock - seuil_alerte) asc;

create or replace function enregistrer_mouvement_stock(p_piece_id bigint, p_type varchar, p_quantite integer, p_motif varchar)
returns void language plpgsql security definer set search_path = public as $$
declare v_stock_actuel integer; v_nouveau_stock integer;
begin
    select quantite_stock into v_stock_actuel from pieces where id = p_piece_id for update;
    if v_stock_actuel is null then raise exception 'Piece introuvable'; end if;
    if p_quantite <= 0 then raise exception 'Quantite invalide'; end if;
    if p_type = 'ENTREE' then v_nouveau_stock := v_stock_actuel + p_quantite;
    elsif p_type = 'SORTIE' then
        if v_stock_actuel < p_quantite then raise exception 'Stock insuffisant'; end if;
        v_nouveau_stock := v_stock_actuel - p_quantite;
    elsif p_type = 'AJUSTEMENT' then v_nouveau_stock := p_quantite;
    else raise exception 'Type de mouvement invalide'; end if;
    update pieces set quantite_stock = v_nouveau_stock, updated_at = now() where id = p_piece_id;
    insert into mouvements_stock(piece_id,type_mouvement,quantite,quantite_avant,quantite_apres,motif)
    values(p_piece_id,p_type,case when p_type='AJUSTEMENT' then greatest(abs(v_nouveau_stock-v_stock_actuel),1) else p_quantite end,v_stock_actuel,v_nouveau_stock,p_motif);
end;
$$;

create or replace function valider_facture(p_facture_id bigint, p_mode_paiement varchar)
returns void language plpgsql security definer set search_path = public as $$
declare v_annee integer := extract(year from now()); v_numero integer; v_ligne record; v_stock integer;
begin
    if not exists(select 1 from factures where id=p_facture_id and statut='BROUILLON') then raise exception 'Facture introuvable ou deja traitee'; end if;
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
    update factures set statut='VALIDEE',numero_facture='FA-'||v_annee||'-'||lpad(v_numero::text,4,'0'),mode_paiement=p_mode_paiement,validated_at=now() where id=p_facture_id;
end;
$$;

alter table pieces enable row level security;
alter table mouvements_stock enable row level security;
alter table clients enable row level security;
alter table factures enable row level security;
alter table factures_lignes enable row level security;
alter table compteur_factures enable row level security;

do $$ declare t text; begin foreach t in array array['pieces','mouvements_stock','clients','factures','factures_lignes','compteur_factures'] loop execute format('drop policy if exists "auth full access" on %I',t); end loop; end $$;
create policy "auth full access" on pieces for all to authenticated using(true) with check(true);
create policy "auth full access" on mouvements_stock for all to authenticated using(true) with check(true);
create policy "auth full access" on clients for all to authenticated using(true) with check(true);
create policy "auth full access" on factures for all to authenticated using(true) with check(true);
create policy "auth full access" on factures_lignes for all to authenticated using(true) with check(true);
create policy "auth full access" on compteur_factures for all to authenticated using(true) with check(true);
