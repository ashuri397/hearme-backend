const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json()); 


app.post('/api/telemetry', async (req, res) => {
    const { device_id, detected_sound, confidence, severity, latitude, longitude } = req.body;

    
    if (!device_id || !detected_sound || !latitude || !longitude) {
        return res.status(400).json({ status: 'error', message: 'Incomplete ESP32 payload' });
    }

    const telemetryData = {
        device_id,
        detected_sound,
        confidence,
        severity,
        latitude: parseFloat(latitude),
        longitude: parseFloat(longitude),
        created_at: new Date()
    };

    console.log('New ESP32-S3 Telemetry Received:', telemetryData);

    
    res.status(201).json({
        status: 'success',
        message: 'Telemetry saved to database',
        data: telemetryData
    });
});


app.get('/api/alerts/:device_id', async (req, res) => {
    const { device_id } = req.params;
    
    res.status(200).json({ device_id, alerts: [] });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`HearMe Backend API Server running on port ${PORT}`);
});

