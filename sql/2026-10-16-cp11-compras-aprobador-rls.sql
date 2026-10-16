-- CP11.1 — la política SELECT de solicitudes_compra (y sus renglones) no deja
-- leer al aprobador. Causa: la política nació en 2026-07-02-solicitudes.sql,
-- antes de que CO8 (2026-10-14-co8-compras-tec-cotizacion.sql) agregara la
-- columna `aprobador_id` para el flujo de compras tecnológicas — los adjuntos
-- (co8:51) sí quedaron con `aprobador_id = auth.uid()`, pero la tabla base y
-- sus renglones no se actualizaron. Resultado: si el aprobador (p.ej. Eduardo
-- Ng) no tiene el módulo `compras` ni es admin, su consulta directa a la tabla
-- devuelve 0 filas aunque la RPC de aprobar/rechazar sí funcione (corre
-- SECURITY DEFINER, dueño de la tabla, bypassa RLS) — ve la bandeja vacía
-- aunque puede decidir.
--
-- Entorno: dev primero (regla 18), luego prod.

drop policy if exists "solicitudes_compra: select" on sgc.solicitudes_compra;
create policy "solicitudes_compra: select" on sgc.solicitudes_compra for select to authenticated
  using (
    solicitante_id = auth.uid()
    or aprobador_id = auth.uid()
    or sgc.is_admin()
    or sgc.tiene_modulo('compras')
  );

drop policy if exists "solicitud_compra_items: select" on sgc.solicitud_compra_items;
create policy "solicitud_compra_items: select" on sgc.solicitud_compra_items for select to authenticated
  using (exists (
    select 1 from sgc.solicitudes_compra s where s.id = solicitud_id
      and (s.solicitante_id = auth.uid() or s.aprobador_id = auth.uid()
           or sgc.is_admin() or sgc.tiene_modulo('compras'))
  ));
