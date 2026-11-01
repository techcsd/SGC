import '../lib/load-env.mjs';
import { resolverEnv, dbQuery } from '../lib/entorno.mjs';
const env = await resolverEnv(process.argv.slice(2));

console.log('=== vehiculos reales en dev (placas) ===');
console.log(JSON.stringify(await dbQuery(env, `select placa, vin, marca, modelo, anio from sgc.vehiculos where activo order by placa limit 30;`)));

console.log('=== sugerir: placa a 1 caracter (simulada contra una placa real del dev) ===');
const r = await dbQuery(env, `
  select p.placa as placa_real from sgc.vehiculos p where p.activo and p.placa is not null limit 1;
`);
console.log(JSON.stringify(r));
