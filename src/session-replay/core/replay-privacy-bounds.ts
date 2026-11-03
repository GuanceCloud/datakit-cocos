export interface PrivacyBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface PrivacyNode {
  parent?: PrivacyNode | null;
  children?: PrivacyNode[];
  activeInHierarchy?: boolean;
  isValid?: boolean;
}

interface BoundsAdapter {
  ownBounds(node: PrivacyNode): PrivacyBounds | undefined;
  clipsChildren(node: PrivacyNode): boolean;
}

/** World AABB of this node only; engine subtree bounds ignore stencil clipping. */
export function ownPrivacyBounds(
  width: number, height: number, anchorX: number, anchorY: number,
  toWorld: (x: number, y: number) => { x: number; y: number },
): PrivacyBounds {
  const x = -width * anchorX;
  const y = -height * anchorY;
  const points = [toWorld(x, y), toWorld(x + width, y), toWorld(x, y + height), toWorld(x + width, y + height)];
  const left = Math.min(...points.map(p => p.x));
  const bottom = Math.min(...points.map(p => p.y));
  const right = Math.max(...points.map(p => p.x));
  const top = Math.max(...points.map(p => p.y));
  return { x: left, y: bottom, width: right - left, height: top - bottom };
}

function intersect(a: PrivacyBounds, b: PrivacyBounds): PrivacyBounds | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const top = Math.min(a.y + a.height, b.y + b.height);
  return right > x && top > y ? { x, y, width: right - x, height: top - y } : null;
}

/** Union visible subtree rectangles after ancestor and descendant Mask bounds.
 * Ellipse/image masks use their enclosing rectangle; inverted masks cannot narrow it.
 */
export function clippedPrivacyBounds(root: PrivacyNode, adapter: BoundsAdapter): PrivacyBounds | undefined {
  const read = (node: PrivacyNode): PrivacyBounds | undefined => {
    const bounds = adapter.ownBounds(node);
    if (bounds && (!Object.values(bounds).every(Number.isFinite) || bounds.width < 0 || bounds.height < 0)) {
      throw new Error('Invalid Replay privacy bounds');
    }
    return bounds;
  };
  const clipFor = (node: PrivacyNode, clip?: PrivacyBounds | null): PrivacyBounds | null | undefined => {
    if (clip === null || !adapter.clipsChildren(node)) return clip;
    const bounds = read(node);
    if (!bounds) throw new Error('Missing Replay privacy clip bounds');
    return clip ? intersect(clip, bounds) : bounds;
  };
  let ancestorClip: PrivacyBounds | null | undefined;
  for (let parent = root.parent; parent; parent = parent.parent) {
    ancestorClip = clipFor(parent, ancestorClip);
  }
  let result: PrivacyBounds | undefined;
  const visit = (node: PrivacyNode, inherited?: PrivacyBounds | null): void => {
    if (node.isValid === false || node.activeInHierarchy === false || inherited === null) return;
    const clip = clipFor(node, inherited);
    if (clip === null) return;
    const own = read(node);
    const bounds = own && (clip ? intersect(own, clip) : own);
    if (bounds && bounds.width > 0 && bounds.height > 0) {
      if (!result) result = { ...bounds };
      else {
        const x = Math.min(result.x, bounds.x);
        const y = Math.min(result.y, bounds.y);
        result = { x, y, width: Math.max(result.x + result.width, bounds.x + bounds.width) - x,
          height: Math.max(result.y + result.height, bounds.y + bounds.height) - y };
      }
    }
    node.children?.forEach(child => visit(child, clip));
  };
  visit(root, ancestorClip);
  return result;
}
