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
