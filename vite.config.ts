import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  base: "./",
  plugins: [
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: [
        "icons/icon.svg",
        "icons/icon-maskable.svg",
        "icons/icon-192.png",
        "icons/icon-512.png",
        "icons/icon-maskable-512.png"
      ],
      manifest: {
        name: "AI世界シミュレーター",
        short_name: "世界シミュレーター",
        description:
          "AIが歴史・人物・文化を紡ぐ、国家運営 x 神視点の世界シミュレーションゲーム",
        theme_color: "#0e1420",
        background_color: "#0e1420",
        display: "standalone",
        orientation: "any",
        start_url: "./",
        scope: "./",
        icons: [
          {
            src: "icons/icon-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any"
          },
          {
            src: "icons/icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any"
          },
          {
            src: "icons/icon-maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable"
          }
        ]
      },
      workbox: {
        // ローカルAIモデル(数百MB〜1GB)はブラウザのCache Storageで
        // transformers.js が個別にキャッシュするため、Workboxの
        // プリキャッシュ対象からは外し、ナビゲーション用のみ扱う。
        globPatterns: ["**/*.{js,css,html,svg,png,ico,json}"],
        // transformers.js本体(ローカルAI用)はサイズが大きく、AIを使わない
        // ユーザーにとっては不要なので、PWAインストール時の事前キャッシュからは
        // 除外する。実際に「ローカルAIを有効化」した時点で必要分のみ取得される。
        globIgnores: ["**/transformers-*.js"],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        navigateFallback: "index.html",
        runtimeCaching: [
          {
            urlPattern: ({ url }: { url: URL }) =>
              url.origin === "https://huggingface.co" ||
              url.host.endsWith("hf.co"),
            handler: "CacheFirst",
            options: {
              cacheName: "local-ai-model-cache",
              expiration: {
                maxEntries: 30,
                maxAgeSeconds: 60 * 60 * 24 * 365
              },
              cacheableResponse: { statuses: [0, 200] }
            }
          }
        ]
      },
      devOptions: {
        enabled: true
      }
    })
  ],
  server: {
    port: 5173
  }
});
