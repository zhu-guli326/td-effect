import { GLPipeline } from '../gpu/shader-pass.js';
export class EffectComposer{
  constructor({canvas,bus,source,analysis,cv}){this.canvas=canvas;this.bus=bus;this.source=source;this.analysis=analysis;this.cv=cv;this.pipeline=new GLPipeline(canvas);this.chain=['flowWarp','feedback','maskGlow','chromatic'];}
  setChain(chain){if(!Array.isArray(chain)||chain.length===0)throw new Error('Composer chain must be a non-empty array');this.chain=[...chain];this.bus.publish({composerChain:[...this.chain]});}
  render(time){this.pipeline.render({source:this.source.canvas,flow:this.analysis.flowCanvas,mask:this.cv.maskCanvas,chain:this.chain,signal:this.bus.snapshot(),time});}
  dispose(){this.pipeline.dispose();}
}
