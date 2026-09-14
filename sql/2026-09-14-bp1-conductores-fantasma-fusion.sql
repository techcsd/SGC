-- ============================================================================
-- PROMPT-48 (BP) FASE 1 — BP1: reparar la ficha FANTASMA de conductor que el
-- trigger AI9 fabricó al darle acceso a Felix.  Ronda 14/09/2026.  Idempotente.
--
-- QUÉ PASÓ (diagnóstico verificado en prod, 14/09/2026).
--   `conductor-crear-acceso` (edge) asignaba el rol chofer_transportista ANTES de
--   enlazar `conductores.usuario_id`.  El rol dispara `trg_usuarios_roles_asegura_conductor`
--   (AI9) → `asegurar_conductor_de_usuario()`, que deriva la cédula del email
--   sintético en DÍGITOS ('22301629623') y busca `conductores.cedula = '22301629623'`
--   con comparación EXACTA.  La ficha real de Felix guarda la cédula CON guiones
--   ('223-0162962-3') → no hubo match → el trigger INSERTÓ un segundo conductor
--   (fantasma) con la cédula en dígitos y el usuario_id nuevo.  Cuando la edge
--   llegó a enlazar la ficha real, chocó con uq_conductores_usuario.
--
-- ESTADO EN PROD (verificado):
--   · Ficha REAL     22f40493-7c91-4411-91be-4a11711ad3c9  cedula '223-0162962-3'  usuario_id NULL
--   · Ficha FANTASMA 0dbc9b02-4974-403c-80ae-53f8d3db4321  cedula '22301629623'    usuario_id ace53024-…
--   · Usuario sintético ace53024-a089-4e40-98ce-9d29f0cb2886 (c-22301629623@…) con rol chofer.
--   · El FANTASMA tiene CERO hijos en las 13 tablas que referencian conductores
--     (registros_combustible, rutas, salidas_inventario, checklists_vehiculo,
--      vehiculo_asignaciones, avisos_flota, incentivo_participante_audit,
--      vehiculo_accidentes, conductor_multas, solicitudes_movimiento,
--      conduce_transferencias ×2, incentivo_semana) → borrado seguro (§F-1: caso limpio).
--   · Es el ÚNICO conductor duplicado por cédula normalizada en toda la BD.
--
-- REPARACIÓN.  Mover el usuario_id del fantasma a la ficha real y borrar el fantasma,
--   reutilizando el usuario sintético (ya tiene el rol chofer).  El bloque vuelve a
--   verificar ausencia de hijos antes de borrar (defensa: nunca borrar con data real).
--
-- Apply: node scripts/apply-migration.mjs sql/2026-09-14-bp1-conductores-fantasma-fusion.sql
-- ============================================================================
begin;

do $$
declare
  v_real     uuid := '22f40493-7c91-4411-91be-4a11711ad3c9';
  v_fantasma uuid := '0dbc9b02-4974-403c-80ae-53f8d3db4321';
  v_usuario  uuid;
  v_hijos    bigint;
begin
  select usuario_id into v_usuario from sgc.conductores where id = v_fantasma;

  -- Ya reparado (fantasma borrado) o estado inesperado → no-op idempotente.
  if v_usuario is null
     or not exists (select 1 from sgc.conductores where id = v_real and usuario_id is null) then
    raise notice 'BP1: nada que reparar (fantasma ausente o ficha real ya enlazada).';
    return;
  end if;

  -- Defensa: recontar hijos del fantasma antes de borrar. Si aparece cualquiera,
  -- ABORTAR y dejarlo para fusión manual (§F-1) — no perder data real de obra.
  select
    (select count(*) from sgc.registros_combustible      where conductor_id   = v_fantasma)
  + (select count(*) from sgc.rutas                       where conductor_id   = v_fantasma)
  + (select count(*) from sgc.salidas_inventario          where conductor_id   = v_fantasma)
  + (select count(*) from sgc.checklists_vehiculo         where conductor_id   = v_fantasma)
  + (select count(*) from sgc.vehiculo_asignaciones       where conductor_id   = v_fantasma)
  + (select count(*) from sgc.avisos_flota                where conductor_id   = v_fantasma)
  + (select count(*) from sgc.incentivo_participante_audit where conductor_id  = v_fantasma)
  + (select count(*) from sgc.vehiculo_accidentes         where conductor_id   = v_fantasma)
  + (select count(*) from sgc.conductor_multas            where conductor_id   = v_fantasma)
  + (select count(*) from sgc.solicitudes_movimiento      where conductor_id   = v_fantasma)
  + (select count(*) from sgc.conduce_transferencias      where de_conductor_id = v_fantasma)
  + (select count(*) from sgc.conduce_transferencias      where a_conductor_id  = v_fantasma)
  + (select count(*) from sgc.incentivo_semana            where conductor_id   = v_fantasma)
  into v_hijos;

  if v_hijos > 0 then
    raise exception 'BP1 ABORTA: el fantasma % tiene % hijos — requiere fusión manual (§F-1), no se borra.', v_fantasma, v_hijos;
  end if;

  -- 1) soltar el usuario del fantasma, 2) enlazarlo a la ficha real, 3) borrar el fantasma.
  update sgc.conductores set usuario_id = null where id = v_fantasma;
  update sgc.conductores set usuario_id = v_usuario, updated_at = now() where id = v_real;
  delete from sgc.conductores where id = v_fantasma;

  insert into sgc.audit_log (actor_id, action, target_user_id, metadata)
  values (null, 'conductor_fantasma_fusionado', v_usuario,
          jsonb_build_object(
            'real', v_real, 'fantasma', v_fantasma,
            'motivo', 'BP1: trigger AI9 duplicó la ficha por comparar cédula sin normalizar'));

  raise notice 'BP1: Felix reparado — usuario % movido a la ficha real %, fantasma % borrado.', v_usuario, v_real, v_fantasma;
end $$;

commit;
