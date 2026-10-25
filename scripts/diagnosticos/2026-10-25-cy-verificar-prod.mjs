import '../lib/load-env.mjs';
import { resolverEnv, dbQuery } from '../lib/entorno.mjs';
const env = await resolverEnv(process.argv.slice(2));
console.log('ledger (cy):', JSON.stringify(await dbQuery(env, `
  select archivo, entorno, aplicada_en::text from sgc.migraciones_aplicadas where archivo like '%cy-conector%'
`)));
console.log('funciones nuevas existen:', JSON.stringify(await dbQuery(env, `
  select proname from pg_proc where pronamespace = 'sgc'::regnamespace
   and proname in ('reglas_de_alertas','historial_importaciones','detalle_compra_tecnologica',
     'listar_documentos_generados','bitacora_detalle','actualizar_tarea_campos','reunion_acuerdo_cerrar',
     'aprobar_requisicion_simple','decidir_requisicion','resolver_aprobacion_legal',
     'actualizar_expediente_legal','enviar_mensaje_directo')
   order by proname
`)));
