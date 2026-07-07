-- Two changes to the document-template engine:
--   1. Separate "who can CREATE/edit templates" from "who can GENERATE documents".
--      A new 'plantillas' module gates template authoring; everyone with the
--      'documentos' module can still generate documents from existing templates
--      (keeps the data structured — only trusted roles add templates).
--   2. Seed additional ready-to-use construction contract templates.

-- ── RBAC: template management now needs the 'plantillas' module ──
drop policy "plantillas_documento: select" on sgc.plantillas_documento;
drop policy "plantillas_documento: insert" on sgc.plantillas_documento;
drop policy "plantillas_documento: update" on sgc.plantillas_documento;
drop policy "plantillas_documento: delete" on sgc.plantillas_documento;

-- Anyone who can generate documents can read templates…
create policy "plantillas_documento: select" on sgc.plantillas_documento for select to authenticated
  using (sgc.is_admin() or sgc.tiene_modulo('documentos') or sgc.tiene_modulo('plantillas'));
-- …but only template managers can create / edit / retire them.
create policy "plantillas_documento: insert" on sgc.plantillas_documento for insert to authenticated
  with check (sgc.is_admin() or sgc.tiene_modulo('plantillas'));
create policy "plantillas_documento: update" on sgc.plantillas_documento for update to authenticated
  using (sgc.is_admin() or sgc.tiene_modulo('plantillas'));
create policy "plantillas_documento: delete" on sgc.plantillas_documento for delete to authenticated
  using (sgc.is_admin() or sgc.tiene_modulo('plantillas'));

-- Grant the new module to admin (recurring gotcha) and to the Abogado role, who
-- naturally owns contract templates.
update sgc.roles set modulos = array_append(modulos, 'plantillas')
  where codigo = 'admin' and not ('plantillas' = any(modulos));
update sgc.roles set modulos = array_append(modulos, 'plantillas')
  where codigo = 'abogado' and not ('plantillas' = any(modulos));

-- ── Seed construction contract templates (idempotent by nombre) ──
insert into sgc.plantillas_documento (nombre, categoria, contenido_html, campos, origen)
select * from (values
  (
    'Contrato de Trabajo (tiempo indefinido)',
    'contrato',
    '<h2 style="text-align:center">CONTRATO DE TRABAJO</h2>
<p>Entre <strong>Constructora S&amp;D</strong>, RNC {{rnc_empresa}}, representada por {{representante_empresa}} (EL EMPLEADOR), y {{nombre_empleado}}, portador de la cédula No. {{cedula_empleado}} (EL TRABAJADOR), se acuerda lo siguiente:</p>
<p><strong>PRIMERO — Cargo:</strong> EL TRABAJADOR desempeñará el cargo de {{cargo}} en la obra/oficina ubicada en {{lugar_trabajo}}.</p>
<p><strong>SEGUNDO — Salario:</strong> Se pagará un salario de RD$ {{salario}} de forma {{periodicidad_pago}}.</p>
<p><strong>TERCERO — Jornada:</strong> La jornada de trabajo será de {{horario}}.</p>
<p><strong>CUARTO — Inicio:</strong> El presente contrato inicia el {{fecha_inicio}} por tiempo indefinido.</p>
<p>Firmado en {{ciudad}}, el {{fecha_firma}}.</p>
<p style="margin-top:48px">_____________________________<br/>EL EMPLEADOR</p>
<p style="margin-top:24px">_____________________________<br/>EL TRABAJADOR</p>',
    '[
      {"key":"rnc_empresa","label":"RNC de la empresa","tipo":"texto"},
      {"key":"representante_empresa","label":"Representante de la empresa","tipo":"texto"},
      {"key":"nombre_empleado","label":"Nombre del empleado","tipo":"texto"},
      {"key":"cedula_empleado","label":"Cédula del empleado","tipo":"texto"},
      {"key":"cargo","label":"Cargo","tipo":"texto"},
      {"key":"lugar_trabajo","label":"Lugar de trabajo","tipo":"texto"},
      {"key":"salario","label":"Salario (RD$)","tipo":"texto"},
      {"key":"periodicidad_pago","label":"Periodicidad de pago","tipo":"texto"},
      {"key":"horario","label":"Horario / jornada","tipo":"texto"},
      {"key":"fecha_inicio","label":"Fecha de inicio","tipo":"texto"},
      {"key":"ciudad","label":"Ciudad","tipo":"texto"},
      {"key":"fecha_firma","label":"Fecha de firma","tipo":"texto"}
    ]'::jsonb,
    'sistema'
  ),
  (
    'Contrato de Alquiler de Equipos',
    'contrato',
    '<h2 style="text-align:center">CONTRATO DE ALQUILER DE EQUIPOS</h2>
<p>Entre {{arrendador}} (EL ARRENDADOR) y <strong>Constructora S&amp;D</strong> (EL ARRENDATARIO), se acuerda el alquiler del/los siguiente(s) equipo(s):</p>
<p><strong>Equipo:</strong> {{descripcion_equipo}}</p>
<p><strong>PRIMERO — Tarifa:</strong> RD$ {{tarifa}} por {{unidad_tarifa}}.</p>
<p><strong>SEGUNDO — Período:</strong> Desde el {{fecha_inicio}} hasta el {{fecha_fin}}, para uso en la obra {{obra}}.</p>
<p><strong>TERCERO — Responsabilidad:</strong> EL ARRENDATARIO se responsabiliza del buen uso del equipo durante el período de alquiler.</p>
<p>Firmado en {{ciudad}}, el {{fecha_firma}}.</p>
<p style="margin-top:48px">_____________________________<br/>EL ARRENDADOR</p>
<p style="margin-top:24px">_____________________________<br/>EL ARRENDATARIO</p>',
    '[
      {"key":"arrendador","label":"Arrendador (dueño del equipo)","tipo":"texto"},
      {"key":"descripcion_equipo","label":"Descripción del equipo","tipo":"texto"},
      {"key":"tarifa","label":"Tarifa (RD$)","tipo":"texto"},
      {"key":"unidad_tarifa","label":"Unidad (día/semana/mes)","tipo":"texto"},
      {"key":"fecha_inicio","label":"Fecha de inicio","tipo":"texto"},
      {"key":"fecha_fin","label":"Fecha de fin","tipo":"texto"},
      {"key":"obra","label":"Obra donde se usará","tipo":"texto"},
      {"key":"ciudad","label":"Ciudad","tipo":"texto"},
      {"key":"fecha_firma","label":"Fecha de firma","tipo":"texto"}
    ]'::jsonb,
    'sistema'
  ),
  (
    'Contrato de Servicios Profesionales',
    'contrato',
    '<h2 style="text-align:center">CONTRATO DE SERVICIOS PROFESIONALES</h2>
<p>Entre <strong>Constructora S&amp;D</strong> (EL CONTRATANTE) y {{nombre_contratista}}, cédula/RNC {{id_contratista}} (EL CONTRATISTA), se acuerda:</p>
<p><strong>PRIMERO — Objeto:</strong> EL CONTRATISTA prestará los servicios de {{descripcion_servicio}} para el proyecto {{obra}}.</p>
<p><strong>SEGUNDO — Honorarios:</strong> RD$ {{monto}}, pagaderos {{forma_pago}}.</p>
<p><strong>TERCERO — Plazo:</strong> Los servicios se prestarán desde el {{fecha_inicio}} hasta el {{fecha_fin}}.</p>
<p><strong>CUARTO — Naturaleza:</strong> Este contrato no genera relación laboral; EL CONTRATISTA actúa de forma independiente.</p>
<p>Firmado en {{ciudad}}, el {{fecha_firma}}.</p>
<p style="margin-top:48px">_____________________________<br/>EL CONTRATANTE</p>
<p style="margin-top:24px">_____________________________<br/>EL CONTRATISTA</p>',
    '[
      {"key":"nombre_contratista","label":"Nombre del contratista","tipo":"texto"},
      {"key":"id_contratista","label":"Cédula / RNC del contratista","tipo":"texto"},
      {"key":"descripcion_servicio","label":"Descripción del servicio","tipo":"texto"},
      {"key":"obra","label":"Proyecto / obra","tipo":"texto"},
      {"key":"monto","label":"Honorarios (RD$)","tipo":"texto"},
      {"key":"forma_pago","label":"Forma de pago","tipo":"texto"},
      {"key":"fecha_inicio","label":"Fecha de inicio","tipo":"texto"},
      {"key":"fecha_fin","label":"Fecha de fin","tipo":"texto"},
      {"key":"ciudad","label":"Ciudad","tipo":"texto"},
      {"key":"fecha_firma","label":"Fecha de firma","tipo":"texto"}
    ]'::jsonb,
    'sistema'
  )
) as nuevas(nombre, categoria, contenido_html, campos, origen)
where not exists (
  select 1 from sgc.plantillas_documento p where p.nombre = nuevas.nombre
);
