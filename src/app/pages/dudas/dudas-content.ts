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

export interface GuiaVisual {
  id: string;
  titulo: string;
  /** Short key that the template maps to an inline SVG icon. */
  icono: 'preuso' | 'combustible' | 'conduce' | 'bitacora' | 'inventario';
  /** If set, only shown to users whose roles include this modulo (admin always sees everything). */
  modulo?: string;
  /** Ordered, one-line steps. */
  pasos: string[];
}

export const GUIAS_VISUALES: GuiaVisual[] = [
  {
    id: 'preuso',
    titulo: 'Pre-uso de vehículo',
    icono: 'preuso',
    modulo: 'flota',
    pasos: [
      'Entra a Flota → Checklists → Nuevo checklist.',
      'Elige el vehículo y confirma el kilometraje y el nivel de combustible.',
      'Responde cada ítem OK / NO / N-A (los críticos en NO bloquean la salida).',
      'Adjunta las fotos requeridas y firma.',
      'Guarda: el sistema calcula el veredicto (Aprobado / Con hallazgos / Bloqueado).',
    ],
  },
  {
    id: 'combustible',
    titulo: 'Registrar combustible',
    icono: 'combustible',
    modulo: 'flota',
    pasos: [
      'Flota → Combustible → Nuevo registro.',
      'Escribe kilometraje, galones echados y monto pagado.',
      'Adjunta la foto del recibo y la del tablero.',
      'El sistema calcula precio/galón, rendimiento y costo/km.',
      'Si el rendimiento cae mucho, se genera un aviso automático.',
    ],
  },
  {
    id: 'conduce',
    titulo: 'Conduces',
    icono: 'conduce',
    modulo: 'inventario',
    pasos: [
      'Inventario → Salidas: registra la salida (conduce).',
      'Agrega los artículos y las cantidades.',
      'Se genera el conduce con número CND-…',
      'Ábrelo y usa "Imprimir / Guardar PDF".',
      'El destino confirma la recepción desde su lista.',
    ],
  },
  {
    id: 'bitacora',
    titulo: 'Bitácora',
    icono: 'bitacora',
    modulo: 'bitacora',
    pasos: [
      'Bitácora → Nueva bitácora.',
      'Elige la obra y responde primero si llovió y si hubo migración.',
      'Marca las actividades hechas y cuántas de cada una.',
      'Registra el personal y las restricciones del día.',
      'Guarda; el clima queda como dato, no como incidente.',
    ],
  },
  {
    id: 'inventario',
    titulo: 'Inventario',
    icono: 'inventario',
    modulo: 'inventario',
    pasos: [
      'Inventario → Artículos: primero aparecen Clavos, Madera y Metales.',
      'Filtra por categoría o busca por nombre.',
      'Usa los botones − / + o escribe la cantidad.',
      'En Almacenes, el nombre se guarda homologado (Primera Letra En Mayúscula).',
    ],
  },
];

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
        pregunta: '¿Para qué es la campana de notificaciones (arriba a la derecha)?',
        respuesta:
          'Te avisa de cosas que te conciernen directamente: por ejemplo, cuando aprueban o rechazan tu requisición. El número rojo son las no leídas; ábrela para verlas y toca una para ir a donde ocurrió. Es distinta de los puntos rojos del menú (esos son pendientes por módulo).',
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
          'Inventario: artículos, entradas, salidas, almacenes, conduces y checklists de almacén. · Compras: proveedores y órdenes de compra. · RRHH: empleados, asistencia, ausencias/vacaciones y documentos de personal. · Proyectos: obras, fases, equipo y el ranking de encargados. · Flota: vehículos, mantenimientos, combustible, rutas y checklists de pre-uso/inspección. · Bitácora: parte diario de obra, visitas e incidentes, y requisiciones desde la obra. · Documentos: generar documentos desde plantillas. · Plantillas: además, crear/editar las plantillas (no solo usarlas). · Legal: expedientes, contratos y aprobaciones legales. · Tareas: asignar tareas a otras personas. · Tecnología: homologación de herramientas oficiales, matriz por puesto, inventario tecnológico y compras de tecnología. · Dirección: vista ejecutiva del negocio. · Administración: gestionar usuarios, roles y permisos.',
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
      {
        pregunta: '¿Dónde veo qué hace cada rol y cuándo asignarlo? (administradores)',
        respuesta:
          'En Administración > Roles cada rol muestra una descripción de qué hace, para quién es y cuándo asignarlo, además de los módulos a los que da acceso (pasa el cursor sobre cada módulo de la tarjeta para ver qué incluye). Al crear o editar un rol puedes escribir o ajustar esa descripción, y cada módulo trae una explicación de qué desbloquea al marcarlo; los de acceso amplio (Administración, Dirección) están señalados como tales para que los asignes con cuidado. Recuerda que un usuario puede tener varios roles y verá la suma de sus accesos.',
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
    id: 'clima-ubicacion',
    titulo: 'Clima y ubicación de obra',
    modulo: 'proyectos',
    items: [
      {
        pregunta: '¿Cómo asigno la ubicación de un proyecto en el mapa?',
        respuesta:
          'Al crear o editar un proyecto (Proyectos > Nuevo/Editar) hay un mapa: busca la dirección o haz clic en el punto de la obra. Se guardan las coordenadas y la dirección. Con eso el sistema muestra el clima de esa obra.',
      },
      {
        pregunta: '¿De dónde sale el clima y cuánto cuesta?',
        respuesta:
          'Usamos Open-Meteo, un servicio meteorológico gratuito y sin límites de clave. No hay costo ni configuración. El clima se cachea para no consultarlo en cada carga.',
      },
      {
        pregunta: '¿Qué recomendaciones da el sistema según el clima?',
        respuesta:
          'En el detalle del proyecto verás una tarjeta de clima con condiciones actuales, pronóstico de 7 días y recomendaciones de obra: evitar vaciado de concreto si hay/viene lluvia, suspender grúas con viento fuerte, protección solar con UV alto, pausas por calor extremo.',
      },
      {
        pregunta: '¿El clima queda registrado en la bitácora?',
        respuesta:
          'Sí. Al registrar una bitácora de un proyecto con ubicación, el sistema captura automáticamente el clima del momento (temperatura, lluvia, viento…) y lo guarda junto a la entrada. Ese clima se muestra luego en el detalle de la bitácora (en Historial), y es especialmente útil en incidentes/accidentes para ver las condiciones al momento del hecho.',
      },
      {
        pregunta: '¿Dónde veo el clima de todas las obras de un vistazo?',
        respuesta:
          'En el Dashboard y en el Panel de Dirección hay un panel "Clima en obras" con las condiciones actuales y la advertencia principal de cada obra activa que tenga ubicación. En Dirección, además, las obras con clima peligroso o de precaución aparecen en "Requiere atención".',
      },
      {
        pregunta: '¿Puedo ver cuántos días se han perdido por lluvia?',
        respuesta:
          'Sí. En Proyectos > Reportes de clima verás, por rango de 7/30/90 días, los días con lluvia y los "días adversos" (lluvia significativa o viento alto) de cada obra, con un ranking de las más afectadas. El sistema registra el clima de cada obra activa cada 3 horas, así que el histórico crece solo.',
      },
      {
        pregunta: '¿El sistema avisa cuando hay clima peligroso en una obra?',
        respuesta:
          'Sí. Cuando se detecta una condición severa en una obra (tormenta, lluvia intensa, viento fuerte o calor extremo) aparece un aviso emergente y se marca un contador en el menú de Proyectos. Las alertas activas se listan en Proyectos > Reportes de clima y se resuelven solas cuando la condición pasa.',
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
          'Ve a Inventario > Entradas > Nueva entrada. Indica almacén, proveedor y los artículos recibidos. Si la entrada corresponde a una orden de compra, selecciónala en el campo "Orden de compra" — así queda vinculada y visible en el historial de esa orden.',
      },
      {
        pregunta: '¿Cómo registro una salida de inventario?',
        respuesta:
          'Ve a Inventario > Salidas > Nueva salida. El sistema valida automáticamente que haya stock suficiente antes de permitir guardar.',
      },
      {
        pregunta: '¿Puedo adjuntar una foto de evidencia a una entrada o salida desde la web?',
        respuesta:
          'Sí. Tanto en Nueva entrada como en Nueva salida hay un campo "Foto de evidencia (opcional)": adjunta una imagen (o toma una con la cámara) y se guarda comprimida junto al movimiento. Luego se ve con el botón 📷 en la lista de entradas/salidas y en el detalle del conduce. Todo lo que captura la app de campo también se puede hacer desde la computadora.',
      },
      {
        pregunta: '¿Cómo apruebo una requisición del ingeniero de obra?',
        respuesta:
          'Las requisiciones pendientes aparecen en un panel arriba de la tabla en Inventario > Salidas. Pulsa "Aprobar": elige el almacén y confirma a qué artículo del catálogo corresponde cada renglón (los que dejes sin artículo se irán a compra). Al aprobar, el sistema despacha lo que hay en stock (genera el conduce) y crea automáticamente una solicitud de compra por el faltante en el módulo Compras. Es un solo paso.',
      },
      {
        pregunta: '¿Qué significan los estados de una salida (despachado, entregado, entregado incompleto)?',
        respuesta:
          '"Despachado" es cuando el material sale del almacén pero aún no ha sido confirmado por quien lo recibe en el proyecto. Cuando el receptor confirma en Bitácora > Confirmar entregas, la salida pasa a "Entregado" (si todo llegó completo) o "Entregado incompleto" (si alguna cantidad recibida fue menor a la enviada).',
      },
      {
        pregunta: '¿Dónde veo qué entradas se han recibido contra una orden de compra?',
        respuesta:
          'Abre la orden en Compras > Órdenes de Compra y revisa la sección "Entradas recibidas" en el detalle. Ahí aparece cada entrada registrada contra esa orden, con fecha, almacén y total.',
      },
      {
        pregunta: '¿Cómo agrego un nuevo artículo, categoría o almacén?',
        respuesta:
          'En Inventario > Artículos usa "Nuevo artículo" (las categorías se gestionan desde el mismo formulario). Puedes marcar "Requiere indicar talla (EPP)" para que el sistema pida la talla al pedir ese artículo, y agregar una "Nota / ayuda" (empaque o referencia, ej. "ATADO 120 PZA", "REF. TOTAL") que se muestra al pedirlo. Los almacenes se administran en Inventario > Almacenes.',
      },
      {
        pregunta: '¿Qué es el catálogo oficial de materiales y las 8 categorías?',
        respuesta:
          'El inventario usa el catálogo oficial CSD con 8 categorías en orden: 01 EPP, 02 Materia Prima (madera/plywood), 03 Materiales Consumibles, 04 Equipos de Apuntalamiento, 05 Moldes y Accesorios, 06 Equipos y Herramientas, 07 Material de Oficina y 08 Otros. Al pedir un artículo (salida o requisición) los ves agrupados por estas categorías. Los artículos anteriores que no coincidían con el catálogo quedaron en una categoría "(Revisión)" desactivada para revisarlos manualmente sin perder su historial.',
      },
      {
        pregunta: '¿Cómo veo solo los almacenes de una obra?',
        respuesta:
          'En Inventario > Almacenes usa el filtro "Todas las obras" para mostrar solo los almacenes de una obra específica, el almacén general (sin obra) o todos. Un almacén se liga a una obra desde su formulario, en el campo "Obra (almacén de obra)".',
      },
      {
        pregunta: '¿Cómo sé qué materiales hay que reponer en un almacén?',
        respuesta:
          'Ve a Inventario > Reposición y elige el almacén. Verás los artículos que están en o por debajo de su stock mínimo, con la cantidad faltante (los que están en cero se marcan como críticos). Es una guía operativa de reposición para el almacén de obra — no maneja montos ni presupuesto.',
      },
      {
        pregunta: '¿Cómo hago el chequeo semanal de un almacén?',
        respuesta:
          'Ve a Inventario > Conteos > "Nuevo chequeo semanal", elige el almacén y ajusta la cantidad física de cada artículo (el sistema precarga la cantidad registrada). Al guardar, el stock se ajusta al conteo físico y las diferencias se reportan automáticamente a Dirección. Cada almacén de obra tiene además una tarea semanal recordatoria asignada a su Guarda-Almacén.',
      },
      {
        pregunta: '¿Qué es un conduce y dónde lo descargo?',
        respuesta:
          'Cada salida de inventario genera automáticamente un conduce (nota de entrega). En Inventario > Conduces ves el historial completo; abre cualquiera con "Ver conduce" y usa "Imprimir / Guardar PDF" para descargarlo. Queda siempre disponible para reimprimir.',
      },
      {
        pregunta: '¿Puedo cerrar/firmar la entrega de un conduce desde la web?',
        respuesta:
          'Sí. Abre el conduce (Inventario > Conduces > "Ver conduce" o desde la salida) y, si está en estado "despachado", usa "Registrar entrega (firmar)". Indicas quién recibe en obra, ajustas las cantidades realmente recibidas, adjuntas una foto opcional y capturas la firma en pantalla. El conduce pasa a "Entregado" (o "Entregado incompleto" si algo llegó corto). Solo puede hacerlo el conductor asignado, Flota o un administrador — misma capacidad que en la app de campo.',
      },
      {
        pregunta: '¿Dónde veo todo lo que entra y sale de un almacén?',
        respuesta:
          'En Inventario > Movimientos ves el historial de entradas y salidas de todos los almacenes, con filtros por almacén, tipo y fecha; cada salida trae el enlace a su conduce. Además, en Inventario > Almacenes cada fila tiene el botón «Ver movimientos», que abre esa misma vista ya filtrada por ese almacén.',
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
        pregunta: '¿De dónde salen las solicitudes de compra que veo pendientes?',
        respuesta:
          'La mayoría se generan automáticamente cuando Almacén aprueba una requisición y no hay stock suficiente: el faltante llega aquí como solicitud de compra. También pueden venir de compras tecnológicas. Aparecen en un panel arriba de la tabla en Compras > Órdenes de Compra: pulsa "Crear orden" para convertirla en una orden real (precarga los ítems y eliges proveedor), o "Rechazar" si no procede.',
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
        respuesta: 'Ve a Bitácora > Nueva bitácora, completa las secciones y guarda. Puedes ver tus envíos anteriores en Bitácora > Mis bitácoras. Puedes adjuntar todas las fotos que necesites (galería sin límite práctico), se ven todas en el detalle.',
      },
      {
        pregunta: '¿Cómo registro los equipos alquilados usados en la obra?',
        respuesta:
          'En Bitácora > Nueva bitácora (parte diario), en la sección "Equipos alquilados" responde "¿Hay equipos alquilados en uso hoy?". Si marcas Sí, agrega cada equipo con su nombre, en qué se usó y (opcional) el proveedor — el campo sugiere equipos que ya usaste antes. Esto respalda el gasto: se ve en el detalle de la bitácora, en el Excel de exportación y en el Dashboard de bitácoras (KPI "días con equipos alquilados", equipos más usados y días con equipos por obra).',
      },
      {
        pregunta: '¿Cómo pido materiales para mi proyecto (requisición)?',
        respuesta:
          'Usa Bitácora > Requisición > Nueva requisición. Elige la obra y, por cada renglón, selecciona el artículo del catálogo (agrupado por categorías) con su cantidad, o elige "Otro (escribir)" para pedir algo que no está en el catálogo (eso alimenta la lista de "otros" para valorar si conviene crearlo como artículo oficial). Si el artículo es de protección personal (EPP) que exige talla, el sistema te pedirá la talla. Antes de enviar verás una hoja de resumen para revisar y ajustar todo. Ya no eliges entre "material" y "compra": el sistema decide al aprobar — despacha lo que hay en stock (te genera un conduce) y crea una solicitud de compra por el faltante hacia Compras. Tu requisición queda "Pendiente" → "Aprobada (en compra)" si hubo faltante, o "Entregada" si salió completa.',
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
        pregunta: '¿Cómo creo un proyecto y le asigno el Equipo de Obra?',
        respuesta:
          'Ve a Proyectos > Nuevo proyecto. Una vez creado, entra al detalle: en "Equipo de Obra" asignas los roles del procedimiento (Ingeniero Responsable, Ingeniero Residente, Capataz, Maestro de Acero, Maestro de Encofrado, Encargado de Seguridad, Guarda-Almacén, Topógrafo, cuadrillas y subcontratistas). Cada miembro puede ser un empleado de RRHH o una entidad externa (topógrafo/subcontratista). Esto también determina qué ingenieros trabajan ese proyecto en Bitácora.',
      },
      {
        pregunta: '¿Qué son los Vaciados y las No Conformidades? (CSD-OPE-01)',
        respuesta:
          'En el detalle del proyecto, la sección "Vaciados y No Conformidades" lleva el control de ejecución: registras cada vaciado (N°, elemento/eje/bloque, fecha) y su avance planificado → liberado → vaciado. Una No Conformidad (NC) es un problema detectado; si está abierta y marcada como "bloquea vaciado", el sistema NO deja liberar ni vaciar ese elemento hasta cerrarla (regla de oro del procedimiento). Los checklists de liberación CL-01…07 con firmas Maestro→Residente→Responsable→Cliente vienen en la próxima entrega.',
      },
      {
        pregunta: '¿Qué es el "Cuadre inicial de materiales" y cómo lo uso?',
        respuesta:
          'Es la estimación de materiales de la obra distribuida en las 4 fases de avance (25/50/75/100%). En el detalle del proyecto pulsa "Inicializar cuadre + kit de inicio": se copia el Kit de inicio de obra (almacén, oficina, cocina y baño) y puedes agregar los materiales estimados con su reparto por fase. A medida que se aprueban requisiciones, el sistema descuenta el consumo real contra el cuadre de la fase activa; si se excede, genera una alerta silenciosa a Dirección (el ingeniero nunca ve el cuadre ni los límites). Es información de gerencia — vive en el módulo Proyectos.',
      },
      {
        pregunta: '¿Qué es el Expediente de inicio de obra y cómo lo completo?',
        respuesta:
          'Es el checklist de documentos obligatorios de la Fase 0 (CSD-OPE-01): resumen de contrato sin montos, alcance, materiales mínimos, cronograma, plan de trabajo, organigrama, diseño de encofrado, planos, tolerancias y acuerdos de inicio. En el detalle del proyecto pulsa "Inicializar expediente estándar" y, por cada documento, marca su estado (pendiente/cargado/validado/no aplica), asigna responsable y adjunta el archivo. La barra de completitud muestra el avance; ninguna obra debería iniciar sin el expediente completo. Los montos de contrato nunca se manejan aquí.',
      },
      {
        pregunta: '¿Qué es el Ranking de Encargados y cómo se calcula?',
        respuesta:
          'Es un puntaje de 0 a 100 por proyecto (Proyectos > Ranking de Encargados) que mide el desempeño del encargado: avance de fases (30%), cumplimiento de bitácora en 30 días (25%), seguridad / cero incidentes en 90 días (25%) y control de presupuesto (20%). Incluye gráficos comparativos. Es una competencia sana entre encargados.',
      },
      {
        pregunta: '¿Dónde veo los proyectos ya finalizados?',
        respuesta:
          'En Proyectos > Historial. Verás los proyectos completados y cancelados con su duración real, presupuesto y fecha de fin, además de tiles y gráficos por estado y por tipo. Puedes cambiar entre "Finalizados" y "Todos".',
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
        pregunta: '¿Cómo registro combustible (v2)?',
        respuesta:
          'En Flota > Combustible > Nuevo registro digitas solo 3 datos: kilometraje actual, galones echados y monto pagado (RD$), más 2 fotos obligatorias (recibo y tablero). El sistema calcula solo el precio/galón, los km recorridos, el rendimiento (km/gal) y el costo/km, y te los muestra en vivo antes de guardar. Si el rendimiento cae más de 20% bajo el promedio del vehículo, se marca "consumo anormal" y se avisa a Flota (posible fuga o problema mecánico). Toca una fila para ver el detalle con las 2 fotos y el análisis.',
      },
      {
        pregunta: '¿Dónde veo los dashboards de combustible?',
        respuesta:
          'En Flota > Combustible > Dashboards. "Por vehículo" muestra gasto, galones, km, costo/km, rendimiento promedio, tabla de echadas y gráficos (rango por defecto 6 meses). "Flotilla" resume el gasto total, costo/km ponderado, alertas activas y el estado de cada vehículo (NORMAL / REVISAR / ALERTA).',
      },
      {
        pregunta: '¿Cómo registro una ruta?',
        respuesta: 'Usa Flota > Rutas, con su propio formulario de registro.',
      },
      {
        pregunta: '¿La ruta muestra el clima del destino?',
        respuesta:
          'Sí. Al planificar una ruta puedes elegir una obra de destino (o marcar el punto en el mapa). Con eso el formulario muestra el clima del destino y un aviso de despacho para el día del viaje (p. ej. "lluvia probable, despacha temprano"). En la lista de rutas, los viajes próximos con clima adverso muestran un aviso.',
      },
      {
        pregunta: '¿Cómo lleno un checklist de pre-uso (v2) y qué significa el resultado?',
        respuesta:
          'Ve a Flota > Checklists > Nuevo checklist. Elige el vehículo, el nivel de combustible y responde cada punto (agrupado por secciones: LSC "Autorizado y Apto", Seguridad y —solo para equipo pesado— Herramienta Pesado) con OK / NO / N/A. El resultado es tri-estado: APROBADO (todo bien), CON HALLAZGOS (algún NO no crítico → puede salir pero se avisa a Flota para corregir) o BLOQUEADO (algún NO en un punto crítico → el vehículo NO puede salir y se notifica de inmediato). El sistema también rechaza el registro si la licencia del conductor, la matrícula o el seguro del vehículo están vencidos, y avisa cuando el mantenimiento por kilómetros está por vencer (pre-cita ≤500 km) o vencido. Desde el detalle puedes imprimir/descargar el reporte de inspección.',
      },
      {
        pregunta: '¿Cuál es la diferencia entre el pre-uso y el reporte semanal? Llené un checklist y el reporte semanal sigue vacío.',
        respuesta:
          'Son dos cosas distintas. El PRE-USO es la inspección diaria antes de mover el vehículo (un punto crítico en NO lo bloquea). El REPORTE SEMANAL es un chequeo que cada chofer envía una vez por semana por su vehículo, y es el único que cuenta en el dashboard Flota > Reporte semanal. Si llenaste un checklist y el dashboard sigue vacío, probablemente registraste un pre-uso. Para el semanal usa el botón «Reporte semanal» en Flota > Checklists, o «Llenar reporte semanal» dentro del propio dashboard (te abre el formulario con la plantilla correcta ya elegida). En el selector de plantilla las opciones están agrupadas en «Pre-uso» y «Reporte semanal».',
      },
      {
        pregunta: '¿Puedo elegir cualquier vehículo? ¿Por qué ahora el selector muestra fotos?',
        respuesta:
          'Sí: los vehículos son un pool compartido, cualquier usuario puede seleccionar cualquiera que esté disponible (no hace falta que esté "asignado a ti"). El selector de vehículo en pre-uso, combustible y rutas ahora muestra la foto del vehículo (o un ícono si no tiene) para elegir sin equivocarte.',
      },
      {
        pregunta: '¿Qué es el Panel del día de Flota?',
        respuesta:
          'En Flota > Panel del día ves, para hoy: cuántos choferes activos ya reportaron su pre-uso (y quiénes faltan), cuántas inspecciones salieron aprobadas / con hallazgos / bloqueadas, la tabla de inspecciones del día, las alertas activas y un gráfico de la última semana.',
      },
      {
        pregunta: '¿Dónde gestiono los avisos de Flota (bloqueos, consumos, vencimientos)?',
        respuesta:
          'En Flota > Avisos hay una bandeja con todos los avisos operativos: bloqueos por checklist, hallazgos, pre-citas y mantenimiento vencido, consumo anormal de combustible, y vencimientos de licencia, matrícula y seguro (estos se generan solos al abrir la página). Filtra por estado/tipo/vehículo y pulsa "Atender" para dejar una nota y cerrarlos. El punto rojo del menú de Flota cuenta los avisos pendientes. Además llega un correo automático a quienes tienen el módulo Flota.',
      },
      {
        pregunta: '¿Dónde subo la cédula y licencia de un conductor, o el seguro y matrícula de un vehículo?',
        respuesta:
          'En dos lugares. (1) Al CREAR/editar el conductor, el formulario ahora deja adjuntar la cédula y la licencia de forma opcional (se suben al guardar; no bloquean si faltan). (2) En el perfil: Conductores > (abre el conductor) → sección "Documentos", con espacios destacados para Cédula y Licencia (marca "Falta documento" si aún no están). Vehículos: Flota > Vehículos > (abre el vehículo) → "Documentos", con Seguro y Matrícula destacados. Al subir ves una miniatura (vista previa) del documento y puedes subir varias fotos por documento — por ejemplo la licencia por su frente y su dorso. Puedes verlos, descargarlos y (admin/Flota) eliminar cada uno.',
      },
      {
        pregunta: '¿Por qué las categorías de licencia ahora son 01, 02, 03… en vez de A, B, C?',
        respuesta:
          'Se actualizaron al formato dominicano (RD): 01 Motocicletas, 02 Vehículos livianos (auto/jeepeta), 03 Carga liviana/taxi, 04 Autobuses/pasajeros, 05 Carga pesada (camiones), 06 Vehículos especiales/maquinaria. Las licencias que estaban como A/B/C se convirtieron automáticamente a su equivalente numérico. Se eligen desde el formulario del conductor y el catálogo se administra en base de datos.',
      },
      {
        pregunta: '¿Puedo ponerle una nota o un tag a un conductor (Chofer, Encargado de Logística…)?',
        respuesta:
          'Sí. Al crear o editar un conductor puedes escribir una nota libre y agregar tags (escribe y presiona Enter; hay sugerencias como Chofer, Encargado de Logística, Chofer Telehandler). Los tags y la nota se ven como etiquetas en el listado y en el perfil del conductor.',
      },
      {
        pregunta: '¿Cómo sé qué conductores tienen documentos incompletos sin abrir cada perfil?',
        respuesta:
          'En Flota > Conductores, a quien le falte la cédula o la licencia se le muestra un badge "⚠ Documentos incompletos" en el listado. Además hay un botón/filtro "⚠ Documentos incompletos" para ver solo esos conductores.',
      },
      {
        pregunta: '¿Cuándo me avisa el sistema que una licencia está por vencer?',
        respuesta:
          'Cuando falten 3 meses (≈90 días) o menos para el vencimiento, la licencia se marca "Por vencer" (y "Vencida" si ya pasó) tanto en el listado como en el perfil del conductor. El umbral es configurable en la base de datos (flota_config.umbral_licencia_dias).',
      },
      {
        pregunta: '¿Puedo registrar el VIN, el número de matrícula y el número de seguro de un vehículo?',
        respuesta:
          'Sí. Al crear o editar un vehículo puedes registrar el VIN (número de chasis, hasta 17 caracteres, único — útil para diferenciar vehículos casi idénticos), el número de matrícula, el número de póliza del seguro y la compañía aseguradora. El VIN se ve en el listado y todo aparece en el perfil del vehículo. Las fotos de matrícula y seguro se siguen subiendo desde "Documentos" del vehículo.',
      },
      {
        pregunta: '¿La entrega/recepción de un vehículo guarda dónde se hizo (GPS)?',
        respuesta:
          'Sí. En Flota > Responsabilidad, al abrir una entrega/recepción se muestra un mini-mapa con el punto y la hora en que se capturó, más un enlace "Ver en mapa". Si al capturarla no había permiso de ubicación, verás "Sin ubicación registrada".',
      },
      {
        pregunta: '¿Puedo registrar una entrega/recepción de vehículo desde la web (no solo desde el celular)?',
        respuesta:
          'Sí. En Flota > Responsabilidad usa "Registrar entrega/recepción". Eliges si es recepción (recibes el vehículo) o devolución (lo entregas), el vehículo, el kilometraje y el combustible, tomas o adjuntas las 6 fotos guiadas (frente, atrás, ambos lados, tablero y combustible — son obligatorias), marcas daños si los hay, y opcionalmente capturas tu ubicación (GPS del navegador) y la firma. Quedas registrado como el conductor responsable, igual que en la app de campo.',
      },
      {
        pregunta: '¿Puedo adjuntar fotos y firma a un checklist desde la computadora (no solo desde el celular)?',
        respuesta:
          'Sí. Todo lo que se captura en el celular también se puede hacer desde la web: en Flota > Checklists > Nuevo checklist puedes adjuntar las fotos del vehículo (delantera, tablero, etc.), una foto por cada ítem (útil para documentar un hallazgo) y la firma del conductor directamente en pantalla. En el detalle del checklist se ven todas, incluidas las fotos por ítem junto a su punto correspondiente.',
      },
    ],
  },
  {
    id: 'tecnologia',
    titulo: 'Tecnología',
    items: [
      {
        pregunta: '¿Qué herramienta oficial usamos para cada cosa?',
        respuesta:
          'En Tecnología > Guía de herramientas (visible para todos) verás la homologación de la empresa: Google Drive para la nube, Claude para IA, Fireflies para notas de reuniones y Google Meet para reuniones (no Teams). La lista se mantiene actualizada por el área de Tecnología.',
      },
      {
        pregunta: '¿Dónde se gestionan el inventario tecnológico y las compras de tecnología?',
        respuesta:
          'Con el módulo "Tecnología": en Tecnología > Inventario tecnológico se registran laptops, cámaras, teléfonos, impresoras, etc., con su estado y a qué empleado están asignados (con historial). Cada equipo y cada renglón de compra pueden llevar una foto. En Tecnología > Compras tecnológicas el encargado crea solicitudes que van a Compras/Gerencia para aprobación, igual que cualquier compra; al crear una compra puedes adjuntar una foto por artículo, y al abrir una solicitud ves sus renglones con las fotos. La matriz puesto × herramienta define qué necesita cada puesto.',
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
      {
        pregunta: '¿Qué son las alertas de "Control de materiales" y quién las ve?',
        respuesta:
          'Son alertas antifraude silenciosas: el sistema compara el consumo real de materiales de cada obra contra lo estimado en su cuadre por fase (25/50/75/100%) y avisa cuando una obra consume más de lo previsto, o cuando un chequeo de almacén arroja diferencias. Solo las ven Dirección, Gerencia y Administración — nunca el ingeniero ni el personal de obra, y nunca bloquean la operación. Desde el panel puedes marcar cada alerta "en revisión" o "resuelta". Los umbrales (80% advertencia / 100% alerta) se ajustan en Administración > Parámetros.',
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
      {
        pregunta: '¿Qué es la página «Valores "Otro"» y para qué sirve?',
        respuesta:
          'En Administración > Valores "Otro" el sistema agrupa lo que la gente escribe a mano cuando elige la opción «Otro» en los distintos formularios (por ejemplo, una restricción de bitácora). Cuando un mismo valor se repite lo suficiente (por defecto 3 veces en 30 días) aparece marcado como sugerencia de «crear opción oficial» y te llega una notificación a ti, a Tecnología y a Dirección — así conviertes ese texto libre repetido en una opción fija del formulario. El umbral se configura en la tabla de configuración.',
      },
      {
        pregunta: '¿Dónde ajusto los umbrales de las alertas de materiales?',
        respuesta:
          'En Administración > Parámetros. `alerta_cuadre_umbral_advertencia` (por defecto 80) dispara una advertencia temprana y `alerta_cuadre_umbral_alerta` (por defecto 100) dispara la alerta cuando el consumo llega a ese % del estimado de la fase. Edita el valor y guarda.',
      },
      {
        pregunta: '¿Cómo publico una nueva versión de la app móvil y subo su APK?',
        respuesta:
          'En Administración > Versiones de la app crea la versión (número, notas) y sube el archivo APK con "Subir APK" (verás una barra de progreso; queda descargable desde el servidor). La versión que ven los usuarios de campo es independiente de la que desarrollas: se quedan en la que tienen hasta que pulses "Publicar". Al publicar, TODOS los usuarios reciben una notificación en la app y un correo con el enlace de descarga. Usa "Marcar mínima" solo para forzar la actualización (bug crítico): quien tenga una versión menor a la mínima queda obligado a actualizar. La comparación de versiones es por número real (1.10 es mayor que 1.9).',
      },
      {
        pregunta: '¿El historial de versiones de la web se actualiza solo?',
        respuesta:
          'Sí. La versión de la web sale del propio despliegue (package.json): al desplegar una versión nueva, la app la registra sola en Administración > Historial de versiones la primera vez que alguien la abre — sin escribir nada a mano. Aparece con sus notas (editables por el admin). La app móvil también queda en el historial, pero su publicación a los usuarios sigue siendo aprobación manual tuya.',
      },
      {
        pregunta: 'La auditoría tiene muchas filas, ¿cómo saco algo útil?',
        respuesta:
          'En Administración > Auditoría, la pestaña "Panel" te da la lectura analítica: usuarios con más interacción, actividad por módulo, por tipo de acción, por día y por hora, y las acciones más comunes — todo filtrable por rango de fechas, usuario y módulo. Desde cualquier métrica (ranking de usuarios, acciones comunes, módulos) pulsa "Ver →" para saltar a la pestaña "Filas" ya filtrada y ver exactamente qué se hizo (quién cambió qué y cuándo).',
      },
    ],
  },
];
