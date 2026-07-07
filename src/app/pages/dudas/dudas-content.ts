export interface DudaItem {
  pregunta: string;
  respuesta: string;
}

export interface DudaCategoria {
  id: string;
  titulo: string;
  /** If set, only shown to users whose roles include this modulo (admin always sees everything). */
  modulo?: string;
  /** If true, only shown to admin (regardless of modulo). */
  soloAdmin?: boolean;
  items: DudaItem[];
}

export const DUDAS_CATEGORIAS: DudaCategoria[] = [
  {
    id: 'primeros-pasos',
    titulo: 'Primeros pasos',
    items: [
      {
        pregunta: '¿Por qué no veo cierto módulo en el menú lateral?',
        respuesta:
          'El menú solo muestra los módulos que tu rol tiene asignado. Si necesitas acceso a un módulo que no aparece, pide a un administrador que revise tu rol en Administración > Usuarios.',
      },
      {
        pregunta: '¿Olvidé mi contraseña, qué hago?',
        respuesta:
          'En la pantalla de inicio de sesión, haz clic en "¿Olvidaste tu contraseña?" e ingresa tu correo. Recibirás un enlace para elegir una nueva contraseña. Si el correo no llega en unos minutos, revisa spam o pide a un administrador que te la restablezca desde Administración > Usuarios.',
      },
      {
        pregunta: '¿Cómo colapso el menú lateral para ver más espacio?',
        respuesta:
          'Usa la flecha en la parte inferior del menú lateral (junto al botón de colapsar). El estado se recuerda la próxima vez que entres.',
      },
      {
        pregunta: '¿Qué significan los puntos rojos y números junto a un módulo?',
        respuesta:
          'Indican solicitudes u órdenes pendientes de atender en ese módulo (por ejemplo, solicitudes de materiales sin aprobar, o entregas despachadas sin confirmar). Se actualizan automáticamente al crear, aprobar o rechazar una solicitud.',
      },
    ],
  },
  {
    id: 'roles-permisos',
    titulo: 'Roles y permisos',
    items: [
      {
        pregunta: '¿Qué es un rol y cómo determina lo que puedo hacer?',
        respuesta:
          'Un rol es un conjunto de permisos. Cada rol tiene asignados uno o más "módulos" (Inventario, Compras, Legal, etc.). Solo ves en el menú y puedes usar los módulos que tu rol incluye. Un administrador asigna tu rol en Administración > Usuarios; puedes ver tus roles y accesos en tu perfil (arriba a la derecha, tu nombre).',
      },
      {
        pregunta: '¿Qué significa cada módulo (qué puedo hacer con él)?',
        respuesta:
          'Inventario: artículos, entradas, salidas, bodegas y conduces. · Compras: proveedores y órdenes de compra. · RRHH: empleados, asistencia, ausencias/vacaciones y documentos de personal. · Proyectos: obras, fases, equipo y el ranking de encargados. · Flota: vehículos, mantenimientos, combustible y rutas. · Bitácora: parte diario de obra, visitas e incidentes, y solicitudes desde la obra. · Documentos: generar documentos desde plantillas. · Plantillas: además, crear/editar las plantillas (no solo usarlas). · Legal: expedientes, contratos y aprobaciones legales. · Tareas: asignar tareas a otras personas. · Dirección: vista ejecutiva del negocio. · Administración: gestionar usuarios, roles y permisos.',
      },
      {
        pregunta: '¿Quién puede asignar tareas y quién solo puede verlas?',
        respuesta:
          'Cualquier usuario puede ver y trabajar las tareas que le asignan en Tareas > Mis tareas, y cambiar su estado (pendiente → en progreso → completada). Solo los roles que tienen el módulo "Tareas" (o un administrador) pueden CREAR y ASIGNAR tareas a otras personas, desde Tareas > Gestión de tareas, y ver el historial completo del sistema. Quien no tiene ese módulo solo ve su propio historial.',
      },
      {
        pregunta: '¿Qué hace el rol de Administración y por qué es especial?',
        respuesta:
          'El rol admin puede todo: gestiona usuarios, roles y permisos, y ve todos los módulos. Es el único que puede crear/editar cuentas y cambiar quién tiene acceso a qué. Por eso su asignación se cuida: un usuario no puede quitarse a sí mismo el acceso ni desactivarse solo.',
      },
      {
        pregunta: '¿Qué hace el rol de Dirección (la vista ejecutiva)?',
        respuesta:
          'El rol Dirección General está pensado para la gerencia: da visibilidad de todos los módulos operativos y un Panel de Dirección con indicadores y gráficos del negocio (proyectos, tareas, incidentes, presupuesto). No gestiona usuarios ni permisos — eso queda en Administración.',
      },
      {
        pregunta: '¿Qué hace el rol de Abogado / Legal?',
        respuesta:
          'El rol Abogado accede al módulo Legal (expedientes, contratos y la cola de aprobaciones legales) y a Documentos/Plantillas para gestionar plantillas de contratos. Otros módulos pueden enviarle documentos a revisión y él aprueba o rechaza desde Legal > Aprobaciones.',
      },
      {
        pregunta: '¿Por qué no puedo crear plantillas de documentos si sí puedo generar documentos?',
        respuesta:
          'Son dos permisos distintos a propósito. Con el módulo "Documentos" generas documentos a partir de plantillas existentes. Crear o editar plantillas requiere el módulo "Plantillas", reservado a roles de confianza (admin, legal), para mantener el catálogo de plantillas ordenado y consistente.',
      },
    ],
  },
  {
    id: 'perfil-cuenta',
    titulo: 'Mi perfil y notificaciones',
    items: [
      {
        pregunta: '¿Cómo cambio mi foto de perfil?',
        respuesta:
          'Haz clic en tu nombre (arriba a la derecha) para abrir Mi perfil y usa "Cambiar foto". Puedes subir una imagen PNG, JPG o WEBP.',
      },
      {
        pregunta: '¿Por qué no puedo cambiar mi nombre o mi correo?',
        respuesta:
          'El nombre y el correo los administra el equipo de Administración para mantener los datos consistentes en todo el sistema. Si necesitas corregirlos, pídeselo a un administrador.',
      },
      {
        pregunta: '¿Qué son los avisos que aparecen arriba a la derecha?',
        respuesta:
          'Son notificaciones en tiempo real: aparecen cuando te asignan una tarea, recibes un mensaje, o llega una solicitud a un módulo que gestionas. Puedes hacer clic en el aviso para ir directo a lo que lo generó. No necesitas recargar la página.',
      },
    ],
  },
  {
    id: 'tareas',
    titulo: 'Tareas',
    items: [
      {
        pregunta: '¿Dónde veo las tareas que me asignaron?',
        respuesta:
          'En Tareas > Mis tareas. Cada tarjeta muestra prioridad, estado y fecha límite. Ábrela para ver el detalle, cambiar el estado (pendiente → en progreso → completada) y dejar comentarios. Los cambios se reflejan al instante, sin recargar.',
      },
      {
        pregunta: '¿Cómo asigno una tarea a otra persona?',
        respuesta:
          'Necesitas el módulo "Tareas". Ve a Tareas > Gestión de tareas > Nueva tarea, elige responsable, prioridad, fecha límite y (opcional) proyecto. La persona recibe un aviso al instante.',
      },
      {
        pregunta: '¿Dónde veo el historial de tareas?',
        respuesta:
          'En Tareas > Historial. Verás tu propio historial con gráficos; si tienes el módulo "Tareas", verás además todas las tareas del sistema y estadísticas por estado, prioridad y responsable.',
      },
    ],
  },
  {
    id: 'mensajeria',
    titulo: 'Mensajería',
    items: [
      {
        pregunta: '¿Cómo envío un mensaje a un compañero?',
        respuesta:
          'Ve a Mensajes, usa el botón de mensaje directo, elige a la persona y escribe. También puedes crear grupos con el botón de grupo. Puedes adjuntar archivos.',
      },
      {
        pregunta: '¿Los mensajes llegan en tiempo real?',
        respuesta:
          'Sí. Los mensajes aparecen al instante sin recargar, y si no estás en la pantalla de Mensajes verás un aviso emergente con el número de no leídos junto a "Mensajes" en el menú.',
      },
    ],
  },
  {
    id: 'inventario',
    titulo: 'Inventario',
    modulo: 'inventario',
    items: [
      {
        pregunta: '¿Cómo registro una entrada de inventario?',
        respuesta:
          'Ve a Inventario > Entradas > Nueva entrada. Indica bodega, proveedor y los artículos recibidos. Si la entrada corresponde a una orden de compra, selecciónala en el campo "Orden de compra" — así queda vinculada y visible en el historial de esa orden.',
      },
      {
        pregunta: '¿Cómo registro una salida de inventario?',
        respuesta:
          'Ve a Inventario > Salidas > Nueva salida. El sistema valida automáticamente que haya stock suficiente antes de permitir guardar.',
      },
      {
        pregunta: '¿Qué significan los estados de una salida (despachado, entregado, entregado incompleto)?',
        respuesta:
          '"Despachado" es cuando el material sale de bodega pero aún no ha sido confirmado por quien lo recibe en el proyecto. Cuando el receptor confirma en Bitácora > Confirmar entregas, la salida pasa a "Entregado" (si todo llegó completo) o "Entregado incompleto" (si alguna cantidad recibida fue menor a la enviada).',
      },
      {
        pregunta: '¿Dónde veo qué entradas se han recibido contra una orden de compra?',
        respuesta:
          'Abre la orden en Compras > Órdenes de Compra y revisa la sección "Entradas recibidas" en el detalle. Ahí aparece cada entrada registrada contra esa orden, con fecha, bodega y total.',
      },
      {
        pregunta: '¿Cómo agrego un nuevo artículo, categoría o bodega?',
        respuesta:
          'En Inventario > Artículos usa "Nuevo artículo" (las categorías se gestionan desde el mismo formulario). Las bodegas se administran en Inventario > Bodegas.',
      },
      {
        pregunta: '¿Qué es un conduce y dónde lo descargo?',
        respuesta:
          'Cada salida de inventario genera automáticamente un conduce (nota de entrega). En Inventario > Conduces ves el historial completo; abre cualquiera con "Ver conduce" y usa "Imprimir / Guardar PDF" para descargarlo. Queda siempre disponible para reimprimir.',
      },
    ],
  },
  {
    id: 'compras',
    titulo: 'Compras',
    modulo: 'compras',
    items: [
      {
        pregunta: '¿Cómo creo una orden de compra?',
        respuesta: 'Ve a Compras > Órdenes de Compra > Nueva OC. Selecciona proveedor, agrega los ítems y guarda.',
      },
      {
        pregunta: '¿Qué significan los estados de una orden (borrador, aprobada, recibida parcial, recibida, cancelada)?',
        respuesta:
          '"Borrador" aún se puede editar. "Aprobada" ya está lista para recibir mercancía. "Recibida parcial" indica que ya llegó algo pero no todo lo pedido. "Recibida" es el estado final cuando todo llegó. "Cancelada" cierra la orden sin recibir nada.',
      },
      {
        pregunta: '¿Cómo atiendo una solicitud de compra enviada por un ingeniero de campo?',
        respuesta:
          'Las solicitudes pendientes aparecen en un panel arriba de la tabla en Compras > Órdenes de Compra. Haz clic en "Crear orden" para convertirla en una orden real (precarga los ítems), o en "Rechazar" si no procede.',
      },
    ],
  },
  {
    id: 'bitacora',
    titulo: 'Bitácora',
    modulo: 'bitacora',
    items: [
      {
        pregunta: '¿Cómo registro mi bitácora diaria?',
        respuesta: 'Ve a Bitácora > Nueva bitácora, completa las secciones y guarda. Puedes ver tus envíos anteriores en Bitácora > Mis bitácoras.',
      },
      {
        pregunta: '¿Cómo solicito materiales o una compra para mi proyecto?',
        respuesta:
          'Usa Bitácora > Solicitar materiales o Bitácora > Solicitar compra. Tu solicitud queda pendiente hasta que Inventario o Compras la apruebe o rechace; te notificaremos por correo cuando eso pase.',
      },
      {
        pregunta: '¿Cómo confirmo que recibí una entrega de materiales?',
        respuesta:
          'En Bitácora > Confirmar entregas verás las entregas despachadas hacia tu proyecto. Abre la entrega, indica la cantidad realmente recibida por artículo (usa "Todo llegó" si coincide con lo enviado) y agrega notas si algo faltó.',
      },
    ],
  },
  {
    id: 'rrhh',
    titulo: 'RRHH',
    modulo: 'rrhh',
    items: [
      {
        pregunta: '¿Cómo registro la asistencia de un empleado?',
        respuesta: 'Ve a RRHH > Asistencia, selecciona la fecha y marca la asistencia de cada empleado.',
      },
      {
        pregunta: '¿Cómo agrego un nuevo empleado?',
        respuesta:
          'Ve a RRHH > Empleados > Nuevo empleado. Además de los datos básicos puedes registrar datos personales, seguridad social (TSS/AFP/ARS), supervisor, banco para nómina y, al editar, adjuntar documentos del empleado (contrato, cédula, etc.).',
      },
      {
        pregunta: '¿Cómo registro y apruebo vacaciones o permisos?',
        respuesta:
          'Ve a RRHH > Ausencias y vacaciones > Nueva solicitud. Elige empleado, tipo (vacaciones, enfermedad, permiso, licencia…) y fechas — el sistema calcula los días laborables y, para vacaciones, muestra el balance del año. Las solicitudes pendientes se aprueban o rechazan desde la misma pantalla.',
      },
      {
        pregunta: '¿Dónde guardo el contrato u otros documentos de un empleado?',
        respuesta:
          'Abre el empleado en RRHH > Empleados (editar) y usa la sección "Documentos del empleado" para adjuntar y descargar archivos. Son visibles solo para RRHH y Administración.',
      },
    ],
  },
  {
    id: 'proyectos',
    titulo: 'Proyectos',
    modulo: 'proyectos',
    items: [
      {
        pregunta: '¿Cómo creo un proyecto y le asigno equipo?',
        respuesta:
          'Ve a Proyectos > Nuevo proyecto. Una vez creado, entra al detalle para agregar miembros del equipo y fases — esto también determina qué ingenieros pueden ver y trabajar sobre ese proyecto en Bitácora.',
      },
      {
        pregunta: '¿Qué es el Ranking de Encargados y cómo se calcula?',
        respuesta:
          'Es un puntaje de 0 a 100 por proyecto (Proyectos > Ranking de Encargados) que mide el desempeño del encargado: avance de fases (30%), cumplimiento de bitácora en 30 días (25%), seguridad / cero incidentes en 90 días (25%) y control de presupuesto (20%). Incluye gráficos comparativos. Es una competencia sana entre encargados.',
      },
    ],
  },
  {
    id: 'flota',
    titulo: 'Flota',
    modulo: 'flota',
    items: [
      {
        pregunta: '¿Cómo registro un mantenimiento de vehículo?',
        respuesta: 'Ve a Flota > Mantenimientos > Nuevo mantenimiento y selecciona el vehículo.',
      },
      {
        pregunta: '¿Cómo registro combustible o una ruta?',
        respuesta: 'Usa Flota > Combustible o Flota > Rutas respectivamente, ambos con su propio formulario de registro.',
      },
    ],
  },
  {
    id: 'documentos',
    titulo: 'Documentos',
    modulo: 'documentos',
    items: [
      {
        pregunta: '¿Cómo genero un documento (por ejemplo, una carta de entrega)?',
        respuesta:
          'Ve a Documentos > Generar documento, elige la plantilla y completa los datos solicitados. El documento generado queda disponible en Documentos > Historial.',
      },
      {
        pregunta: '¿Hay plantillas de contratos listas para usar?',
        respuesta:
          'Sí. En Documentos > Generar documento encontrarás plantillas de contrato (subcontrato de obra, contrato de trabajo, alquiler de equipos, servicios profesionales). Solo completas los datos y se rellena el contrato.',
      },
      {
        pregunta: '¿Cómo agrego una nueva plantilla?',
        respuesta:
          'Crear/editar plantillas requiere el módulo "Plantillas" (por defecto admin y Legal). Si lo tienes, ve a Documentos > Plantillas y sube un .docx con marcadores {{campo}}. Sin ese módulo puedes generar documentos pero no crear plantillas.',
      },
    ],
  },
  {
    id: 'legal',
    titulo: 'Legal',
    modulo: 'legal',
    items: [
      {
        pregunta: '¿Qué gestiona el módulo Legal?',
        respuesta:
          'Tres cosas: Expedientes (casos legales: laborales, permisos, litigios…), Contratos (registro con alerta de vencimiento) y Aprobaciones (solicitudes que otros módulos envían a Legal para revisión).',
      },
      {
        pregunta: '¿Cómo reviso o apruebo un documento enviado a Legal?',
        respuesta:
          'En Legal > Aprobaciones verás las solicitudes pendientes. Ábrelas y aprueba o rechaza con un comentario. Quien la envió verá el resultado. Recibirás un aviso emergente cuando llegue una nueva solicitud.',
      },
      {
        pregunta: '¿Cómo registro un contrato y su vencimiento?',
        respuesta:
          'En Legal > Contratos > Nuevo contrato, indica tipo, contraparte, montos y fecha de vencimiento. El sistema resalta los que están por vencer en los próximos 30 días.',
      },
    ],
  },
  {
    id: 'direccion',
    titulo: 'Dirección',
    modulo: 'direccion',
    items: [
      {
        pregunta: '¿Qué muestra el Panel de Dirección?',
        respuesta:
          'Una vista ejecutiva del negocio: proyectos activos, empleados, incidentes, expedientes legales, presupuesto vs. gasto, y gráficos de proyectos por estado, tareas por estado y desempeño por proyecto. Está pensado para la gerencia.',
      },
    ],
  },
  {
    id: 'administracion',
    titulo: 'Administración de cuentas',
    soloAdmin: true,
    items: [
      {
        pregunta: '¿Cómo agrego un nuevo usuario?',
        respuesta:
          'Ve a Administración > Usuarios > Nuevo usuario. El usuario recibe un correo de invitación para elegir su propia contraseña — nunca la ves ni la defines tú.',
      },
      {
        pregunta: '¿Cómo cambio el rol o los módulos de un usuario?',
        respuesta: 'Abre el usuario en Administración > Usuarios y edita sus roles asignados.',
      },
      {
        pregunta: '¿Cómo desactivo un usuario que ya no debe tener acceso?',
        respuesta:
          'Usa el interruptor de "Activo" en Administración > Usuarios. Esto bloquea su acceso de inmediato sin borrar su historial. Un usuario no puede desactivarse a sí mismo.',
      },
      {
        pregunta: '¿Cómo restablezco la contraseña de otro usuario?',
        respuesta:
          'En Administración > Usuarios usa la opción "Restablecer contraseña" junto al usuario. Se le enviará un correo con un enlace para elegir una nueva — tú nunca ves ni defines la contraseña.',
      },
      {
        pregunta: '¿Cómo creo un nuevo rol?',
        respuesta: 'Ve a Administración > Roles > Nuevo rol y selecciona los módulos que ese rol debe poder ver.',
      },
    ],
  },
];
