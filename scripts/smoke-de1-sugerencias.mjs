// smoke-de1-sugerencias.mjs — Ronda DE F1 (DE-02 sugerencias, DE-04 placa oculta)
import './lib/load-env.mjs';
import { resolverEnv, dbQuery } from './lib/entorno.mjs';
const env = await resolverEnv(process.argv.slice(2));

async function comoAdmin(selectSql) {
  const admin = (await dbQuery(env, `select ur.usuario_id as id from sgc.usuarios_roles ur join sgc.roles r on r.id=ur.rol_id where r.codigo='admin' limit 1;`))[0];
  return dbQuery(env, `
    select set_config('request.jwt.claims', json_build_object('sub','${admin.id}','role','authenticated')::text, true);
    select set_config('role', 'authenticated', true);
    ${selectSql}
  `);
}

let fallos = 0;
function check(nombre, cond, detalle) {
  if (!cond) { fallos++; console.log(`FAIL ${nombre}: ${detalle}`); }
  else console.log(`ok   ${nombre}`);
}

console.log('--- 1) placa a 1 carácter (L478815 real, leída L478816) + marca/modelo ---');
let r = await comoAdmin(`select sgc.flota_documentos_sugerir('{"campos":{"placa":"L478816","chasis":null,"marca":"Kia","modelo":"K2700"}}'::jsonb) as r;`);
let cand = r[0].r;
console.log(JSON.stringify(cand));
check('1a top candidate es L478815', cand[0]?.placa === 'L478815', JSON.stringify(cand[0]));
check('1b nivel posible (placa 1-car +40 + marca/modelo +20 = 60, bajo el piso de 70)', cand[0]?.nivel === 'posible' && cand[0]?.puntos === 60, cand[0]?.puntos);
check('1c trae razones', Array.isArray(cand[0]?.razones) && cand[0].razones.length > 0, JSON.stringify(cand[0]?.razones));

console.log('--- 2) placa tapada (XXXXXXXX) + VIN exacto Mitsubishi Fuso (L455498) ---');
r = await comoAdmin(`select sgc.flota_documentos_sugerir('{"campos":{"placa":"XXXXXXXX","chasis":"FE85CGA65815","marca":"Mitsubishi Fuso","modelo":"Canter"}}'::jsonb) as r;`);
cand = r[0].r;
console.log(JSON.stringify(cand));
check('2a match por VIN pese a placa tapada', cand[0]?.placa === 'L455498', JSON.stringify(cand[0]));
check('2b razon NO menciona placa (se ignoró por tapada)', !cand[0]?.razones?.some((x) => x.includes('placa')), JSON.stringify(cand[0]?.razones));

console.log('--- 3) sin ninguna coincidencia → candidatos vacíos ---');
r = await comoAdmin(`select sgc.flota_documentos_sugerir('{"campos":{"placa":"ZZZ9999","chasis":"NOEXISTE","marca":"Marca Rara","modelo":"Modelo Rarisimo"}}'::jsonb) as r;`);
check('3 vacío', Array.isArray(r[0].r) && r[0].r.length === 0, JSON.stringify(r[0].r));

console.log('--- 4) emparejar: placa exacta sigue funcionando ---');
r = await comoAdmin(`select sgc.flota_documentos_emparejar('[{"pagina":1,"tipo":"seguro","campos":{"placa":"L478815","chasis":null}}]'::jsonb) as r;`);
check('4 match exacta', r[0].r[0]?.match === 'exacta', JSON.stringify(r[0].r));

console.log('--- 5) emparejar: reverso no se toca, placa_oculta=false ---');
r = await comoAdmin(`select sgc.flota_documentos_emparejar('[{"pagina":2,"tipo":"reverso","campos":{}}]'::jsonb) as r;`);
check('5 reverso sin_vehiculo', r[0].r[0]?.match === 'sin_vehiculo' && r[0].r[0]?.placa_oculta === false, JSON.stringify(r[0].r));

console.log('--- 6) emparejar: placa tapada + VIN exacto → empareja igual por VIN (placa nunca se compara) ---');
r = await comoAdmin(`select sgc.flota_documentos_emparejar('[{"pagina":3,"tipo":"seguro","campos":{"placa":"XXXXXXXX","chasis":"FE85CGA65815"}}]'::jsonb) as r;`);
check('6 match vin + placa_oculta=true', r[0].r[0]?.match === 'vin' && r[0].r[0]?.placa_oculta === true, JSON.stringify(r[0].r));

console.log('--- 7) emparejar: placa tapada, solo marca+modelo (+20, hay 3 Kia K2700 en la flota) → bajo el piso de 40, sin sugerir ---');
r = await comoAdmin(`select sgc.flota_documentos_emparejar('[{"pagina":4,"tipo":"seguro","campos":{"placa":"XXXXXXXX","chasis":null,"marca":"Kia","modelo":"K2700"}}]'::jsonb) as r;`);
check('7 sin_vehiculo + placa_oculta=true (ambiguo, nunca "exacta" por placa)', r[0].r[0]?.match === 'sin_vehiculo' && r[0].r[0]?.placa_oculta === true, JSON.stringify(r[0].r));

console.log('--- 8) emparejar: placa_oculta viene del LECTOR (campos.placa=null, placa_oculta=true) ---');
r = await comoAdmin(`select sgc.flota_documentos_emparejar('[{"pagina":5,"tipo":"seguro","placa_oculta":true,"campos":{"placa":null,"chasis":"FE85CGA65815"}}]'::jsonb) as r;`);
check('8 match vin + placa_oculta=true (flag del lector, sin texto de placa)', r[0].r[0]?.match === 'vin' && r[0].r[0]?.placa_oculta === true, JSON.stringify(r[0].r));

console.log(fallos === 0 ? '\n✓ TODOS LOS CHECKS PASARON' : `\n✗ ${fallos} CHECK(S) FALLARON`);
process.exit(fallos === 0 ? 0 : 1);
