-- CE13 — Raykler controla los Umbrales de combustible (gate + auditoría + restaurar)
-- ---------------------------------------------------------------------------------
-- El RPC set_flota_config ya aceptaba is_admin()/tiene_modulo('flota') y logística SÍ
-- tiene el módulo flota → Raykler podía guardar por RPC; lo que lo bloqueaba era la UI
-- (botón "Umbrales" gated a esAdmin()).  Aquí: alineamos el gate del servidor a
-- is_admin()/es_flota_elevado() (regla 14, mismo predicado que recalcular/sanear),
-- auditamos cada cambio (antes→después, quién, versión) y añadimos "Restaurar versión"
-- + aviso a Tecnología.  La UI se abre a esFlotaElevado() en el front.
-- ---------------------------------------------------------------------------------

-- ── (1) Historial de umbrales (una fila por clave cambiada; lote = una versión) ───
create table if not exists sgc.flota_config_historial (
  id            uuid primary key default gen_random_uuid(),
  lote          uuid not null,
  clave         text not null,
  valor_anterior numeric,
  valor_nuevo   numeric,
  cambiado_por  uuid references sgc.usuarios(id),
  cambiado_at   timestamptz not null default now(),
  motivo        text
);
create index if not exists idx_flota_config_hist_lote on sgc.flota_config_historial(lote);
create index if not exists idx_flota_config_hist_at on sgc.flota_config_historial(cambiado_at desc);
alter table sgc.flota_config_historial enable row level security;
drop policy if exists flota_config_hist_sel on sgc.flota_config_historial;
create policy flota_config_hist_sel on sgc.flota_config_historial
  for select to authenticated using (sgc.is_admin() or sgc.es_flota_elevado());
grant select on sgc.flota_config_historial to authenticated;

-- ── (2) guardar_flota_config: batch con una versión + un aviso a Tecnología ───────
create or replace function sgc.guardar_flota_config(p_cambios jsonb)
returns integer
language plpgsql security definer
set search_path to 'sgc','pg_temp'
as $function$
declare
  v_lote uuid := gen_random_uuid();
  v_k text; v_v numeric; v_old numeric; v_n int := 0;
  v_actor text;
begin
  if not (sgc.is_admin() or sgc.es_flota_elevado()) then
    raise exception 'Tu rol no puede cambiar los umbrales de combustible' using errcode = '42501';
  end if;
  for v_k, v_v in select key, value::numeric from jsonb_each_text(coalesce(p_cambios,'{}'::jsonb)) loop
    select valor into v_old from sgc.flota_config where clave = v_k;
    if v_old is distinct from v_v then
      insert into sgc.flota_config_historial (lote, clave, valor_anterior, valor_nuevo, cambiado_por)
      values (v_lote, v_k, v_old, v_v, auth.uid());
      insert into sgc.flota_config (clave, valor) values (v_k, v_v)
        on conflict (clave) do update set valor = excluded.valor;
      v_n := v_n + 1;
    end if;
  end loop;
  if v_n > 0 then
    select nombre into v_actor from sgc.usuarios where id = auth.uid();
    begin
      perform sgc.notificar_modulo('tecnologia', 'flota_umbral_cambio',
        'Umbrales de combustible cambiados',
        coalesce(v_actor,'Alguien') || ' cambió ' || v_n || ' umbral(es) de rendimiento de combustible.',
        '/flota/combustible');
    exception when others then null; -- el aviso nunca bloquea el guardado
    end;
  end if;
  return v_n;
end;
$function$;
grant execute on function sgc.guardar_flota_config(jsonb) to authenticated;

-- ── (3) set_flota_config: gate alineado + auditado (wrapper del batch) ────────────
-- Mantiene la firma para el editor de Parámetros (ediciones de una sola clave).
create or replace function sgc.set_flota_config(p_clave text, p_valor numeric)
returns void
language plpgsql security definer
set search_path to 'sgc','pg_temp'
as $function$
begin
  perform sgc.guardar_flota_config(jsonb_build_object(p_clave, p_valor));
end;
$function$;
grant execute on function sgc.set_flota_config(text, numeric) to authenticated;

-- ── (4) restaurar_flota_config: deshace una versión (deja rastro de la restauración)
create or replace function sgc.restaurar_flota_config(p_lote uuid)
returns integer
language plpgsql security definer
set search_path to 'sgc','pg_temp'
as $function$
declare
  v_new uuid := gen_random_uuid();
  v_r record; v_cur numeric; v_n int := 0; v_actor text;
begin
  if not (sgc.is_admin() or sgc.es_flota_elevado()) then
    raise exception 'Tu rol no puede restaurar los umbrales de combustible' using errcode = '42501';
  end if;
  for v_r in select clave, valor_anterior from sgc.flota_config_historial where lote = p_lote loop
    select valor into v_cur from sgc.flota_config where clave = v_r.clave;
    if v_cur is distinct from v_r.valor_anterior then
      update sgc.flota_config set valor = v_r.valor_anterior where clave = v_r.clave;
      insert into sgc.flota_config_historial (lote, clave, valor_anterior, valor_nuevo, cambiado_por, motivo)
      values (v_new, v_r.clave, v_cur, v_r.valor_anterior, auth.uid(), 'Restaurada versión ' || p_lote);
      v_n := v_n + 1;
    end if;
  end loop;
  if v_n > 0 then
    select nombre into v_actor from sgc.usuarios where id = auth.uid();
    begin
      perform sgc.notificar_modulo('tecnologia', 'flota_umbral_cambio',
        'Umbrales de combustible restaurados',
        coalesce(v_actor,'Alguien') || ' restauró ' || v_n || ' umbral(es) a una versión anterior.',
        '/flota/combustible');
    exception when others then null;
    end;
  end if;
  return v_n;
end;
$function$;
grant execute on function sgc.restaurar_flota_config(uuid) to authenticated;

-- ── (5) flota_config_historial_listar: versiones recientes para la UI ─────────────
create or replace function sgc.flota_config_historial_listar(p_limit int default 30)
returns jsonb
language sql stable security definer
set search_path to 'sgc','pg_temp'
as $function$
  select coalesce(jsonb_agg(row_to_json(v) order by v.cambiado_at desc), '[]'::jsonb)
  from (
    select h.lote,
           max(h.cambiado_at) as cambiado_at,
           (select nombre from sgc.usuarios where id = (array_agg(h.cambiado_por))[1]) as cambiado_por_nombre,
           max(h.motivo) as motivo,
           jsonb_agg(jsonb_build_object('clave', h.clave, 'antes', h.valor_anterior, 'despues', h.valor_nuevo)
                     order by h.clave) as cambios
    from sgc.flota_config_historial h
    where sgc.is_admin() or sgc.es_flota_elevado()
    group by h.lote
    order by max(h.cambiado_at) desc
    limit greatest(p_limit, 1)
  ) v;
$function$;
grant execute on function sgc.flota_config_historial_listar(int) to authenticated;
