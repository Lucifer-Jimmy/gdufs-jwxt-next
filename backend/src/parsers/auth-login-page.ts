export interface AuthLoginFields {
  execution: string;
  passwordEncryptSalt: string;
}

class InputValueHandler implements HTMLRewriterElementContentHandlers {
  value: string | undefined;

  element(element: Element): void {
    this.value = element.getAttribute("value") ?? undefined;
  }
}

export async function parseAuthLoginFields(
  response: Response,
): Promise<AuthLoginFields> {
  const saltHandler = new InputValueHandler();
  const executionHandler = new InputValueHandler();

  await new HTMLRewriter()
    .on("input#pwdEncryptSalt", saltHandler)
    .on("input#execution", executionHandler)
    .transform(response)
    .arrayBuffer();

  if (saltHandler.value === undefined || executionHandler.value === undefined) {
    throw new Error("Auth login page is missing required fields");
  }

  return {
    execution: executionHandler.value,
    passwordEncryptSalt: saltHandler.value,
  };
}
