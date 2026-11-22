// Destinos populares y barrios para «Cómo llegar» sin escribir ni buscar en el mapa.
// Coordenadas [lon, lat] de OpenStreetMap (Photon) o, si no, de las paradas del GTFS con ese nombre.
// «approx: true» = situada a mano; conviene revisarla.
export const PLACES = [
  { id: "delicias", name: "Estación Delicias", icon: "🚆", p: [-0.91132, 41.65876] },
  { id: "pilar", name: "El Pilar", icon: "⛪", p: [-0.87852, 41.65677] },
  { id: "plaza-espana", name: "Plaza España", icon: "◎", p: [-0.88107, 41.65223] },
  { id: "plaza-aragon", name: "Plaza Aragón", icon: "◎", p: [-0.88518, 41.64843] },
  { id: "puerto-venecia", name: "Puerto Venecia", icon: "🛍", p: [-0.88719, 41.60876] },
  { id: "grancasa", name: "Grancasa", icon: "🛍", p: [-0.89008, 41.6706] },
  { id: "aragonia", name: "Aragonia", icon: "🛍", p: [-0.90917, 41.64011] },
  { id: "ayuntamiento", name: "Ayuntamiento", icon: "🏛", p: [-0.8773, 41.65623] },
  { id: "la-seo", name: "La Seo", icon: "⛪", p: [-0.87566, 41.65465] },
  { id: "las-armas", name: "Las Armas", icon: "🎶", p: [-0.8866, 41.6557], approx: true },
  { id: "parque-grande", name: "Parque Grande", icon: "🌳", p: [-0.89509, 41.6332] },
  { id: "plaza-sitios", name: "Plaza de los Sitios", icon: "◎", p: [-0.8796, 41.647] },
  { id: "puerta-carmen", name: "Puerta del Carmen", icon: "◎", p: [-0.8876, 41.6498] },
  { id: "mercado-central", name: "Mercado Central", icon: "🛒", p: [-0.883, 41.6543] },
  { id: "puente-piedra", name: "Puente de Piedra", icon: "🌉", p: [-0.876, 41.6578] },
  { id: "aljaferia", name: "Aljafería", icon: "🏰", p: [-0.89666, 41.65649] },
  { id: "plaza-toros", name: "Plaza de toros", icon: "◎", p: [-0.89155, 41.65427] },
  { id: "portillo", name: "Portillo", icon: "🚆", p: [-0.89458, 41.65148] },
  { id: "san-francisco", name: "Plaza San Francisco (Universidad)", icon: "🎓", p: [-0.895, 41.64085] },
  { id: "campus-rio-ebro", name: "Campus Río Ebro", icon: "🎓", p: [-0.88978, 41.68356] },
  { id: "miguel-servet", name: "Hospital Miguel Servet", icon: "🏥", p: [-0.899, 41.6362] },
  { id: "clinico", name: "Hospital Clínico", icon: "🏥", p: [-0.90342, 41.64326] },
  { id: "romareda", name: "La Romareda", icon: "⚽", p: [-0.9015, 41.6364] },
  { id: "auditorio", name: "Auditorio", icon: "🎶", p: [-0.90086, 41.63801] },
  { id: "expo", name: "Palacio de Congresos (Expo)", icon: "🏛", p: [-0.90645, 41.6687] },
];

// Distritos de Zaragoza: «ir al barrio» = a su zona central (aproximada).
export const DISTRICTS = [
  { name: "Casco Histórico", p: [-0.88, 41.6545] },
  { name: "Centro", p: [-0.8845, 41.647] },
  { name: "Delicias", p: [-0.908, 41.649] },
  { name: "Universidad", p: [-0.899, 41.641] },
  { name: "San José", p: [-0.867, 41.642] },
  { name: "Las Fuentes", p: [-0.859, 41.648] },
  { name: "La Almozara", p: [-0.905, 41.659] },
  { name: "Oliver-Valdefierro", p: [-0.93, 41.645] },
  { name: "Torrero-La Paz", p: [-0.878, 41.629] },
  { name: "Actur-Rey Fernando", p: [-0.895, 41.674] },
  { name: "El Rabal", p: [-0.873, 41.664] },
  { name: "Casablanca", p: [-0.905, 41.625] },
  { name: "Santa Isabel", p: [-0.838, 41.683] },
  { name: "Miralbueno", p: [-0.931, 41.653] },
  { name: "Sur (Valdespartera, Rosales, Arcosur)", p: [-0.924, 41.613] },
];
