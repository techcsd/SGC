-- BO8 (§E-7, mes) — Aviso al VENCER la fecha de necesidad de una requisición.
-- Nota #7: "…Raykler must be able to see and organize or view a calendar…". La rejilla
-- mensual es front. Aquí: cuando fecha_necesidad < hoy y la requisición sigue abierta,
-- se avisa UNA vez al solicitante y a logística (por destinatarios_notificacion) y se
-- marca aviso_vencida_at para no repetir.

begin;

alter table sgc.solicitudes_material
  add column if not exists aviso_vencida_at timestamptz;

insert into sgc.notif_tipo (tipo, etiqueta, descripcion, es_operativa, canales, activo, orden)
values ('requisicion_vencida', 'Requisición vencida', 'Una requisición pasó su fecha de necesidad sin cerrarse/despacharse.', false, array['in_app','push'], true, 64)
on conflict (tipo) do nothing;

create or replace function sgc.requisiciones_vencidas_avisar()
returns integer
language plpgsql
security definer
set search_path to 'sgc','pg_temp'
as $function$
declare
  v_rec record;
  v_n int := 0;
  v_codigo text;
begin
  for v_rec in
    select id, folio, solicitante_id, proyecto_id, fecha_necesidad
      from sgc.solicitudes_material
     where fecha_necesidad is not null
       and fecha_necesidad < current_date
       and coalesce(estado,'pendiente') in ('pendiente','aprobada','por_despachar','parcial')
       and aviso_vencida_at is null
       and not coalesce(es_prueba, false)
  loop
    v_codigo := coalesce('REQ-' || lpad(v_rec.folio::text, 6, '0'), 'Una requisición');
    -- Al solicitante.
    if v_rec.solicitante_id is not null then
      perform sgc.notificar_usuarios(array[v_rec.solicitante_id], 'requisicion_vencida',
        'Requisición vencida',
        format('%s pasó su fecha de necesidad (%s) y sigue abierta.', v_codigo, to_char(v_rec.fecha_necesidad,'DD/MM/YYYY')),
        '/inventario/requisiciones', v_rec.id, 'requisicion');
    end if;
    -- A logística/inventario.
    perform sgc.notificar_modulo('inventario', 'requisicion_vencida',
      'Requisición vencida',
      format('%s pasó su fecha de necesidad (%s) y sigue abierta.', v_codigo, to_char(v_rec.fecha_necesidad,'DD/MM/YYYY')),
      '/inventario/requisiciones', v_rec.id, 'requisicion');

    update sgc.solicitudes_material set aviso_vencida_at = now() where id = v_rec.id;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $function$;

commit;

-- Cron diario 07:15 RD = 11:15 UTC. Idempotente. (regla 11 + docs/CRONS.md)
select cron.unschedule('sgc-requisiciones-vencidas')
 where exists (select 1 from cron.job where jobname = 'sgc-requisiciones-vencidas');
select cron.schedule('sgc-requisiciones-vencidas', '15 11 * * *', $$select sgc.requisiciones_vencidas_avisar()$$);
