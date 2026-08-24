-- =============================================================================
-- PROMPT-7 FASE 5 (AV5) — Wizard de creación de conduce en la WEB: designar
-- despachante desde escritorio. Ronda 24/08/2026 (IDs AV). Aditivo, idempotente.
--
-- La web ya crea salidas/conduces (`registrar_salida_inventario`) y ya tiene la
-- bandeja del despachante (`por-firmar`, AV1). Faltaba el eslabón: al crear un
-- conduce desde la web, poder DESIGNAR al despachante (usuario del sistema) para
-- que firme remoto — cerrando el ciclo crear→firmar→entregar sin la app.
--
-- Va detrás de un FEATURE FLAG (`conduce_wizard_web_habilitado`, default false)
-- para no cambiar el flujo actual hasta que AU1 ubique el hogar de Inventario y
-- Xaviel lo habilite (toggle sin deploy desde Administración › Parámetros).
--
-- La elegibilidad del despachante reutiliza la MATRIZ ÚNICA de AV1
-- (`sgc.es_despachante_elegible`). El selector ya sale filtrado por
-- `despachantes_disponibles` (AV1). Este RPC valida server-side al asignar.
-- =============================================================================

begin;

-- ── Feature flag (toggle sin deploy) ─────────────────────────────────────────
insert into sgc.parametros (clave, valor, descripcion) values
  ('conduce_wizard_web_habilitado', 'false',
   'AV5 — habilita el paso "Despachante" del wizard de creación de conduce en la web. Ponlo en true para activarlo.')
on conflict (clave) do nothing;

-- ── Asignar/designar el despachante de un conduce (defensa en profundidad) ────
create or replace function sgc.asignar_despachante_conduce(p_salida_id uuid, p_usuario_id uuid)
returns void language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare
  v_s sgc.salidas_inventario%rowtype;
  v_nombre text;
begin
  if not (sgc.is_admin() or sgc.tiene_modulo('inventario') or sgc.es_flota_elevado()) then
    raise exception 'No tienes permiso para designar el despachante.';
  end if;
  if p_usuario_id is null then raise exception 'Selecciona un despachante.'; end if;

  select * into v_s from sgc.salidas_inventario where id = p_salida_id for update;
  if not found then raise exception 'Conduce no encontrado.'; end if;
  if coalesce(v_s.estado,'') = 'anulado' then raise exception 'El conduce está anulado.'; end if;
  -- Si ya está firmado por el despachante, no se reasigna (evita romper la traza).
  if exists (select 1 from sgc.salida_firmas sf where sf.salida_id = p_salida_id and sf.rol = 'emisor') then
    raise exception 'El conduce ya tiene la firma del despachante; no se puede reasignar.';
  end if;
  -- Elegibilidad: misma matriz que selector + firma (AV1).
  if not sgc.es_despachante_elegible(p_usuario_id) then
    raise exception 'El usuario elegido no es elegible como despachante.';
  end if;

  select nombre into v_nombre from sgc.usuarios where id = p_usuario_id;

  update sgc.salidas_inventario
     set despachante_usuario_id = p_usuario_id,
         despachante_nombre     = coalesce(nullif(trim(v_nombre),''), 'Despachante'),
         despachante_empleado_id = null
   where id = p_salida_id;

  -- Avisar al despachante que tiene un conduce por firmar (si no es él mismo).
  if p_usuario_id is distinct from auth.uid() then
    perform sgc.notificar(
      p_usuario_id, 'conduce', 'Conduce por firmar',
      'Se te asignó como despachante del conduce '||('CND-'||upper(left(p_salida_id::text,8)))||
        '. Fírmalo para que el chofer pueda marcar la entrega.',
      '/inventario/por-firmar');
  end if;
end;
$$;
grant execute on function sgc.asignar_despachante_conduce(uuid, uuid) to authenticated, service_role;

commit;
