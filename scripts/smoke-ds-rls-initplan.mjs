// smoke-ds-rls-initplan.mjs — DS-46 (#71). Prueba de permisos (incluidos los NEGATIVOS) por tabla y persona,
// para comparar ANTES vs DESPUES de reescribir politicas RLS con (select ...).
// Para cada persona (admin, guarda_almacen, ingeniero_campo, chofer, usuario sin rol, uid inexistente, anon)
// y cada tabla mide: filas visibles (SELECT), filas que un UPDATE no-op podria tocar y filas que un DELETE
// podria borrar (cada intento dentro de un subtransaccion que se DESHACE; todo el script termina en ROLLBACK).
// Si UPDATE/DELETE fallan por permisos se registra el SQLSTATE (eso tambien es un resultado a comparar).
//
// Uso:  node scripts/smoke-ds-rls-initplan.mjs --env dev --tablas a,b,c --guardar ruta.json     (antes)
//       node scripts/smoke-ds-rls-initplan.mjs --env dev --tablas a,b,c --comparar ruta.json    (despues)
import './lib/load-env.mjs';
import { resolverEnv } from './lib/entorno.mjs';
import { consulta } from './lib/dbq-dev.mjs';
import { readFileSync, writeFileSync } from 'node:fs';

const argv = process.argv.slice(2);
const val = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const tablas = (val('--tablas') || '').split(',').filter(Boolean);
if (!tablas.length || !(val('--guardar') || val('--comparar'))) { console.error('Uso: --env dev --tablas a,b --guardar f.json | --comparar f.json'); process.exit(1); }
const env = await resolverEnv(argv);

// Personas: uid (o null), rol de BD
const personasSql = `
  select 'admin' p, (select ur.usuario_id from sgc.usuarios_roles ur join sgc.roles r on r.id=ur.rol_id where r.codigo='admin' order by ur.usuario_id limit 1)::text uid, 'authenticated' rol
  union all select 'guarda_almacen', (select ur.usuario_id from sgc.usuarios_roles ur join sgc.roles r on r.id=ur.rol_id where r.codigo='guarda_almacen' order by ur.usuario_id limit 1)::text, 'authenticated'
  union all select 'ingeniero_campo', (select ur.usuario_id from sgc.usuarios_roles ur join sgc.roles r on r.id=ur.rol_id where r.codigo='ingeniero_campo' order by ur.usuario_id limit 1)::text, 'authenticated'
  union all select 'chofer', (select ur.usuario_id from sgc.usuarios_roles ur join sgc.roles r on r.id=ur.rol_id where r.codigo in ('chofer_transportista','chofer_privado') order by ur.usuario_id limit 1)::text, 'authenticated'
  union all select 'sin_rol', (select u.id from sgc.usuarios u where not exists (select 1 from sgc.usuarios_roles ur where ur.usuario_id=u.id) order by u.id limit 1)::text, 'authenticated'
  union all select 'uid_inexistente', '00000000-0000-0000-0000-000000000001', 'authenticated'
  union all select 'anon', null, 'anon'`;
const personas = (await consulta(env, personasSql)).filter((p) => p.rol === 'anon' || p.uid);

const bloque = (p, t) => `
    -- ${p.p} / ${t}
    begin
      execute 'reset role';
      perform set_config('request.jwt.claims', ${p.uid ? `json_build_object('sub','${p.uid}','role','${p.rol}')::text` : `'{"role":"anon"}'`}, true);
      execute 'set local role ${p.rol}';
      begin execute 'select count(*) from sgc.${t}' into n; v_sel := n::text; exception when others then v_sel := 'ERR:'||sqlstate; end;
      v_upd := null; v_del := null;
      begin
        execute 'select (select a.attname from pg_attribute a where a.attrelid=''sgc.${t}''::regclass and a.attnum>0 and not a.attisdropped order by a.attnum limit 1)' into col;
        begin
          execute format('update sgc.${t} set %1$I = %1$I', col); get diagnostics n = row_count; v_upd := n::text;
          raise exception 'undo';
        exception when others then if sqlerrm <> 'undo' then v_upd := 'ERR:'||sqlstate; end if; end;
        begin
          execute 'delete from sgc.${t}'; get diagnostics n = row_count; v_del := n::text;
          raise exception 'undo';
        exception when others then if sqlerrm <> 'undo' then v_del := 'ERR:'||sqlstate; end if; end;
      exception when others then v_upd := coalesce(v_upd,'ERR:'||sqlstate); end;
      execute 'reset role';
      insert into res values ('${p.p}', '${t}', v_sel, v_upd, v_del);
    exception when others then execute 'reset role'; insert into res values ('${p.p}', '${t}', 'ERRGLOBAL:'||sqlstate, null, null);
    end;`;

const filas = [];
for (const p of personas) {
  // una peticion (y una transaccion que se deshace) por persona: evita el statement_timeout y aisla efectos
  const sql = `
begin;
create temp table res(persona text, tabla text, sel text, upd text, del text);
do $$
declare n bigint; col text; v_sel text; v_upd text; v_del text;
begin
${tablas.map((t) => bloque(p, t)).join('\n')}
end $$;
select * from res order by persona, tabla;
rollback;`;
  const r = await consulta(env, sql);
  if (!Array.isArray(r) || !r.length) { console.error('Sin resultados para', p.p, JSON.stringify(r).slice(0, 300)); process.exit(2); }
  filas.push(...r);
}
const mapa = Object.fromEntries(filas.map((f) => [`${f.persona}|${f.tabla}`, `sel=${f.sel} upd=${f.upd} del=${f.del}`]));

if (val('--guardar')) {
  writeFileSync(val('--guardar'), JSON.stringify(mapa, null, 1));
  console.log(`guardado ${Object.keys(mapa).length} celdas (${personas.length} personas x ${tablas.length} tablas) en ${val('--guardar')}`);
} else {
  const antes = JSON.parse(readFileSync(val('--comparar'), 'utf8'));
  let dif = 0;
  for (const k of new Set([...Object.keys(antes), ...Object.keys(mapa)])) {
    if (antes[k] !== mapa[k]) { dif++; console.log(`DIFF ${k}\n   antes:   ${antes[k]}\n   despues: ${mapa[k]}`); }
  }
  console.log(`comparadas ${Object.keys(mapa).length} celdas: ${dif === 0 ? 'IDENTICAS (0 diferencias)' : dif + ' DIFERENCIAS'}`);
  const negativas = filas.filter((f) => ['sin_rol', 'uid_inexistente', 'anon'].includes(f.persona));
  console.log(`celdas negativas (sin_rol/uid_inexistente/anon) verificadas: ${negativas.length}`);
  process.exit(dif === 0 ? 0 : 1);
}
