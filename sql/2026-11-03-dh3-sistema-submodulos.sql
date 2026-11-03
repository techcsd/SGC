-- DH3/DH19 — el grupo "Sistema" (Historial de versiones, Guía de herramientas)
-- quedó atrapado bajo el guard del padre `tecnologia` al crear el grupo
-- "Developer": Angular evalúa el canActivate del PADRE para todos los hijos,
-- así que aunque esas dos rutas no tuvieran guard propio, igual quedaban
-- bloqueadas para cualquiera sin el módulo `tecnologia`.
--
-- Fix: nuevos submódulos `sistema.historial_versiones` / `sistema.guia_herramientas`
-- (sin módulo padre — como Mensajería/Notas, todo usuario autenticado los ve por
-- default), sembrados en 'ver' para TODOS los roles existentes (nadie pierde
-- acceso por sorpresa). Editable luego desde Administración › Roles (F4, DH11).

begin;

update sgc.roles
   set permisos = permisos
     || case when permisos ? 'sistema.historial_versiones' then '{}'::jsonb
             else jsonb_build_object('sistema.historial_versiones', 'ver') end
     || case when permisos ? 'sistema.guia_herramientas' then '{}'::jsonb
             else jsonb_build_object('sistema.guia_herramientas', 'ver') end;

commit;
