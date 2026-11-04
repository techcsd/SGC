# DI5/DI6/DI7/DI10 — Lectores IA de combustible y uso de vehículo (Ronda DI)

## `leer-recibo` — robustez (DI10)

`supabase/functions/leer-recibo/index.ts`:
- `max_tokens` 1024 → **1536** (recibos con mucho detalle se truncaban).
- Revisa `stop_reason`: si vino `max_tokens` (truncado), reintenta una vez antes de rendirse.
- Si el JSON no se puede interpretar en el primer intento (y no fue por truncamiento), **1
  reintento** más antes de devolver error.
- La respuesta cruda del modelo se registra en el log (`console.error`) cuando falla el parseo —
  antes se perdía sin dejar rastro (mismo patrón que dejó fallar "Resumir para ronda", DH1).
- Mensaje de error distingue truncado ("prueba con menos fotos") de no-interpretable ("foto
  borrosa/sin señal").
- El endpoint ya aceptaba `tablero`/`bomba`/`recibo` en la misma llamada — el **modo rápido** (DI5,
  tablero+recibo en una sola lectura) no necesitó cambios de contrato, solo mandar las 2-3 imágenes
  juntas desde el cliente.

## `leer-formulario` tipo `uso_vehiculo` (DI7)

Nuevo tipo en `supabase/functions/leer-formulario/index.ts` (`TIPOS_IMPLEMENTADOS`). Foto-based
(no voz). Entrada: `{ tipo: 'uso_vehiculo', fotos: [{data, mime}] }`.

Salida:
```json
{
  "km": { "valor": number|null, "confianza": 0..1 },
  "horas": { "valor": number|null, "confianza": 0..1 },
  "nivel": { "valor": "E"|"1/4"|"1/2"|"3/4"|"F"|null, "confianza": 0..1 },
  "luces": [ { "nombre": string, "confianza": 0..1 } ]
}
```
- `km` y `horas` son mutuamente excluyentes (vehículo vs. equipo con horómetro).
- `nivel` **nunca** supera 0.75 de confianza (tope aplicado en el servidor, no confiado al modelo) —
  es una lectura analógica aproximada, nunca un dato exacto.
- `luces` son solo las que se ven **encendidas**; lista libre (motor, aceite, batería, frenos…).
- Registrado en `uso_ia` como `leer_formulario_uso_vehiculo` y en `formulario_ia_propuestas` como
  cualquier otro tipo.

## `registrar_combustible_app` — captura y diferencias (DI5/DI6)

Dos parámetros nuevos al final de la firma (backward-compatible, la app actual en tiendas no los
manda y sigue funcionando igual):

- `p_captura text default 'normal'` — `'normal'` o `'rapido_ia'`. Si es `rapido_ia` y no llegó
  `p_foto_bomba_path`, se marca `sin_foto_bomba=true` (columna nueva en `registros_combustible`) —
  **no abre revisión**, es solo una anotación visible para Logística. Si el parámetro
  `combustible_rapido_exige_bomba` (default `'false'`) está en `'true'`, en cambio SÍ la exige.
- `p_diferencias jsonb default null` — `[{"campo","valor_usuario","valor_leido","decision":"uso_recibo"|"mantener_mio","motivo"}]`.
  Si alguna diferencia quedó con `decision:"mantener_mio"`, se guarda en `diferencias_recibo` y se
  avisa a Flota (`combustible_diferencia`) para que lo revise — nunca bloquea el registro.

**Pendiente (app, PROMPT-135 F3/F4):** pantalla de selección Rápido/Normal al entrar a "Registro de
combustible"; comparar monto/galones/km leídos vs. tecleados tanto al leer la foto como en
"Revisar y enviar" (hoy el aviso solo aparece en el paso intermedio, que el chofer ya dejó atrás).

## Uso de vehículo con foto de tablero (DI-18)

`vehiculo_usos` gana `foto_tablero_inicio_path` / `foto_tablero_fin_path`; `set_uso_fotos` acepta
`p_tablero_inicio`/`p_tablero_fin` (parámetros nuevos al final, igual de backward-compatible). Las
luces de advertencia se anotan en `vehiculo_usos.notas` (columna ya existente) — sin columna nueva.

**Pendiente (app, PROMPT-135 F5):** primera captura "Foto del tablero" → `leer-formulario` tipo
`uso_vehiculo` → confirma/corrige km/horas/nivel; el formulario manual sigue disponible siempre.
