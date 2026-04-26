export async function generateAIVerdict(
  teamName: string,
  playmakers: any[],
  goalSequences: any[]
): Promise<{ verdict: any[]; alerts: any[] }> {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
  
  if (!apiKey) {
    throw new Error("VITE_GEMINI_API_KEY is not defined in .env. Please add it to generate real AI insights.");
  }

  // Construct a prompt summarizing the team's data
  const topPlayers = playmakers.slice(0, 3).map(p => `${p.name} (${p.pos}) - xT: ${p.xt.toFixed(2)}, Passes: ${p.passes}`).join('\n');
  const goalsStr = goalSequences.slice(0, 5).map(g => `Goal by ${g.scorer} at min ${g.minute}`).join('\n');

  const prompt = `
You are an expert football tactical analyst. Analyze the following data for the team "${teamName}" based on their recent matches.

Top Playmakers (by Expected Threat - xT):
${topPlayers}

Recent Goal Sequences:
${goalsStr || "No recent goal sequences found."}

Based on this data, provide a JSON response with two arrays: "verdict" and "alerts".

1. "verdict" must be an array of exactly 4 objects, each with:
- "phase": string (e.g., "Phase 1 & 2", "Phase 3")
- "title": string (e.g., "Zone Analysis", "Vulnerability Map")
- "body": string (Detailed tactical explanation based on the data provided).

2. "alerts" must be an array of exactly 4 objects, each with:
- "severity": "critical" | "warning" | "info"
- "zone": string (e.g., "Left Channel", "Central")
- "title": string
- "verdict": string (Start with "AI Verdict: ")

IMPORTANT: Return ONLY valid JSON. No markdown formatting, no backticks.
  `;

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        response_mime_type: "application/json"
      }
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Failed to generate AI verdict: ${err}`);
  }

  const data = await response.json();
  const textContent = data.candidates[0].content.parts[0].text;
  
  try {
    const parsed = JSON.parse(textContent);
    return parsed;
  } catch (e) {
    throw new Error("Failed to parse LLM response as JSON.");
  }
}
