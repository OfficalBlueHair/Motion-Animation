/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { MoCapSession } from "../types";

/**
 * Helper to compact session frames down to only the essential joints needed for rigging.
 * This makes the generated Blender Python script extremely compact and easy to paste.
 */
function getCompactFrameDataPython(session: MoCapSession): string {
  // Required body joints:
  // 0: Nose (Head), 11: L_Shoulder, 12: R_Shoulder, 13: L_Elbow, 14: R_Elbow, 15: L_Wrist, 16: R_Wrist
  // 23: L_Hip, 24: R_Hip, 25: L_Knee, 26: R_Knee, 27: L_Ankle, 28: R_Ankle
  const neededJoints = [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];
  
  const pyFrames: string[] = [];
  session.frames.forEach((frame) => {
    const fIdx = frame.frameIndex;
    const jointsDict: string[] = [];
    frame.worldLandmarks.forEach((lw) => {
      if (neededJoints.includes(lw.id)) {
        // limit coordinates to 4 decimal points for compactness and precision
        jointsDict.push(`"${lw.id}": (${lw.x.toFixed(4)}, ${lw.y.toFixed(4)}, ${lw.z.toFixed(4)})`);
      }
    });
    pyFrames.push(`    {"f": ${fIdx}, "p": {${jointsDict.join(", ")}}}`);
  });
  
  return `[\n${pyFrames.join(",\n")}\n]`;
}

/**
 * Generates a clean, fully-commented Python script for Blender to import
 * the recorded MediaPipe landmarks and animate Blender 'Empty' objects.
 */
export function generateBlenderImportScript(session: MoCapSession, jsonFilename: string = "recorded_landmarks.json"): string {
  return `import bpy
import json
import os

# =========================================================================
# MEDIAPIPE TO BLENDER MOCAP IMPORT SCRIPT
# =========================================================================
# This script imports recorded 3D skeleton points (mocap) from MediaPipe
# and animates Empty objects in Blender. You can then use Blender's constraints
# (like Copy Location, Copy Rotation, or IK) to bind these Empties to your character rig's bones.
#
# Instructions:
# 1. Download your recorded JSON file: "${jsonFilename}"
# 2. Open Blender, switch to the "Scripting" workspace, and click "New" to create a new script.
# 3. Paste this script into Blender's text editor.
# 4. Set the 'FILE_PATH' variable below to where your JSON file is saved.
# 5. Click the "Play/Run Script" button in Blender's editor header.
# =========================================================================

# --- CONFIGURATION ---
# UPDATE THIS PATH to point to your downloaded JSON file:
FILE_PATH = r"/${jsonFilename}"

# Adjust scale factor (MediaPipe is in meters, so scale=1.0 is real-world scale)
SCALE_FACTOR = 1.0

# Frame rate of your Blender project (highly recommended to match or clamp)
TARGET_FPS = ${session.fps}

# Clean previous imports? (True will delete previously imported Empties before importing)
CLEAN_PREVIOUS = True

# -------------------------------------------------------------------------

def import_mocap():
    # 1. Check if the file exists
    if not os.path.exists(FILE_PATH):
        # Fallback to current blender directory or temp directory
        print(f"Error: Specified file not found at: {FILE_PATH}")
        print("Please edit the FILE_PATH variable at the top of the script with the exact path!")
        return False
        
    print(f"Loading motion capture data from {FILE_PATH}...")
    
    with open(FILE_PATH, 'r') as f:
        data = json.load(f)
        
    metadata = data.get("metadata", {})
    frames_data = data.get("frames", [])
    
    print(f"Importer found {len(frames_data)} frames of animation.")
    if not frames_data:
        print("Error: No frame data found in the JSON file.")
        return False
        
    # Set Scene FPS to match the recording
    bpy.context.scene.render.fps = TARGET_FPS
    
    # Create or find the Collection to organize Empties
    collection_name = "MediaPipe_MoCap"
    if collection_name in bpy.data.collections:
        mocap_collection = bpy.data.collections[collection_name]
    else:
        mocap_collection = bpy.data.collections.new(collection_name)
        bpy.context.scene.collection.children.link(mocap_collection)
        
    # Clean previous empties if configured
    if CLEAN_PREVIOUS:
        bpy.ops.object.select_all(action='DESELECT')
        # Find and unlink existing mocap Empties
        for obj in list(mocap_collection.objects):
            bpy.data.objects.remove(obj, do_unlink=True)
            
    # List of all landmark names to create
    # Standard MediaPipe names
    landmark_names = [
        "NOSE", "LEFT_EYE_INNER", "LEFT_EYE", "LEFT_EYE_OUTER",
        "RIGHT_EYE_INNER", "RIGHT_EYE", "RIGHT_EYE_OUTER",
        "LEFT_EAR", "RIGHT_EAR", "MOUTH_LEFT", "MOUTH_RIGHT",
        "LEFT_SHOULDER", "RIGHT_SHOULDER", "LEFT_ELBOW", "RIGHT_ELBOW",
        "LEFT_WRIST", "RIGHT_WRIST", "LEFT_PINKY", "RIGHT_PINKY",
        "LEFT_INDEX", "RIGHT_INDEX", "LEFT_THUMB", "RIGHT_THUMB",
        "LEFT_HIP", "RIGHT_HIP", "LEFT_KNEE", "RIGHT_KNEE",
        "LEFT_ANKLE", "RIGHT_ANKLE", "LEFT_HEEL", "RIGHT_HEEL",
        "LEFT_FOOT_INDEX", "RIGHT_FOOT_INDEX"
    ]
    
    # Create empty object for each joint
    empties = {}
    for name in landmark_names:
        # Create a plain axes Empty for lightweight rendering
        empty_obj = bpy.data.objects.new(f"mp_{name}", None)
        empty_obj.empty_display_type = 'PLAIN_AXES'
        empty_obj.empty_display_size = 0.1
        
        # Link to collection
        mocap_collection.objects.link(empty_obj)
        empties[name] = empty_obj
        
    # Enable autokeyframing backup
    original_frame = bpy.context.scene.frame_current
    
    # 2. Iterate through each frame and apply positioning
    for f_idx, frame in enumerate(frames_data):
        blender_frame = frame.get("frameIndex", f_idx) + 1 # Blender frames start at 1
        world_landmarks = frame.get("worldLandmarks", [])
        
        for lw in world_landmarks:
            name = lw.get("name")
            if name not in empties:
                continue
                
            empty_obj = empties[name]
            
            # --- Coordinate System Transform ---
            # MediaPipe Worldspace:
            # - X: points left (of the actor's perspective) -> map to Blender X (negated for screen correspondence)
            # - Y: points down -> map to Blender Z (negated, since Blender +Z is UP)
            # - Z: points forward/depth -> map to Blender Y (negated, since Blender +Y is depth/forward)
            
            mp_x = lw.get("x", 0)
            mp_y = lw.get("y", 0)
            mp_z = lw.get("z", 0)
            
            # Convert to Blender Space
            bx = -mp_x * SCALE_FACTOR
            by = -mp_z * SCALE_FACTOR
            bz = -mp_y * SCALE_FACTOR
            
            # Set location
            empty_obj.location = (bx, by, bz)
            
            # Insert scale animation keyframe
            empty_obj.keyframe_insert(data_path="location", frame=blender_frame)
            
    # Return to original frame
    bpy.context.scene.frame_current = original_frame
    print("Mocap import completed successfully! Check the 'MediaPipe_MoCap' collection.")
    return True

# Run the importer
import_mocap()
`;
}

/**
 * Generates an embedded python script specifically designed to animate a Roblox R15 model in Blender
 * without requiring NumPy or external file configurations.
 */
export function generateBlenderRobloxR15Script(session: MoCapSession, jsonFilename: string = "recorded_landmarks.json"): string {
  const compactData = getCompactFrameDataPython(session);
  return `import bpy
import json
import os

# =========================================================================
# BLENDER HUMAN SKELETON R15 PROSERÜREL RIG VE MOCAP AKTARICI (Jitter & Flip Korumalı)
# =========================================================================
# Bu gelişmiş MoCap betiği, MediaPipe verilerini Blender insan iskeletine aktarır.
#
# ÖZELLİKLER:
# 1. Pürüzsüzleştirme Filtresi (Smoothing Filter): Titremeyi ve sallantıyı önler.
2. Ters Dönme Korumalı (Flip/Takla Önleyici): Kemik takip yönü düzeltilmiştir.
# 3. İnsan İskeleti Tasarımı (Armature Only): Roblox blokları yerine temiz, profesyonel bir insan iskeleti oluşturur.
#
# Talimatlar:
# 1. Blender'da üst menüden "Scripting" sekmesine geçin.
# 2. Yeni bir metin belgesi açıp bu kodun tamamını yapıştırın.
# 3. Blender'daki Run Script (Yandaki siyah üçgen) butonuna basın.
# =========================================================================

# --- YAPILANDIRMA (CONFIGURATION) ---
FILE_PATH = r"${jsonFilename}"

# Jitter Yumuşatma Pencere Boyutu (Tek Sayı: 1=Kapalı, 3, 5, 7 vb. Yüksek değerler hareketi daha pürüzsüz ama yavaş yapar)
SMOOTH_WINDOW = 5

SCALE_FACTOR = 4.0
TARGET_FPS = ${session.fps}
BAKE_TO_RIG = True # Hareket bittiğinde geçici kısıtlamaları sil ve kemiklerin içine kaydet!

# --- GÖMÜLÜ HAREKET VERİLERİ (Embedded) ---
frames_data = ${compactData}

def safe_set_mode(mode):
    if bpy.context.active_object:
        try:
            bpy.ops.object.mode_set(mode=mode)
        except Exception:
            pass

def smooth_landmarks(frames_list, window):
    if window <= 1 or not frames_list:
        return frames_list
    num_frames = len(frames_list)
    half = window // 2
    smoothed = []
    for i in range(num_frames):
        f_num = frames_list[i]["f"]
        orig_p = frames_list[i]["p"]
        smooth_p = {}
        for lid in orig_p.keys():
            sum_coord = [0.0, 0.0, 0.0]
            count = 0
            for w in range(max(0, i-half), min(num_frames, i+half+1)):
                w_p = frames_list[w]["p"]
                if lid in w_p:
                    sum_coord[0] += w_p[lid][0]
                    sum_coord[1] += w_p[lid][1]
                    sum_coord[2] += w_p[lid][2]
                    count += 1
            if count > 0:
                smooth_p[lid] = (sum_coord[0]/count, sum_coord[1]/count, sum_coord[2]/count)
            else:
                smooth_p[lid] = orig_p[lid]
        smoothed.append({"f": f_num, "p": smooth_p})
    return smoothed

def create_r15_armature():
    safe_set_mode('OBJECT')
    rig_name = "Human_Skeleton_R15"
    
    # Eski aynı isimli rig varsa temizle
    if rig_name in bpy.data.objects:
        bpy.ops.object.select_all(action='DESELECT')
        bpy.data.objects[rig_name].select_set(True)
        for child in list(bpy.data.objects[rig_name].children):
            bpy.data.objects.remove(child, do_unlink=True)
        bpy.ops.object.delete()
        
    armature_data = bpy.data.armatures.new(name=rig_name)
    rig_obj = bpy.data.objects.new(name=rig_name, object_data=armature_data)
    bpy.context.scene.collection.objects.link(rig_obj)
    bpy.context.view_layer.objects.active = rig_obj
    rig_obj.select_set(True)
    
    safe_set_mode('EDIT')
    
    # İdeal oranlarda R15 tabanlı İnsan İskeleti Koordinatları
    bones_def = {
        "LowerTorso": ((0, 0, 3.4), (0, 0, 4.0), None),
        "UpperTorso": ((0, 0, 4.0), (0, 0, 5.0), "LowerTorso"),
        "Head": ((0, 0, 5.0), (0, 0, 6.0), "UpperTorso"),
        "LeftUpperArm": ((-0.8, 0, 4.8), (-1.6, 0, 3.9), "UpperTorso"),
        "LeftLowerArm": ((-1.6, 0, 3.9), (-2.3, 0, 3.0), "LeftUpperArm"),
        "LeftHand": ((-2.3, 0, 3.0), (-2.5, 0, 2.7), "LeftLowerArm"),
        "RightUpperArm": ((0.8, 0, 4.8), (1.6, 0, 3.9), "UpperTorso"),
        "RightLowerArm": ((1.6, 0, 3.9), (2.3, 0, 3.0), "RightUpperArm"),
        "RightHand": ((2.3, 0, 3.0), (2.5, 0, 2.7), "RightLowerArm"),
        "LeftUpperLeg": ((-0.5, 0, 3.4), (-0.5, 0, 2.0), "LowerTorso"),
        "LeftLowerLeg": ((-0.5, 0, 2.0), (-0.5, 0, 0.6), "LeftUpperLeg"),
        "LeftFoot": ((-0.5, 0, 0.6), (-0.5, -0.4, 0.0), "LeftLowerLeg"),
        "RightUpperLeg": ((0.5, 0, 3.4), (0.5, 0, 2.0), "LowerTorso"),
        "RightLowerLeg": ((0.5, 0, 2.0), (0.5, 0, 0.6), "RightUpperLeg"),
        "RightFoot": ((0.5, 0, 0.6), (0.5, -0.4, 0.0), "RightLowerLeg"),
    }
    
    for b_name, (head, tail, parent_name) in bones_def.items():
        bone = armature_data.edit_bones.new(b_name)
        bone.head = head
        bone.tail = tail
        if parent_name:
            bone.parent = armature_data.edit_bones[parent_name]
            
    safe_set_mode('OBJECT')
    
    # Görünüm Ayarları (İskelet olarak görünmesi için)
    rig_obj.data.display_type = 'OCTAHEDRAL'
    rig_obj.show_in_front = True
    
    return rig_obj

def animate_roblox_r15():
    # 1. Animasyon verisini yükle
    frames = []
    if FILE_PATH and os.path.exists(FILE_PATH):
        print(f"BİLGİ: Dosyadan veri okunuyor: {FILE_PATH}")
        try:
            with open(FILE_PATH, 'r') as f:
                data = json.load(f)
            if "frames" in data:
                for frame in data["frames"]:
                    f_idx = frame.get("frameIndex", 0)
                    pt = {}
                    for lw in frame.get("worldLandmarks", []):
                        neededJoints = [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28]
                        if lw.get("id") in neededJoints:
                            pt[str(lw["id"])] = (lw.get("x", 0), lw.get("y", 0), lw.get("z", 0))
                    frames.append({"f": f_idx, "p": pt})
            elif isinstance(data, list):
                frames = data
        except Exception as e:
            print(f"HATA: Dosya okunamadı: {e}. Gömülü animasyona geçiliyor...")
            frames = frames_data
    else:
        print("BİLGİ: FILE_PATH belirtilmedi veya dosya bulunamadı. Gömülü kod verisinden oynatılıyor.")
        frames = frames_data

    # Yumuşatma Filtresini Uygula
    frames = smooth_landmarks(frames, SMOOTH_WINDOW)

    # 2. Armature'ı Bul veya Sıfırdan Yarat
    rig_obj = None
    if bpy.context.active_object and bpy.context.active_object.type == 'ARMATURE':
        rig_obj = bpy.context.active_object
        
    if not rig_obj:
        for obj in bpy.data.objects:
            if obj.type == 'ARMATURE' and "Skeleton_R15" in obj.name:
                rig_obj = obj
                break
                
    if not rig_obj:
        print("Sahnede İskelet bulunamadı! Sıfırdan insan iskeleti yaratılıyor...")
        rig_obj = create_r15_armature()
        
    print(f"Karakter Seçildi/Yaratıldı: {rig_obj.name}. Animasyon yapılıyor...")
    
    # Scene FPS Ayarla
    bpy.context.scene.render.fps = TARGET_FPS
    
    # 3. Yardımcı Nokta Koleksiyonu Oluştur
    col_name = "MediaPipe_MoCap"
    if col_name in bpy.data.collections:
        mocap_collection = bpy.data.collections[col_name]
    else:
        mocap_collection = bpy.data.collections.new(col_name)
        bpy.context.scene.collection.children.link(mocap_collection)
        
    # Temizle
    bpy.ops.object.select_all(action='DESELECT')
    for obj in list(mocap_collection.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
        
    # Boş Noktaları Tanımla
    landmark_ids = ["0", "11", "12", "13", "14", "15", "16", "23", "24", "25", "26", "27", "28"]
    empties = {}
    
    # Sanal ara noktalar
    virtual_landmarks = ["MID_HIP", "MID_SHOULDER"]
    
    for lid in landmark_ids + virtual_landmarks:
        empty_obj = bpy.data.objects.new(f"mp_{lid}", None)
        empty_obj.empty_display_type = 'PLAIN_AXES'
        empty_obj.empty_display_size = 0.2
        mocap_collection.objects.link(empty_obj)
        empties[lid] = empty_obj
        
    original_frame = bpy.context.scene.frame_current
    
    # 4. Yardımcı Noktaları Canlandır
    for idx, f_data in enumerate(frames):
        blender_frame = f_data["f"] + 1
        pt = f_data["p"]
        
        # MID_HIP ve MID_SHOULDER sanal noktalarını hesapla
        if "23" in pt and "24" in pt:
            h1, h2 = pt["23"], pt["24"]
            pt["MID_HIP"] = ((h1[0]+h2[0])/2, (h1[1]+h2[1])/2, (h1[2]+h2[2])/2)
            
        if "11" in pt and "12" in pt:
            s1, s2 = pt["11"], pt["12"]
            pt["MID_SHOULDER"] = ((s1[0]+s2[0])/2, (s1[1]+s2[1])/2, (s1[2]+s2[2])/2)
            
        for lid, coord in pt.items():
            if lid in empties:
                empty_obj = empties[lid]
                bx = -coord[0] * SCALE_FACTOR
                by = -coord[2] * SCALE_FACTOR # Derinlik
                bz = -coord[1] * SCALE_FACTOR # Yükseklik (MediaPipe'ta -Y yukarı olduğu için)
                
                empty_obj.location = (bx, by, bz)
                empty_obj.keyframe_insert(data_path="location", frame=blender_frame)
                
    # 5. Kemiklere Damped Track ve Copy Location Kısıtlamaları (Constraints) Uygula
    bpy.ops.object.select_all(action='DESELECT')
    rig_obj.select_set(True)
    bpy.context.view_layer.objects.active = rig_obj
    safe_set_mode('POSE')
    
    # R15 Kemik Eşleme Tablosu - TRACK_Y (Doğru hedef alma yönü, ters dönmeleri tamamen engeller)
    r15_bone_map = {
        "LeftUpperArm": ("mp_13", 'TRACK_Y'),
        "LeftLowerArm": ("mp_15", 'TRACK_Y'),
        "RightUpperArm": ("mp_14", 'TRACK_Y'),
        "RightLowerArm": ("mp_16", 'TRACK_Y'),
        "LeftUpperLeg": ("mp_25", 'TRACK_Y'),
        "LeftLowerLeg": ("mp_27", 'TRACK_Y'),
        "RightUpperLeg": ("mp_26", 'TRACK_Y'),
        "RightLowerLeg": ("mp_28", 'TRACK_Y'),
        "UpperTorso": ("mp_MID_SHOULDER", 'TRACK_Y'),
        "Head": ("mp_0", 'TRACK_Y'),
    }
    
    for bone_name, (target_empty, track_axis) in r15_bone_map.items():
        if bone_name in rig_obj.pose.bones:
            p_bone = rig_obj.pose.bones[bone_name]
            for c in list(p_bone.constraints):
                p_bone.constraints.remove(c)
                
            if target_empty in bpy.data.objects:
                const = p_bone.constraints.new(type='DAMPED_TRACK')
                const.target = bpy.data.objects[target_empty]
                const.track_axis = track_axis
                
    # LowerTorso'yu konum olarak kalçaya sabitle
    if "LowerTorso" in rig_obj.pose.bones:
        p_bone = rig_obj.pose.bones["LowerTorso"]
        for c in list(p_bone.constraints):
            p_bone.constraints.remove(c)
                
        if "mp_MID_HIP" in bpy.data.objects:
            c_loc = p_bone.constraints.new(type='COPY_LOCATION')
            c_loc.target = bpy.data.objects["mp_MID_HIP"]
            c_loc.use_x, c_loc.use_y, c_loc.use_z = True, True, True
            
    # 6. Animasyonu Doğrudan Kemiklere Yaz (Baking)
    if BAKE_TO_RIG:
        safe_set_mode('OBJECT')
        bpy.ops.object.select_all(action='DESELECT')
        rig_obj.select_set(True)
        bpy.context.view_layer.objects.active = rig_obj
        
        max_frame = len(frames)
        
        bpy.ops.nla.bake(
            frame_start=1,
            frame_end=max_frame,
            step=1,
            only_selected=False,
            visual_constraints=True,
            clear_constraints=True,
            bake_types={'POSE'}
        )
        
        # Temp Empties Koleksiyonunu temize çek
        if col_name in bpy.data.collections:
            for obj in list(bpy.data.collections[col_name].objects):
                bpy.data.objects.remove(obj, do_unlink=True)
            bpy.data.collections.remove(bpy.data.collections[col_name])
            
        print("Tebrikler! Animasyon İskelet modelinize başarıyla fırınlandı.")
        
    bpy.context.scene.frame_current = original_frame
    return True

animate_roblox_r15()15 modelinize başarıyla fırınlandı (bake edildi).")
        
    bpy.context.scene.frame_current = original_frame
    return True

animate_roblox_r15()
`;
}

/**
 * Generates an embedded python script specifically designed to animate a Roblox R6 model in Blender
 * without requiring NumPy or external file configurations.
 */
export function generateBlenderRobloxR6Script(session: MoCapSession, jsonFilename: string = "recorded_landmarks.json"): string {
  const compactData = getCompactFrameDataPython(session);
  return `import bpy
import json
import os

# =========================================================================
# BLENDER HUMAN SKELETON R6 PROSERÜREL RIG VE MOCAP AKTARICI (Jitter & Flip Korumalı)
# =========================================================================
# Bu gelişmiş MoCap betiği, MediaPipe verilerini Blender R6 insan iskeletine aktarır.
#
# ÖZELLİKLER:
# 1. Pürüzsüzleştirme Filtresi (Smoothing Filter): Titremeyi ve sallantıyı önler.
# 2. Ters Dönme Korumalı (Flip/Takla Önleyici): Kemik takip yönü düzeltilmiştir (R6 için optimize edildi).
# 3. İnsan İskeleti Tasarımı (Armature Only): Roblox blokları yerine temiz, profesyonel bir R6 insan iskeleti oluşturur.
#
# Talimatlar:
# 1. Blender'da üst menüden "Scripting" sekmesine geçin.
# 2. Yeni bir metin belgesi açıp bu kodun tamamını yapıştırın.
# 3. Blender'daki Run Script (Yandaki siyah üçgen) butonuna basın.
# =========================================================================

# --- YAPILANDIRMA (CONFIGURATION) ---
FILE_PATH = r"${jsonFilename}"

# Jitter Yumuşatma Pencere Boyutu (Tek Sayı: 1=Kapalı, 3, 5, 7 vb. Yüksek değerler hareketi daha pürüzsüz ama yavaş yapar)
SMOOTH_WINDOW = 5

SCALE_FACTOR = 4.0
TARGET_FPS = ${session.fps}
BAKE_TO_RIG = True # Hareket bittiğinde geçici kısıtlamaları sil ve kemiklerin içine kaydet!

# --- GÖMÜLÜ HAREKET VERİLERİ (Embedded) ---
frames_data = ${compactData}

def safe_set_mode(mode):
    if bpy.context.active_object:
        try:
            bpy.ops.object.mode_set(mode=mode)
        except Exception:
            pass

def smooth_landmarks(frames_list, window):
    if window <= 1 or not frames_list:
        return frames_list
    num_frames = len(frames_list)
    half = window // 2
    smoothed = []
    for i in range(num_frames):
        f_num = frames_list[i]["f"]
        orig_p = frames_list[i]["p"]
        smooth_p = {}
        for lid in orig_p.keys():
            sum_coord = [0.0, 0.0, 0.0]
            count = 0
            for w in range(max(0, i-half), min(num_frames, i+half+1)):
                w_p = frames_list[w]["p"]
                if lid in w_p:
                    sum_coord[0] += w_p[lid][0]
                    sum_coord[1] += w_p[lid][1]
                    sum_coord[2] += w_p[lid][2]
                    count += 1
            if count > 0:
                smooth_p[lid] = (sum_coord[0]/count, sum_coord[1]/count, sum_coord[2]/count)
            else:
                smooth_p[lid] = orig_p[lid]
        smoothed.append({"f": f_num, "p": smooth_p})
    return smoothed

def create_r6_armature():
    safe_set_mode('OBJECT')
    rig_name = "Human_Skeleton_R6"
    
    # Eski aynı isimli rig varsa temizle
    if rig_name in bpy.data.objects:
        bpy.ops.object.select_all(action='DESELECT')
        bpy.data.objects[rig_name].select_set(True)
        for child in list(bpy.data.objects[rig_name].children):
            bpy.data.objects.remove(child, do_unlink=True)
        bpy.ops.object.delete()
        
    armature_data = bpy.data.armatures.new(name=rig_name)
    rig_obj = bpy.data.objects.new(name=rig_name, object_data=armature_data)
    bpy.context.scene.collection.objects.link(rig_obj)
    bpy.context.view_layer.objects.active = rig_obj
    rig_obj.select_set(True)
    
    safe_set_mode('EDIT')
    
    # R6 İskelet yapısına uygun İdeal İskelet Koordinatları (Omuzlardan bacaklara temiz bir hat)
    bones_def = {
        "Torso": ((0, 0, 3.0), (0, 0, 4.8), None),
        "Head": ((0, 0, 4.8), (0, 0, 5.8), "Torso"),
        "Left Arm": ((-1.0, 0, 4.6), (-2.2, 0, 2.9), "Torso"),
        "Right Arm": ((1.0, 0, 4.6), (2.2, 0, 2.9), "Torso"),
        "Left Leg": ((-0.5, 0, 3.0), (-0.5, 0, 0.2), None),
        "Right Leg": ((0.5, 0, 3.0), (0.5, 0, 0.2), None),
    }
    
    for b_name, (head, tail, parent_name) in bones_def.items():
        bone = armature_data.edit_bones.new(b_name)
        bone.head = head
        bone.tail = tail
        if parent_name:
            bone.parent = armature_data.edit_bones[parent_name]
            
    safe_set_mode('OBJECT')
    
    # Görünüm Ayarları (İskelet olarak görünmesi için)
    rig_obj.data.display_type = 'OCTAHEDRAL'
    rig_obj.show_in_front = True
    
    return rig_obj

def animate_roblox_r6():
    # 1. Animasyon verisini yükle
    frames = []
    if FILE_PATH and os.path.exists(FILE_PATH):
        print(f"BİLGİ: Dosyadan veri okunuyor: {FILE_PATH}")
        try:
            with open(FILE_PATH, 'r') as f:
                data = json.load(f)
            if "frames" in data:
                for frame in data["frames"]:
                    f_idx = frame.get("frameIndex", 0)
                    pt = {}
                    for lw in frame.get("worldLandmarks", []):
                        neededJoints = [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28]
                        if lw.get("id") in neededJoints:
                            pt[str(lw["id"])] = (lw.get("x", 0), lw.get("y", 0), lw.get("z", 0))
                    frames.append({"f": f_idx, "p": pt})
            elif isinstance(data, list):
                frames = data
        except Exception as e:
            print(f"HATA: Dosya okunamadı: {e}. Gömülü animasyona geçiliyor...")
            frames = frames_data
    else:
        print("BİLGİ: FILE_PATH belirtilmedi veya dosya bulunamadı. Gömülü kod verisinden oynatılıyor.")
        frames = frames_data

    # Yumuşatma Filtresini Uygula
    frames = smooth_landmarks(frames, SMOOTH_WINDOW)

    # 2. Armature'ı Bul veya Sıfırdan Yarat
    rig_obj = None
    if bpy.context.active_object and bpy.context.active_object.type == 'ARMATURE':
        rig_obj = bpy.context.active_object
        
    if not rig_obj:
        for obj in bpy.data.objects:
            if obj.type == 'ARMATURE' and "Skeleton_R6" in obj.name:
                rig_obj = obj
                break
                
    if not rig_obj:
        print("Sahnede R6 İskelet bulunamadı! Sıfırdan R6 insan iskeleti yaratılıyor...")
        rig_obj = create_r6_armature()
        
    print(f"Karakter Seçildi/Yaratıldı: {rig_obj.name}. Animasyon yapılıyor...")
    
    # Scene FPS Ayarla
    bpy.context.scene.render.fps = TARGET_FPS
    
    # 3. Yardımcı Nokta Koleksiyonu Oluştur
    col_name = "MediaPipe_MoCap"
    if col_name in bpy.data.collections:
        mocap_collection = bpy.data.collections[col_name]
    else:
        mocap_collection = bpy.data.collections.new(col_name)
        bpy.context.scene.collection.children.link(mocap_collection)
        
    # Temizle
    bpy.ops.object.select_all(action='DESELECT')
    for obj in list(mocap_collection.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
        
    # Boş Noktaları Tanımla
    landmark_ids = ["0", "11", "12", "13", "14", "15", "16", "23", "24", "25", "26", "27", "28"]
    empties = {}
    
    # Sanal ara noktalar
    virtual_landmarks = ["MID_HIP", "MID_SHOULDER"]
    
    for lid in landmark_ids + virtual_landmarks:
        empty_obj = bpy.data.objects.new(f"mp_{lid}", None)
        empty_obj.empty_display_type = 'PLAIN_AXES'
        empty_obj.empty_display_size = 0.2
        mocap_collection.objects.link(empty_obj)
        empties[lid] = empty_obj
        
    original_frame = bpy.context.scene.frame_current
    
    # 4. Yardımcı Noktaları Canlandır
    for idx, f_data in enumerate(frames):
        blender_frame = f_data["f"] + 1
        pt = f_data["p"]
        
        # MID_HIP ve MID_SHOULDER sanal noktalarını hesapla
        if "23" in pt and "24" in pt:
            h1, h2 = pt["23"], pt["24"]
            pt["MID_HIP"] = ((h1[0]+h2[0])/2, (h1[1]+h2[1])/2, (h1[2]+h2[2])/2)
            
        if "11" in pt and "12" in pt:
            s1, s2 = pt["11"], pt["12"]
            pt["MID_SHOULDER"] = ((s1[0]+s2[0])/2, (s1[1]+s2[1])/2, (s1[2]+s2[2])/2)
            
        for lid, coord in pt.items():
            if lid in empties:
                empty_obj = empties[lid]
                bx = -coord[0] * SCALE_FACTOR
                by = -coord[2] * SCALE_FACTOR # Derinlik
                bz = -coord[1] * SCALE_FACTOR # Yükseklik (MediaPipe'ta -Y yukarı olduğu için)
                
                empty_obj.location = (bx, by, bz)
                empty_obj.keyframe_insert(data_path="location", frame=blender_frame)
                
    # 5. Kemiklere Damped Track ve Copy Location Kısıtlamaları (Constraints) Uygula
    bpy.ops.object.select_all(action='DESELECT')
    rig_obj.select_set(True)
    bpy.context.view_layer.objects.active = rig_obj
    safe_set_mode('POSE')
    
    # R6 Kemik Eşleme Tablosu - TRACK_Y (Bilekler kolların ucunu, ayaklar ise bacakların ucunu takip eder - Takla atması engellendi)
    r6_bone_map = {
        "Left Arm": ("mp_15", 'TRACK_Y'),
        "Right Arm": ("mp_16", 'TRACK_Y'),
        "Left Leg": ("mp_27", 'TRACK_Y'),
        "Right Leg": ("mp_28", 'TRACK_Y'),
        "Head": ("mp_0", 'TRACK_Y'),
    }
    
    for bone_name, (target_empty, track_axis) in r6_bone_map.items():
        if bone_name in rig_obj.pose.bones:
            p_bone = rig_obj.pose.bones[bone_name]
            for c in list(p_bone.constraints):
                p_bone.constraints.remove(c)
                
            if target_empty in bpy.data.objects:
                const = p_bone.constraints.new(type='DAMPED_TRACK')
                const.target = bpy.data.objects[target_empty]
                const.track_axis = track_axis
                
    # Torso'yu konum olarak kalçaya sabitle ve omuzlara yönlendir
    if "Torso" in rig_obj.pose.bones:
        p_bone = rig_obj.pose.bones["Torso"]
        for c in list(p_bone.constraints):
            p_bone.constraints.remove(c)
                
        if "mp_MID_HIP" in bpy.data.objects:
            c_loc = p_bone.constraints.new(type='COPY_LOCATION')
            c_loc.target = bpy.data.objects["mp_MID_HIP"]
            c_loc.use_x, c_loc.use_y, c_loc.use_z = True, True, True
            
        if "mp_MID_SHOULDER" in bpy.data.objects:
            c_rot = p_bone.constraints.new(type='DAMPED_TRACK')
            c_rot.target = bpy.data.objects["mp_MID_SHOULDER"]
            c_rot.track_axis = 'TRACK_Y'
            
    # 6. Animasyonu Doğrudan Kemiklere Yaz (Baking)
    if BAKE_TO_RIG:
        safe_set_mode('OBJECT')
        bpy.ops.object.select_all(action='DESELECT')
        rig_obj.select_set(True)
        bpy.context.view_layer.objects.active = rig_obj
        
        max_frame = len(frames)
        
        bpy.ops.nla.bake(
            frame_start=1,
            frame_end=max_frame,
            step=1,
            only_selected=False,
            visual_constraints=True,
            clear_constraints=True,
            bake_types={'POSE'}
        )
        
        # Temp Empties Koleksiyonunu temize çek
        if col_name in bpy.data.collections:
            for obj in list(bpy.data.collections[col_name].objects):
                bpy.data.objects.remove(obj, do_unlink=True)
            bpy.data.collections.remove(bpy.data.collections[col_name])
            
        print("Tebrikler! Animasyon İskelet R6 modelinize başarıyla fırınlandı.")
        
    bpy.context.scene.frame_current = original_frame
    return True

animate_roblox_r6()
`;
}

/**
 * Generates formatted CSV content for recorded world landmarks.
 * Columns: frameIndex, timestamp, landmarkId, landmarkName, x, y, z, visibility
 */
export function generateCSVExport(session: MoCapSession): string {
  const headers = ["frameIndex", "timestamp", "landmarkId", "landmarkName", "x", "y", "z", "visibility"];
  const rows = [headers.join(",")];

  for (const frame of session.frames) {
    for (const lw of frame.worldLandmarks) {
      const row = [
        frame.frameIndex,
        frame.timestamp.toFixed(4),
        lw.id,
        lw.name,
        lw.x.toFixed(6),
        lw.y.toFixed(6),
        lw.z.toFixed(6),
        (lw.visibility ?? 1.0).toFixed(6),
      ];
      rows.push(row.join(","));
    }
  }

  return rows.join("\n");
}
