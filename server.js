const express = require('express');
const cors = require('cors');
const crypto = require('crypto');

const app = express();
app.use(cors());
app.use(express.json());

// ==========================================
// 1. FIREBASE INITIALIZATION
// ==========================================
let db = null;
let firebaseError = null;

if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  try {
    const admin = require('firebase-admin');
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

    if (serviceAccount.private_key) {
      serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
    }

    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });

    db = admin.firestore();
    console.log('Firestore connected successfully');
  } catch (e) {
    firebaseError = e.message;
    console.error('Firebase init failed, using memory store:', e.message);
  }
} else {
  console.warn('FIREBASE_SERVICE_ACCOUNT not set, using in-memory store.');
}

// ==========================================
// 2. HELPERS & IN-MEMORY FALLBACK
// ==========================================
const SEVERITY = {
  'Fire Alarm': 'Critical',
  'Emergency Siren': 'Critical',
  'Glass Breaking': 'Critical',
  'Scream / Shout': 'Critical',
  'Vehicle Horn': 'Warning',
  'Dog Barking': 'Warning',
  'Doorbell': 'Info',
  'Door Knock': 'Info',
  'Phone Ringing': 'Info'
};

const hashPassword = (pw) => crypto.createHash('sha256').update(String(pw)).digest('hex');

const memoryAlerts = [];
const memoryUsers = [
  {
    id: 'seed-superadmin',
    name: 'Super Admin',
    email: 'superadmin@hearme.ph',
    password_hash: hashPassword('1234'),
    role: 'Super Admin',
    device_id: 'ALL DEVICES',
    created_at: Date.now()
  },
  {
    id: 'seed-admin',
    name: 'Admin',
    email: 'admin@hearme.ph',
    password_hash: hashPassword('1234'),
    role: 'Admin',
    device_id: 'ALL DEVICES',
    created_at: Date.now()
  },
  {
    id: 'seed-guardian',
    name: 'Guardian',
    email: 'guardian@hearme.ph',
    password_hash: hashPassword('1234'),
    role: 'Guardian',
    device_id: 'HM-BR-042',
    created_at: Date.now()
  }
];

const toAlert = (d) => ({
  id: d.id,
  detected_at: new Date(d.created_at || Date.now()).toISOString().replace('T', ' ').slice(0, 19),
  device_id: d.device_id,
  detected_sound: d.detected_sound,
  confidence: d.confidence,
  severity: d.severity,
  lat: d.latitude,
  lng: d.longitude
});

const toUser = (u) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  role: u.role,
  device_id: u.device_id,
  created_at: new Date(u.created_at || Date.now()).toISOString().slice(0, 10)
});

// ==========================================
// 3. HEALTH CHECK ROUTE
// ==========================================
app.get('/health', (req, res) => {
  res.json({
    ok: true,
    storage: db ? 'firestore' : 'memory',
    firebase_error: firebaseError
  });
});

// ==========================================
// 4. TELEMETRY & ALERTS ROUTES (ESP32 + WEB)
// ==========================================
app.post('/api/telemetry', async (req, res) => {
  const body = req.body || {};
  const device_id = body.device_id;
  const detected_sound = body.detected_sound;
  const confidence = body.confidence;
  const severity = body.severity;
  const lat = parseFloat(body.latitude);
  const lng = parseFloat(body.longitude);

  if (!device_id || !detected_sound || Number.isNaN(lat) || Number.isNaN(lng)) {
    return res.status(400).json({ status: 'error', message: 'Incomplete ESP32 payload' });
  }

  const doc = {
    device_id: String(device_id).slice(0, 30),
    detected_sound: String(detected_sound).slice(0, 40),
    confidence: confidence !== undefined ? confidence : null,
    severity: severity || SEVERITY[detected_sound] || 'Info',
    latitude: lat,
    longitude: lng,
    created_at: Date.now()
  };

  try {
    if (db) {
      const ref = await db.collection('alerts').add(doc);
      doc.id = ref.id;
    } else {
      doc.id = String(doc.created_at);
      memoryAlerts.unshift(doc);
      if (memoryAlerts.length > 500) {
        memoryAlerts.pop();
      }
    }
    console.log('Telemetry saved:', doc);
    return res.status(201).json({ status: 'success', message: 'Telemetry saved', data: toAlert(doc) });
  } catch (e) {
    console.error('POST /api/telemetry error:', e);
    return res.status(500).json({ status: 'error', message: 'Database error', detail: e.message });
  }
});

async function listAlerts(device_id) {
  if (db) {
    let q = db.collection('alerts');
    if (device_id && device_id !== 'ALL DEVICES') {
      q = q.where('device_id', '==', device_id);
    }
    const snap = await q.get();
    return snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
      .slice(0, 100)
      .map(toAlert);
  }
  return memoryAlerts
    .filter((d) => !device_id || device_id === 'ALL DEVICES' || d.device_id === device_id)
    .slice(0, 100)
    .map(toAlert);
}

app.get('/api/alerts', async (req, res) => {
  try {
    const alerts = await listAlerts();
    return res.json({ status: 'success', alerts });
  } catch (e) {
    console.error('GET /api/alerts error:', e);
    return res.status(500).json({ status: 'error', message: 'Database error', detail: e.message });
  }
});

app.get('/api/alerts/:device_id', async (req, res) => {
  try {
    const alerts = await listAlerts(req.params.device_id);
    return res.json({ status: 'success', device_id: req.params.device_id, alerts });
  } catch (e) {
    console.error('GET /api/alerts/:device_id error:', e);
    return res.status(500).json({ status: 'error', message: 'Database error', detail: e.message });
  }
});

app.delete('/api/alerts/:id', async (req, res) => {
  const id = req.params.id;
  try {
    if (db) {
      await db.collection('alerts').doc(id).delete();
    } else {
      const idx = memoryAlerts.findIndex((a) => a.id === id);
      if (idx !== -1) {
        memoryAlerts.splice(idx, 1);
      }
    }
    return res.json({ status: 'success', message: 'Alert deleted' });
  } catch (e) {
    console.error('DELETE /api/alerts/:id error:', e);
    return res.status(500).json({ status: 'error', message: 'Database error', detail: e.message });
  }
});

// ==========================================
// 5. AUTH & USER MANAGEMENT ROUTES
// ==========================================
app.post('/api/register', async (req, res) => {
  const body = req.body || {};
  const name = body.name;
  const email = body.email;
  const password = body.password;
  const device_id = body.device_id;
  const role = body.role;

  if (!name || !email || !password) {
    return res.status(400).json({ status: 'error', message: 'Name, email, and password are required' });
  }

  const normalizedEmail = String(email).trim().toLowerCase();
  const newUser = {
    name: String(name).trim(),
    email: normalizedEmail,
    password_hash: hashPassword(password),
    role: role || 'Guardian',
    device_id: device_id ? String(device_id).trim() : 'UNASSIGNED',
    created_at: Date.now()
  };

  try {
    if (db) {
      const existing = await db.collection('users').where('email', '==', normalizedEmail).get();
      if (!existing.empty) {
        return res.status(409).json({ status: 'error', message: 'Email already registered' });
      }
      const ref = await db.collection('users').add(newUser);
      newUser.id = ref.id;
    } else {
      if (memoryUsers.some((u) => u.email === normalizedEmail)) {
        return res.status(409).json({ status: 'error', message: 'Email already registered' });
      }
      newUser.id = String(newUser.created_at);
      memoryUsers.push(newUser);
    }
    return res.status(201).json({ status: 'success', user: toUser(newUser) });
  } catch (e) {
    console.error('POST /api/register error:', e);
    return res.status(500).json({ status: 'error', message: 'Database error', detail: e.message });
  }
});

app.post('/api/login', async (req, res) => {
  const body = req.body || {};
  const email = body.email;
  const password = body.password;

  if (!email || !password) {
    return res.status(400).json({ status: 'error', message: 'Email and password are required' });
  }

  const normalizedEmail = String(email).trim().toLowerCase();
  const pwHash = hashPassword(password);

  try {
    let foundUser = null;

    if (db) {
      const snap = await db.collection('users').where('email', '==', normalizedEmail).get();
      if (!snap.empty) {
        const firstDoc = snap.docs[0];
        foundUser = { id: firstDoc.id, ...firstDoc.data() };
      }
    }

    if (!foundUser) {
      foundUser = memoryUsers.find((u) => u.email === normalizedEmail);
    }

    if (!foundUser || foundUser.password_hash !== pwHash) {
      return res.status(401).json({ status: 'error', message: 'Invalid email or password' });
    }

    return res.json({ status: 'success', user: toUser(foundUser) });
  } catch (e) {
    console.error('POST /api/login error:', e);
    return res.status(500).json({ status: 'error', message: 'Database error', detail: e.message });
  }
});

app.get('/api/users', async (req, res) => {
  try {
    if (db) {
      const snap = await db.collection('users').get();
      const users = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
        .map(toUser);
      return res.json({ status: 'success', users });
    }
    return res.json({ status: 'success', users: memoryUsers.map(toUser) });
  } catch (e) {
    console.error('GET /api/users error:', e);
    return res.status(500).json({ status: 'error', message: 'Database error', detail: e.message });
  }
});
      app.delete('/api/users/:id', async (req, res) => {
  const id = req.params.id;
  try {
    if (db) {
      await db.collection('users').doc(id).delete();
    } else {
      const idx = memoryUsers.findIndex((u) => u.id === id);
      if (idx !== -1) {
        memoryUsers.splice(idx, 1);
      }
    }
    return res.json({ status: 'success', message: 'User deleted' });
  } catch (e) {
    console.error('DELETE /api/users/:id error:', e);
    return res.status(500).json({ status: 'error', message: 'Database error', detail: e.message });
  }
});

// ==========================================
// 6. START SERVER
// ==========================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`HearMe Backend API running on port ${PORT}`));

