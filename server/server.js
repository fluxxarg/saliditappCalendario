import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { MongoClient, ObjectId } from 'mongodb';
import { randomUUID } from 'crypto';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

app.use((err, _req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({ error: 'JSON inválido' });
  }
  next(err);
});

let mongoClient = null;
let db = null;
const memoryState = {
  rooms: [],
  users: [],
  availability: []
};

const COLORS = ['#ff6b6b', '#4ecdc4', '#45b7d1', '#f7b267', '#9b5de5', '#00bbf9', '#f15bb5', '#84cc16'];

function toId(value) {
  if (!value) return null;
  if (typeof value === 'string') return value;
  return value.toString();
}

function normalizeRoom(room) {
  return {
    ...room,
    id: room._id ? room._id.toString() : room.id,
    _id: undefined
  };
}

function normalizeUser(user) {
  return {
    ...user,
    id: user._id ? user._id.toString() : user.id,
    roomId: user.roomId,
    _id: undefined
  };
}

function normalizeAvailability(item) {
  return {
    ...item,
    id: item._id ? item._id.toString() : item.id,
    userId: item.userId,
    roomId: item.roomId,
    _id: undefined
  };
}

async function connectMongo() {
  if (mongoClient) return true;
  if (!process.env.MONGODB_URI) {
    return false;
  }

  try {
    console.log('Attempting to connect to MongoDB Atlas...');
    mongoClient = new MongoClient(process.env.MONGODB_URI);
    await mongoClient.connect();
    db = mongoClient.db(process.env.MONGODB_NAME || 'saliditapp-calendar');
    console.log(`Connected to MongoDB Atlas - database: ${process.env.MONGODB_NAME || 'saliditapp-calendar'}`);
    return true;
  } catch (error) {
    console.error('MongoDB connection failed, falling back to in-memory store. Error:', error && error.message ? error.message : String(error));
    if (error && error.stack) console.error(error.stack);
    return false;
  }
}

async function getCollections() {
  const usingMongo = await connectMongo();
  if (!usingMongo || !db) {
    return { usingMongo: false, rooms: memoryState.rooms, users: memoryState.users, availability: memoryState.availability };
  }
  return { usingMongo: true, rooms: db.collection('rooms'), users: db.collection('users'), availability: db.collection('availability') };
}

// Simple SSE (Server-Sent Events) support for real-time updates per room
const sseClients = new Map(); // slug => Set<res>

function sendSSE(slug, event, data) {
  try {
    const clients = sseClients.get(slug);
    if (!clients) return;
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of clients) {
      try {
        res.write(payload);
      } catch (e) {
        // ignore per-client errors; they'll be cleaned up on close
      }
    }
  } catch (e) {
    console.error('Error broadcasting SSE:', e && e.message ? e.message : String(e));
  }
}

app.get('/api/rooms/:slug/stream', async (req, res) => {
  const { slug } = req.params;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders && res.flushHeaders();

  if (!sseClients.has(slug)) sseClients.set(slug, new Set());
  const clients = sseClients.get(slug);
  clients.add(res);

  req.on('close', () => {
    clients.delete(res);
    if (clients.size === 0) sseClients.delete(slug);
  });
});

function getMongoHostFromUri(uri) {
  if (!uri || typeof uri !== 'string') return 'unknown';
  try {
    // strip protocol
    const afterProtocol = uri.replace(/^mongodb(?:\+srv)?:\/\//i, '');
    // take until first slash (remove db and params)
    const beforeSlash = afterProtocol.split('/')[0];
    // if credentials present, split at @ and keep the host part
    const hostPart = beforeSlash.includes('@') ? beforeSlash.split('@')[1] : beforeSlash;
    // mask possible ports/credentials left alone; return host list
    return hostPart;
  } catch (e) {
    return 'unknown';
  }
}

function slugify(value) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '') || 'room';
}

function getDefaultDateRange() {
  const today = new Date();
  const start = new Date(today);
  const end = new Date(today.getFullYear(), today.getMonth() + 2, 0);
  return {
    startDate: start.toISOString().split('T')[0],
    endDate: end.toISOString().split('T')[0]
  };
}

function getColorForName(name, existingColors = []) {
  const normalizedName = (name || '').trim().toLowerCase();
  const hash = normalizedName.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  const palette = COLORS.filter((color) => !existingColors.includes(color));
  if (palette.length > 0) {
    const index = hash % palette.length;
    return palette[index];
  }
  return COLORS[hash % COLORS.length];
}

async function ensureRoomExists(slug) {
  const { usingMongo, rooms } = await getCollections();
  if (usingMongo) {
    const room = await rooms.findOne({ slug });
    return room ? normalizeRoom(room) : null;
  }
  return memoryState.rooms.find((room) => room.slug === slug) || null;
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, mode: process.env.MONGODB_URI ? 'mongo' : 'memory' });
});

app.get('/api/rooms', async (_req, res) => {
  const { usingMongo, rooms } = await getCollections();
  if (usingMongo) {
    const roomDocs = await rooms.find({}).sort({ createdAt: -1 }).toArray();
    return res.json(roomDocs.map((room) => normalizeRoom(room)));
  }
  res.json(memoryState.rooms.map((room) => ({ ...room })));
});

app.post('/api/rooms', async (req, res) => {
  const { name, startDate, endDate } = req.body;
  if (!name) {
    return res.status(400).json({ error: 'Faltan datos para crear la sala' });
  }

  const defaultRange = getDefaultDateRange();
  let actualStartDate = startDate || defaultRange.startDate;
  let actualEndDate = endDate || defaultRange.endDate;
  const parsedStart = new Date(`${actualStartDate}T00:00:00`);
  const parsedEnd = new Date(`${actualEndDate}T23:59:59`);
  const validRange = !Number.isNaN(parsedStart.getTime()) && !Number.isNaN(parsedEnd.getTime()) && parsedStart <= parsedEnd;

  if (!validRange || parsedStart < new Date(`${defaultRange.startDate}T00:00:00`) || parsedEnd > new Date(`${defaultRange.endDate}T23:59:59`)) {
    actualStartDate = defaultRange.startDate;
    actualEndDate = defaultRange.endDate;
  }

  const slug = slugify(name);
  const { usingMongo, rooms } = await getCollections();

  if (usingMongo) {
    try {
      const existing = await rooms.findOne({ slug });
      if (existing) return res.status(409).json({ error: 'La sala ya existe' });
      const roomDoc = {
        slug,
        name,
        startDate,
        endDate,
        confirmedDate: null,
        createdAt: new Date()
      };
      const result = await rooms.insertOne(roomDoc);
      console.log('Inserted room into MongoDB:', { slug, insertedId: result.insertedId.toString() });
      // broadcast room creation
      try { sendSSE(slug, 'room-created', normalizeRoom({ ...roomDoc, _id: result.insertedId })); } catch (e) {}
      return res.status(201).json(normalizeRoom({ ...roomDoc, _id: result.insertedId }));
    } catch (err) {
      console.error('Error inserting room into MongoDB:', err && err.message ? err.message : String(err));
      if (err && err.stack) console.error(err.stack);
      return res.status(500).json({ error: 'Error interno al crear la sala' });
    }
  }

  if (memoryState.rooms.some((room) => room.slug === slug)) {
    return res.status(409).json({ error: 'La sala ya existe' });
  }

  const room = { id: randomUUID(), slug, name, startDate, endDate, confirmedDate: null, createdAt: new Date().toISOString() };
  memoryState.rooms.push(room);
  try { sendSSE(slug, 'room-created', room); } catch (e) {}
  res.status(201).json(room);
});

app.get('/api/rooms/:slug', async (req, res) => {
  const room = await ensureRoomExists(req.params.slug);
  if (!room) return res.status(404).json({ error: 'Sala no encontrada' });
  res.json(room);
});

app.patch('/api/rooms/:slug/confirm', async (req, res) => {
  const { date } = req.body;
  const { usingMongo, rooms } = await getCollections();
  const room = usingMongo ? await rooms.findOne({ slug: req.params.slug }) : memoryState.rooms.find((entry) => entry.slug === req.params.slug);
  if (!room) return res.status(404).json({ error: 'Sala no encontrada' });

  const nextValue = date === undefined ? null : date;
  if (usingMongo) {
    await rooms.updateOne({ slug: req.params.slug }, { $set: { confirmedDate: nextValue } });
    const updated = await rooms.findOne({ slug: req.params.slug });
    try { sendSSE(req.params.slug, 'room-confirmed', normalizeRoom(updated)); } catch (e) {}
    return res.json(normalizeRoom(updated));
  }

  const index = memoryState.rooms.findIndex((entry) => entry.slug === req.params.slug);
  memoryState.rooms[index].confirmedDate = nextValue;
  try { sendSSE(req.params.slug, 'room-confirmed', memoryState.rooms[index]); } catch (e) {}
  res.json(memoryState.rooms[index]);
});

app.get('/api/rooms/:slug/users', async (req, res) => {
  const room = await ensureRoomExists(req.params.slug);
  if (!room) return res.status(404).json({ error: 'Sala no encontrada' });
  const { usingMongo, users } = await getCollections();
  const roomUsers = usingMongo
    ? await users.find({ roomId: room.id }).toArray()
    : memoryState.users.filter((user) => user.roomId === room.id);
  res.json(roomUsers.map((user) => normalizeUser(user)));
});

app.post('/api/rooms/:slug/users', async (req, res) => {
  const room = await ensureRoomExists(req.params.slug);
  if (!room) return res.status(404).json({ error: 'Sala no encontrada' });
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Falta el nombre del usuario' });

  const { usingMongo, users } = await getCollections();
  const existingUsers = usingMongo ? await users.find({ roomId: room.id }).toArray() : memoryState.users.filter((user) => user.roomId === room.id);
  const existingColors = existingUsers.map((user) => user.color).filter(Boolean);
  const color = getColorForName(name, existingColors);
  const userDoc = {
    id: randomUUID(),
    roomId: room.id,
    name,
    color,
    createdAt: new Date().toISOString()
  };

  if (usingMongo) {
    const result = await users.insertOne({ _id: new ObjectId(), ...userDoc, createdAt: new Date() });
    const created = await users.findOne({ _id: result.insertedId });
    try { sendSSE(room.slug, 'user-created', normalizeUser(created)); } catch (e) {}
    return res.status(201).json(normalizeUser(created));
  }

  memoryState.users.push(userDoc);
  try { sendSSE(room.slug, 'user-created', userDoc); } catch (e) {}
  res.status(201).json(userDoc);
});

app.delete('/api/rooms/:slug/users/:id', async (req, res) => {
  const room = await ensureRoomExists(req.params.slug);
  if (!room) return res.status(404).json({ error: 'Sala no encontrada' });
  const { usingMongo, users, availability } = await getCollections();
  if (usingMongo) {
    await users.deleteMany({ roomId: room.id, _id: new ObjectId(req.params.id) });
    await availability.deleteMany({ roomId: room.id, userId: req.params.id });
    try { sendSSE(req.params.slug, 'user-deleted', { id: req.params.id }); } catch (e) {}
    return res.json({ success: true });
  }

  memoryState.users = memoryState.users.filter((user) => !(user.roomId === room.id && user.id === req.params.id));
  memoryState.availability = memoryState.availability.filter((entry) => !(entry.roomId === room.id && entry.userId === req.params.id));
  try { sendSSE(req.params.slug, 'user-deleted', { id: req.params.id }); } catch (e) {}
  res.json({ success: true });
});

app.get('/api/rooms/:slug/availability', async (req, res) => {
  const room = await ensureRoomExists(req.params.slug);
  if (!room) return res.status(404).json({ error: 'Sala no encontrada' });
  const { usingMongo, availability } = await getCollections();
  let items;
  if (usingMongo) {
    items = await availability.find({ roomId: room.id }).toArray();
  } else {
    items = memoryState.availability.filter((entry) => entry.roomId === room.id);
  }
  if (req.query.month) {
    items = items.filter((entry) => entry.date.startsWith(req.query.month));
  }
  res.json(items.map((item) => normalizeAvailability(item)));
});

app.post('/api/rooms/:slug/availability', async (req, res) => {
  const room = await ensureRoomExists(req.params.slug);
  if (!room) return res.status(404).json({ error: 'Sala no encontrada' });
  const { userId, date, note } = req.body;
  if (!userId || !date) return res.status(400).json({ error: 'Faltan datos' });

  const { usingMongo, availability } = await getCollections();
  const payload = { roomId: room.id, userId, date, note: note || '' };
  if (usingMongo) {
    const existing = await availability.findOne({ roomId: room.id, userId, date });
    if (existing) {
      await availability.updateOne({ _id: existing._id }, { $set: { note: note || '' } });
      const updated = await availability.findOne({ _id: existing._id });
        try { sendSSE(req.params.slug, 'availability-updated', normalizeAvailability(updated)); } catch (e) {}
      return res.json(normalizeAvailability(updated));
    }
    const result = await availability.insertOne({ _id: new ObjectId(), ...payload });
    const created = await availability.findOne({ _id: result.insertedId });
      try { sendSSE(req.params.slug, 'availability-created', normalizeAvailability(created)); } catch (e) {}
    return res.status(201).json(normalizeAvailability(created));
  }

  const existing = memoryState.availability.find((item) => item.roomId === room.id && item.userId === userId && item.date === date);
  if (existing) {
    existing.note = note || '';
    try { sendSSE(req.params.slug, 'availability-updated', existing); } catch (e) {}
    return res.json(existing);
  }
  const item = { id: randomUUID(), ...payload };
  memoryState.availability.push(item);
  try { sendSSE(req.params.slug, 'availability-created', item); } catch (e) {}
  res.status(201).json(item);
});

app.delete('/api/rooms/:slug/availability', async (req, res) => {
  const room = await ensureRoomExists(req.params.slug);
  if (!room) return res.status(404).json({ error: 'Sala no encontrada' });
  const { userId, date } = req.query;
  if (!userId || !date) return res.status(400).json({ error: 'Faltan datos' });
  const { usingMongo, availability } = await getCollections();
  if (usingMongo) {
    await availability.deleteMany({ roomId: room.id, userId, date });
    try { sendSSE(req.params.slug, 'availability-deleted', { userId, date }); } catch (e) {}
    return res.json({ success: true });
  }
  memoryState.availability = memoryState.availability.filter((item) => !(item.roomId === room.id && item.userId === userId && item.date === date));
  try { sendSSE(req.params.slug, 'availability-deleted', { userId, date }); } catch (e) {}
  res.json({ success: true });
});

app.patch('/api/rooms/:slug/availability/move', async (req, res) => {
  const room = await ensureRoomExists(req.params.slug);
  if (!room) return res.status(404).json({ error: 'Sala no encontrada' });
  const { userId, fromDate, toDate } = req.body;
  if (!userId || !fromDate || !toDate) return res.status(400).json({ error: 'Faltan datos' });

  const { usingMongo, availability } = await getCollections();
  if (usingMongo) {
    const existing = await availability.findOne({ roomId: room.id, userId, date: toDate });
    if (existing) {
      return res.status(409).json({ error: 'Ese usuario ya estaba disponible ese día' });
    }
    await availability.deleteMany({ roomId: room.id, userId, date: fromDate });
    const created = await availability.insertOne({ _id: new ObjectId(), roomId: room.id, userId, date: toDate, note: '' });
    const item = await availability.findOne({ _id: created.insertedId });
    try { sendSSE(req.params.slug, 'availability-moved', normalizeAvailability(item)); } catch (e) {}
    return res.json(normalizeAvailability(item));
  }

  const existing = memoryState.availability.find((item) => item.roomId === room.id && item.userId === userId && item.date === toDate);
  if (existing) {
    return res.status(409).json({ error: 'Ese usuario ya estaba disponible ese día' });
  }
  memoryState.availability = memoryState.availability.filter((item) => !(item.roomId === room.id && item.userId === userId && item.date === fromDate));
  const item = { id: randomUUID(), roomId: room.id, userId, date: toDate, note: '' };
  memoryState.availability.push(item);
  try { sendSSE(req.params.slug, 'availability-moved', item); } catch (e) {}
  res.json(item);
});

app.use(express.static(path.join(__dirname, '../client/dist')));
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, '../client/dist/index.html'));
});

// Debug endpoint to check DB status and counts
app.get('/api/debug/db', async (_req, res) => {
  const { usingMongo, rooms, users, availability } = await getCollections();
  try {
    if (usingMongo) {
      const roomsCount = await rooms.countDocuments();
      const usersCount = await users.countDocuments();
      const availabilityCount = await availability.countDocuments();
      return res.json({ usingMongo: true, roomsCount, usersCount, availabilityCount });
    }
    return res.json({ usingMongo: false, roomsCount: memoryState.rooms.length, usersCount: memoryState.users.length, availabilityCount: memoryState.availability.length });
  } catch (err) {
    console.error('Error in /api/debug/db:', err && err.message ? err.message : String(err));
    return res.status(500).json({ error: 'Error comprobando la base de datos' });
  }
});

// Debug endpoint to return sample room documents (first 20)
app.get('/api/debug/rooms', async (_req, res) => {
  const { usingMongo, rooms } = await getCollections();
  try {
    if (usingMongo) {
      const docs = await rooms.find({}).limit(20).toArray();
      return res.json({ usingMongo: true, sample: docs.map(normalizeRoom) });
    }
    return res.json({ usingMongo: false, sample: memoryState.rooms.slice(0, 20) });
  } catch (err) {
    console.error('Error in /api/debug/rooms:', err && err.message ? err.message : String(err));
    return res.status(500).json({ error: 'Error recuperando salas' });
  }
});

// Try to establish DB connection at startup and log mode
(async () => {
  const usingMongo = await connectMongo();
  console.log(`Database connection mode: ${usingMongo ? 'mongo' : 'memory'}`);
  if (usingMongo && process.env.MONGODB_URI) {
    const host = getMongoHostFromUri(process.env.MONGODB_URI);
    console.log(`MongoDB host (from MONGODB_URI): ${host}`);
  }
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
})();
