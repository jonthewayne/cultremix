// The animation features (animations, gestures, drag, layout) for the LazyMotion in
// src/routes/__root.tsx. They load in their own chunk after the page first draws, so the main
// bundle carries only the small m.* components (motion/react-m).
export { domMax as default } from "motion/react";
