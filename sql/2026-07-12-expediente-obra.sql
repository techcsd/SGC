-- ============================================================================
-- A8 — Expediente de inicio de obra (CSD-OPE-01 §6.1.1, Fase 0) — reunión 07/07/2026
-- ----------------------------------------------------------------------------
-- Checklist de documentos por proyecto (estado/responsable/adjunto). Ningún
-- frente inicia sin el expediente completo. Vive en el módulo Proyectos (gate
-- 'proyectos'), por lo que los roles de obra (que no tienen ese módulo) no ven
-- montos de contrato — los montos siguen restringidos a Gerencia/Legal/PPCC.
-- Los documentos "sin montos" se cargan ya depurados por Legal/PPCC.
--
-- Roadmap-compatible: se dejan libres los conceptos de elemento/frente y N° de
-- vaciado para las próximas features (CL-01..07, registro de vaciado, NC, etc.).
-- ============================================================================
set search_path = sgc, public;

create table if not exists sgc.expediente_obra (
  id           uuid primary key default gen_random_uuid(),
  proyecto_id  uuid not null references sgc.proyectos(id) on delete cascade,
  codigo       text not null,          -- tipo de documento (estable)
  nombre       text not null,          -- etiqueta legible
  area         text,                   -- Legal | PPCC | Producción | Cliente | Gerencia
  estado       text not null default 'pendiente',
  responsable_id uuid references sgc.usuarios(id),
  archivo_path text,                   -- adjunto en bucket sgc-documentos
  enlace       text,                   -- referencia interna (p.ej. Equipo de Obra / Kit)
  notas        text,
  orden        int not null default 0,
  validado_por uuid references sgc.usuarios(id),
  validado_en  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (proyecto_id, codigo),
  constraint expediente_obra_estado_chk check (estado in ('pendiente','cargado','validado','no_aplica'))
);

create index if not exists idx_expediente_obra_proyecto on sgc.expediente_obra(proyecto_id);

-- RLS: gestión documental de oficina → módulo proyectos (o legal) o admin.
alter table sgc.expediente_obra enable row level security;
drop policy if exists exp_obra_all on sgc.expediente_obra;
create policy exp_obra_all on sgc.expediente_obra for all to authenticated
  using (sgc.is_admin() or sgc.tiene_modulo('proyectos') or sgc.tiene_modulo('legal'))
  with check (sgc.is_admin() or sgc.tiene_modulo('proyectos') or sgc.tiene_modulo('legal'));

grant usage on schema sgc to authenticated;
grant select, insert, update, delete on sgc.expediente_obra to authenticated;
grant all on sgc.expediente_obra to service_role;

-- Siembra idempotente del expediente estándar (11 documentos §6.1.1).
create or replace function sgc.sembrar_expediente_obra(p_proyecto_id uuid)
returns int
language plpgsql
security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare
  v_ins int := 0;
begin
  if auth.uid() is null then raise exception 'No autenticado'; end if;
  if not (sgc.is_admin() or sgc.tiene_modulo('proyectos')) then
    raise exception 'No autorizado';
  end if;
  if exists (select 1 from sgc.expediente_obra where proyecto_id = p_proyecto_id) then
    return 0;
  end if;

  insert into sgc.expediente_obra (proyecto_id, codigo, nombre, area, orden)
  values
    (p_proyecto_id, 'resumen_contrato',  'Resumen de contrato (sin montos)',                       'Legal/PPCC',   1),
    (p_proyecto_id, 'alcance',           'Alcance exacto de los trabajos',                          'PPCC/Legal',   2),
    (p_proyecto_id, 'materiales_minimos','Lista de equipos y materiales mínimos (kit de inicio)',   'PPCC',         3),
    (p_proyecto_id, 'presupuesto_obra',  'Presupuesto de obra (sin montos de contrato)',            'PPCC',         4),
    (p_proyecto_id, 'cronograma',        'Cronograma inicial',                                      'PPCC/Producción', 5),
    (p_proyecto_id, 'plan_trabajo',      'Plan de trabajo',                                         'Producción',   6),
    (p_proyecto_id, 'organigrama',       'Organigrama de obra (Equipo de Obra)',                    'Producción',   7),
    (p_proyecto_id, 'diseno_encofrado',  'Diseño de encofrado',                                     'PPCC',         8),
    (p_proyecto_id, 'planos',            'Planos estructurales y arquitectónicos vigentes',         'Cliente/PPCC', 9),
    (p_proyecto_id, 'tolerancias',       'Tabla de tolerancias del proyecto',                       'PPCC',         10),
    (p_proyecto_id, 'acuerdos_inicio',   'Acuerdos de inicio (desencofrado, informe semanal, cubicaciones, títulos CDCRD/MIVHED)', 'Producción/Gerencia', 11);

  get diagnostics v_ins = row_count;
  return v_ins;
end;
$$;
grant execute on function sgc.sembrar_expediente_obra(uuid) to authenticated, service_role;

-- Vista de completitud para KPI (Dirección/dashboard). security_invoker → respeta RLS.
create or replace view sgc.v_expediente_obra_resumen
with (security_invoker = true) as
select
  p.id   as proyecto_id,
  p.nombre,
  count(e.id)                                            as total,
  count(e.id) filter (where e.estado = 'validado')       as validados,
  count(e.id) filter (where e.estado in ('pendiente','cargado')) as pendientes,
  (count(e.id) > 0 and count(e.id) filter (where e.estado in ('pendiente','cargado')) = 0) as completo
from sgc.proyectos p
left join sgc.expediente_obra e on e.proyecto_id = p.id
where p.activo = true and p.estado in ('planificacion','en_progreso','pausado')
group by p.id, p.nombre;

grant select on sgc.v_expediente_obra_resumen to authenticated;
