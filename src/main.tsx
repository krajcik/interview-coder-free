import React from "react"
import ReactDOM from "react-dom/client"
import App from "./App"
import "./index.css"
import { HashRouter } from "react-router-dom"

// Use HashRouter which is more compatible with Electron
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </React.StrictMode>
)
