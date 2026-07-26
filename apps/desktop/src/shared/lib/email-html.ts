export function prepareEmailHtml(html: string) {
  const viewerHead = `
    <base target="_blank">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
      html { color-scheme: light; }
      body { max-width: 100%; overflow-wrap: anywhere; }
      img { max-width: 100%; height: auto; }
      table { max-width: 100%; }
      pre { max-width: 100%; overflow: auto; white-space: pre-wrap; }
    </style>
  `;
  const head = html.match(/<head(?:\s[^>]*)?>/i);
  if (head?.index !== undefined) {
    const at = head.index + head[0].length;
    return `${html.slice(0, at)}${viewerHead}${html.slice(at)}`;
  }
  const htmlTag = html.match(/<html(?:\s[^>]*)?>/i);
  if (htmlTag?.index !== undefined) {
    const at = htmlTag.index + htmlTag[0].length;
    return `${html.slice(0, at)}<head>${viewerHead}</head>${html.slice(at)}`;
  }
  return `<!doctype html><html><head>${viewerHead}</head><body>${html}</body></html>`;
}
