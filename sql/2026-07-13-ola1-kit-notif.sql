set search_path = sgc, public;

-- (1) Mapear el kit a los artículos del catálogo (por nombre) para que la
-- reposición y el control antifraude vean los renglones del kit del cuadre.
alter table sgc.kit_inicio_plantilla add column if not exists articulo_id uuid references sgc.articulos(id);
update sgc.kit_inicio_plantilla k
   set articulo_id = a.id
  from sgc.articulos a
 where k.articulo_id is null and lower(a.nombre) = lower(k.referencia);

-- copiar_kit_a_cuadre ahora copia también el articulo_id del kit.
create or replace function sgc.copiar_kit_a_cuadre(p_proyecto_id uuid, p_bodega_id uuid)
returns int language plpgsql security definer set search_path to 'sgc','pg_temp' as $$
declare v_ins int := 0;
begin
  if auth.uid() is null then raise exception 'No autenticado'; end if;
  if not (sgc.is_admin() or sgc.tiene_modulo('proyectos')) then raise exception 'No autorizado'; end if;

  insert into sgc.cuadre_obra (proyecto_id, bodega_id)
  values (p_proyecto_id, p_bodega_id)
  on conflict (proyecto_id) do update set bodega_id = coalesce(excluded.bodega_id, sgc.cuadre_obra.bodega_id), updated_at = now();

  if not exists (select 1 from sgc.cuadre_items where proyecto_id = p_proyecto_id and es_kit) then
    insert into sgc.cuadre_items
      (proyecto_id, articulo_id, descripcion, unidad, categoria, es_kit, prorrateado, es_min_stock,
       cantidad_total, est_f1, est_f2, est_f3, est_f4, orden)
    select p_proyecto_id, k.articulo_id, k.referencia, k.unidad, k.categoria, true, k.prorrateado, k.es_min_stock,
           k.cantidad, k.cantidad, 0, 0, 0, k.orden
    from sgc.kit_inicio_plantilla k where k.activo
    order by k.categoria, k.orden;
    get diagnostics v_ins = row_count;
  end if;
  return v_ins;
end;
$$;
grant execute on function sgc.copiar_kit_a_cuadre(uuid, uuid) to authenticated, service_role;

-- (2) Centro de notificaciones (por usuario, persistente).
create table if not exists sgc.notificaciones (
  id         uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references sgc.usuarios(id) on delete cascade,
  tipo       text not null default 'info',
  titulo     text not null,
  mensaje    text,
  ruta       text,
  leida      boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists idx_notif_usuario on sgc.notificaciones(usuario_id, leida, created_at desc);

alter table sgc.notificaciones enable row level security;
drop policy if exists notif_sel on sgc.notificaciones;
create policy notif_sel on sgc.notificaciones for select to authenticated using (usuario_id = auth.uid());
drop policy if exists notif_upd on sgc.notificaciones;  -- marcar leída
create policy notif_upd on sgc.notificaciones for update to authenticated using (usuario_id = auth.uid()) with check (usuario_id = auth.uid());
grant select, update on sgc.notificaciones to authenticated;
grant all on sgc.notificaciones to service_role;

create or replace function sgc.notificar(p_usuario uuid, p_tipo text, p_titulo text, p_mensaje text, p_ruta text)
returns void language sql security definer set search_path to 'sgc','pg_temp' as $$
  insert into sgc.notificaciones (usuario_id, tipo, titulo, mensaje, ruta)
  select p_usuario, coalesce(p_tipo,'info'), p_titulo, p_mensaje, p_ruta where p_usuario is not null;
$$;
grant execute on function sgc.notificar(uuid, text, text, text, text) to authenticated, service_role;

-- Avisar al solicitante cuando su requisición cambia de estado (aprobada/entregada/cerrada/rechazada).
create or replace function sgc.trg_notif_requisicion() returns trigger language plpgsql
security definer set search_path to 'sgc','pg_temp' as $$
begin
  if NEW.estado is distinct from OLD.estado and NEW.estado in ('aprobada','entregada','cerrada','rechazada') then
    perform sgc.notificar(
      NEW.solicitante_id,
      case when NEW.estado='rechazada' then 'warning' else 'success' end,
      'Requisición ' || NEW.estado,
      'Tu requisición cambió a "' || NEW.estado || '".',
      '/bitacora/solicitudes-material'
    );
  end if;
  return NEW;
end;
$$;
drop trigger if exists trg_requisicion_notif on sgc.solicitudes_material;
create trigger trg_requisicion_notif after update on sgc.solicitudes_material
  for each row execute function sgc.trg_notif_requisicion();

do $$ begin alter publication supabase_realtime add table sgc.notificaciones; exception when duplicate_object then null; end $$;
