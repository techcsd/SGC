# AW9 — Checklist: habilitar facturación/uso automático de APIs (Google Cloud)

> ⏸ **PAUSA — requiere pasos manuales de Xaviel en la consola de Google Cloud.**
> Mientras esto no esté hecho, la sección **Tecnología › APIs y consumo** funciona con
> el costo estimado/mes **manual**. Una vez completado, se puede activar la extracción
> automática de usage + costo por API (edge function con la cuenta de servicio de solo-lectura).

## Qué se quiere lograr
- Traer, por API (Maps / Places / Roads / etc.), el **uso del mes** (requests) y el **costo acumulado**.
- Ver **cuota** y **% usado**, con **alertas de umbral** integradas a las alertas del Monitoreo.
- Todo **server-side** (llaves solo en edge functions, cero llaves en el repo/web).

## Pasos manuales (Google Cloud Console)
1. **Proyecto correcto**: entra al proyecto de Google Cloud donde viven las Maps Platform APIs.
2. **Habilitar la Cloud Billing API**
   - APIs & Services → Library → busca **"Cloud Billing API"** → *Enable*.
   - (Opcional para uso por API) habilita también **"Service Usage API"** y **"Cloud Monitoring API"**.
3. **Cuenta de servicio de solo-lectura**
   - IAM & Admin → Service Accounts → *Create service account* → nombre `sgc-billing-readonly`.
   - Roles: **Billing Account Viewer** (`roles/billing.viewer`) y, si usarás Monitoring,
     **Monitoring Viewer** (`roles/monitoring.viewer`).
   - Crea una **clave JSON** y descárgala (NO la subas al repo).
4. **Exportación de facturación a BigQuery** (recomendado para costo por SKU/servicio)
   - Billing → *Billing export* → habilita **Standard usage cost** a un dataset de BigQuery.
   - (Alternativa sin BigQuery: la Billing API expone catálogo/SKU, pero el costo consumido
     detallado por API se obtiene mejor vía el export a BigQuery o los reportes de facturación.)
5. **Entregar el secreto de forma segura**
   - Guarda el JSON de la cuenta de servicio como **secret de Supabase** (Edge Functions →
     Secrets), p. ej. `GCP_BILLING_SA_JSON`. Nunca en `.env` versionado ni en la web.
   - Avisa a Tecnología qué **billing account id** y **project id** usar.

## Qué construirá Tecnología una vez entregado lo anterior
- Edge function `apis-usage` que, con la cuenta de servicio, consulta usage/costo y lo cachea.
- Cableado en **APIs y consumo**: columnas de uso del mes, costo real, % de cuota, y umbrales
  que disparan alertas por el mismo canal del Monitoreo de infraestructura.

## Supabase / Vercel / Resend (uso propio)
- **Supabase**: su Management API expone parte del usage del proyecto; se puede sumar aquí.
- **Vercel / Resend**: exponen uso/facturación por su API con un token de solo-lectura
  (mismo patrón: token como secret de edge function). Registrar los tokens cuando se decida.
