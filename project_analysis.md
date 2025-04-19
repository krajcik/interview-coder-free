# Project Analysis

This document provides a detailed analysis of the project structure, dependencies, and functionality.

## Project Overview
- Electron-based desktop application for technical interview preparation
- Version: 1.0.18
- Build tools: Vite, Electron Builder
- Main entry point: dist-electron/main.js

## Key Dependencies
### Runtime
- React 18 with React Router
- Electron Updater for auto-updates
- OpenAI SDK v4.95.0
- Screenshot-desktop for screen capture
- TanStack Query for data fetching
- Electron Store for local data persistence

### Development
- TypeScript 5.4
- Tailwind CSS 3.4 with PostCSS
- Vite 5.1 with Electron plugins
- ESLint with React hooks rules

## Build Scripts
- `dev`: Clean build + Vite + Electron
- `build`: Production build with Electron Builder
- Multi-platform support: macOS (DMG/ZIP), Windows (NSIS), Linux (AppImage)

## Deployment
- Auto-publishing to GitHub Releases
- Notarization for macOS builds
- ASAR packaging for code protection

## Electron Main Process (electron/main.ts)
- Manages main application window with custom transparent panel
- Handles window positioning, resizing, visibility toggling
- Integrates helpers for screenshots, shortcuts, and processing
- Uses IPC handlers for communication with renderer
- Supports auto-updater initialization
- Protects window content from screen capture and recording
- Loads environment variables from .env

## Renderer Solutions Page (src/_pages/Solutions.tsx)
- React component managing problem statements, solutions, and debugging UI
- Uses React Query for data fetching and caching
- Displays problem statement, short answer, detailed solution, and complexity info
- Handles screenshot queue and deletion
- Shows toast notifications for errors and status
- Listens to Electron IPC events for solution processing lifecycle
- Supports multiple programming languages with syntax highlighting
