-- 2026-11-22 -- PROMPT-151 DU: modo degradado automatico al emitir conduces cuando Odoo no responde.
-- Antes (1.219.0): Odoo caido => no se puede emitir conduces en almacenes con fuente Odoo (salvo contingencia/interruptor).
-- Ahora: si Odoo NO responde (no si falta stock) Y el ultimo sondeo bueno tiene <= N horas (default 2), se emite validando
-- contra el ultimo stock conocido de SGC, con aviso, y queda registrado en odoo_conduces_degradados. El outbox publica
-- despues; si ahi falta stock, ya existe el error con detalle + reintento por lote en Tecnologia > Sincronizacion.
-- Apagar: odoo_conduce_degradado_auto = 'false'. Aditiva.
begin;
set local lock_timeout = '3s';

insert into sgc.parametros (clave, valor, descripcion) values
  ('odoo_conduce_degradado_auto', 'true', 'DU: true = si Odoo no responde, emitir conduces validando contra el ultimo stock conocido de SGC (con aviso y registro).'),
  ('odoo_conduce_degradado_max_horas', '2', 'DU: horas maximas desde el ultimo sondeo bueno de Odoo para permitir el modo degradado.')
on conflict (clave) do nothing;

create table if not exists sgc.odoo_conduces_degradados (
  salida_id uuid primary key references sgc.salidas_inventario(id) on delete cascade,
  bodega_id uuid references sgc.bodegas(id),
  horas_sin_sondeo numeric,
  creado_en timestamptz not null default now()
);
alter table sgc.odoo_conduces_degradados enable row level security;
drop policy if exists odoo_conduces_degradados_sel on sgc.odoo_conduces_degradados;
create policy odoo_conduces_degradados_sel on sgc.odoo_conduces_degradados for select to authenticated using (sgc.es_tecnologia());
grant select on sgc.odoo_conduces_degradados to authenticated;
grant all on sgc.odoo_conduces_degradados to service_role;

-- ¿Se permite el modo degradado ahora? (lo usa la edge para decidir y la pantalla para no bloquear).
create or replace function sgc.odoo_degradado_permitido()
returns jsonb
language plpgsql stable security definer set search_path = sgc, pg_temp as $fn$
declare v_activo boolean; v_max numeric; v_ultimo timestamptz; v_horas numeric;
begin
  select coalesce(lower(valor) in ('true','t','1'), false) into v_activo from sgc.parametros where clave = 'odoo_conduce_degradado_auto';
  select coalesce(nullif(valor,'')::numeric, 2) into v_max from sgc.parametros where clave = 'odoo_conduce_degradado_max_horas';
  v_max := coalesce(v_max, 2);
  select max(c.iniciada_en) into v_ultimo
    from sgc.odoo_conciliacion_corridas c
    join sgc.odoo_instancias i on i.id = c.odoo_instancia_id and i.habilitada
   where c.tipo = 'sondeo' and c.error is null;
  v_horas := case when v_ultimo is null then null else round(extract(epoch from (now() - v_ultimo)) / 3600.0, 2) end;
  return jsonb_build_object('permitido', coalesce(v_activo, false) and v_horas is not null and v_horas <= v_max,
                            'activo', coalesce(v_activo, false), 'horas_sin_sondeo_ok', v_horas, 'max_horas', v_max);
end $fn$;
revoke all on function sgc.odoo_degradado_permitido() from public, anon;
grant execute on function sgc.odoo_degradado_permitido() to authenticated, service_role;

-- Registra un conduce emitido en modo degradado y avisa a Tecnologia (max 1 aviso por hora).
create or replace function sgc.odoo_degradado_registrar(p_salida uuid, p_bodega uuid)
returns void
language plpgsql security definer set search_path = sgc, pg_temp as $fn$
declare v_horas numeric; v_n int;
begin
  v_horas := (sgc.odoo_degradado_permitido() ->> 'horas_sin_sondeo_ok')::numeric;
  insert into sgc.odoo_conduces_degradados (salida_id, bodega_id, horas_sin_sondeo) values (p_salida, p_bodega, v_horas)
    on conflict (salida_id) do nothing;
  select count(*) into v_n from sgc.odoo_conduces_degradados where creado_en > now() - interval '24 hours';
  if not exists (select 1 from sgc.notificaciones where tipo = 'alerta' and titulo = 'Conduces emitidos con Odoo caído' and created_at > now() - interval '1 hour') then
    perform sgc.odoo_notificar_tecnologia('Conduces emitidos con Odoo caído',
      v_n || ' conduce(s) en las últimas 24 h se validaron con el último stock conocido porque Odoo no respondía. Revisa Sincronización cuando Odoo vuelva.',
      '/tecnologia/odoo-sync');
  end if;
end $fn$;
revoke all on function sgc.odoo_degradado_registrar(uuid, uuid) from public, anon, authenticated;
grant execute on function sgc.odoo_degradado_registrar(uuid, uuid) to service_role;

commit;
