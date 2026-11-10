// DL0 — ronda 10-nov-2026 (Compa en WhatsApp, módulo completo). Solo lectura.
// Uso: node scripts/diagnosticos/2026-11-10-dl0-diagnostico.mjs --env dev [--env prod --yes]
import '../lib/load-env.mjs';
import { resolverEnv, dbQuery } from '../lib/entorno.mjs';

const env = await resolverEnv(process.argv.slice(2));

function soloLectura(sql) {
  const s = sql.trim().toLowerCase();
  if (!/^(select|with)\b/.test(s)) {
    throw new Error('Este diagnóstico es SOLO LECTURA: la consulta debe empezar con select/with.');
  }
}

async function seccion(titulo, sql) {
  console.log(`\n=== ${titulo} ===`);
  soloLectura(sql);
  try {
    console.log(JSON.stringify(await dbQuery(env, sql), null, 2));
  } catch (e) {
    console.log(`ERROR: ${e.message}`);
  }
}

// §5.1 — ¿Qué existe en este entorno?
await seccion('Tablas wa_grupos/wa_hallazgos/wa_resumenes', `
  select to_regclass('sgc.wa_grupos') as wa_grupos,
         to_regclass('sgc.wa_hallazgos') as wa_hallazgos,
         to_regclass('sgc.wa_resumenes') as wa_resumenes;
`);
await seccion('Crons sgc-wa-*', `
  select jobname, schedule, active from cron.job where jobname like 'sgc-wa-%' order by 1;
`);

// §5.2 — Apagadores
await seccion('Familias de envios_automaticos', `
  select familia, activo, ultimo_envio from sgc.envios_automaticos order by 1;
`);

// §5.3 — Resúmenes generados
await seccion('wa_resumenes recientes', `
  select grupo_jid, periodo, fecha, mensajes_cubiertos, creado_en
  from sgc.wa_resumenes order by creado_en desc limit 20;
`);

// §5.4 — Aviso y participantes
await seccion('wa_grupos (aviso/participantes/proyecto)', `
  select nombre, modo, participantes, aviso_enviado_en, proyecto_id from sgc.wa_grupos;
`);

// §5.5 — Duplicados por redacción
await seccion('Posibles duplicados de redacción en wa_hallazgos', `
  select grupo_jid, tipo, left(resumen,80) as resumen, count(*)
  from sgc.wa_hallazgos group by 1,2,3 having count(*)>1;
`);

// §5.6 — Extensiones
await seccion('pg_trgm / unaccent disponibles', `
  select extname from pg_extension where extname in ('pg_trgm','unaccent');
`);

// §5.7 — Eventos de error
await seccion('wa_eventos recientes', `
  select creado_en, nivel, codigo, detalle from sgc.wa_eventos order by creado_en desc limit 30;
`);

// ── DL7 (N6) — Eduardo NG / «Entrar como» ──────────────────────────────────
const EDUARDO = '2725c827-aec2-4e0c-90ac-dea1ee2b2350';

await seccion('8) Accesos efectivos de Eduardo NG', `
  select sgc.accesos_efectivos_usuario('${EDUARDO}');
`);

await seccion('9) Lo que REALMENTE guardan sus 3 roles', `
  select codigo, nombre, modulos, permisos
  from sgc.roles where codigo in ('gerencia','gerente_proyectos','ingeniero_campo');
`);

await seccion('10) Auditoría de cambios de permisos (últimos 20)', `
  select * from sgc.historial_cambios_permisos(20);
`);

await seccion('11) Última actividad conocida de Eduardo', `
  select id, nombre, updated_at from sgc.usuarios where id = '${EDUARDO}';
`);

await seccion('12) Quién más tiene el rol Gerencia', `
  select u.nombre
  from sgc.usuarios u
  join sgc.usuarios_roles ur on ur.usuario_id = u.id
  join sgc.roles r on r.id = ur.rol_id
  where r.codigo = 'gerencia';
`);
