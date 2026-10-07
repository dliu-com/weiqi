// Local integration, 7 October 2026. AGPL-3.0-only; Kaya source in ../vendor.
import {MokuDetector} from '../vendor/kaya/moku-detector';
import {warpPerspective} from '../vendor/kaya/perspective';
import {mapStonesToGrid,DEFAULT_THRESHOLD} from '../vendor/kaya/moku-postprocess';
let detector;
self.onmessage=async({data})=>{
 try{
  detector??=new MokuDetector({modelUrl:data.modelUrl,wasmPath:'/photo-assets/ort/',onProgress:value=>self.postMessage({progress:value})});
  if(!detector.ready)await detector.init();
  const corners=[[64,64],[735,64],[735,735],[64,735]],started=performance.now();
  const image=warpPerspective(data.image,data.corners,800,corners);
  const result=await detector.detect(image,{boardSize:19,threshold:DEFAULT_THRESHOLD,outputSize:400});
  // The user's grid corners determine geometry; unreliable predicted corners
  // must not change the calibration after the image has been rectified.
  const stones=mapStonesToGrid(result.mokuRawDetections||[],corners,19);
  // Cached queries remain usable even when automatic corner detection fails.
  if(!result.mokuRawDetections){
   const logits=detector.cachedLogits,boxes=detector.cachedPredBoxes,raw=[];
   for(let q=0;q<300;q++){let classId=0,score=0;for(let c=0;c<3;c++){const v=1/(1+Math.exp(-logits[q*3+c]));if(v>score){classId=c;score=v;}}if(classId<2&&score>=DEFAULT_THRESHOLD)raw.push({classId,score,cx:boxes[q*4]*800,cy:boxes[q*4+1]*800});}
   stones.push(...mapStonesToGrid(raw,corners,19));
  }
  self.postMessage({stones,elapsedMs:performance.now()-started});
 }catch(error){self.postMessage({error:String(error.message||error)});}
};
