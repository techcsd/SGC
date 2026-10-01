-- CE16 data-fix — Fusionar el duplicado de Edward Mota antes del índice único (ce16b)
-- ---------------------------------------------------------------------------------
-- Prod y dev tenían el MISMO caso: una sola cédula (402-2685801-3 / 4022685801-3,
-- normalizada 40226858013) en dos registros de la MISMA obra (313fbf47…):
--   · "EDWARD" (manual, registrado_por null)  ← se descarta
--   · "Edward Mota Canet" (import, registrado_por Roberly Camacho) ← se conserva
-- Idempotente: solo fusiona si ambos siguen activos (en dev ya está fusionado = no-op).
-- Usa el RPC probado sgc.fusionar_personal_obra bajo identidad de un admin (conserva
-- fotos/firmas y descarta en lógico; recuperable 30 días desde la papelera).
-- Regla 19: escritura en prod versionada (scripts/data-fixes/) + ledger.
-- ---------------------------------------------------------------------------------
do $$
declare
  v_keep uuid; v_drop uuid; v_admin uuid;
begin
  -- Registros vivos con ese documento normalizado, en la misma obra.
  select id into v_keep from sgc.personal_obra
   where sgc.doc_normalizado(tipo_documento, documento_numero) = '40226858013'
     and eliminado_at is null and lote_import is not null limit 1;
  select id into v_drop from sgc.personal_obra
   where sgc.doc_normalizado(tipo_documento, documento_numero) = '40226858013'
     and eliminado_at is null and lote_import is null limit 1;

  if v_keep is null or v_drop is null or v_keep = v_drop then
    raise notice 'CE16: nada que fusionar (ya resuelto o no encontrado).';
    return;
  end if;

  -- Actuar como admin para pasar el gate del RPC.
  select ur.usuario_id into v_admin
    from sgc.usuarios_roles ur join sgc.roles r on r.id = ur.rol_id
   where r.codigo = 'admin' limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);

  perform sgc.fusionar_personal_obra(v_keep, v_drop, 'Fusión de duplicado Edward Mota (CE16, misma cédula)');
  raise notice 'CE16: fusionado % ← % (keep ← drop).', v_keep, v_drop;
end $$;
