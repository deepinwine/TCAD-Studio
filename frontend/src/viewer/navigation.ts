import {Quaternion, Vector3} from 'three';
import type {CameraOrientation, ViewDirection} from './viewerRuntime';

export interface NavigationTarget {
  id: string;
  direction: ViewDirection;
  kind: 'face' | 'edge' | 'corner';
  vertices: ViewDirection[];
}
export interface ProjectedTarget extends NavigationTarget {
  points: [number, number][];
  center: [number, number];
  depth: number;
}

// This is the navigation widget's beveled cube, never process/model geometry.
function createTargets(): NavigationTarget[] {
  const targets: NavigationTarget[] = [];
  const inset = .65;
  for (const x of [-1, 0, 1]) for (const y of [-1, 0, 1]) for (const z of [-1, 0, 1]) {
    if (!(x || y || z)) continue;
    const direction: ViewDirection = [x, y, z];
    const axes = [0, 1, 2].filter(axis => direction[axis] !== 0);
    const vertices: ViewDirection[] = [];
    if (axes.length === 1) {
      const free = [0, 1, 2].filter(axis => direction[axis] === 0);
      for (const [a, b] of [[-1,-1], [1,-1], [1,1], [-1,1]]) {
        const point: [number,number,number] = [0,0,0];
        point[axes[0]] = direction[axes[0]];
        point[free[0]] = a * inset; point[free[1]] = b * inset;
        vertices.push(point);
      }
    } else if (axes.length === 2) {
      const free = [0,1,2].find(axis => direction[axis] === 0)!;
      for (const [a,b,c] of [[1,inset,-inset], [inset,1,-inset], [inset,1,inset], [1,inset,inset]]) {
        const point: [number,number,number] = [0,0,0];
        point[axes[0]] = a * direction[axes[0]]; point[axes[1]] = b * direction[axes[1]]; point[free] = c;
        vertices.push(point);
      }
    } else {
      for (const axis of axes) vertices.push(direction.map((sign,index) => sign * (index === axis ? 1 : inset)) as [number,number,number]);
    }
    targets.push({id: direction.join(','), direction, kind: axes.length === 1 ? 'face' : axes.length === 2 ? 'edge' : 'corner', vertices});
  }
  return targets;
}
export const NAVIGATION_TARGETS = createTargets();

/** Orthographic projection of the widget using the actual model camera's orientation. */
export function projectNavigation(orientation: CameraOrientation): ProjectedTarget[] {
  if (orientation.length !== 4 || !orientation.every(Number.isFinite)) return [];
  const rotation = new Quaternion(...orientation);
  if (rotation.lengthSq() < 1e-20) return [];
  rotation.normalize().invert();
  return NAVIGATION_TARGETS.flatMap(target => {
    const normal = new Vector3(...target.direction).applyQuaternion(rotation);
    if (normal.z <= 1e-5) return [];
    const vertices = target.vertices.map(point => new Vector3(...point).applyQuaternion(rotation));
    const points: [number,number][] = vertices.map(point => [72 + point.x * 35, 72 - point.y * 35]);
    return [{...target, points, center: [points.reduce((sum,p)=>sum+p[0],0)/points.length, points.reduce((sum,p)=>sum+p[1],0)/points.length] as [number,number], depth: vertices.reduce((sum,p)=>sum+p.z,0)/vertices.length}];
  }).sort((a,b) => a.depth - b.depth);
}
