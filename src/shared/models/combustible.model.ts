export interface RegistroCombustible {
  id: string;
  vehiculo_id: string;
  vehiculo?: { placa: string; marca: string };
  conductor_id: string | null;
  conductor?: { nombre: string };
  fecha: string;
  litros: number;
  costo_por_litro: number | null;
  total: number | null;
  kilometraje: number | null;
  estacion: string | null;
  notas: string | null;
  created_at: string;
}

export interface RegistroCombustibleFormData {
  vehiculo_id: string;
  conductor_id: string | null;
  fecha: string;
  litros: number;
  costo_por_litro: number | null;
  total: number | null;
  kilometraje: number | null;
  estacion: string | null;
  notas: string | null;
}
