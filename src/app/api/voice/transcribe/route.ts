import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Voice transcription not configured" }, { status: 500 });
  }

  try {
    const formData = await request.formData();
    const audioFile = formData.get("audio") as File | null;

    if (!audioFile) {
      return NextResponse.json({ error: "No audio file provided" }, { status: 400 });
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
      return NextResponse.json({ error: "Transcription failed" }, { status: 502 });
    }

    const data = await res.json();
    return NextResponse.json({ text: data.text || "" });
  } catch (err) {
    console.error("Transcription error:", err);
    return NextResponse.json({ error: "Transcription failed" }, { status: 500 });
  }
}
