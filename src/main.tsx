import React from "react";
import "./build-stamp";
import { createRoot } from "react-dom/client";
import App from "./App";
import AdminApp from "./AdminApp";
import "./style.css";

const isAdmin =
  typeof window !== "undefined" &&
  window.location.pathname.replace(/\/+$/, "").startsWith("/admin");

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>{isAdmin ? <AdminApp /> : <App />}</React.StrictMode>,
);
