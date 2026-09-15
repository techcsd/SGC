# Propuesta — Módulo de Cartillas de Acero (BO10)

> **Estado: PROPUESTA. No se ha escrito ninguna migración, RPC ni pantalla.**
> Decisión de Xaviel (14-sep): redactar el modelo completo y **detenerse antes de cualquier DDL**
> hasta validar con **Guilamo** (quien registra las cartillas en obra) y **Ramón** (quien las lee en oficina).
> Falta: validación con Guilamo y Ramón + **foto de una cartilla real**.

Ronda BP · PROMPT-48 · 14/09/2026.

---

## 0. Qué es y por qué

Una **cartilla de acero** (o cartilla de doblado / bar bending schedule) es la hoja donde el ingeniero
de campo detalla, por elemento estructural, **las varillas de acero a cortar y doblar**: diámetro,
figura de doblado, longitudes por tramo, cantidad y —si se quiere— peso. Hoy eso vive en papel o en
un Excel suelto; el apunte pide llevarlo al sistema para que Guilamo lo registre en la app y Ramón lo
revise en la web, con reportes de **kg de acero por obra y diámetro**.

El diseño reutiliza tres patrones ya probados en SGC:
- **Folio + fecha elegible** (BC4 folios `RET-`/`REQ-` por trigger DEFINER; BL9 fecha del documento ≠ `capturado_en`).
- **Nace en la app por outbox** (`tipo_op`), como los retiros (BG4) y las bitácoras.
- **Esquema SVG autogenerado** (BO9 `molde-esquema`): el ingeniero captura números, el sistema dibuja la figura.

---

## 1. Entidades (modelo propuesto — NO aplicado)

```
sgc.cartillas
  id              uuid pk
  folio           bigint      -- se pinta CAR-###### (trigger DEFINER, patrón BC4/BG4)
  proyecto_id     uuid  → proyectos
  ingeniero_id    uuid  → usuarios  (= auth.uid() al crear)
  fecha           date        -- fecha del documento, ELEGIBLE (BL9); ≠ capturado_en
  capturado_en    timestamptz default now()
  estado          text check (estado in ('borrador','enviada','revisada','observada','ejecutada'))
  observaciones   text        -- lo que escribe Ramón si observa
  es_prueba       boolean default false
  created_at / updated_at

sgc.cartilla_atados                       -- (§F-7 decisión: ¿por atado o por elemento?)
  id, cartilla_id → cartillas (on delete cascade)
  identificador   text        -- "Atado 1", "Columna C-12", "Viga eje 3"
  estructura      text        -- del catálogo bitácora (COLUMNA, VIGA, LOSA, ZAPATA, MURO…)
  orden           smallint

sgc.cartilla_piezas
  id, atado_id → cartilla_atados (on delete cascade)
  marca           text        -- "posición"/marca de la pieza (¿quién la define? §F-7)
  diametro        text        -- catálogo: 3/8", 1/2", 5/8", 3/4", 1"  (ver acero_diametros)
  figura          text        -- catálogo de figuras de doblado (recta, L, U, estribo, gancho…)
  tramos          jsonb       -- [{lado:'A', largo_cm:120}, …] en CENTÍMETROS enteros (disciplina BM5)
  cantidad        int
  longitud_cm     numeric     -- = suma de tramos (calculada en el RPC)
  peso_kg         numeric     -- = longitud_m × cantidad × kg_por_m(diametro)  (calculada; ¿se necesita? §F-7)
  unidad_capturada text       -- si se permite pulgadas/pies; base = cm

sgc.cartilla_fotos
  id, cartilla_id → cartillas, path text, nombre text

sgc.acero_diametros            -- tabla de referencia (decisión de negocio)
  diametro   text pk           -- '3/8"', '1/2"', '5/8"', '3/4"', '1"'
  kg_por_m   numeric           -- 3/8"=0.560, 1/2"=0.994, 5/8"=1.552, 3/4"=2.235, 1"=3.973 (a confirmar con Ramón)
  mm         numeric           -- equivalente métrico (#3=9.5, #4=12.7, #5=15.9, #6=19.1, #8=25.4)

sgc.cartilla_eventos           -- historial de estados (o reutilizar audit_log)
  id, cartilla_id, actor_id, de_estado, a_estado, nota, created_at
```

**Disciplina BM5**: unidad base clara — **cm** para longitudes, **kg** para peso. Si se permite capturar
en pulgadas/pies, se guarda `unidad_capturada` + factor, como los artículos con `factor_paquete`.

**RLS desde el nacimiento (BC7)**: SELECT = ingeniero autor ∪ módulo (`proyectos`/`bitacora`, §F-7) ∪
responsable de la obra ∪ admin; escritura **solo por RPC SECURITY DEFINER** (sin grants sueltos);
`es_prueba` heredado por trigger desde la cartilla (patrón ar1).

---

## 2. Flujo (propuesto)

```
  Guilamo (app, offline)                    Sistema                         Ramón (web)
  ────────────────────────                  ────────────                    ────────────
  1. Crea cartilla (borrador)   →  outbox tipo_op:'cartilla'
     estructura, atados, piezas    →  crear_cartilla_app(p_id, …) idempotente
     figuras + tramos (esquema        folio CAR-######, fecha BL9
     SVG en vivo), fotos           →  estado 'enviada'
                                   →  notificar_modulo(  →  2. Ve la cartilla en /…/cartillas
                                        'proyectos'|'bitacora',            comenta / marca:
                                        'cartilla', …)                     · revisada   (todo bien)
                                                                           · observada  (algo mal → observaciones)
                                                                           · exporta xlsx/PDF
  3. Guilamo la marca 'ejecutada'  ←  (cuando el acero se cortó/dobló)
```

*"Que Ramón haga lo que entienda"* (apunte) se traduce en **4 acciones**: comentar · revisada · observada · exportar.
La propuesta las fija y **pregunta** si son las correctas (§4).

---

## 3. Reportes e historial (propuesto)

- **Por obra / ingeniero / fecha / estado** (filtros, como Retiros/Requisiciones).
- **Kg de acero por obra y por diámetro** — el número que oficina va a querer sumar (roll-up desde `cartilla_piezas.peso_kg`).
- **Export**: xlsx (web, `exportar-excel.util.ts`) y PDF (app, jsPDF) con el esquema SVG de cada pieza.
- **Historial de estados** con quién y cuándo (`cartilla_eventos` o `audit_log`).

---

## 4. Preguntas CERRADAS para Guilamo y Ramón (con una foto de una cartilla real al lado)

1. **¿La cartilla se organiza por ATADO o por ELEMENTO?** (define si `cartilla_atados` es "atado físico" o "elemento estructural"). §F-7.
2. **¿Lleva el plano de referencia?** (¿se adjunta el plano/PDF, o solo la foto de la cartilla en papel?).
3. **¿Quién define las MARCAS/posiciones de las piezas?** (¿el ingeniero las inventa, o vienen del plano?).
4. **¿Se necesita el PESO, o solo las longitudes y cantidades?** (define si `acero_diametros` + `peso_kg` entran o no).
5. **¿Qué hace Ramón cuando algo está mal — DEVUELVE (observada, Guilamo corrige) o CORRIGE él mismo?** (define si Ramón puede editar).
6. **¿Qué diámetros usan realmente?** (para sembrar `acero_diametros`: 3/8", 1/2", 5/8", 3/4", 1", #8…).
7. **¿Qué figuras de doblado son las habituales?** (para el catálogo de figuras + su SVG — ver §5).

---

## 5. Catálogo de figuras de doblado (esquemas SVG propuestos)

Cada figura se dibuja con el mismo componente de BO9 (`shared/ui`), recibiendo `figura + tramos` y
pintando la forma con cotas. Bosquejo de las figuras habituales (a confirmar en §4.7):

```
 Recta (00)        L (S01)            U / estribo (S02)      Gancho (S03)         Estribo cerrado (S04)
 ───────────      ───────┐            ┌───────┐              ───────┐             ┌───────┐
   A                A    │              │  B   │               A    │  ↰           │       │
                         │ B          A │      │ A                  │             A│       │A
                         │              └──────┘                    ╰              └───────┘
                       (90°)            (dos dobleces)           (gancho 180°)        B
```

El SVG real (no ASCII) sale del componente `molde-esquema`/`figura-doblado`: líneas de cota con la
medida en cm, escala automática al contenedor, imprimible en el PDF (SVG puro, sin `foreignObject`).

---

## 6. Mock de la pantalla móvil (una pregunta por pantalla, foto-first)

```
┌─────────────────────────────┐   ┌─────────────────────────────┐   ┌─────────────────────────────┐
│ Cartilla · Torre Alpha      │   │ Pieza 1 de 3                │   │ Revisión                    │
│ Fecha: [ 14/09/2026  ▼]     │   │ Marca:   [ C12-E1        ]  │   │ CAR-000042                  │
│                             │   │ Diámetro:[ 1/2"    ▼]       │   │ Torre Alpha · 14/09         │
│ Estructura: [ COLUMNA  ▼]   │   │ Figura:  [ Estribo ▼]       │   │ 3 piezas · Ø1/2" · 12 und   │
│ Atado/Elem: [ C-12       ]  │   │ Tramos (cm):                │   │ Peso: 8.4 kg                │
│                             │   │   A [ 30 ]  B [ 15 ]        │   │                             │
│  + Agregar pieza            │   │   C [ 30 ]  D [ 15 ]        │   │  [ Esquema SVG en vivo ]    │
│                             │   │ Cantidad:[ 12 ]             │   │                             │
│  ┌───────────────────────┐  │   │                             │   │  Estado: ● Enviada          │
│  │  [ Esquema SVG vivo ]  │  │   │  ┌───────────────────────┐  │   │                             │
│  │   estribo con cotas    │  │   │  │  [ Esquema SVG vivo ]  │  │   │  [ Marcar ejecutada ]       │
│  └───────────────────────┘  │   │  └───────────────────────┘  │   │                             │
│                             │   │  📷 Foto de la cartilla     │   │                             │
│  [ Siguiente → ]            │   │  [ Guardar pieza ]          │   │                             │
└─────────────────────────────┘   └─────────────────────────────┘   └─────────────────────────────┘
```

---

## 7. Respuesta a §F-7 — ¿dónde vive y quién es "oficina"?

**Recomendación:**
- **Vive en `/bitacora/cartillas`** (no en `/obra`). La cartilla la produce el **ingeniero de campo**
  (mismo actor y contexto que el parte diario y los retiros), y la app ya gatea Bitácora para ese rol.
  `/obra` es producción (`gerente_produccion`), un actor distinto. Además el esquema SVG y la disciplina
  de fecha/foto ya son "de bitácora".
- **"Oficina" para la notificación = los responsables de la obra** (`es_responsable_de_proyecto`), no un
  rol fijo `ingeniero_oficina`. Ramón es responsable de la obra que revisa; notificar por responsable es
  más preciso que por rol global y encaja con la RLS existente (`puede_ver_bitacora` ya usa
  `es_responsable_de_proyecto`). Si Xaviel prefiere un rol fijo, se cambia una línea del `notificar_*`.

---

## 8. Qué falta antes de construir

- [ ] Validar §1 (modelo) y §4 (7 preguntas) con **Guilamo** y **Ramón**.
- [ ] **Foto de una cartilla real** para calibrar figuras (§5) y campos.
- [ ] Confirmar `acero_diametros.kg_por_m` con oficina.
- [ ] Decidir §F-7 (ubicación + "oficina").

**Cuando se apruebe** (fase de la tanda siguiente): migración BC4 (folio) + BL9 (fecha) + BG4 (outbox),
`crear_cartilla_app(p_id, …)` idempotente, componente SVG `figura-doblado` (web+app, PARIDAD.md),
pantallas de captura (app) y revisión (web), reportes kg-por-obra-y-diámetro.

**Pendiente: validación con Guilamo y Ramón + foto de una cartilla real.**

---

## Construido v1 (15-sep-2026) — PROMPT-52 F8

Se construyó v1 con el modelo de esta propuesta (DEFAULT, Regla A). **Lo que Guilamo/Ramón pueden cambiar
sin código, desde datos:** los catálogos `sgc.acero_diametros` (kg/m por diámetro) y `sgc.cartilla_figuras`
(figuras de doblado) son administrables — hoy se editan por SQL/Admin. **Lo que requirió código:** el
esquema (`cartillas`, `cartilla_atados`, `cartilla_piezas`, `cartilla_fotos`, `cartilla_eventos`), los RPCs
(`crear_cartilla`, `cartilla_cambiar_estado`, `cartilla_detalle`, `cartillas_listado`, `cartillas_resumen_acero`),
el bucket `sgc-cartillas`, la página `/bitacora/cartillas` (bandeja + detalle + captura + reporte "Acero por
obra") y el contrato de la app (PARIDAD.md).

**Decisiones aplicadas (DEFAULT, ajustables usando la herramienta):** por atado **y** por pieza; peso
automático (kg/m × longitud × cantidad); plano de referencia = adjunto opcional; marcas libres por pieza;
Ramón/oficina revisa/observa/exporta, el autor marca ejecutada tras revisada; fecha elegible (BL9, no
real-time).

**Residual (polish, no bloquea):** UI de Admin › Catálogos para diámetros/figuras (hoy por SQL); miniatura
SVG de la figura en la pieza (hoy se muestra el nombre de la figura); captura de fotos/plano desde la web
(el servicio `subirArchivo` está listo; falta cablear el input en el drawer de captura).
