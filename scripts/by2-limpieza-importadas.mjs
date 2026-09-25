// BY2 — Limpieza de echadas importadas que NO son de la flota (ensucian el log y el
// dashboard de conciliación: % match 4 %, plataforma 0). Reglas: nada se borra; se
// INVALIDA con motivo (reversible poniendo invalidada=false).
//   · importadas con vehiculo_id null (tarjeta de persona / sin vehículo) → 'Fuera de flota (BY2)'
//   · galones negativos (anulaciones del informe)                         → 'Anulación del informe (BY2)'
//
// Uso:
//   node scripts/by2-limpieza-importadas.mjs --env dev            (DRY-RUN: solo reporta)
//   node scripts/by2-limpieza-importadas.mjs --env dev --apply     (aplica)
//   node scripts/by2-limpieza-importadas.mjs --env prod --apply    (con OK de Xaviel)
// Sin --env NO corre (regla 18).
import './lib/load-env.mjs';
import { resolverEnv } from './lib/entorno.mjs';

const argv = process.argv.slice(2);
const apply = argv.includes('--apply');
const env = await resolverEnv(argv);

async function q(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${env.ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(t);
  try { return JSON.parse(t); } catch { return []; }
}

const FUERA = `importada = true and vehiculo_id is null and not coalesce(invalidada,false) and not coalesce(es_prueba,false)`;
const NEG = `coalesce(galones,0) < 0 and not coalesce(invalidada,false) and not coalesce(es_prueba,false)`;

console.log(`\n[BY2 limpieza] entorno=${env.nombre} (${env.ref}) — ${apply ? 'APLICAR' : 'DRY-RUN'}\n`);

const antesFuera = (await q(`select count(*) c, coalesce(sum(monto),0) m from sgc.registros_combustible where ${FUERA}`))[0];
const antesNeg = (await q(`select count(*) c, coalesce(sum(monto),0) m from sgc.registros_combustible where ${NEG}`))[0];
console.log(`Fuera de flota (importada sin vehículo): ${antesFuera.c} filas · RD$ ${Number(antesFuera.m).toLocaleString()}`);
console.log(`Anulaciones (galones negativos):         ${antesNeg.c} filas · RD$ ${Number(antesNeg.m).toLocaleString()}`);

// Muestra hasta 10 de cada una para revisión.
const muestra = await q(`select left(coalesce(titular,tarjeta,'—'),30) titular, fecha, galones, monto from sgc.registros_combustible where ${FUERA} order by fecha desc limit 10`);
if (muestra.length) { console.log('\n  Muestra fuera de flota:'); for (const r of muestra) console.log(`   · ${r.titular} | ${r.fecha} | ${r.galones} gal | RD$ ${r.monto}`); }

if (!apply) { console.log('\n(DRY-RUN — no se escribió nada. Añade --apply para invalidar con motivo.)\n'); process.exit(0); }

const uFuera = await q(`update sgc.registros_combustible set invalidada=true, saneada=true, saneamiento_motivo='Fuera de flota (BY2)' where ${FUERA}`);
const uNeg = await q(`update sgc.registros_combustible set invalidada=true, saneada=true, saneamiento_motivo='Anulación del informe (BY2)' where ${NEG}`);

const despFuera = (await q(`select count(*) c from sgc.registros_combustible where ${FUERA}`))[0];
const despNeg = (await q(`select count(*) c from sgc.registros_combustible where ${NEG}`))[0];
console.log(`\n✓ Invalidadas fuera de flota; quedan pendientes: ${despFuera.c}`);
console.log(`✓ Invalidadas anulaciones; quedan pendientes: ${despNeg.c}`);
console.log('\nNada se borró (reversible: invalidada=false por saneamiento_motivo).');
console.log('El dashboard de conciliación recalcula el % match sobre lo que queda.\n');
