"""Private evaluation of noword/image2sgf's FCOS and EfficientNet checkpoints.
Reproduces automatic corner detection and 361 intersection classification.
Upstream repository has no explicit licence file; benchmark only, not integrated.
Reference: https://github.com/noword/image2sgf (v0.07 checkpoints).
"""
import time
START=time.perf_counter()
import json,os,argparse
from pathlib import Path
import numpy as np
import cv2
from PIL import Image,ImageOps
import torch,torchvision
from torchvision import models
IMPORT_MS=(time.perf_counter()-START)*1000
DEVICE=torch.device('cuda' if os.getenv('GPU')=='1' else 'cpu');torch.set_num_threads(4)
ROOT=Path(os.getenv('WEIGHT_DIR','/home/ubuntu/photo-bench'));t=time.perf_counter()
board_model=models.detection.fcos_resnet50_fpn(weights=None,weights_backbone=None,num_classes=5,detections_per_img=8,score_thresh=.05).eval();board_model.load_state_dict(torch.load(ROOT/'board.pth',map_location='cpu',weights_only=True));board_model.to(DEVICE)
stone_model=models.efficientnet_b3(weights=None,num_classes=6).eval();stone_model.load_state_dict(torch.load(ROOT/'stone.pth',map_location='cpu',weights_only=True));stone_model.to(DEVICE)
INIT_MS=(time.perf_counter()-t)*1000

def sync():
 if DEVICE.type=='cuda':torch.cuda.synchronize()
def tensor(img):return torch.from_numpy(np.asarray(img,dtype=np.float32).copy()).permute(2,0,1)/255

def run(path,id):
 started=time.perf_counter();img=ImageOps.exif_transpose(Image.open(path)).convert('RGB');w,h=img.size;t=time.perf_counter()
 samples=np.array(img)[::10,::10,:].reshape(-1,3);colors,counts=np.unique(samples,axis=0,return_counts=True);background=tuple(int(c) for c in colors[counts.argmax()]);side=max(w,h);side=int(side*1.2) if min(w,h)/side<.9 else side;left=(side-w)//2;top=(side-h)//2;expanded=Image.new('RGB',(side,side),background);expanded.paste(img,(left,top));inp=tensor(expanded).to(DEVICE);sync();pre=(time.perf_counter()-t)*1000;t=time.perf_counter()
 with torch.inference_mode():out=board_model([inp])[0]
 sync();corner_ms=(time.perf_counter()-t)*1000
 keep=torchvision.ops.nms(out['boxes'],out['scores'],.1);found={}
 for k in keep.tolist():
  label=int(out['labels'][k]);
  if label not in found:found[label]=(out['boxes'][k,:2].detach().cpu().numpy()-[left,top],float(out['scores'][k]))
 result={'id':id,'device':str(DEVICE),'preprocessMs':pre,'cornerPassMs':corner_ms}
 if set(found)!={1,2,3,4}:return {**result,'error':'Missing automatic corner labels','handlerMs':(time.perf_counter()-started)*1000}
 pts=np.array([found[i][0] for i in range(1,5)],dtype=np.float32);result['corners']=pts[[0,1,3,2]].tolist();result['cornerScores']=[found[i][1] for i in range(1,5)]
 # Upstream maps bounding-box starts to patch starts, not intersection centres.
 half=1024*.8/18/2;low=102-half;high=921-half
 target=np.float32([[low,low],[high,low],[low,high],[high,high]]);t=time.perf_counter();H=cv2.getPerspectiveTransform(pts,target);warped=cv2.warpPerspective(np.asarray(img),H,(1024,1024))
 # Re-detect after rectification when the upstream confidence rule requests it.
 result['cornerRefinementUsed']=False
 if min(result['cornerScores'])<.7:
  sync();refineStart=time.perf_counter()
  with torch.inference_mode():second=board_model([tensor(Image.fromarray(warped)).to(DEVICE)])[0]
  sync();result['cornerRefinementMs']=(time.perf_counter()-refineStart)*1000
  refined={}
  for k in torchvision.ops.nms(second['boxes'],second['scores'],.1).tolist():
   label=int(second['labels'][k])
   if label not in refined:refined[label]=(second['boxes'][k,:2].detach().cpu().numpy(),float(second['scores'][k]))
  if set(refined)=={1,2,3,4} and sum(v[1] for v in refined.values())>sum(result['cornerScores']):
   H2=cv2.getPerspectiveTransform(np.float32([refined[i][0] for i in range(1,5)]),target);warped=cv2.warpPerspective(warped,H2,(1024,1024));H=H2@H;result['cornerRefinementUsed']=True
 # Return intersection centres in the original photo, not box starts.
 result['corners']=cv2.perspectiveTransform(np.float32([[[102,102],[921,102],[921,921],[102,921]]]),np.linalg.inv(H))[0].tolist()
 step=1024*.8/18;patches=[]
 for row in range(19):
  for col in range(19):
   cx=int(102.4+col*step);cy=int(102.4+row*step);patch=warped[int(cy-step/2):int(cy+step/2),int(cx-step/2):int(cx+step/2)];patches.append(torch.from_numpy(patch.copy()).permute(2,0,1).float()/255)
 patches=torch.stack(patches).to(DEVICE);sync();result['rectifyAndPatchMs']=(time.perf_counter()-t)*1000;t=time.perf_counter();outputs=[]
 with torch.inference_mode():
  for batch in patches.split(64 if DEVICE.type=='cuda' else 32):outputs.append(stone_model(batch).argmax(1).cpu())
 sync();result['stonePassMs']=(time.perf_counter()-t)*1000;labels=torch.cat(outputs).tolist();result['board']=''.join('.BW'[label>>1] for label in labels);result['counts']={c:result['board'].count(c) for c in '.BW'};result['handlerMs']=(time.perf_counter()-started)*1000;return result
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--samples',required=True);p.add_argument('--image-dir',required=True);p.add_argument('--output',required=True);a=p.parse_args();results=[]
 for sample in json.loads(Path(a.samples).read_text()):
  try:r=run(Path(a.image_dir)/sample['file'],sample['id'])
  except Exception as e:r={'id':sample['id'],'error':str(e)}
  results.append(r);print(json.dumps({k:v for k,v in r.items() if k!='board'}),flush=True)
 Path(a.output).write_text(json.dumps({'model':'image2sgf-v0.07','importMs':IMPORT_MS,'modelInitMs':INIT_MS,'results':results},indent=2))
