/** Frame style presets. Depth/width in meters at world scale. */

export interface FrameStyleDef {
  id: string;
  name: string;
  color: string;
  metalness: number;
  roughness: number;
  /** Frame bar width (m). 0 = frameless. */
  barWidth: number;
  /** How far the frame projects from the wall (m). */
  depth: number;
  /** Matte border inside the frame as a fraction of artwork size. */
  matte: number;
  matteColor: string;
}

export const FRAME_STYLES: Record<string, FrameStyleDef> = {
  "thin-black-metal": {
    id: "thin-black-metal",
    name: "Thin black metal",
    color: "#17171a",
    metalness: 0.85,
    roughness: 0.35,
    barWidth: 0.02,
    depth: 0.035,
    matte: 0.06,
    matteColor: "#f7f6f2",
  },
  "gallery-white": {
    id: "gallery-white",
    name: "Gallery white",
    color: "#f4f3ef",
    metalness: 0.05,
    roughness: 0.7,
    barWidth: 0.045,
    depth: 0.05,
    matte: 0.08,
    matteColor: "#ffffff",
  },
  "natural-oak": {
    id: "natural-oak",
    name: "Natural oak",
    color: "#c49a63",
    metalness: 0.0,
    roughness: 0.8,
    barWidth: 0.04,
    depth: 0.04,
    matte: 0.07,
    matteColor: "#faf7ef",
  },
  "ornate-gold": {
    id: "ornate-gold",
    name: "Ornate gold",
    color: "#c9a13b",
    metalness: 0.9,
    roughness: 0.3,
    barWidth: 0.09,
    depth: 0.07,
    matte: 0.05,
    matteColor: "#f2ead8",
  },
  frameless: {
    id: "frameless",
    name: "Floating / frameless",
    color: "#000000",
    metalness: 0,
    roughness: 1,
    barWidth: 0,
    depth: 0.025,
    matte: 0,
    matteColor: "#000000",
  },
  "deep-shadowbox": {
    id: "deep-shadowbox",
    name: "Deep shadowbox",
    color: "#2a2620",
    metalness: 0.1,
    roughness: 0.75,
    barWidth: 0.055,
    depth: 0.11,
    matte: 0.1,
    matteColor: "#efece4",
  },
};

export const FRAME_STYLE_LIST = Object.values(FRAME_STYLES);
export const DEFAULT_FRAME_STYLE = "thin-black-metal";
