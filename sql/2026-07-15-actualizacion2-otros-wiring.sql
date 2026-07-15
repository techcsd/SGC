-- ============================================================================
-- Actualización 2 — U25 (cont.): cablear "Otro/s" + generar avisos.
-- La FASE 1 creó la tabla otros_valores, registrar_otro_valor() y la vista
-- v_otros_valores_frecuentes, pero NADIE registraba valores y NO se generaban
-- avisos. Esto lo completa, aditivo/retrocompatible:
--   1. Trigger que registra el texto libre de "Otro" en bitácora (restricciones).
--   2. Tabla de dedup + función idempotente que genera avisos (notificaciones)
--      cuando un valor "Otro" supera el umbral configurado.
-- Cubre web y móvil porque el registro es por trigger de BD (no depende del front).
-- ============================================================================
set search_path = sgc, public;

-- ── 1. Registro automático de "Otro" en bitácora (context 'bitacora.restriccion') ──
-- Cuando una restricción es del tipo OTRO y trae texto libre, se registra para
-- la inteligencia de valores frecuentes. Los demás tipos NO se registran (no son
-- texto libre "Otro"). SECURITY DEFINER: corre con privilegios del dueño; auth.uid()
-- sigue siendo el usuario del JWT (lo usa registrar_otro_valor).
create or replace function sgc.trg_registrar_otro_restriccion()
returns trigger language plpgsql security definer set search_path to 'sgc','pg_temp' as $$
begin
  if upper(coalesce(new.tipo_restriccion,'')) = 'OTRO'
     and coalesce(trim(new.descripcion_otro),'') <> '' then
    perform sgc.registrar_otro_valor('bitacora.restriccion', new.descripcion_otro, new.bitacora_id);
  end if;
  return new;
end $$;

drop trigger if exists trg_otro_restriccion on sgc.bitacora_restricciones;
create trigger trg_otro_restriccion
  after insert on sgc.bitacora_restricciones
  for each row execute function sgc.trg_registrar_otro_restriccion();

-- ── 2. Avisos idempotentes de valores "Otro" frecuentes ─────────────────────
-- Tabla de dedup: una fila por (contexto, valor_normalizado) ya avisado. Se
-- re-avisa solo si pasó la ventana configurada desde el último aviso.
create table if not exists sgc.otros_avisos (
  contexto          text not null,
  valor_normalizado text not null,
  notificado_at     timestamptz not null default now(),
  primary key (contexto, valor_normalizado)
);
alter table sgc.otros_avisos enable row level security;
drop policy if exists otros_avisos_sel on sgc.otros_avisos;
create policy otros_avisos_sel on sgc.otros_avisos for select to authenticated
  using (sgc.is_admin() or sgc.tiene_modulo('tecnologia') or sgc.tiene_modulo('direccion'));
grant select on sgc.otros_avisos to authenticated;
grant all on sgc.otros_avisos to service_role;

-- Función idempotente: genera una notificación por cada valor "Otro" que supera
-- el umbral y que no se haya avisado dentro de la ventana. Notifica (sin duplicar
-- por usuario) a admin + tecnología + dirección. Devuelve cuántos avisos nuevos creó.
create or replace function sgc.evaluar_avisos_otros()
returns integer language plpgsql security definer set search_path to 'sgc','pg_temp' as $$
declare
  v_dias  int := coalesce((select valor from sgc.flota_config where clave='otros_umbral_dias'), 30);
  v_nuevos int := 0;
  r record;
begin
  for r in
    select f.contexto, f.valor_normalizado, f.ejemplo, f.repeticiones
    from sgc.v_otros_valores_frecuentes f
    where f.supera_umbral
      and not exists (
        select 1 from sgc.otros_avisos a
        where a.contexto = f.contexto and a.valor_normalizado = f.valor_normalizado
          and a.notificado_at >= now() - make_interval(days => v_dias)
      )
  loop
    insert into sgc.notificaciones (usuario_id, tipo, titulo, mensaje, ruta)
    select distinct u.id, 'otros_valor',
           'Sugerencia: crear opción oficial',
           format('«%s» se escribió %s veces en "Otro" (%s). Considera crear una opción oficial.',
                  r.ejemplo, r.repeticiones, r.contexto),
           '/admin/otros-valores'
    from sgc.usuarios u
    join sgc.usuarios_roles ur on ur.usuario_id = u.id
    join sgc.roles rr on rr.id = ur.rol_id
    where u.activo
      and ('admin' = any(rr.modulos) or 'tecnologia' = any(rr.modulos) or 'direccion' = any(rr.modulos));

    insert into sgc.otros_avisos (contexto, valor_normalizado, notificado_at)
    values (r.contexto, r.valor_normalizado, now())
    on conflict (contexto, valor_normalizado)
      do update set notificado_at = now();

    v_nuevos := v_nuevos + 1;
  end loop;
  return v_nuevos;
end $$;
grant execute on function sgc.evaluar_avisos_otros() to authenticated, service_role;
