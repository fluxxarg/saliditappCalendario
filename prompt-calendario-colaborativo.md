# Prompt para agente de IDE

Copiá y pegá el siguiente prompt en tu agente de IDE (Claude Code, Cursor, etc.):

---

## Prompt

Quiero que construyas una aplicación web de **calendario colaborativo de disponibilidad**, con persistencia real en **MongoDB Atlas**. No requiere login/autenticación: los "usuarios" son solo nombres identificatorios, sin contraseña.

### Stack sugerido
- **Frontend:** React + Vite + TailwindCSS.
- **Backend:** Node.js + Express, exponiendo una API REST simple.
- **Base de datos:** MongoDB Atlas (usar `mongodb` driver o `mongoose`).
- Variables de conexión (connection string de Atlas) en un archivo `.env` (`MONGODB_URI`), nunca hardcodeadas.
- Estructura de proyecto: `/server` (API + conexión a Mongo) y `/client` (React), o monorepo simple con ambos.

### Modelo de datos (MongoDB)

**Colección `users`**
```json
{
  "_id": "ObjectId",
  "name": "Emi",
  "color": "#FF6B6B",
  "createdAt": "ISODate"
}
```

**Colección `availability`**
```json
{
  "_id": "ObjectId",
  "date": "2026-07-22",   // formato YYYY-MM-DD, string, indexado
  "userId": "ObjectId"    // referencia a users._id
}
```
- Un documento por combinación (día, usuario). Evitar duplicados con un índice único compuesto `{ date: 1, userId: 1 }`.

### Endpoints de API sugeridos
- `GET /api/users` — listar usuarios.
- `POST /api/users` — crear usuario `{ name }` (el color se asigna en el backend).
- `DELETE /api/users/:id` — eliminar usuario y toda su disponibilidad asociada.
- `GET /api/availability?month=2026-07` — traer toda la disponibilidad de un mes (agrupada por día, con los usuarios de cada día).
- `POST /api/availability` — marcar a un usuario como disponible en un día `{ userId, date }`.
- `DELETE /api/availability` — desmarcar `{ userId, date }`.
- `PATCH /api/availability/move` — mover la disponibilidad de un usuario de un día a otro `{ userId, fromDate, toDate }` (usado por el drag & drop; internamente borra el registro viejo y crea uno nuevo, respetando el índice único).

Todas las operaciones deben reflejarse en tiempo real en el frontend (refetch o actualización optimista del estado tras cada acción).

### Funcionalidad principal

**1. Gestión de usuarios (sin login)**
- Formulario simple con un input de texto para crear un usuario: solo pide un **nombre**.
- Al crearlo, el backend le asigna un **color único** de una paleta predefinida (evitar repetir colores mientras haya disponibles; si se agotan, generar uno determinístico a partir del nombre).
- Lista de usuarios creados, cada uno con su nombre y un chip/punto de color.
- Poder eliminar un usuario (esto borra también su disponibilidad en `availability`).
- Un selector de "usuario actual" (dropdown o chips clickeables) indica con qué usuario se está interactuando en ese momento al calendario.

**2. Calendario**
- Vista mensual, con navegación mes anterior / mes siguiente.
- Cada día es un "cuadradito".

**3. Edición de disponibilidad por día: checklist**
- Al hacer click en un día, se abre un **popover/modal pequeño con un checklist de todos los usuarios existentes** (checkbox + nombre + color de cada uno).
- Tildar o destildar un usuario en ese checklist lo agrega o lo quita de la disponibilidad de ese día, al instante (no hace falta "guardar", cada click dispara la llamada a la API correspondiente).
- Esto reemplaza la idea de "solo puedo marcar con el usuario actual seleccionado": cualquier usuario puede agregarse/quitarse de cualquier día directamente desde ese checklist, de forma simple e intuitiva.
- El selector de "usuario actual" del punto 1 se mantiene como atajo: si hay un usuario actual seleccionado, al hacer **click simple** (sin abrir el checklist) sobre un día vacío o ya marcado, se lo agrega/quita rápidamente a ese usuario sin abrir el popover. El checklist completo se abre con un click más prolongado, un ícono de "editar" en la esquina del día, o un botón secundario — elegí la interacción que resulte más natural en React, pero debe quedar claro visualmente cuál acción hace cada click.

**4. Mover disponibilidad arrastrando (drag & drop)**
- Cada "chip" o indicador de usuario dentro de un día debe ser **arrastrable** (usar `react-dnd`, `@dnd-kit/core`, o HTML5 Drag and Drop API).
- Al arrastrar el chip de un usuario desde un día y soltarlo sobre otro día, se debe **mover** su disponibilidad: se quita del día origen y se agrega al día destino (llamando a `PATCH /api/availability/move`).
- Si el usuario ya estaba disponible en el día destino, no duplicar (mostrar un pequeño feedback visual, ej. shake o toast, indicando que ya estaba ahí).
- Durante el arrastre, resaltar visualmente los días válidos donde se puede soltar (ej. borde punteado o highlight al hacer hover con el elemento arrastrado).
- Debe funcionar también en mobile de forma razonable (touch drag), o al menos degradar con gracia a "abrir checklist" si el drag táctil resulta muy complejo de implementar bien.

### Lógica visual de los días

- **Si solo 1 usuario está disponible ese día:** el cuadradito se pinta con el **color de ese usuario** (color sólido).
- **Si 2 o más usuarios coinciden en ese día:** el cuadradito cambia a **escala de verdes**, con intensidad interpolada según el ratio `usuarios_disponibles_ese_dia / usuarios_totales`:
  - 2 usuarios (mínimo de coincidencia) → verde claro.
  - ~50% del total de usuarios → verde intermedio.
  - 100% de los usuarios → verde fuerte/oscuro.
  - Usar interpolación continua de color (no solo 3 pasos fijos).
- Mostrar el texto **"X/Y"** sobre los días con coincidencia (X = disponibles ese día, Y = usuarios totales).
- Hover/tap sobre un día: tooltip con los nombres de los usuarios disponibles ese día y su color correspondiente (puede ser el mismo popover del checklist).
- Días sin ningún usuario disponible: estilo neutro (blanco/gris clarito).

### Detalles de UX
- Todo en una sola pantalla, sin rutas complejas.
- Selector de "usuario actual" bien visible arriba del calendario.
- Si no hay usuarios creados, el calendario debe estar deshabilitado con un mensaje invitando a crear el primero.
- Loading states simples mientras se consulta la API (spinners o skeletons livianos).
- Manejo básico de errores de red (ej. toast "no se pudo guardar, intentá de nuevo").
- Responsive: debe funcionar bien en desktop y mobile.

### Salas compartibles ("rooms")

En vez de un único calendario global, la app debe soportar **múltiples calendarios independientes**, cada uno identificado por un slug/código en la URL (ej. `tuapp.com/viaje-emi`). Esto permite crear un calendario distinto por cada evento/grupo y compartir el link directamente (WhatsApp, etc.), sin logins.

- **Colección `rooms`**:
```json
{
  "_id": "ObjectId",
  "slug": "viaje-emi",
  "startDate": "2026-07-20",
  "endDate": "2026-07-30",
  "createdAt": "ISODate",
  "confirmedDate": null
}
```
- `users` y `availability` deben tener un campo `roomId` para que queden aislados por sala (no compartir usuarios ni disponibilidad entre salas distintas).
- Al entrar por primera vez a una URL de un slug que no existe, mostrar un formulario simple: "Crear nueva sala" pidiendo un **nombre de sala** (se genera el slug a partir del nombre) y un **rango de fechas** del evento (fecha desde / fecha hasta). Si el slug ya existe, entrar directo al calendario de esa sala.
- El calendario, en vez de navegar mes a mes de forma infinita, debe mostrar únicamente los días dentro de `startDate`–`endDate` de la sala (más simple de escanear que un mes completo, especialmente si el rango es corto). Si el rango cruza más de un mes, mostrar los meses necesarios pero recortados a esas fechas.
- Endpoints nuevos: `POST /api/rooms` (crear sala), `GET /api/rooms/:slug` (traer datos de la sala), y todos los endpoints de `users`/`availability` existentes pasan a requerir `roomId` (ya sea por param de ruta `/api/rooms/:slug/users`, etc., o como query param).

### Recordar quién soy

- Al elegir/crear un usuario dentro de una sala, guardar en `localStorage` (clave scopeada por slug, ej. `currentUser_viaje-emi`) el id del usuario elegido.
- Al volver a entrar a esa misma URL desde el mismo navegador/dispositivo, seleccionar automáticamente ese usuario como "usuario actual", sin tener que elegirlo de nuevo cada vez.

### Mejor día destacado

- Arriba del calendario, mostrar un cartel simple con el día de mayor coincidencia del rango, por ejemplo: **"📅 Mejor día: 25 de julio (5/6 personas)"**.
- Si hay empate entre varios días, mostrar todos los empatados (ej. "25 y 26 de julio (5/6 personas)").
- Si ningún día tiene coincidencias (0 o 1 usuario), no mostrar el cartel o mostrar un mensaje neutro tipo "Todavía no hay coincidencias".

### Nota corta por usuario (opcional)

- Al marcar/confirmar su disponibilidad en un día (desde el checklist), cada usuario puede opcionalmente dejar una **nota de texto libre y corta** (ej. "puedo desde las 18hs", máx. ~60 caracteres), guardada junto al registro de `availability` (agregar campo `note` al documento).
- La nota se muestra en el tooltip/popover del día, junto al nombre del usuario que la escribió. No es obligatoria ni bloquea el flujo de marcar disponibilidad.

### Confirmar el día elegido

- Agregar un botón **"✅ Confirmar este día"** visible al hacer click/hover sobre cualquier día con coincidencias.
- No hay roles ni permisos especiales: cualquier persona en la sala puede confirmar un día (es una herramienta de coordinación informal, no de control de acceso).
- Al confirmar, se guarda `confirmedDate` en el documento de la `room` (endpoint `PATCH /api/rooms/:slug/confirm` con `{ date }`), y la UI debe reflejarlo claramente: el día confirmado se destaca de forma distinta (ej. borde dorado o ícono ✅ fijo), y arriba del calendario aparece un banner tipo "✅ Fecha confirmada: 25 de julio" en vez del cartel de "mejor día".
- Debe poder des-confirmarse (mismo botón funcionando como toggle) por si el grupo cambia de opinión.

### Qué evitar (mantener la app simple)

No agregar: roles de administrador ni permisos diferenciados, notificaciones push, eventos recurrentes, ni integraciones con Google Calendar u otros calendarios externos. La idea es que siga siendo una herramienta liviana de coordinación puntual, no un competidor de Doodle/When2meet con funcionalidades avanzadas.

### Extras opcionales (si hay tiempo, no obligatorio)
- Websockets o polling liviano para reflejar cambios de otros usuarios en tiempo real sin recargar.
- Exportar el rango de fechas confirmado como imagen o PDF.

Generá el proyecto completo (`/server` y `/client`), con componentes bien separados (RoomGate/CreateRoomForm, Calendar, DayCell, DayChecklistPopover, BestDayBanner, ConfirmedDateBanner, UserForm, UserSelector, Legend), el backend con sus rutas (incluyendo `rooms`) y conexión a MongoDB Atlas vía `.env`, y todo listo para correr con `npm install && npm run dev` en ambas carpetas. Incluí instrucciones breves en un `README.md` sobre cómo crear el cluster en MongoDB Atlas y configurar el `MONGODB_URI`.
