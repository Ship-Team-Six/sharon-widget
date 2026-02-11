# Sharon Widget

A desktop widget that renders a 3D VRM model (Sharon) using Tauri v2 + three.js + @pixiv/three-vrm.

## Features
- **Transparent, borderless window** — always-on-top desktop widget
- **VRM model rendering** with three-vrm
- **Idle animations**: breathing, blinking, head sway, body sway, random expressions
- **Mouse tracking**: Sharon's eyes/head follow your cursor
- **30 FPS** capped render loop
- **Draggable** via invisible top bar region
- **Close button** overlay

## Tech Stack
- **Tauri v2** — Rust backend + webview
- **three.js** — 3D rendering
- **@pixiv/three-vrm** — VRM model loading and animation
- **Vite** — frontend build tool

## Running

```bash
# Development
npm run tauri dev

# Build
npm run tauri build
```

## Model
The VRM model (`sharon1.vrm`) should be placed in the `public/` directory.
- ~50k polygons, 17 materials, 166 bones
- VRM format (based on glTF)

## Structure
```
sharon-widget/
├── public/
│   └── sharon1.vrm          # VRM model file
├── src/
│   └── main.js              # three.js + VRM rendering + animations
├── src-tauri/
│   ├── src/main.rs           # Tauri Rust backend
│   └── tauri.conf.json       # Tauri config (transparent, borderless, always-on-top)
├── index.html                # Entry point
├── vite.config.js            # Vite config
└── package.json
```
