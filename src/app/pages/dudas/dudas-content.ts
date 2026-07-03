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
        respuesta: 'Ve a RRHH > Empleados > Nuevo empleado y completa sus datos.',
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
