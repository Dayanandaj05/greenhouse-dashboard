require('dotenv').config();
const API = process.env.API_URL || 'http://localhost:3000';
const KEY = process.env.WRITE_KEY || '';
const rand = (a, b) => +(a + Math.random() * (b - a)).toFixed(1);

async function tick() {
  try {
    const beds = await (await fetch(`${API}/api/beds`)).json();
    for (const b of beds) {
      const faulty = Math.random() < 0.05; // 5% chance of a bad reading
      const body = {
        bed_id: b.id,
        soil_moisture: faulty ? 0 : rand(30, 70),
        temperature: faulty ? 59.9 : rand(20, 30),
        humidity: rand(50, 85),
        source: 'sensor',
        notes: faulty ? 'Suspicious spike' : null,
      };
      const r = await fetch(`${API}/api/readings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-write-key': KEY },
        body: JSON.stringify(body),
      });
      console.log(new Date().toISOString(), b.name, r.status);
    }
  } catch (e) { console.error('Simulator error:', e.message); }
}
tick();
setInterval(tick, 10000);
