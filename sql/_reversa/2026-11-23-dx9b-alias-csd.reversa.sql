begin;
insert into sgc.cargo_alias (alias_normalizado, cargo_id)
select a.alias, c.id from (values ('VARILLERO', 'MAE'), ('MAESTRO', 'CARP'), ('CAPATAZ CSD', 'ING'), ('OBRERO', 'CARP')) as a(alias, codigo)
join sgc.cargos c on c.codigo = a.codigo
on conflict (alias_normalizado) do update set cargo_id = excluded.cargo_id;
delete from sgc.cargo_alias where cargo_id in (select id from sgc.cargos where codigo = 'CAPCSD');
delete from sgc.cargos where codigo = 'CAPCSD' and not exists (select 1 from sgc.personal_obra p where p.cargo_id = sgc.cargos.id);
commit;
