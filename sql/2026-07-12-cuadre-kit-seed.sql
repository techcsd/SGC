-- ============================================================================
-- A3.1 — Seed del Kit de inicio de obra (Excel Felipe Scheker) + RPC de copia.
-- Idempotente por (categoria, referencia).
-- ============================================================================
set search_path = sgc, public;

insert into sgc.kit_inicio_plantilla (categoria, referencia, unidad, cantidad, prorrateado, es_min_stock, orden)
select * from (values
  -- ── ALMACÉN ──────────────────────────────────────────────────────────────
  ('almacen','SIERRA MAKITA 7 1/4 ALÁMBRICA','unidad',4,false,true,1),
  ('almacen','DISCO DE CORTE TIPO SIERRA 7 1/4','unidad',32,false,true,2),
  ('almacen','DEMOLEDOR TOTAL HEXAGONAL 1500W','unidad',1,false,true,3),
  ('almacen','PATA DE CABRA DE 36"','unidad',6,false,true,4),
  ('almacen','MARTILLO DE CARPINTERO','unidad',3,false,true,5),
  ('almacen','SERRUCHO 22"','unidad',8,false,true,6),
  ('almacen','ESCUADRA METÁLICA 16X24','unidad',2,false,true,7),
  ('almacen','BARRA PARA TUMBAR TRUPER','unidad',5,false,true,8),
  ('almacen','NIVEL METÁLICO 48"','unidad',1,false,true,9),
  ('almacen','NIVEL METÁLICO 18"','unidad',6,false,true,10),
  ('almacen','CIZALLA 18"','unidad',2,false,true,11),
  ('almacen','POLOCHE AZUL (M & L)','unidad',6,false,true,12),
  ('almacen','POLOCHE VERDE (M & L)','unidad',24,false,true,13),
  ('almacen','EXTENSIÓN 100 PIES','unidad',2,false,true,14),
  ('almacen','CASCO SEGURIDAD AMARILLO','unidad',24,false,true,15),
  ('almacen','CHALECO MAMEY SENCILLO','unidad',24,false,true,16),
  ('almacen','GUANTES DE NITRILO','par',60,false,true,17),
  ('almacen','LENTES DE SEGURIDAD','unidad',60,false,true,18),
  ('almacen','HILO NYLON NO.18','unidad',2,false,true,19),
  ('almacen','CLAVO CORRIENTE 4" (CAJA 50LBS)','caja',36,true,true,20),
  ('almacen','CLAVO CORRIENTE 2 1/2" (CAJA 50LBS)','caja',27,true,true,21),
  ('almacen','CLAVO ACERO 4" (CAJA 50LBS)','caja',9,true,true,22),
  ('almacen','CLAVO ACERO 2 1/2" (CAJA 50LBS)','caja',18,true,true,23),
  ('almacen','VARILLITAS 1/4 (PAQ. 30UDS)','paquete',20,true,true,24),
  ('almacen','EXTENSIÓN PLANTA ELÉCTRICA 10 PIES (ENCHUFE WATERPROOF)','unidad',1,false,true,25),
  ('almacen','PLANTA ELÉCTRICA','unidad',1,false,true,26),
  ('almacen','EXTENSIÓN 100 PIES PARA CONTENEDOR (ENCHUFE WATERPROOF)','unidad',1,false,true,27),
  -- ── OFICINA ────────────────────────────────────────────────────────────────
  ('oficina','STARLINK','unidad',1,false,false,1),
  ('oficina','IMPRESORA 11X17 EPSON L14150 (CECOMSA)','unidad',1,false,false,2),
  ('oficina','RESMA DE PAPEL 8X11','resma',4,false,false,3),
  ('oficina','RESMA DE PAPEL 11X17','resma',1,false,false,4),
  ('oficina','PIZARRA BLANCA MAGNÉTICA 90X120CM','unidad',1,false,false,5),
  ('oficina','BORRADOR DE PIZARRA MAGNÉTICO','unidad',1,false,false,6),
  ('oficina','MARCADORES DE PIZARRA NEGRO','unidad',5,false,false,7),
  ('oficina','MARCADORES DE PIZARRA AZUL','unidad',3,false,false,8),
  ('oficina','MARCADORES DE PIZARRA ROJO','unidad',3,false,false,9),
  ('oficina','MARCADORES DE PIZARRA VERDE','unidad',3,false,false,10),
  ('oficina','CORRECTOR 9ML ARTESCO','unidad',1,false,false,11),
  ('oficina','RESALTADORES VARIOS','unidad',1,false,false,12),
  ('oficina','LAPICEROS AZUL','unidad',12,false,false,13),
  ('oficina','SACA GRAPA','unidad',1,false,false,14),
  ('oficina','GRAPADORA','unidad',1,false,false,15),
  ('oficina','GRAPA (PAQ)','paquete',1,false,false,16),
  ('oficina','PORTA TAPE','unidad',1,false,false,17),
  ('oficina','TAPE OFICINA','unidad',2,false,false,18),
  ('oficina','HUELLERO PELIKAN','unidad',1,false,false,19),
  ('oficina','TINTA PARA HUELLERO','unidad',1,false,false,20),
  ('oficina','CLICK (PAQ)','paquete',2,false,false,21),
  ('oficina','LIBRETA DE APUNTE AMARILLA (GRANDE)','unidad',4,false,false,22),
  ('oficina','LIBRETA DE APUNTE AMARILLA (PEQUEÑA)','unidad',4,false,false,23),
  ('oficina','PIZARRA CORCHO 17X23"','unidad',1,false,false,24),
  ('oficina','CHINCHETA (PAQ)','paquete',1,false,false,25),
  ('oficina','REGLA 30CM','unidad',2,false,false,26),
  ('oficina','TIJERA DE OFICINA','unidad',1,false,false,27),
  ('oficina','PORTA LAPICEROS','unidad',2,false,false,28),
  ('oficina','PORTA CLICK','unidad',1,false,false,29),
  ('oficina','PORTA BANDEJA DE 2','unidad',2,false,false,30),
  ('oficina','POST-STICK','unidad',4,false,false,31),
  ('oficina','ARCHIVERO MODULAR DE OFICINA','unidad',1,false,false,32),
  ('oficina','MESA MODULAR 70X140 (EBANISTA)','unidad',3,false,false,33),
  ('oficina','SILLA DE OFICINA MÓVIL GRIS','unidad',6,false,false,34),
  ('oficina','SMART TV 42"','unidad',1,false,false,35),
  ('oficina','BASE DE TV 2 BRAZOS','unidad',1,false,false,36),
  ('oficina','AIRE ACONDICIONADO 18MIL BTU, INVERTER','unidad',1,false,false,37),
  ('oficina','REGLETA DE 6 PUERTOS','unidad',2,false,false,38),
  ('oficina','PUERTA DE POLIMETAL BLANCA 90X210CM','unidad',1,false,false,39),
  ('oficina','VENTANA CORREDERA 120X100CM','unidad',2,false,false,40),
  ('oficina','ZAFACÓN METÁLICO PARA OFICINA','unidad',1,false,false,41),
  -- ── COCINA Y BAÑO ──────────────────────────────────────────────────────────
  ('cocina_bano','BEBEDERO NEGRO','unidad',1,false,false,1),
  ('cocina_bano','NEVERA EJECUTIVA NEGRA','unidad',1,false,false,2),
  ('cocina_bano','MICROONDAS NEGRO','unidad',1,false,false,3),
  ('cocina_bano','CAFETERA ELÉCTRICA NEGRA','unidad',1,false,false,4),
  ('cocina_bano','FREGADERO 1 BOCA, SENCILLO','unidad',1,false,false,5),
  ('cocina_bano','MEZCLADORA P/ FREGADERO','unidad',1,false,false,6),
  ('cocina_bano','INODORO BLANCO 1 PIEZA','unidad',1,false,false,7),
  ('cocina_bano','LAVAMANOS TIPO MUEBLE CON ESPEJO + MEZCLADORA','unidad',1,false,false,8),
  ('cocina_bano','PORTA PAPEL DE INODORO (DE PISO)','unidad',1,false,false,9),
  ('cocina_bano','ESCURRIDOR DE TRASTES','unidad',1,false,false,10),
  ('cocina_bano','JUEGO DE 6 VASOS DE ACRÍLICO','juego',1,false,false,11),
  ('cocina_bano','AMBIENTADOR','unidad',4,false,false,12),
  ('cocina_bano','JABÓN DE MANO LÍQUIDO','unidad',1,false,false,13),
  ('cocina_bano','JABÓN DE FREGAR LÍQUIDO','unidad',1,false,false,14),
  ('cocina_bano','ESPONJA DE FREGAR','unidad',2,false,false,15),
  ('cocina_bano','ZAFACÓN PARA BAÑO','unidad',1,false,false,16),
  ('cocina_bano','ZAFACÓN PARA COCINA','unidad',1,false,false,17),
  ('cocina_bano','PUERTA DE POLIMETAL BLANCA 80X210CM','unidad',1,false,false,18)
) as v(categoria, referencia, unidad, cantidad, prorrateado, es_min_stock, orden)
where not exists (
  select 1 from sgc.kit_inicio_plantilla k where k.categoria = v.categoria and k.referencia = v.referencia
);

-- RPC: copia la plantilla del kit al cuadre del proyecto (crea cabecera + items).
create or replace function sgc.copiar_kit_a_cuadre(p_proyecto_id uuid, p_bodega_id uuid)
returns int
language plpgsql
security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare v_ins int := 0;
begin
  if auth.uid() is null then raise exception 'No autenticado'; end if;
  if not (sgc.is_admin() or sgc.tiene_modulo('proyectos')) then
    raise exception 'No autorizado';
  end if;

  insert into sgc.cuadre_obra (proyecto_id, bodega_id)
  values (p_proyecto_id, p_bodega_id)
  on conflict (proyecto_id) do update set bodega_id = coalesce(excluded.bodega_id, sgc.cuadre_obra.bodega_id),
                                          updated_at = now();

  -- Copia el kit solo si el proyecto aún no tiene renglones de kit.
  if not exists (select 1 from sgc.cuadre_items where proyecto_id = p_proyecto_id and es_kit) then
    insert into sgc.cuadre_items
      (proyecto_id, descripcion, unidad, categoria, es_kit, prorrateado, es_min_stock,
       cantidad_total, est_f1, est_f2, est_f3, est_f4, orden)
    select p_proyecto_id, k.referencia, k.unidad, k.categoria, true, k.prorrateado, k.es_min_stock,
           k.cantidad, k.cantidad, 0, 0, 0, k.orden   -- kit = consumo de arranque (fase 1)
    from sgc.kit_inicio_plantilla k
    where k.activo
    order by k.categoria, k.orden;
    get diagnostics v_ins = row_count;
  end if;

  return v_ins;
end;
$$;
grant execute on function sgc.copiar_kit_a_cuadre(uuid, uuid) to authenticated, service_role;
