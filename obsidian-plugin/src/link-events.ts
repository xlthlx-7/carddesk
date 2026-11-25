/** Restrict interception to links rendered in this card, not native embeds. */
export function internalLink(event: MouseEvent | KeyboardEvent, body: HTMLElement): HTMLAnchorElement | null {
  if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return null;
  if (event.type === 'click' && (event as MouseEvent).button !== 0) return null;
  if (event.type === 'keydown' && (event as KeyboardEvent).key !== 'Enter') return null;
  const target = event.target as Element | null;
  const link = target?.closest<HTMLAnchorElement>('a.internal-link');
  if (!link || !body.contains(link) || link.closest('.internal-embed')) return null;
  return link;
}
