-- ════════════════════════════════════════════════════════════════════════════
-- AY8 — Homologar la categoría de licencia de los conductores (dato sucio)
-- ════════════════════════════════════════════════════════════════════════════
-- Aditivo (solo UPDATE con predicado; sin DROP). Algunos conductores tienen
-- `licencia_tipo` como texto libre: "categoria 2", "Cat. 2", "2", "B"… mientras el
-- catálogo canónico sgc.licencia_categorias usa códigos '01'..'06'. Esto normaliza
-- los valores existentes al código canónico para que la UI muestre "Cat. 02 — …"
-- de forma consistente. La UI ya captura por dropdown (no más texto libre).
--
-- Reglas de mapeo (case-insensitive, tolerante a "cat"/"categoria"/espacios):
--   • extrae el primer dígito 1..6           → '0'||d           (2 → '02')
--   • ya viene como '01'..'06'               → se deja igual
--   • letra legacy A..F                       → '01'..'06'       (A→01 … F→06)
--   • cualquier otro valor no reconocido      → se deja intacto (no se pierde data)
-- ════════════════════════════════════════════════════════════════════════════

set search_path = sgc, public;

do $$
declare
  r record;
  v_raw text;
  v_low text;
  v_dig text;
  v_new text;
begin
  for r in select id, licencia_tipo from sgc.conductores where licencia_tipo is not null loop
    v_raw := trim(r.licencia_tipo);
    v_low := lower(v_raw);

    -- Ya canónico '01'..'06' → nada que hacer.
    if v_raw ~ '^0[1-6]$' then
      continue;
    end if;

    v_new := null;

    -- Primer dígito 1..6 en el texto (cubre "2", "cat 2", "categoria 2", "Cat.2").
    v_dig := substring(v_low from '([1-6])');
    if v_dig is not null then
      v_new := '0' || v_dig;
    else
      -- Letra legacy A..F (sin más ruido) → 01..06.
      case
        when v_low ~ '^[a\s]*a$' or v_low = 'a' then v_new := '01';
        when v_low = 'b' then v_new := '02';
        when v_low = 'c' then v_new := '03';
        when v_low = 'd' then v_new := '04';
        when v_low = 'e' then v_new := '05';
        when v_low = 'f' then v_new := '06';
        else v_new := null;
      end case;
    end if;

    if v_new is not null and v_new is distinct from r.licencia_tipo then
      update sgc.conductores set licencia_tipo = v_new where id = r.id;
    end if;
  end loop;
end $$;
