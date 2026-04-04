"use client";

import { useState, useRef } from "react";

type Mode = "text" | "audio" | "elevenlabs";

const MODES: { id: Mode; label: string; desc: string }[] = [
  { id: "text", label: "Text → Video", desc: "Atlas handles TTS + lip-sync" },
  { id: "audio", label: "Audio → Video", desc: "You provide your own audio" },
  { id: "elevenlabs", label: "ElevenLabs → Video", desc: "Your ElevenLabs key + Atlas lip-sync" },
];

const CODE_SNIPPETS: Record<Mode, string> = {
  text: `// POST /v1/tts/generate-video
// Text + face image → Atlas TTS + lip-sync → MP4

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
  const job = await fetch(\`/v1/jobs/\${job_id}\`, { headers }).then(r => r.json());
  if (job.status === "completed") {
    videoUrl = job.url;  // public presigned URL, no auth needed
    break;
  }
  if (job.status === "failed") throw new Error(job.error);
  await new Promise(r => setTimeout(r, 3000));
}

// videoUrl is a time-limited presigned S3 URL
// Use directly in <video src>, download links, etc.
console.log(videoUrl);`,

  audio: `// POST /v1/generate
// Your audio + face image → Atlas lip-sync → MP4
// Works with any TTS: ElevenLabs, OpenAI, Deepgram, etc.

const form = new FormData();
form.append("audio", audioFile);  // MP3, WAV, OGG
form.append("image", faceImage);

const res = await fetch("https://api.atlasv1.com/v1/generate", {
  method: "POST",
  headers: { authorization: "Bearer YOUR_API_KEY" },
  body: form,
});

const { job_id } = await res.json();

// Poll until done — presigned URL included in response
let videoUrl;
while (true) {
  const job = await fetch(\`/v1/jobs/\${job_id}\`, { headers }).then(r => r.json());
  if (job.status === "completed") {
    videoUrl = job.url;  // public presigned URL, no auth needed
    break;
  }
  if (job.status === "failed") throw new Error(job.error);
  await new Promise(r => setTimeout(r, 3000));
}

console.log(videoUrl);  // use directly — no proxy needed`,

  elevenlabs: `// ElevenLabs TTS → Atlas /v1/generate
// Text → ElevenLabs voice → Atlas lip-sync → MP4

// Step 1: Generate speech with ElevenLabs
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

// Step 3: Poll — same pattern, presigned URL in response
let videoUrl;
while (true) {
  const job = await fetch(\`/v1/jobs/\${job_id}\`, { headers }).then(r => r.json());
  if (job.status === "completed") { videoUrl = job.url; break; }
  if (job.status === "failed") throw new Error(job.error);
  await new Promise(r => setTimeout(r, 3000));
}`,
};

export default function Home() {
  const [mode, setMode] = useState<Mode>("text");
  const [generating, setGenerating] = useState(false);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [showCode, setShowCode] = useState(false);

  const [text, setText] = useState("");
  const [voice, setVoice] = useState("");
  const [facePreview, setFacePreview] = useState<string | null>(null);
  const [audioName, setAudioName] = useState<string | null>(null);
  const [elKey, setElKey] = useState("");
  const [elVoice, setElVoice] = useState("");

  const faceRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const generate = async () => {
    const face = faceRef.current?.files?.[0];
    if (!face) return;

    setGenerating(true);
    setError("");
    setVideoUrl(null);
    setElapsed(0);
    const t0 = Date.now();
    timerRef.current = setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 1000);

    const form = new FormData();
    form.append("mode", mode);
    form.append("image", face);

    if (mode === "text") {
      form.append("text", text.trim());
      if (voice.trim()) form.append("voice", voice.trim());
    } else if (mode === "audio") {
      const a = audioRef.current?.files?.[0];
      if (!a) { setError("Select an audio file."); stop(); return; }
      form.append("audio", a);
    } else {
      form.append("text", text.trim());
      form.append("elevenlabs_key", elKey.trim());
      if (elVoice.trim()) form.append("elevenlabs_voice", elVoice.trim());
    }

    try {
      const res = await fetch("/api/generate", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok || !data.url) { setError(data.error || "Generation failed."); stop(); return; }
      setVideoUrl(data.url);
    } catch {
      setError("Network error.");
    }
    stop();
  };

  function stop() {
    if (timerRef.current) clearInterval(timerRef.current);
    setGenerating(false);
  }

  const reset = () => { stop(); setVideoUrl(null); setError(""); setElapsed(0); };

  const ready =
    !!facePreview && !generating &&
    (mode === "text" ? !!text.trim() : true) &&
    (mode === "audio" ? !!audioName : true) &&
    (mode === "elevenlabs" ? !!text.trim() && !!elKey.trim() : true);

  const modeInfo = MODES.find((m) => m.id === mode)!;
  const inputCls = "w-full rounded-xl bg-white/[0.04] border border-white/[0.06] px-4 py-3 text-[13px] text-white placeholder:text-white/20 focus:outline-none focus:border-white/20 disabled:opacity-30 transition";

  return (
    <div className="h-screen flex flex-col bg-[#0a0a0a]">
      {/* Top bar */}
      <div className="h-11 flex items-center justify-between px-5 border-b border-white/[0.04] shrink-0">
        <span className="text-[13px] font-semibold text-white/90">Atlas Offline</span>
        <a href="https://www.northmodellabs.com/api" target="_blank" rel="noopener noreferrer"
          className="text-[11px] text-white/25 hover:text-white/50 transition">API Docs &rarr;</a>
      </div>

      <div className="flex-1 flex min-h-0">
        {/* ---- Left ---- */}
        <div className="w-[480px] shrink-0 flex flex-col border-r border-white/[0.04] overflow-y-auto">
          <div className="flex-1 p-6 flex flex-col gap-5">

            {/* Mode selector */}
            <div>
              <div className="flex gap-2 mb-3">
                {MODES.map((m) => (
                  <button key={m.id} onClick={() => !generating && setMode(m.id)}
                    className={`px-4 py-2 rounded-full text-[12px] font-medium border transition ${
                      mode === m.id
                        ? "bg-white text-black border-white"
                        : "bg-transparent text-white/40 border-white/[0.06] hover:text-white/70 hover:border-white/15"
                    } ${generating ? "pointer-events-none" : ""}`}>
                    {m.label}
                  </button>
                ))}
              </div>
              <p className="text-[12px] text-white/25">{modeInfo.desc}</p>
            </div>

            {/* Face upload */}
            <div>
              <label className="text-[12px] text-white/40 mb-2 block">Face image</label>
              <label className={`relative flex flex-col items-center justify-center rounded-2xl border border-dashed transition cursor-pointer overflow-hidden ${
                facePreview ? "h-48 border-white/10" : "h-40 border-white/[0.08] hover:border-white/20"
              } ${generating ? "opacity-30 pointer-events-none" : ""}`}>
                {facePreview ? (
                  <img src={facePreview} alt="" className="absolute inset-0 w-full h-full object-cover" />
                ) : (
                  <>
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" className="text-white/15 mb-2">
                      <path d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    <span className="text-[12px] text-white/25">Click to upload</span>
                    <span className="text-[10px] text-white/12 mt-0.5">JPG, PNG, WebP &middot; Max 10MB</span>
                  </>
                )}
                <input ref={faceRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" disabled={generating}
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) setFacePreview(URL.createObjectURL(f)); }} />
              </label>
            </div>

            {/* Text / Script */}
            {(mode === "text" || mode === "elevenlabs") && (
              <div>
                <label className="text-[12px] text-white/40 mb-2 block">Script</label>
                <textarea value={text} onChange={(e) => setText(e.target.value)}
                  placeholder="What should the avatar say..." rows={4} disabled={generating}
                  className={`${inputCls} resize-none`} />
              </div>
            )}

            {/* Voice design */}
            {mode === "text" && (
              <div>
                <label className="text-[12px] text-white/40 mb-2 block">Voice design <span className="text-white/15">(optional)</span></label>
                <input value={voice} onChange={(e) => setVoice(e.target.value)}
                  placeholder="e.g. warm, professional, male" disabled={generating} className={inputCls} />
              </div>
            )}

            {/* Audio upload */}
            {mode === "audio" && (
              <div>
                <label className="text-[12px] text-white/40 mb-2 block">Audio file</label>
                <label className={`flex items-center justify-center h-24 rounded-xl border border-dashed transition cursor-pointer ${
                  audioName ? "border-white/10" : "border-white/[0.08] hover:border-white/20"
                } ${generating ? "opacity-30 pointer-events-none" : ""}`}>
                  <span className="text-[12px] text-white/25">{audioName || "Upload MP3, WAV, or OGG"}</span>
                  <input ref={audioRef} type="file" accept="audio/mpeg,audio/wav,audio/ogg,audio/webm" className="hidden" disabled={generating}
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) setAudioName(f.name); }} />
                </label>
              </div>
            )}

            {/* ElevenLabs fields */}
            {mode === "elevenlabs" && (
              <>
                <div>
                  <label className="text-[12px] text-white/40 mb-2 block">ElevenLabs API key</label>
                  <input type="password" value={elKey} onChange={(e) => setElKey(e.target.value)}
                    placeholder="xi_..." disabled={generating} className={inputCls} />
                </div>
                <div>
                  <label className="text-[12px] text-white/40 mb-2 block">Voice ID <span className="text-white/15">(optional)</span></label>
                  <input value={elVoice} onChange={(e) => setElVoice(e.target.value)}
                    placeholder="JBFqnCBsd6RMkjVDRZzb" disabled={generating} className={inputCls} />
                </div>
              </>
            )}

            {/* Error */}
            {error && <div className="px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/15 text-red-400 text-[12px]">{error}</div>}
          </div>

          {/* Bottom — Generate button + code toggle */}
          <div className="p-6 pt-0 space-y-3">
            <button onClick={generate} disabled={!ready}
              className={`w-full py-3.5 rounded-xl text-[13px] font-semibold transition ${
                ready ? "bg-white text-black hover:bg-white/90" : "bg-white/[0.05] text-white/20 cursor-not-allowed"
              }`}>
              {generating ? `Generating… ${elapsed}s` : "Generate Video"}
            </button>
            <button onClick={() => setShowCode(!showCode)}
              className="w-full py-2 text-[11px] text-white/20 hover:text-white/40 transition">
              {showCode ? "Hide" : "View"} API code &darr;
            </button>
          </div>
        </div>

        {/* ---- Right ---- */}
        <div className="flex-1 flex flex-col min-h-0 bg-[#070707]">
          {showCode ? (
            /* Code panel */
            <div className="flex-1 overflow-y-auto p-6">
              <div className="flex items-center justify-between mb-4">
                <span className="text-[11px] text-white/25 font-mono">
                  {mode === "text" ? "/v1/tts/generate-video" : "/v1/generate"}
                </span>
                <span className="text-[10px] text-white/15 px-2 py-0.5 rounded bg-white/[0.04]">JavaScript</span>
              </div>
              <pre className="text-[12px] leading-[1.7] text-white/50 font-mono whitespace-pre-wrap">
                {CODE_SNIPPETS[mode]}
              </pre>
            </div>
          ) : (
            /* Video panel */
            <div className="flex-1 flex items-center justify-center p-8">
              {videoUrl ? (
                <div className="w-full max-w-2xl space-y-5">
                  <div className="rounded-2xl overflow-hidden border border-white/[0.04] bg-black shadow-2xl">
                    <video src={videoUrl} controls autoPlay className="w-full" />
                  </div>
                  <div className="flex gap-2">
                    <a href={videoUrl} download
                      className="flex-1 text-center py-3 rounded-xl bg-white text-black text-[12px] font-semibold hover:bg-white/90 transition">
                      Download MP4
                    </a>
                    <button onClick={reset}
                      className="flex-1 py-3 rounded-xl border border-white/[0.06] text-white/30 text-[12px] hover:bg-white/[0.04] transition">
                      Generate another
                    </button>
                  </div>
                  {elapsed > 0 && <p className="text-center text-[11px] text-white/15">Generated in {elapsed}s</p>}
                </div>
              ) : generating ? (
                <div className="text-center">
                  <div className="w-12 h-12 mx-auto mb-5 rounded-full border border-white/[0.08] border-t-white/40 animate-spin" />
                  <p className="text-[13px] text-white/25 mb-1">Processing on GPU…</p>
                  <p className="text-[12px] text-white/15 font-mono">{elapsed}s</p>
                </div>
              ) : (
                <div className="text-center">
                  <svg width="56" height="56" viewBox="0 0 24 24" fill="none" className="mx-auto mb-4 text-white/[0.04]">
                    <path d="M8 5.14v13.72a1 1 0 001.5.86l11-6.86a1 1 0 000-1.72l-11-6.86a1 1 0 00-1.5.86z" fill="currentColor" />
                  </svg>
                  <p className="text-[14px] text-white/20 mb-1">Video will appear here</p>
                  <p className="text-[12px] text-white/10">Upload a face, write a script, hit generate</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
