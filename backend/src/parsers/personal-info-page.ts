export interface PersonalInfoPage {
  kind: "personal_info";
  studentId: string;
  name: string;
  college: string;
  major: string;
}

export interface LoginPage {
  kind: "login";
}

export type PersonalInfoPageResult = PersonalInfoPage | LoginPage;

class TextHandler implements HTMLRewriterElementContentHandlers {
  textValue = "";

  text(text: Text): void {
    this.textValue += text.text;
    if (text.lastInTextNode) {
      this.textValue = this.textValue.trim();
    }
  }
}

class PresenceHandler implements HTMLRewriterElementContentHandlers {
  present = false;

  element(): void {
    this.present = true;
  }
}

export async function parsePersonalInfoPage(
  response: Response,
): Promise<PersonalInfoPageResult> {
  const title = new TextHandler();
  const pageTitle = new TextHandler();
  const loginForm = new PresenceHandler();
  const loginDiv = new PresenceHandler();
  const loginFormAction = new PresenceHandler();
  const detailText = new DetailTextHandler();
  const streamingRewriter = new HTMLRewriter()
    .on(".infoContentTitle.qz-ellipse", title)
    .on(".qz-detailtext.qz-ellipse", detailText)
    .on("title", pageTitle)
    .on("#loginForm", loginForm)
    .on("#loginDiv", loginDiv)
    .on("form[action*='LoginToXk']", loginFormAction);

  await streamingRewriter.transform(response).arrayBuffer();

  if (
    loginPageDetected(pageTitle.textValue, loginForm, loginDiv, loginFormAction)
  ) {
    return { kind: "login" };
  }

  const heading = title.textValue;
  const separator = heading.lastIndexOf("-");
  const studentName = separator > 0 ? heading.slice(0, separator).trim() : "";
  const studentId = separator > 0 ? heading.slice(separator + 1).trim() : "";
  const college = detailText.values[1];
  const major = detailText.values[2];
  if (
    studentName.length === 0 ||
    studentId.length === 0 ||
    college === undefined ||
    major === undefined
  ) {
    throw new Error("Personal info page is missing expected fields");
  }

  return {
    kind: "personal_info",
    studentId,
    name: studentName,
    college: valueAfterColon(college),
    major: valueAfterColon(major),
  };
}

class DetailTextHandler implements HTMLRewriterElementContentHandlers {
  values: string[] = [];
  private current = "";

  element(element: Element): void {
    this.current = "";
    element.onEndTag(() => {
      this.values.push(this.current.trim());
    });
  }

  text(text: Text): void {
    this.current += text.text;
  }
}

function valueAfterColon(value: string): string {
  const separator = value.indexOf("：");
  const result = separator >= 0 ? value.slice(separator + 1).trim() : "";
  if (result.length === 0) {
    throw new Error("Personal info page contains an invalid detail field");
  }
  return result;
}

function loginPageDetected(
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
