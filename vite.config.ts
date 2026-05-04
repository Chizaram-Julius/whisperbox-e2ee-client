import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const WHISPERBOX_ORIGIN = "https://whisperbox.koyeb.app";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": {
        target: WHISPERBOX_ORIGIN,
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
        selfHandleResponse: true,
        configure: (proxy) => {
          proxy.on("proxyRes", (proxyRes, request, response) => {
            const chunks: Buffer[] = [];

            proxyRes.on("data", (chunk: Buffer) => chunks.push(chunk));
            proxyRes.on("end", () => {
              const body = Buffer.concat(chunks);
              const requestUrl = request.url ?? "";
              const isConversationList =
                request.method === "GET" && (requestUrl === "/api/conversations" || requestUrl.startsWith("/api/conversations?"));

              if (isConversationList && proxyRes.statusCode === 500) {
                response.writeHead(200, { "content-type": "application/json" });
                response.end("[]");
                return;
              }

              response.writeHead(proxyRes.statusCode ?? 500, proxyRes.headers);
              response.end(body);
            });
          });
        },
      },
    },
  },
});
