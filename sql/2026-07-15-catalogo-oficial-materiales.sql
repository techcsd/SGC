-- ============================================================================
-- Actualización 3 — V14: Catálogo OFICIAL de materiales CSD (hoja CAT-CSDAPP)
-- ----------------------------------------------------------------------------
-- 8 categorías oficiales (orden 01→08) como catálogo ACTIVO. ~180 artículos
-- con unidad/comentario. Mapeo por nombre homologado: 12 matches se
-- reasignan (preservando histórico/movimientos), 168 oficiales nuevos se insertan,
-- 77 existentes sin match → categoría "(Revisión)" DESACTIVADA (no se borran).
-- Flags: requiere_talla (EPP INDICAR TALLA), nota (atado/paquete/ref), subgrupo.
-- Aditivo/retrocompatible/idempotente. GENERADO por _catalog_build.cjs.
-- ============================================================================

set search_path = sgc, public;

-- 1) Columnas nuevas en articulos (aditivas).
alter table sgc.articulos
  add column if not exists requiere_talla boolean not null default false,
  add column if not exists nota text,
  add column if not exists subgrupo text,
  add column if not exists orden integer;

-- 2) Categorías oficiales (marcador estable en descripcion = CAT-CSDAPP-0N).
insert into sgc.categorias_inventario (nombre, descripcion, orden, activo, destacada)
select x.nombre, x.marker, x.orden, true, false from (values
    ('EPP (Equipos de Protección Personal)', 'CAT-CSDAPP-01', 1),
    ('Materia Prima (Madera, Palos, Plywood)', 'CAT-CSDAPP-02', 2),
    ('Materiales Consumibles', 'CAT-CSDAPP-03', 3),
    ('Equipos de Apuntalamiento', 'CAT-CSDAPP-04', 4),
    ('Moldes y Accesorios', 'CAT-CSDAPP-05', 5),
    ('Equipos y Herramientas', 'CAT-CSDAPP-06', 6),
    ('Material de Oficina', 'CAT-CSDAPP-07', 7),
    ('Otros', 'CAT-CSDAPP-08', 8)
) as x(nombre, marker, orden)
where not exists (select 1 from sgc.categorias_inventario c where c.descripcion = x.marker);

-- Refresca nombre/orden/estado de las oficiales (por si ya existían).
update sgc.categorias_inventario c set nombre = x.nombre, orden = x.orden, activo = true, destacada = false, padre_id = null
from (values
    ('EPP (Equipos de Protección Personal)', 'CAT-CSDAPP-01', 1),
    ('Materia Prima (Madera, Palos, Plywood)', 'CAT-CSDAPP-02', 2),
    ('Materiales Consumibles', 'CAT-CSDAPP-03', 3),
    ('Equipos de Apuntalamiento', 'CAT-CSDAPP-04', 4),
    ('Moldes y Accesorios', 'CAT-CSDAPP-05', 5),
    ('Equipos y Herramientas', 'CAT-CSDAPP-06', 6),
    ('Material de Oficina', 'CAT-CSDAPP-07', 7),
    ('Otros', 'CAT-CSDAPP-08', 8)
) as x(nombre, marker, orden) where c.descripcion = x.marker;

-- Categoría de revisión (desactivada) para lo que no matcheó.
insert into sgc.categorias_inventario (nombre, descripcion, orden, activo, destacada)
select '(Revisión) Artículos sin catálogo oficial', 'CAT-CSDAPP-REVISION', 999, false, false
where not exists (select 1 from sgc.categorias_inventario c where c.descripcion = 'CAT-CSDAPP-REVISION');

-- 3) Desactivar categorías viejas (el catálogo activo son solo las oficiales).
update sgc.categorias_inventario set activo = false
where coalesce(descripcion,'') not like 'CAT-CSDAPP-%';

-- 4) Reasignar artículos existentes que SÍ matchearon al catálogo oficial
--    (se preserva la fila → se conserva stock y movimientos).
update sgc.articulos set categoria_id=(select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-03'), unidad='UND', requiere_talla=false, nota=null, subgrupo=null, orden=24, activo=true where id='3bf8492b-9666-4f5a-a629-9fc2ecfce687'; -- HILO NYLON NO.18
update sgc.articulos set categoria_id=(select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-06'), unidad='UND', requiere_talla=false, nota='REF. TRUPER', subgrupo=null, orden=5, activo=true where id='030b0fc1-2018-404d-a684-6c27c3224e63'; -- MARTILLO DE CARPINTERO
update sgc.articulos set categoria_id=(select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-07'), unidad='UND', requiere_talla=false, nota=null, subgrupo=null, orden=35, activo=true where id='9c83b8c4-ef0c-4822-b846-ecc43d1ac615'; -- CHINCHETA (PAQ)
update sgc.articulos set categoria_id=(select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-07'), unidad='UND', requiere_talla=false, nota=null, subgrupo=null, orden=3, activo=true where id='04cdd565-0a50-473e-9751-0343e6a26298'; -- GRAPADORA
update sgc.articulos set categoria_id=(select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-07'), unidad='UND', requiere_talla=false, nota=null, subgrupo=null, orden=39, activo=true where id='294cc20a-5dac-4e36-b3e6-c393f52c4f67'; -- PORTA CLICK
update sgc.articulos set categoria_id=(select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-07'), unidad='UND', requiere_talla=false, nota=null, subgrupo=null, orden=38, activo=true where id='3bf7df6e-bbd2-4cf1-9db7-7614e02da4ac'; -- PORTA LAPICEROS
update sgc.articulos set categoria_id=(select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-07'), unidad='UND', requiere_talla=false, nota=null, subgrupo=null, orden=36, activo=true where id='80c1e63a-505c-4943-8f6b-2bb23a5b8bd3'; -- REGLA 30CM
update sgc.articulos set categoria_id=(select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-07'), unidad='UND', requiere_talla=false, nota=null, subgrupo=null, orden=37, activo=true where id='10f85d7e-f738-44bd-9c5a-ed5cd117a3e7'; -- TIJERA DE OFICINA
update sgc.articulos set categoria_id=(select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-03'), unidad='CAJA', requiere_talla=false, nota=null, subgrupo=null, orden=4, activo=true where id='847dc183-8183-4dc9-a9dc-628d8a564ac7'; -- CLAVO ACERO 2 1/2" (CAJA 50LBS)
update sgc.articulos set categoria_id=(select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-03'), unidad='CAJA', requiere_talla=false, nota=null, subgrupo=null, orden=3, activo=true where id='952a9ae8-7c1f-47cf-8e30-53ef4e03de48'; -- CLAVO ACERO 4" (CAJA 50LBS)
update sgc.articulos set categoria_id=(select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-03'), unidad='CAJA', requiere_talla=false, nota=null, subgrupo=null, orden=2, activo=true where id='6c787ea8-950d-414f-868f-9dd447f4427c'; -- CLAVO CORRIENTE 2 1/2" (CAJA 50LBS)
update sgc.articulos set categoria_id=(select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-03'), unidad='CAJA', requiere_talla=false, nota=null, subgrupo=null, orden=1, activo=true where id='fbe8370c-24b8-4443-9e6f-23a50b882567'; -- CLAVO CORRIENTE 4" (CAJA 50LBS)

-- 5) Mover existentes SIN match a (Revisión) y desactivarlos (sin borrar).
update sgc.articulos set categoria_id=(select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-REVISION'), activo=false where id='9f3cf91f-bcef-4095-b5ee-1a5b22b6c69b'; -- TEST Artículo Auto-código
update sgc.articulos set categoria_id=(select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-REVISION'), activo=false where id='82631641-2d42-4d8f-a371-c10077d78884'; -- TEST Artículo de Prueba
update sgc.articulos set categoria_id=(select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-REVISION'), activo=false where id='f6fbf8bc-0a5e-4e7c-9216-3cd1c32e7896'; -- VARILLITAS 1/4 (PAQ. 30UDS)
update sgc.articulos set categoria_id=(select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-REVISION'), activo=false where id='b8c955c2-d8fe-48a3-8ebc-b566a1dd1058'; -- no se
update sgc.articulos set categoria_id=(select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-REVISION'), activo=false where id='612129be-639a-4cd4-b64d-4c8e4951e405'; -- BARRA PARA TUMBAR TRUPER
update sgc.articulos set categoria_id=(select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-REVISION'), activo=false where id='dacc5a7d-eb77-4ec9-91eb-4bbe39ac0492'; -- CIZALLA 18"
update sgc.articulos set categoria_id=(select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-REVISION'), activo=false where id='eb0c478a-6e53-47dd-a6eb-dcc26decb381'; -- ESCUADRA METÁLICA 16X24
update sgc.articulos set categoria_id=(select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-REVISION'), activo=false where id='db7da290-1d8d-4914-9b96-7f38977b412e'; -- NIVEL METÁLICO 18"
update sgc.articulos set categoria_id=(select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-REVISION'), activo=false where id='bc3931a0-238a-40e8-a84c-53f95554d03a'; -- NIVEL METÁLICO 48"
update sgc.articulos set categoria_id=(select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-REVISION'), activo=false where id='5c88d03a-8afd-464e-9992-f050456153e1'; -- PATA DE CABRA DE 36"
update sgc.articulos set categoria_id=(select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-REVISION'), activo=false where id='a6948b92-b4d0-4690-8b6d-5f15859b83a6'; -- SERRUCHO 22"
update sgc.articulos set categoria_id=(select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-REVISION'), activo=false where id='93518f25-3f80-4ccf-8b54-d224a3090a82'; -- DEMOLEDOR TOTAL HEXAGONAL 1500W
update sgc.articulos set categoria_id=(select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-REVISION'), activo=false where id='e1736c9b-f632-4b5b-8474-248d7c382d50'; -- DISCO DE CORTE TIPO SIERRA 7 1/4
update sgc.articulos set categoria_id=(select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-REVISION'), activo=false where id='87c3002b-a32e-4fad-a703-6876273ae9c3'; -- EXTENSIÓN 100 PIES
update sgc.articulos set categoria_id=(select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-REVISION'), activo=false where id='53736c87-7218-4156-a308-dd730ddc619d'; -- EXTENSIÓN 100 PIES PARA CONTENEDOR (ENCHUFE WATERPROOF)
update sgc.articulos set categoria_id=(select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-REVISION'), activo=false where id='7413be26-7e5b-490b-aab2-940300b57dd7'; -- EXTENSIÓN PLANTA ELÉCTRICA 10 PIES (ENCHUFE WATERPROOF)
update sgc.articulos set categoria_id=(select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-REVISION'), activo=false where id='968c5ee9-e0c1-42ea-8e86-1e3c6796753b'; -- PLANTA ELÉCTRICA
update sgc.articulos set categoria_id=(select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-REVISION'), activo=false where id='c2b7bc65-7d4c-478a-8391-9915edf6659c'; -- SIERRA MAKITA 7 1/4 ALÁMBRICA
update sgc.articulos set categoria_id=(select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-REVISION'), activo=false where id='017878c3-208b-49ab-9b15-49736dc8afc4'; -- CASCO SEGURIDAD AMARILLO
update sgc.articulos set categoria_id=(select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-REVISION'), activo=false where id='3fd03f0e-e6b9-4376-9622-4cefff84f4a4'; -- CHALECO MAMEY SENCILLO
update sgc.articulos set categoria_id=(select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-REVISION'), activo=false where id='e1cdd285-7bd9-4622-b3d1-d925f53ca7f8'; -- GUANTES DE NITRILO
update sgc.articulos set categoria_id=(select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-REVISION'), activo=false where id='b27c1391-d39e-46c7-a8b6-0768ee83f2ca'; -- LENTES DE SEGURIDAD
update sgc.articulos set categoria_id=(select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-REVISION'), activo=false where id='caee78b8-36c0-4042-91db-4b836543ec7f'; -- POLOCHE AZUL (M & L)
update sgc.articulos set categoria_id=(select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-REVISION'), activo=false where id='a05296a6-4c23-4e87-984f-0c5b09b66af0'; -- POLOCHE VERDE (M & L)
update sgc.articulos set categoria_id=(select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-REVISION'), activo=false where id='a469b6fb-c251-4671-a7d9-e5be4bacdef1'; -- AIRE ACONDICIONADO 18MIL BTU, INVERTER
update sgc.articulos set categoria_id=(select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-REVISION'), activo=false where id='4926289e-acba-4371-814a-258bfb691188'; -- ARCHIVERO MODULAR DE OFICINA
update sgc.articulos set categoria_id=(select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-REVISION'), activo=false where id='c1a8d21d-6edc-46ca-bd52-8c9c73c86b63'; -- BASE DE TV 2 BRAZOS
update sgc.articulos set categoria_id=(select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-REVISION'), activo=false where id='829870b1-bac6-4636-893c-9a16fb418dc2'; -- BORRADOR DE PIZARRA MAGNÉTICO
update sgc.articulos set categoria_id=(select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-REVISION'), activo=false where id='8890d650-8e11-416f-bb5f-843e834edd48'; -- CLICK (PAQ)
update sgc.articulos set categoria_id=(select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-REVISION'), activo=false where id='8143f2e5-af52-4384-8b5e-318c7cc8537e'; -- CORRECTOR 9ML ARTESCO
update sgc.articulos set categoria_id=(select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-REVISION'), activo=false where id='87079f34-7715-4bf7-a87e-5fdaad23f99b'; -- GRAPA (PAQ)
update sgc.articulos set categoria_id=(select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-REVISION'), activo=false where id='499dad1e-48f0-4e29-a03b-283d0908361d'; -- HUELLERO PELIKAN
update sgc.articulos set categoria_id=(select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-REVISION'), activo=false where id='49fdee98-e382-4ff6-991f-e3ab32145d49'; -- IMPRESORA 11X17 EPSON L14150 (CECOMSA)
update sgc.articulos set categoria_id=(select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-REVISION'), activo=false where id='c0209ea7-9d87-439c-83ba-faeebbf3069e'; -- LAPICEROS AZUL
update sgc.articulos set categoria_id=(select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-REVISION'), activo=false where id='443d343b-3b4e-474c-85e3-4c71cc32050e'; -- LIBRETA DE APUNTE AMARILLA (GRANDE)
update sgc.articulos set categoria_id=(select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-REVISION'), activo=false where id='3824c900-9486-4ba6-99a2-07e022e72ac8'; -- LIBRETA DE APUNTE AMARILLA (PEQUEÑA)
update sgc.articulos set categoria_id=(select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-REVISION'), activo=false where id='49d40aca-a6b9-4e6f-9960-d71e44d99f57'; -- MARCADORES DE PIZARRA AZUL
update sgc.articulos set categoria_id=(select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-REVISION'), activo=false where id='f71d6606-a59d-417c-ad5b-c50b811686cd'; -- MARCADORES DE PIZARRA NEGRO
update sgc.articulos set categoria_id=(select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-REVISION'), activo=false where id='f8363034-ffda-4949-ad26-4e4bafbb2729'; -- MARCADORES DE PIZARRA ROJO
update sgc.articulos set categoria_id=(select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-REVISION'), activo=false where id='f33b71e3-8a45-4dc4-8397-275c738a37d0'; -- MARCADORES DE PIZARRA VERDE
update sgc.articulos set categoria_id=(select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-REVISION'), activo=false where id='2efff57f-dc93-43d0-b40a-24074b3df0d6'; -- MESA MODULAR 70X140 (EBANISTA)
update sgc.articulos set categoria_id=(select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-REVISION'), activo=false where id='6702fc8a-00be-431d-8fd4-21f86006dc08'; -- PIZARRA BLANCA MAGNÉTICA 90X120CM
update sgc.articulos set categoria_id=(select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-REVISION'), activo=false where id='07758014-51b9-4c5a-a4b4-e3fb8fcfa671'; -- PIZARRA CORCHO 17X23"
update sgc.articulos set categoria_id=(select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-REVISION'), activo=false where id='73ee1b9b-b8ed-426c-9134-9293e3402c7c'; -- PORTA BANDEJA DE 2
update sgc.articulos set categoria_id=(select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-REVISION'), activo=false where id='1974ae09-df52-4899-a264-f5d922097bec'; -- PORTA TAPE
update sgc.articulos set categoria_id=(select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-REVISION'), activo=false where id='6cf46e68-73a0-4c77-9481-8c3ee1affa33'; -- POST-STICK
update sgc.articulos set categoria_id=(select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-REVISION'), activo=false where id='3c4389d2-5dd7-4e5a-afc4-73d91ac49d54'; -- PUERTA DE POLIMETAL BLANCA 90X210CM
update sgc.articulos set categoria_id=(select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-REVISION'), activo=false where id='ee57f984-2181-4cca-a0bc-cf0f91e4fe2c'; -- REGLETA DE 6 PUERTOS
update sgc.articulos set categoria_id=(select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-REVISION'), activo=false where id='0069b9c6-29bd-4964-8e4c-a9141f039a1d'; -- RESALTADORES VARIOS
update sgc.articulos set categoria_id=(select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-REVISION'), activo=false where id='48de7a78-09a5-4919-ae46-44f559d26d60'; -- RESMA DE PAPEL 11X17
update sgc.articulos set categoria_id=(select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-REVISION'), activo=false where id='38b8e813-e8ec-439f-a951-4b6c6778cf04'; -- RESMA DE PAPEL 8X11
update sgc.articulos set categoria_id=(select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-REVISION'), activo=false where id='099d2de1-9737-4779-8f01-25a671a3695e'; -- SACA GRAPA
update sgc.articulos set categoria_id=(select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-REVISION'), activo=false where id='df83cba6-3f0b-4e8f-8d23-6fa0add34f60'; -- SILLA DE OFICINA MÓVIL GRIS
update sgc.articulos set categoria_id=(select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-REVISION'), activo=false where id='680fbbcf-51a4-42bc-b66b-7844e2710a8c'; -- SMART TV 42"
update sgc.articulos set categoria_id=(select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-REVISION'), activo=false where id='60fd0023-1030-4a3f-962c-09863a8e9106'; -- STARLINK
update sgc.articulos set categoria_id=(select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-REVISION'), activo=false where id='ed3ee3ea-2779-433a-8ad7-447832e2d254'; -- TAPE OFICINA
update sgc.articulos set categoria_id=(select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-REVISION'), activo=false where id='a74d9487-0d47-4287-b9b3-403bddb81337'; -- TINTA PARA HUELLERO
update sgc.articulos set categoria_id=(select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-REVISION'), activo=false where id='6c2cc225-aea5-4925-956f-174bba1423cd'; -- VENTANA CORREDERA 120X100CM
update sgc.articulos set categoria_id=(select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-REVISION'), activo=false where id='f0ef11bb-3312-453a-bb4d-9783e1d7ff6b'; -- ZAFACÓN METÁLICO PARA OFICINA
update sgc.articulos set categoria_id=(select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-REVISION'), activo=false where id='b204fc13-9c45-41ae-8a07-77b7ab1c4634'; -- AMBIENTADOR
update sgc.articulos set categoria_id=(select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-REVISION'), activo=false where id='78c7b675-ff5a-443f-856b-ee9d254451ee'; -- BEBEDERO NEGRO
update sgc.articulos set categoria_id=(select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-REVISION'), activo=false where id='d3e9af87-5a82-4350-b33a-96124db84c44'; -- CAFETERA ELÉCTRICA NEGRA
update sgc.articulos set categoria_id=(select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-REVISION'), activo=false where id='8bcc7985-aeb2-4176-a91c-672fd17177b9'; -- ESCURRIDOR DE TRASTES
update sgc.articulos set categoria_id=(select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-REVISION'), activo=false where id='e26883cf-7de1-4e30-b0a7-964d5cc01f5b'; -- ESPONJA DE FREGAR
update sgc.articulos set categoria_id=(select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-REVISION'), activo=false where id='567c5372-0397-41f9-869d-40d2eaeab555'; -- FREGADERO 1 BOCA, SENCILLO
update sgc.articulos set categoria_id=(select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-REVISION'), activo=false where id='c873cb1b-1caf-45b6-a3fb-275a3fe70eec'; -- INODORO BLANCO 1 PIEZA
update sgc.articulos set categoria_id=(select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-REVISION'), activo=false where id='84cb3764-cf11-4f98-be6a-2a0b91f60efa'; -- JABÓN DE FREGAR LÍQUIDO
update sgc.articulos set categoria_id=(select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-REVISION'), activo=false where id='1409d1b3-000e-4a8c-9f16-697ea03bb7c5'; -- JABÓN DE MANO LÍQUIDO
update sgc.articulos set categoria_id=(select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-REVISION'), activo=false where id='413f623d-9427-46d0-8a54-045c06cf4dda'; -- JUEGO DE 6 VASOS DE ACRÍLICO
update sgc.articulos set categoria_id=(select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-REVISION'), activo=false where id='aa3678ca-4335-4030-8c45-4a5d50479530'; -- LAVAMANOS TIPO MUEBLE CON ESPEJO + MEZCLADORA
update sgc.articulos set categoria_id=(select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-REVISION'), activo=false where id='80c1ddd1-ca6c-4bff-9f4d-0b200aee045b'; -- MEZCLADORA P/ FREGADERO
update sgc.articulos set categoria_id=(select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-REVISION'), activo=false where id='9151258f-f3f8-4bd8-9178-44a9ae8c8cc7'; -- MICROONDAS NEGRO
update sgc.articulos set categoria_id=(select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-REVISION'), activo=false where id='61f92572-03a7-4740-8d61-7aed175df22b'; -- NEVERA EJECUTIVA NEGRA
update sgc.articulos set categoria_id=(select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-REVISION'), activo=false where id='a8ddf872-ff6e-4310-882d-ff2d8c284f92'; -- PORTA PAPEL DE INODORO (DE PISO)
update sgc.articulos set categoria_id=(select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-REVISION'), activo=false where id='88cb0214-f341-4456-8b15-9a9df0a61ea4'; -- PUERTA DE POLIMETAL BLANCA 80X210CM
update sgc.articulos set categoria_id=(select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-REVISION'), activo=false where id='984a437e-c3d3-4afa-8fc7-3991e692699e'; -- ZAFACÓN PARA BAÑO
update sgc.articulos set categoria_id=(select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-REVISION'), activo=false where id='b2d12db4-bff2-4418-ac16-8c9d4d57d07b'; -- ZAFACÓN PARA COCINA

-- 6) Insertar artículos oficiales nuevos (idempotente por codigo).
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-01-001', 'CASCO SEGURIDAD AMARILLO + ARAÑA', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-01'), false, null, null, 1, true
where not exists (select 1 from sgc.articulos where codigo='CSD-01-001');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-01-002', 'CASCO SEGURIDAD BLANCO + ARAÑA', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-01'), false, null, null, 2, true
where not exists (select 1 from sgc.articulos where codigo='CSD-01-002');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-01-003', 'CHALECO REFLECTIVO SENCILLO MAMEY', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-01'), false, null, null, 3, true
where not exists (select 1 from sgc.articulos where codigo='CSD-01-003');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-01-004', 'CHALECO REFLECTIVO SENCILLO VERDE', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-01'), false, null, null, 4, true
where not exists (select 1 from sgc.articulos where codigo='CSD-01-004');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-01-005', 'CHALECO REFLECTIVO DE ING VERDE', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-01'), true, null, null, 5, true
where not exists (select 1 from sgc.articulos where codigo='CSD-01-005');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-01-006', 'CHALECO REFLECTIVO DE ING AZUL', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-01'), true, null, null, 6, true
where not exists (select 1 from sgc.articulos where codigo='CSD-01-006');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-01-007', 'GUANTES NITRILO ONESIZE', 'PAR', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-01'), false, null, null, 7, true
where not exists (select 1 from sgc.articulos where codigo='CSD-01-007');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-01-008', 'LENTES DE SEGURIDAD NEGROS', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-01'), false, null, null, 8, true
where not exists (select 1 from sgc.articulos where codigo='CSD-01-008');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-01-009', 'POLOCHE VERDE C/ FRANJA REFLECTIVA', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-01'), true, null, null, 9, true
where not exists (select 1 from sgc.articulos where codigo='CSD-01-009');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-01-010', 'POLOCHE ROJO C/ FRANJA REFLECTIVA', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-01'), true, null, null, 10, true
where not exists (select 1 from sgc.articulos where codigo='CSD-01-010');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-01-011', 'POLOCHE AZUL C/ FRANJA REFLECTIVA', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-01'), true, null, null, 11, true
where not exists (select 1 from sgc.articulos where codigo='CSD-01-011');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-01-012', 'BOTA DE SEGURIDAD C/ PUNTA Y SUELA REFORZADA', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-01'), true, null, null, 12, true
where not exists (select 1 from sgc.articulos where codigo='CSD-01-012');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-02-001', 'PINO BRUTO 2X4X14', 'PZA', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-02'), false, 'ATADO 120 PZA', 'Madera', 1, true
where not exists (select 1 from sgc.articulos where codigo='CSD-02-001');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-02-002', 'PINO BRUTO 2X6X14', 'PZA', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-02'), false, 'ATADO 80 PZA', 'Madera', 2, true
where not exists (select 1 from sgc.articulos where codigo='CSD-02-002');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-02-003', 'PINO BRUTO 2X8X14', 'PZA', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-02'), false, 'ATADO 60 PZA', 'Madera', 3, true
where not exists (select 1 from sgc.articulos where codigo='CSD-02-003');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-02-004', 'PINO BRUTO 2X4X12', 'PZA', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-02'), false, 'ATADO 120 PZA', 'Madera', 4, true
where not exists (select 1 from sgc.articulos where codigo='CSD-02-004');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-02-005', 'PINO BRUTO 2X6X12', 'PZA', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-02'), false, 'ATADO 80 PZA', 'Madera', 5, true
where not exists (select 1 from sgc.articulos where codigo='CSD-02-005');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-02-006', 'PINO BRUTO 2X8X12', 'PZA', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-02'), false, 'ATADO 60 PZA', 'Madera', 6, true
where not exists (select 1 from sgc.articulos where codigo='CSD-02-006');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-02-007', 'BIROTE LARGO 2X4 2.44M A3.05M', 'PZA', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-02'), false, null, 'Madera', 7, true
where not exists (select 1 from sgc.articulos where codigo='CSD-02-007');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-02-008', 'BIROTE LARGO 2X6 2.44M A3.05M', 'PZA', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-02'), false, null, 'Madera', 8, true
where not exists (select 1 from sgc.articulos where codigo='CSD-02-008');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-02-009', 'BIROTE LARGO 2X8 2.44M A3.05M', 'PZA', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-02'), false, null, 'Madera', 9, true
where not exists (select 1 from sgc.articulos where codigo='CSD-02-009');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-02-010', 'BIROTE 2X4 1.22M A 1.83M', 'PZA', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-02'), false, null, 'Madera', 10, true
where not exists (select 1 from sgc.articulos where codigo='CSD-02-010');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-02-011', 'BIROTE 2X8 1.22M A 1.83M', 'PZA', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-02'), false, null, 'Madera', 11, true
where not exists (select 1 from sgc.articulos where codigo='CSD-02-011');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-02-012', 'COSTILLA VIGA 2X6 1.22M A 1.83M', 'PZA', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-02'), false, null, 'Madera', 12, true
where not exists (select 1 from sgc.articulos where codigo='CSD-02-012');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-02-013', 'REPLANTEOS 50CM A 80CM', 'PZA', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-02'), false, null, 'Madera', 13, true
where not exists (select 1 from sgc.articulos where codigo='CSD-02-013');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-02-014', 'PLYWOOD FENOLICO 122X244', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-02'), false, null, 'Plywood', 14, true
where not exists (select 1 from sgc.articulos where codigo='CSD-02-014');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-02-015', 'TIRA PLYWOOD 61CM', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-02'), false, null, 'Plywood', 15, true
where not exists (select 1 from sgc.articulos where codigo='CSD-02-015');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-02-016', 'TIRA PLYWOOD 50 A 55CM', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-02'), false, null, 'Plywood', 16, true
where not exists (select 1 from sgc.articulos where codigo='CSD-02-016');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-02-017', 'TIRA PLYWOOD 35 A 45CM', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-02'), false, null, 'Plywood', 17, true
where not exists (select 1 from sgc.articulos where codigo='CSD-02-017');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-02-018', 'TIRA PLYWOOD 20CM A 30CM', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-02'), false, null, 'Plywood', 18, true
where not exists (select 1 from sgc.articulos where codigo='CSD-02-018');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-02-019', 'COMPLETIVOS PEQUEÑOS PLYWOOD', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-02'), false, null, 'Plywood', 19, true
where not exists (select 1 from sgc.articulos where codigo='CSD-02-019');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-02-020', 'PEDAZOS GRANDES PLYWOOD', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-02'), false, null, 'Plywood', 20, true
where not exists (select 1 from sgc.articulos where codigo='CSD-02-020');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-03-001', 'TIES 70CM', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-03'), false, 'PAQUETE DE 50 UDS', null, 5, true
where not exists (select 1 from sgc.articulos where codigo='CSD-03-001');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-03-002', 'TIES 60CM', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-03'), false, 'PAQUETE DE 50 UDS', null, 6, true
where not exists (select 1 from sgc.articulos where codigo='CSD-03-002');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-03-003', 'TIES 55CM', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-03'), false, 'PAQUETE DE 50 UDS', null, 7, true
where not exists (select 1 from sgc.articulos where codigo='CSD-03-003');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-03-004', 'TIES 50CM', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-03'), false, 'PAQUETE DE 50 UDS', null, 8, true
where not exists (select 1 from sgc.articulos where codigo='CSD-03-004');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-03-005', 'TIES 45CM', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-03'), false, 'PAQUETE DE 50 UDS', null, 9, true
where not exists (select 1 from sgc.articulos where codigo='CSD-03-005');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-03-006', 'TIES 40CM', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-03'), false, 'PAQUETE DE 50 UDS', null, 10, true
where not exists (select 1 from sgc.articulos where codigo='CSD-03-006');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-03-007', 'TIES 35CM', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-03'), false, 'PAQUETE DE 50 UDS', null, 11, true
where not exists (select 1 from sgc.articulos where codigo='CSD-03-007');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-03-008', 'TIES 30CM', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-03'), false, 'PAQUETE DE 50 UDS', null, 12, true
where not exists (select 1 from sgc.articulos where codigo='CSD-03-008');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-03-009', 'TIES 25CM', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-03'), false, 'PAQUETE DE 50 UDS', null, 13, true
where not exists (select 1 from sgc.articulos where codigo='CSD-03-009');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-03-010', 'TIES 20CM', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-03'), false, 'PAQUETE DE 50 UDS', null, 14, true
where not exists (select 1 from sgc.articulos where codigo='CSD-03-010');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-03-011', 'TIES 15CM', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-03'), false, 'PAQUETE DE 50 UDS', null, 15, true
where not exists (select 1 from sgc.articulos where codigo='CSD-03-011');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-03-012', 'TANQUE DE DESMOLDANTE PREMIUM', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-03'), false, null, null, 16, true
where not exists (select 1 from sgc.articulos where codigo='CSD-03-012');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-03-013', 'CUBETA DE DESMOLDANTE PREMIUM', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-03'), false, null, null, 17, true
where not exists (select 1 from sgc.articulos where codigo='CSD-03-013');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-03-014', 'GALON DE DESMOLDANTE PREMIUM', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-03'), false, null, null, 18, true
where not exists (select 1 from sgc.articulos where codigo='CSD-03-014');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-03-015', 'VARILLA DE AMARRE 1/4 X 20'' (PAQUETE DE 30 UDS)', 'PAQUETE', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-03'), false, null, null, 19, true
where not exists (select 1 from sgc.articulos where codigo='CSD-03-015');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-03-016', 'VARILLA LISA 5.5MM X 20'' (PAQUETE DE 30 UDS)', 'PAQUETE', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-03'), false, null, null, 20, true
where not exists (select 1 from sgc.articulos where codigo='CSD-03-016');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-03-017', 'DISCO DE CORTE SIERRA 7 1/4', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-03'), false, null, null, 21, true
where not exists (select 1 from sgc.articulos where codigo='CSD-03-017');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-03-018', 'DISCO DE CORTE METAL 14"', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-03'), false, null, null, 22, true
where not exists (select 1 from sgc.articulos where codigo='CSD-03-018');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-03-019', 'DISCO DE CORTE METAL 4 1/2"', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-03'), false, null, null, 23, true
where not exists (select 1 from sgc.articulos where codigo='CSD-03-019');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-04-001', 'PUNTAL METALICO 2.22M A 4.00M CSD', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-04'), false, null, 'CSD', 1, true
where not exists (select 1 from sgc.articulos where codigo='CSD-04-001');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-04-002', 'PUNTAL METALICO 2.12M A 3.00M CSD', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-04'), false, null, 'CSD', 2, true
where not exists (select 1 from sgc.articulos where codigo='CSD-04-002');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-04-003', 'CABEZAL DE PUNTAL CSD', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-04'), false, null, 'CSD', 3, true
where not exists (select 1 from sgc.articulos where codigo='CSD-04-003');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-04-004', 'TRIPODE PARA PUNTAL CSD', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-04'), false, null, 'CSD', 4, true
where not exists (select 1 from sgc.articulos where codigo='CSD-04-004');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-04-005', 'BASE NIVELADORA CSD', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-04'), false, null, 'CSD', 5, true
where not exists (select 1 from sgc.articulos where codigo='CSD-04-005');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-04-006', 'BASE 100X100CM CSD', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-04'), false, null, 'CSD', 6, true
where not exists (select 1 from sgc.articulos where codigo='CSD-04-006');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-04-007', 'FRAME 50X100CM CSD', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-04'), false, null, 'CSD', 7, true
where not exists (select 1 from sgc.articulos where codigo='CSD-04-007');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-04-008', 'CABEZAL AJUSTABLE CSD', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-04'), false, null, 'CSD', 8, true
where not exists (select 1 from sgc.articulos where codigo='CSD-04-008');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-04-009', 'DIAGONAL 100CM CSD', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-04'), false, null, 'CSD', 9, true
where not exists (select 1 from sgc.articulos where codigo='CSD-04-009');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-04-010', 'PUNTAL METALICO 2.22M A 4.00M EXTERNO', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-04'), false, null, 'Externo', 10, true
where not exists (select 1 from sgc.articulos where codigo='CSD-04-010');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-04-011', 'PUNTAL METALICO 2.12M A 3.00M EXTERNO', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-04'), false, null, 'Externo', 11, true
where not exists (select 1 from sgc.articulos where codigo='CSD-04-011');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-04-012', 'CABEZAL DE PUNTAL EXTERNO', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-04'), false, null, 'Externo', 12, true
where not exists (select 1 from sgc.articulos where codigo='CSD-04-012');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-04-013', 'TRIPODE PARA PUNTAL EXTERNO', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-04'), false, null, 'Externo', 13, true
where not exists (select 1 from sgc.articulos where codigo='CSD-04-013');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-04-014', 'FRAME 4X5'' EXTERNO', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-04'), false, null, 'Externo', 14, true
where not exists (select 1 from sgc.articulos where codigo='CSD-04-014');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-04-015', 'FRAME 4X6'' EXTERNO', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-04'), false, null, 'Externo', 15, true
where not exists (select 1 from sgc.articulos where codigo='CSD-04-015');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-04-016', 'BASE NIVELADORA EXTERNO', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-04'), false, null, 'Externo', 16, true
where not exists (select 1 from sgc.articulos where codigo='CSD-04-016');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-04-017', 'CABEZAL AJUSTABLE EXTERNO', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-04'), false, null, 'Externo', 17, true
where not exists (select 1 from sgc.articulos where codigo='CSD-04-017');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-04-018', 'CRUCETA 97" EXTERNO', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-04'), false, null, 'Externo', 18, true
where not exists (select 1 from sgc.articulos where codigo='CSD-04-018');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-04-019', 'CRUCETA 87" EXTERNO', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-04'), false, null, 'Externo', 19, true
where not exists (select 1 from sgc.articulos where codigo='CSD-04-019');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-04-020', 'COUPLING P/ FRAME EXTERNO', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-04'), false, null, 'Externo', 20, true
where not exists (select 1 from sgc.articulos where codigo='CSD-04-020');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-05-001', 'PANEL FILLER 24"X8'' (61X244CM) CSD', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-05'), false, null, 'CSD', 1, true
where not exists (select 1 from sgc.articulos where codigo='CSD-05-001');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-05-002', 'PANEL FILLER 22"X8'' (56X244CM) CSD', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-05'), false, null, 'CSD', 2, true
where not exists (select 1 from sgc.articulos where codigo='CSD-05-002');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-05-003', 'PANEL FILLER 20"X8'' (51X244CM) CSD', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-05'), false, null, 'CSD', 3, true
where not exists (select 1 from sgc.articulos where codigo='CSD-05-003');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-05-004', 'PANEL FILLER 18"X8'' (46X244CM) CSD', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-05'), false, null, 'CSD', 4, true
where not exists (select 1 from sgc.articulos where codigo='CSD-05-004');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-05-005', 'PANEL FILLER 16"X8'' (41X244CM) CSD', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-05'), false, null, 'CSD', 5, true
where not exists (select 1 from sgc.articulos where codigo='CSD-05-005');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-05-006', 'PANEL FILLER 14"X8'' (36X244CM) CSD', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-05'), false, null, 'CSD', 6, true
where not exists (select 1 from sgc.articulos where codigo='CSD-05-006');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-05-007', 'PANEL FILLER 12"X8'' (30X244CM) CSD', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-05'), false, null, 'CSD', 7, true
where not exists (select 1 from sgc.articulos where codigo='CSD-05-007');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-05-008', 'PANEL FILLER 10"X8'' (25X244CM) CSD', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-05'), false, null, 'CSD', 8, true
where not exists (select 1 from sgc.articulos where codigo='CSD-05-008');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-05-009', 'PANEL FILLER 8"X8'' (20X244CM) CSD', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-05'), false, null, 'CSD', 9, true
where not exists (select 1 from sgc.articulos where codigo='CSD-05-009');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-05-010', 'PANEL FILLER 6"X8'' (15X244CM) CSD', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-05'), false, null, 'CSD', 10, true
where not exists (select 1 from sgc.articulos where codigo='CSD-05-010');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-05-011', 'PANEL FILLER 4"X8'' (10X244CM) CSD', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-05'), false, null, 'CSD', 11, true
where not exists (select 1 from sgc.articulos where codigo='CSD-05-011');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-05-012', 'PANEL FILLER 2"X8'' (5X244CM) CSD', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-05'), false, null, 'CSD', 12, true
where not exists (select 1 from sgc.articulos where codigo='CSD-05-012');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-05-013', 'PANEL FILLER 1 1/2"X4'' (3.81X244CM) CSD', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-05'), false, null, 'CSD', 13, true
where not exists (select 1 from sgc.articulos where codigo='CSD-05-013');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-05-014', 'PANEL FILLER 1"X8'' (2.54X244CM) CSD', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-05'), false, null, 'CSD', 14, true
where not exists (select 1 from sgc.articulos where codigo='CSD-05-014');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-05-015', '8"X8'' OUTSIDE CORNER (ANGULAR 20CM) CSD', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-05'), false, null, 'CSD', 15, true
where not exists (select 1 from sgc.articulos where codigo='CSD-05-015');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-05-016', '8"X4'' OUTSIDE CORNER (ANGULAR 20CM) CSD', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-05'), false, null, 'CSD', 16, true
where not exists (select 1 from sgc.articulos where codigo='CSD-05-016');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-05-017', '8"X8'' INSIDE CORNER (ESQUINERO 20CM) CSD', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-05'), false, null, 'CSD', 17, true
where not exists (select 1 from sgc.articulos where codigo='CSD-05-017');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-05-018', '6"X8'' INSIDE CORNER (ESQUINERO 15CM) CSD', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-05'), false, null, 'CSD', 18, true
where not exists (select 1 from sgc.articulos where codigo='CSD-05-018');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-05-019', '6"X4'' INSIDE CORNER (ESQUINERO 15CM) CSD', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-05'), false, null, 'CSD', 19, true
where not exists (select 1 from sgc.articulos where codigo='CSD-05-019');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-05-020', 'ONE PIECE WALER CLAMP (PERROS) CSD', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-05'), false, null, 'CSD', 20, true
where not exists (select 1 from sgc.articulos where codigo='CSD-05-020');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-05-021', 'TURNBUCKLE (ALINEADORES) CSD', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-05'), false, null, 'CSD', 21, true
where not exists (select 1 from sgc.articulos where codigo='CSD-05-021');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-05-022', 'WEDGE BOLT (CUÑAS CORTAS) CSD', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-05'), false, null, 'CSD', 22, true
where not exists (select 1 from sgc.articulos where codigo='CSD-05-022');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-05-023', 'LONG BOLT (CUÑAS LARGAS) CSD', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-05'), false, null, 'CSD', 23, true
where not exists (select 1 from sgc.articulos where codigo='CSD-05-023');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-05-024', 'PANEL FILLER 24"X8'' (61X244CM) EXTERNO', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-05'), false, null, 'Externo', 24, true
where not exists (select 1 from sgc.articulos where codigo='CSD-05-024');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-05-025', 'PANEL FILLER 22"X8'' (56X244CM) EXTERNO', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-05'), false, null, 'Externo', 25, true
where not exists (select 1 from sgc.articulos where codigo='CSD-05-025');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-05-026', 'PANEL FILLER 20"X8'' (51X244CM) EXTERNO', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-05'), false, null, 'Externo', 26, true
where not exists (select 1 from sgc.articulos where codigo='CSD-05-026');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-05-027', 'PANEL FILLER 18"X8'' (46X244CM) EXTERNO', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-05'), false, null, 'Externo', 27, true
where not exists (select 1 from sgc.articulos where codigo='CSD-05-027');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-05-028', 'PANEL FILLER 16"X8'' (41X244CM) EXTERNO', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-05'), false, null, 'Externo', 28, true
where not exists (select 1 from sgc.articulos where codigo='CSD-05-028');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-05-029', 'PANEL FILLER 14"X8'' (36X244CM) EXTERNO', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-05'), false, null, 'Externo', 29, true
where not exists (select 1 from sgc.articulos where codigo='CSD-05-029');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-05-030', 'PANEL FILLER 12"X8'' (30X244CM) EXTERNO', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-05'), false, null, 'Externo', 30, true
where not exists (select 1 from sgc.articulos where codigo='CSD-05-030');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-05-031', 'PANEL FILLER 10"X8'' (25X244CM) EXTERNO', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-05'), false, null, 'Externo', 31, true
where not exists (select 1 from sgc.articulos where codigo='CSD-05-031');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-05-032', 'PANEL FILLER 8"X8'' (20X244CM) EXTERNO', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-05'), false, null, 'Externo', 32, true
where not exists (select 1 from sgc.articulos where codigo='CSD-05-032');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-05-033', 'PANEL FILLER 6"X8'' (15X244CM) EXTERNO', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-05'), false, null, 'Externo', 33, true
where not exists (select 1 from sgc.articulos where codigo='CSD-05-033');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-05-034', 'PANEL FILLER 4"X8'' (10X244CM) EXTERNO', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-05'), false, null, 'Externo', 34, true
where not exists (select 1 from sgc.articulos where codigo='CSD-05-034');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-05-035', 'PANEL FILLER 2"X8'' (5X244CM) EXTERNO', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-05'), false, null, 'Externo', 35, true
where not exists (select 1 from sgc.articulos where codigo='CSD-05-035');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-05-036', 'PANEL FILLER 1 1/2"X4'' (3.81X244CM) EXTERNO', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-05'), false, null, 'Externo', 36, true
where not exists (select 1 from sgc.articulos where codigo='CSD-05-036');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-05-037', 'PANEL FILLER 1"X8'' (2.54X244CM) EXTERNO', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-05'), false, null, 'Externo', 37, true
where not exists (select 1 from sgc.articulos where codigo='CSD-05-037');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-05-038', '8"X8'' OUTSIDE CORNER (ANGULAR 20CM) EXTERNO', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-05'), false, null, 'Externo', 38, true
where not exists (select 1 from sgc.articulos where codigo='CSD-05-038');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-05-039', '8"X4'' OUTSIDE CORNER (ANGULAR 20CM) EXTERNO', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-05'), false, null, 'Externo', 39, true
where not exists (select 1 from sgc.articulos where codigo='CSD-05-039');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-05-040', '8"X8'' INSIDE CORNER (ESQUINERO 20CM) EXTERNO', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-05'), false, null, 'Externo', 40, true
where not exists (select 1 from sgc.articulos where codigo='CSD-05-040');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-05-041', '6"X8'' INSIDE CORNER (ESQUINERO 15CM) EXTERNO', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-05'), false, null, 'Externo', 41, true
where not exists (select 1 from sgc.articulos where codigo='CSD-05-041');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-05-042', '6"X4'' INSIDE CORNER (ESQUINERO 15CM) EXTERNO', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-05'), false, null, 'Externo', 42, true
where not exists (select 1 from sgc.articulos where codigo='CSD-05-042');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-05-043', 'ONE PIECE WALER CLAMP (PERROS) EXTERNO', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-05'), false, null, 'Externo', 43, true
where not exists (select 1 from sgc.articulos where codigo='CSD-05-043');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-05-044', 'TURNBUCKLE (ALINEADORES) EXTERNO', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-05'), false, null, 'Externo', 44, true
where not exists (select 1 from sgc.articulos where codigo='CSD-05-044');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-05-045', 'WEDGE BOLT (CUÑAS CORTAS) EXTERNO', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-05'), false, null, 'Externo', 45, true
where not exists (select 1 from sgc.articulos where codigo='CSD-05-045');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-05-046', 'LONG BOLT (CUÑAS LARGAS) EXTERNO', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-05'), false, null, 'Externo', 46, true
where not exists (select 1 from sgc.articulos where codigo='CSD-05-046');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-06-001', 'DEMOLEDOR HEXAGONAL 1500W', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-06'), false, 'REF. TOTAL', null, 1, true
where not exists (select 1 from sgc.articulos where codigo='CSD-06-001');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-06-002', 'TALADRO ROTOMARTILLO', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-06'), false, 'REF. TOTAL / HILTI', null, 2, true
where not exists (select 1 from sgc.articulos where codigo='CSD-06-002');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-06-003', 'SIERRA 7" 1/4, ALAMBRICA', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-06'), false, 'REF. MAKITA', null, 3, true
where not exists (select 1 from sgc.articulos where codigo='CSD-06-003');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-06-004', 'CORTADORA DE METAL 14" (GUILLOTINA) , ALAMBRICA', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-06'), false, 'REF. MAKITA', null, 4, true
where not exists (select 1 from sgc.articulos where codigo='CSD-06-004');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-06-005', 'NIVEL METALICO 72 INCH', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-06'), false, null, null, 6, true
where not exists (select 1 from sgc.articulos where codigo='CSD-06-005');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-06-006', 'NIVEL METALICO 48 INCH', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-06'), false, null, null, 7, true
where not exists (select 1 from sgc.articulos where codigo='CSD-06-006');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-06-007', 'NIVEL METALICO 18 INCH', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-06'), false, null, null, 8, true
where not exists (select 1 from sgc.articulos where codigo='CSD-06-007');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-06-008', 'SERRUCHO 24 INCH', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-06'), false, null, null, 9, true
where not exists (select 1 from sgc.articulos where codigo='CSD-06-008');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-06-009', 'CIZALLA 18 INCH', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-06'), false, null, null, 10, true
where not exists (select 1 from sgc.articulos where codigo='CSD-06-009');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-06-010', 'BARRA DE FUERZA 1"X6''', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-06'), false, 'REF. TRUPER', null, 11, true
where not exists (select 1 from sgc.articulos where codigo='CSD-06-010');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-06-011', 'PULIDORA 4 1/2", 110W', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-06'), false, 'REF. TRUPER', null, 12, true
where not exists (select 1 from sgc.articulos where codigo='CSD-06-011');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-06-012', 'PATA DE CABRA 3/4" DE 45CM', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-06'), false, 'REF. TRUPER', null, 13, true
where not exists (select 1 from sgc.articulos where codigo='CSD-06-012');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-06-013', 'PATA DE CABRA 1" DE 120CM', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-06'), false, 'REF. TRUPER', null, 14, true
where not exists (select 1 from sgc.articulos where codigo='CSD-06-013');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-06-014', 'PATA DE CABRA DE 7/8 DE 105CM', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-06'), false, 'REF. TRUPER', null, 15, true
where not exists (select 1 from sgc.articulos where codigo='CSD-06-014');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-06-015', 'ALAMBRE VINIL 12/2', 'PIES', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-06'), false, null, null, 16, true
where not exists (select 1 from sgc.articulos where codigo='CSD-06-015');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-06-016', 'ENCHUFE INDUSTRIAL 120V', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-06'), false, null, null, 17, true
where not exists (select 1 from sgc.articulos where codigo='CSD-06-016');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-06-017', 'CAJA 2X4 + TAPA METALICA', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-06'), false, null, null, 18, true
where not exists (select 1 from sgc.articulos where codigo='CSD-06-017');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-06-018', 'T/C INDUSTRIAL 2P 120V', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-06'), false, null, null, 19, true
where not exists (select 1 from sgc.articulos where codigo='CSD-06-018');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-07-001', 'PAPEL 8 1/2 X 11 (CARTA) / REMA', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-07'), false, null, null, 1, true
where not exists (select 1 from sgc.articulos where codigo='CSD-07-001');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-07-002', 'PAPEL 11 X 17 (TABLOIDE) / REMA', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-07'), false, null, null, 2, true
where not exists (select 1 from sgc.articulos where codigo='CSD-07-002');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-07-003', 'GRAPAS (PAQUETE)', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-07'), false, null, null, 4, true
where not exists (select 1 from sgc.articulos where codigo='CSD-07-003');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-07-004', 'CLICKS (PAQUETE)', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-07'), false, null, null, 5, true
where not exists (select 1 from sgc.articulos where codigo='CSD-07-004');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-07-005', 'POST-IT (NOTAS ADHESIVAS)', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-07'), false, null, null, 6, true
where not exists (select 1 from sgc.articulos where codigo='CSD-07-005');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-07-006', 'HUELLERO DACTILAR', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-07'), false, 'REF. PELIKAN', null, 7, true
where not exists (select 1 from sgc.articulos where codigo='CSD-07-006');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-07-007', 'TINTA PARA HUELLERO DACTILAR', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-07'), false, 'REF. PELIKAN', null, 8, true
where not exists (select 1 from sgc.articulos where codigo='CSD-07-007');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-07-008', 'CLICKS BILLETEROS 15MM (CAJA)', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-07'), false, null, null, 9, true
where not exists (select 1 from sgc.articulos where codigo='CSD-07-008');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-07-009', 'CLICKS BILLETEROS 25MM (CAJA)', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-07'), false, null, null, 10, true
where not exists (select 1 from sgc.articulos where codigo='CSD-07-009');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-07-010', 'CLICKS BILLETEROS 41MM (CAJA)', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-07'), false, null, null, 11, true
where not exists (select 1 from sgc.articulos where codigo='CSD-07-010');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-07-011', 'FOLDER MANILA 8 1/2 X 11', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-07'), false, null, null, 12, true
where not exists (select 1 from sgc.articulos where codigo='CSD-07-011');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-07-012', 'FOLDER PLASTICO 8 1/2 X 11', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-07'), false, null, null, 13, true
where not exists (select 1 from sgc.articulos where codigo='CSD-07-012');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-07-013', 'FOLDER SATINADO CON BOLSILLO 8 1/2 X 11', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-07'), false, null, null, 14, true
where not exists (select 1 from sgc.articulos where codigo='CSD-07-013');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-07-014', 'MARCADOR DE PIZZARA BLANCA (PAQUETE COLORES VARIOS)', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-07'), false, null, null, 15, true
where not exists (select 1 from sgc.articulos where codigo='CSD-07-014');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-07-015', 'MARCADOR DE PIZZARA CRISTAL (PAQUETE COLORES VARIOS)', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-07'), false, null, null, 16, true
where not exists (select 1 from sgc.articulos where codigo='CSD-07-015');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-07-016', 'BANDEJA APILABLE / BANDEJA ARCHIVADOR', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-07'), false, null, null, 17, true
where not exists (select 1 from sgc.articulos where codigo='CSD-07-016');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-07-017', 'DISPENSADOR DE CINTA ADHESIVA', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-07'), false, null, null, 18, true
where not exists (select 1 from sgc.articulos where codigo='CSD-07-017');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-07-018', 'CINTA ADHESIVA HIGHLAND 3/4"', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-07'), false, null, null, 19, true
where not exists (select 1 from sgc.articulos where codigo='CSD-07-018');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-07-019', 'TINTA EPSON NEGRO 504 BOTELLA GRANDE', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-07'), false, null, null, 20, true
where not exists (select 1 from sgc.articulos where codigo='CSD-07-019');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-07-020', 'TINTA EPSON CIAN 504 BOTELLA PEQUEÑA', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-07'), false, null, null, 21, true
where not exists (select 1 from sgc.articulos where codigo='CSD-07-020');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-07-021', 'TINTA EPSON AMARILLO 504 BOTELLA PEQUEÑA', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-07'), false, null, null, 22, true
where not exists (select 1 from sgc.articulos where codigo='CSD-07-021');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-07-022', 'TINTA EPSON MAGENTA 504 BOTELLA PEQUEÑA', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-07'), false, null, null, 23, true
where not exists (select 1 from sgc.articulos where codigo='CSD-07-022');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-07-023', 'TINTA EPSON NEGRO 664 BOTELLA GRANDE', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-07'), false, null, null, 24, true
where not exists (select 1 from sgc.articulos where codigo='CSD-07-023');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-07-024', 'TINTA EPSON CIAN 664 BOTELLA PEQUEÑA', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-07'), false, null, null, 25, true
where not exists (select 1 from sgc.articulos where codigo='CSD-07-024');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-07-025', 'TINTA EPSON AMARILLO 664 BOTELLA PEQUEÑA', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-07'), false, null, null, 26, true
where not exists (select 1 from sgc.articulos where codigo='CSD-07-025');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-07-026', 'TINTA EPSON MAGENTA 664 BOTELLA PEQUEÑA', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-07'), false, null, null, 27, true
where not exists (select 1 from sgc.articulos where codigo='CSD-07-026');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-07-027', 'ARCHIVERO METALICO 3 GAVETAS', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-07'), false, null, null, 28, true
where not exists (select 1 from sgc.articulos where codigo='CSD-07-027');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-07-028', 'SILLA EJECUTIVA', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-07'), false, null, null, 29, true
where not exists (select 1 from sgc.articulos where codigo='CSD-07-028');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-07-029', 'NEVERA EJECUTIVA', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-07'), false, null, null, 30, true
where not exists (select 1 from sgc.articulos where codigo='CSD-07-029');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-07-030', 'BEBEDERO BOTELLON OCULTO', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-07'), false, null, null, 31, true
where not exists (select 1 from sgc.articulos where codigo='CSD-07-030');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-07-031', 'MICROONDAS ELECTRICO', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-07'), false, null, null, 32, true
where not exists (select 1 from sgc.articulos where codigo='CSD-07-031');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-07-032', 'CAFETERA ELECTRICA', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-07'), false, null, null, 33, true
where not exists (select 1 from sgc.articulos where codigo='CSD-07-032');
insert into sgc.articulos (codigo, nombre, unidad, categoria_id, requiere_talla, nota, subgrupo, orden, activo)
select 'CSD-07-033', 'PIZARRA BLANCA 36" X 24"', 'UND', (select id from sgc.categorias_inventario where descripcion='CAT-CSDAPP-07'), false, null, null, 34, true
where not exists (select 1 from sgc.articulos where codigo='CSD-07-033');
