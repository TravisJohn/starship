import { ipcMain } from "electron";
import type {
  InceptionTemplateRenderRequest,
  InceptionTemplateRenderResponse
} from "../../shared/ipc";
import { renderInceptionTemplates } from "./templates";

export const registerInceptionHandlers = (): void => {
  ipcMain.handle(
    "inception:renderTemplates",
    (
      _event,
      request: InceptionTemplateRenderRequest
    ): InceptionTemplateRenderResponse =>
      renderInceptionTemplates(request.interview)
  );
};
