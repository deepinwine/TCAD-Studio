import {expect,it} from 'vitest';
import {PerspectiveCamera,Vector3} from 'three';
import * as navigation from './navigation';
it('navigation has 26 unique beveled targets with six faces, twelve edges and eight corners',()=>{
 expect(navigation.NAVIGATION_TARGETS).toBeDefined();
 const targets=navigation.NAVIGATION_TARGETS;
 expect(new Set(targets.map(target=>target.id)).size).toBe(26);
 expect([1,2,3].map(count=>targets.filter(target=>target.direction.filter(Boolean).length===count).length)).toEqual([6,12,8]);
 for(const target of targets){expect(target.vertices.length).toBe(target.kind==='corner'?3:4);for(const vertex of target.vertices)expect(vertex.every(Number.isFinite)).toBe(true);}
});
it('projection rejects back faces and follows actual Z-up camera orientation with finite polygons',()=>{
 expect(navigation.projectNavigation).toBeTypeOf('function');
 for(const direction of [[0,0,1],[0,0,-1],[1,-1,1],[-1,1,-1]]){
  const camera=new PerspectiveCamera();camera.up.set(0,0,1);camera.position.set(...direction as [number,number,number]);camera.lookAt(0,0,0);
  const patches=navigation.projectNavigation(camera.quaternion.toArray());
  expect(patches.length).toBeGreaterThan(0);expect(patches.length).toBeLessThan(26);
  for(const patch of patches){expect(new Vector3(...patch.direction).dot(camera.getWorldDirection(new Vector3()).negate())).toBeGreaterThan(0);expect(patch.points.flat().every(Number.isFinite)).toBe(true);}
 }
});
