import { ipcMain } from "electron";
import type {
  InceptionDraftDocumentsRequest,
  InceptionDraftDocumentsResponse,
  InceptionTemplateRenderRequest,
  InceptionTemplateRenderResponse
} from "../../shared/ipc";
import type { StarshipDb } from "../db";
import { draftInceptionDocuments } from "./draftDocuments";
import { renderInceptionTemplates } from "./templates";

export const registerInceptionHandlers = (db: StarshipDb): void => {
  ipcMain.handle(
    "inception:renderTemplates",
    (
      _event,
      request: InceptionTemplateRenderRequest
    ): InceptionTemplateRenderResponse =>
      renderInceptionTemplates(request.interview)
  );

  ipcMain.handle(
    "inception:draftDocuments",
    (
      _event,
      request: InceptionDraftDocumentsRequest
    ): Promise<InceptionDraftDocumentsResponse> =>
      draftInceptionDocuments(db, request.interview)
  );
};
