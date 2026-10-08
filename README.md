# Trip Weather System ⛅🗺️

> Multi-Vehicle Route Weather Forecasting, Headwind/Crosswind Calculation, Elevation Profile & Comfort Scoring Engine.

A responsive, high-performance web application designed for cyclists, motorcyclists, electric vehicle drivers, and road-trippers to evaluate live route conditions across India.

---

## ⚡ Features

- **Live Dynamic Routing**: Real-time multi-modal turn-by-turn route generation powered by Valhalla routing engine with OpenStreetMap fallbacks.
- **Topographical Elevation Profiling**: Dense route elevation profiles queried every 2–3 km via Open-Meteo elevation service.
- **Multi-Checkpoint Weather Engine**: Batched live weather forecasting querying temperature, precipitation, wind speed, wind gusts, and visibility along the exact route trajectory.
- **Physics-Based Headwind & Crosswind Calculations**: True relative wind vectors calculated against vehicle travel azimuth.
- **Road Ice Proxy Detection**: Surface icing risk assessment combining precipitation history, surface elevation, and sub-zero temperatures.
- **Multi-Vehicle Profile Engine**: Tailored limits and weightings for Bicycle (with 2-pass dynamic headwind-adjusted ETAs), Motorcycle, Hatchback, SUV, and Electric Vehicles (EV battery range modeling).
- **10-Hour Departure Optimizer**: Matrix analysis calculating comfort scores for alternative departure windows to avoid bad weather.
- **Matte-Morphism UI**: Mobile-first design system featuring rich topographical background textures, velvet obsidian surfaces, and luxury typography (Outfit & Plus Jakarta Sans).
- **Live GPS Integration**: Instant current location detection with reverse geocoding and smooth Leaflet map camera zoom.

---

## 🛠️ Tech Stack

- **Core**: Vanilla JavaScript (ES Modules), HTML5
- **Styling**: Pure CSS with Custom Properties, Matte-Morphism, Hardware-Accelerated Keyframes
- **Maps**: Leaflet 1.9.4 with CartoDB Dark Matter & OpenStreetMap tiles
- **Build Tool**: Vite 8
- **Testing**: Vitest (37 unit tests covering routing, terrain, weather, ETA, scoring, and input)
- **Linting**: ESLint

---

## 🚀 Getting Started

### Prerequisites

- Node.js (v18 or newer recommended)
- npm

### Installation

```bash
# Clone the repository
git clone <repository-url>
cd bikeroute

# Install dependencies
npm install

# Start local development server
npm run dev
```

The application will start at `http://localhost:5173/`.

### Testing & Linting

```bash
# Run unit tests
npm test

# Run ESLint
npm run lint

# Build production bundle
npm run build
```

---

## 📄 License

MIT License.
