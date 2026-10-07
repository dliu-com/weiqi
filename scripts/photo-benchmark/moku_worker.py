"""Private automatic Moku v4 evaluation. No supplied/manual corner coordinates.
Model: kaya-go/moku-v4 (AGPL-3.0), revision 0449e6af8c67c24c0709752970dc2d4205314a43.
Uses a corner pass then rectified stone pass. Inference events contain no labels.
"""
import time
_IMPORT_START=time.perf_counter()
import os,json,io,hashlib
from pathlib import Path
import numpy as np
from PIL import Image,ImageOps
if os.getenv('GPU')=='1':
 import torch  # Loads the DLAMI CUDA/cuDNN libraries before ONNX Runtime.
import onnxruntime as ort
import boto3
IMPORT_MS=(time.perf_counter()-_IMPORT_START)*1000
PIN='1cb25057bbc433f4db6838ce28a4dfa9c1ffb2d9b7e0d078aa437eb9ae79dc94'
_SESSION=None
_S3=None

def homography(src,dst):
 a=[];b=[]
 for (x,y),(u,v) in zip(src,dst):
  a.extend([[x,y,1,0,0,0,-u*x,-u*y],[0,0,0,x,y,1,-v*x,-v*y]]);b.extend([u,v])
 return np.r_[np.linalg.solve(a,b),1].reshape(3,3)
def s3():
 global _S3
 if _S3 is None:_S3=boto3.client('s3')
 return _S3
def session():
 global _SESSION
 times={}
 if _SESSION is not None:return _SESSION,times
 p=Path(os.getenv('MODEL_PATH','/tmp/model-v4.onnx'));t=time.perf_counter()
 if not p.exists():s3().download_file(os.environ['BUCKET'],os.environ['PREFIX']+'/model-v4.onnx',str(p))
 if hashlib.sha256(p.read_bytes()).hexdigest()!=PIN:raise ValueError('Wrong model checksum')
 times['modelDownloadAndHashMs']=(time.perf_counter()-t)*1000
 options=ort.SessionOptions();options.intra_op_num_threads=int(os.getenv('THREADS','2'));options.graph_optimization_level=ort.GraphOptimizationLevel.ORT_ENABLE_ALL
 providers=['CUDAExecutionProvider','CPUExecutionProvider'] if os.getenv('GPU')=='1' else ['CPUExecutionProvider'];t=time.perf_counter()
 _SESSION=ort.InferenceSession(str(p),sess_options=options,providers=providers)
 if os.getenv('GPU')=='1' and _SESSION.get_providers()[0]!='CUDAExecutionProvider':raise RuntimeError('CUDA provider did not activate')
 times['sessionInitMs']=(time.perf_counter()-t)*1000
 return _SESSION,times
def predict(model,img):
 image=np.asarray(img.resize((640,640),Image.Resampling.BILINEAR),dtype=np.float32)/255
 result=model.run(None,{model.get_inputs()[0].name:np.transpose(image,(2,0,1))[None]})
 return {o.name:v for o,v in zip(model.get_outputs(),result)}
def corners(result,w,h):
 pts=np.asarray(result['corner_points']).reshape(-1,3);chosen=[]
 for x,y,c in pts[np.argsort(-pts[:,2])]:
  if c<.005:continue
  q=np.array([float(x*w),float(y*h)])
  if all(np.linalg.norm(q-p)>.05*np.hypot(w,h) for p in chosen):chosen.append(q)
  if len(chosen)==4:break
 if len(chosen)!=4:raise ValueError(f'Automatic corner detection found {len(chosen)} distinct corners')
 pts=np.array(chosen);center=pts.mean(axis=0);pts=pts[np.argsort(np.arctan2(pts[:,1]-center[1],pts[:,0]-center[0]))];pts=np.roll(pts,-np.argmin(pts.sum(axis=1)),axis=0)
 edge1=pts[1]-pts[0];edge2=pts[3]-pts[0]
 if abs(edge1[0]*edge2[1]-edge1[1]*edge2[0])<w*h*.04:raise ValueError('Automatic corner quadrilateral too small')
 return pts

def classify(result,grid,w,h):
 H=homography(grid,[(0,0),(18,0),(18,18),(0,18)]);board=['.']*361;confidence=np.zeros(361)
 logits=np.asarray(result['logits']).reshape(-1,3);boxes=np.asarray(result['pred_boxes']).reshape(-1,4)
 probs=1/(1+np.exp(-np.clip(logits,-80,80)));labels=probs.argmax(axis=1);scores=probs.max(axis=1)
 for k in np.argsort(-scores):
  if labels[k]>1 or scores[k]<.035:continue
  p=H@np.array([boxes[k,0]*w,boxes[k,1]*h,1]);x,y=p[:2]/p[2];col,row=int(round(x)),int(round(y))
  if not 0<=col<19 or not 0<=row<19 or abs(x-col)>.5 or abs(y-row)>.5:continue
  idx=row*19+col
  if scores[k]>confidence[idx]:board[idx]='B' if labels[k]==0 else 'W';confidence[idx]=scores[k]
 return ''.join(board)

def handler(event,context=None):
 started=time.perf_counter();model,init=session();t=time.perf_counter()
 if event.get('path'):raw=Path(event['path']).read_bytes()
 else:
  key=event['key']
  if not key.startswith(os.environ['PREFIX']+'/images/'):raise ValueError('Outside benchmark prefix')
  raw=s3().get_object(Bucket=os.environ['BUCKET'],Key=key)['Body'].read()
 fetch=(time.perf_counter()-t)*1000;t=time.perf_counter();img=ImageOps.exif_transpose(Image.open(io.BytesIO(raw))).convert('RGB');decode=(time.perf_counter()-t)*1000
 t=time.perf_counter();result=predict(model,img);first=(time.perf_counter()-t)*1000
 out={'id':event.get('id'),'providers':model.get_providers(),'importMs':IMPORT_MS if init else 0,'init':init,'fetchMs':fetch,'decodeMs':decode,'cornerPassMs':first}
 try:
  grid=corners(result,*img.size);out['corners']=grid.tolist();out['directBoard']=classify(result,grid,*img.size)
  target=np.array([(64,64),(735,64),(735,735),(64,735)]);H=homography(grid,target);inv=np.linalg.inv(H);inv/=inv[2,2];t=time.perf_counter()
  warped=img.transform((800,800),Image.Transform.PERSPECTIVE,inv.ravel()[:8],Image.Resampling.BILINEAR);out['rectifyMs']=(time.perf_counter()-t)*1000;t=time.perf_counter()
  final=predict(model,warped);out['stonePassMs']=(time.perf_counter()-t)*1000;out['board']=classify(final,target,800,800);out['counts']={c:out['board'].count(c) for c in ['B','W','.']}
 except ValueError as error:out['error']=str(error)
 out['handlerMs']=(time.perf_counter()-started)*1000;out['completedAtEpoch']=time.time();return out

if __name__=='__main__':
 import argparse
 parser=argparse.ArgumentParser();parser.add_argument('--samples',required=True);parser.add_argument('--image-dir',required=True);parser.add_argument('--output',required=True);args=parser.parse_args()
 samples=json.loads(Path(args.samples).read_text());results=[]
 for item in samples:
  result=handler({'id':item['id'],'path':str(Path(args.image_dir)/item['file'])});results.append(result);print(json.dumps({k:v for k,v in result.items() if k not in ('board','directBoard')}),flush=True)
 Path(args.output).write_text(json.dumps({'model':'moku-v4','results':results},indent=2))
