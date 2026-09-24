-- ============================================================================
-- BX1 — Rol "Developer" (codigo `desarrollador`). Xaviel: "lets create the role
-- 'Developer' in the system, and grant the relevants permitions and access to
-- certains modules."
--
--   · Módulo `tecnologia` COMPLETO (dev notes, errores de app, versiones + marcar
--     versión/mínima, Importar datos, Matriz de notificaciones — todo lo que da el
--     módulo tecnologia). Como TIENE el módulo, `es_tecnologia()` es verdadero.
--   · LECTURA (granular `ver`) de inventario, flota, compras, proyectos y bitácora
--     (supervisión) para reproducir/depurar SIN poder escribir datos de obra: los
--     RPC operativos gatean la ESCRITURA por módulo/`operar`, que este rol no tiene.
--   · `es_desarrollador()` INCLUYE `desarrollador`; NO entra en `is_admin()`.
--     Se unifica el predicado en una sola fuente `es_rol_desarrollador(uuid)` (antes
--     estaba copiado en 3 sitios: es_desarrollador, directorio_desarrolladores,
--     compartir_nota).
--   · `es_operativo = false` (recibe notificaciones de infraestructura vía el módulo
--     tecnologia; no es un rol de campo).
--
-- Xaviel asigna el rol a quien corresponda (👤). Aditivo/idempotente.
-- Apply: node scripts/apply-migration.mjs sql/2026-09-23-bx1-rol-desarrollador.sql --env dev  →  --env prod
-- Rollback: delete from sgc.roles where codigo='desarrollador'; y restaurar
--           es_desarrollador()/directorio_desarrolladores()/compartir_nota con la
--           lista literal ('admin','tecnologia','encargado_tecnologia').
-- ============================================================================
begin;

-- ── (0) Sincronizar la secuencia de roles.id (gotcha recurrente roles_id_seq) ─
-- El default es nextval('sgc.roles_id_seq') pero la secuencia NO está OWNED BY la
-- columna (clon por introspección), así que pg_get_serial_sequence la ignora y el
-- default puede quedar atrás y colisionar. Se sincroniza por nombre directo.
select setval('sgc.roles_id_seq', (select coalesce(max(id),1) from sgc.roles), true);

-- ── (1) El rol, con módulo tecnología + lectura granular de lo operativo ─────
insert into sgc.roles (codigo, nombre, modulos, permisos, es_operativo, descripcion)
select 'desarrollador', 'Developer', array['tecnologia'],
  jsonb_build_object(
    'inventario.entradas','ver','inventario.salidas','ver','inventario.articulos','ver','inventario.conteos','ver',
    'flota.vehiculos','ver','flota.conductores','ver','flota.combustible','ver','flota.mantenimientos','ver','flota.rutas','ver',
    'compras.proveedores','ver','compras.ordenes','ver','compras.solicitudes','ver',
    'proyectos.obras','ver','proyectos.cronograma','ver','proyectos.ranking','ver','proyectos.personal','ver',
    'bitacora.ver_todas','ver'
  ),
  false,
  'Desarrollador de software: acceso completo a Tecnología (dev notes, errores, versiones, importar datos) y LECTURA de los módulos operativos para reproducir y depurar. No escribe datos de obra ni administra usuarios/roles.'
where not exists (select 1 from sgc.roles where codigo = 'desarrollador');

-- Si ya existía (re-run), asegura módulos/permisos/flags al valor canónico.
update sgc.roles set
  nombre = 'Developer',
  modulos = array['tecnologia'],
  es_operativo = false,
  permisos = permisos || jsonb_build_object(
    'inventario.entradas','ver','inventario.salidas','ver','inventario.articulos','ver','inventario.conteos','ver',
    'flota.vehiculos','ver','flota.conductores','ver','flota.combustible','ver','flota.mantenimientos','ver','flota.rutas','ver',
    'compras.proveedores','ver','compras.ordenes','ver','compras.solicitudes','ver',
    'proyectos.obras','ver','proyectos.cronograma','ver','proyectos.ranking','ver','proyectos.personal','ver',
    'bitacora.ver_todas','ver')
where codigo = 'desarrollador';

-- ── (2) Predicado de desarrollador en UNA sola fuente ───────────────────────
create or replace function sgc.es_rol_desarrollador(p_uid uuid)
returns boolean language sql stable security definer set search_path to 'sgc','public'
as $function$
  select exists (
    select 1 from sgc.usuarios_roles ur
    join sgc.roles r on r.id = ur.rol_id
    where ur.usuario_id = p_uid
      and r.codigo in ('admin','tecnologia','encargado_tecnologia','desarrollador')
  );
$function$;
grant execute on function sgc.es_rol_desarrollador(uuid) to authenticated, service_role;

-- es_desarrollador() → la fuente única (incluye ya 'desarrollador').
create or replace function sgc.es_desarrollador()
returns boolean language sql stable security definer set search_path to 'sgc','public'
as $function$ select sgc.es_rol_desarrollador(auth.uid()); $function$;
grant execute on function sgc.es_desarrollador() to authenticated;

-- directorio_desarrolladores() → misma fuente (para el selector de compartir dev notes).
create or replace function sgc.directorio_desarrolladores()
returns table(id uuid, nombre text)
language sql stable security definer set search_path to 'sgc','pg_temp'
as $function$
  select u.id, u.nombre from sgc.usuarios u
  where coalesce(u.activo, true) and not coalesce(u.es_prueba, false)
    and sgc.es_rol_desarrollador(u.id)
  order by u.nombre;
$function$;
grant execute on function sgc.directorio_desarrolladores() to authenticated;

-- compartir_nota → el guard de dev notes usa la fuente única (una dev note solo se
-- comparte con desarrolladores). Resto idéntico a la copia viva (br-devnotes).
create or replace function sgc.compartir_nota(p_nota_id uuid, p_usuario_id uuid, p_permiso text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'sgc', 'pg_temp'
AS $function$
declare
  v_uid    uuid := auth.uid();
  v_titulo text;
  v_ambito text;
  v_owner  text;
  v_nuevo  boolean;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  if p_permiso not in ('ver','editar') then
    raise exception 'Permiso inválido (usa ver o editar).';
  end if;
  select n.titulo, n.ambito into v_titulo, v_ambito from sgc.notas n
   where n.id = p_nota_id and n.owner_id = v_uid;
  if not found then
    raise exception 'Sólo el dueño de la nota puede compartirla.' using errcode = 'P0001';
  end if;
  if p_usuario_id = v_uid then
    raise exception 'No puedes compartir la nota contigo mismo.';
  end if;
  -- BR/BX1 — dev notes solo con desarrolladores (fuente única).
  if v_ambito = 'dev' and not sgc.es_rol_desarrollador(p_usuario_id) then
    raise exception 'Las notas de desarrollo solo se comparten con Tecnología / desarrollo.' using errcode = 'P0001';
  end if;
  v_nuevo := not exists (
    select 1 from sgc.nota_compartidos where nota_id = p_nota_id and usuario_id = p_usuario_id);
  insert into sgc.nota_compartidos (nota_id, usuario_id, permiso)
  values (p_nota_id, p_usuario_id, p_permiso)
  on conflict (nota_id, usuario_id) do update set permiso = excluded.permiso;
  if v_nuevo then
    select u.nombre into v_owner from sgc.usuarios u where u.id = v_uid;
    insert into sgc.notificaciones (usuario_id, tipo, titulo, mensaje, ruta)
    values (
      p_usuario_id, 'nota_compartida', 'Te compartieron una nota',
      coalesce(v_owner,'Alguien') || ' compartió contigo la nota "' ||
        coalesce(nullif(v_titulo,''),'(sin título)') || '"' ||
        case when p_permiso = 'editar' then ' (puedes editar).' else ' (solo lectura).' end,
      '/notas/' || p_nota_id::text);
    begin
      perform sgc.send_push(
        array[p_usuario_id], 'Te compartieron una nota',
        coalesce(v_owner,'Alguien') || ': ' || coalesce(nullif(v_titulo,''),'(sin título)'),
        jsonb_build_object('ruta', '/notas/' || p_nota_id::text, 'tipo','nota_compartida'));
    exception when others then null;
    end;
  end if;
end;
$function$;

-- ── (3) Admin › Usuarios en LECTURA para el desarrollador ───────────────────
-- El directorio de usuarios (Admin) lo leen admin/tecnología; se añade el desarrollador.
-- (No puede crear/borrar usuarios ni cambiar roles: eso sigue exigiendo is_admin en sus RPC.)
do $$
begin
  if exists (select 1 from pg_policies where schemaname='sgc' and tablename='usuarios' and policyname='usuarios_select_admin_dev') then
    execute 'drop policy usuarios_select_admin_dev on sgc.usuarios';
  end if;
  execute $p$create policy usuarios_select_admin_dev on sgc.usuarios
    for select to authenticated using (sgc.es_desarrollador())$p$;
end $$;

commit;
