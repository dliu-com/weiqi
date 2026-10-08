"""Run the production recognition handler on real photos as the browser uploads them; never reads labels.

Samples are {"samples": [{"id": ..., "file": ...}]}. Each condition is applied to the decoded photo, then encoded
exactly like photo-analysis/src/main.js (3072-pixel edge, JPEG quality .88, shrink by .8 until <= 1,050,000 bytes).
Result ids are "<sample id>@<condition>"; score them with score.py against references keyed by sample id.
"""
import argparse,base64,io,json,os,sys,time
from pathlib import Path
import numpy as np
from PIL import Image,ImageEnhance,ImageFilter,ImageOps
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT/'backend/position'))
def tint(r,g,b):return lambda im:Image.merge('RGB',[ch.point(lambda v,k=k:min(255,int(v*k))) for ch,k in zip(im.split(),(r,g,b))])
def shade(im):return Image.fromarray((np.asarray(im,dtype=float)*np.linspace(.55,1,im.width)[None,:,None]).clip(0,255).astype('uint8'))
CONDITIONS={'base':lambda im:im,'edge1200':lambda im:im.resize((round(im.width*1200/max(im.size)),round(im.height*1200/max(im.size)))),
 'dark70':lambda im:ImageEnhance.Brightness(im).enhance(.7),'dark55':lambda im:ImageEnhance.Brightness(im).enhance(.55),
 'bright125':lambda im:ImageEnhance.Brightness(im).enhance(1.25),'lowcontrast':lambda im:ImageEnhance.Contrast(im).enhance(.75),
 'warm':tint(1.1,1,.82),'cool':tint(.85,.97,1.1),'shade':shade,'blur':lambda im:im.filter(ImageFilter.GaussianBlur(2)),
 'rot+4':lambda im:im.rotate(4,Image.Resampling.BILINEAR,expand=True,fillcolor=(128,128,128)),'q60':lambda im:im}
def warp(corners):
 # Simulated camera tilt: the photo's corners (TL,TR,BR,BL) move to these fractions of the frame.
 def apply(im):
  w,h=im.size;dst=[(x*w,y*h) for x,y in corners];src=[(0,0),(w,0),(w,h),(0,h)];rows=[]
  for (x,y),(u,v) in zip(dst,src):rows+=[[x,y,1,0,0,0,-u*x,-u*y],[0,0,0,x,y,1,-v*x,-v*y]]
  coeffs=np.linalg.solve(np.array(rows,float),np.array([c for p in src for c in p],float))
  return im.transform((w,h),Image.Transform.PERSPECTIVE,tuple(coeffs),Image.Resampling.BICUBIC,fillcolor=(128,128,128))
 return apply
# Opt-in (not in the default run): --conditions tilt20,tilt35,tilt50,side30
TILT={'tilt20':warp([(.075,.08),(.925,.08),(1,1),(0,1)]),'tilt35':warp([(.15,.18),(.85,.18),(1,1),(0,1)]),
 'tilt50':warp([(.225,.3),(.775,.3),(1,1),(0,1)]),'side30':warp([(.1,.12),(1,0),(1,1),(.1,.88)])}
def upload(image,quality=88,limit=1050000):
 edge=3072
 while True:
  f=min(1,edge/max(image.size));im=image.resize((round(image.width*f),round(image.height*f)),Image.Resampling.LANCZOS) if f<1 else image
  out=io.BytesIO();im.save(out,'JPEG',quality=quality);data=out.getvalue()
  if len(data)<=limit:return data
  edge=round(edge*.8)
p=argparse.ArgumentParser();p.add_argument('--samples',required=True);p.add_argument('--output',required=True);p.add_argument('--conditions',default=','.join(CONDITIONS));args=p.parse_args()
if not os.environ.get('MODEL_PATH'):raise SystemExit('Set MODEL_PATH to the pinned Moku v4 ONNX file.')
import recognize
samples=json.loads(Path(args.samples).read_text())['samples'];names=args.conditions.split(',');results=[]
CONDITIONS.update(TILT)
for name in names:
 if name not in CONDITIONS:raise SystemExit('Unknown condition: '+name)
for sample in samples:
 photo=ImageOps.exif_transpose(Image.open(Path(args.samples).parent/sample['file'])).convert('RGB')
 for name in names:
  data=upload(CONDITIONS[name](photo),60 if name=='q60' else 88);row={'id':sample['id']+'@'+name,'uploadBytes':len(data)};started=time.perf_counter()
  try:r=recognize.handler({'image':base64.b64encode(data).decode()},None);row.update({k:r[k] for k in ('board','review','counts','pipeline','gridCheck','lineCheck') if k in r})
  except Exception as e:row['error']=str(e)
  row['elapsedMs']=round((time.perf_counter()-started)*1000);results.append(row);print(row['id'],row.get('error') or row['counts'],row['elapsedMs'],'ms',flush=True)
Path(args.output).write_text(json.dumps({'conditions':names,'results':results},indent=2))
