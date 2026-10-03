import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import {migrateBrandStorage} from "./utils/brandStorage";
import "./index.css";

try { migrateBrandStorage(window.localStorage); } catch { /* Optional browser cache. */ }

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
