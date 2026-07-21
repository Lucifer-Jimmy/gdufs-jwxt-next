import { DomainError } from "../errors/domain-error";
import { gradeDetailResponseSchema, type GradeDetail } from "../schemas/api";

interface ScriptHandler extends HTMLRewriterElementContentHandlers {
  scripts: string[];
}

class TextValueHandler implements HTMLRewriterElementContentHandlers {
  value = "";

  text(text: Text): void {
    this.value += text.text;
  }
}

class PresenceHandler implements HTMLRewriterElementContentHandlers {
  present = false;

  element(): void {
    this.present = true;
  }
}

class ScriptTextHandler implements ScriptHandler {
  scripts: string[] = [];
  private current = "";

  element(element: Element): void {
    this.current = "";
    element.onEndTag(() => {
      this.scripts.push(this.current);
    });
  }

  text(text: Text): void {
    this.current += text.text;
  }
}

export async function parseGradeDetailPage(
  response: Response,
): Promise<GradeDetail> {
  const title = new TextValueHandler();
  const loginForm = new PresenceHandler();
  const loginDiv = new PresenceHandler();
  const loginFormAction = new PresenceHandler();
  const scripts = new ScriptTextHandler();

  await new HTMLRewriter()
    .on("title", title)
    .on("#loginForm", loginForm)
    .on("#loginDiv", loginDiv)
    .on("form[action*='LoginToXk']", loginFormAction)
    .on("script", scripts)
    .transform(response)
    .arrayBuffer();

  if (isLoginPage(title.value.trim(), loginForm, loginDiv, loginFormAction)) {
    throw sessionExpired();
  }

  let array: unknown[] | undefined;
  for (const script of scripts.scripts) {
    const candidate = extractArrayDeclaration(script);
    if (candidate === undefined) {
      continue;
    }
    array = candidate;
    break;
  }

  if (array === undefined) {
    throw upstreamChanged();
  }
  if (array.length !== 1 || !isRecord(array[0])) {
    throw upstreamChanged();
  }

  const result = gradeDetailResponseSchema.safeParse(array[0]);
  if (!result.success) {
    throw upstreamChanged();
  }
  return result.data;
}

function extractArrayDeclaration(script: string): unknown[] | undefined {
  const declaration = /\blet\s+arr\s*=\s*/gu;
  let match: RegExpExecArray | null;
  while ((match = declaration.exec(script)) !== null) {
    const start = match.index + match[0].length;
    if (script[start] !== "[") {
      continue;
    }
    const end = findJsonEnd(script, start, "[", "]");
    if (end === null || !/^\s*;/u.test(script.slice(end + 1))) {
      throw upstreamChanged();
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(script.slice(start, end + 1)) as unknown;
    } catch {
      throw upstreamChanged();
    }
    if (!Array.isArray(parsed)) {
      throw upstreamChanged();
    }
    return Array.from(parsed) as unknown[];
  }
  return undefined;
}

function findJsonEnd(
  source: string,
  start: number,
  opening: string,
  closing: string,
): number | null {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }
    if (character === '"') {
      inString = true;
    } else if (character === opening) {
      depth += 1;
    } else if (character === closing) {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isLoginPage(
  title: string,
  loginForm: PresenceHandler,
  loginDiv: PresenceHandler,
  loginFormAction: PresenceHandler,
): boolean {
  return (
    title === "登录" ||
    loginForm.present ||
    loginDiv.present ||
    loginFormAction.present
  );
}

function sessionExpired(): DomainError {
  return new DomainError({
    code: "SESSION_EXPIRED",
    message: "登录已失效，请重新登录",
    status: 401,
  });
}

function upstreamChanged(): DomainError {
  return new DomainError({
    code: "UPSTREAM_CHANGED",
    message: "教务系统成绩详情结构发生变化，暂时无法读取成绩组成",
    status: 502,
  });
}
