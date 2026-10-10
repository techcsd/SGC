// scripts/data-fixes/2026-10-08-cl4-rescate-actualizacion.mjs — CL4 (reglas 18/19)
//
// RESCATE de los usuarios Android atascados en 2.44.0 / 2.44.1 / 2.45.0, cuyo
// updater in-app está roto (el APK salió con canal:"pwa" → `actualizar()` recarga
// como PWA y "no pasa nada"). La única salida es instalar el APK nuevo ENCIMA, una
// vez (misma llave → no se borra nada). Este script les manda un aviso (in-app +
// push vía sgc.notificar_usuarios) con el texto de qué hacer. El toque en la push
// de esos APK solo abre la app (no puede abrir un enlace externo — verificado en
// csd-app push.service.ts:146), así que el TEXTO es autosuficiente y el enlace real
// llega por WhatsApp (ver el mensaje al final) y en la web /app-movil.
//
//   node scripts/data-fixes/2026-10-08-cl4-rescate-actualizacion.mjs --env dev            (DRY-RUN)
//   node scripts/data-fixes/2026-10-08-cl4-rescate-actualizacion.mjs --env dev --apply
//   node scripts/data-fixes/2026-10-08-cl4-rescate-actualizacion.mjs --env prod --apply    (SOLO con OK de Xaviel)
//
// DRY-RUN por defecto (regla 19). A prod SOLO después de que el hotfix 2.45.1 esté
// publicado (PROMPT-93 F1) y Xaviel lo haya probado en su Samsung.
import '../lib/load-env.mjs';
import { resolverEnv, dbQuery } from '../lib/entorno.mjs';

const VERSIONES_ROTAS = ['2.44.0', '2.44.1', '2.45.0'];

const TITULO = 'Actualiza tu app (instala encima)';
const MENSAJE =
  'Tu versión no se actualiza sola. Descarga la última e instálala ENCIMA (no se borra nada ' +
  'ni pierdes tu sesión). Te enviamos el enlace por WhatsApp; también está en el menú web ' +
  '«CSD App (móvil)». Solo hace falta una vez.';

function esc(s) { return String(s).replace(/'/g, "''"); }

const env = await resolverEnv(process.argv.slice(2));
const APPLY = process.argv.includes('--apply');

// 1) Afectados: dispositivos Android en una versión rota, con su usuario activo.
const listaSql = `
  select distinct u.id, u.nombre,
    (select max(d2.app_version) from sgc.usuario_dispositivos d2
       where d2.usuario_id = u.id and d2.plataforma ilike 'android') version
  from sgc.usuario_dispositivos d
  join sgc.usuarios u on u.id = d.usuario_id
  where d.plataforma ilike 'android'
    and d.app_version in (${VERSIONES_ROTAS.map((v) => `'${v}'`).join(',')})
    and u.activo
  order by u.nombre`;

const afectados = await dbQuery(env, listaSql);
if (!Array.isArray(afectados) || afectados.length === 0) {
  console.log(`\n✅ (${env.entorno}) No hay usuarios Android atascados en ${VERSIONES_ROTAS.join('/')}. Nada que hacer.\n`);
  process.exit(0);
}

console.log(`\n📱 (${env.entorno}) Afectados (Android ${VERSIONES_ROTAS.join('/')}): ${afectados.length} usuario(s)`);
for (const a of afectados) console.log(`   · ${a.nombre}  —  v${a.version}`);

// apk_url vigente (solo informativo en el reporte / para el mensaje de WhatsApp).
const vig = await dbQuery(env, `select version, apk_url from sgc.app_versiones where plataforma='movil' and publicada=true order by created_at desc limit 1`);
const apkUrl = vig?.[0]?.apk_url ?? '(sin apk publicado)';
const apkVer = vig?.[0]?.version ?? '?';
console.log(`\n🔗 APK vigente: v${apkVer} → ${apkUrl}`);

const ids = afectados.map((a) => `'${a.id}'::uuid`).join(',');
const notifSql = `select sgc.notificar_usuarios(array[${ids}], 'version', '${esc(TITULO)}', '${esc(MENSAJE)}', null)`;

if (!APPLY) {
  console.log('\n— DRY-RUN — (no se envió nada). Para enviar: añade --apply');
  console.log('   Aviso in-app + push que se crearía para cada afectado:');
  console.log(`   título:  ${TITULO}`);
  console.log(`   mensaje: ${MENSAJE}`);
  console.log('\nSQL que correría:\n' + notifSql + '\n');
  process.exit(0);
}

console.log('\n▶ Enviando aviso de rescate (in-app + push)…');
await dbQuery(env, notifSql);
console.log(`✅ Enviado a ${afectados.length} usuario(s).`);
console.log('\n⚠️  Recuerda mandar también el mensaje de WhatsApp con el enlace del APK (reporte CL4).\n');
