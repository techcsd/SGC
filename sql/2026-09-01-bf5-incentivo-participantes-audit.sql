-- ════════════════════════════════════════════════════════════════════════════
-- BF5 — "Gestionar participantes" del Desempeño de choferes (la UI de BA2).
--   El flag `participa_incentivo` (conductores) YA existe y es la ÚNICA fuente de
--   población (pantalla/correo/PDF/Compa leen ese flag). BF5 le pone:
--   (a) una vista de gestión en lote (RPC `incentivo_participantes`);
--   (b) AUDITORÍA de cada cambio (quién, cuándo, motivo) — es materia de pago;
--   (c) `set_participa_incentivo` pasa a registrar la auditoría.
--   NO toca el cálculo del puntaje ni la generación (cero riesgo a la nómina).
-- Aditivo/retrocompatible.
-- ════════════════════════════════════════════════════════════════════════════

begin;
set local search_path = sgc, public;

-- ── (a) Auditoría de participación ──────────────────────────────────────────
create table if not exists sgc.incentivo_participante_audit (
  id            uuid primary key default gen_random_uuid(),
  conductor_id  uuid not null references sgc.conductores(id) on delete cascade,
  usuario_id    uuid references sgc.usuarios(id),
  participa     boolean not null,
  motivo        text,
  cambiado_por  uuid references sgc.usuarios(id),
  cambiado_en   timestamptz not null default now()
);
comment on table sgc.incentivo_participante_audit is
  'BF5 — bitácora de cambios de participación en el incentivo (quién encendió/apagó a quién y por qué). Materia de pago.';
create index if not exists ix_incentivo_part_audit on sgc.incentivo_participante_audit (conductor_id, cambiado_en desc);

alter table sgc.incentivo_participante_audit enable row level security;
do $$ begin
  create policy incentivo_part_audit_sel on sgc.incentivo_participante_audit
    for select using (sgc.is_admin() or sgc.puede_gestionar_incentivos());
exception when duplicate_object then null; end $$;
grant select, insert on sgc.incentivo_participante_audit to authenticated, service_role;

-- ── (b) set_participa_incentivo con motivo + auditoría ──────────────────────
-- Se DROPea la firma 2-arg (para no dejar overload ambiguo con el default).
drop function if exists sgc.set_participa_incentivo(uuid, boolean);

create or replace function sgc.set_participa_incentivo(
  p_conductor_id uuid,
  p_participa    boolean,
  p_motivo       text default null
)
returns void
language plpgsql volatile security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare
  v_usuario_id uuid;
  v_antes      boolean;
begin
  if not (sgc.is_admin() or sgc.puede_gestionar_incentivos()) then
    raise exception 'No tienes permiso para cambiar la participación en el incentivo.';
  end if;

  select usuario_id, coalesce(participa_incentivo, true)
    into v_usuario_id, v_antes
    from sgc.conductores where id = p_conductor_id;
  if not found then raise exception 'Conductor no encontrado.'; end if;

  update sgc.conductores
     set participa_incentivo = coalesce(p_participa, true)
   where id = p_conductor_id;

  -- Solo audita si cambió (evita ruido).
  if v_antes is distinct from coalesce(p_participa, true) then
    insert into sgc.incentivo_participante_audit (conductor_id, usuario_id, participa, motivo, cambiado_por)
    values (p_conductor_id, v_usuario_id, coalesce(p_participa, true), nullif(trim(p_motivo), ''), auth.uid());
  end if;
end;
$$;
grant execute on function sgc.set_participa_incentivo(uuid, boolean, text) to authenticated;

-- ── (c) Listado de participantes (para la UI "Gestionar participantes") ─────
-- Todos los conductores (choferes reales) con su flag + prueba + rol, más el
-- último cambio de auditoría. Los sugeridos por defecto son los que tienen rol
-- chofer_transportista. Admin/gestor gated.
create or replace function sgc.incentivo_participantes()
returns table(
  conductor_id uuid, usuario_id uuid, nombre text,
  participa boolean, es_prueba boolean, es_chofer boolean,
  ultimo_cambio_en timestamptz, ultimo_cambio_por text, ultimo_motivo text
)
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select c.id, c.usuario_id, coalesce(u.nombre, c.nombre) as nombre,
         coalesce(c.participa_incentivo, true) as participa,
         coalesce(c.es_prueba, false) as es_prueba,
         exists (select 1 from sgc.usuarios_roles ur join sgc.roles r on r.id = ur.rol_id
                 where ur.usuario_id = c.usuario_id and r.codigo = 'chofer_transportista') as es_chofer,
         a.cambiado_en, au.nombre, a.motivo
    from sgc.conductores c
    left join sgc.usuarios u on u.id = c.usuario_id
    left join lateral (
      select cambiado_en, cambiado_por, motivo
        from sgc.incentivo_participante_audit x
       where x.conductor_id = c.id
       order by x.cambiado_en desc limit 1
    ) a on true
    left join sgc.usuarios au on au.id = a.cambiado_por
   where (sgc.is_admin() or sgc.puede_gestionar_incentivos())
     and coalesce(c.activo, true)
   order by coalesce(u.nombre, c.nombre);
$$;
grant execute on function sgc.incentivo_participantes() to authenticated;

commit;
