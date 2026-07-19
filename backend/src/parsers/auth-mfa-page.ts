export async function parseMaskedPhone(response: Response): Promise<string> {
  const handler = new InputValueHandler();

  await new HTMLRewriter()
    .on("input#username", handler)
    .transform(response)
    .arrayBuffer();

  const value = handler.value?.trim();
  if (value === undefined || value.length === 0 || value.length > 64) {
    throw new Error("Auth MFA page is missing masked phone information");
  }
  return value;
}

class InputValueHandler implements HTMLRewriterElementContentHandlers {
  value: string | undefined;

  element(element: Element): void {
    this.value = element.getAttribute("value") ?? undefined;
  }
}
