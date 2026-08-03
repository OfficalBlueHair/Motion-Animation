/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { MoCapSession } from "../types";

/**
 * Generates a clean Roblox Studio Lua import script for R15 / R6 characters.
 * This runs directly in the Roblox Studio Command Bar or a Server Script.
 */
export function generateRobloxStudioLuaScript(session: MoCapSession, rigType: "R15" | "R6" = "R15"): string {
  // We filter out facial landmarks to minimize footprint and keep only key body joints.
  // Standard MediaPipe Key Landmarks needed for body animation:
  // 11: L_Shoulder, 12: R_Shoulder, 13: L_Elbow, 14: R_Elbow, 15: L_Wrist, 16: R_Wrist
  // 23: L_Hip, 24: R_Hip, 25: L_Knee, 26: R_Knee, 27: L_Ankle, 28: R_Ankle, 0: Nose (for neck)
  const requiredIds = [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];

  // Roblox interpolates seamlessly between keyframes.
  // Adjusting downsample helps keep characters down to Roblox command bar memory limits (approx 10-12 FPS).
  const targetFPS = 11;
  const sourceFPS = session.fps || 15;
  const sampleStep = Math.max(1, Math.round(sourceFPS / targetFPS));

  const luaFramesList: string[] = [];
  session.frames.forEach((frame, idx) => {
    if (idx % sampleStep !== 0) return;

    const landmarksList: string[] = [];
    frame.worldLandmarks.forEach((lw) => {
      if (requiredIds.includes(lw.id)) {
        // Negate coordinates to match Roblox workspace orientation (X/Y up, Z depth)
        const rx = parseFloat((-lw.x).toFixed(3));
        const ry = parseFloat((-lw.y).toFixed(3));
        const rz = parseFloat((-lw.z).toFixed(3));
        landmarksList.push(`["${lw.id}"]=Vector3.new(${rx},${ry},${rz})`);
      }
    });

    const t = parseFloat(frame.timestamp.toFixed(3));
    luaFramesList.push(`{t=${t},l={${landmarksList.join(",")}}}`);
  });

  const framesTableString = `{\n\t${luaFramesList.join(",\n\t")}\n}`;

  return `-- =========================================================================
-- ROBLOX STUDIO MOCAP ANİMASYON YÜKLEME BETİĞİ (${rigType})
-- =========================================================================
-- Bu betik, web kamerası MoCap hareketlerinizi doğrudan Roblox karakterinize 
-- aktarmak için tasarlanmıştır. Cihazınızda dosya indirme/Blender adımı gerektirmez!
--
-- Talimatlar (EN SAĞLIKLI YOL):
-- 1. Roblox Studio'da bir proje açın (Türkçe veya İngilizce).
-- 2. "Rig Builder" (Karakter Oluşturucu) ile bir R15 veya R6 rigi oluşturun.
-- 3. Workspace (Arayüzde "Gezgin") altında Rig modelini "+" simgesine tıklayıp yeni bir "Script" oluşturun.
-- 4. Bu kopyaladığınız Lua kodunun tamamını oluşturduğunuz Script içerisine yapıştırın.
-- 5. Studio'daki "Oynat/Çalıştır" (Run/Play) butonuna basarak projeyi başlatın veya test edin. 
-- 6. Rig altında saniyeler içinde "MocapAnimation" (KeyframeSequence) oluşacaktır.
-- 7. Keyframe'i kaydettikten sonra bu Script'i silebilirsiniz.
-- =========================================================================

local Workspace = game:GetService("Workspace")

local rigType = "${rigType}"
local fps = ${session.fps}

-- 1. Karakteri bulmaya çalışalım (Eğer script karakterin içindeyse, script.Parent karakterdir!)
local character = nil

if script and script.Parent and script.Parent:IsA("Model") and script.Parent:FindFirstChildOfClass("Humanoid") then
	character = script.Parent
end

-- 2. Eğer script içinde değilsek (örn. Command Bar) veya yukarıdaki bulamadıysa Selection kullan
if not character then
	local success, Selection = pcall(function() return game:GetService("Selection") end)
	if success and Selection then
		local selectedObjects = Selection:Get()
		if selectedObjects and selectedObjects[1] and selectedObjects[1]:IsA("Model") and selectedObjects[1]:FindFirstChildOfClass("Humanoid") then
			character = selectedObjects[1]
		end
	end
end

-- 3. Hâlâ bulamadıysa, Workspace'teki ilk Humanoid barındıran modeli ("Rig", "Dummy" vb.) bulmaya çalışalım
if not character then
	-- Yaygın isimlere öncelik ver
	character = Workspace:FindFirstChild("Rig") or Workspace:FindFirstChild("Dummy")
	
	if not character or not character:FindFirstChildOfClass("Humanoid") then
		character = nil
		-- Workspace altındaki çocukları tara ve ilk Humanoid barındıran modeli seç
		for _, child in ipairs(Workspace:GetChildren()) do
			if child:IsA("Model") and child:FindFirstChildOfClass("Humanoid") then
				character = child
				break
			end
		end
	end
end

if not character then
	error("Hata: Karakter modeli bulunamadı! Lütfen kopyaladığınız kodu içeren Script nesnesini Rig modelinizin (karakterinizin) içine yerleştirin.")
end

local humanoid = character:FindFirstChildOfClass("Humanoid")
if rigType == "R15" and humanoid.RigType ~= Enum.HumanoidRigType.R15 then
	warn("Uyarı: Karakter R15 değil ama R15 animasyonu yükleniyor!")
elseif rigType == "R6" and humanoid.RigType ~= Enum.HumanoidRigType.R6 then
	warn("Uyarı: Karakter R6 değil ama R6 animasyonu yükleniyor!")
end

print("Bağlanıyor: " .. character.Name .. " için MoCap animasyonu oluşturuluyor...")

-- Ham MoCap Verisi (Saf Lua tablosu olarak işlenir - HttpService veya JSON limiti yoktur)
local frames = ${framesTableString}

-- V1 yönünü V2 yönüyle hizalayan rotasyonu hesaplar (Alignment helper)
local function getRotationBetweenVectors(v1, v2)
	local axis = v1:Cross(v2)
	local dot = v1:Dot(v2)
	if dot < -0.9999 then
		return CFrame.fromAxisAngle(Vector3.new(1,0,0), math.pi)
	end
	local angle = math.acos(dot)
	if axis.Magnitude > 0.0001 then
		return CFrame.fromAxisAngle(axis.Unit, angle)
	else
		return CFrame.new()
	end
end

-- KeyframeSequence oluştur
local keyframeSequence = Instance.new("KeyframeSequence")
keyframeSequence.Name = "${session.name.replace(/[^a-zA-Z0-9 ]/g, "")}_RobloxMocap"
keyframeSequence.Loop = true

-- Karakter modelinin kemik ve mafsal hiyerarşisini kurar
local function createPoseTree(rigType)
	local rootPose = Instance.new("Pose")
	rootPose.Name = "HumanoidRootPart"
	
	if rigType == "R15" then
		local lowerTorso = Instance.new("Pose")
		lowerTorso.Name = "LowerTorso"
		rootPose:AddChild(lowerTorso)
		
		local upperTorso = Instance.new("Pose")
		upperTorso.Name = "UpperTorso"
		lowerTorso:AddChild(upperTorso)
		
		local head = Instance.new("Pose")
		head.Name = "Head"
		upperTorso:AddChild(head)
		
		-- Arm poses
		local lUpperArm = Instance.new("Pose")
		lUpperArm.Name = "LeftUpperArm"
		upperTorso:AddChild(lUpperArm)
		local lLowerArm = Instance.new("Pose")
		lLowerArm.Name = "LeftLowerArm"
		lUpperArm:AddChild(lLowerArm)
		local lHand = Instance.new("Pose")
		lHand.Name = "LeftHand"
		lLowerArm:AddChild(lHand)
		
		local rUpperArm = Instance.new("Pose")
		rUpperArm.Name = "RightUpperArm"
		upperTorso:AddChild(rUpperArm)
		local rLowerArm = Instance.new("Pose")
		rLowerArm.Name = "RightLowerArm"
		rUpperArm:AddChild(rLowerArm)
		local rHand = Instance.new("Pose")
		rHand.Name = "RightHand"
		rLowerArm:AddChild(rHand)
		
		-- Leg poses
		local lUpperLeg = Instance.new("Pose")
		lUpperLeg.Name = "LeftUpperLeg"
		lowerTorso:AddChild(lUpperLeg)
		local lLowerLeg = Instance.new("Pose")
		lLowerLeg.Name = "LeftLowerLeg"
		lUpperLeg:AddChild(lLowerLeg)
		local lFoot = Instance.new("Pose")
		lFoot.Name = "LeftFoot"
		lLowerLeg:AddChild(lFoot)
		
		local rUpperLeg = Instance.new("Pose")
		rUpperLeg.Name = "RightUpperLeg"
		lowerTorso:AddChild(rUpperLeg)
		local rLowerLeg = Instance.new("Pose")
		rLowerLeg.Name = "RightLowerLeg"
		rUpperLeg:AddChild(rLowerLeg)
		local rFoot = Instance.new("Pose")
		rFoot.Name = "RightFoot"
		rLowerLeg:AddChild(rFoot)
		
	else -- R6 Rig representation
		local torso = Instance.new("Pose")
		torso.Name = "Torso"
		rootPose:AddChild(torso)
		
		local head = Instance.new("Pose")
		head.Name = "Head"
		torso:AddChild(head)
		
		local lArm = Instance.new("Pose")
		lArm.Name = "Left Arm"
		torso:AddChild(lArm)
		
		local rArm = Instance.new("Pose")
		rArm.Name = "Right Arm"
		torso:AddChild(rArm)
		
		local lLeg = Instance.new("Pose")
		lLeg.Name = "Left Leg"
		torso:AddChild(lLeg)
		
		local rLeg = Instance.new("Pose")
		rLeg.Name = "Right Leg"
		torso:AddChild(rLeg)
	end
	
	return rootPose
end

-- Pose nesnesi bulucu yardımcı
local function findPoseInTree(parentPose, name)
	if parentPose.Name == name then return parentPose end
	for _, child in ipairs(parentPose:GetChildren()) do
		local found = findPoseInTree(child, name)
		if found then return found end
	end
	return nil
end

-- Top-level scale multiplier to match Roblox standards (studs coordinate system)
local SCALE_MULTIPLIER = 5.0

-- Create keys
for idx, fData in ipairs(frames) do
	local keyframe = Instance.new("Keyframe")
	keyframe.Time = fData.t
	keyframe.Name = "Frame_" .. idx
	
	local rootPose = createPoseTree(rigType)
	rootPose.Parent = keyframe
	
	local pt = fData.l
	
	-- Helper vectors conversion
	local function getVector(id)
		return pt[tostring(id)]
	end
	
	-- Load positions
	local nose = getVector(0)
	local lShoulder = getVector(11)
	local rShoulder = getVector(12)
	local lElbow = getVector(13)
	local rElbow = getVector(14)
	local lWrist = getVector(15)
	local rWrist = getVector(16)
	local lHip = getVector(23)
	local rHip = getVector(24)
	local lKnee = getVector(25)
	local rKnee = getVector(26)
	local lAnkle = getVector(27)
	local rAnkle = getVector(28)
	
	if lHip and rHip then
		-- Hips position (lowerTorso or Torso)
		local hipCenter = (lHip + rHip) / 2
		
		-- Root placement offset scaling (offset relative to floor)
		local rootPoseObj = findPoseInTree(rootPose, (rigType == "R15" and "LowerTorso" or "Torso"))
		if rootPoseObj then
			-- Set position
			rootPoseObj.CFrame = CFrame.new(Vector3.new(hipCenter.X, hipCenter.Y + 1.2, hipCenter.Z) * SCALE_MULTIPLIER)
		end
		
		-- ANIMATE R15 BONES
		if rigType == "R15" then
			-- Standard Rest orientation vectors for Roblox limbs (Roblox limbs hang straight down by default)
			local defaultDown = Vector3.new(0, -1, 0)
			
			-- UpperTorso (Lean vector)
			local shoulderCenter = (lShoulder + rShoulder) / 2
			local spineDir = (shoulderCenter - hipCenter).Unit
			local utPose = findPoseInTree(rootPose, "UpperTorso")
			if utPose then
				utPose.CFrame = getRotationBetweenVectors(Vector3.new(0, 1, 0), spineDir)
			end
			
			-- Left arm Joints
			if lShoulder and lElbow then
				local armDir = (lElbow - lShoulder).Unit
				local luaPose = findPoseInTree(rootPose, "LeftUpperArm")
				if luaPose then
					luaPose.CFrame = getRotationBetweenVectors(defaultDown, armDir)
				end
				
				if lWrist then
					local lowerArmDir = (lWrist - lElbow).Unit
					local llaPose = findPoseInTree(rootPose, "LeftLowerArm")
					if llaPose then
						-- Relative to upper arm, find relative direction
						llaPose.CFrame = getRotationBetweenVectors(defaultDown, lowerArmDir)
					end
				end
			end
			
			-- Right arm Joints
			if rShoulder and rElbow then
				local armDir = (rElbow - rShoulder).Unit
				local ruaPose = findPoseInTree(rootPose, "RightUpperArm")
				if ruaPose then
					ruaPose.CFrame = getRotationBetweenVectors(defaultDown, armDir)
				end
				
				if rWrist then
					local lowerArmDir = (rWrist - rElbow).Unit
					local rlaPose = findPoseInTree(rootPose, "RightLowerArm")
					if rlaPose then
						rlaPose.CFrame = getRotationBetweenVectors(defaultDown, lowerArmDir)
					end
				end
			end
			
			-- Left Leg Joints
			if lHip and lKnee then
				local legDir = (lKnee - lHip).Unit
				local lulPose = findPoseInTree(rootPose, "LeftUpperLeg")
				if lulPose then
					lulPose.CFrame = getRotationBetweenVectors(defaultDown, legDir)
				end
				
				if lAnkle then
					local lowerLegDir = (lAnkle - lKnee).Unit
					local lllPose = findPoseInTree(rootPose, "LeftLowerLeg")
					if lllPose then
						lllPose.CFrame = getRotationBetweenVectors(defaultDown, lowerLegDir)
					end
				end
			end
			
			-- Right Leg Joints
			if rHip and rKnee then
				local legDir = (rKnee - rHip).Unit
				local rulPose = findPoseInTree(rootPose, "RightUpperLeg")
				if rulPose then
					rulPose.CFrame = getRotationBetweenVectors(defaultDown, legDir)
				end
				
				if rAnkle then
					local lowerLegDir = (rAnkle - rKnee).Unit
					local rllPose = findPoseInTree(rootPose, "RightLowerLeg")
					if rllPose then
						rllPose.CFrame = getRotationBetweenVectors(defaultDown, lowerLegDir)
					end
				end
			end
			
			-- Head (relative neck tilt to shoulder center)
			if nose then
				local neckDir = (nose - shoulderCenter).Unit
				local headPose = findPoseInTree(rootPose, "Head")
				if headPose then
					headPose.CFrame = getRotationBetweenVectors(Vector3.new(0, 1, 0), neckDir)
				end
			end
			
		else -- ANIMATE R6 BONES
			local defaultDown = Vector3.new(0, -1, 0)
			
			-- Left arm (Shoulder to Wrist)
			if lShoulder and lWrist then
				local armDir = (lWrist - lShoulder).Unit
				local laPose = findPoseInTree(rootPose, "Left Arm")
				if laPose then
					laPose.CFrame = getRotationBetweenVectors(defaultDown, armDir)
				end
			end
			
			-- Right arm
			if rShoulder and rWrist then
				local armDir = (rWrist - rShoulder).Unit
				local raPose = findPoseInTree(rootPose, "Right Arm")
				if raPose then
					raPose.CFrame = getRotationBetweenVectors(defaultDown, armDir)
				end
			end
			
			-- Left Leg (Hip to Ankle)
			if lHip and lAnkle then
				local legDir = (lAnkle - lHip).Unit
				local llPose = findPoseInTree(rootPose, "Left Leg")
				if llPose then
					llPose.CFrame = getRotationBetweenVectors(defaultDown, legDir)
				end
			end
			
			-- Right Leg
			if rHip and rAnkle then
				local legDir = (rAnkle - rHip).Unit
				local rlPose = findPoseInTree(rootPose, "Right Leg")
				if rlPose then
					rlPose.CFrame = getRotationBetweenVectors(defaultDown, legDir)
				end
			end
			
			-- Head
			if nose then
				local shoulderCenter = (lShoulder + rShoulder) / 2
				local neckDir = (nose - shoulderCenter).Unit
				local headPose = findPoseInTree(rootPose, "Head")
				if headPose then
					headPose.CFrame = getRotationBetweenVectors(Vector3.new(0, 1, 0), neckDir)
				end
			end
		end
	end
	
	keyframeSequence:AddKeyframe(keyframe)
end

-- Save inside selected rig
keyframeSequence.Parent = character
Selection:Set({keyframeSequence})

print("Başarılı! '" .. keyframeSequence.Name .. "' animasyon hiyerarşisi '" .. character.Name .. "' içerisine yüklendi.")
print("Bunu kaydetmek için karakter altındaki '" .. keyframeSequence.Name .. "' nesnesine SAĞ tıklayın ve 'Save to Roblox...' (Roblox'a Kaydet) seçeneğini kullanın.")
`;
}
