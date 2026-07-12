import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import type {
  InceptionDraftDocumentsResponse,
  InceptionInterview
} from "../../shared/ipc";
import type { StarshipDb } from "../db";
import { getHeadlessCwd, runHeadlessClaude } from "./headlessClaude";
import { renderInceptionTemplates } from "./templates";

type DraftKind = "prd" | "claude";

export const draftInceptionDocuments = async (
  db: StarshipDb,
  interview: InceptionInterview
): Promise<InceptionDraftDocumentsResponse> => {
  const rendered = renderInceptionTemplates(interview);
  const errors: string[] = [];
  const prd = await draftDocument(db, "prd", interview, rendered.prd).catch(
    (error: unknown) => {
      errors.push(`PRD draft: ${stringifyError(error)}`);
      return rendered.prd;
    }
  );
  const claude = await draftDocument(
    db,
    "claude",
    interview,
    rendered.claude
  ).catch((error: unknown) => {
    errors.push(`CLAUDE.md draft: ${stringifyError(error)}`);
    return rendered.claude;
  });

  return {
    templateDir: rendered.templateDir,
    prd,
    claude,
    missingPlaceholders: rendered.missingPlaceholders,
    usedFallback: errors.length > 0,
    errors
  };
};

const draftDocument = async (
  db: StarshipDb,
  kind: DraftKind,
  interview: InceptionInterview,
  renderedTemplate: string
): Promise<string> => {
  const prompt = fillPromptTemplate(readPromptTemplate(kind), {
    payload_json: JSON.stringify(
      {
        intentLedger: interview.intent,
        requirements: interview.requirements,
        renderedTemplate
      },
      null,
      2
    )
  });

  return runHeadlessClaude(db, {
    cacheNamespace: `inception:${kind}`,
    prompt,
    cwd: getHeadlessCwd()
  });
};

const readPromptTemplate = (kind: DraftKind): string => {
  const fileName = kind === "prd" ? "inception-prd.md" : "inception-claude.md";
  const promptDir =
    process.env.STARSHIP_PROMPT_DIR ?? path.join(getAppRoot(), "prompts");
  const filePath = path.join(promptDir, fileName);

  if (!fs.existsSync(filePath)) {
    throw new Error(`Prompt template missing: ${filePath}`);
  }

  const content = fs.readFileSync(filePath, "utf8");
  if (content.trim().length === 0) {
    throw new Error(`Prompt template is empty: ${filePath}`);
  }

  return content;
};

const fillPromptTemplate = (
  template: string,
  values: Record<string, string>
): string =>
  template.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (_match, key) => {
    const value = values[key];
    if (value === undefined) {
      throw new Error(`Prompt placeholder has no value: ${key}`);
    }

    return value;
  });

const stringifyError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const getAppRoot = (): string => {
  if (app && typeof app.getAppPath === "function") {
    return app.getAppPath();
  }

  return process.cwd();
};
