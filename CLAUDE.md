# SGC — Sistema de Gestión de Constructora SD

Internal ERP-style web app for Constructora SD (construction company, Dominican Republic). **UI language: Spanish.** Built and maintained solo by Xavier (Tecnología) with Claude Code.

## Stack
Angular 21 (standalone + signals) · Supabase (schema `sgc`: auth, RLS, edge functions) · Vercel (prod: sgcconstructorasd.com, previously sgc-ashen.vercel.app) · Resend (transactional email) · mammoth (docx extraction) · xlsx

## Commands
- Dev server: `npm start` · Build check: `npm run build` · Tests: `npm test` (vitest)
- Supabase: CLI installed; access token in env var `SUPABASE_ACCESS_TOKEN`. You may apply migrations, fix RLS/grants, and deploy edge functions yourself.
- SQL history lives in `sql/` and `supabase/`.

## Modules (keep this list updated)
Dashboard (KPIs) · Bitácora de obra · Inventario · Flota · Solicitudes (materiales, órdenes de compra) · Conduces / trazabilidad de transporte · Documentos (plantillas → rellenar → descargar) · Reportes y comentarios (admin) · Administración (usuarios, roles, permisos) · Dudas (ayuda)

## Hard rules (recurring feedback from Xavier — never skip)
1. **Interconnection**: any change in one module must update every related module — dashboard KPIs, notification badges, and the receiving side of any request (a Solicitud must show up where its approver/receiver works).
2. **Roles**: every new section, button, or action must respect the role permissions defined in Administración.
3. **DB integrity**: when touching tables, verify RLS policies, schema grants, and sequence grants (past prod bugs: `permission denied for schema sgc`, `permission denied for sequence roles_id_seq`). Validate inputs to prevent bad data.
4. **Verify before reporting done**: `npm run build` must pass and the affected workflow must be tested end-to-end.
5. **URLs**: auth/email redirect links must point to the production domain — never localhost.
6. Real workflows first: model features on how the company actually works (reference docs below), ERP patterns (Odoo/Oracle style) where they add real value.

## Reference docs (real company documents/templates)
- `C:\Users\xavie\Desktop\X Dev\Constructora SD\` → `EXTRACTO DE ONE DRIVE\` and `...\PLANTILLAS\`
- Project documentation: `C:\Users\xavie\Desktop\X Dev\Projects documentations\SGC\`
