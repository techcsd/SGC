-- DY2 (23-nov-2026) -- corrige DY: el predicado nuevo `puede_leer_combustible_global()` era REDUNDANTE.
-- Al probarlo en dev apareció que `registros_combustible` YA tiene la política de lectura granular
-- "submod ver: flota.combustible" (ds46/AG12, `submodulo_nivel_explicito('flota.combustible') in ('ver','operar')`).
-- La causa real de "0 registros" para Corianny/Yonairy era solo que sus roles NO tenían el permiso
-- granular explícito. Con el permiso concedido en DY (UPDATE sgc.roles) alcanza; mantener un segundo
-- predicado rompe la regla 14 (un solo predicado). Se restaura `puede_ver_echada` al de CA2 y se
-- elimina el helper. El permiso concedido a jefe_rrhh y asistente_administrativa se conserva.
begin;
set local lock_timeout = '3s';

create or replace function sgc.puede_ver_echada(p_registrado_por uuid, p_conductor_id uuid)
returns boolean
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select sgc.es_flota_elevado() or sgc.is_admin()
      or p_registrado_por = auth.uid()
      or (p_conductor_id in (select sgc.mis_conductor_ids()));
$$;

drop function if exists sgc.puede_leer_combustible_global();

commit;
