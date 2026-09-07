// Porchlight AI proxy — runs on Cloudflare Workers.
// Holds the OpenAI API key as a secret so it's never exposed in the
// public index.html. Only accepts requests from the Porchlight site itself.
// Two endpoints:
//   POST /            -> text translation (chat completion)
//   POST /transcribe  -> voice transcription (Whisper)

const ALLOWED_ORIGIN = "https://freakash.github.io";

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders() });
    }
    if (request.method !== "POST") {
      return jsonResponse({ error: "Method not allowed" }, 405);
    }

    const url = new URL(request.url);
    if (url.pathname === "/transcribe") {
      return handleTranscribe(request, env);
    }
    return handleTranslate(request, env);
  },
};

async function handleTranslate(request, env) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return jsonResponse({ error: "Invalid JSON" }, 400);
  }

  const text = (body.text || "").toString().slice(0, 2000).trim();
  const targetLang = body.targetLang === "ta" ? "Tamil" : "English";
  if (!text) {
    return jsonResponse({ error: "No text provided" }, 400);
  }

  let openaiRes;
  try {
    openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `Translate the user's message into ${targetLang}. Reply with ONLY the translation — no notes, no quotation marks, no explanation.`,
          },
          { role: "user", content: text },
        ],
        temperature: 0.2,
      }),
    });
  } catch (e) {
    return jsonResponse({ error: "Could not reach translation service" }, 502);
  }

  if (!openaiRes.ok) {
    return jsonResponse({ error: "Translation service error" }, 502);
  }

  const data = await openaiRes.json();
  const translation =
    data.choices && data.choices[0] && data.choices[0].message
      ? data.choices[0].message.content.trim()
      : "";

  return jsonResponse({ translation });
}

async function handleTranscribe(request, env) {
  const contentLength = Number(request.headers.get("content-length") || 0);
  // ~10MB cap — a few minutes of compressed speech audio, plenty for a message-length recording.
  if (contentLength > 10 * 1024 * 1024) {
    return jsonResponse({ error: "Audio too large" }, 413);
  }

  let incomingForm;
  try {
    incomingForm = await request.formData();
  } catch (e) {
    return jsonResponse({ error: "Invalid form data" }, 400);
  }

  const audio = incomingForm.get("audio");
  if (!audio) {
    return jsonResponse({ error: "No audio provided" }, 400);
  }

  const lang = incomingForm.get("lang") === "ta" ? "ta" : "en";

  const outgoingForm = new FormData();
  outgoingForm.append("file", audio, "speech.webm");
  outgoingForm.append("model", "whisper-1");
  outgoingForm.append("language", lang);

  let openaiRes;
  try {
    openaiRes = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${env.OPENAI_API_KEY}` },
      body: outgoingForm,
    });
  } catch (e) {
    return jsonResponse({ error: "Could not reach transcription service" }, 502);
  }

  if (!openaiRes.ok) {
    return jsonResponse({ error: "Transcription service error" }, 502);
  }

  const data = await openaiRes.json();
  return jsonResponse({ text: (data.text || "").trim() });
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function jsonResponse(obj, status) {
  status = status || 200;
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders() },
  });
}
