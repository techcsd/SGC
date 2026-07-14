-- ============================================================================
-- Ola 3 — CL-01..07: liberación con ciclo de firmas (CSD-OPE-01 §6.8).
-- Ítems reales del procedimiento. Regla de oro: ningún vaciado sin CL firmado.
-- ============================================================================
set search_path = sgc, public;

-- Corrige nombres CL-05/06/07 según el procedimiento (CL-06 encofrado, CL-07 armado).
update sgc.cl_plantillas set nombre='Encofrado de elementos verticales (Simmons)' where codigo='CL-05';
update sgc.cl_plantillas set nombre='Encofrado de elementos horizontales (Golliat)', fase='horizontal' where codigo='CL-06';
update sgc.cl_plantillas set nombre='Armado de elementos horizontales', fase='horizontal' where codigo='CL-07';

do $$
declare v uuid;
begin
  select id into v from sgc.cl_plantillas where codigo='CL-01';
  if not exists (select 1 from sgc.cl_plantilla_items where plantilla_id=v) then
    insert into sgc.cl_plantilla_items(plantilla_id,seccion,etiqueta,orden) values
      (v,'Replanteo','Replanteo verificado contra planos (ejes, dimensiones, niveles)',1),
      (v,'Excavación','Dimensiones de la excavación conformes',2),
      (v,'Excavación','Cota de fondo correcta',3),
      (v,'Excavación','Verticalidad de paredes / taludes adecuados',4),
      (v,'Excavación','Limpieza del fondo (sin material suelto)',5),
      (v,'Excavación','Ausencia de agua',6),
      (v,'Excavación','Tipo de suelo conforme al estudio',7),
      (v,'Seguridad','Interferencias verificadas (tuberías, cables, estructuras vecinas)',8),
      (v,'Seguridad','Condiciones seguras (entibado/taludes, señalización, barandas, accesos)',9),
      (v,'Topografía','Recepción topográfica realizada',10),
      (v,'Anexo','Plano anexo mapeado',11);
  end if;

  select id into v from sgc.cl_plantillas where codigo='CL-02';
  if not exists (select 1 from sgc.cl_plantilla_items where plantilla_id=v) then
    insert into sgc.cl_plantilla_items(plantilla_id,seccion,etiqueta,orden) values
      (v,'Acero','Acero recibido conforme (diámetros, Grado 60, sin corrosión/contaminación)',1),
      (v,'Armado','Diámetros conformes a plano',2),
      (v,'Armado','Cantidades / número de barras conforme',3),
      (v,'Armado','Separaciones conformes',4),
      (v,'Armado','Ganchos conformes',5),
      (v,'Armado','Traslapes conformes (longitud y ubicación)',6),
      (v,'Armado','Recubrimientos conformes',7),
      (v,'Armado','Limpieza del armado',8),
      (v,'Anexo','Plano anexo mapeado',9);
  end if;

  select id into v from sgc.cl_plantillas where codigo='CL-03';
  if not exists (select 1 from sgc.cl_plantilla_items where plantilla_id=v) then
    insert into sgc.cl_plantilla_items(plantilla_id,seccion,etiqueta,orden) values
      (v,'Encofrado','Dimensiones internas conformes',1),
      (v,'Encofrado','Plomo del encofrado',2),
      (v,'Encofrado','Nivel de vaciado marcado',3),
      (v,'Encofrado','Limpieza interior',4),
      (v,'Encofrado','Estabilidad / arriostramiento',5),
      (v,'Seguridad','Accesos y plataformas seguras para el vaciado',6),
      (v,'Anexo','Plano anexo mapeado',7);
  end if;

  select id into v from sgc.cl_plantillas where codigo='CL-04';
  if not exists (select 1 from sgc.cl_plantilla_items where plantilla_id=v) then
    insert into sgc.cl_plantilla_items(plantilla_id,seccion,etiqueta,orden) values
      (v,'Replanteo','Replanteo de arranque / cepos correctos',1),
      (v,'Armado','Diámetros conformes',2),
      (v,'Armado','Cantidades conformes',3),
      (v,'Armado','Separaciones conformes',4),
      (v,'Armado','Ganchos conformes',5),
      (v,'Armado','Traslapes conformes',6),
      (v,'Armado','Recubrimientos conformes',7),
      (v,'Anexo','Plano anexo mapeado',8);
  end if;

  select id into v from sgc.cl_plantillas where codigo='CL-05';
  if not exists (select 1 from sgc.cl_plantilla_items where plantilla_id=v) then
    insert into sgc.cl_plantilla_items(plantilla_id,seccion,etiqueta,orden) values
      (v,'Moldes','Moldes limpios con desmoldante',1),
      (v,'Encofrado','Plomo en ambas direcciones',2),
      (v,'Encofrado','Sección conforme',3),
      (v,'Encofrado','Alineación entre elementos',4),
      (v,'Encofrado','Alineadores fijos y apretados',5),
      (v,'Encofrado','Estanqueidad',6),
      (v,'Encofrado','Arriostramiento',7),
      (v,'Encofrado','Nivel de vaciado marcado',8),
      (v,'Encofrado','Ventanas de limpieza',9),
      (v,'Seguridad','Plataformas, líneas de vida y accesos seguros',10),
      (v,'Anexo','Plano anexo mapeado',11);
  end if;

  select id into v from sgc.cl_plantillas where codigo='CL-06';
  if not exists (select 1 from sgc.cl_plantilla_items where plantilla_id=v) then
    insert into sgc.cl_plantilla_items(plantilla_id,seccion,etiqueta,orden) values
      (v,'Encofrado','Niveles de fondo correctos',1),
      (v,'Encofrado','Apuntalamiento conforme (capacidad para cargas de vaciado)',2),
      (v,'Encofrado','Arriostramiento',3),
      (v,'Encofrado','Estanqueidad',4),
      (v,'Encofrado','Contraflechas aplicadas/confirmadas cuando corresponde',5),
      (v,'Seguridad','Seguridad del perímetro (barandas, accesos)',6),
      (v,'Anexo','Plano anexo mapeado',7);
  end if;

  select id into v from sgc.cl_plantillas where codigo='CL-07';
  if not exists (select 1 from sgc.cl_plantilla_items where plantilla_id=v) then
    insert into sgc.cl_plantilla_items(plantilla_id,seccion,etiqueta,orden) values
      (v,'Armado','Diámetros conformes',1),
      (v,'Armado','Cantidades conformes',2),
      (v,'Armado','Separaciones conformes',3),
      (v,'Armado','Ganchos, traslapes y recubrimientos conformes',4),
      (v,'Topografía','Niveles de fondo verificados (estación total)',5),
      (v,'Losa','Limpieza de la losa antes del vaciado',6),
      (v,'Anexo','Plano anexo mapeado',7);
  end if;
end $$;

-- Bucket 'obra' para media de ejecución (CL fotos/plano/firmas, charlas, pérdidas)
insert into storage.buckets (id, name, public) values ('obra','obra',false) on conflict (id) do nothing;
do $$ begin create policy obra_bucket_insert on storage.objects for insert to authenticated with check (bucket_id='obra'); exception when duplicate_object then null; end $$;
do $$ begin create policy obra_bucket_select on storage.objects for select to authenticated using (bucket_id='obra'); exception when duplicate_object then null; end $$;
do $$ begin create policy obra_bucket_update on storage.objects for update to authenticated using (bucket_id='obra') with check (bucket_id='obra'); exception when duplicate_object then null; end $$;

-- Un CL pasa a 'firmado' con firmas de residente + responsable + cliente.
create or replace function sgc.trg_cl_firmado() returns trigger language plpgsql
set search_path to 'sgc','pg_temp' as $$
begin
  update sgc.cl_registros r set estado='firmado', updated_at=now()
  where r.id = NEW.registro_id and r.estado <> 'firmado'
    and (select count(distinct rol) from sgc.cl_registro_firmas f
         where f.registro_id = r.id and f.rol in ('residente','responsable','cliente')) >= 3;
  return NEW;
end; $$;
drop trigger if exists trg_cl_firma on sgc.cl_registro_firmas;
create trigger trg_cl_firma after insert on sgc.cl_registro_firmas
  for each row execute function sgc.trg_cl_firmado();

-- Regla de oro reforzada: 'liberado'/'vaciado' requiere CL firmado (y sin NC abierta que bloquee).
create or replace function sgc.trg_nc_bloquea_vaciado() returns trigger language plpgsql
set search_path to 'sgc','pg_temp' as $$
begin
  if NEW.estado in ('liberado','vaciado') and (OLD.estado is distinct from NEW.estado) then
    if exists (select 1 from sgc.obra_no_conformidades nc
      where nc.estado='abierta' and nc.bloquea_vaciado
        and (nc.vaciado_id = NEW.id
             or (nc.vaciado_id is null
                 and nc.proyecto_id = NEW.proyecto_id
                 and (nc.elemento_id is null or nc.elemento_id = NEW.elemento_id)))) then
      raise exception 'No se puede % el vaciado: hay una No Conformidad abierta que lo bloquea.', NEW.estado;
    end if;
    if not exists (select 1 from sgc.cl_registros r where r.vaciado_id = NEW.id and r.estado='firmado') then
      raise exception 'No se puede % el vaciado: falta el checklist de liberación (CL) firmado.', NEW.estado;
    end if;
  end if;
  return NEW;
end; $$;

-- Captura offline (CSD App): registrar un CL con ítems, fotos y firmas (idempotente).
create or replace function sgc.registrar_cl_app(
  p_id uuid, p_proyecto_id uuid, p_plantilla_id uuid, p_elemento_id uuid, p_vaciado_id uuid,
  p_bloque text, p_eje text, p_plano_path text, p_observaciones text,
  p_items jsonb, p_fotos jsonb, p_firmas jsonb, p_capturado_en timestamptz
) returns uuid language plpgsql security definer set search_path to 'sgc','pg_temp' as $$
begin
  if auth.uid() is null then raise exception 'No autenticado'; end if;
  if not (sgc.is_admin() or sgc.tiene_modulo('proyectos') or sgc.tiene_modulo('bitacora')) then
    raise exception 'No autorizado';
  end if;
  if exists (select 1 from sgc.cl_registros where id = p_id) then return p_id; end if;

  insert into sgc.cl_registros (id, proyecto_id, plantilla_id, elemento_id, vaciado_id, bloque, eje, plano_path, observaciones, creado_por)
  values (p_id, p_proyecto_id, p_plantilla_id, p_elemento_id, p_vaciado_id, p_bloque, p_eje, p_plano_path, p_observaciones, auth.uid());
  insert into sgc.cl_registro_items (registro_id, etiqueta, seccion, cumple, comentario, orden)
  select p_id, i->>'etiqueta', i->>'seccion', (i->>'cumple')::boolean, i->>'comentario', coalesce((i->>'orden')::int,0)
  from jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) i;
  insert into sgc.cl_registro_fotos (registro_id, storage_path, correcto, descripcion)
  select p_id, f->>'storage_path', (f->>'correcto')::boolean, f->>'descripcion'
  from jsonb_array_elements(coalesce(p_fotos,'[]'::jsonb)) f where nullif(f->>'storage_path','') is not null;
  insert into sgc.cl_registro_firmas (registro_id, rol, usuario_id, nombre, firma_path, orden)
  select p_id, s->>'rol', nullif(s->>'usuario_id','')::uuid, s->>'nombre', s->>'firma_path', coalesce((s->>'orden')::int,0)
  from jsonb_array_elements(coalesce(p_firmas,'[]'::jsonb)) s;
  return p_id;
end; $$;
grant execute on function sgc.registrar_cl_app(uuid,uuid,uuid,uuid,uuid,text,text,text,text,jsonb,jsonb,jsonb,timestamptz) to authenticated, service_role;
