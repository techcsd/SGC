# Resumen ejecutivo — Qué dicen los datos del sistema (SGC)

*Corte: 31 de octubre de 2026. Basado en lo registrado en el sistema; cuando algo no aparece, puede que se esté haciendo fuera de él.*

## En una frase
El sistema funciona y se usa en campo (partes diarios, conduces, combustible), pero **varios procesos se quedan a medias o se hacen por fuera**, y **un tercio del personal con acceso casi no lo usa**. Nada es crítico hoy; sí hay pérdida de control y de visibilidad.

## Lo que está bien
- Los conduces crecen mes a mes (39 en agosto, 65 en septiembre, 92 en octubre).
- Cinco obras registran parte diario casi todos los días.
- El sistema es estable y rápido; no hay riesgo de caída por tamaño o carga.
- Se registraron 867 rutas completadas con trazabilidad.

## Lo que necesita atención

**1. Pedidos de material que se quedan esperando.** 18 solicitudes siguen pendientes, algunas desde el 10 de septiembre (7 de ellas en Monterezzo). Atenderlas toma 2 días en la mitad de los casos, pero en 1 de cada 10 toma más de 15 días. Además, el aviso automático que debía empujar las vencidas está roto desde hace tiempo.

**2. Compras no refleja cómo se compra de verdad.** De 34 solicitudes de compra, 26 (76 %) fueron rechazadas, **ninguna con motivo registrado**, y solo 3 llegaron a orden de compra. Ninguna de las 155 entradas de mercancía está ligada a una orden de compra. Probablemente la compra real ocurre fuera del sistema, lo que quita control de gasto.

**3. Mercancía que sale y nunca se cierra.** 28 despachos llevan más de 2 semanas sin confirmarse (el más viejo, del 10 de agosto). El 55 % de las entregas se marca como "incompleta" y 56 conduces se anularon sin explicar por qué.

**4. Combustible: datos poco confiables.** Casi la mitad de los registros no tiene kilometraje confirmado, un tercio tuvo que corregirse y otro tercio no está asignado a un vehículo. La carga automática desde la estación se detuvo a mediados de septiembre.

**5. Poca adopción.** De 60 usuarios activos, 20 nunca han entrado y solo 20 lo usaron en las últimas dos semanas. Jefes de Ingenieros, Dirección General y Recursos Humanos no registran actividad. De las 7 tareas abiertas, 6 están vencidas. Los módulos de gestión no tienen quien los alimente.

**6. Obras sin seguimiento.** ROSCH lleva 54 días sin parte diario y Poseidonia 22. Cinco proyectos nunca han registrado un parte.

**7. Dos procesos duplicados.** Las "solicitudes de movimiento" casi no se usan (2 de cada 3 se cancelan); el transporte real nace de los conduces. Los avisos de flota están saturados por un recordatorio semanal rutinario (65 % del total), que tapa los avisos importantes.

**8. Datos de prueba mezclados con los reales.** Hay pruebas dentro de producción, lo que puede distorsionar indicadores (por ejemplo, los incidentes de seguridad registrados son todos de prueba).

**9. Catálogo de proveedores sin depurar.** 1 576 proveedores cargados, ninguno validado.

**10. La app móvil falla para algunos usuarios.** Un tercio de los errores reportados son lentitud al entrar, y muchos choferes tienen el GPS apagado, lo que reduce el seguimiento de la flota.

## Qué decisiones se piden
1. **Compras:** ¿el sistema debe ser el lugar oficial de órdenes de compra, o se acepta que se hace en Odoo? (define cómo se corrige el punto 2).
2. **Adopción:** respaldo de Dirección para que cada rol tenga una tarea mínima obligatoria en el sistema (punto 5 y 6).
3. **Cierre de despachos y anulaciones con motivo obligatorio** (puntos 3 y 4): confirmar que se exigirá en almacén y flota.
4. **Depuración:** autorizar limpiar datos de prueba, proveedores y registros viejos.

## Qué se está haciendo
Se abrieron 19 tareas en GitHub asignadas a Tecnología (#54 a #72): 2 correcciones urgentes de avisos automáticos, 11 mejoras de proceso y datos, y 5 de rendimiento y mantenimiento de la base de datos. Ninguna requiere parar la operación.
