-- Reversa DX9: quita los 5 cargos nuevos (solo si nadie los usa) y devuelve AYUDANTE CSD a su alias anterior (Varillero).
begin;
delete from sgc.cargo_alias where cargo_id in (select id from sgc.cargos where codigo in ('AYUCSD','OBRCSD','AYUCARP','AYUVAR','AYUMAE'));
insert into sgc.cargo_alias (alias_normalizado, cargo_id) select 'AYUDANTE CSD', id from sgc.cargos where codigo = 'VAR' on conflict (alias_normalizado) do update set cargo_id = excluded.cargo_id;
delete from sgc.cargos where codigo in ('AYUCSD','OBRCSD','AYUCARP','AYUVAR','AYUMAE')
  and not exists (select 1 from sgc.personal_obra p where p.cargo_id = sgc.cargos.id);
commit;
