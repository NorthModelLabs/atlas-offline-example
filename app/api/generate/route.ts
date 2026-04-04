import { NextRequest, NextResponse } from "next/server";

const API_URL = process.env.ATLAS_API_URL;
const API_KEY = process.env.ATLAS_API_KEY;

export const maxDuration = 300;

async function atlas(path: string, init?: RequestInit) {
  return fetch(`${API_URL}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${API_KEY}`, ...init?.headers },
  });
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function POST(req: NextRequest) {
  if (!API_URL || !API_KEY) {
    return NextResponse.json({ error: "ATLAS_API_URL and ATLAS_API_KEY not configured." }, { status: 503 });
  }

  const form = await req.formData();
  const mode = (form.get("mode") as string) || "text";
  const image = form.get("image");

  if (!(image instanceof File) || image.size < 16) {
    return NextResponse.json({ error: "Face image is required." }, { status: 400 });
  }

  try {
    // --- Step 1: Submit job ---
    let jobId: string;

    if (mode === "audio") {
      const audio = form.get("audio");
      if (!(audio instanceof File) || audio.size === 0) {
        return NextResponse.json({ error: "Audio file is required." }, { status: 400 });
      }
      const up = new FormData();
      up.append("audio", audio);
      up.append("image", image);
      const res = await atlas("/v1/generate", { method: "POST", body: up });
      if (!res.ok) return NextResponse.json({ error: "Submit failed.", detail: await res.text().catch(() => "") }, { status: 502 });
      jobId = (await res.json()).job_id;

    } else if (mode === "elevenlabs") {
      const text = (form.get("text") as string)?.trim();
      const elKey = (form.get("elevenlabs_key") as string)?.trim();
      const elVoice = (form.get("elevenlabs_voice") as string)?.trim() || "JBFqnCBsd6RMkjVDRZzb";
      if (!text) return NextResponse.json({ error: "Text is required." }, { status: 400 });
      if (!elKey) return NextResponse.json({ error: "ElevenLabs API key is required." }, { status: 400 });

      const ttsRes = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${elVoice}`, {
        method: "POST",
        headers: { "xi-api-key": elKey, "Content-Type": "application/json" },
        body: JSON.stringify({ text, model_id: "eleven_multilingual_v2" }),
      });
      if (!ttsRes.ok) return NextResponse.json({ error: "ElevenLabs TTS failed.", detail: await ttsRes.text().catch(() => "") }, { status: 502 });

      const up = new FormData();
      up.append("audio", new File([await ttsRes.arrayBuffer()], "tts.mp3", { type: "audio/mpeg" }));
      up.append("image", image);
      const res = await atlas("/v1/generate", { method: "POST", body: up });
      if (!res.ok) return NextResponse.json({ error: "Submit failed.", detail: await res.text().catch(() => "") }, { status: 502 });
      jobId = (await res.json()).job_id;

    } else {
      const text = (form.get("text") as string)?.trim();
      const voice = (form.get("voice") as string)?.trim() || "";
      if (!text) return NextResponse.json({ error: "Text is required." }, { status: 400 });

      const up = new FormData();
      up.append("image", image);
      const h: Record<string, string> = { text, language: "Auto" };
      if (voice) h.instruct = voice;
      const res = await atlas("/v1/tts/generate-video", { method: "POST", headers: h, body: up });
      if (!res.ok) return NextResponse.json({ error: "Submit failed.", detail: await res.text().catch(() => "") }, { status: 502 });
      jobId = (await res.json()).job_id;
    }

    // --- Step 2: Poll until done ---
    for (let i = 0; i < 120; i++) {
      await sleep(3000);
      const poll = await atlas(`/v1/jobs/${jobId}`, { cache: "no-store" });
      if (!poll.ok) continue;
      const job = await poll.json();

      if (job.status === "completed") {
        if (job.url) {
          return NextResponse.json({ job_id: jobId, url: job.url });
        }
        // Fallback: fetch presigned URL from /result
        const result = await atlas(`/v1/jobs/${jobId}/result`);
        if (result.ok) {
          const data = await result.json();
          return NextResponse.json({ job_id: jobId, url: data.url });
        }
        return NextResponse.json({ error: "Result not available." }, { status: 502 });
      }

      if (job.status === "failed") {
        return NextResponse.json({ error: job.error_message || "Job failed.", job_id: jobId }, { status: 502 });
      }
    }

    return NextResponse.json({ error: "Timed out.", job_id: jobId }, { status: 504 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Generation failed." }, { status: 502 });
  }
}
