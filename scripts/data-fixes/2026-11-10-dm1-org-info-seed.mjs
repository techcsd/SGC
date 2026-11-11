// scripts/data-fixes/2026-11-10-dm1-org-info-seed.mjs — CD10
// Llena sgc.claude_org_info con el inventario real leído de la consola de
// Claude (extras/ORGANIZACION-CLAUDE-INVENTARIO.md, 10-nov-2026). Dato
// informativo (DM-15/18), no afecta permisos ni facturación.
//
//   node scripts/data-fixes/2026-11-10-dm1-org-info-seed.mjs --env dev
//   node scripts/data-fixes/2026-11-10-dm1-org-info-seed.mjs --env prod --yes
import '../lib/load-env.mjs';
import { resolverEnv, dbQuery } from '../lib/entorno.mjs';

const env = await resolverEnv(process.argv.slice(2));

const owners = ['Ramón Cabrera (primary owner)', 'Eduardo Ng (owner)', 'Xaviel Dev (owner)'];
const conectores = [
  'SGC (propio)', 'Claude Data (propio)', 'Asana (propio)', 'Atlassian (propio)',
  'Box', 'Canva', 'ClickUp', 'ElevenLabs', 'Figma', 'GitHub Integration', 'Gmail',
  'Google Calendar', 'Google Docs', 'Google Drive', 'Google Sheets', 'Google Slides',
  'HubSpot', 'Intercom', 'Linear', 'Microsoft 365', 'monday.com', 'Notion', 'Slack',
  'Supabase', 'Unsplash', 'Vercel', 'Zapier',
];
const skills = JSON.stringify([
  { nombre: 'llenar-volumen', autor: 'Ramón Cabrera', version: 4, visibilidad: 'Only creator', candidata_publicar_rol: 'Ingeniería/Presupuesto' },
  { nombre: 'limpiar-reporte', autor: 'Ramón Cabrera', version: 1, visibilidad: 'Only creator', candidata_publicar_rol: 'Ingeniería/Presupuesto' },
  { nombre: 'macros-cobros-cxc', autor: 'Eduardo Ng', version: 1, visibilidad: 'Only creator', candidata_publicar_rol: 'Contabilidad/Cobros' },
]);
const notas = 'Plan Team · 8 de 8 asientos ocupados (no cabe nadie más sin comprar asiento) · 1 solicitud de acceso pendiente de revisar · "Los miembros pueden solicitar conectores": activado · Aviso: 35 herramientas de escritura de Microsoft 365 se activan para miembros desde el 9-dic-2026 salvo que se dejen apagadas · Lista de extensiones de escritorio permitidas: apagada (cualquiera puede instalar) · Contabilidad es una cuenta compartida (correo genérico) — cuidado con skills/datos personales en ese asiento. Leído de la consola de administración, 10-nov-2026 (solo lectura).';

const sql = `
update sgc.claude_org_info set
  plan = 'Team',
  asientos_totales = 8,
  asientos_ocupados = 8,
  owners = array['${owners.join("','")}'],
  conectores = array['${conectores.join("','")}'],
  skills_organizacion = '${skills}'::jsonb,
  notas = '${notas.replace(/'/g, "''")}',
  actualizado_en = now()
where id = 1;
`;

await dbQuery(env, sql);
console.log(`✓ claude_org_info actualizado en ${env.entorno}`);
