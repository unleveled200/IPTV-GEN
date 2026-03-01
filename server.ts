import express from "express";
import { createServer as createViteServer } from "vite";
import cors from "cors";
import { GoogleGenAI } from "@google/genai";
import fetch from "node-fetch";

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// In-memory store for subtitle chunks
// streamId -> Array<{ startTime: number, endTime: number, text: string }>
const subtitleBuffer: Record<string, Array<{ startTime: number, endTime: number, text: string }>> = {};

// Gemini setup
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// API: Proxy M3U8
app.get("/api/proxy/playlist", async (req, res) => {
  const originalUrl = req.query.url as string;
  if (!originalUrl) return res.status(400).send("Missing url parameter");

  try {
    const response = await fetch(originalUrl);
    let content = await response.text();

    // Basic HLS modification to inject subtitle track
    // This is a simplified version. A real one would parse the M3U8 properly.
    const streamId = Buffer.from(originalUrl).toString('base64').slice(0, 10);
    const baseUrl = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
    const subtitleUrl = `${baseUrl}/api/subtitles/${streamId}.vtt`;

    // Inject subtitle tag if it's a master playlist or media playlist
    if (content.includes("#EXTM3U")) {
      const subtitleTag = `#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="AI Generated",DEFAULT=YES,AUTOSELECT=YES,FORCED=NO,LANGUAGE="en",URI="${subtitleUrl}"\n`;
      
      // For master playlists, we need to associate the subtitle group with stream tags
      if (content.includes("#EXT-X-STREAM-INF")) {
        content = content.replace(/(#EXT-X-STREAM-INF:.*)\n/g, `$1,SUBTITLES="subs"\n`);
        content = content.replace("#EXTM3U\n", `#EXTM3U\n${subtitleTag}`);
      } else {
        // For media playlists, we just add the subtitle tag at the top
        content = content.replace("#EXTM3U\n", `#EXTM3U\n${subtitleTag}`);
      }
    }

    res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
    res.send(content);
  } catch (error) {
    console.error("Proxy error:", error);
    res.status(500).send("Error fetching playlist");
  }
});

// API: Serve VTT Subtitles
app.get("/api/subtitles/:streamId.vtt", (req, res) => {
  const { streamId } = req.params;
  const chunks = subtitleBuffer[streamId] || [];

  let vtt = "WEBVTT\n\n";
  chunks.forEach((chunk, index) => {
    const start = formatVttTime(chunk.startTime);
    const end = formatVttTime(chunk.endTime);
    vtt += `${index + 1}\n${start} --> ${end}\n${chunk.text}\n\n`;
  });

  res.setHeader("Content-Type", "text/vtt");
  res.send(vtt);
});

// API: Transcribe Audio Chunk
app.post("/api/transcribe", async (req, res) => {
  const { streamId, audioData, startTime, endTime } = req.body;
  if (!audioData || !streamId) return res.status(400).send("Missing data");

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: [
        {
          inlineData: {
            mimeType: "audio/webm",
            data: audioData,
          },
        },
        { text: "Transcribe the audio exactly. If there is no speech, return an empty string. Only return the transcription." },
      ],
    });

    const text = response.text?.trim() || "";
    if (text) {
      if (!subtitleBuffer[streamId]) subtitleBuffer[streamId] = [];
      subtitleBuffer[streamId].push({ startTime, endTime, text });
      
      // Keep only last 50 chunks to prevent memory bloat
      if (subtitleBuffer[streamId].length > 50) {
        subtitleBuffer[streamId].shift();
      }
    }

    res.json({ success: true, text });
  } catch (error) {
    console.error("Transcription error:", error);
    res.status(500).json({ error: "Transcription failed" });
  }
});

function formatVttTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
}

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
