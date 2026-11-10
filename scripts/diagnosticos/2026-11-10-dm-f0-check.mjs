// F0 de la ronda DM (PROMPT-140) — solo lectura, dev. Consultas del CONTEXTO §5
// (ajustadas a los nombres reales de columna, verificados contra information_schema).
import '../lib/load-env.mjs';
import { resolverEnv, dbQuery } from '../lib/entorno.mjs';

const env = await resolverEnv(process.argv.slice(2));

async function q(titulo, sql) {
  console.log(`\n== ${titulo} ==`);
  try {
    const rows = await dbQuery(env, sql);
    console.table(rows);
  } catch (e) {
    console.log(`(error) ${e.message}`);
  }
}

await q('1) Ledger dh2/di4/di5/dl*/cz1/dh23', `
  select archivo, aplicada_en from sgc.migraciones_aplicadas
   where archivo ~ '(dh2|di4|di5|dl[0-9]|cz1|dh23)' order by aplicada_en;`);

await q('2) Firma(s) validar_km_vehiculo', `
  select p.oid::regprocedure as firma
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='sgc' and p.proname='validar_km_vehiculo';`);

await q('3a) Reportes abiertos/en_progreso + fotos (dev, todos)', `
  select r.id, r.asunto, r.estado, r.created_at, r.usuario_id,
         (select array_agg(f.storage_path) from sgc.reportes_usuario_fotos f where f.reporte_id=r.id) fotos
    from sgc.reportes_usuario r where r.estado in ('abierto','en_progreso') order by r.created_at;`);

await q('4) Grupos de error (app_error_reports_grupos, abiertos)', `
  select firma, error_type, source, ocurrencias, usuarios, primera_vez, ultima_vez, estado, nota
    from sgc.app_error_reports_grupos(p_estado := 'abiertos', p_limit := 50)
   order by ocurrencias desc;`);

await q('4b) Causas tracking (registrar_posiciones/watcher), contexto', `
  select message, left(context::text,300) ctx, count(*) from sgc.app_error_reports
   where error_type='tracking' group by 1,2 order by 3 desc limit 20;`);

await q('5) Estados ya marcados en app_error_estados', `
  select firma, estado, nota, resuelto_en_version from sgc.app_error_estados order by updated_at desc limit 50;`);

await q('6a) Agentes', `select clave, nombre, rol, nivel_max, activo from sgc.agentes;`);
await q('6b) Tablas con %gap%', `select table_schema, table_name from information_schema.tables where table_name ilike '%gap%';`);
await q('6c) Funciones con %gap%', `select p.proname, n.nspname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.proname ilike '%gap%';`);

await q('7) Nota Pendientes de Xaviel (todas sus notas dev)', `
  select id, titulo, ambito, pinned from sgc.notas
   where owner_id='4b19cc4b-3dbe-40dc-8631-ef489cad0f45' order by created_at desc limit 20;`);

await q('8) Buckets (ya listado antes, solo claude-skills check)', `
  select id, public from storage.buckets where id ilike '%claude%';`);

await q('9) Submódulos existentes (muestra)', `
  select distinct unnest(modulos) as modulo from sgc.roles order by 1;`);

console.log(`\n== (${env.entorno}) listo ==`);
