-- Ronda 11 · Z3 — Reglas de firma de liberación
--   (a) La liberación queda 'firmado' cuando firma RESPONSABLE **o** RESIDENTE
--       (uno de los dos basta; cliente y MIVHED siguen opcionales — Q5).
--   (b) Sustituibilidad: un responsable vinculado puede firmar en sustitución de otro.
--       usuario_id = quien realmente firmó (firmado_por); rol = en_calidad_de;
--       en_sustitucion_de = a quién sustituye (opcional, trazabilidad).
-- Aditivo/retrocompatible. Idempotente.

alter table sgc.cl_registro_firmas
  add column if not exists en_sustitucion_de        uuid references sgc.usuarios(id),
  add column if not exists en_sustitucion_de_nombre text;

comment on column sgc.cl_registro_firmas.usuario_id is 'Quien realmente firmó (firmado_por).';
comment on column sgc.cl_registro_firmas.rol is 'En calidad de (rol de firma): residente|responsable|cliente|mivhed|maestro.';
comment on column sgc.cl_registro_firmas.en_sustitucion_de is 'Usuario responsable a quien sustituye el firmante (opcional).';

-- Regla nueva: basta 1 firma de rol responsable O residente.
create or replace function sgc.trg_cl_firmado()
returns trigger
language plpgsql
set search_path to 'sgc','pg_temp'
as $function$
begin
  update sgc.cl_registros r set estado='firmado', updated_at=now()
  where r.id = NEW.registro_id and r.estado <> 'firmado'
    and exists (
      select 1 from sgc.cl_registro_firmas f
      where f.registro_id = r.id and f.rol in ('residente','responsable')
    );
  return NEW;
end; $function$;

-- Retrocompat: los CL ya 'firmado' permanecen; los que ya tienen residente
-- o responsable pero seguían en 'borrador' (no debería, pero por si acaso) se
-- reconcilian con la regla nueva.
update sgc.cl_registros r set estado='firmado', updated_at=now()
where r.estado <> 'firmado'
  and exists (
    select 1 from sgc.cl_registro_firmas f
    where f.registro_id = r.id and f.rol in ('residente','responsable')
  );
