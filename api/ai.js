// api/ai.js  (just drop this file in your /api folder)
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body)
    }
  );

  const data = await response.json();
  res.json(data);
}
