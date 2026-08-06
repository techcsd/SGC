-- AG11 — Tracking en tiempo real: higiene de rutas estancadas.
--
-- Diagnóstico (PROMPT-6 FASE 3): Seguimiento mostraba "N en ruta" pero todos los
-- choferes "Inactivo · sin ubicación". Causa raíz: había rutas en estado
-- 'en_curso' creadas ANTES del pipeline AF27/AF28 (2026-08-04) que nunca se
-- cerraron (algunas de semanas atrás). El contador "en ruta" sale de
-- rutas.estado='en_curso', pero chofer_estado/chofer_ultima_posicion estaban
-- vacíos (el pipeline nunca se había ejercido). Las rutas huérfanas mantenían el
-- contador encendido para siempre.
--
-- Este script: (1) barre las rutas estancadas actuales, y (2) instala un guard
-- recurrente para que ninguna ruta se quede 'en_curso' indefinidamente.
-- Aditivo y retrocompatible; no toca marcar_ruta_estado (el flujo normal sigue
-- igual). Cancelar NO dispara notificaciones (los triggers de notificación solo
-- reaccionan a INSERT o cambio de conductor_id) ni la sync de tareas (solo
-- reacciona a 'completada').

set search_path = sgc, public;

-- 1) Función de expiración: cancela rutas 'en_curso' más viejas que p_horas y, si
--    el chofer ya no tiene otra ruta en curso, lo devuelve a 'disponible'
--    (misma semántica que la rama cancelada de marcar_ruta_estado).
create or replace function sgc.expirar_rutas_estancadas(p_horas int default 18)
returns int
language plpgsql
security definer
set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_n int := 0;
  r record;
begin
  for r in
    select id, conductor_id
    from sgc.rutas
    where estado = 'en_curso'
      and coalesce(iniciada_at, created_at) < now() - make_interval(hours => p_horas)
    for update skip locked
  loop
    update sgc.rutas set estado = 'cancelada', updated_at = now() where id = r.id;
    v_n := v_n + 1;

    -- Devolver el chofer a 'disponible' si esta era su única ruta activa y estaba 'en_ruta'.
    if r.conductor_id is not null then
      perform 1 from sgc.rutas
        where conductor_id = r.conductor_id and estado = 'en_curso' and id <> r.id;
      if not found then
        perform sgc._set_chofer_estado(c.usuario_id, 'disponible', null, 'auto')
        from sgc.conductores c
        join sgc.chofer_estado e on e.usuario_id = c.usuario_id
        where c.id = r.conductor_id and e.estado = 'en_ruta';
      end if;
    end if;
  end loop;

  return v_n;
end;
$function$;

grant execute on function sgc.expirar_rutas_estancadas(int) to authenticated, service_role;

-- 2) Barrido inicial: limpia las rutas estancadas de HOY (umbral corto de 8 h para
--    capturar las 7 pre-AF28 sin tocar ninguna ruta legítimamente reciente).
select sgc.expirar_rutas_estancadas(8) as rutas_canceladas_en_barrido_inicial;

-- 3) Cron recurrente (pg_cron ya está instalado): cada 2 h expira lo que lleve
--    >18 h en curso (nadie conduce 18 h; un turno normal cabe de sobra).
select cron.unschedule('sgc-rutas-estancadas')
  where exists (select 1 from cron.job where jobname = 'sgc-rutas-estancadas');
select cron.schedule(
  'sgc-rutas-estancadas',
  '0 */2 * * *',
  $$select sgc.expirar_rutas_estancadas(18)$$
);
