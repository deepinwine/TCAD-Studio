import {afterEach, expect, it, vi} from 'vitest';
import * as THREE from 'three';
import type {TcadApi} from '../api/types';
import {createThreeViewerRuntime} from './viewerRuntime';
const rendered = vi.hoisted(() => ({scene:null as import('three').Scene | null,camera:null as import('three').Camera | null}));
vi.mock('three',async importOriginal => {
  const actual=await importOriginal<typeof import('three')>();
  return {...actual,WebGLRenderer:class {
    domElement:HTMLCanvasElement; capabilities={maxTextureSize:4096}; localClippingEnabled=false;
    constructor(options:{canvas:HTMLCanvasElement}) {this.domElement=options.canvas;}
    getContext(){return {VERSION:1,getParameter:()=> 'WebGL 2'};}
    setSize(){} render(scene:import('three').Scene,camera:import('three').Camera){rendered.scene=scene;rendered.camera=camera;} dispose(){}
  }};
});
afterEach(() => vi.unstubAllGlobals());
function binary(){const buffer=new ArrayBuffer(108),view=new DataView(buffer);[...'TCADGEOM'].forEach((char,i)=>view.setUint8(i,char.charCodeAt(0)));view.setUint32(8,1,true);view.setUint32(12,7,true);view.setUint32(16,3,true);view.setUint32(20,3,true);new Float32Array(buffer,24,9).set([0,0,0,1,0,0,0,1,0]);new Float32Array(buffer,60,9).set([0,0,1,0,0,1,0,0,1]);new Uint32Array(buffer,96,3).set([0,1,2]);return buffer;}
it('owner meshes, material opacity, cached caps and picking share visibility with zero API calls on eyes',async()=>{
  vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}});
  const visual={materialId:2,displayName:'Oxide',color:[1,0,0] as const,opacity:1,metallic:0,roughness:.5,visible:true};
  const bounds={min:[-.05,-.05,-.05] as const,max:[.25,.05,.15] as const};
  const display={revision:4,available:true,bounds,ownerStepIds:{'1':'a','2':'b'},groups:[1,2,0].map(ownerId=>({ownerId,materialId:2,stepId:ownerId===1?'a':ownerId===2?'b':null,voxelCount:1,triangleCount:1,bytes:108,boundingBox:bounds})),stepEntities:[],unavailableReasons:[]};
  const api={getPreviewManifest:vi.fn(async()=>({revision:4,meshes:[{materialId:2,name:'Oxide',triangleCount:3,boundingBox:bounds,visual}]})),getMaterialStl:vi.fn(),getDisplayManifest:vi.fn(async()=>display),getDisplayMesh:vi.fn(async()=>binary()),getDisplaySlice:vi.fn(async request=>({revision:4,axis:request.axis,index:request.index,indexMax:1,shape:[1,3] as const,data:new Uint16Array([2,2,2]),owners:new Uint32Array([1,2,0])})),runAll:vi.fn(),runStep:vi.fn(),runTo:vi.fn(),setStep:vi.fn(),importRecipe:vi.fn(),saveRecipe:vi.fn()} as unknown as TcadApi;
  const runtime=createThreeViewerRuntime(api);runtime.mount(document.createElement('div'));
  runtime.setSectionContext!({gridShape:[3,1,2],voxelSizeNm:100},()=>{});
  const result=await runtime.loadMeshes(1);expect(result.materials).toHaveLength(1);expect(result.display?.available).toBe(true);
  runtime.setClipping({x:{enabled:false,position:.5},y:{enabled:false,position:.5},z:{enabled:true,position:.5}});
  await vi.waitFor(()=>expect(api.getDisplaySlice).toHaveBeenCalledTimes(1));
  await new Promise(resolve=>setTimeout(resolve,30));
  const camera=rendered.camera;const position=camera!.position.clone();
  const snapshots=[api.getPreviewManifest,api.getMaterialStl,api.getDisplayManifest,api.getDisplayMesh,api.getDisplaySlice,api.runAll,api.runStep,api.runTo,api.setStep,api.importRecipe,api.saveRecipe].map(fn=>vi.mocked(fn!).mock.calls.length);
  runtime.setHiddenStepIds!(['a']); runtime.setMaterialDisplay(2,{opacity:.4});
  await new Promise(resolve=>setTimeout(resolve,30));
  const ownerMeshes:import('three').Mesh[]=[];rendered.scene!.traverse(object=>{if(object.userData.matId===2)ownerMeshes.push(object as import('three').Mesh);});
  expect(ownerMeshes).toHaveLength(3);expect(ownerMeshes.map(mesh=>[mesh.userData.ownerId,mesh.visible])).toEqual([[1,false],[2,true],[0,true]]);
  expect(ownerMeshes.every(mesh=>(mesh.material as import('three').Material).opacity===.4)).toBe(true);
  runtime.setMaterialDisplay(2,{visible:false});runtime.setHiddenStepIds!([]);expect(ownerMeshes.every(mesh=>!mesh.visible)).toBe(true);
  runtime.setMaterialDisplay(2,{visible:true});runtime.setHiddenStepIds!(['a']);expect(ownerMeshes[0].visible).toBe(false);
  const after=[api.getPreviewManifest,api.getMaterialStl,api.getDisplayManifest,api.getDisplayMesh,api.getDisplaySlice,api.runAll,api.runStep,api.runTo,api.setStep,api.importRecipe,api.saveRecipe].map(fn=>vi.mocked(fn!).mock.calls.length);
  expect(after).toEqual(snapshots);expect(rendered.camera).toBe(camera);expect(camera!.position.equals(position)).toBe(true);
  runtime.dispose();
});

async function cameraFixture() {
  const frames = new Map<number, FrameRequestCallback>();
  let frameId = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {frames.set(++frameId, callback); return frameId;});
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  let resize = () => {};
  vi.stubGlobal('ResizeObserver', class {constructor(callback: () => void) {resize = callback;} observe() {} disconnect() {}});
  const host = document.createElement('div');
  let width = 800;
  Object.defineProperties(host, {clientWidth: {get: () => width}, clientHeight: {value: 600}});
  const bounds = {min: [-60, -40, 0] as const, max: [60, 40, 400] as const};
  const visual = {materialId: 1, displayName: 'Silicon', color: [.6, .6, .6] as const, opacity: 1, metallic: 0, roughness: .5, visible: true};
  const api = {
    getPreviewManifest: vi.fn(async () => ({revision: 1, meshes: [{materialId: 1, name: 'Silicon', triangleCount: 1, boundingBox: bounds, visual}]})),
    getMaterialStl: vi.fn(async () => new TextEncoder().encode('solid asymmetric\nfacet normal 0 0 1\nouter loop\nvertex -60 -40 0\nvertex 60 -40 400\nvertex -60 40 0\nendloop\nendfacet\nendsolid asymmetric').buffer),
  } as unknown as TcadApi;
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
  const runtime = createThreeViewerRuntime(api); runtime.mount(host);
  await runtime.loadMeshes(1);
  const flush = () => {
    for (const [id, callback] of [...frames]) {frames.delete(id); callback(0);}
    const camera = rendered.camera as THREE.PerspectiveCamera | THREE.OrthographicCamera;
    camera.updateMatrixWorld();
    return camera;
  };
  const target = new THREE.Vector3(0, 0, 200);
  return {runtime, host, target, flush, resize: () => {width = 400; resize();}, assertLocal: () => {
    expect(api.getPreviewManifest).toHaveBeenCalledTimes(1);
    expect(api.getMaterialStl).toHaveBeenCalledTimes(1);
    expect(fetcher).not.toHaveBeenCalled();
  }};
}

const standardViews = [
  ['top', [0, 0, 1]], ['bottom', [0, 0, -1]],
  ['front', [0, -1, 0]], ['back', [0, 1, 0]],
  ['left', [-1, 0, 0]], ['right', [1, 0, 0]],
] as const;

it.each(standardViews)('%s follows the Z-up axes across projection, fit and resize with finite stable screen orientation', async (view, direction) => {
  const {runtime, target, flush, resize, assertLocal} = await cameraFixture();
  try {
    runtime.setStandardView(view);
    const assertPose = () => {
      const camera = flush();
      // OrbitControls.makeSafe keeps polar views 1e-6 radians off the singularity.
      expect(camera.position.clone().sub(target).normalize().distanceTo(new THREE.Vector3(...direction))).toBeLessThan(2e-6);
      expect(camera.getWorldDirection(new THREE.Vector3()).dot(new THREE.Vector3(...direction))).toBeCloseTo(-1, 10);
      expect(camera.up.toArray()).toEqual([0, 0, 1]);
      for (const matrix of [camera.matrixWorld, camera.matrixWorldInverse, camera.projectionMatrix]) {
        expect(matrix.elements.every(Number.isFinite)).toBe(true);
        expect(Math.abs(matrix.determinant())).toBeGreaterThan(1e-12);
      }
      const center = target.clone().project(camera);
      const upAxis = view === 'top' || view === 'bottom' ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1);
      const screenUp = target.clone().add(upAxis).project(camera);
      expect(screenUp.y).toBeGreaterThan(center.y);
      expect(Math.abs(screenUp.x - center.x)).toBeLessThan((screenUp.y - center.y) * 1e-5);
      if (view === 'top' || view === 'bottom') {
        const screenX = target.clone().add(new THREE.Vector3(1, 0, 0)).project(camera);
        expect((screenX.x - center.x) * (view === 'top' ? 1 : -1)).toBeGreaterThan(0);
        expect(Math.abs(screenX.y - center.y)).toBeLessThan(Math.abs(screenX.x - center.x) * 1e-5);
      }
      return camera;
    };
    assertPose();
    for (const mode of ['orthographic', 'perspective'] as const) {
      const previous = assertPose();
      const screenRight = new THREE.Vector3().setFromMatrixColumn(previous.matrixWorld, 0).add(target);
      const before = screenRight.clone().project(previous);
      runtime.setProjection(mode);
      const after = screenRight.clone().project(assertPose());
      expect(after.x).toBeCloseTo(before.x, 8);
      expect(after.y).toBeCloseTo(before.y, 8);
      runtime.fit(); assertPose();
      resize(); assertPose();
      runtime.fit();
      const fitted = assertPose();
      for (const x of [-60, 60]) for (const y of [-40, 40]) for (const z of [0, 400]) {
        const point = new THREE.Vector3(x, y, z).project(fitted);
        expect(Math.abs(point.x)).toBeLessThanOrEqual(1.00001);
        expect(Math.abs(point.y)).toBeLessThanOrEqual(1.00001);
      }
      runtime.setStandardView('iso');
      runtime.setStandardView(view); assertPose();
    }
    assertLocal();
  } finally {runtime.dispose();}
});

it.each(['top', 'bottom'] as const)('%s keeps real OrbitControls drag active after camera rebinds with no API calls', async view => {
  const {runtime, host, flush, assertLocal} = await cameraFixture();
  try {
    runtime.setStandardView(view);
    runtime.setProjection('orthographic'); runtime.setProjection('perspective');
    const canvas = host.querySelector('canvas')!;
    Object.defineProperty(canvas, 'clientHeight', {value: 600});
    canvas.setPointerCapture = vi.fn(); canvas.releasePointerCapture = vi.fn();
    const before = flush().quaternion.clone();
    const pointer = (name: string, x: number, y: number) => new MouseEvent(name, {bubbles: true, button: 0, clientX: x, clientY: y});
    const dispatch = (name: string, x: number, y: number) => (name === 'pointerdown' ? canvas : document).dispatchEvent(Object.assign(pointer(name, x, y), {pointerId: 1, pointerType: 'mouse'}));
    dispatch('pointerdown', 200, 200); dispatch('pointermove', 260, view === 'top' ? 160 : 240); dispatch('pointerup', 260, 160);
    expect(flush().quaternion.angleTo(before)).toBeGreaterThan(.05);
    expect(canvas.setPointerCapture).toHaveBeenCalledTimes(1);
    expect(canvas.releasePointerCapture).toHaveBeenCalledTimes(1);
    assertLocal();
  } finally {runtime.dispose();}
});
