-- CE5 — Verificación pública del carnet por QR + registro de reimpresión
-- ---------------------------------------------------------------------------------
-- El QR del carnet apunta a /verificar/<carnet>, una página PÚBLICA (sin login) que
-- solo muestra nombre, cargo, obra y estado — nada sensible (ni documento ni teléfono).
-- ---------------------------------------------------------------------------------

-- Página pública: mínimo imprescindible, callable por anon.
create or replace function sgc.verificar_carnet(p_carnet text)
returns jsonb
language sql stable security definer
set search_path to 'sgc','pg_temp'
as $function$
  select coalesce((
    select jsonb_build_object(
      'encontrado', true,
      'nombre', po.nombre || coalesce(' ' || po.apellido, ''),
      'cargo', (select c.nombre from sgc.cargos c where c.id = po.cargo_id),
      'obra', (select p.nombre from sgc.proyectos p where p.id = po.proyecto_id),
      'carnet', po.carnet_numero,
      'estado', case
         when po.eliminado_at is not null then 'inactivo'
         when coalesce(po.activo_en_obra, true) and po.estado = 'activo' then 'activo'
         else 'inactivo' end)
    from sgc.personal_obra po
    where po.carnet_numero = p_carnet and not coalesce(po.es_prueba, false)
    limit 1
  ), '{"encontrado": false}'::jsonb);
$function$;
grant execute on function sgc.verificar_carnet(text) to anon, authenticated;

-- Registro de reimpresión del carnet (rastro de quién lo reimprimió y cuándo).
create table if not exists sgc.carnet_reimpresiones (
  id            uuid primary key default gen_random_uuid(),
  personal_id   uuid not null references sgc.personal_obra(id),
  carnet_numero text,
  reimpreso_por uuid references sgc.usuarios(id),
  reimpreso_at  timestamptz not null default now()
);
create index if not exists idx_carnet_reimp_personal on sgc.carnet_reimpresiones(personal_id);
alter table sgc.carnet_reimpresiones enable row level security;
drop policy if exists carnet_reimp_sel on sgc.carnet_reimpresiones;
create policy carnet_reimp_sel on sgc.carnet_reimpresiones
  for select to authenticated using (sgc.puede_ver_personal_obra(
    (select proyecto_id from sgc.personal_obra where id = personal_id)));
grant select on sgc.carnet_reimpresiones to authenticated;

create or replace function sgc.registrar_reimpresion_carnet(p_id uuid)
returns void
language plpgsql security definer
set search_path to 'sgc','pg_temp'
as $function$
declare v_num text;
begin
  select carnet_numero into v_num from sgc.personal_obra where id = p_id;
  insert into sgc.carnet_reimpresiones (personal_id, carnet_numero, reimpreso_por)
  values (p_id, v_num, auth.uid());
end;
$function$;
grant execute on function sgc.registrar_reimpresion_carnet(uuid) to authenticated;
