import { ipcMain } from "electron";
import {
  createPreview,
  destroyPreview,
  hidePreview,
  navigatePreview,
  setPreviewBounds,
  setPreviewInspect,
  setPreviewStyle,
  showPreview
} from "../managers/previewManager";

export function registerPreviewIpc() {
  ipcMain.handle("preview:create", (_event, { previewId, url }: { previewId: string; url: string }) => createPreview(previewId, url));

  ipcMain.handle(
    "preview:show",
    (_event, { previewId, bounds }: { previewId: string; bounds: { x: number; y: number; width: number; height: number } }) =>
      showPreview(previewId, bounds)
  );

  ipcMain.handle("preview:hide", (_event, { previewId }: { previewId: string }) => hidePreview(previewId));

  ipcMain.handle("preview:setBounds", (_event, { previewId, bounds }: { previewId: string; bounds: { x: number; y: number; width: number; height: number } }) =>
    setPreviewBounds(previewId, bounds)
  );

  ipcMain.handle("preview:navigate", (_event, { previewId, url }: { previewId: string; url: string }) => navigatePreview(previewId, url));

  ipcMain.handle("preview:destroy", (_event, { previewId }: { previewId: string }) => destroyPreview(previewId));

  ipcMain.handle(
    "preview:inspect:set",
    (_event, { previewId, enabled }: { previewId: string; enabled: boolean }) => setPreviewInspect(previewId, enabled)
  );

  ipcMain.handle(
    "preview:style:set",
    (_event, { previewId, nodeId, property, value }: { previewId: string; nodeId: number; property: string; value: string }) =>
      setPreviewStyle(previewId, { nodeId, property, value })
  );
}
