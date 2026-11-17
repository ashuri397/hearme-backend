const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');

const app = express();
app.use(cors());
app.use(express.json());

// Ikonekta ang Firebase Firestore gamit ang serviceAccountKey.json
const serviceAccount = require('./serviceAccountKey.json');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();

// 1. Save Sound & GPS Alert sa Firestore
app.post('/api/telemetry', async (req, res) => {
  try {
    const { device_id, detected_sound, confidence, severity, latitude, longitude } = req.body;
    const newAlert = {
      device_id,
      detected_sound,
      confidence,
      severity,
      lat: parseFloat(latitude),
      lng: parseFloat(longitude),
      detected_at: new Date().toISOString().replace('T', ' ').substring(0, 19)
    };
    await db.collection('sound_alerts').add(newAlert);
    res.status(201).json({ status: 'success', data: newAlert });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// 2. Kunin ang Lahat ng Saved Alerts mula sa Firestore
app.get('/api/alerts', async (req, res) => {
  try {
    const snapshot = await db.collection('sound_alerts').get();
    const alerts = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    alerts.sort((a, b) => b.detected_at.localeCompare(a.detected_at));
    res.status(200).json({ status: 'success', alerts });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// 3. Register Guardian & Pair Wearable Device
app.post('/api/register', async (req, res) => {
  try {
    const { full_name, email, password, device } = req.body;
    await db.collection('users').doc(email).set({
      full_name,
      email,
      password,
      role: 'User (Guardian)',
      device,
      status: 'Active',
      last_login: 'Newly Registered'
    });
    res.status(201).json({ status: 'success' });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// 4. Record Login Activity
app.post('/api/login', async (req, res) => {
  try {
    const { email, role, device } = req.body;
    const loginTime = new Date().toISOString().replace('T', ' ').substring(0, 19);
    await db.collection('users').doc(email).set({
      email,
      role,
      device,
      status: 'Online',
      last_login: loginTime
    }, { merge: true });
    res.status(200).json({ status: 'success' });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// 5. Kunin ang Registered Users para sa Admin/Super Admin
app.get('/api/users', async (req, res) => {
  try {
    const snapshot = await db.collection('users').get();
    const users = snapshot.docs.map(doc => doc.data());
    res.status(200).json({ status: 'success', users });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`HearMe Firestore API running on port ${PORT}`));
