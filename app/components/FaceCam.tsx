"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import * as faceapi from "face-api.js";

// --- TYPES ---
type Status = "idle" | "scanning" | "success" | "error" | "processing" | "identity_confirmed" | "locked";
type SoundType = "hover" | "scan" | "success" | "error" | "boot";

// --- AUDIO SYNTHESIZER ---
const playSound = (type: SoundType) => {
  if (typeof window === "undefined") return;
  const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
  if (!AudioContext) return;
  
  const ctx = new AudioContext();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.connect(gain);
  gain.connect(ctx.destination);

  const now = ctx.currentTime;

  switch (type) {
    case "boot":
      osc.type = "sine";
      osc.frequency.setValueAtTime(150, now);
      osc.frequency.exponentialRampToValueAtTime(600, now + 0.5);
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.3, now + 0.1);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.5);
      osc.start(now);
      osc.stop(now + 0.5);
      break;
    case "hover":
      osc.type = "triangle";
      osc.frequency.setValueAtTime(800, now);
      gain.gain.setValueAtTime(0.02, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
      osc.start(now);
      osc.stop(now + 0.05);
      break;
    case "scan":
      osc.type = "square";
      osc.frequency.setValueAtTime(2000, now);
      osc.frequency.linearRampToValueAtTime(400, now + 0.1);
      gain.gain.setValueAtTime(0.05, now);
      gain.gain.linearRampToValueAtTime(0, now + 0.1);
      osc.start(now);
      osc.stop(now + 0.1);
      break;
    case "success":
      osc.type = "sine";
      osc.frequency.setValueAtTime(400, now);
      osc.frequency.setValueAtTime(800, now + 0.1);
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.2, now + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.4);
      osc.start(now);
      osc.stop(now + 0.4);
      break;
    case "error":
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(150, now);
      osc.frequency.linearRampToValueAtTime(100, now + 0.2);
      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
      osc.start(now);
      osc.stop(now + 0.3);
      break;
  }
};

// --- ICONS ---
const Icons = {
  Scan: () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" /></svg>,
  User: () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>,
  Lock: () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>,
  Refresh: () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>,
};

export default function FaceCam() {
  // --- REFS ---
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animationRef = useRef<number | null>(null);

  // --- STATE ---
  const [cameraReady, setCameraReady] = useState(false);
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [scanProgress, setScanProgress] = useState(0);
  const [isDetecting, setIsDetecting] = useState(false);
  const [faceDetected, setFaceDetected] = useState(false);
  const [registeredUser, setRegisteredUser] = useState<string | null>(null);
  const [showNameModal, setShowNameModal] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [loginData, setLoginData] = useState<any>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState<string>("00:00:00");
  const [bgOffset, setBgOffset] = useState({ x: 0, y: 0 });

  const THRESHOLD = 0.55;

  // --- EFFECTS ---

  // 1. Initial Load & Clock
  useEffect(() => {
    playSound("boot");
    loadModels();
    startCamera();
    
    // Check local storage
    const stored = localStorage.getItem("quantum_face_data");
    if (stored) {
      try {
        const data = JSON.parse(stored);
        setRegisteredUser(data.name);
      } catch (e) { console.error("Data corruption"); }
    }

    // Fix hydration error for clock
    const timer = setInterval(() => {
        setCurrentTime(new Date().toLocaleTimeString());
    }, 1000);
    setCurrentTime(new Date().toLocaleTimeString());

    return () => {
      if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      clearInterval(timer);
    };
  }, []);

  // 2. Load FaceAPI Models
  const loadModels = async () => {
    try {
      const MODEL_URL = "/models";
      await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
        faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
        faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
      ]);
      setModelsLoaded(true);
    } catch (e) {
      setErrorMsg("SYSTEM FAILURE: NEURAL MODELS NOT FOUND");
    }
  };

  // 3. Start Camera
  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.onloadedmetadata = () => {
          videoRef.current!.play();
          setCameraReady(true);
        };
      }
    } catch (e) {
      setErrorMsg("HARDWARE ERROR: OPTICAL SENSOR DISCONNECTED");
    }
  };

  // 4. Real-time Detection Loop
  const drawFaceMesh = useCallback(async () => {
    if (!videoRef.current || !canvasRef.current || !modelsLoaded || !isDetecting) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    if (canvas.width !== video.videoWidth) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
    }

    const detection = await faceapi
      .detectSingleFace(video, new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.5 }))
      .withFaceLandmarks();

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (detection) {
      if (!faceDetected) {
        setFaceDetected(true);
        playSound("hover");
      }
      
      const landmarks = detection.landmarks;
      const points = landmarks.positions;

      const drawPolyline = (pts: faceapi.Point[], close = false) => {
        if (pts.length === 0) return;
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        pts.slice(1).forEach(p => ctx.lineTo(p.x, p.y));
        if (close) ctx.closePath();
        ctx.stroke();
      };

      // Draw Connections (Jaw)
      ctx.strokeStyle = "#00ffff";
      ctx.fillStyle = "rgba(0, 255, 255, 0.2)";
      ctx.lineWidth = 1;
      
      ctx.beginPath();
      const jaw = landmarks.getJawOutline();
      ctx.moveTo(jaw[0].x, jaw[0].y);
      jaw.forEach(p => ctx.lineTo(p.x, p.y));
      ctx.stroke();

      // Mouth line
      ctx.strokeStyle = "rgba(0, 255, 255, 0.9)";
      ctx.lineWidth = 2;
      const mouth = landmarks.getMouth();
      if (mouth.length >= 7) {
        const left = mouth[0];
        const right = mouth[6];
        const midY = (left.y + right.y) / 2;
        ctx.beginPath();
        ctx.moveTo(left.x, midY);
        ctx.lineTo(right.x, midY);
        ctx.stroke();
      }

      // Eye contours
      ctx.strokeStyle = "rgba(0, 255, 255, 0.7)";
      ctx.lineWidth = 1.5;
      drawPolyline(landmarks.getLeftEye(), true);
      drawPolyline(landmarks.getRightEye(), true);

      // Extra mark (nose bridge + tip)
      const nose = landmarks.getNose();
      if (nose.length >= 7) {
        ctx.strokeStyle = "rgba(0, 255, 255, 0.8)";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(nose[0].x, nose[0].y);
        ctx.lineTo(nose[3].x, nose[3].y);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(nose[6].x, nose[6].y, 2, 0, 2 * Math.PI);
        ctx.fill();
      }

      // Draw Points with Glow
      ctx.shadowBlur = 10;
      ctx.shadowColor = "#00ffff";
      
      points.forEach((p, i) => {
        if (i % 2 === 0) {
          ctx.beginPath();
          ctx.arc(p.x, p.y, 1.5, 0, 2 * Math.PI);
          ctx.fill();
        }
      });
      ctx.shadowBlur = 0;
      
      // Draw Bounding Box HUD Style
      const box = detection.detection.box;
      const pad = 20;
      
      ctx.strokeStyle = "rgba(255, 255, 255, 0.8)";
      ctx.lineWidth = 2;
      
      ctx.beginPath();
      ctx.moveTo(box.x - pad, box.y - pad + 20);
      ctx.lineTo(box.x - pad, box.y - pad);
      ctx.lineTo(box.x - pad + 20, box.y - pad);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(box.right + pad, box.bottom + pad - 20);
      ctx.lineTo(box.right + pad, box.bottom + pad);
      ctx.lineTo(box.right + pad - 20, box.bottom + pad);
      ctx.stroke();

    } else {
      setFaceDetected(false);
    }

    if (isDetecting) animationRef.current = requestAnimationFrame(drawFaceMesh);
  }, [modelsLoaded, isDetecting, faceDetected]);

  useEffect(() => {
    if (isDetecting) {
      drawFaceMesh();
    } else {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      const ctx = canvasRef.current?.getContext("2d");
      ctx?.clearRect(0, 0, 10000, 10000);
    }
  }, [isDetecting, drawFaceMesh]);

  const handleCapture = async (mode: "register" | "login") => {
    playSound("scan");
    setIsDetecting(false);
    setStatus("scanning");
    setScanProgress(0);

    const interval = setInterval(() => {
      setScanProgress(p => (p < 90 ? p + 5 : p));
    }, 50);

    if (!videoRef.current) return;
    
    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = videoRef.current.videoWidth;
    tempCanvas.height = videoRef.current.videoHeight;
    const ctx = tempCanvas.getContext("2d");
    ctx?.drawImage(videoRef.current, 0, 0);

    const fullDetection = await faceapi
      .detectSingleFace(tempCanvas, new faceapi.TinyFaceDetectorOptions())
      .withFaceLandmarks()
      .withFaceDescriptor();

    clearInterval(interval);
    setScanProgress(100);

    if (!fullDetection) {
      playSound("error");
      setStatus("error");
      setErrorMsg("NO SUBJECT IDENTIFIED");
      setTimeout(() => setStatus("idle"), 2000);
      return;
    }

    if (mode === "register") {
      setStatus("processing");
      (window as any).tempDescriptor = fullDetection.descriptor;
      setShowNameModal(true);
    } else {
      const stored = localStorage.getItem("quantum_face_data");
      if (!stored) {
        playSound("error");
        setErrorMsg("DATABASE EMPTY");
        setStatus("error");
        setTimeout(() => setStatus("idle"), 2000);
        return;
      }

      const dbData = JSON.parse(stored);
      const distance = faceapi.euclideanDistance(fullDetection.descriptor, Object.values(dbData.descriptor) as any);
      
      if (distance < THRESHOLD) {
        playSound("success");
        setStatus("success");
        setLoginData({
          name: dbData.name,
          confidence: ((1 - distance) * 100).toFixed(1),
          id: Math.random().toString(36).substr(2, 9).toUpperCase()
        });
        setTimeout(() => setStatus("identity_confirmed"), 1500);
      } else {
        playSound("error");
        setStatus("error");
        setErrorMsg("IDENTITY MISMATCH // ACCESS DENIED");
        setTimeout(() => setStatus("idle"), 2500);
      }
    }
  };

  const confirmRegistration = () => {
    if (!nameInput) return;
    const descriptor = (window as any).tempDescriptor;
    localStorage.setItem("quantum_face_data", JSON.stringify({
      name: nameInput,
      descriptor: descriptor,
      date: new Date().toISOString()
    }));
    setRegisteredUser(nameInput);
    setShowNameModal(false);
    setNameInput("");
    playSound("success");
    setStatus("success");
    setTimeout(() => setStatus("idle"), 2000);
  };

  const resetSystem = () => {
    playSound("error");
    localStorage.removeItem("quantum_face_data");
    setRegisteredUser(null);
    setStatus("idle");
    setLoginData(null);
  };
  
  return (
    <div
      className="min-h-screen bg-black text-white font-sans overflow-hidden selection:bg-cyan-500 selection:text-black relative"
      onMouseMove={(e) => {
        const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
        const x = (e.clientX - rect.left) / rect.width - 0.5;
        const y = (e.clientY - rect.top) / rect.height - 0.5;
        setBgOffset({ x, y });
      }}
      style={
        {
          ["--bg-x" as any]: `${bgOffset.x * 20}px`,
          ["--bg-y" as any]: `${bgOffset.y * 20}px`,
        } as any
      }
    >
      {/* --- BACKGROUND EFFECTS (Hacker Triangles) --- */}
      <div className="fixed inset-0 z-0 overflow-hidden pointer-events-none">
        {/* 1. Base Oscura */}
        <div className="absolute inset-0 bg-black" />

        {/* 2. Triangulos verdes (capa lejana) */}
        <div
          className="absolute inset-0 opacity-60"
          style={{
            backgroundImage:
              "url(\"data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180' viewBox='0 0 180 180'%3E%3Cpolygon points='90,20 160,150 20,150' fill='none' stroke='rgba(0,255,100,0.7)' stroke-width='1.2'/%3E%3Cpolygon points='40,30 70,90 10,90' fill='none' stroke='rgba(0,255,100,0.45)' stroke-width='1'/%3E%3Cpolygon points='140,40 170,100 110,100' fill='none' stroke='rgba(0,255,100,0.45)' stroke-width='1'/%3E%3C/svg%3E\")",
            backgroundSize: "180px 180px",
            animation: "triScroll 12s linear infinite",
            filter: "drop-shadow(0 0 6px rgba(0,255,120,0.6))",
          }}
        />

        {/* 3. Triangulos verdes (capa cercana) */}
        <div
          className="absolute inset-0 opacity-75"
          style={{
            backgroundImage:
              "url(\"data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120' viewBox='0 0 120 120'%3E%3Cpolygon points='60,10 110,100 10,100' fill='none' stroke='rgba(0,255,100,0.85)' stroke-width='1.2'/%3E%3Cpolygon points='90,20 115,70 65,70' fill='none' stroke='rgba(0,255,100,0.55)' stroke-width='1'/%3E%3C/svg%3E\")",
            backgroundSize: "120px 120px",
            animation: "triScroll 8s linear infinite reverse",
            filter: "drop-shadow(0 0 8px rgba(0,255,120,0.7))",
          }}
        />

        {/* 4. Scanlines sutiles */}
        <div
          className="absolute inset-0 opacity-15"
          style={{
            backgroundImage:
              "url(\"data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='4' height='8' viewBox='0 0 4 8'%3E%3Cpath d='M0 1 H4' stroke='rgba(0,255,140,0.25)' stroke-width='1'/%3E%3C/svg%3E\")",
            backgroundSize: "4px 8px",
          }}
        />

        {/* 5. Textura */}
        <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-12 brightness-100 contrast-150 mix-blend-overlay"></div>
      </div>

      <main className="relative z-10 flex flex-col items-center justify-center min-h-screen p-4">
        
        <header className="mb-8 text-center space-y-2">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-900/20 border border-cyan-500/30 text-cyan-400 text-xs tracking-widest font-mono mb-4 animate-pulse">
            <div className="w-2 h-2 bg-cyan-400 rounded-full"></div>
            SYSTEM SECURE // TIER 1
          </div>
          <h1 className="text-5xl md:text-7xl font-bold tracking-tighter bg-clip-text text-transparent bg-gradient-to-r from-white via-cyan-100 to-gray-500" style={{ textShadow: "0 0 40px rgba(0,255,255,0.3)" }}>
            MIKI<span className="text-cyan-500">.</span>FACEAPI
          </h1>
          <p className="text-gray-500 font-mono text-sm tracking-widest">BIOMETRIC NEURAL INTERFACE v4.0</p>
        </header>

        <div className="relative group">
          <div className={`absolute -inset-1 bg-gradient-to-r from-green-400 via-white to-green-400 rounded-2xl opacity-90 blur-md transition duration-1000 group-hover:duration-200 ${status === 'scanning' ? 'animate-spin-slow opacity-100' : 'opacity-50'}`}></div>
          
          <div className="relative w-full max-w-2xl aspect-video bg-black rounded-xl overflow-hidden border border-white/10 shadow-2xl">
            
            <video 
              ref={videoRef} 
              autoPlay 
              playsInline 
              muted 
              className={`w-full h-full object-cover transform scale-x-[-1] transition-opacity duration-500 ${status === 'success' || status === 'identity_confirmed' ? 'opacity-20 blur-sm' : 'opacity-100'}`} 
            />
            
            <canvas 
              ref={canvasRef} 
              className="absolute inset-0 w-full h-full transform scale-x-[-1]" 
            />

            {status === 'idle' && (
              <div className="absolute inset-0 pointer-events-none p-6 flex flex-col justify-between">
                <div className="flex justify-between items-start opacity-70">
                  <span className="font-mono text-xs text-cyan-500">REC ● [ {currentTime} ]</span>
                  <div className="flex gap-1">
                    {[1,2,3].map(i => <div key={i} className="w-1 h-4 bg-cyan-500/50"></div>)}
                  </div>
                </div>
                
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 border border-white/10 rounded-full flex items-center justify-center">
                  <div className={`w-60 h-60 border border-cyan-500/30 rounded-full transition-all duration-300 ${faceDetected ? 'scale-100 opacity-100 border-cyan-400' : 'scale-90 opacity-50'}`}></div>
                  <div className={`absolute w-full h-[1px] bg-gradient-to-r from-transparent via-cyan-500 to-transparent transition-all duration-1000 ${isDetecting ? 'top-1/2 animate-scan' : 'top-0 opacity-0'}`}></div>
                </div>

                <div className="flex justify-between items-end opacity-70">
                  <div className="font-mono text-xs text-gray-400">
                    LAT: 40.7128° N<br/>LNG: 74.0060° W
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-cyan-500 font-bold mb-1">{modelsLoaded ? "NEURAL ENGINE: ONLINE" : "INITIALIZING..."}</div>
                    <div className="h-1 w-24 bg-gray-800 rounded-full overflow-hidden">
                      <div className="h-full bg-cyan-500 w-[98%]"></div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {status === "scanning" && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 backdrop-blur-sm z-20">
                <div className="w-64 h-64 relative">
                  <svg className="w-full h-full animate-spin-slow text-cyan-900" viewBox="0 0 100 100">
                    <circle cx="50" cy="50" r="45" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="10 5" />
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center font-mono text-4xl font-bold text-cyan-400">
                    {scanProgress}%
                  </div>
                </div>
                <p className="mt-4 text-cyan-200 font-mono text-sm tracking-widest animate-pulse">ANALYZING BIOMETRIC DATA...</p>
              </div>
            )}

            {status === "error" && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-red-900/80 backdrop-blur-md z-30 animate-shake">
                <div className="p-4 rounded-full border-4 border-red-500 mb-4">
                  <Icons.Lock />
                </div>
                <h2 className="text-3xl font-bold text-white mb-2 tracking-widest">ACCESS DENIED</h2>
                <p className="font-mono text-red-200">{errorMsg}</p>
              </div>
            )}

            {status === "identity_confirmed" && loginData && (
              <div className="absolute inset-0 bg-black/90 backdrop-blur-xl z-40 p-8 flex flex-col items-center justify-center text-center">
                <div className="w-24 h-24 bg-gradient-to-tr from-cyan-400 to-blue-600 rounded-full p-[2px] mb-6 shadow-[0_0_50px_rgba(0,255,255,0.5)] animate-scale-in">
                  <div className="w-full h-full bg-black rounded-full flex items-center justify-center">
                    <Icons.User />
                  </div>
                </div>
                
                <h2 className="text-4xl font-bold text-white mb-1">WELCOME BACK, <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-purple-400">{loginData.name}</span></h2>
                <div className="flex gap-4 mt-6 text-sm font-mono text-gray-400 bg-gray-900/50 p-4 rounded-lg border border-white/5">
                  <div className="flex flex-col">
                    <span className="text-xs uppercase text-gray-600">Confidence</span>
                    <span className="text-green-400">{loginData.confidence}%</span>
                  </div>
                  <div className="w-[1px] bg-gray-700"></div>
                  <div className="flex flex-col">
                    <span className="text-xs uppercase text-gray-600">Session ID</span>
                    <span className="text-cyan-400">{loginData.id}</span>
                  </div>
                  <div className="w-[1px] bg-gray-700"></div>
                  <div className="flex flex-col">
                    <span className="text-xs uppercase text-gray-600">Security</span>
                    <span className="text-purple-400">MAXIMUM</span>
                  </div>
                </div>

                <button 
                  onClick={() => { setStatus("idle"); setIsDetecting(true); playSound("hover"); }}
                  className="mt-8 px-8 py-3 bg-white text-black font-bold rounded-full hover:bg-cyan-400 transition-all duration-300 hover:scale-105 hover:shadow-[0_0_30px_rgba(0,255,255,0.5)]"
                >
                  ENTER DASHBOARD
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-4 w-full max-w-2xl">
          
          <button
            onMouseEnter={() => playSound("hover")}
            onClick={() => setIsDetecting(!isDetecting)}
            disabled={!cameraReady || status !== 'idle'}
            className={`group relative overflow-hidden px-6 py-4 rounded-xl border border-white/10 transition-all duration-300 ${isDetecting ? 'bg-cyan-900/20 border-cyan-500/50' : 'bg-black hover:bg-gray-900'}`}
          >
            <div className="flex items-center justify-center gap-3">
              <div className={`w-2 h-2 rounded-full ${isDetecting ? 'bg-cyan-400 animate-ping' : 'bg-gray-600'}`}></div>
              <span className={`font-mono text-sm tracking-widest ${isDetecting ? 'text-cyan-400' : 'text-gray-400'}`}>
                {isDetecting ? "AR_MESH: ON" : "AR_MESH: OFF"}
              </span>
            </div>
          </button>

          <button
            onMouseEnter={() => playSound("hover")}
            onClick={() => handleCapture("register")}
            disabled={!cameraReady || status !== 'idle'}
            className="group relative px-6 py-4 bg-black border border-white/10 rounded-xl hover:border-cyan-500/50 transition-all duration-300 overflow-hidden"
          >
            <div className="absolute inset-0 bg-gradient-to-r from-cyan-900/0 via-cyan-900/20 to-cyan-900/0 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-700"></div>
            <div className="flex items-center justify-center gap-2 text-white group-hover:text-cyan-400">
              <Icons.Scan />
              <span className="font-bold tracking-wider">ENROLL FACE</span>
            </div>
          </button>

          <button
            onMouseEnter={() => playSound("hover")}
            onClick={() => handleCapture("login")}
            disabled={!cameraReady || status !== 'idle' || !registeredUser}
            className={`group relative px-6 py-4 rounded-xl font-bold tracking-wider transition-all duration-300 ${registeredUser ? 'bg-white text-black hover:shadow-[0_0_40px_rgba(255,255,255,0.4)]' : 'bg-gray-900 text-gray-600 cursor-not-allowed'}`}
          >
             <div className="flex items-center justify-center gap-2">
              <Icons.User />
              <span>AUTHENTICATE</span>
            </div>
          </button>
        </div>

        <div className="mt-8 flex items-center gap-6 text-gray-600 font-mono text-xs">
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${registeredUser ? 'bg-green-500' : 'bg-red-500'}`}></span>
            DATABASE: {registeredUser ? "1 RECORD" : "EMPTY"}
          </div>
          <button onClick={resetSystem} className="hover:text-red-500 transition-colors flex items-center gap-1">
            <Icons.Refresh /> RESET
          </button>
        </div>

      </main>

      {showNameModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm animate-fade-in">
          <div className="w-full max-w-md bg-gray-900/90 border border-white/10 p-8 rounded-2xl shadow-2xl transform transition-all scale-100 ring-1 ring-cyan-500/50">
            <h3 className="text-2xl font-bold text-white mb-2">NEW IDENTITY</h3>
            <p className="text-gray-400 text-sm mb-6">Biometric signature captured. Assign an alias to this neural pattern.</p>
            
            <input
              autoFocus
              type="text"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              placeholder="Enter Codename..."
              className="w-full bg-black/50 border border-gray-700 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 transition-all font-mono text-lg mb-6"
              onKeyDown={(e) => e.key === 'Enter' && confirmRegistration()}
            />
            
            <div className="flex gap-3">
              <button 
                onClick={() => { setShowNameModal(false); setStatus("idle"); playSound("error"); }}
                className="flex-1 py-3 rounded-lg border border-gray-700 text-gray-400 hover:bg-gray-800 transition-colors font-bold"
              >
                CANCEL
              </button>
              <button 
                onClick={confirmRegistration}
                disabled={!nameInput}
                className="flex-1 py-3 rounded-lg bg-cyan-600 text-white font-bold hover:bg-cyan-500 transition-colors shadow-lg shadow-cyan-900/50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                CONFIRM
              </button>
            </div>
          </div>
        </div>
      )}

      <style jsx global>{`
        @keyframes scan {
          0% { top: 0%; opacity: 0; }
          50% { opacity: 1; }
          100% { top: 100%; opacity: 0; }
        }
        .animate-scan { animation: scan 2s cubic-bezier(0.4, 0, 0.2, 1) infinite; }
        .animate-spin-slow { animation: spin 3s linear infinite; }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .animate-fade-in { animation: fadeIn 0.3s ease-out forwards; }
        @keyframes fadeIn { from { opacity: 0; transform: scale(0.95); } to { opacity: 1; transform: scale(1); } }
        .animate-shake { animation: shake 0.5s cubic-bezier(.36,.07,.19,.97) both; }
        @keyframes shake { 10%, 90% { transform: translate3d(-1px, 0, 0); } 20%, 80% { transform: translate3d(2px, 0, 0); } 30%, 50%, 70% { transform: translate3d(-4px, 0, 0); } 40%, 60% { transform: translate3d(4px, 0, 0); } }
        .animate-scale-in { animation: scaleIn 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards; }
        @keyframes scaleIn { from { transform: scale(0); opacity: 0; } to { transform: scale(1); opacity: 1; } }

        /* Aurora Animations */
        @keyframes aurora-move-1 {
          0%, 100% { transform: translate(0, 0) scale(1); }
          50% { transform: translate(10%, 20%) scale(1.1); }
        }
        @keyframes aurora-move-2 {
          0%, 100% { transform: translate(0, 0) scale(1); }
          50% { transform: translate(-15%, -10%) scale(1.2); }
        }
        .animate-aurora-1 { animation: aurora-move-1 20s ease-in-out infinite alternate; }
        .animate-aurora-2 { animation: aurora-move-2 25s ease-in-out infinite alternate-reverse; }
        
        .animate-pulse-slow { animation: pulse 8s cubic-bezier(0.4, 0, 0.6, 1) infinite; }
        .animate-pulse-fast { animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite; }
        
        .speed-up { animation-duration: 5s !important; }

        /* Futuristic background pulse */
        @keyframes bgPulse {
          0%, 100% { opacity: 0.2; }
          50% { opacity: 0.35; }
        }
        .bg-pulse { animation: bgPulse 2s ease-in-out infinite; }

        /* Hacker triangles movement */
        @keyframes triScroll {
          0% { transform: translate3d(0, 0, 0); }
          100% { transform: translate3d(-180px, 180px, 0); }
        }
      `}</style>
    </div>
  );
}
