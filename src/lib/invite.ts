export type LinkKind = 'i' | 'r'; // invite (offer) or reply (answer)

/**
 * Pulls the sealed blob out of whatever the user pasted, whether that is a full link or the
 * bare code from the fallback box. Returns null if it looks like neither.
 */
export function extractBlob(text: string | null | undefined): string | null {
  const trimmed = (text ?? '').trim();
  if (!trimmed) return null;
  const inLink = trimmed.match(/[#&][ir]=([A-Za-z0-9_-]+)/);
  if (inLink) return inLink[1];
  return /^[A-Za-z0-9_-]{40,}$/.test(trimmed) ? trimmed : null;
}

/**
 * Built from the current path so it works unchanged under a GitHub Pages subpath. The blob
 * lives in the fragment, which browsers never send to the web server.
 */
export function buildLink(kind: LinkKind, blob: string): string {
  return `${location.origin}${location.pathname}#${kind}=${blob}`;
}

export interface HashRoute {
  kind: LinkKind;
  blob: string;
}

/** Reads an invite or reply out of the URL fragment, then clears it to keep the bar tidy. */
export function consumeHashRoute(): HashRoute | null {
  const match = location.hash.match(/^#([ir])=([A-Za-z0-9_-]+)/);
  if (!match) return null;
  history.replaceState(null, '', location.pathname);
  return { kind: match[1] as LinkKind, blob: match[2] };
}
