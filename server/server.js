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
    mongoClient = new MongoClient(process.env.MONGODB_URI);
    await mongoClient.connect();
    db = mongoClient.db(process.env.MONGODB_NAME || 'saliditapp-calendar');
    console.log('Connected to MongoDB Atlas');
    return true;
  } catch (error) {
    console.warn('Falling back to in-memory store:', error.message);
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
    return res.status(201).json(normalizeRoom({ ...roomDoc, _id: result.insertedId }));
  }

  if (memoryState.rooms.some((room) => room.slug === slug)) {
    return res.status(409).json({ error: 'La sala ya existe' });
  }

  const room = { id: randomUUID(), slug, name, startDate, endDate, confirmedDate: null, createdAt: new Date().toISOString() };
  memoryState.rooms.push(room);
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
    return res.json(normalizeRoom(updated));
  }

  const index = memoryState.rooms.findIndex((entry) => entry.slug === req.params.slug);
  memoryState.rooms[index].confirmedDate = nextValue;
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
    return res.status(201).json(normalizeUser(created));
  }

  memoryState.users.push(userDoc);
  res.status(201).json(userDoc);
});

app.delete('/api/rooms/:slug/users/:id', async (req, res) => {
  const room = await ensureRoomExists(req.params.slug);
  if (!room) return res.status(404).json({ error: 'Sala no encontrada' });
  const { usingMongo, users, availability } = await getCollections();
  if (usingMongo) {
    await users.deleteMany({ roomId: room.id, _id: new ObjectId(req.params.id) });
    await availability.deleteMany({ roomId: room.id, userId: req.params.id });
    return res.json({ success: true });
  }

  memoryState.users = memoryState.users.filter((user) => !(user.roomId === room.id && user.id === req.params.id));
  memoryState.availability = memoryState.availability.filter((entry) => !(entry.roomId === room.id && entry.userId === req.params.id));
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
      return res.json(normalizeAvailability(updated));
    }
    const result = await availability.insertOne({ _id: new ObjectId(), ...payload });
    const created = await availability.findOne({ _id: result.insertedId });
    return res.status(201).json(normalizeAvailability(created));
  }

  const existing = memoryState.availability.find((item) => item.roomId === room.id && item.userId === userId && item.date === date);
  if (existing) {
    existing.note = note || '';
    return res.json(existing);
  }
  const item = { id: randomUUID(), ...payload };
  memoryState.availability.push(item);
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
    return res.json({ success: true });
  }
  memoryState.availability = memoryState.availability.filter((item) => !(item.roomId === room.id && item.userId === userId && item.date === date));
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
    return res.json(normalizeAvailability(item));
  }

  const existing = memoryState.availability.find((item) => item.roomId === room.id && item.userId === userId && item.date === toDate);
  if (existing) {
    return res.status(409).json({ error: 'Ese usuario ya estaba disponible ese día' });
  }
  memoryState.availability = memoryState.availability.filter((item) => !(item.roomId === room.id && item.userId === userId && item.date === fromDate));
  const item = { id: randomUUID(), roomId: room.id, userId, date: toDate, note: '' };
  memoryState.availability.push(item);
  res.json(item);
});

app.use(express.static(path.join(__dirname, '../client/dist')));
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, '../client/dist/index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
