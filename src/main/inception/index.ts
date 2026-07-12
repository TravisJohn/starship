import { ipcMain } from "electron";
import type {
  InceptionCreateProjectRequest,
  InceptionCreateProjectResponse,
  InceptionDraftDocumentsRequest,
  InceptionDraftDocumentsResponse,
  InceptionTemplateRenderRequest,
  InceptionTemplateRenderResponse
} from "../../shared/ipc";
import type { StarshipDb } from "../db";
import { createInceptionProject } from "./createProject";
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

  ipcMain.handle(
    "inception:createProject",
    (
      _event,
      request: InceptionCreateProjectRequest
    ): Promise<InceptionCreateProjectResponse> =>
      createInceptionProject(db, request)
  );
};
