-- ============================================================================
-- AC7 — Conduces con DOS firmas capturadas (emisor + receptor) (30/07/2026)
-- ----------------------------------------------------------------------------
-- Hoy el cierre de conduce (`entregar_conduce`) captura solo la firma del
-- RECEPTOR (entrega_receptor / entrega_firma_path); el emisor queda solo como
-- entregado_por (uuid, sin firma). AC7: capturar también la firma de quien
-- entrega (chofer o almacén) y estampar AMBAS en el conduce (PDF/impresión).
--
-- Modelo: tabla hija `salida_firmas` (rol emisor|receptor) — extensible y limpia,
-- espeja el patrón de `cl_registro_firmas`. El receptor puede ser nombre libre
-- (no registrado) o un usuario registrado (se vincula usuario_id). Reutiliza el
-- bucket `conduces` (firma_path). `entregar_conduce` sigue igual para el cierre.
-- ============================================================================

set search_path = sgc, public;

create table if not exists sgc.salida_firmas (
  id          uuid primary key default gen_random_uuid(),
  salida_id   uuid not null references sgc.salidas_inventario(id) on delete cascade,
  rol         text not null check (rol in ('emisor','receptor')),
  nombre      text not null,
  cedula      text,
  rol_desc    text,                                   -- rol/relación de quien firma (p.ej. "Almacén", "Maestro de obra")
  usuario_id  uuid references sgc.usuarios(id),       -- si es un usuario registrado
  firma_path  text not null,                          -- path en el bucket `conduces`
  metodo      text not null default 'pad' check (metodo in ('pad','foto')),
  firmado_en  timestamptz not null default now(),
  created_at  timestamptz not null default now(),
  unique (salida_id, rol)                             -- una firma por rol y conduce
);

create index if not exists idx_salida_firmas_salida on sgc.salida_firmas(salida_id);

alter table sgc.salida_firmas enable row level security;

-- SELECT: mismo alcance que el conduce (creador / conductor asignado / elevado).
drop policy if exists salida_firmas_sel on sgc.salida_firmas;
create policy salida_firmas_sel on sgc.salida_firmas for select to authenticated
using (
  sgc.is_admin() or sgc.tiene_modulo('inventario')
  or exists (
    select 1 from sgc.salidas_inventario s
    where s.id = salida_firmas.salida_id
      and (
        s.creado_por = auth.uid()
        or exists (select 1 from sgc.conductores c where c.id = s.conductor_id and c.usuario_id = auth.uid())
      )
  )
);
-- La escritura va por el RPC firmar_conduce (SECURITY DEFINER); sin policy de INSERT directo.

comment on table sgc.salida_firmas is
  'AC7 — firmas capturadas del conduce (emisor/receptor). Imagen en bucket conduces (firma_path).';

-- ── RPC: firmar (upsert por rol) ────────────────────────────────────────────
create or replace function sgc.firmar_conduce(
  p_salida_id uuid,
  p_rol       text,
  p_nombre    text,
  p_firma_path text,
  p_cedula    text default null,
  p_rol_desc  text default null,
  p_metodo    text default 'pad',
  p_usuario_id uuid default null
) returns uuid
language plpgsql security definer
set search_path to 'sgc','pg_temp'
as $$
declare
  v_uid uuid := auth.uid();
  v_rol text := lower(coalesce(nullif(p_rol,''),''));
  v_id  uuid;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  if v_rol not in ('emisor','receptor') then raise exception 'Rol de firma inválido'; end if;
  if nullif(trim(coalesce(p_nombre,'')),'') is null then raise exception 'El nombre de quien firma es obligatorio'; end if;
  if nullif(p_firma_path,'') is null then raise exception 'Falta la imagen de la firma'; end if;

  -- Autorizado: admin / módulo inventario / conductor asignado / creador del conduce.
  if not (
    sgc.is_admin() or sgc.tiene_modulo('inventario')
    or exists (
      select 1 from sgc.salidas_inventario s
      where s.id = p_salida_id
        and (s.creado_por = v_uid
             or exists (select 1 from sgc.conductores c where c.id = s.conductor_id and c.usuario_id = v_uid))
    )
  ) then
    raise exception 'No tienes permiso para firmar este conduce';
  end if;

  insert into sgc.salida_firmas (salida_id, rol, nombre, cedula, rol_desc, usuario_id, firma_path, metodo)
  values (p_salida_id, v_rol, trim(p_nombre), nullif(p_cedula,''), nullif(p_rol_desc,''),
          p_usuario_id, p_firma_path, coalesce(nullif(p_metodo,''),'pad'))
  on conflict (salida_id, rol) do update
    set nombre = excluded.nombre, cedula = excluded.cedula, rol_desc = excluded.rol_desc,
        usuario_id = excluded.usuario_id, firma_path = excluded.firma_path,
        metodo = excluded.metodo, firmado_en = now()
  returning id into v_id;

  return v_id;
end;
$$;

grant execute on function sgc.firmar_conduce(uuid, text, text, text, text, text, text, uuid) to authenticated, service_role;
