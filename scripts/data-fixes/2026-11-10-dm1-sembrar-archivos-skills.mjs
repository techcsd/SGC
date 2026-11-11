// scripts/data-fixes/2026-11-10-dm1-sembrar-archivos-skills.mjs — CD10
// El migración dm1 crea las 6 filas de sgc.claude_skills (DM-10) pero una
// skill sin archivo no se puede descargar. Sube el SKILL.md real de cada una
// (texto de extras/SKILLS-ARRANQUE-BORRADOR.md) al bucket claude-skills y crea
// su fila en sgc.claude_skill_versiones (version=1).
//
//   node scripts/data-fixes/2026-11-10-dm1-sembrar-archivos-skills.mjs --env dev
//   node scripts/data-fixes/2026-11-10-dm1-sembrar-archivos-skills.mjs --env prod --yes
import '../lib/load-env.mjs';
import { resolverEnv, dbQuery } from '../lib/entorno.mjs';
import { createHash } from 'node:crypto';

const env = await resolverEnv(process.argv.slice(2));

const SKILLS = {
  'pedir-bien-a-la-ia': `---
name: pedir-bien-a-la-ia
description: Guía para redactar buenas peticiones a la IA en español, con ejemplos de obra y oficina. Úsala cuando la persona no sepa cómo pedir algo o el resultado salga genérico.
---
# Cómo pedir bien algo
Antes de responder, ayuda a la persona a completar: 1) Qué quiere lograr y para quién. 2) Qué datos tiene (pégalos sin cédulas ni claves). 3) Formato esperado (correo, tabla, lista, acta). 4) Tono (formal, directo). Si falta algo, haz hasta 3 preguntas cortas. Después entrega el resultado y ofrece una versión más corta.
Ejemplo: «Redacta un correo formal al proveedor pidiendo confirmar la entrega del acero del miércoles; tono cordial; 120 palabras.»
`,
  'resumir-documento': `---
name: resumir-documento
description: Resume un documento, acta o informe en español con puntos clave, decisiones y pendientes. Úsala cuando la persona pegue o adjunte un texto largo.
---
# Resumir
Entrega: (a) resumen de 5 líneas, (b) decisiones tomadas, (c) pendientes con responsable y fecha si aparecen, (d) dudas o datos que faltan. No inventes datos que no estén en el texto; si algo es ambiguo, márcalo como «no claro».
`,
  'redactar-oficio-formal': `---
name: redactar-oficio-formal
description: Redacta correos u oficios formales en español dominicano de oficina para proveedores, clientes o entidades. Úsala al pedir una carta, oficio o correo formal.
---
# Redactar oficio
Pregunta destinatario, asunto, fecha y qué se pide. Estructura: saludo, propósito en la primera línea, detalle breve, plazo o acción esperada, cierre cordial y firma con cargo. Máximo una página. Nunca incluyas montos o datos que la persona no haya dado.
`,
  'notas-a-acta': `---
name: notas-a-acta
description: Convierte notas sueltas de una reunión en un acta con asistentes, acuerdos y responsables. Úsala después de una reunión o llamada.
---
# Notas → acta
Con las notas de la persona genera: fecha y tema, asistentes (solo los mencionados), acuerdos numerados, tareas con responsable y fecha, y temas pendientes. Pregunta si falta responsable o fecha en algún acuerdo. Sé breve y neutro.
`,
  'revisar-cotizacion': `---
name: revisar-cotizacion
description: Compara una cotización o presupuesto contra lo pedido y señala diferencias de cantidad, unidad, precio y condiciones. Úsala al recibir una cotización de proveedor.
---
# Revisar cotización
Pide el pedido original y la cotización. Entrega tabla: ítem, pedido, cotizado, diferencia, observación. Marca: ítems faltantes o sobrantes, unidades distintas, precios fuera de lo habitual (solo si la persona da referencias), ITBIS y condiciones de pago/entrega. No apruebes nada: recomienda y deja la decisión a la persona.
`,
  'usar-el-sgc-desde-ia': `---
name: usar-el-sgc-desde-ia
description: Cómo hacer preguntas útiles al SGC desde la IA y qué esperar de las herramientas del conector. Úsala cuando la persona pregunte por datos del SGC.
---
# Usar el SGC
Para datos del SGC usa siempre las herramientas del conector; nunca inventes cifras ni estados. Si no sabes qué herramienta usar, pregunta primero qué puede consultar la persona. Las propuestas (requisiciones, notas, tareas) solo crean un borrador: dile a la persona que lo revise y confirme en el SGC. Si algo no existe, repórtalo como hueco en vez de simular que lo resolviste.
Preguntas que funcionan: «¿qué conduces tengo por firmar?», «¿qué requisiciones están pendientes en mi proyecto?», «resumen de bitácoras de la semana».
`,
};

async function storageUpload(path, bytes) {
  const res = await fetch(`${env.url}/storage/v1/object/claude-skills/${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.serviceKey}`, 'Content-Type': 'text/markdown', 'x-upsert': 'true' },
    body: bytes,
  });
  if (!res.ok) throw new Error(`upload ${path}: ${res.status} ${await res.text()}`);
}

for (const [slug, contenido] of Object.entries(SKILLS)) {
  const [skill] = await dbQuery(env, `select id, owner_id, version_actual from sgc.claude_skills where slug='${slug}'`);
  if (!skill) { console.log(`(omitido) ${slug} no existe aún — corre dm1 primero.`); continue; }
  const bytes = Buffer.from(contenido, 'utf8');
  const path = `${skill.owner_id}/${slug}/SKILL.md`;
  await storageUpload(path, bytes);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const contenidoEscapado = contenido.replace(/'/g, "''");
  await dbQuery(env, `
    insert into sgc.claude_skill_versiones (skill_id, version, storage_path, tamano_bytes, sha256, notas, contenido_texto)
    values ('${skill.id}', ${skill.version_actual}, '${path}', ${bytes.length}, '${sha256}', 'Siembra DM-10 (data-fix)', '${contenidoEscapado}')
    on conflict (skill_id, version) do update set storage_path = excluded.storage_path, tamano_bytes = excluded.tamano_bytes, sha256 = excluded.sha256, contenido_texto = excluded.contenido_texto;
  `);
  console.log(`✓ ${slug} → ${path} (${bytes.length} bytes)`);
}
