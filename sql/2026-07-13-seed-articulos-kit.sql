-- Siembra el catálogo de artículos a partir del kit de inicio de obra (Excel
-- Felipe Scheker), para que Almacén registre entradas seleccionando artículos ya creados.
set search_path = sgc, public;

insert into sgc.categorias_inventario (nombre, descripcion, activo)
select 'Oficina', 'Equipos y suministros de oficina de obra', true
where not exists (select 1 from sgc.categorias_inventario where nombre='Oficina');
insert into sgc.categorias_inventario (nombre, descripcion, activo)
select 'Cocina y Baño', 'Enseres de cocina y baño de la oficina de obra', true
where not exists (select 1 from sgc.categorias_inventario where nombre='Cocina y Baño');

insert into sgc.articulos (codigo, nombre, categoria_id, unidad, stock_minimo, activo)
select
  upper(left(k.categoria,3)) || '-' || lpad((row_number() over (partition by k.categoria order by k.orden))::text, 3, '0') as codigo,
  k.referencia as nombre,
  case k.categoria
    when 'almacen' then case
        when k.referencia ~* 'casco|chaleco|guante|lente|poloche' then 12          -- EPP
        when k.referencia ~* 'clavo|varill|hilo' then 3                            -- consumibles
        when k.referencia ~* 'sierra|disco|demoledor|planta|extensi' then 11       -- eléctricos
        else 10 end                                                                -- herramientas manuales
    when 'oficina' then (select id from sgc.categorias_inventario where nombre='Oficina')
    when 'cocina_bano' then (select id from sgc.categorias_inventario where nombre='Cocina y Baño')
    else 2 end as categoria_id,
  coalesce(nullif(k.unidad,''), 'unidad') as unidad,
  0 as stock_minimo,
  true as activo
from sgc.kit_inicio_plantilla k
where k.activo
  and not exists (select 1 from sgc.articulos a where lower(a.nombre) = lower(k.referencia));
