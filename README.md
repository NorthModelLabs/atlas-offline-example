# Atlas Offline — Example App

Generate avatar videos with the [Atlas](https://www.northmodellabs.com) API. Three modes, one pattern: submit a job, poll until done, get a presigned download URL.

## Quick Start

```bash
npm install
cp .env.example .env.local   # fill in your Atlas API key
npm run dev
```

## How It Works

```
POST /v1/generate (or /v1/tts/generate-video)
  → 202 { job_id }

GET /v1/jobs/{id}
  → { status: "completed", url: "https://..." }

url is a presigned S3 link (24h) — no auth needed.
Works in <video> tags, download links, anywhere.
```

This app wraps it in a single Next.js API route (`POST /api/generate`) that handles submit + poll server-side and returns the presigned URL. Your API key never leaves the server.

---

## Mode 1: External TTS + Image → Video

Generate speech with any TTS provider (ElevenLabs, OpenAI, Deepgram, etc.), then send the audio + a face image to Atlas for lip-sync.

**Endpoints:** Your TTS provider → `POST /v1/generate`

```javascript
// Step 1: Generate speech with your TTS provider
const tts = await fetch(
  "https://api.elevenlabs.io/v1/text-to-speech/JBFqnCBsd6RMkjVDRZzb",
  {
    method: "POST",
    headers: {
      "xi-api-key": "YOUR_ELEVENLABS_KEY",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text: "Hello, welcome to our demo.",
      model_id: "eleven_multilingual_v2",
    }),
  },
);
const audioBlob = await tts.blob();

// Step 2: Send audio + face to Atlas
const form = new FormData();
form.append("audio", audioBlob, "speech.mp3");
form.append("image", faceImage);

const res = await fetch("https://api.atlasv1.com/v1/generate", {
  method: "POST",
  headers: { authorization: "Bearer YOUR_API_KEY" },
  body: form,
});

const { job_id } = await res.json();

// Step 3: Poll — presigned URL included in response
let videoUrl;
while (true) {
  const job = await fetch(`https://api.atlasv1.com/v1/jobs/${job_id}`, {
    headers: { authorization: "Bearer YOUR_API_KEY" },
  }).then(r => r.json());

  if (job.status === "completed") { videoUrl = job.url; break; }
  if (job.status === "failed") throw new Error(job.error);
  await new Promise(r => setTimeout(r, 3000));
}
```

---

## Mode 2: Text + Image → Video

Atlas handles TTS + lip-sync. You provide text and a face image — one endpoint, one job.

**Endpoint:** `POST /v1/tts/generate-video`

```javascript
const form = new FormData();
form.append("image", faceImage);

const res = await fetch("https://api.atlasv1.com/v1/tts/generate-video", {
  method: "POST",
  headers: {
    authorization: "Bearer YOUR_API_KEY",
    text: "Hello, welcome to our demo.",
    language: "Auto",
    instruct: "warm, professional, male",
  },
  body: form,
});

const { job_id } = await res.json();

// Poll until done — presigned URL included in response
let videoUrl;
while (true) {
  const job = await fetch(`https://api.atlasv1.com/v1/jobs/${job_id}`, {
    headers: { authorization: "Bearer YOUR_API_KEY" },
  }).then(r => r.json());

  if (job.status === "completed") {
    videoUrl = job.url;  // presigned S3 URL, no auth needed
    break;
  }
  if (job.status === "failed") throw new Error(job.error);
  await new Promise(r => setTimeout(r, 3000));
}

// Use directly
console.log(videoUrl);
```

---

## Mode 3: Audio + Image → Video

Bring your own audio file (any TTS provider, a recording, anything). Atlas does lip-sync only.

**Endpoint:** `POST /v1/generate`

```javascript
const form = new FormData();
form.append("audio", audioFile);  // MP3, WAV, OGG
form.append("image", faceImage);

const res = await fetch("https://api.atlasv1.com/v1/generate", {
  method: "POST",
  headers: { authorization: "Bearer YOUR_API_KEY" },
  body: form,
});

const { job_id } = await res.json();

let videoUrl;
while (true) {
  const job = await fetch(`https://api.atlasv1.com/v1/jobs/${job_id}`, {
    headers: { authorization: "Bearer YOUR_API_KEY" },
  }).then(r => r.json());

  if (job.status === "completed") {
    videoUrl = job.url;
    break;
  }
  if (job.status === "failed") throw new Error(job.error);
  await new Promise(r => setTimeout(r, 3000));
}

console.log(videoUrl);
```

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `ATLAS_API_URL` | Yes | Atlas API base URL (`https://api.atlasv1.com`) |
| `ATLAS_API_KEY` | Yes | Your Atlas API key (`ak_...`) |

## API Response

When a job completes, the poll response includes:

```json
{
  "job_id": "a1b2c3d4e5f6",
  "status": "completed",
  "url": "https://storage.example.com/jobs/.../output.mp4?X-Amz-...",
  "result_url": "/v1/jobs/a1b2c3d4e5f6/result",
  "expires_in": 86400
}
```

`url` is a presigned S3 link valid for 24 hours. Use it directly — no auth headers needed.

You can also call `GET /v1/jobs/{id}/result` with your API key to get:

```json
{
  "url": "https://storage.example.com/...",
  "content_type": "video/mp4",
  "expires_in": 86400
}
```

## License

MIT
