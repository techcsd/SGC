#!/usr/bin/env bash
# Crea el tablero "SGC — Adopción y operación" en techcsd, con la columna Fase,
# y carga los issues #54 a #87. Requiere: gh auth refresh -s project
# Uso: bash scripts/crear-tablero-adopcion.sh
set -euo pipefail
OWNER=techcsd
REPO=techcsd/SGC

P=$(gh project create --owner "$OWNER" --title "SGC — Adopción y operación" --format json --jq '.number')
echo "Proyecto #$P creado"
gh project link "$P" --owner "$OWNER" --repo "$REPO" >/dev/null
gh project field-create "$P" --owner "$OWNER" --name "Fase" --data-type SINGLE_SELECT \
  --single-select-options "Descubrir,Decidir,Construir,Medir" >/dev/null

for n in $(seq 54 87); do
  gh project item-add "$P" --owner "$OWNER" --url "https://github.com/$REPO/issues/$n" >/dev/null
done

PID=$(gh project view "$P" --owner "$OWNER" --format json --jq '.id')
FIELD=$(gh project field-list "$P" --owner "$OWNER" --format json --jq '.fields[] | select(.name=="Fase") | .id')
opt() { gh project field-list "$P" --owner "$OWNER" --format json \
  --jq ".fields[] | select(.name==\"Fase\") | .options[] | select(.name==\"$1\") | .id"; }
O_DESC=$(opt Descubrir); O_DEC=$(opt Decidir); O_CONS=$(opt Construir)

# Construir: bugs claros y mantenimiento de DB. Decidir: ideas (#73–82). Descubrir: el resto.
gh project item-list "$P" --owner "$OWNER" --limit 100 --format json \
  --jq '.items[] | "\(.id) \(.content.number)"' | while read -r id num; do
  case "$num" in
    54|55|68|69|70|71|72) o=$O_CONS ;;
    73|74|75|76|77|78|79|80|81|82) o=$O_DEC ;;
    *) o=$O_DESC ;;
  esac
  gh project item-edit --id "$id" --project-id "$PID" --field-id "$FIELD" --single-select-option-id "$o" >/dev/null
done
echo "Listo: https://github.com/users/$OWNER/projects/$P"
