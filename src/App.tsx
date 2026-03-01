import React, { useState, useRef, useEffect } from 'react';
import { Play, StopCircle, Copy, Check, Info, Settings, Radio } from 'lucide-react';
import Hls from 'hls.js';
import { motion, AnimatePresence } from 'motion/react';

export default function App() {
  const [url, setUrl] = useState('');
  const [isRestreaming, setIsRestreaming] = useState(false);
  const [proxyUrl, setProxyUrl] = useState('');
  const [copied, setCopied] = useState(false);
  const [transcriptions, setTranscriptions] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const hlsRef = useRef<Hls | null>(null);
  const startTimeRef = useRef<number>(0);

  const startRestreaming = async () => {
    if (!url) return;
    setIsRestreaming(true);
    setError(null);
    setTranscriptions([]);

    const streamId = btoa(url).slice(0, 10);
    const generatedProxyUrl = `${window.location.origin}/api/proxy/playlist?url=${encodeURIComponent(url)}`;
    setProxyUrl(generatedProxyUrl);

    if (Hls.isSupported() && videoRef.current) {
      const hls = new Hls();
      hlsRef.current = hls;
      hls.loadSource(url);
      hls.attachMedia(videoRef.current);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        videoRef.current?.play().catch(e => console.error("Play error:", e));
        setupAudioCapture();
      });
    } else if (videoRef.current?.canPlayType('application/vnd.apple.mpegurl')) {
      videoRef.current.src = url;
      videoRef.current.addEventListener('loadedmetadata', () => {
        videoRef.current?.play().catch(e => console.error("Play error:", e));
        setupAudioCapture();
      });
    }
  };

  const stopRestreaming = () => {
    setIsRestreaming(false);
    mediaRecorderRef.current?.stop();
    hlsRef.current?.destroy();
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.src = '';
    }
  };

  const setupAudioCapture = () => {
    if (!videoRef.current) return;

    try {
      // @ts-ignore - captureStream is not in all types
      const stream = videoRef.current.captureStream?.() || videoRef.current.mozCaptureStream?.();
      if (!stream) {
        setError("Browser doesn't support stream capture. Try Chrome or Firefox.");
        return;
      }

      const audioTrack = stream.getAudioTracks()[0];
      if (!audioTrack) {
        setError("No audio track found in stream.");
        return;
      }

      const audioStream = new MediaStream([audioTrack]);
      const mediaRecorder = new MediaRecorder(audioStream, { mimeType: 'audio/webm' });
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        audioChunksRef.current = [];
        
        const reader = new FileReader();
        reader.readAsDataURL(audioBlob);
        reader.onloadend = async () => {
          const base64Data = (reader.result as string).split(',')[1];
          const endTime = videoRef.current?.currentTime || 0;
          const streamId = btoa(url).slice(0, 10);

          try {
            const response = await fetch('/api/transcribe', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                streamId,
                audioData: base64Data,
                startTime: startTimeRef.current,
                endTime: endTime
              }),
            });
            const data = await response.json();
            if (data.text) {
              setTranscriptions(prev => [data.text, ...prev].slice(0, 10));
            }
          } catch (e) {
            console.error("Transcription error:", e);
          }

          if (isRestreaming) {
            startTimeRef.current = endTime;
            mediaRecorder.start();
            setTimeout(() => mediaRecorder.stop(), 5000); // Record in 5s chunks
          }
        };
      };

      startTimeRef.current = videoRef.current.currentTime;
      mediaRecorder.start();
      setTimeout(() => mediaRecorder.stop(), 5000); // Initial chunk
    } catch (e) {
      console.error("Capture setup error:", e);
      setError("Failed to setup audio capture.");
    }
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(proxyUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white font-sans selection:bg-emerald-500/30">
      {/* Header */}
      <header className="border-b border-white/5 bg-black/20 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-emerald-500 rounded-lg flex items-center justify-center">
              <Radio className="w-5 h-5 text-black" />
            </div>
            <h1 className="text-lg font-semibold tracking-tight">IPTV Subtitle Gen</h1>
          </div>
          <div className="flex items-center gap-4 text-sm text-white/40">
            <span className="flex items-center gap-1.5">
              <div className={`w-2 h-2 rounded-full ${isRestreaming ? 'bg-emerald-500 animate-pulse' : 'bg-white/20'}`} />
              {isRestreaming ? 'Live Restreaming' : 'Idle'}
            </span>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-12">
        <div className="grid lg:grid-template-columns-[1fr_380px] gap-12">
          {/* Left Column: Controls & Preview */}
          <div className="space-y-8">
            <section className="space-y-4">
              <h2 className="text-3xl font-bold tracking-tight">Generate AI Subtitles for any IPTV Stream</h2>
              <p className="text-white/60 max-w-2xl text-lg leading-relaxed">
                Paste your HLS (.m3u8) URL below. We'll generate a new stream link with real-time AI-powered subtitles that you can use in any IPTV player.
              </p>
            </section>

            <div className="bg-white/5 border border-white/10 rounded-2xl p-6 space-y-6">
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-wider text-white/40">Source HLS URL</label>
                <div className="flex gap-3">
                  <input
                    type="text"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="https://example.com/stream.m3u8"
                    className="flex-1 bg-black/40 border border-white/10 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all placeholder:text-white/20"
                  />
                  {!isRestreaming ? (
                    <button
                      onClick={startRestreaming}
                      disabled={!url}
                      className="bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 disabled:cursor-not-allowed text-black font-semibold px-6 py-3 rounded-xl transition-all flex items-center gap-2"
                    >
                      <Play className="w-4 h-4 fill-current" />
                      Start
                    </button>
                  ) : (
                    <button
                      onClick={stopRestreaming}
                      className="bg-red-500 hover:bg-red-400 text-white font-semibold px-6 py-3 rounded-xl transition-all flex items-center gap-2"
                    >
                      <StopCircle className="w-4 h-4" />
                      Stop
                    </button>
                  )}
                </div>
              </div>

              {error && (
                <div className="bg-red-500/10 border border-red-500/20 text-red-400 px-4 py-3 rounded-xl text-sm">
                  {error}
                </div>
              )}

              <AnimatePresence>
                {proxyUrl && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="space-y-2 pt-4 border-t border-white/5"
                  >
                    <label className="text-xs font-semibold uppercase tracking-wider text-white/40">Restreamed URL (with Subtitles)</label>
                    <div className="flex gap-2">
                      <div className="flex-1 bg-emerald-500/5 border border-emerald-500/20 rounded-xl px-4 py-3 font-mono text-sm text-emerald-400 truncate">
                        {proxyUrl}
                      </div>
                      <button
                        onClick={copyToClipboard}
                        className="bg-white/5 hover:bg-white/10 border border-white/10 p-3 rounded-xl transition-all relative"
                      >
                        {copied ? <Check className="w-5 h-5 text-emerald-500" /> : <Copy className="w-5 h-5" />}
                      </button>
                    </div>
                    <p className="text-xs text-white/40 flex items-center gap-1.5 mt-2">
                      <Info className="w-3 h-3" />
                      Keep this tab open for subtitles to continue generating.
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Hidden Video for Capture */}
            <div className={`rounded-2xl overflow-hidden border border-white/10 bg-black aspect-video relative group ${!isRestreaming ? 'opacity-20 grayscale' : ''}`}>
              <video
                ref={videoRef}
                muted
                className="w-full h-full object-cover"
                playsInline
              />
              {!isRestreaming && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="text-center space-y-2">
                    <Play className="w-12 h-12 text-white/20 mx-auto" />
                    <p className="text-white/20 font-medium">Preview will appear here</p>
                  </div>
                </div>
              )}
              {isRestreaming && (
                <div className="absolute top-4 left-4 bg-black/60 backdrop-blur-md px-3 py-1.5 rounded-lg border border-white/10 flex items-center gap-2">
                  <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                  <span className="text-xs font-bold uppercase tracking-widest">Monitoring</span>
                </div>
              )}
            </div>
          </div>

          {/* Right Column: Live Transcription Feed */}
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-white/40">Live Feed</h3>
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full" />
                <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-500">Real-time</span>
              </div>
            </div>

            <div className="bg-white/5 border border-white/10 rounded-2xl p-4 h-[600px] flex flex-col">
              <div className="flex-1 overflow-y-auto space-y-4 pr-2 custom-scrollbar">
                {transcriptions.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-center p-8">
                    <p className="text-white/20 text-sm italic">
                      {isRestreaming ? 'Waiting for speech...' : 'Start restreaming to see live transcriptions'}
                    </p>
                  </div>
                ) : (
                  transcriptions.map((text, i) => (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, x: 10 }}
                      animate={{ opacity: 1, x: 0 }}
                      className="bg-white/5 border border-white/10 p-4 rounded-xl"
                    >
                      <p className="text-sm leading-relaxed text-white/80">{text}</p>
                    </motion.div>
                  ))
                )}
              </div>
            </div>

            <div className="bg-emerald-500/5 border border-emerald-500/10 rounded-2xl p-6 space-y-4">
              <h4 className="text-sm font-semibold text-emerald-400">How it works</h4>
              <ul className="space-y-3 text-xs text-white/60 leading-relaxed">
                <li className="flex gap-2">
                  <span className="text-emerald-500 font-bold">01</span>
                  <span>We proxy the HLS stream and inject a custom subtitle track.</span>
                </li>
                <li className="flex gap-2">
                  <span className="text-emerald-500 font-bold">02</span>
                  <span>This browser tab captures audio chunks and sends them to Gemini AI.</span>
                </li>
                <li className="flex gap-2">
                  <span className="text-emerald-500 font-bold">03</span>
                  <span>Transcriptions are stored and served as a standard VTT file.</span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </main>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.1);
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(255, 255, 255, 0.2);
        }
      `}</style>
    </div>
  );
}
