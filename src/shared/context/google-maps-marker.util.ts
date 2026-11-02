// AO1 — Pin de marcador para google.maps.Marker (clásico, sin Map ID). Replica el
// look de los DivIcon de Leaflet (gota de color con borde blanco). Llamar SOLO tras
// cargar el SDK (usa google.maps.Size/Point).

/** Icono de pin coloreado (gota) para un marcador. `size` = alto en px. */
export function pinIcon(color: string, size = 34): google.maps.Icon {
  const w = Math.round(size * 0.72);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${size}" viewBox="0 0 24 34">` +
    `<path d="M12 0C5.9 0 1 4.9 1 11c0 7.7 9.4 21.3 10.1 22.3.5.6 1.4.6 1.9 0C13.6 32.3 23 18.7 23 11 23 4.9 18.1 0 12 0z" ` +
    `fill="${color}" stroke="#ffffff" stroke-width="2"/>` +
    `<circle cx="12" cy="11" r="4" fill="#ffffff"/></svg>`;
  return {
    url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg),
    scaledSize: new google.maps.Size(w, size),
    anchor: new google.maps.Point(w / 2, size),
  };
}

/** Punto pequeño (inicio/fin de trayecto). */
export function dotIcon(color: string, size = 26): google.maps.Icon {
  return pinIcon(color, size);
}

/**
 * F6 (ronda DF, DF4-A) — ícono de camión visto desde arriba, rotado según el
 * rumbo (`headingDeg`, 0 = norte, sentido horario). Para el marcador "en ruta"
 * del mapa de flota — reemplaza el pin genérico solo cuando el vehículo tiene
 * al menos 2 posiciones (hace falta rumbo real, nunca inventamos uno).
 */
export function truckIcon(color: string, headingDeg: number, size = 32): google.maps.Icon {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" ` +
    `style="transform:rotate(${Math.round(headingDeg)}deg)">` +
    `<g fill="${color}" stroke="#ffffff" stroke-width="1">` +
    `<rect x="9" y="2" width="6" height="13" rx="1.5"/>` +
    `<path d="M9 15h6l3 4v3H6v-3z"/>` +
    `</g></svg>`;
  return {
    url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg),
    scaledSize: new google.maps.Size(size, size),
    anchor: new google.maps.Point(size / 2, size / 2),
  };
}

