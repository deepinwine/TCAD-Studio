import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import * as Cube from './NavigationCube';
import {I18nProvider} from '../i18n/I18nContext';
import {LanguageSwitcher} from '../components/LanguageSwitcher';
import {NAVIGATION_TARGETS} from './navigation';
import {Quaternion,Vector3} from 'three';
afterEach(()=>{cleanup();window.localStorage.clear();});
it('visible patches and keyboard choices activate all 26 directions without leaking pointer picks',()=>{
 expect(Cube.NavigationCube).toBeTypeOf('function');
 const choose=vi.fn(),pick=vi.fn();
 render(<div onPointerUp={pick}><Cube.NavigationCube orientation={[0,0,0,1]} onChoose={choose} disabled={false}/></div>);
 const select=screen.getByRole('combobox',{name:'选择视角'});
 expect(select.querySelectorAll('option')).toHaveLength(27);
 for(const target of NAVIGATION_TARGETS){fireEvent.change(select,{target:{value:target.id}});expect(choose).toHaveBeenLastCalledWith(target.direction);}
 const top=screen.getByRole('button',{name:'顶'});fireEvent.pointerDown(top);fireEvent.pointerUp(top);fireEvent.click(top);expect(pick).not.toHaveBeenCalled();expect(choose).toHaveBeenLastCalledWith([0,0,1]);
 fireEvent.keyDown(top,{key:'Enter'});expect(choose).toHaveBeenLastCalledWith([0,0,1]);
 fireEvent.focus(top);expect(screen.getByRole('status')).toHaveTextContent('顶');
});
it('camera orientation changes visible faces and disabled controls cannot change direction',()=>{
 expect(Cube.NavigationCube).toBeTypeOf('function');
 const onChoose=vi.fn();const {rerender}=render(<Cube.NavigationCube orientation={[0,0,0,1]} onChoose={onChoose} disabled={false}/>);
 expect(screen.getByRole('button',{name:'顶'})).toBeInTheDocument();expect(screen.queryByRole('button',{name:'底'})).toBeNull();expect(screen.getByRole('combobox')).toHaveValue('0,0,1');
 const q=new Quaternion().setFromAxisAngle(new Vector3(1,0,0),Math.PI).toArray();
 rerender(<Cube.NavigationCube orientation={q} onChoose={onChoose} disabled/>);
 expect(screen.getByRole('combobox')).toHaveValue('0,0,-1');expect(screen.queryByRole('button',{name:'顶'})).toBeNull();fireEvent.click(screen.getByRole('button',{name:'底'}));expect(onChoose).not.toHaveBeenCalled();expect(screen.getByRole('combobox')).toBeDisabled();
});

it('language switching changes navigation labels without changing the actual orientation',()=>{
 window.localStorage.setItem('tcad.locale.v1','zh-CN');const choose=vi.fn();
 render(<I18nProvider><LanguageSwitcher/><Cube.NavigationCube orientation={[0,0,0,1]} onChoose={choose} disabled={false}/></I18nProvider>);
 expect(screen.getByRole('combobox',{name:'选择视角'})).toHaveValue('0,0,1');fireEvent.click(screen.getByRole('button',{name:'EN'}));
 expect(screen.getByRole('combobox',{name:'Choose view'})).toHaveValue('0,0,1');expect(screen.getByRole('button',{name:'Top'})).toBeInTheDocument();expect(choose).not.toHaveBeenCalled();window.localStorage.clear();
});
