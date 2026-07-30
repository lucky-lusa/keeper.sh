const HTML_TAG_PATTERN = /<[^>]*>/g;
const HTML_ENTITIES: Record<string, string> = {
  "&nbsp;": " ",
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": "\"",
  "&apos;": "'",
  "&#39;": "'",
};
const ANCHOR_PATTERN = /<a\b[^>]*?href="([^"]*)"[^>]*?>([\s\S]*?)<\/a>/gi;

const isHtmlDescription = (text: string): boolean => /<\/?\w+[^>]*>/.test(text);

const htmlToPlainText = (html: string): string => {
  const withAnchorsConverted = html.replace(ANCHOR_PATTERN, (_match, href: string, text: string) => {
    const plainText = text.replaceAll(HTML_TAG_PATTERN, "").replaceAll(/[\r\n\t ]+/g, " ").trim();
    if (!plainText || plainText === href) {
      return href;
    }
    return `${plainText} (${href})`;
  });
  const withoutTags = withAnchorsConverted.replaceAll(HTML_TAG_PATTERN, "");
  const decoded = withoutTags.replaceAll(
    /&(?:nbsp|amp|lt|gt|quot|apos|#39);/g,
    (entity) => HTML_ENTITIES[entity] ?? entity,
  );
  return decoded.replaceAll(/[\r\n\t ]+/g, " ").trim();
};

export { isHtmlDescription, htmlToPlainText };
