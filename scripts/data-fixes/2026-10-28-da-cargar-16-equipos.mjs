// scripts/data-fixes/2026-10-28-da-cargar-16-equipos.mjs — DA-15 (ronda DA).
// Carga los 16 equipos del inventario tecnológico registrados por Xaviel desde
// fotos el 2026-10-26 (fichas en
// "C:\Users\xavie\Desktop\X Dev\Constructora SD\inventario tecnologico csd v1\
// Equipos organizados\") — incluye el kit DJI (equipo 16) con sus 6 componentes.
// Inventario REAL de la empresa (confirmado por Xaviel) → corre en dev y en
// prod. Primero se corrió en dev con el OK explícito de Xaviel; esta misma
// lista se corre después contra prod porque son los mismos activos físicos.
//
// Equivalente a lo que el conector de Claude haría con
// `proponer_equipos_tecnologicos_lote` + revisión humana, pero ejecutado
// directamente aquí porque también sube fotos (bytes) y arma specs/kit, que el
// conector por diseño NO puede hacer (DA-15: "el conector no puede subir bytes
// de fotos").
//
// Reglas respetadas (no negociables, de la ronda DA):
//   - Costos SIEMPRE costo_origen='estimado' (son precios referenciales, no de
//     compra real — así lo dice cada ficha).
//   - fecha_compra y garantia_hasta quedan "desconocidas" (checkbox), no vacías.
//   - La clave compartida del equipo 02 (nota adhesiva) NUNCA se escribe aquí
//     — ni en este archivo, ni en la base, en NINGÚN entorno. Xaviel la teclea
//     él mismo desde la ficha (Clave del equipo → Guardar).
//   - Ni dev ni prod tienen registrados a Raykler/Ramón Cabrera/Sócrates/
//     Eduardo Ng como empleados (verificado en ambos: sgc.empleados solo trae
//     datos de prueba) → se usa responsable_externo (texto) en vez de
//     inventar un empleado_id.
//   - Anti-duplicado por serie: antes de crear cada ficha con `serie` no nula,
//     se verifica que esa serie no exista YA en sgc.tec_equipos de ese
//     entorno (prod ya traía 3 equipos reales cargados a mano por Xaviel
//     antes de esta ronda). Si hay coincidencia se OMITE esa ficha y se
//     reporta — nunca se inserta un duplicado ni se sobrescribe el existente.
//
//   node scripts/data-fixes/2026-10-28-da-cargar-16-equipos.mjs --env dev            (DRY-RUN)
//   node scripts/data-fixes/2026-10-28-da-cargar-16-equipos.mjs --env dev --apply
//   node scripts/data-fixes/2026-10-28-da-cargar-16-equipos.mjs --env prod --yes     (DRY-RUN contra prod)
//   node scripts/data-fixes/2026-10-28-da-cargar-16-equipos.mjs --env prod --yes --apply
import '../lib/load-env.mjs';
import { resolverEnv, dbQuery } from '../lib/entorno.mjs';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const env = await resolverEnv(process.argv.slice(2));
const APPLY = process.argv.includes('--apply');
if (!env.serviceKey) {
  console.error(`🔴 Falta SUPABASE_SERVICE_ROLE_KEY_${env.entorno.toUpperCase()} en .env.local`);
  process.exit(1);
}

const BASE = 'C:\\Users\\xavie\\Desktop\\X Dev\\Constructora SD\\inventario tecnologico csd v1\\Equipos organizados';
const BUCKET = 'inventario';
const MIME = { '.jpeg': 'image/jpeg', '.jpg': 'image/jpeg', '.png': 'image/png' };

const Q = (s) => (s === null || s === undefined ? 'null' : `'${String(s).replace(/'/g, "''")}'`);
const NUM = (n) => (n === null || n === undefined ? 'null' : Number(n));
const BOOL = (b) => (b ? 'true' : 'false');
const ARR = (a) => (!a || !a.length ? "'{}'" : `array[${a.map(Q).join(',')}]`);

// ── Los 16 equipos, transcritos de cada especificaciones.txt ────────────────
const EQUIPOS = [
  {
    folder: '01_Laptop_Dell-Inspiron-5502_CSD-CONT',
    nombre: 'Laptop Dell Inspiron 15 5502 - CSD-CONT (Contabilidad)',
    tipo_clave: 'laptop', marca: 'Dell', modelo: 'Inspiron 5502', serie: 'DBPYY93',
    estado: 'en_stock', condicion: 'funciona', costo: 450,
    modelo_regulatorio: 'P102F / P102F002', numero_parte: '48HP5 A00', codigo_servicio: '29006919399', anio_fabricacion: 2021,
    notas: 'Rayones visibles en la tapa inferior. A verificar: confirmar Service Tag DBPYY93 contra el equipo físico.',
    specs: { procesador: 'Intel Core i7-1165G7 (11a gen) 2.80 GHz', ram_gb: 16, ram_velocidad: '3200 MT/s', gpu_dedicada: 'NVIDIA GeForce MX330 2 GB', gpu_integrada: 'Intel Iris Xe (128 MB)', almacenamiento_tipo: 'SSD', almacenamiento_gb: 477, so: 'Windows 11', nombre_windows: 'CSD-CONT', usuario_windows: 'CSD - CONTABILIDAD (cuenta local)', cargador_voltaje: '19.5V', cargador_amperaje: '2.31A / 3.34A' },
    fotos: ['foto-01-frente.jpeg', 'foto-02-frente-2.jpeg', 'foto-03-base.jpeg', 'foto-04-etiqueta-serie.jpeg', 'foto-05-admin-tareas-cpu.jpeg', 'foto-06-admin-tareas-gpu.jpeg', 'foto-07-info-sistema.jpeg'],
  },
  {
    folder: '02_Laptop_Dell-Inspiron-5502_CSD-STOCK',
    nombre: 'Laptop Dell Inspiron 15 5502 - CSD (en stock, sin asignar)',
    tipo_clave: 'laptop', marca: 'Dell', modelo: 'Inspiron 5502', serie: 'JTPVT93',
    estado: 'en_stock', condicion: 'funciona', costo: 450,
    modelo_regulatorio: 'P102F / P102F002', numero_parte: '48HP5 A00', codigo_servicio: '43166858135', anio_fabricacion: 2021, codigo_anterior: '001-1843267-3',
    notas: 'Equipo en stock, sin usuario. Tiene una nota adhesiva con una clave COMPARTIDA pegada en el reposamanos — Xaviel la registra él mismo desde "Clave del equipo" (nunca se escribe en texto plano en notas/código). Pendiente: decidir si se limpia el perfil de Windows de un tercero (quedó un perfil que no es el dueño del equipo) antes de reasignarla.',
    specs: { procesador: 'Intel Core i7-1165G7 (11a gen) 2.80 GHz', ram_gb: 16, ram_velocidad: '3200 MT/s', gpu_dedicada: 'NVIDIA GeForce MX330 2 GB', gpu_integrada: 'Intel Iris Xe (128 MB)', almacenamiento_gb: 477, so: 'Windows 11', nombre_windows: 'CSD', usuario_windows: "perfil de un tercero (no es el dueño del equipo)", cargador_voltaje: '19.5V', cargador_amperaje: '2.31A / 3.34A' },
    fotos: ['foto-01-frente.jpeg', 'foto-02-base.jpeg', 'foto-03-etiqueta-serie.jpeg', 'foto-04-base-sello-rojo.jpeg', 'foto-05-info-sistema.jpeg'],
  },
  {
    folder: '03_Laptop_Lenovo-IdeaPad-Slim-3-15ARP10_CONT-CSD',
    nombre: 'Laptop Lenovo IdeaPad Slim 3 - CONT-CSD (Contabilidad)',
    tipo_clave: 'laptop', marca: 'Lenovo', modelo: 'IdeaPad Slim 3 15ARP10 (MTM 83K700TUUS)', serie: 'PF65SCLK',
    estado: 'activo', condicion: 'funciona', costo: 550, responsable_externo: 'Cristofer (Contabilidad) — sin usuario en el SGC',
    anio_fabricacion: 2026,
    notas: 'Equipo nuevo (fabricado 2026). Se usa para Odoo (contabilidad) según capturas.',
    specs: { procesador: 'AMD Ryzen 7 170 con Radeon Graphics, 3.20 GHz (boost ~3.47 GHz)', ram_gb: 16, gpu_integrada: 'AMD Radeon Graphics integrada, 2 GB dedicados', almacenamiento_tipo: 'NVMe', almacenamiento_gb: 477, so: 'Windows 11 Home', so_version: '25H2', pantalla_pulgadas: 15, nombre_windows: 'CONT-CSD', usuario_windows: 'csd adm (csd_adm@constructorasd.com)', cargador_voltaje: '20V', cargador_amperaje: '3.25A' },
    fotos: ['foto-01-lateral-abierta.jpeg', 'foto-02-frente.jpeg', 'foto-03-base.jpeg', 'foto-04-etiqueta-serie.jpeg', 'foto-05-admin-tareas-gpu.jpeg', 'foto-06-admin-tareas-gpu-2.jpeg', 'foto-07-info-sistema.jpeg'],
  },
  {
    folder: '04_Laptop_Lenovo-ThinkPad-T16-Gen1_CSD-ING',
    nombre: "Laptop Lenovo ThinkPad T16 Gen 1 - PC-PF49KVX6 (CSD ING'S)",
    tipo_clave: 'laptop', marca: 'Lenovo', modelo: 'ThinkPad T16 Gen 1 (Type 21BW-S2R300)', serie: 'PF49KVX6',
    estado: 'activo', condicion: 'funciona', costo: 650, responsable_externo: 'Raykler (CSD ING)',
    codigo_servicio: '1592927666 (Unit ID)', anio_fabricacion: 2022,
    notas: 'Se usa con dock/hub USB-C, teclado externo y monitores Samsung.',
    specs: { procesador: 'Intel Core i5-1240P (12a gen) 1.70 GHz', ram_gb: 32, ram_velocidad: '3200 MT/s', gpu_integrada: 'Intel Iris Xe (128 MB)', almacenamiento_gb: 512, so: 'Windows 11 Pro', so_version: '26H2', pantalla_pulgadas: 16, resolucion: '1920x1200', nombre_windows: 'PC-PF49KVX6', usuario_windows: "CSD ING'S (CSD_ING@outlook.com)", cargador_voltaje: '20V', cargador_amperaje: '2.25A / 3.25A / 6.75A' },
    fotos: ['foto-01-frente.jpeg', 'foto-02-base.jpeg', 'foto-03-etiqueta-serie.jpeg', 'foto-04-etiqueta-tipo.jpeg', 'foto-05-etiqueta-regulatoria.jpeg', 'foto-06-info-sistema.jpeg'],
  },
  {
    folder: '05_Laptop_Dell-G16-7630_RCABRERA',
    nombre: 'Laptop Dell G16 7630 - RCABRERA (Ramón Cabrera)',
    tipo_clave: 'laptop', marca: 'Dell', modelo: 'G16 7630', serie: '4XC0B04',
    estado: 'activo', condicion: 'funciona', costo: 1100, responsable_externo: 'Ramón Cabrera',
    modelo_regulatorio: 'P122F / P122F001', numero_parte: '3VFJJ A00', anio_fabricacion: 2023,
    notas: 'Tiene sticker de DJI en el reposamanos. A verificar: Service Tag "4XC0B04" se leyó de una foto algo borrosa.',
    specs: { procesador: 'Intel Core i9-13900HX (13a gen) 2.20 GHz', ram_gb: 32, ram_velocidad: '4800 MT/s', gpu_dedicada: 'NVIDIA GeForce RTX 4060 Laptop 8 GB', gpu_integrada: 'Intel UHD (128 MB)', almacenamiento_gb: 954, so: 'Windows 11 Pro', so_version: '26H2', nombre_windows: 'RCABRERA', usuario_windows: 'Ramon Cabrera (control2@constructorasd.com)', cargador_voltaje: '19.5V', cargador_amperaje: '16.92A' },
    fotos: ['foto-01-frente.jpeg', 'foto-02-base.jpeg', 'foto-03-etiqueta-serie.jpeg', 'foto-04-info-sistema.jpeg'],
  },
  {
    folder: '06_Laptop_Dell-G15-5535_DELL-G15-PPC',
    nombre: 'Laptop Dell G15 5535 - DELL-G15-PPC',
    tipo_clave: 'laptop', marca: 'Dell', modelo: 'G15 5535', serie: '5YT8854',
    estado: 'activo', condicion: 'funciona', costo: 900, responsable_externo: 'Sócrates',
    modelo_regulatorio: 'P121F / P121F002', numero_parte: 'RKR2K A01', codigo_servicio: '12988994296', anio_fabricacion: 2024,
    notas: 'A verificar: Service Tag "5YT8854" (podría leerse "SYT8854") contra el equipo físico.',
    specs: { procesador: 'AMD Ryzen 7 7840HS con Radeon 780M, 3.80 GHz', ram_gb: 32, ram_velocidad: '5600 MT/s', gpu_dedicada: 'NVIDIA GeForce RTX 4060 Laptop 8 GB', gpu_integrada: 'AMD Radeon 780M (512 MB)', almacenamiento_gb: 477, so: 'Windows 11', nombre_windows: 'DELL-G15-PPC', usuario_windows: 'CONSTRUCTORA SCHEKER D... (CSD_CONTROL@outlook.com)', cargador_voltaje: '19.5V', cargador_amperaje: '16.92A' },
    fotos: ['foto-01-frente.jpeg', 'foto-02-base.jpeg', 'foto-03-etiqueta-serie.jpeg', 'foto-04-info-sistema.jpeg', 'foto-05-info-sistema-2.jpeg'],
  },
  {
    folder: '07_Laptop_Lenovo-IdeaPad-5-Pro-16ARH7_LENOVO-ENG',
    nombre: 'Laptop Lenovo IdeaPad 5 Pro 16ARH7 - LENOVO-ENG (Ingeniería)',
    tipo_clave: 'laptop', marca: 'Lenovo', modelo: 'IdeaPad 5 Pro 16ARH7 (tipo 82SN)', serie: null,
    estado: 'activo', condicion: 'funciona', costo: 650, responsable_externo: 'Eduardo Ng (Ingeniería)',
    service_tag: 'Plan ID 6229669 (LEN)',
    notas: 'Número de serie no visible — se saca con: wmic bios get serialnumber, o foto de la etiqueta. Id. del dispositivo: 662143F4-F49C-4BA7-9335-AE83657163BE / Id. del producto: 00326-10000-00000-AA928.',
    specs: { procesador: 'AMD Ryzen 5 6600HS Creator Edition, 3.30 GHz', ram_gb: 16, ram_velocidad: '6400 MT/s', gpu_dedicada: 'NVIDIA GeForce RTX 3050 Laptop 4 GB', gpu_integrada: 'AMD Radeon (2 GB)', almacenamiento_gb: 477, so: 'Windows 11 Home', so_version: '26H2', pantalla_pulgadas: 16, nombre_windows: 'LENOVO-ENG', usuario_windows: 'Eduardo Ng (@constructorasd.com)' },
    fotos: ['foto-01-frente.jpeg', 'foto-02-base-plan-id.jpeg', 'foto-03-base-detalle.jpeg', 'foto-04-info-sistema.jpeg', 'foto-05-info-sistema-2.jpeg', 'foto-06-screenshot-eduardo.png'],
  },
  {
    folder: '08_Laptop_Dell-Inspiron-15-DC15255_CSD-ING',
    nombre: 'Laptop Dell Inspiron 15 DC15255 - CSD-ING',
    tipo_clave: 'laptop', marca: 'Dell', modelo: 'Inspiron 15 DC15255', serie: '45B4XC4',
    estado: 'en_stock', condicion: 'funciona', costo: 450,
    modelo_regulatorio: 'P112F / P112F006', numero_parte: 'PMPPD A00', codigo_servicio: '9028166828', anio_fabricacion: 2025, etiqueta_taller: 'Sello de seguridad en la base: 20481616',
    specs: { procesador: 'AMD Ryzen 7 7730U con Radeon Graphics, 2.00 GHz', ram_gb: 16, ram_velocidad: '3200 MT/s', gpu_integrada: 'AMD Radeon integrada (496 MB)', almacenamiento_gb: 477, tactil: true, so: 'Windows 11', nombre_windows: 'CSD-ING', usuario_windows: "CSD ING'S (CSD_ING@outlook.com)", cargador_voltaje: '19.5V', cargador_amperaje: '3.34A' },
    fotos: ['foto-01-frente.jpeg', 'foto-02-base.jpeg', 'foto-03-etiqueta-serie.jpeg', 'foto-04-info-sistema.jpeg', 'foto-05-info-sistema-2.jpeg', 'foto-06-info-sistema-3.jpeg'],
  },
  {
    folder: '09_Laptop_Dell-Inspiron-15-P75F-2017_SIN-NOMBRE',
    nombre: 'Laptop Dell Inspiron 15 (P75F, 2017)',
    tipo_clave: 'laptop', marca: 'Dell', modelo: 'Inspiron 15 (Reg Model P75F)', serie: 'BJP8Z32',
    estado: 'en_reparacion', condicion: 'averiado', costo: 120,
    modelo_regulatorio: 'P75F / P75F001', numero_parte: '3W4G1 A01', codigo_servicio: '25135872158', anio_fabricacion: 2017,
    notas: 'NO ENCIENDE. Equipo antiguo (2017). Grieta en el borde del reposamanos junto a la tecla Ctrl. Marcas de desgaste/pintura levantada en la base. Faltan datos de RAM/almacenamiento (equipo apagado, no se pudo ver).',
    specs: { procesador: 'Intel Core i7 (generación no legible en el sticker)', gpu_integrada: 'AMD Radeon Graphics (sticker)', so: 'Windows 10 (sticker; equipo no se vio encendido)', cargador_voltaje: '19.5V', cargador_amperaje: '3.34A' },
    fotos: ['foto-01-frente.jpeg', 'foto-02-base.jpeg', 'foto-03-base-2.jpeg', 'foto-04-etiqueta-serie.jpeg', 'foto-05-detalle-grieta-teclado.jpeg', 'foto-06-lateral-puerto.jpeg'],
  },
  {
    folder: '10_Laptop_MSI-MS-16K5',
    nombre: 'Laptop MSI (modelo MS-16K5)',
    tipo_clave: 'laptop', marca: 'MSI', modelo: 'MS-16K5', serie: null,
    estado: 'en_reparacion', condicion: 'averiado', costo: 150,
    etiqueta_taller: 'Número 122052, fecha 29/12/2025 — parece orden de servicio técnico.',
    notas: 'NO ENCIENDE. Equipo apagado en las fotos, con polvo y marcas de uso. WiFi Intel Wireless-AC 9560, teclado SteelSeries, audio Dynaudio. Faltan RAM/almacenamiento/SO (equipo apagado).',
    specs: { procesador: 'Intel Core i7 (sticker; generación no legible)', gpu_dedicada: 'NVIDIA GeForce GTX (sticker; modelo no legible)', cargador_voltaje: '19.5V', cargador_amperaje: '9.23A' },
    fotos: ['foto-01-frente.jpeg', 'foto-02-base.jpeg', 'foto-03-etiqueta-serie.jpeg'],
  },
  {
    folder: '11_Radio_Motorola-EP350-MX_SN-1335YP6211',
    nombre: 'Radio Motorola EP350 MX (S/N 1335YP6211)',
    tipo_clave: 'walkie_talkie', marca: 'Motorola', modelo: 'EP350 MX (LAH03RDC8AB7AN)', serie: '1335YP6211',
    estado: 'en_stock', condicion: 'funciona', costo: 250,
    notas: 'Fabricado en Filipinas. Aprobado para Centro/Sudamérica, México y mayoría del Caribe (puede requerir licencia de estación). Accesorios vistos en el estuche: micrófono parlante, cargador, cajas de accesorios.',
    specs: { tipo_radio: 'frecuencia', sello_telserdom_bateria: '00004183', bateria_modelo: 'Motorola PMNN4476A', bateria_voltaje: '7.4V', accesorios: ['microfono parlante', 'cargador'] },
    fotos: ['foto-01-frente-en-estuche.jpeg', 'foto-02-trasera.jpeg', 'foto-03-abierto-bateria.jpeg', 'foto-04-etiqueta-detalle.jpeg'],
  },
  {
    folder: '12_Radio_Motorola-EP350-MX_SN-1335YP6375',
    nombre: 'Radio Motorola EP350 MX (S/N 1335YP6375)',
    tipo_clave: 'walkie_talkie', marca: 'Motorola', modelo: 'EP350 MX (LAH03RDC8AB7AN)', serie: '1335YP6375',
    estado: 'en_stock', condicion: 'funciona', costo: 250,
    notas: 'Fabricado en Filipinas.',
    specs: { tipo_radio: 'frecuencia', sello_telserdom_bateria: '0007916', bateria_modelo: 'Motorola PMNN4476A', bateria_capacidad: 1750, bateria_unidad: 'mAh', bateria_voltaje: '7.4V' },
    fotos: ['foto-01-lateral.jpeg', 'foto-02-trasera.jpeg', 'foto-03-abierto-bateria.jpeg'],
  },
  {
    folder: '13_Radio_Blackbox-Pocket-Plus',
    nombre: 'Radio Blackbox Pocket+ (PTT)',
    tipo_clave: 'walkie_talkie', marca: 'Blackbox', modelo: 'Pocket+', serie: null,
    estado: 'en_stock', condicion: 'funciona', costo: 100,
    notas: 'Radio PTT compacto (formato bolsillo), antena corta y clip de cinturón, botón PTT grande, cordón de mano. Sin serie/IMEI/etiqueta visible. Falta confirmar tecnología (PoC por red celular vs. radio de frecuencia).',
    specs: {},
    fotos: ['foto-01-frente.jpeg', 'foto-02-trasera-clip.jpeg'],
  },
  {
    folder: '14_Radio_tX-PRO-TX-600_SN-2401U00284',
    nombre: 'Radio tX PRO TX-600 (S/N 2401U00284)',
    tipo_clave: 'walkie_talkie', marca: 'tX PRO (Epcom)', modelo: 'TX-600', serie: '2401U00284',
    estado: 'en_stock', condicion: 'funciona', costo: 100,
    notas: 'Se ve cargando en su base. Sitio del fabricante: www.epcom.net.',
    specs: { frecuencia: '400-470 MHz (UHF)', potencia_w: 5, tipo_radio: 'frecuencia', sello_telserdom_bateria: '0007887', bateria_voltaje: '7.4V' },
    fotos: ['foto-01-frente.jpeg', 'foto-02-trasera-clip.jpeg', 'foto-03-abierto-etiqueta.jpeg', 'foto-04-en-cargador.jpeg'],
  },
  {
    folder: '15_Dron_AJAR-V918-MAX',
    nombre: 'Dron AJAR V918 MAX',
    tipo_clave: 'drone', marca: 'AJAR', modelo: 'V918 MAX', serie: null,
    estado: 'en_stock', condicion: 'por_diagnosticar', costo: 150,
    notas: 'Equipo con empaque original. Según Xaviel, uno de los dos drones (este o el del kit DJI) se dañó y del otro no se sabe dónde está — falta confirmar cuál es cuál. Sin número de serie visible. Falta ver batería, control y hélices de repuesto.',
    specs: { camara_specs: 'Doble cámara, GPS, evasión de obstáculos en 4 direcciones, WiFi 5 GHz, transmisión a pantalla', accesorios: ['cable USB de carga', 'piezas de repuesto en caja'] },
    fotos: ['foto-01-dron.jpeg', 'foto-02-caja.jpeg', 'foto-03-caja-interior-accesorios.jpeg'],
  },
  {
    folder: '16_Dron-DJI_kit-estuche-Lekufee',
    nombre: 'Kit DJI (estuche Lekufee)',
    tipo_clave: 'kit', marca: 'DJI', modelo: 'Estuche Lekufee (etiqueta interior: Mavic 3 Pro, modelo L2S)', serie: null,
    estado: 'en_stock', condicion: 'funciona', costo: 900,
    notas: 'Estuche rígido hermético marca Lekufee, con logo DJI, espuma de huevo con cavidades a medida. Etiqueta: DJI MAVIC 3 PRO, modelo L2S (CMIIT ID 2022...P20448, ANATEL 01296-23-06525). Etiqueta adicional número 110603 (posible código del estuche/lote). Registrado como kit — ver sus componentes.',
    specs: {},
    fotos: ['foto-01-estuche-abierto-contenido.jpeg', 'foto-02-estuche-cerrado.jpeg', 'foto-03-etiqueta-mavic-3-pro.jpeg'],
    kit: [
      { nombre: 'Goggles FPV DJI con correa', tipo_clave: 'accesorio', estado: 'en_stock', condicion: 'funciona', presente: true },
      { nombre: 'Control remoto DJI con pantalla integrada', tipo_clave: 'accesorio', estado: 'en_stock', condicion: 'funciona', presente: true },
      { nombre: 'Batería de vuelo DJI #1', tipo_clave: 'accesorio', estado: 'en_stock', condicion: 'funciona', presente: true },
      { nombre: 'Batería de vuelo DJI #2', tipo_clave: 'accesorio', estado: 'en_stock', condicion: 'funciona', presente: true },
      { nombre: 'Cargador/hub de carga DJI con cables', tipo_clave: 'accesorio', estado: 'en_stock', condicion: 'funciona', presente: true },
      { nombre: 'Dron DJI Mavic 3 Pro (L2S)', tipo_clave: 'drone', estado: 'extraviado', condicion: 'por_diagnosticar', presente: false,
        notas: 'Etiqueta del estuche: DJI Mavic 3 Pro, modelo L2S. NO está en el estuche — ubicación por confirmar (puede ser el dron dañado que menciona Xaviel, o el AJAR — falta confirmar cuál es cuál).' },
    ],
  },
];

async function subirFoto(localPath, destPath) {
  const ext = localPath.slice(localPath.lastIndexOf('.')).toLowerCase();
  const res = await fetch(`${env.url}/storage/v1/object/${BUCKET}/${destPath}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.serviceKey}`,
      apikey: env.serviceKey,
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'x-upsert': 'true',
    },
    body: readFileSync(localPath),
  });
  if (!res.ok) throw new Error(`storage ${res.status}: ${(await res.text()).slice(0, 300)}`);
}

function specsInsertSql(equipoId, specs) {
  const cols = Object.keys(specs);
  if (!cols.length) return null;
  const colSql = cols.join(', ');
  const valSql = cols.map((k) => {
    const v = specs[k];
    if (v === null || v === undefined) return 'null';
    if (typeof v === 'number') return NUM(v);
    if (typeof v === 'boolean') return BOOL(v);
    if (Array.isArray(v)) return ARR(v);
    return Q(v);
  }).join(', ');
  return `insert into sgc.tec_equipo_specs (equipo_id, ${colSql}) values ('${equipoId}'::uuid, ${valSql});`;
}

async function crearEquipo(e, kitPadreId = null) {
  const [{ id: tipoId }] = await dbQuery(env, `select id from sgc.tec_equipo_tipos where clave = ${Q(e.tipo_clave)}`);
  const bodegaRows = await dbQuery(env, `select id from sgc.bodegas where es_central = true limit 1`);
  const bodegaId = bodegaRows[0]?.id ?? null;

  const notasFinal = `${e.notas ? e.notas + ' ' : ''}[Cargado por Claude Code desde la ficha de Xaviel (registro 2026-10-26), ronda DA — revisar y corregir en la ficha.]`;

  const cols = {
    nombre: Q(e.nombre), tipo_id: Q(tipoId), tipo: Q(e.tipo_clave), marca: Q(e.marca ?? null), modelo: Q(e.modelo ?? null), serie: Q(e.serie ?? null),
    estado: Q(e.estado), condicion: Q(e.condicion),
    empleado_id: 'null',
    responsable_externo: Q(e.responsable_externo ?? null),
    bodega_id: kitPadreId ? 'null' : Q(bodegaId),
    ubicacion: kitPadreId ? 'null' : Q('Oficina Central'),
    costo: kitPadreId ? 'null' : NUM(e.costo ?? null),
    moneda: Q('USD'),
    costo_origen: Q('estimado'),
    fecha_compra_desconocida: 'true', garantia_desconocida: 'true',
    service_tag: Q(e.service_tag ?? null), numero_parte: Q(e.numero_parte ?? null), modelo_regulatorio: Q(e.modelo_regulatorio ?? null),
    anio_fabricacion: NUM(e.anio_fabricacion ?? null), codigo_anterior: Q(e.codigo_anterior ?? null),
    etiqueta_taller: Q(e.etiqueta_taller ?? null), codigo_servicio: Q(e.codigo_servicio ?? null),
    notas: Q(notasFinal),
    kit_padre_id: kitPadreId ? Q(kitPadreId) : 'null',
    presente: BOOL(e.presente ?? true),
  };
  const colNames = Object.keys(cols).join(', ');
  const colVals = Object.values(cols).join(', ');
  const [{ id, codigo }] = await dbQuery(env, `insert into sgc.tec_equipos (${colNames}) values (${colVals}) returning id, codigo;`);

  if (e.specs && Object.keys(e.specs).length) {
    const sql = specsInsertSql(id, e.specs);
    if (sql) await dbQuery(env, sql);
  }

  if (e.fotos?.length) {
    const folder = join(BASE, e.folder);
    const paths = [];
    for (const foto of e.fotos) {
      const local = join(folder, foto);
      if (!existsSync(local)) { console.log(`  ⚠ no existe: ${local}`); continue; }
      const dest = `tec-equipo/${id}/${foto}`;
      await subirFoto(local, dest);
      paths.push(dest);
    }
    if (paths.length) {
      const portada = paths[0];
      await dbQuery(env, `update sgc.tec_equipos set fotos = ${ARR(paths)}, foto_portada = ${Q(portada)}, foto_path = ${Q(portada)} where id = '${id}'::uuid;`);
    }
  }

  return { id, codigo };
}

async function main() {
  console.log(`\n═══ DA — cargar 16 equipos tecnológicos — ${env.entorno} — ${APPLY ? 'APLICAR' : 'DRY-RUN'} ═══\n`);

  const existentes = await dbQuery(env, `select serie from sgc.tec_equipos where serie is not null`);
  const seriesExistentes = new Set(existentes.map((r) => String(r.serie).trim()));
  if (seriesExistentes.size) {
    console.log(`(${env.entorno}: ${seriesExistentes.size} serie(s) ya en sgc.tec_equipos — se omite cualquier ficha que coincida, para no duplicar.)\n`);
  }

  const aOmitir = EQUIPOS.filter((e) => e.serie && seriesExistentes.has(String(e.serie).trim()));
  const aCrear = EQUIPOS.filter((e) => !(e.serie && seriesExistentes.has(String(e.serie).trim())));

  for (const e of aOmitir) {
    console.log(`⏭ OMITIDO (serie ${e.serie} ya existe en ${env.entorno}): ${e.nombre}`);
  }
  for (const e of aCrear) {
    const folder = join(BASE, e.folder);
    if (!existsSync(folder)) { console.log(`🔴 ${e.folder}: carpeta no encontrada, se omite.`); continue; }
    console.log(`• ${e.nombre}  (${e.fotos?.length ?? 0} foto(s)${e.kit ? `, kit con ${e.kit.length} componente(s)` : ''})`);
  }
  if (!APPLY) {
    console.log(`\nTotal a crear: ${aCrear.length} de ${EQUIPOS.length} equipos (${aOmitir.length} omitido(s) por duplicado de serie).`);
    console.log(`(DRY-RUN — nada creado. Repite con --apply para cargarlos de verdad en ${env.entorno}.)`);
    return;
  }

  const creados = [];
  for (const e of aCrear) {
    const folder = join(BASE, e.folder);
    if (!existsSync(folder)) { console.log(`🔴 ${e.folder}: carpeta no encontrada, se omite.`); continue; }
    const { id, codigo } = await crearEquipo(e);
    console.log(`✓ ${codigo} — ${e.nombre}`);
    creados.push({ codigo, nombre: e.nombre, id });

    if (e.kit?.length) {
      for (const c of e.kit) {
        const { id: cid, codigo: ccodigo } = await crearEquipo(c, id);
        console.log(`    ↳ ${ccodigo} — ${c.nombre}${c.presente === false ? ' (FALTA)' : ''}`);
        creados.push({ codigo: ccodigo, nombre: c.nombre, id: cid });
      }
    }
  }

  console.log(`\n${creados.length} fila(s) de tec_equipos creadas (equipos + componentes de kit).`);
  if (aOmitir.length) console.log(`${aOmitir.length} ficha(s) omitida(s) por duplicado de serie: ${aOmitir.map((e) => e.nombre).join(', ')}.`);
  console.log('Pendiente de Xaviel: equipo 02 — teclear la clave compartida real desde la ficha (nunca quedó escrita aquí); confirmar responsables externos y ubicación real; decidir cuál dron está dañado/perdido (15 vs. el del kit DJI).');
}

main().catch((e) => { console.error('🔴', e.message); process.exitCode = 1; });
