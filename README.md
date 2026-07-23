# Calendario colaborativo Saliditapp

## Requisitos
- Node.js 18+
- Cuenta en MongoDB Atlas

## Instalar
```bash
cd server && npm install
cd ../client && npm install
```

## Configurar MongoDB Atlas
1. Crea un cluster en MongoDB Atlas.
2. Obtén la connection string y guárdala en `server/.env`.
3. Ejemplo:
```env
MONGODB_URI=mongodb+srv://<user>:<password>@cluster0.xxxxxx.mongodb.net/?retryWrites=true&w=majority
MONGODB_NAME=saliditapp-calendar
PORT=3001
```

## Correr
Desde la raíz del proyecto:
```bash
npm run dev
```

Eso levanta a la vez el backend y el frontend. La app estará disponible en `http://localhost:5173` y la API en `http://localhost:3001`.
