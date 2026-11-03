import '../lib/load-env.mjs';
import { resolverEnv, dbQuery } from '../lib/entorno.mjs';

const env = await resolverEnv(process.argv.slice(2));

async function seccion(titulo, sql) {
  console.log(`\n=== ${titulo} ===`);
  try {
    console.log(JSON.stringify(await dbQuery(env, sql), null, 2));
  } catch (e) {
    console.log(`ERROR: ${e.message}`);
  }
}

await seccion('Conduces en tránsito por antigüedad', `
  select
    case
      when now() - transito_at <= interval '1 day' then '0-1d'
      when now() - transito_at <= interval '7 day' then '2-7d'
      else '>7d'
    end as rango,
    count(*) as cantidad
  from sgc.conduces
  where transito_at is not null and entregado_en is null
  group by 1 order by 1;
`);

await seccion('Última posición por vehículo (edad)', `
  select v.id, v.alias, v.placa,
    cup.registrado_en,
    extract(epoch from (now() - cup.registrado_en))/60 as minutos_desde
  from sgc.vehiculos v
  left join lateral (
    select * from sgc.chofer_ultima_posicion cup2
    where cup2.vehiculo_id = v.id
    order by registrado_en desc limit 1
  ) cup on true
  order by minutos_desde nulls last
  limit 30;
`);

await seccion('vehiculo_usos abiertos por antigüedad', `
  select vu.id, vu.vehiculo_id, v.alias, vu.iniciado_en,
    extract(epoch from (now() - vu.iniciado_en))/3600 as horas_abierto
  from sgc.vehiculo_usos vu
  join sgc.vehiculos v on v.id = vu.vehiculo_id
  where vu.finalizado_en is null
  order by horas_abierto desc
  limit 30;
`);

await seccion('Versión desplegada app_versiones (web, últimas 5)', `
  select plataforma, version, titulo, created_at
  from sgc.app_versiones
  where plataforma = 'web'
  order by created_at desc limit 5;
`);

await seccion('Migraciones ledger 2026-11-02', `
  select archivo, aplicado_en
  from sgc.migraciones_aplicadas
  where archivo like '2026-11-02%'
  order by aplicado_en;
`);

await seccion('Cron sgc-requisiciones-vencidas (pg_cron)', `
  select jobid, jobname, schedule, active
  from cron.job
  where jobname ilike '%requisiciones-vencidas%' or jobname ilike '%requisicion%vencid%';
`);

await seccion('Últimas corridas del cron requisiciones-vencidas', `
  select j.jobname, d.status, d.return_message, d.start_time, d.end_time
  from cron.job_run_details d
  join cron.job j on j.jobid = d.jobid
  where j.jobname ilike '%requisicion%vencid%'
  order by d.start_time desc
  limit 10;
`);

await seccion('Cola de envíos atascados desde 22-sep', `
  select id, tipo, estado, created_at, intentos, ultimo_error
  from sgc.notificaciones_outbox
  where estado not in ('enviado','descartado')
    and created_at < '2026-09-25'
  order by created_at
  limit 20;
`);

await seccion('Tablas existentes candidatas a outbox (por si el nombre difiere)', `
  select table_schema, table_name
  from information_schema.tables
  where table_schema = 'sgc' and table_name ilike '%outbox%' or table_name ilike '%envio%';
`);
