import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { rateLimit } from "@/lib/rate-limit";
import { userTranslator } from "@/lib/i18n-server";

// A dictated chat message is seconds to a couple of minutes of audio; 25MB is
// also Groq's own per-file limit. Anything bigger is not a voice note.
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const t = await userTranslator(session.userId);
  if (!rateLimit(`transcribe:${session.userId}`, 60, 60 * 60 * 1000)) {
    return NextResponse.json({ error: t("api.voice.tooMany") }, { status: 429 });
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: t("api.voice.notConfigured") }, { status: 500 });
  }

  try {
    const formData = await request.formData();
    const audioFile = formData.get("audio") as File | null;

    if (!audioFile) {
      return NextResponse.json({ error: t("api.voice.noAudio") }, { status: 400 });
    }
    if (audioFile.size > MAX_AUDIO_BYTES) {
      return NextResponse.json({ error: t("api.voice.tooLarge") }, { status: 413 });
    }

    // Forward to Groq Whisper API
    const groqForm = new FormData();
    groqForm.append("file", audioFile, audioFile.name || "recording.webm");
    groqForm.append("model", "whisper-large-v3-turbo");
    groqForm.append("response_format", "json");

    const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: groqForm,
    });

    if (!res.ok) {
      const errorText = await res.text();
      console.error("Groq Whisper error:", res.status, errorText);
      return NextResponse.json({ error: t("api.voice.failed") }, { status: 502 });
    }

    const data = await res.json();
    return NextResponse.json({ text: data.text || "" });
  } catch (err) {
    console.error("Transcription error:", err);
    return NextResponse.json({ error: t("api.voice.failed") }, { status: 500 });
  }
}
