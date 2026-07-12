import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import type {
  InceptionInterview,
  InceptionTemplateRenderResponse
} from "../../shared/ipc";

type InceptionTemplates = {
  templateDir: string;
  prdTemplate: string;
  claudeTemplate: string;
};

type TemplateContext = Record<string, string>;

const REQUIRED_TEMPLATE_FILES = ["PRD.md", "CLAUDE.md"] as const;

export const renderInceptionTemplates = (
  interview: InceptionInterview
): InceptionTemplateRenderResponse => {
  const templates = loadInceptionTemplates();
  const context = buildTemplateContext(interview);
  const prdResult = fillTemplate(templates.prdTemplate, context);
  const claudeResult = fillTemplate(templates.claudeTemplate, context);
  const missingPlaceholders = Array.from(
    new Set([...prdResult.missingPlaceholders, ...claudeResult.missingPlaceholders])
  ).sort();

  return {
    templateDir: templates.templateDir,
    prd: prdResult.output,
    claude: claudeResult.output,
    missingPlaceholders
  };
};

const loadInceptionTemplates = (): InceptionTemplates => {
  const templateDir =
    process.env.STARSHIP_TEMPLATE_DIR ?? path.join(getAppRoot(), "templates");

  if (!fs.existsSync(templateDir)) {
    throw new Error(
      `Template directory not found: ${templateDir}. Add Travis's templates before running Inception.`
    );
  }

  const entries = fs.readdirSync(templateDir).filter((entry) => {
    const filePath = path.join(templateDir, entry);
    return fs.statSync(filePath).isFile();
  });

  if (entries.length === 0) {
    throw new Error(
      `Template directory is empty: ${templateDir}. Add Travis's templates before running Inception.`
    );
  }

  for (const fileName of REQUIRED_TEMPLATE_FILES) {
    const filePath = path.join(templateDir, fileName);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Required template missing: ${filePath}`);
    }
  }

  const prdTemplate = readTemplate(path.join(templateDir, "PRD.md"));
  const claudeTemplate = readTemplate(path.join(templateDir, "CLAUDE.md"));

  return {
    templateDir,
    prdTemplate,
    claudeTemplate
  };
};

const getAppRoot = (): string => {
  if (app && typeof app.getAppPath === "function") {
    return app.getAppPath();
  }

  return process.cwd();
};

const readTemplate = (filePath: string): string => {
  const content = fs.readFileSync(filePath, "utf8");
  if (content.trim().length === 0) {
    throw new Error(`Template is empty: ${filePath}`);
  }

  return content;
};

const fillTemplate = (
  template: string,
  context: TemplateContext
): { output: string; missingPlaceholders: string[] } => {
  const missingPlaceholders = new Set<string>();
  const output = template.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (_match, key) => {
    const value = context[key];
    if (value === undefined) {
      missingPlaceholders.add(key);
      return "";
    }

    return value;
  });

  return {
    output,
    missingPlaceholders: Array.from(missingPlaceholders)
  };
};

const buildTemplateContext = (
  interview: InceptionInterview
): TemplateContext => {
  const { intent, requirements } = interview;
  const firstVersionGoals = bulletize(requirements.firstVersionScope);
  const outOfScope = bulletize(requirements.outOfScope);
  const constraints = joinNonEmpty([requirements.stack, requirements.constraints]);

  return {
    project_name: requirements.projectName,
    one_liner: requirements.oneLiner,
    purpose: intent.purpose,
    success_criteria: intent.successCriteria,
    accepted_tradeoffs: intent.acceptedTradeoffs,
    never_do: intent.neverDo,
    learning_goal: intent.learningGoal,
    problem_statement: intent.purpose,
    audience: requirements.audience,
    goals: firstVersionGoals,
    out_of_scope: outOfScope,
    first_version_scope: requirements.firstVersionScope,
    stack: requirements.stack,
    constraints,
    architecture_notes: "",
    phases: "",
    risks: "",
    personal_success_criteria: intent.successCriteria,
    stack_details: requirements.stack,
    project_structure: "",
    conventions: requirements.constraints,
    commands: ""
  };
};

const bulletize = (value: string): string => {
  const lines = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return "";
  }

  return lines.map((line) => `- ${line.replace(/^[-*]\s+/, "")}`).join("\n");
};

const joinNonEmpty = (values: string[]): string =>
  values
    .map((value) => value.trim())
    .filter(Boolean)
    .join("\n\n");
