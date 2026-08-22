-- AU18 — Seguimiento: sacar los conductores de PRUEBA de las vistas de operación real.
--
-- Hallazgo (ronda AU): en la lista de "Choferes" de Seguimiento aparecía "Manolo"
-- (conductor es_prueba=true, sin actividad, sin ubicación) junto a los reales, e
-- inflaba el encabezado "7 choferes". NO es un duplicado real de "MANOLO DURAN"
-- (cédulas distintas): es una fuga de datos de prueba (familia AT14/AT26). Un
-- conductor de prueba en el mapa vivo confunde y, con el incentivo (AT1) en marcha,
-- ensucia los conteos.
--
-- Fix aditivo y retrocompatible: `choferes_estado` y `ultimas_posiciones` excluyen
-- a los conductores marcados `es_prueba`. La operación real nunca los ve; los flujos
-- de prueba siguen usando esos registros por otras vías. Solo recrea funciones.

-- ── choferes_estado: la lista del panel de Seguimiento ────────────────────────
create or replace function sgc.choferes_estado()
 returns table(usuario_id uuid, conductor_id uuid, nombre text, estado text, otros_texto text, almuerzo_inicio timestamptz, desde timestamptz, updated_at timestamptz)
 language sql
 stable security definer
 set search_path to 'sgc', 'pg_temp'
as $function$
  -- DISTINCT ON usuario_id: un chofer se lista UNA vez aunque existan filas
  -- de conductor duplicadas por usuario (se prefiere la más antigua).
  select q.usuario_id, q.conductor_id, q.nombre, q.estado,
         q.otros_texto, q.almuerzo_inicio, q.desde, q.updated_at
  from (
    select distinct on (c.usuario_id)
      c.usuario_id, c.id as conductor_id, c.nombre,
      coalesce(e.estado, 'inactivo') as estado, e.otros_texto, e.almuerzo_inicio,
      e.desde, e.updated_at
    from sgc.conductores c
    left join sgc.chofer_estado e on e.usuario_id = c.usuario_id
    where coalesce(c.activo, true)
      and not coalesce(c.es_prueba, false)   -- AU18: fuera los conductores de prueba
      -- AI12: únicamente usuarios con rol chofer_transportista (no todos los conductores).
      and exists (
        select 1 from sgc.usuarios_roles ur
        join sgc.roles r on r.id = ur.rol_id
        where ur.usuario_id = c.usuario_id and r.codigo = 'chofer_transportista'
      )
      and (sgc.es_flota_elevado() or c.usuario_id = auth.uid())
    order by c.usuario_id, c.created_at
  ) q
  order by q.nombre;
$function$;

-- ── ultimas_posiciones: los marcadores del mapa ──────────────────────────────
create or replace function sgc.ultimas_posiciones()
 returns table(usuario_id uuid, nombre text, vehiculo_id uuid, placa text, marca text, modelo text, color text, lat numeric, lng numeric, precision_m numeric, bateria integer, capturado_en timestamptz)
 language sql
 stable security definer
 set search_path to 'sgc', 'pg_temp'
as $function$
  select cup.usuario_id, u.nombre, cup.vehiculo_id,
         v.placa, v.marca, v.modelo, v.color,
         cup.lat, cup.lng, cup.precision_m, cup.bateria, cup.capturado_en
    from sgc.chofer_ultima_posicion cup
    join sgc.usuarios u on u.id = cup.usuario_id
    left join sgc.vehiculos v on v.id = cup.vehiculo_id
   where sgc.comparte_ubicacion(cup.usuario_id)
     and (sgc.is_admin() or sgc.es_flota_elevado() or cup.usuario_id = auth.uid())
     -- AU18: no pintar el marcador de un usuario cuyo ÚNICO vínculo de conductor es
     -- de prueba (excluye al "Manolo" test sin ocultar a un usuario que además
     -- tenga un conductor real, ni a los sharers de oficina que no son conductores).
     and not (
       exists (select 1 from sgc.conductores c
                where c.usuario_id = cup.usuario_id and coalesce(c.es_prueba, false))
       and not exists (select 1 from sgc.conductores c
                        where c.usuario_id = cup.usuario_id and not coalesce(c.es_prueba, false))
     );
$function$;
