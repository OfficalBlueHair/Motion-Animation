/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface Landmark {
  x: number;
  y: number;
  z: number;
  visibility?: number;
  presence?: number;
}

export interface LandmarkWithName extends Landmark {
  id: number;
  name: string;
}

export interface MoCapFrame {
  frameIndex: number;
  timestamp: number; // in seconds from start of recording
  landmarks: LandmarkWithName[]; // Normalized 2D camera coordinate landmarks [0, 1]
  worldLandmarks: LandmarkWithName[]; // Absolute metric 3D coordinates [-3, 3] in meters relative to hips
}

export interface MoCapSession {
  id: string;
  name: string;
  date: string;
  fps: number;
  duration: number; // in seconds
  totalFrames: number;
  modelType: "lite" | "full" | "heavy";
  frames: MoCapFrame[];
}

export interface TrackerConfig {
  modelType: "lite" | "full" | "heavy";
  minPoseDetectionConfidence: number;
  minPoseTrackingConfidence: number;
  mirrorMode: boolean;
  targetFps: number; // 0 for unlimited, 15, 24, 30, 60
  resolution: "qvga" | "vga" | "hd"; // QVGA (320x240) is ultra-fast for i3-6100U, HD (1280x720) is crisp
}

// MediaPipe 33 keypoints naming map
export const LANDMARK_NAMES: { [key: number]: string } = {
  0: "NOSE",
  1: "LEFT_EYE_INNER",
  2: "LEFT_EYE",
  3: "LEFT_EYE_OUTER",
  4: "RIGHT_EYE_INNER",
  5: "RIGHT_EYE",
  6: "RIGHT_EYE_OUTER",
  7: "LEFT_EAR",
  8: "RIGHT_EAR",
  9: "MOUTH_LEFT",
  10: "MOUTH_RIGHT",
  11: "LEFT_SHOULDER",
  12: "RIGHT_SHOULDER",
  13: "LEFT_ELBOW",
  14: "RIGHT_ELBOW",
  15: "LEFT_WRIST",
  16: "RIGHT_WRIST",
  17: "LEFT_PINKY",
  18: "RIGHT_PINKY",
  19: "LEFT_INDEX",
  20: "RIGHT_INDEX",
  21: "LEFT_THUMB",
  22: "RIGHT_THUMB",
  23: "LEFT_HIP",
  24: "RIGHT_HIP",
  25: "LEFT_KNEE",
  26: "RIGHT_KNEE",
  27: "LEFT_ANKLE",
  28: "RIGHT_ANKLE",
  29: "LEFT_HEEL",
  30: "RIGHT_HEEL",
  31: "LEFT_FOOT_INDEX",
  32: "RIGHT_FOOT_INDEX",
};

// SKELETON CONNECTIONS (Bones)
export const SKELETON_CONNECTIONS: [number, number, string][] = [
  // Torso / Hips
  [11, 12, "torso"], // left shoulder to right shoulder
  [11, 23, "torso"], // left shoulder to left hip
  [12, 24, "torso"], // right shoulder to right hip
  [23, 24, "hips"],  // left hip to right hip
  
  // Left Arm
  [11, 13, "left_arm"], // left shoulder to elbow
  [13, 15, "left_arm"], // elbow to wrist
  [15, 17, "left_hand"], // wrist to pinky
  [15, 19, "left_hand"], // wrist to index
  [15, 21, "left_hand"], // wrist to thumb
  [17, 19, "left_hand"], // pinky to index

  // Right Arm
  [12, 14, "right_arm"], // right shoulder to elbow
  [14, 16, "right_arm"], // elbow to wrist
  [16, 18, "right_hand"], // wrist to pinky
  [16, 20, "right_hand"], // wrist to index
  [16, 22, "right_hand"], // wrist to thumb
  [18, 20, "right_hand"], // pinky to index

  // Left Leg
  [23, 25, "left_leg"], // left hip to knee
  [25, 27, "left_leg"], // knee to ankle
  [27, 29, "left_foot"], // ankle to heel
  [29, 31, "left_foot"], // heel to toe
  [27, 31, "left_foot"], // ankle to toe

  // Right Leg
  [24, 26, "right_leg"], // right hip to knee
  [26, 28, "right_leg"], // knee to ankle
  [28, 30, "right_foot"], // ankle to heel
  [30, 32, "right_foot"], // heel to toe
  [28, 32, "right_foot"], // ankle to toe

  // Face / Head
  [0, 1, "face"], // nose to left eye inner
  [1, 2, "face"], // eye inner to eye
  [2, 3, "face"], // eye to eye outer
  [0, 4, "face"], // nose to right eye inner
  [4, 5, "face"], // eye inner to eye
  [5, 6, "face"], // eye to eye outer
  [3, 7, "face"], // left eye outer to ear
  [6, 8, "face"], // right eye outer to ear
  [9, 10, "face"], // mouth left to mouth right
];
