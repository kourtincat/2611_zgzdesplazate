import { defineConfig } from "vite";
import { handleApi } from "./server/api.mjs";

const api = () => ({
  name: "local-api",
  configureServer(server) { server.middlewares.use(handleApi); },
  configurePreviewServer(server) { server.middlewares.use(handleApi); },
});

export default defineConfig(async ({ mode }) => {
  const plugins = [api()];
  // `npm run dev:mobile`: HTTPS autofirmado para que la geolocalización funcione desde el móvil en la red local.
  if (mode === "mobile") plugins.push((await import("@vitejs/plugin-basic-ssl")).default());
  return {
    plugins,
    server: { host: true },
    build: { target: "es2022" },
  };
});
