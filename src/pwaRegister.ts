// PWAのService Worker登録。
// vite-plugin-pwa が提供する仮想モジュールを使う。
// (このモジュールは `vite build` 時にのみ実体化するため、
//  開発時にエラーが出る場合は devOptions.enabled を確認すること)
export function setupPWA() {
  import("virtual:pwa-register")
    .then(({ registerSW }) => {
      registerSW({
        immediate: true,
        onNeedRefresh() {
          console.info("新しいバージョンが利用可能です。再読み込みで更新されます。");
        },
        onOfflineReady() {
          console.info("オフラインで利用する準備ができました。");
        }
      });
    })
    .catch((err) => {
      console.warn("Service Workerの登録をスキップしました:", err);
    });
}
