/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useRef, useMemo } from "react";
import { PoseLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";
import { LandmarkWithName, MoCapFrame, MoCapSession, TrackerConfig, LANDMARK_NAMES } from "./types";
import { OneEuroFilter } from "./utils/filter";
import { generateBlenderImportScript, generateBlenderRobloxR15Script, generateBlenderRobloxR6Script, generateCSVExport } from "./utils/blenderScriptGenerator";
import { generateRobloxStudioLuaScript } from "./utils/robloxScriptGenerator";
import SkeletonPreview3D from "./components/SkeletonPreview3D";
import {
  Camera,
  CameraOff,
  Play,
  Pause,
  Square,
  Download,
  Copy,
  RefreshCw,
  Settings,
  Layers,
  Video,
  VideoOff,
  RotateCw,
  Monitor,
  HelpCircle,
  FileText,
  Trash2,
  Check,
  Clock,
  Sparkles,
  Zap,
  Info,
  Calendar,
  Layers2,
  Workflow
} from "lucide-react";

export default function App() {
  // Config state
  const [config, setConfig] = useState<TrackerConfig>({
    modelType: "lite", // default: Lite (highly recommended for i3 processor)
    minPoseDetectionConfidence: 0.5,
    minPoseTrackingConfidence: 0.5,
    mirrorMode: true,
    targetFps: 30, // cap at 30 fps to save CPU
    resolution: "vga", // VGA (640x480) standard
  });

  // MediaPipe landmarker loading states
  const [landmarker, setLandmarker] = useState<PoseLandmarker | null>(null);
  const [isModelLoading, setIsModelLoading] = useState<boolean>(true);
  const [loadingStep, setLoadingStep] = useState<string>("Uygulama yükleniyor...");
  const [loadingError, setLoadingError] = useState<string | null>(null);

  // Streaming & tracking states
  const [isTrackingActive, setIsTrackingActive] = useState<boolean>(false);
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [showWebcamVideo, setShowWebcamVideo] = useState<boolean>(true);
  const [activeTrackingFps, setActiveTrackingFps] = useState<number>(0);

  // Live coordinate streams
  const [liveLandmarks, setLiveLandmarks] = useState<LandmarkWithName[]>([]); // 3D world space
  const [live2DLandmarks, setLive2DLandmarks] = useState<LandmarkWithName[]>([]); // 2D camera space

  // Recording variables (kept in refs to avoid React re-render lag on every frame)
  const recordedFramesRef = useRef<MoCapFrame[]>([]);
  const recordingFramesCountRef = useRef<number>(0);
  const recordingStartTimeRef = useRef<number>(0);
  const lastFrameTimeRef = useRef<number>(0);
  const [uiRecordCount, setUiRecordCount] = useState<number>(0);

  // OneEuro Filter maps to keep track of filters per joint coordinate
  const filters2DRef = useRef<Map<string, OneEuroFilter>>(new Map());
  const filtersWorldRef = useRef<Map<string, OneEuroFilter>>(new Map());

  // Saved recordings in active local session
  const [savedClips, setSavedClips] = useState<MoCapSession[]>([]);
  const [selectedClip, setSelectedClip] = useState<MoCapSession | null>(null);

  // Playback engine states
  const [isPlayingback, setIsPlayingback] = useState<boolean>(false);
  const [playbackFrameIndex, setPlaybackFrameIndex] = useState<number>(0);
  const playbackTimerRef = useRef<number | null>(null);

  // DOM Elements refs
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const requestRef = useRef<number | null>(null);

  // Maintain active configuration ref for access inside the fast frame-loop
  const configRef = useRef<TrackerConfig>(config);
  const isRecordingRef = useRef<boolean>(isRecording);
  const isTrackingActiveRef = useRef<boolean>(isTrackingActive);
  const landmarkerRef = useRef<PoseLandmarker | null>(null);

  // Copy success animation state
  const [scriptCopied, setScriptCopied] = useState<boolean>(false);
  const [csvCopied, setCsvCopied] = useState<boolean>(false);

  // Roblox and preview rig states
  const [exportTab, setExportTab] = useState<"blender" | "blender_r15" | "blender_r6" | "roblox_r15" | "roblox_r6">("blender");
  const [rigType, setRigType] = useState<"standard" | "R15" | "R6">("standard");

  // Sync rigType with exportTab
  useEffect(() => {
    if (exportTab === "blender") {
      setRigType("standard");
    } else if (exportTab === "blender_r15" || exportTab === "roblox_r15") {
      setRigType("R15");
    } else if (exportTab === "blender_r6" || exportTab === "roblox_r6") {
      setRigType("R6");
    }
  }, [exportTab]);

  // FPS tracking
  const fpsIntervalRef = useRef<number>(0);
  const fpsFrameCountRef = useRef<number>(0);

  // Update refs on change
  useEffect(() => {
    configRef.current = config;
  }, [config]);

  useEffect(() => {
    isRecordingRef.current = isRecording;
    if (isRecording) {
      recordedFramesRef.current = [];
      recordingFramesCountRef.current = 0;
      recordingStartTimeRef.current = performance.now();
      setUiRecordCount(0);
      filters2DRef.current.clear();
      filtersWorldRef.current.clear();
    }
  }, [isRecording]);

  useEffect(() => {
    isTrackingActiveRef.current = isTrackingActive;
    if (!isTrackingActive) {
      filters2DRef.current.clear();
      filtersWorldRef.current.clear();
    }
  }, [isTrackingActive]);

  useEffect(() => {
    landmarkerRef.current = landmarker;
  }, [landmarker]);

  // Loading the MediaPipe pose landmarker (re-fetches when modelType changes)
  useEffect(() => {
    let active = true;
    
    async function initMediaPipe() {
      setIsModelLoading(true);
      setLoadingError(null);
      
      try {
        setLoadingStep("1/3 MediaPipe WebAssembly motoru indiriliyor...");
        // Load target CDN webvision task resolver
        const vision = await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.15/wasm"
        );
        
        if (!active) return;
        
        setLoadingStep(`2/3 AI İskelet modeli yükleniyor (Seçilen: ${config.modelType.toUpperCase()})...`);
        
        let path = "";
        if (config.modelType === "lite") {
          path = "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";
        } else if (config.modelType === "heavy") {
          path = "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/1/pose_landmarker_heavy.task";
        } else {
          path = "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task";
        }

        const poseLandmarkerInstance = await PoseLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: path,
            delegate: "GPU",
          },
          runningMode: "VIDEO",
          numPoses: 1,
          minPoseDetectionConfidence: config.minPoseDetectionConfidence,
          minPoseTrackingConfidence: config.minPoseTrackingConfidence,
        } as any);

        if (!active) return;

        setLandmarker(poseLandmarkerInstance);
        setIsModelLoading(false);
        setLoadingStep("Hazır");
      } catch (err: any) {
        console.error("MediaPipe Init Error:", err);
        if (active) {
          setLoadingError(`Model yüklenemedi: ${err?.message || "Bağlantı hatası"}. Lütfen sayfayı yenileyip tekrar deneyin.`);
          setIsModelLoading(false);
        }
      }
    }

    // Stop current tracker first if active
    if (isTrackingActive) {
      stopTracking();
    }
    
    initMediaPipe();

    // Cleanup
    return () => {
      active = false;
    };
  }, [config.modelType]);

  // Handle live tracking frame loop
  const predictWebcamLoop = async () => {
    const video = videoRef.current;
    const activeLandmarker = landmarkerRef.current;
    
    if (!video || !activeLandmarker || !isTrackingActiveRef.current) {
      requestRef.current = requestAnimationFrame(predictWebcamLoop);
      return;
    }

    const now = performance.now();
    
    // FPS Capping mechanism (crucial for local CPU saving)
    const targetFps = configRef.current.targetFps;
    if (targetFps > 0) {
      const elapsed = now - lastFrameTimeRef.current;
      const interval = 1000 / targetFps;
      if (elapsed < interval) {
        requestRef.current = requestAnimationFrame(predictWebcamLoop);
        return;
      }
      lastFrameTimeRef.current = now - (elapsed % interval);
    }

    // Active FPS tracker display arithmetic
    fpsFrameCountRef.current += 1;
    if (now - fpsIntervalRef.current >= 1000) {
      setActiveTrackingFps(fpsFrameCountRef.current);
      fpsFrameCountRef.current = 0;
      fpsIntervalRef.current = now;
    }

    try {
      if (video.readyState >= 2) { // HAVE_CURRENT_DATA or higher
        const results = activeLandmarker.detectForVideo(video, now);
        
        if (results && results.landmarks && results.landmarks.length > 0) {
          const rawLandmarks = results.landmarks[0];
          const rawWorldLandmarks = results.worldLandmarks[0];

          // 1. Map typical camera landmarks (X/Y normalized inside [0, 1] screen coordinates)
          const mapped2d = rawLandmarks.map((pt, idx) => ({
            id: idx,
            name: LANDMARK_NAMES[idx] || `POINT_${idx}`,
            x: pt.x,
            y: pt.y,
            z: pt.z,
            visibility: pt.visibility ?? 1.0,
            presence: pt.presence ?? 1.0,
          }));

          // 2. Map high-fidelity physical coordinates (worldLandmarks, in meters rel to hips midpoint)
          const mappedWorld = rawWorldLandmarks.map((pt, idx) => ({
            id: idx,
            name: LANDMARK_NAMES[idx] || `POINT_${idx}`,
            x: pt.x,
            y: pt.y,
            z: pt.z,
            visibility: pt.visibility ?? 1.0,
            presence: pt.presence ?? 1.0,
          }));

          // 2.5 Apply OneEuroFilter for smoothing out dynamic or static jitters (shaking)
          const targetFpsForFilter = configRef.current.targetFps || 30;
          
          const filtered2d = mapped2d.map((pt, idx) => {
            const keyX = `${idx}_x`;
            const keyY = `${idx}_y`;
            const keyZ = `${idx}_z`;
            
            if (!filters2DRef.current.has(keyX)) {
              filters2DRef.current.set(keyX, new OneEuroFilter(targetFpsForFilter, 0.4, 0.02, 1.0));
              filters2DRef.current.set(keyY, new OneEuroFilter(targetFpsForFilter, 0.4, 0.02, 1.0));
              filters2DRef.current.set(keyZ, new OneEuroFilter(targetFpsForFilter, 0.4, 0.02, 1.0));
            }
            
            return {
              ...pt,
              x: filters2DRef.current.get(keyX)!.filter(pt.x, now),
              y: filters2DRef.current.get(keyY)!.filter(pt.y, now),
              z: filters2DRef.current.get(keyZ)!.filter(pt.z, now),
            };
          });

          const filteredWorld = mappedWorld.map((pt, idx) => {
            const keyX = `${idx}_x`;
            const keyY = `${idx}_y`;
            const keyZ = `${idx}_z`;
            
            if (!filtersWorldRef.current.has(keyX)) {
              filtersWorldRef.current.set(keyX, new OneEuroFilter(targetFpsForFilter, 0.4, 0.02, 1.0));
              filtersWorldRef.current.set(keyY, new OneEuroFilter(targetFpsForFilter, 0.4, 0.02, 1.0));
              filtersWorldRef.current.set(keyZ, new OneEuroFilter(targetFpsForFilter, 0.4, 0.02, 1.0));
            }
            
            return {
              ...pt,
              x: filtersWorldRef.current.get(keyX)!.filter(pt.x, now),
              y: filtersWorldRef.current.get(keyY)!.filter(pt.y, now),
              z: filtersWorldRef.current.get(keyZ)!.filter(pt.z, now),
            };
          });

          // Update active layout feeds (using smoothed nodes)
          setLiveLandmarks(filteredWorld);
          setLive2DLandmarks(filtered2d);

          // Realtime 2D canvas drawing (aligned precisely with requestAnimationFrame)
          drawRealtime2DOverlay(filtered2d);

          // 3. Keep records of coordinates if recording is enabled
          if (isRecordingRef.current) {
            const timestampMs = now - recordingStartTimeRef.current;
            const currentFrameIndex = recordingFramesCountRef.current;

            const frameObject: MoCapFrame = {
              frameIndex: currentFrameIndex,
              timestamp: timestampMs / 1000,
              landmarks: filtered2d,
              worldLandmarks: filteredWorld,
            };

            recordedFramesRef.current.push(frameObject);
            recordingFramesCountRef.current += 1;

            // Decouple React state intervals to prevent thread hogging
            if (currentFrameIndex % 4 === 0) {
              setUiRecordCount(recordingFramesCountRef.current);
            }
          }
        } else {
          // If body is obscured, clear overlay drawing
          clearOverlayCanvas();
        }
      }
    } catch (err) {
      console.error("Skeletal detection issue:", err);
    }

    requestRef.current = requestAnimationFrame(predictWebcamLoop);
  };

  // Live Canvas 2D overlay plotter
  const drawRealtime2DOverlay = (landmarks: LandmarkWithName[]) => {
    const canvas = overlayCanvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;

    if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // If camera visualization background is hidden, draw solid dark canvas
    if (!showWebcamVideo) {
      ctx.fillStyle = "#1e293b"; // Slate-800
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      
      // Draw minimal room grids
      ctx.strokeStyle = "#334155";
      ctx.lineWidth = 1;
      for (let i = 40; i < canvas.width; i += 40) {
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i, canvas.height);
        ctx.stroke();
      }
      for (let j = 40; j < canvas.height; j += 40) {
        ctx.beginPath();
        ctx.moveTo(0, j);
        ctx.lineTo(canvas.width, j);
        ctx.stroke();
      }
    }

    // Connect standard Bones
    const connections = [
      // Torso
      [11, 12], [11, 23], [12, 24], [23, 24],
      // Left Arm
      [11, 13], [13, 15],
      // Right Arm
      [12, 14], [14, 16],
      // Left Leg
      [23, 25], [25, 27], [27, 31],
      // Right Leg
      [24, 26], [26, 28], [28, 32]
    ];

    ctx.beginPath();
    connections.forEach(([p1_idx, p2_idx]) => {
      const p1 = landmarks[p1_idx];
      const p2 = landmarks[p2_idx];
      if (p1 && p2 && p1.visibility! > 0.45 && p2.visibility! > 0.45) {
        ctx.moveTo(p1.x * canvas.width, p1.y * canvas.height);
        ctx.lineTo(p2.x * canvas.width, p2.y * canvas.height);
      }
    });
    ctx.strokeStyle = showWebcamVideo ? "rgba(34, 197, 94, 0.85)" : "#10b981"; // Emerald-500
    ctx.lineWidth = showWebcamVideo ? 5 : 4;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.stroke();

    // Draw little tracked circles
    landmarks.forEach((pt) => {
      if (pt.visibility! < 0.45) return;
      ctx.beginPath();
      ctx.arc(pt.x * canvas.width, pt.y * canvas.height, 5, 0, 2 * Math.PI);
      ctx.fillStyle = "#ffffff";
      ctx.strokeStyle = "#064e3b"; // dark emerald
      ctx.lineWidth = 2;
      ctx.fill();
      ctx.stroke();
    });
  };

  const clearOverlayCanvas = () => {
    const canvas = overlayCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (!showWebcamVideo) {
        ctx.fillStyle = "#1e293b";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
    }
  };

  // Start feed streaming
  const startTracking = async () => {
    if (!landmarker) return;
    try {
      setLoadingError(null);
      const resVal = config.resolution;
      
      const widthVal = resVal === "qvga" ? 320 : resVal === "vga" ? 640 : 1280;
      const heightVal = resVal === "qvga" ? 240 : resVal === "vga" ? 480 : 720;
      
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: widthVal },
          height: { ideal: heightVal },
          frameRate: { ideal: 30 }
        }
      });

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.onloadedmetadata = () => {
          videoRef.current?.play();
          setIsTrackingActive(true);
          fpsIntervalRef.current = performance.now();
        };
      }
    } catch (err: any) {
      console.error("Kamera bağlantısı sağlanamadı:", err);
      setLoadingError("Kameraya erişilemedi. Lütfen kamera cihazının takılı olduğundan ve tarayıcı izinlerinin verildiğinden emin olun.");
    }
  };

  // Stop feed streaming
  const stopTracking = () => {
    setIsTrackingActive(false);
    setIsRecording(false);

    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach((track) => track.stop());
      videoRef.current.srcObject = null;
    }

    if (requestRef.current) {
      cancelAnimationFrame(requestRef.current);
      requestRef.current = null;
    }

    clearOverlayCanvas();
    setLiveLandmarks([]);
    setLive2DLandmarks([]);
  };

  // Trigger webcam loop on stream active
  useEffect(() => {
    if (isTrackingActive) {
      requestRef.current = requestAnimationFrame(predictWebcamLoop);
    } else {
      if (requestRef.current) {
        cancelAnimationFrame(requestRef.current);
        requestRef.current = null;
      }
    }
    return () => {
      if (requestRef.current) {
        cancelAnimationFrame(requestRef.current);
      }
    };
  }, [isTrackingActive]);

  // Recontrol recording toggler
  const toggleRecording = () => {
    if (!isTrackingActive) {
      setLoadingError("Kayıt yapabilmek için kameranın açık ve takibin aktif olması gerekir!");
      return;
    }

    if (isRecording) {
      // STOP RECORDING
      setIsRecording(false);
      const finalCount = recordingFramesCountRef.current;
      const finalDuration = (performance.now() - recordingStartTimeRef.current) / 1000;
      
      if (finalCount === 0) {
        alert("Hiçbir iskelet hareketi yakalanamadı. Kayıt yapılmadı.");
        return;
      }

      // Compile beautiful session object
      const newSession: MoCapSession = {
        id: `mocap_${Date.now()}`,
        name: `Mocap Kaydı - ${new Date().toLocaleTimeString("tr-TR")}`,
        date: new Date().toLocaleDateString("tr-TR"),
        fps: Math.round(finalCount / finalDuration) || 30,
        duration: finalDuration,
        totalFrames: finalCount,
        modelType: config.modelType,
        frames: [...recordedFramesRef.current]
      };

      setSavedClips((prev) => [newSession, ...prev]);
      setSelectedClip(newSession);
      
      // Stop tracking as well to preserve battery
      stopTracking();
    } else {
      // START RECORDING
      setIsRecording(true);
      // Clears selected clip to focus on live screen
      setSelectedClip(null);
    }
  };

  // Watch for keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Avoid firing hotkeys when typing in clip names
      if (document.activeElement?.tagName === "INPUT" || document.activeElement?.tagName === "TEXTAREA") {
        return;
      }

      if (e.code === "Space") {
        e.preventDefault();
        toggleRecording();
      } else if (e.code === "KeyT") {
        e.preventDefault();
        setShowWebcamVideo((v) => !v);
      } else if (e.code === "KeyC") {
        e.preventDefault();
        if (isTrackingActive) {
          stopTracking();
        } else {
          startTracking();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isTrackingActive, isRecording, landmarker, config]);

  // Handle Playback Loop for selected static clip
  useEffect(() => {
    if (isPlayingback && selectedClip) {
      const intervalMs = 1000 / selectedClip.fps;
      
      playbackTimerRef.current = window.setInterval(() => {
        setPlaybackFrameIndex((prevIdx) => {
          const nextIdx = prevIdx + 1;
          if (nextIdx >= selectedClip.totalFrames) {
            // Loop back or stop
            return 0;
          }
          return nextIdx;
        });
      }, intervalMs);
    } else {
      if (playbackTimerRef.current) {
        clearInterval(playbackTimerRef.current);
        playbackTimerRef.current = null;
      }
    }

    return () => {
      if (playbackTimerRef.current) {
        clearInterval(playbackTimerRef.current);
      }
    };
  }, [isPlayingback, selectedClip]);

  // Feed frame data from active clip into preview
  const activeClipLandmarks = useMemo<LandmarkWithName[]>(() => {
    if (!selectedClip || selectedClip.frames.length === 0) return [];
    const frame = selectedClip.frames[playbackFrameIndex] || selectedClip.frames[0];
    return frame.worldLandmarks;
  }, [selectedClip, playbackFrameIndex]);

  // Delete clip from list
  const deleteClip = (id: string) => {
    setSavedClips((prev) => prev.filter((c) => c.id !== id));
    if (selectedClip?.id === id) {
      setSelectedClip(null);
      setIsPlayingback(false);
      setPlaybackFrameIndex(0);
    }
  };

  // Rename a clip
  const renameClip = (id: string, newName: string) => {
    setSavedClips((prev) =>
      prev.map((c) => (c.id === id ? { ...c, name: newName } : c))
    );
    if (selectedClip?.id === id) {
      setSelectedClip((prev) => (prev ? { ...prev, name: newName } : null));
    }
  };

  // Handle direct file downloads
  const triggerJSONDownload = (session: MoCapSession) => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(session, null, 2));
    const downloadAnchor = document.createElement("a");
    downloadAnchor.setAttribute("href", dataStr);
    const cleanSessionName = session.name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    downloadAnchor.setAttribute("download", `${cleanSessionName}_skeletal_mocap.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  const triggerCSVDownload = (session: MoCapSession) => {
    const csvContent = generateCSVExport(session);
    const dataStr = "data:text/csv;charset=utf-8," + encodeURIComponent(csvContent);
    const downloadAnchor = document.createElement("a");
    downloadAnchor.setAttribute("href", dataStr);
    const cleanSessionName = session.name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    downloadAnchor.setAttribute("download", `${cleanSessionName}_world_landmarks.csv`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  // Copy code helpers
  const copyBlenderScript = () => {
    if (!selectedClip) return;
    let codeStr = "";
    const mockFileName = `${selectedClip.name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_skeletal_mocap.json`;
    if (exportTab === "blender") {
      codeStr = generateBlenderImportScript(selectedClip, mockFileName);
    } else if (exportTab === "blender_r15") {
      codeStr = generateBlenderRobloxR15Script(selectedClip, mockFileName);
    } else if (exportTab === "blender_r6") {
      codeStr = generateBlenderRobloxR6Script(selectedClip, mockFileName);
    } else if (exportTab === "roblox_r15") {
      codeStr = generateRobloxStudioLuaScript(selectedClip, "R15");
    } else if (exportTab === "roblox_r6") {
      codeStr = generateRobloxStudioLuaScript(selectedClip, "R6");
    }

    navigator.clipboard.writeText(codeStr).then(() => {
      setScriptCopied(true);
      setTimeout(() => setScriptCopied(false), 2000);
    });
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-indigo-500 selection:text-white" id="main-mocap-layout">
      {/* 🚀 Header */}
      <header className="border-b border-slate-900 bg-slate-950/80 backdrop-blur-md sticky top-0 z-50 px-6 py-4" id="app-header">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-600 rounded-xl text-white shadow-lg shadow-indigo-500/20">
              <Workflow className="w-6 h-6 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold tracking-tight bg-gradient-to-r from-white via-indigo-200 to-indigo-400 bg-clip-text text-transparent">
                  MediaPipe Iskelet Takipçi & Blender Exporter
                </h1>
                <span className="hidden sm:inline-block px-2 py-0.5 bg-emerald-950 border border-emerald-800 text-emerald-400 font-mono text-[10px] rounded-full uppercase">
                  v2.0 Web MoCap
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Web kamerasından gerçek zamanlı 3D vücut iskeleti takibi ve Blender animasyon veri aktarımı
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Status status indicator badge */}
            <div className="flex items-center gap-2">
              <span className={`w-2.5 h-2.5 rounded-full ${isRecording ? "bg-red-500 animate-ping" : isTrackingActive ? "bg-emerald-500" : "bg-slate-700"}`}></span>
              <span className="font-mono text-xs text-slate-400 uppercase tracking-widest">
                {isRecording ? "KAYDEDİLİYOR" : isTrackingActive ? `KAMERA AÇIK (${activeTrackingFps} fps)` : "BOŞTA"}
              </span>
            </div>

            {/* Quick Keyboard manual toggle */}
            <div className="hidden lg:flex items-center gap-1 bg-slate-900 px-3 py-1.5 rounded-lg border border-slate-800 text-[10px] font-mono text-slate-400">
              <span className="px-1.5 py-0.5 bg-slate-950 rounded text-slate-300 border border-slate-700">Space</span> Kayıt • 
              <span className="px-1.5 py-0.5 bg-slate-950 rounded text-slate-300 border border-slate-700 ml-1">T</span> Video Togg •
              <span className="px-1.5 py-0.5 bg-slate-950 rounded text-slate-300 border border-slate-700 ml-1">C</span> Kamera Togg
            </div>
          </div>
        </div>
      </header>

      {/* ⚠️ Error Banner */}
      {loadingError && (
        <div className="bg-red-950/80 border-b border-red-900 text-red-200 px-6 py-4 text-xs flex items-center justify-between gap-4 animate-fadeIn" id="tracker-error-alert">
          <div className="flex items-center gap-2 max-w-5xl">
            <span className="font-bold flex-shrink-0 px-2 py-0.5 bg-red-800 text-white rounded">Hata:</span>
            <span>{loadingError}</span>
          </div>
          <button
            onClick={() => setLoadingError(null)}
            className="text-red-400 hover:text-white font-bold px-2 py-1 rounded hover:bg-red-900/30"
          >
            Yoksay
          </button>
        </div>
      )}

      {/* 🔮 MAIN STAGE */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 md:p-6 grid grid-cols-1 lg:grid-cols-12 gap-6" id="mocap-workstation">
        
        {/* LEFT COLUMN: VIEWPORTS (lg:col-span-7) */}
        <div className="lg:col-span-7 flex flex-col gap-6" id="left-workspace-viewport-column">
          
          {/* Active Title */}
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
              <Layers2 className="w-4 h-4 text-indigo-400" />
              {selectedClip ? "Klip İzleme & Playback" : "Canlı Kamera & Takip"}
            </h2>
            {selectedClip && (
              <button
                onClick={() => {
                  setSelectedClip(null);
                  setIsPlayingback(false);
                  setPlaybackFrameIndex(0);
                }}
                className="text-xs bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-300 hover:text-white px-3 py-1.5 rounded-lg flex items-center gap-1.5 cursor-pointer duration-150"
              >
                <Camera className="w-3.5 h-3.5 text-indigo-400" />
                Canlı Kameraya Dön
              </button>
            )}
          </div>

          {/* VIEWPORT CONTROLLER CARD */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4" id="viewports-bento-grid">
            
            {/* VIEWPORT 1: Input feed (Webcam overlay OR static background) */}
            <div className="rounded-2xl border border-slate-800 bg-slate-900 overflow-hidden relative shadow-lg flex flex-col h-[360px]" id="webcam-camera-card">
              <div className="bg-slate-950/80 px-4 py-2 border-b border-slate-800 flex items-center justify-between text-xs z-10">
                <span className="font-mono text-slate-400 flex items-center gap-1.5">
                  <Video className="w-3.5 h-3.5 text-indigo-400" />
                  Kamera Takip Görünümü
                </span>
                
                {isTrackingActive && (
                  <button
                    onClick={() => setShowWebcamVideo(!showWebcamVideo)}
                    title={showWebcamVideo ? "Video Kapat (Performans)" : "Video Aç"}
                    className="p-1 rounded bg-slate-900 text-slate-300 hover:text-white border border-slate-700 hover:bg-slate-800 duration-150 cursor-pointer"
                  >
                    {showWebcamVideo ? <VideoOff className="w-3.5 h-3.5" /> : <Video className="w-3.5 h-3.5" />}
                  </button>
                )}
              </div>

              {/* Camera view screen */}
              <div className="flex-1 bg-slate-950 relative flex items-center justify-center overflow-hidden h-full">
                
                {/* Loader Overlay */}
                {isModelLoading && (
                  <div className="absolute inset-x-0 inset-y-0 bg-slate-950/95 backdrop-blur-sm flex flex-col items-center justify-center text-center p-6 z-20">
                    <div className="relative mb-4 flex items-center justify-center">
                      <div className="absolute w-12 h-12 border-4 border-indigo-500/20 rounded-full animate-pulse"></div>
                      <RotateCw className="w-8 h-8 text-indigo-500 animate-spin" />
                    </div>
                    <span className="text-sm font-semibold mb-1 text-slate-200">MediaPipe Başlatılıyor</span>
                    <span className="text-xs text-slate-500 font-mono progress-text max-w-sm">{loadingStep}</span>
                  </div>
                )}

                {/* Simulated Silhouette Frame if Tracking is OFF and no Clip loaded */}
                {!isTrackingActive && !selectedClip && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center bg-slate-950 z-10 select-none">
                    <div className="w-16 h-16 bg-slate-900 rounded-2xl border border-slate-800 flex items-center justify-center text-indigo-400/50 mb-3 group-hover:border-indigo-500 duration-300">
                      <Camera className="w-8 h-8" />
                    </div>
                    <p className="text-xs text-slate-300 font-medium max-w-xs mb-4">
                      Vücut hareketlerini yakalamak için kameranızı başlatın
                    </p>
                    <button
                      onClick={startTracking}
                      disabled={isModelLoading}
                      className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 duration-150 font-medium text-xs text-white rounded-xl shadow-lg shadow-indigo-600/20 disabled:opacity-50 flex items-center gap-1.5 cursor-pointer"
                    >
                      <Camera className="w-3.5 h-3.5" />
                      Kamerayı Başlat
                    </button>
                  </div>
                )}

                {/* Played back active clip layout */}
                {selectedClip && !isTrackingActive && (
                  <div className="absolute inset-0 bg-slate-900/40 flex flex-col items-center justify-center text-center p-4 select-none z-10 border border-dashed border-indigo-500/10">
                    <Workflow className="w-10 h-10 text-indigo-400/40 mb-2 animate-bounce" />
                    <span className="text-xs font-semibold text-indigo-300 uppercase tracking-widest">{selectedClip.name}</span>
                    <span className="text-[10px] font-mono text-slate-500 mt-1">
                      Kare: {playbackFrameIndex + 1} / {selectedClip.totalFrames} • Model: {selectedClip.modelType.toUpperCase()}
                    </span>
                    <p className="text-[10px] text-slate-400 max-w-[200px] mt-2 italic leading-relaxed">
                      Sanal iskelet 3D Mocap kutusunda simüle ediliyor.
                    </p>
                  </div>
                )}

                {/* Real HTML5 HTML Video element */}
                <video
                  ref={videoRef}
                  id="camera-element"
                  autoPlay
                  playsInline
                  muted
                  className={`w-full h-full object-cover select-none pointer-events-none transition-opacity duration-300 ${
                    showWebcamVideo && isTrackingActive ? "opacity-10" : "opacity-0 absolute max-h-0"
                  } ${config.mirrorMode ? "scale-x-[-1]" : ""}`}
                />

                {/* Overlaid drawing Canvas */}
                <canvas
                  ref={overlayCanvasRef}
                  className={`w-full h-full object-contain select-none pointer-events-none transition-transform z-10 ${
                    config.mirrorMode ? "scale-x-[-1]" : ""
                  }`}
                />
              </div>
            </div>

            {/* VIEWPORT 2: Lightweight 3D Orbit Coordinate Space previewer */}
            <div className="h-[360px]" id="mocap-stage-3d-card">
              <SkeletonPreview3D
                landmarks={selectedClip ? activeClipLandmarks : liveLandmarks}
                height={360}
                showLabels={false}
                rigType={rigType}
              />
            </div>

          </div>

          {/* PLAYBACK / RECORD TIMELINE TIMELINE ROW */}
          <div className="bg-slate-900 rounded-2xl border border-slate-800 p-4 shadow-lg flex flex-col gap-3" id="timeline-scrubber-panel">
            {selectedClip ? (
              // CLIP PLAYBACK INTERFACE
              <div className="flex flex-col gap-2 animate-fadeIn" id="clip-playback-controls">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-mono font-medium text-slate-300">
                    Aktif Klip Zaman Çizelgesi
                  </span>
                  <span className="font-mono text-indigo-400">
                    {playbackFrameIndex + 1} / {selectedClip.totalFrames} Kare ({((playbackFrameIndex) / selectedClip.fps).toFixed(2)}s / {selectedClip.duration.toFixed(2)}s)
                  </span>
                </div>
                
                {/* Scrubbing slider */}
                <input
                  type="range"
                  min={0}
                  max={selectedClip.totalFrames - 1}
                  value={playbackFrameIndex}
                  onChange={(e) => {
                    setIsPlayingback(false);
                    setPlaybackFrameIndex(parseInt(e.target.value));
                  }}
                  className="w-full accent-indigo-500 cursor-pointer h-1.5 bg-slate-950 rounded-lg appearance-none"
                />

                {/* Actions bar for active load */}
                <div className="flex items-center justify-between mt-1">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setIsPlayingback(!isPlayingback)}
                      className={`px-3 py-1.5 rounded-lg border flex items-center gap-1.5 text-xs cursor-pointer duration-150 ${
                        isPlayingback
                          ? "bg-slate-950 border-slate-700 text-indigo-400 hover:text-white"
                          : "bg-indigo-600 border-indigo-500 text-white hover:bg-indigo-500"
                      }`}
                    >
                      {isPlayingback ? (
                        <>
                          <Pause className="w-3.5 h-3.5 fill-indigo-400" /> Duraklat
                        </>
                      ) : (
                        <>
                          <Play className="w-3.5 h-3.5 fill-white" /> Oynat
                        </>
                      )}
                    </button>
                    
                    <button
                      onClick={() => {
                        setIsPlayingback(false);
                        setPlaybackFrameIndex(0);
                      }}
                      className="px-2.5 py-1.5 bg-slate-950 hover:bg-slate-850 border border-slate-800 rounded-lg text-xs text-slate-400 hover:text-white cursor-pointer duration-150"
                    >
                      Başa Al
                    </button>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => triggerCSVDownload(selectedClip)}
                      className="px-2.5 py-1.5 bg-slate-950 hover:bg-slate-850 border border-slate-800 hover:border-slate-700 rounded-lg text-xs font-mono text-slate-300 hover:text-white flex items-center gap-1 md:gap-1.5 cursor-pointer duration-150"
                    >
                      <Download className="w-3.5 h-3.5 text-emerald-400" />
                      CSV İndir
                    </button>
                    <button
                      onClick={() => triggerJSONDownload(selectedClip)}
                      className="px-2.5 py-1.5 bg-indigo-650 hover:bg-indigo-550 border border-indigo-600 rounded-lg text-xs font-mono text-white flex items-center gap-1 md:gap-1.5 cursor-pointer duration-150 shadow-md shadow-indigo-650/10"
                    >
                      <Download className="w-3.5 h-3.5 text-indigo-200" />
                      JSON İndir
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              // LIVE RECORDING STATS
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 py-1" id="mocap-live-recording-summary">
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-xl border flex items-center justify-center ${isRecording ? "bg-red-950/40 border-red-800 text-red-500 animate-pulse" : "bg-slate-950 border-slate-800 text-slate-400"}`}>
                    <Clock className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="text-xs font-medium text-slate-400">Yakalanan MoCap Verisi</div>
                    <div className="text-sm font-mono font-bold mt-0.5">
                      {isRecording ? (
                        <span className="text-red-500">
                          {uiRecordCount} Kare ({((uiRecordCount) / (config.targetFps || 30)).toFixed(2)}s) kayıt yapılıyor...
                        </span>
                      ) : (
                        <span className="text-slate-300">Görüntü bekleniyor (Kayıt durduruldu)</span>
                      )}
                    </div>
                  </div>
                </div>

                {isTrackingActive ? (
                  <button
                    onClick={toggleRecording}
                    className={`px-5 py-2.5 rounded-xl font-semibold text-xs transition-all duration-200 shadow-lg flex items-center justify-center gap-2 cursor-pointer ${
                      isRecording
                        ? "bg-red-600 hover:bg-red-500 text-white shadow-red-600/25 animate-pulse"
                        : "bg-indigo-600 hover:bg-indigo-500 text-white shadow-indigo-600/35"
                    }`}
                  >
                    {isRecording ? (
                      <>
                        <Square className="w-4 h-4 fill-white" /> Kaydı Durdur (Space)
                      </>
                    ) : (
                      <>
                        <div className="w-2.5 h-2.5 rounded-full bg-white animate-ping"></div> Kaydı Başlat (Space)
                      </>
                    )}
                  </button>
                ) : (
                  <button
                    onClick={startTracking}
                    className="px-5 py-2.5 bg-slate-950 hover:bg-slate-850 text-indigo-400 border border-slate-800 hover:border-slate-700 duration-150 font-semibold text-xs rounded-xl flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <Camera className="w-4 h-4" /> Kamerayı Başlatıp Veri Al
                  </button>
                )}
              </div>
            )}
          </div>

          {/* PERFORMANCE CAPABILITY ADVICE */}
          <div className="bg-slate-900/40 rounded-xl border border-slate-800/60 p-4 text-xs font-mono text-slate-400 leading-relaxed flex items-start gap-2.5" id="low-spec-note">
            <Zap className="w-5 h-5 text-indigo-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-slate-300 font-semibold mb-1">
                İ3-6100U İşlemci Donanım Optimizasyonu (Performans İpuçları)
              </p>
              <p>
                İşlemcinizi yormamak için aşağıdaki optimizasyonları otomatik uyguladık:
              </p>
              <ul className="list-disc list-inside mt-1 space-y-1 text-[11px] text-slate-400">
                <li>
                  <b className="text-slate-300">"LITE" Modeli:</b> Ağır sinir ağları yerine hafif iskelet takipçisi seçilidir.
                </li>
                <li>
                  <b className="text-slate-300">Görüntü Gizleme:</b> Kameranın video piksel çizimlerini gizleyerek işlemci yükünü sıfırlayabilirsiniz. Detaylar için paneldeki "Kamera Göster" seçeneğini kapatın.
                </li>
                <li>
                  <b className="text-slate-300">FPS Sınırlayıcı:</b> MediaPipe saniyede maksimum 30 kez çalışarak işlemci çekirdeklerini rahatlatır.
                </li>
              </ul>
            </div>
          </div>

        </div>

        {/* RIGHT COLUMN: CONTROL PANEL & METADATA (lg:col-span-5) */}
        <div className="lg:col-span-5 flex flex-col gap-6" id="right-workspace-control-column">
          
          {/* TRACKING AND CONFIGURATION STATS CARD */}
          <div className="bg-slate-900 rounded-2xl border border-slate-800 p-5 shadow-lg flex flex-col gap-4" id="tracking-settings-card">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-sm font-semibold tracking-wide uppercase flex items-center gap-1.5">
                <Settings className="w-4 h-4 text-indigo-400" />
                Kamera & Takipçi Ayarları
              </h3>
              
              {!isTrackingActive ? (
                <button
                  onClick={startTracking}
                  className="text-xs text-indigo-400 hover:text-white font-semibold flex items-center gap-1 cursor-pointer"
                >
                  <Camera className="w-3.5 h-3.5" /> Başlat
                </button>
              ) : (
                <button
                  onClick={stopTracking}
                  className="text-xs text-red-400 hover:text-white font-semibold flex items-center gap-1 cursor-pointer"
                >
                  <CameraOff className="w-3.5 h-3.5" /> Durdur
                </button>
              )}
            </div>

            {/* Performance Config Rows */}
            <div className="flex flex-col gap-4" id="config-form">
              
              {/* Row 1: Model version selection */}
              <div>
                <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block mb-1.5">
                  MediaPipe Model Karmaşıklığı (Model Complexity)
                </label>
                <div className="grid grid-cols-3 gap-1.5" id="model-density-picker">
                  {(["lite", "full", "heavy"] as const).map((type) => (
                    <button
                      key={type}
                      onClick={() => setConfig({ ...config, modelType: type })}
                      className={`py-2 text-xs font-semibold rounded-lg capitalize border cursor-pointer duration-150 ${
                        config.modelType === type
                          ? "bg-indigo-650/40 border-indigo-500 text-white shadow-md shadow-indigo-650/5 font-bold"
                          : "bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200"
                      }`}
                    >
                      {type === "lite" ? "Lite ⚡" : type === "heavy" ? "Heavy 🔍" : "Full ⚖️"}
                    </button>
                  ))}
                </div>
                <p className="text-[10px] text-slate-500 mt-1 italic">
                  * i3 PC için Lite önerilir. Heavy, 3D hassasiyeti artırır ancak performansı düşürür.
                </p>
              </div>

              {/* Row 2: Resolution & Frame caps */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block mb-1.5">
                    Kamera Çözünürlüğü
                  </label>
                  <select
                    value={config.resolution}
                    onChange={(e) => {
                      const res = e.target.value as "qvga" | "vga" | "hd";
                      setConfig({ ...config, resolution: res });
                      if (isTrackingActive) {
                        // Restart stream to apply resolution update
                        setTimeout(() => {
                          stopTracking();
                          setTimeout(startTracking, 300);
                        }, 50);
                      }
                    }}
                    className="w-full bg-slate-950 border border-slate-800 text-slate-300 font-semibold text-xs py-2 px-3 rounded-lg focus:outline-none focus:border-indigo-500 cursor-pointer"
                  >
                    <option value="qvga">320x240 (Lite/En Hızlı)</option>
                    <option value="vga">640x480 (Orta Dengeli)</option>
                    <option value="hd">1280x720 (Net/Ağır)</option>
                  </select>
                </div>

                <div>
                  <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block mb-1.5">
                    FPS Yakalama Sınırı
                  </label>
                  <select
                    value={config.targetFps}
                    onChange={(e) => setConfig({ ...config, targetFps: parseInt(e.target.value) })}
                    className="w-full bg-slate-950 border border-slate-800 text-slate-300 font-semibold text-xs py-2 px-3 rounded-lg focus:outline-none focus:border-indigo-500 cursor-pointer"
                  >
                    <option value={15}>15 FPS (Ultra Hafif)</option>
                    <option value={24}>24 FPS (Blender Match)</option>
                    <option value={30}>30 FPS (Standart Mocap)</option>
                    <option value={0}>Sınırsız (Donanım Gücü)</option>
                  </select>
                </div>
              </div>

              {/* Row 3: Boolean switches */}
              <div className="flex items-center justify-between bg-slate-950/50 p-3 rounded-lg border border-slate-800/60 mt-1">
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs font-semibold text-slate-300">Ayna Modu (Mirror Video)</span>
                  <span className="text-[9px] text-slate-500">Kamera görüntüsünü yatay döndürür</span>
                </div>
                <label className="relative inline-flex items-center cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={config.mirrorMode}
                    onChange={(e) => setConfig({ ...config, mirrorMode: e.target.checked })}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-slate-300 after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-indigo-600 peer-checked:after:bg-white"></div>
                </label>
              </div>

            </div>
          </div>

          {/* EXECUTED MoCap SESSIONS TRACKER */}
          <div className="bg-slate-900 rounded-2xl border border-slate-800 p-5 shadow-lg flex flex-col gap-4" id="mocap-history-card">
            <h3 className="text-sm font-semibold tracking-wide uppercase flex items-center gap-1.5 border-b border-slate-800 pb-3">
              <FileText className="w-4 h-4 text-indigo-400" />
              Yakaladığım MoCap Klipleri ({savedClips.length})
            </h3>

            {savedClips.length === 0 ? (
              <div className="text-center py-6 px-4 bg-slate-950 rounded-xl border border-dashed border-slate-800 select-none">
                <Workflow className="w-8 h-8 text-slate-700 mx-auto mb-2" />
                <p className="text-xs text-slate-400 font-medium">Kayıtlı klip bulunmuyor.</p>
                <p className="text-[10px] text-slate-600 mt-1">
                  Kayıt Başlat diyerek iskelet kütüphanesini doldurun, ardından Blender python scripti oluşturun.
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-2.5 max-h-[190px] overflow-y-auto pr-1" id="saved-clips-container">
                {savedClips.map((clip) => {
                  const isSelected = selectedClip?.id === clip.id;
                  return (
                    <div
                      key={clip.id}
                      className={`p-3 rounded-xl border transition-all duration-150 flex items-center justify-between text-xs gap-3 ${
                        isSelected
                          ? "bg-slate-950 border-indigo-500/80 shadow-md shadow-indigo-650/5"
                          : "bg-slate-950 border-slate-800 hover:border-slate-700"
                      }`}
                    >
                      <div className="flex-1 min-w-0">
                        {/* Name Input with Direct Ref Editing on Blur */}
                        <input
                          type="text"
                          value={clip.name}
                          onChange={(e) => renameClip(clip.id, e.target.value)}
                          className="bg-transparent font-medium text-slate-200 border-none hover:bg-slate-900/60 p-0.5 rounded focus:bg-slate-900 focus:outline-none w-full border-b border-transparent focus:border-indigo-600"
                          title="Klibi yeniden adlandırmak için tıklayın"
                          placeholder="Klip Adı"
                        />
                        <div className="flex items-center gap-2 mt-1.5 text-[9px] font-mono text-slate-500">
                          <span className="flex items-center gap-0.5"><Calendar className="w-2.5 h-2.5" />{clip.date}</span>
                          <span className="text-slate-700">•</span>
                          <span>{clip.totalFrames} Kare</span>
                          <span className="text-slate-700">•</span>
                          <span>{clip.duration.toFixed(1)}sn ({clip.fps} FPS)</span>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        <button
                          onClick={() => {
                            setSelectedClip(clip);
                            setPlaybackFrameIndex(0);
                            setIsPlayingback(true);
                          }}
                          title="Klibi Oynat / 3D Göster"
                          className={`p-1.5 rounded-lg border transition-colors cursor-pointer ${
                            isSelected
                              ? "bg-indigo-600 text-white border-indigo-500"
                              : "bg-slate-900 text-slate-400 border-slate-800 hover:text-white"
                          }`}
                        >
                          <Play className="w-3.5 h-3.5 fill-current" />
                        </button>
                        <button
                          onClick={() => triggerJSONDownload(clip)}
                          title="JSON Olarak Dosyala"
                          className="p-1.5 bg-slate-900 text-slate-400 border border-slate-800 hover:text-white rounded-lg cursor-pointer"
                        >
                          <Download className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => deleteClip(clip.id)}
                          title="Klibi Temizle"
                          className="p-1.5 bg-slate-950 text-slate-500 hover:text-red-405 border border-slate-800 hover:border-red-900/40 rounded-lg cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5 hover:text-red-500" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* PIPELINE INTEGRATION INSTRUCTIONS & COPY SCRIPT */}
          <div className="bg-slate-900 rounded-2xl border border-slate-800 p-5 shadow-lg flex flex-col gap-4" id="export-pipeline-instructions-card">
            <h3 className="text-sm font-semibold tracking-wide uppercase flex items-center gap-1.5 border-b border-slate-800 pb-3">
              <Sparkles className="w-4 h-4 text-indigo-400 animate-pulse" />
              Sanal Animasyon Pipeline & Aktarıcı
            </h3>

            {/* TAB SELECTOR */}
            <div className="grid grid-cols-2 md:grid-cols-5 bg-slate-950 p-1.5 rounded-xl border border-slate-800 gap-1 lg:gap-1.5" id="export-platform-tabs">
              <button
                type="button"
                onClick={() => setExportTab("blender")}
                className={`py-2 px-1 text-[10px] md:text-xs font-semibold rounded-lg transition-all duration-150 cursor-pointer text-center ${
                  exportTab === "blender"
                    ? "bg-indigo-600 text-white shadow"
                    : "text-slate-400 hover:text-slate-200 hover:bg-slate-900/60"
                }`}
              >
                Blender (Nokta)
              </button>
              <button
                type="button"
                onClick={() => setExportTab("blender_r15")}
                className={`py-2 px-1 text-[10px] md:text-xs font-semibold rounded-lg transition-all duration-150 cursor-pointer text-center ${
                  exportTab === "blender_r15"
                    ? "bg-indigo-600 text-white shadow"
                    : "text-slate-400 hover:text-slate-200 hover:bg-slate-900/60"
                }`}
              >
                Blender (R15)
              </button>
              <button
                type="button"
                onClick={() => setExportTab("blender_r6")}
                className={`py-2 px-1 text-[10px] md:text-xs font-semibold rounded-lg transition-all duration-150 cursor-pointer text-center ${
                  exportTab === "blender_r6"
                    ? "bg-indigo-600 text-white shadow"
                    : "text-slate-400 hover:text-slate-200 hover:bg-slate-900/60"
                }`}
              >
                Blender (R6)
              </button>
              <button
                type="button"
                onClick={() => setExportTab("roblox_r15")}
                className={`py-2 px-1 text-[10px] md:text-xs font-semibold rounded-lg transition-all duration-150 cursor-pointer text-center ${
                  exportTab === "roblox_r15"
                    ? "bg-indigo-600 text-white shadow"
                    : "text-slate-400 hover:text-slate-200 hover:bg-slate-900/60"
                }`}
              >
                Roblox R15 Lua
              </button>
              <button
                type="button"
                onClick={() => setExportTab("roblox_r6")}
                className={`py-2 px-1 text-[10px] md:text-xs font-semibold rounded-lg transition-all duration-150 cursor-pointer text-center ${
                  exportTab === "roblox_r6"
                    ? "bg-indigo-600 text-white shadow"
                    : "text-slate-400 hover:text-slate-200 hover:bg-slate-900/60"
                }`}
              >
                Roblox R6 Lua
              </button>
            </div>
            
            {selectedClip ? (
              <div className="flex flex-col gap-3 animate-fadeIn" id="pipeline-active-clip-details">
                <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 text-xs text-slate-300">
                  <div className="font-semibold text-slate-200 mb-1 flex items-center gap-1">
                    <Check className="w-4 h-4 text-emerald-400" />
                    Klip Seçildi: <span className="text-indigo-400 font-mono font-medium">{selectedClip.name}</span>
                  </div>
                  {exportTab === "blender" ? (
                    <span>Bu hareketi Blender'a aktarmak için aşağıdaki scripti tek tıkla kopyalayıp Blender'da çalıştırın.</span>
                  ) : exportTab === "blender_r15" ? (
                    <span>Blender'da açık olan <b>Roblox R15 Armature (Rig)</b> modelinize bu hareketi bağlamak ve kaydetmek için aşağıdaki Python kodunu çalıştırın. Dosya indirmenize gerek yoktur!</span>
                  ) : exportTab === "blender_r6" ? (
                    <span>Blender'da açık olan <b>Roblox R6 Armature (Rig)</b> modelinize bu hareketi bağlamak ve kaydetmek için aşağıdaki Python kodunu çalıştırın. Dosya indirmenize gerek yoktur!</span>
                  ) : (
                    <span>Roblox Studio'da seçtiğiniz <b>{exportTab === "roblox_r15" ? "R15" : "R6"}</b> karakterine animasyonu anında bağlamak için bu Lua kodunu kopyalayıp Roblox Studio içinde oluşturacağınız Script nesnesine yapıştırın.</span>
                  )}
                </div>

                {/* Script Code Block */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[10px] font-mono font-semibold uppercase text-slate-500 tracking-wider">
                      {exportTab.startsWith("blender") ? "Blender Python Script" : `Roblox Studio ${exportTab === "roblox_r15" ? "R15" : "R6"} Lua Script`}
                    </span>
                    <button
                      onClick={copyBlenderScript}
                      className="text-[10px] font-semibold bg-indigo-650 hover:bg-indigo-550 duration-150 text-white py-1 px-2.5 rounded-lg flex items-center gap-1 cursor-pointer"
                    >
                      {scriptCopied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      {scriptCopied ? "Kopyalandı!" : "Kodu Kopyala"}
                    </button>
                  </div>
                  
                  <div className="bg-slate-950 rounded-xl border border-slate-800 p-3 font-mono text-[10px] max-h-[160px] overflow-y-auto relative text-slate-400 leading-normal scrollbar-thin">
                    <pre>
                      {exportTab === "blender" 
                        ? generateBlenderImportScript(selectedClip, `${selectedClip.name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_skeletal_mocap.json`) 
                        : exportTab === "blender_r15"
                        ? generateBlenderRobloxR15Script(selectedClip, `${selectedClip.name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_skeletal_mocap.json`)
                        : exportTab === "blender_r6"
                        ? generateBlenderRobloxR6Script(selectedClip, `${selectedClip.name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_skeletal_mocap.json`)
                        : generateRobloxStudioLuaScript(selectedClip, exportTab === "roblox_r15" ? "R15" : "R6")
                      }
                    </pre>
                  </div>
                </div>

                {/* Quick tutorial instructions depending on tab */}
                {exportTab.startsWith("blender") ? (
                  <div className="flex flex-col gap-2 bg-slate-950/40 p-3 rounded-xl border border-slate-850 text-xs leading-relaxed text-slate-400" id="blender-guides">
                    <span className="font-semibold text-slate-300 flex items-center gap-1"><Info className="w-3.5 h-3.5 text-indigo-400" /> Nasıl Kullanılır? (Blender)</span>
                    {exportTab === "blender" ? (
                      <ol className="list-decimal list-inside text-[11px] space-y-1 text-slate-400 pl-1">
                        <li>
                          Seçilen MoCap klibini indirin (örn. <span className="text-indigo-300 font-mono font-bold">.json</span>).
                        </li>
                        <li>
                          Blender'ı açıp <span className="text-slate-300 font-semibold">Scripting Workspace</span>'e geçiş yapın ve yeni bir "New Text" oluşturun.
                        </li>
                        <li>
                          Kopyaladığınız Python kodunu yapıştırın.
                        </li>
                        <li>
                          Kodun en üstündeki <span className="text-indigo-400 font-mono">FILE_PATH</span>'i indirdiğiniz dosyanın bilgisayardaki tam yolu ile güncelleyin.
                        </li>
                        <li>
                          Scripti çalıştır tuşuna (<span className="text-slate-300">Run Script</span>) basın. Blender'da <span className="text-indigo-400 font-bold">"MediaPipe_MoCap"</span> isimli koleksiyonda hareketli 33 adet nokta (Empty nesnesi) oluşacaktır!
                        </li>
                      </ol>
                    ) : (
                      <ol className="list-decimal list-inside text-[11px] space-y-1.5 text-slate-400 pl-1">
                        <li>
                          Blender'da sahnenize Roblox standardında <b>{exportTab === "blender_r15" ? "R15" : "R6"}</b> bir karakter modeli (Armature/Rig) aktarın.
                        </li>
                        <li>
                          3D ekrandan veya Outliner (Nesneler) listesinden bu karakter iskeletini (Armature nesnesini) tıklayarak <b>SEÇİN</b>.
                        </li>
                        <li>
                          Blender üst menüsünden <span className="text-indigo-300 font-semibold">Scripting Workspace</span> (Kod Editörü) sekmesine tıklayıp yeni bir kod sayfası açın (<b>"New"</b> butonu).
                        </li>
                        <li>
                          Yukarıdaki yeşil butondan kopyaladığınız Python kodunu bu alana yapıştırın.
                        </li>
                        <li>
                          Editör panelinin üstündeki siyah üçgen <b>"Run Script"</b> butonuna basarak kodu çalıştırın!
                        </li>
                        <li>
                          Kemikleriniz otomatik olarak hareket edecektir! İşlem tamamlandıktan sonra animasyonunuz karakterinize kalıcı olarak işlenir (Bake edilir). Ardından FBX dışa aktarma yaparak Roblox'a yükleyebilirsiniz!
                        </li>
                      </ol>
                    )}
                  </div>
                ) : (
                  <div className="flex flex-col gap-2 bg-slate-950/40 p-3 rounded-xl border border-slate-850 text-xs leading-relaxed text-slate-400" id="roblox-guides">
                    <span className="font-semibold text-slate-300 flex items-center gap-1"><Info className="w-3.5 h-3.5 text-indigo-400" /> Nasıl Kullanılır? (Roblox Studio)</span>
                    <ol className="list-decimal list-inside text-[11px] space-y-1.5 text-slate-400 pl-1">
                      <li>
                        Roblox Studio'da bir proje açın ve <b>Rig Builder</b> sekmesinden bir R15 veya R6 karakter modeli (Rig) oluşturun.
                      </li>
                      <li>
                        Workspace ("Gezgin") altında bulunan bu karakter modelinin sağındaki <b>"+" işaretine tıklayın</b> ve yeni bir <b>Script</b> (Sunucu Betiği) oluşturun.
                      </li>
                      <li>
                        Yukandaki yeşil butondan kopyaladığınız Lua kodunu oluşturduğunuz Script nesnesinin <b>içine yapıştırın</b>.
                      </li>
                      <li>
                        Studio üst menüsünden <b>"Oynat / Çalıştır" (Run/Play)</b> butonuna basarak projeyi başlatın. 
                      </li>
                      <li>
                        Karakter modelinizin altında saniyeler içinde <b>"MocapAnimation"</b> adında bir nesne (<i>KeyframeSequence</i>) oluşacaktır! 
                      </li>
                      <li>
                        Bu nesneye sağ tıklayıp <b>"Save to Roblox..." (Roblox'a Kaydet)</b> diyerek animasyonu oyununuza/hesabınıza anında yükleyin. Sonrasında Script'i silebilirsiniz!
                      </li>
                    </ol>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center py-8 px-4 bg-slate-950 rounded-xl border border-dashed border-slate-800 select-none text-slate-500 leading-relaxed text-xs">
                <HelpCircle className="w-8 h-8 text-slate-700 mx-auto mb-2" />
                Dışa aktarma kodunu üretmek için önce bir hareket kaydı yapın veya geçmiş kliplerden birini seçin!
              </div>
            )}
            
          </div>

        </div>

      </main>

      {/* 📝 FOOTER / WORKSPACE LOGS */}
      <footer className="border-t border-slate-900 bg-slate-950/80 px-6 py-4 mt-auto text-slate-500 text-xs" id="app-footer-grid">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-center md:justify-between gap-3 text-center md:text-left">
          <p>
            MediaPipe Pose Landmarker • WebGL/WebAssembly Yerel İvmelendirme • İ3-6100U İşlemciler için Özel Optimize Edilmiştir
          </p>
          <div className="flex justify-center md:justify-end gap-4 text-[10px] font-mono text-indigo-400/80 uppercase">
            <span>3D SKELETAL CAPTURE SYSTEM</span>
            <span>•</span>
            <span>BLENDER COMPATIBLE</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
