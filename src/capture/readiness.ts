import type { Locator } from 'playwright';
export interface RegionReadiness {
  loading?: boolean;
  visible: boolean;
  unloadedImages: number;
  occluded: boolean;
  clipped: boolean;
  text: string;
  width: number;
  height: number;
}
export function assertRegionReady(
  state: RegionReadiness,
  labels: string[],
): { width: number; height: number } {
  if (state.loading) throw Error('parent_loading');
  if (!state.visible || state.width < 1 || state.height < 1) throw Error('region_not_visible');
  if (state.unloadedImages) throw Error('images_unfinished');
  if (state.occluded) throw Error('region_occluded');
  if (state.clipped) throw Error('region_clipped');
  if (labels.some((label) => !state.text.replace(/\s+/g, '').includes(label.replace(/\s+/g, ''))))
    throw Error('required_label_missing');
  return { width: state.width, height: state.height };
}
export async function inspectRegion(
  locator: Locator,
  area?: { x: number; y: number; width: number; height: number },
): Promise<RegionReadiness> {
  return locator.evaluate((element, area) => {
    const doc = element.ownerDocument,
      win = doc.defaultView!,
      box = element.getBoundingClientRect();
    const r = area
      ? {
          left: area.x,
          top: area.y,
          right: area.x + area.width,
          bottom: area.y + area.height,
          width: area.width,
          height: area.height,
        }
      : box;
    const visible = (e: Element) => {
      const b = e.getBoundingClientRect(),
        s = win.getComputedStyle(e);
      return (
        b.width > 0 &&
        b.height > 0 &&
        s.visibility !== 'hidden' &&
        s.display !== 'none' &&
        s.opacity !== '0'
      );
    };
    const images = [
        ...(element.matches('img') ? [element] : []),
        ...element.querySelectorAll('img'),
      ] as HTMLImageElement[],
      visibleImages = images.filter(visible);
    let clipped =
      r.left < box.left - 1 ||
      r.top < box.top - 1 ||
      r.right > box.right + 1 ||
      r.bottom > box.bottom + 1 ||
      r.left < 0 ||
      r.top < 0 ||
      r.right > win.innerWidth + 1 ||
      r.bottom > win.innerHeight + 1;
    for (
      let ancestor = element.parentElement;
      ancestor && ancestor !== doc.body;
      ancestor = ancestor.parentElement
    ) {
      const style = win.getComputedStyle(ancestor);
      if (/hidden|auto|scroll/.test(style.overflow + style.overflowY + style.overflowX)) {
        const b = ancestor.getBoundingClientRect();
        if (
          r.left < b.left - 1 ||
          r.top < b.top - 1 ||
          r.right > b.right + 1 ||
          r.bottom > b.bottom + 1
        )
          clipped = true;
      }
    }
    const blocked = (x: number, y: number) => {
      const top = doc.elementFromPoint(x, y);
      return !top || (!element.contains(top) && !top.contains(element));
    };
    const dx = Math.min(8, r.width / 2),
      dy = Math.min(8, r.height / 2),
      points = [
        [r.left + dx, r.top + dy],
        [r.right - dx, r.top + dy],
        [r.left + dx, r.bottom - dy],
        [r.right - dx, r.bottom - dy],
        [r.left + r.width / 2, r.top + r.height / 2],
      ];
    let occluded = points.some(([x, y]) => blocked(x!, y!));
    // Inspect intersections too: a floating panel can miss every global sample.
    for (const candidate of doc.querySelectorAll('*')) {
      if (candidate === element || candidate.contains(element) || !visible(candidate)) continue;
      const b = candidate.getBoundingClientRect(),
        left = Math.max(r.left, b.left),
        top = Math.max(r.top, b.top),
        right = Math.min(r.right, b.right),
        bottom = Math.min(r.bottom, b.bottom);
      if (right <= left || bottom <= top) continue;
      if (element.contains(candidate)) {
        if (['fixed', 'sticky'].includes(win.getComputedStyle(candidate).position)) {
          occluded = true;
          break;
        }
        continue;
      }
      const inset = Math.min(1, (right - left) / 2, (bottom - top) / 2);
      if (
        [
          [left + inset, top + inset],
          [right - inset, top + inset],
          [left + inset, bottom - inset],
          [right - inset, bottom - inset],
          [(left + right) / 2, (top + bottom) / 2],
        ].some(([x, y]) => blocked(x!, y!))
      ) {
        occluded = true;
        break;
      }
    }
    const loading = [
      ...doc.querySelectorAll('[aria-busy="true"],[role="progressbar"],.loading,.loader'),
    ].some(visible);
    return {
      loading,
      visible: visible(element),
      unloadedImages: visibleImages.filter(
        (e) => !e.complete || !e.naturalWidth || !e.naturalHeight,
      ).length,
      occluded,
      clipped,
      text: (element as HTMLElement).innerText ?? element.getAttribute('alt') ?? '',
      width: r.width,
      height: r.height,
    };
  }, area);
}
