-- ============================================================================
-- PROMPT-48 (BP) FASE 1 — BP1: que `asegurar_conductor_de_usuario` compare la
-- cédula NORMALIZADA y NO fabrique fichas fantasma.  Ronda 14/09/2026.  Idempotente.
--
-- CAUSA (ver 2026-09-14-bp1-conductores-fantasma-fusion.sql).  La función deriva la
-- cédula del email sintético en DÍGITOS y la compara EXACTA contra `conductores.cedula`,
-- que puede estar CON guiones → no hace match → fabrica un duplicado.
--
-- CAMBIOS sobre la versión VIVA en prod (copiada verbatim vía pg_get_functiondef,
-- NO de ai9 por si hubo cambios posteriores como el guard BI6):
--   1) Camino feliz: `regexp_replace(cedula,'\D','','g') = v_cedula and usuario_id is null`.
--   2) Guard "cédula de otro usuario": compara normalizando y falla con errcode de
--      NEGOCIO 22023 (no 23505 de infraestructura, regla 9) + detail json.
--   3) El placeholder NO se fabrica para emails SINTÉTICOS: un c-<ced>@… SIEMPRE nace de
--      `conductor-crear-acceso` sobre una ficha existente; si no matcheó, es un descuadre
--      de datos, no un alta nueva → fallar claro en vez de duplicar (ESE era el bug BP1).
--      El SIN-CED- queda solo para usuarios con email REAL que reciben el rol chofer.
--
-- ── REGLA 11 — declarar el índice que sostiene todo esto (no estaba versionado en sql/):
--      create unique index uq_conductores_usuario on sgc.conductores (usuario_id)
--        where usuario_id is not null;   (verificado en prod, pg_indexes)
--
-- ── REGLA 13 — INVENTARIO DE ESCRITORES de `conductores.usuario_id` (todo escritor nuevo
--      se registra aquí; un trigger que escribe es un escritor más):
--        · edge  `conductor-crear-acceso/index.ts`  (enlaza tras crear el acceso)
--        · trigger AI9 `trg_usuarios_roles_asegura_conductor` → esta función (AFTER INSERT en usuarios_roles)
--        · `sql/2026-07-28-z2-z3-conductor-fixes.sql:53` (enlace legacy)
--        · `asegurar_mi_conductor()` (RPC que la app llama al iniciar el chofer)
--      El ORDEN de los pasos de la edge es parte del contrato: enlaza ANTES de asignar el rol.
--
-- Apply: node scripts/apply-migration.mjs sql/2026-09-14-bp1-asegurar-conductor-normalizado.sql
-- ============================================================================
begin;

-- Regla 11 — el índice único, declarado (idempotente).
create unique index if not exists uq_conductores_usuario
  on sgc.conductores (usuario_id) where usuario_id is not null;

create or replace function sgc.asegurar_conductor_de_usuario(p_usuario_id uuid)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_cid uuid; v_nombre text; v_email text; v_cedula text;
  v_es_sintetico boolean := false;
begin
  if p_usuario_id is null then return null; end if;

  -- ¿Ya tiene ficha por usuario_id? (camino que corta el duplicado: si la edge
  -- enlazó ANTES de asignar el rol, aquí retornamos y no fabricamos nada.)
  select id into v_cid from sgc.conductores
    where usuario_id = p_usuario_id
    order by activo desc, created_at asc limit 1;
  if v_cid is not null then return v_cid; end if;

  if not exists (
        select 1 from sgc.usuarios_roles ur join sgc.roles r on r.id = ur.rol_id
        where ur.usuario_id = p_usuario_id and r.codigo = 'chofer_transportista')
     and not exists (select 1 from sgc.vehiculo_usos vu where vu.usuario_id = p_usuario_id)
  then
    return null;
  end if;

  select nombre into v_nombre from sgc.usuarios where id = p_usuario_id;
  select email  into v_email  from auth.users where id = p_usuario_id;
  if v_email ~ '^c-[0-9]+@conductores\.constructorasd\.local$' then
    v_cedula := split_part(substring(v_email from 3), '@', 1);   -- dígitos
    v_es_sintetico := true;
  end if;

  if v_cedula is not null then
    -- Camino feliz — ficha existente sin usuario, comparando NORMALIZADO.
    select id into v_cid from sgc.conductores
      where regexp_replace(cedula, '\D', '', 'g') = v_cedula and usuario_id is null
      limit 1;
    if v_cid is not null then
      update sgc.conductores set usuario_id = p_usuario_id, updated_at = now() where id = v_cid;
      return v_cid;
    end if;

    -- La cédula (normalizada) ya pertenece a OTRO usuario → NO fabricar duplicado.
    -- Rechazo de NEGOCIO (22023, regla 9), no unique_violation de infraestructura.
    if exists (select 1 from sgc.conductores
               where regexp_replace(cedula, '\D', '', 'g') = v_cedula
                 and usuario_id is not null and usuario_id <> p_usuario_id) then
      raise exception 'La cédula % ya pertenece a otro conductor. Usa la fusión de usuarios (Administración) en vez de crear otra ficha.', v_cedula
        using errcode = '22023',
              detail  = json_build_object('campo','cedula','motivo','vinculada_a_otro_usuario')::text;
    end if;
  end if;

  -- Email SINTÉTICO sin match: es un descuadre de datos (la ficha debería existir),
  -- NO un alta nueva → fallar claro. Fabricar aquí es exactamente el bug BP1.
  if v_es_sintetico then
    raise exception 'No se encontró la ficha del conductor para el acceso %; revisa duplicados o la cédula de la ficha.', v_email
      using errcode = '22023',
            detail  = json_build_object('campo','cedula','motivo','ficha_no_encontrada')::text;
  end if;

  -- Solo llega aquí un usuario con email REAL que recibió el rol chofer manualmente:
  -- sin cédula conocida, placeholder único.
  if v_cedula is null then
    v_cedula := 'SIN-CED-' || left(replace(p_usuario_id::text, '-', ''), 8);
  end if;

  insert into sgc.conductores (cedula, nombre, licencia_tipo, tipo_vehiculo_autorizado, activo, usuario_id)
  values (v_cedula, coalesce(nullif(v_nombre,''),'Conductor'), '01', 'Liviano', true, p_usuario_id)
  returning id into v_cid;
  return v_cid;
end;
$function$;

commit;
