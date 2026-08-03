/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useRef, useEffect, MouseEvent, WheelEvent } from "react";
import { LandmarkWithName, SKELETON_CONNECTIONS } from "../types";
import { Rotate3d, Maximize, RefreshCw, ZoomIn, ZoomOut } from "lucide-react";

interface SkeletonPreview3DProps {
  landmarks: LandmarkWithName[];
  height?: number;
  showLabels?: boolean;
  rigType?: "standard" | "R15" | "R6";
}

export default function SkeletonPreview3D({
  landmarks,
  height = 360,
  showLabels = false,
  rigType = "standard",
}: SkeletonPreview3DProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  // Viewport states
  const [rotationX, setRotationX] = useState<number>(-0.1); // Elevation (in radians)
  const [rotationY, setRotationY] = useState<number>(0.4); // Azimuth (in radians)
  const [zoom, setZoom] = useState<number>(180); // Pixels per meter scale
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const dragStartPos = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  // Reset viewport to default
  const resetView = () => {
    setRotationX(-0.1);
    setRotationY(0.4);
    setZoom(180);
  };

  // Canvas Mouse interaction handlers
  const handleMouseDown = (e: MouseEvent<HTMLCanvasElement>) => {
    setIsDragging(true);
    dragStartPos.current = { x: e.clientX, y: e.clientY };
  };

  const handleMouseMove = (e: MouseEvent<HTMLCanvasElement>) => {
    if (!isDragging) return;
    const deltaX = e.clientX - dragStartPos.current.x;
    const deltaY = e.clientY - dragStartPos.current.y;
    
    // Adjust rotations
    setRotationX((prev) => Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, prev + deltaY * 0.01)));
    setRotationY((prev) => prev - deltaX * 0.01);
    
    dragStartPos.current = { x: e.clientX, y: e.clientY };
  };

  const handleMouseUpOrLeave = () => {
    setIsDragging(false);
  };

  const handleWheel = (e: WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    setZoom((prev) => Math.max(50, Math.min(500, prev - e.deltaY * 0.2)));
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    
    const width = canvas.width;
    const height = canvas.height;
    const centerX = width / 2;
    const centerY = height / 2 + 40; // Shift downward slightly to center the body tallness

    // Clear Canvas with a sleek Grid background (Studio floor style)
    ctx.clearRect(0, 0, width, height);
    
    // Background styled dark-grey/slate
    ctx.fillStyle = "#0f172a"; // Slate-900
    ctx.fillRect(0, 0, width, height);

    // Draw Grid Floor in 3D standard spaces
    drawGridFloor(ctx, centerX, centerY, width, height);

    if (!landmarks || landmarks.length === 0) {
      // Draw "No Tracker Data" message
      ctx.fillStyle = "#64748b";
      ctx.font = "13px ui-monospace, monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("STAND IN FRONT OF CAMERA TO SEED LANDMARKS", centerX, centerY - 40);
      return;
    }

    // Map 3D points through transformations (Azimuth, Elevation)
    // MediaPipe World Landmarks coordinate system has:
    // - X: positive to the left of the screen (actor's right)
    // - Y: positive going down
    // - Z: positive going away / backward depth
    // The hips center is close to (0,0,0).
    interface ProjectedPoint {
      id: number;
      name: string;
      raw: { x: number; y: number; z: number };
      projX: number;
      projY: number;
      projZ: number; // For depth styling
      screenX: number;
      screenY: number;
      visibility: number;
    }

    const projectedPoints: { [key: number]: ProjectedPoint } = {};

    landmarks.forEach((p) => {
      // Correct coordinate mapping so UP is positive-Y in standard views
      // Let's negate Y (so vertical heights go up)
      const xInput = -p.x; // Mirroring standard view so actor's left is screen's right
      const yInput = -p.y; // MediaPipe Y down -> Negate to Y up
      const zInput = -p.z; // Depth

      // 1. Rotate around Y axis (azimuth / horizontal)
      const cosY = Math.cos(rotationY);
      const sinY = Math.sin(rotationY);
      const rX = xInput * cosY - zInput * sinY;
      const rZ1 = xInput * sinY + zInput * cosY;

      // 2. Rotate around X axis (elevation / vertical pitch)
      const cosX = Math.cos(rotationX);
      const sinX = Math.sin(rotationX);
      const rY = rInputY(yInput, rZ1, cosX, sinX);
      const rZ = rInputZ(yInput, rZ1, cosX, sinX);

      // Project onto 2D viewport
      const screenX = centerX + rX * zoom;
      const screenY = centerY - rY * zoom; // subtract because Canvas Y is down

      projectedPoints[p.id] = {
        id: p.id,
        name: p.name,
        raw: { x: p.x, y: p.y, z: p.z },
        projX: rX,
        projY: rY,
        projZ: rZ,
        screenX,
        screenY,
        visibility: p.visibility ?? 1.0,
      };
    });

    function rInputY(y: number, z: number, c: number, s: number) {
      return y * c - z * s;
    }
    function rInputZ(y: number, z: number, c: number, s: number) {
      return y * s + z * c;
    }

    // DRAW SKELETON CONNECTIONS OR ROBLOX RIGS
    if (rigType === "R15" || rigType === "R6") {
      const lSh = projectedPoints[11];
      const rSh = projectedPoints[12];
      const lHp = projectedPoints[23];
      const rHp = projectedPoints[24];

      const drawLimb = (p1Id: number, p2Id: number, name: string, color: string, wFactor: number = 0.1) => {
        const p1 = projectedPoints[p1Id];
        const p2 = projectedPoints[p2Id];
        if (!p1 || !p2 || p1.visibility < 0.35 || p2.visibility < 0.35) return;

        const cx = (p1.screenX + p2.screenX) / 2;
        const cy = (p1.screenY + p2.screenY) / 2;
        const dx = p2.screenX - p1.screenX;
        const dy = p2.screenY - p1.screenY;
        const len = Math.sqrt(dx * dx + dy * dy);
        const angle = Math.atan2(dy, dx);

        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(angle);

        const boxWidth = len;
        const boxHeight = Math.max(10, zoom * wFactor);

        ctx.fillStyle = color;
        ctx.strokeStyle = "#475569";
        ctx.lineWidth = 1.5;
        ctx.fillRect(-boxWidth / 2, -boxHeight / 2, boxWidth, boxHeight);
        ctx.strokeRect(-boxWidth / 2, -boxHeight / 2, boxWidth, boxHeight);
        ctx.restore();

        if (showLabels) {
          ctx.fillStyle = "#94a3b8";
          ctx.font = "8px monospace";
          ctx.textAlign = "center";
          ctx.fillText(name, cx, cy - boxHeight/2 - 2);
        }
      };

      // Draw Hips & Torso & Head
      if (lSh && rSh && lHp && rHp) {
        const neckX = (lSh.screenX + rSh.screenX) / 2;
        const neckY = (lSh.screenY + rSh.screenY) / 2;

        const shoulderDist = Math.sqrt(Math.pow(rSh.screenX - lSh.screenX, 2) + Math.pow(rSh.screenY - lSh.screenY, 2));
        const headSz = Math.max(20, shoulderDist * 0.45);

        // Draw Roblox Head Block
        ctx.fillStyle = "#fef08a"; // BrickYellow styled color for classical head
        ctx.strokeStyle = "#475569";
        ctx.lineWidth = 2;
        ctx.fillRect(neckX - headSz / 2, neckY - headSz * 1.25, headSz, headSz);
        ctx.strokeRect(neckX - headSz / 2, neckY - headSz * 1.25, headSz, headSz);

        if (showLabels) {
          ctx.fillStyle = "#e2e8f0";
          ctx.font = "8px monospace";
          ctx.textAlign = "center";
          ctx.fillText("Head", neckX, neckY - headSz * 1.35);
        }

        if (rigType === "R15") {
          // R15 Torso blocks (Upper & Lower)
          const waistLX = lSh.screenX * 0.45 + lHp.screenX * 0.55;
          const waistLY = lSh.screenY * 0.45 + lHp.screenY * 0.55;
          const waistRX = rSh.screenX * 0.45 + rHp.screenX * 0.55;
          const waistRY = rSh.screenY * 0.45 + rHp.screenY * 0.55;

          // Upper Torso
          ctx.beginPath();
          ctx.moveTo(lSh.screenX, lSh.screenY);
          ctx.lineTo(rSh.screenX, rSh.screenY);
          ctx.lineTo(waistRX, waistRY);
          ctx.lineTo(waistLX, waistLY);
          ctx.closePath();
          ctx.fillStyle = "#38bdf8"; // Bright sky blue style
          ctx.strokeStyle = "#0284c7";
          ctx.lineWidth = 2;
          ctx.fill();
          ctx.stroke();

          // Lower Torso
          ctx.beginPath();
          ctx.moveTo(waistLX, waistLY);
          ctx.lineTo(waistRX, waistRY);
          ctx.lineTo(rHp.screenX, rHp.screenY);
          ctx.lineTo(lHp.screenX, lHp.screenY);
          ctx.closePath();
          ctx.fillStyle = "#0284c7";
          ctx.strokeStyle = "#0369a1";
          ctx.lineWidth = 2;
          ctx.fill();
          ctx.stroke();

          // Draw R15 Limbs
          // Arms
          drawLimb(11, 13, "L_UpperArm", "#38bdf8", 0.08);
          drawLimb(13, 15, "L_LowerArm", "#fef08a", 0.07);
          drawLimb(12, 14, "R_UpperArm", "#38bdf8", 0.08);
          drawLimb(14, 16, "R_LowerArm", "#fef08a", 0.07);
          
          // Legs
          drawLimb(23, 25, "L_UpperLeg", "#1e293b", 0.09);
          drawLimb(25, 27, "L_LowerLeg", "#334155", 0.08);
          drawLimb(24, 26, "R_UpperLeg", "#1e293b", 0.09);
          drawLimb(26, 28, "R_LowerLeg", "#334155", 0.08);
        } else {
          // R6 Torso
          ctx.beginPath();
          ctx.moveTo(lSh.screenX, lSh.screenY);
          ctx.lineTo(rSh.screenX, rSh.screenY);
          ctx.lineTo(rHp.screenX, rHp.screenY);
          ctx.lineTo(lHp.screenX, lHp.screenY);
          ctx.closePath();
          ctx.fillStyle = "#0284c7"; // LightBlue/Teal R6 standard
          ctx.strokeStyle = "#014d7c";
          ctx.lineWidth = 2.5;
          ctx.fill();
          ctx.stroke();

          // Draw R6 Limbs (Direct shoulder-to-wrist and hip-to-ankle joints)
          drawLimb(11, 15, "Left Arm", "#fef08a", 0.091);
          drawLimb(12, 16, "Right Arm", "#fef08a", 0.091);
          drawLimb(23, 27, "Left Leg", "#1e293b", 0.1);
          drawLimb(24, 28, "Right Leg", "#1e293b", 0.1);
        }
      }
    } else {
      // DRAW CONNECTIONS (Bones)
      SKELETON_CONNECTIONS.forEach(([p1_id, p2_id, type]) => {
        const p1 = projectedPoints[p1_id];
        const p2 = projectedPoints[p2_id];

        if (!p1 || !p2) return;

        // Only draw if landmarks have decent visibility
        if (p1.visibility < 0.4 || p2.visibility < 0.4) return;

        // Choose limb colors
        let strokeColor = "#10b981"; // Emerald-500 (Center / Torso)
        if (type.startsWith("left_")) {
          strokeColor = "#3b82f6"; // Blue-500 (Left limbs)
        } else if (type.startsWith("right_")) {
          strokeColor = "#ef4444"; // Red-500 (Right limbs)
        } else if (type.endsWith("hand")) {
          strokeColor = type.startsWith("left") ? "#60a5fa" : "#f87171";
        } else if (type.endsWith("foot")) {
          strokeColor = type.startsWith("left") ? "#60a5fa" : "#f87171";
        } else if (type === "face") {
          strokeColor = "#f59e0b"; // Orange-500
        }

        ctx.beginPath();
        ctx.moveTo(p1.screenX, p1.screenY);
        ctx.lineTo(p2.screenX, p2.screenY);

        // Simple depth cue: line width based on depth
        const avgZ = (p1.projZ + p2.projZ) / 2;
        const thickness = Math.max(1, Math.min(8, 4 + avgZ * 2.5));
        
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = thickness;
        ctx.lineCap = "round";
        ctx.stroke();
      });

      // DRAW JOINTS (Nodes)
      Object.values(projectedPoints).forEach((p) => {
        if (p.visibility < 0.4) return;

        ctx.beginPath();
        ctx.arc(p.screenX, p.screenY, Math.max(3, 4.5 + p.projZ * 1.5), 0, 2 * Math.PI);
        
        // Highlight core tracking points with deep contrast
        ctx.fillStyle = "#ffffff";
        ctx.strokeStyle = "#1e293b";
        ctx.lineWidth = 1.5;
        ctx.fill();
        ctx.stroke();

        // Show Joint Labels if toggled
        if (showLabels && p.visibility > 0.6) {
          ctx.fillStyle = "#94a3b8"; // Slate-400
          ctx.font = "8px font-sans, sans-serif";
          ctx.textAlign = "left";
          ctx.textBaseline = "middle";
          ctx.fillText(` ${p.name}`, p.screenX + 5, p.screenY);
        }
      });
    }

    // Draw origin indicator
    ctx.beginPath();
    ctx.arc(centerX, centerY, 3, 0, 2 * Math.PI);
    ctx.fillStyle = "#ef4444";
    ctx.fill();

  }, [landmarks, rotationX, rotationY, zoom, showLabels, rigType]);

  // Renders a simple, clean grid floor representation in orthographic space
  const drawGridFloor = (
    ctx: CanvasRenderingContext2D,
    centerX: number,
    centerY: number,
    width: number,
    height: number
  ) => {
    ctx.beginPath();
    ctx.strokeStyle = "#334155"; // Slate-700
    ctx.lineWidth = 1;

    const gridSize = 1.5; // Size of floor grid in meters
    const gridCount = 5; // grid cells
    const spacing = 0.3; // 30cm spacing

    for (let i = -gridCount; i <= gridCount; i++) {
      const linePos = i * spacing;

      // Parallel grid lines along Z (front to back)
      let p1_x = -gridSize;
      let p1_z = linePos;
      let p2_x = gridSize;
      let p2_z = linePos;

      // Let's project p1 & p2 on the screen at Y = -0.9m (ground level / feet)
      const groundY = -0.95; // approx feet position relative to hips 0.0

      // Compute projections
      const projP1 = project3DPoint(p1_x, groundY, p1_z);
      const projP2 = project3DPoint(p2_x, groundY, p2_z);

      ctx.moveTo(centerX + projP1.x * zoom, centerY - projP1.y * zoom);
      ctx.lineTo(centerX + projP2.x * zoom, centerY - projP2.y * zoom);

      // Orthogonal grid lines along X
      const q1_x = linePos;
      const q1_z = -gridSize;
      const q2_x = linePos;
      const q2_z = gridSize;

      const projQ1 = project3DPoint(q1_x, groundY, q1_z);
      const projQ2 = project3DPoint(q2_x, groundY, q2_z);

      ctx.moveTo(centerX + projQ1.x * zoom, centerY - projQ1.y * zoom);
      ctx.lineTo(centerX + projQ2.x * zoom, centerY - projQ2.y * zoom);
    }
    ctx.stroke();

    // 3D coordinate project helper
    function project3DPoint(x: number, y: number, z: number) {
      const cosY = Math.cos(rotationY);
      const sinY = Math.sin(rotationY);
      const rX = x * cosY - z * sinY;
      const rZ = x * sinY + z * cosY;

      const cosX = Math.cos(rotationX);
      const sinX = Math.sin(rotationX);
      const rY = y * cosX - rZ * sinX;

      return { x: rX, y: rY };
    }
  };

  return (
    <div className="relative rounded-2xl overflow-hidden shadow-2xl border border-slate-800 bg-slate-900 group" id="skeleton-3d-preview">
      {/* 3D Canvas rendering */}
      <canvas
        ref={canvasRef}
        width={480}
        height={height}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUpOrLeave}
        onMouseLeave={handleMouseUpOrLeave}
        onWheel={handleWheel}
        className="w-full h-auto block cursor-all-scroll select-none"
        style={{ height: `${height}px` }}
      />

      {/* Control overlay */}
      <div className="absolute top-3 left-3 flex items-center justify-between pointer-events-none w-[94%]" id="viewport-overlay-controls">
        <span className="bg-slate-950/80 backdrop-blur-md text-slate-400 font-mono text-[10px] px-2 py-1 rounded border border-slate-800 flex items-center gap-1">
          <Rotate3d className="w-3.5 h-3.5 text-indigo-400" />
          Drag to Orbit / Wheel to Zoom
        </span>
        
        <div className="flex gap-1.5 pointer-events-auto">
          <button
            onClick={() => setZoom((z) => Math.min(500, z + 25))}
            title="Zoom In"
            className="p-1.5 bg-slate-950/80 hover:bg-slate-900 duration-150 backdrop-blur-sm text-slate-400 hover:text-white rounded border border-slate-800 cursor-pointer"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setZoom((z) => Math.max(50, z - 25))}
            title="Zoom Out"
            className="p-1.5 bg-slate-950/80 hover:bg-slate-900 duration-150 backdrop-blur-sm text-slate-400 hover:text-white rounded border border-slate-800 cursor-pointer"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={resetView}
            title="Reset Viewport"
            className="p-1.5 bg-slate-950/80 hover:bg-slate-900 duration-150 backdrop-blur-sm text-slate-400 hover:text-white rounded border border-slate-800 cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Axis Guide (Z-Up coordinate space indicator) */}
      <div className="absolute bottom-3 left-3 font-mono text-[9px] text-slate-500 bg-slate-950/40 px-2 py-1 rounded border border-slate-800/40 flex items-center gap-2 select-none" id="mocap-axis-indicator">
        <span className="flex items-center gap-0.5"><span className="w-1.5 h-1.5 rounded-full bg-red-500 inline-block"></span>X (Sol/Sağ)</span>
        <span className="flex items-center gap-0.5"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block"></span>Z (Yükseklik)</span>
        <span className="flex items-center gap-0.5"><span className="w-1.5 h-1.5 rounded-full bg-blue-500 inline-block"></span>Y (Derinlik)</span>
      </div>
    </div>
  );
}
