import type { PreparedDraft, Snapshot, ImageReceipt } from '../domain/types.js';
export const normalizeText = (text: string) =>
  text
    .normalize('NFC')
    .replace(/\u00a0/g, ' ')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[\t ]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
function expectedLayout(draft: PreparedDraft, current: Snapshot): Snapshot['layout'] {
  const result: Snapshot['layout'] = [];
  let imageIndex = 0;
  for (const event of draft.events) {
    if (event.type === 'setTitle') continue;
    if (event.type === 'insertImage') {
      result.push({
        kind: 'image',
        key: current.images[imageIndex++]?.key ?? '',
        caption: '',
        captionAlignment: null,
      });
      continue;
    }
    if (event.type === 'setImageCaption') {
      const last = result.at(-1);
      if (last?.kind === 'image') {
        last.caption = normalizeText(event.text);
        last.captionAlignment = 'center';
      }
      continue;
    }
    for (const line of normalizeText(event.text).split('\n').filter(Boolean))
      result.push({
        kind: event.type === 'insertQuote' ? 'quote' : 'text',
        text: line,
        alignment: 'center',
      });
  }
  return result;
}
function normalizedLayout(snapshot: Snapshot): Snapshot['layout'] | null {
  if (!Array.isArray(snapshot.layout)) return null;
  const result: Snapshot['layout'] = [];
  for (const block of snapshot.layout) {
    if (block.kind === 'image')
      result.push({
        kind: 'image',
        key: block.key,
        caption: normalizeText(block.caption),
        captionAlignment: block.caption ? block.captionAlignment : null,
      });
    else
      for (const line of normalizeText(block.text).split('\n').filter(Boolean))
        result.push({ kind: block.kind, text: line, alignment: block.alignment });
  }
  return result;
}
function hasAlignmentMetadata(snapshot: Snapshot): boolean {
  return snapshot.layout.some((block) =>
    block.kind === 'image'
      ? Boolean(block.caption) && block.captionAlignment !== undefined
      : block.alignment !== undefined,
  );
}
function joinedSourceHeader(text: string): string {
  const normalized = normalizeText(text),
    marker = '자료 출처',
    index = normalized.indexOf(marker);
  return index < 0
    ? normalized
    : normalized.slice(0, index + marker.length) +
        normalized.slice(index + marker.length).replace(/\n/g, '');
}
function joinSourceHeaderLayout(layout: Snapshot['layout']): Snapshot['layout'] {
  const index = layout.findIndex(
    (block) => block.kind === 'text' && block.text.startsWith('자료 출처'),
  );
  if (index < 0) return layout;
  const heading = layout[index]!,
    suffix = layout.slice(index + 1);
  if (heading.kind !== 'text' || suffix.some((block) => block.kind !== 'text')) return layout;
  return [
    ...layout.slice(0, index),
    { ...heading, text: heading.text + suffix.map((block) => (block as { text: string }).text).join('') },
  ];
}
function legacyLayout(snapshot: Snapshot): unknown[] {
  return snapshot.layout.map((block) =>
    block.kind === 'image'
      ? { kind: 'image', key: block.key, caption: normalizeText(block.caption) }
      : { kind: block.kind, text: normalizeText(block.text) },
  );
}
export function resource(src: string): string {
  try {
    const u = new URL(src);
    if (!['https:', 'http:'].includes(u.protocol)) return '';
    if (u.hostname.endsWith('.pstatic.net')) u.search = '';
    return u.href;
  } catch {
    return '';
  }
}
export function matchesSnapshot(
  draft: PreparedDraft,
  current: Snapshot,
  receipts: ImageReceipt[],
  proof?: Snapshot,
): boolean {
  const currentLayout = normalizedLayout(current),
    actualLayout = JSON.stringify(currentLayout),
    wantedLayout = JSON.stringify(expectedLayout(draft, current)),
    joinedSourceLayout = JSON.stringify(joinSourceHeaderLayout(expectedLayout(draft, current))),
    joinedActualLayout = currentLayout
      ? JSON.stringify(joinSourceHeaderLayout(currentLayout))
      : actualLayout,
    layoutMatches =
      actualLayout === wantedLayout ||
      actualLayout === joinedSourceLayout ||
      joinedActualLayout === joinedSourceLayout ||
      (!hasAlignmentMetadata(current) &&
        (!proof || !hasAlignmentMetadata(proof)) &&
        JSON.stringify(legacyLayout(current)) ===
          JSON.stringify(legacyLayout({ ...current, layout: expectedLayout(draft, current) })));
  if (
    normalizeText(current.title) !== normalizeText(draft.title) ||
    joinedSourceHeader(current.bodyText) !== joinedSourceHeader(draft.expected.bodyText) ||
    current.images.length !== draft.expected.imageAssetIds.length ||
    receipts.length !== current.images.length ||
    (proof && proof.images.length !== current.images.length) ||
    !layoutMatches
  )
    return false;
  for (const [i, id] of draft.expected.imageAssetIds.entries()) {
    const a = draft.assets.find((a) => a.assetId === id),
      img = current.images[i],
      r = receipts[i],
      original = proof?.images[i];
    if (
      !a ||
      !img ||
      !r ||
      r.assetId !== id ||
      r.index !== i ||
      !img.loaded ||
      !resource(img.src) ||
      Math.abs(img.width / img.height - a.width / a.height) > 0.02 ||
      (original && resource(original.src) !== resource(img.src)) ||
      (!proof && r.blockKey !== img.key)
    )
      return false;
  }
  return (
    draft.expected.captions.every((t) =>
      normalizeText(current.bodyText).includes(normalizeText(t)),
    ) &&
    draft.expected.sources.every((t) => normalizeText(current.bodyText).includes(normalizeText(t)))
  );
}
export function partialDraft(draft: PreparedDraft, index: number): PreparedDraft {
  const events = draft.events.slice(0, index + 1),
    ids = events.filter((e) => e.type === 'insertImage').map((e) => e.assetId);
  return {
    ...draft,
    title: events.some((e) => e.type === 'setTitle') ? draft.title : '',
    events,
    expected: {
      bodyText: events
        .filter((e) => e.type !== 'insertImage' && e.type !== 'setTitle')
        .map((e) => ('text' in e ? e.text : ''))
        .join('\n'),
      imageAssetIds: ids,
      captions: events.filter((e) => e.type === 'setImageCaption').map((e) => e.text),
      sources: [],
    },
  };
}
