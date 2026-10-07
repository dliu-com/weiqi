"""Deterministic, labelled synthetic Go photos. These are not real-photo ground truth.
Usage: python render-fixtures.py OUTPUT_DIRECTORY
References are kept separately; inference must receive only images.
"""
import json,sys,hashlib
from pathlib import Path
import numpy as np
from PIL import Image,ImageDraw,ImageFilter
out=Path(sys.argv[1]); data=json.loads((out/'positions.json').read_text()); rng=np.random.default_rng(742)
S=1000; lo=62; hi=938; step=(hi-lo)/18

def homography(src,dst):
 a=[]; b=[]
 for (x,y),(u,v) in zip(src,dst):
  a.extend([[x,y,1,0,0,0,-u*x,-u*y],[0,0,0,x,y,1,-v*x,-v*y]]);b.extend([u,v])
 return np.r_[np.linalg.solve(a,b),1].reshape(3,3)
def mapxy(H,p):
 q=H@np.r_[p,1];return (q[:2]/q[2]).tolist()
def render(board):
 y,x=np.mgrid[:S,:S];grain=2.8*np.sin(x*.18+.003*y)+1.2*np.sin(x*.57)+rng.normal(0,.65,(S,S))
 wood=np.stack([198+grain,158+grain,95+grain],axis=2).clip(0,255).astype('uint8');img=Image.fromarray(wood);d=ImageDraw.Draw(img)
 for n in range(19):
  q=lo+n*step;d.line((lo,q,hi,q),fill=(65,48,27),width=2);d.line((q,lo,q,hi),fill=(65,48,27),width=2)
 for row in [3,9,15]:
  for col in [3,9,15]:
   cx=lo+col*step;cy=lo+row*step;d.ellipse((cx-5,cy-5,cx+5,cy+5),fill=(52,39,21))
 for idx,colour in enumerate(board):
  if colour=='.':continue
  cx=lo+(idx%19)*step;cy=lo+(idx//19)*step;r=step*.465
  d.ellipse((cx-r+3,cy-r+4,cx+r+3,cy+r+4),fill=(105,78,38))
  yy,xx=np.mgrid[int(cy-r):int(cy+r)+2,int(cx-r):int(cx+r)+2];nx=(xx-cx)/r;ny=(yy-cy)/r;mask=nx*nx+ny*ny<=1
  z=np.sqrt(np.maximum(0,1-nx*nx-ny*ny));light=np.maximum(0,-.38*nx-.5*ny+.77*z);spec=np.exp(-((nx+.25)**2+(ny+.35)**2)/.06)
  shades=(12+39*light+13*spec) if colour=='B' else (192+53*light+6*spec)
  rgb=np.repeat(shades[...,None],3,axis=2).clip(0,255).astype('uint8');tile=Image.fromarray(rgb);img.paste(tile,(int(cx-r),int(cy-r)),Image.fromarray((mask*255).astype('uint8')))
 return img
cases=[('flat',[(100,100),(1100,100),(1100,1100),(100,1100)],0,1,95),('perspective',[(175,110),(1090,295),(1030,1120),(85,1035)],0,1,92),('shadow',[(100,130),(1070,100),(1120,1080),(140,1120)],0,.68,85),('blur',[(130,100),(1100,190),(1060,1110),(95,1080)],1.2,1,82),('low-resolution',[(165,100),(1090,285),(1050,1130),(90,1050)],.5,1,60)]
references=[];inference=[]
for pos in data['positions']:
 base=render(pos['board'])
 for name,dst,blur,shade,quality in cases:
  H=homography([(0,0),(S-1,0),(S-1,S-1),(0,S-1)],dst);inv=np.linalg.inv(H);inv/=inv[2,2]
  canvas=Image.new('RGB',(1200,1200),(174,176,174)); warped=base.transform(canvas.size,Image.Transform.PERSPECTIVE,inv.ravel()[:8],Image.Resampling.BICUBIC)
  mask=Image.new('L',base.size,255).transform(canvas.size,Image.Transform.PERSPECTIVE,inv.ravel()[:8],Image.Resampling.BICUBIC);canvas.paste(warped,(0,0),mask)
  if shade!=1:
   a=np.array(canvas,dtype=float);grad=np.linspace(shade,1.04,1200)[None,:,None];canvas=Image.fromarray((a*grad).clip(0,255).astype('uint8'))
  if blur:canvas=canvas.filter(ImageFilter.GaussianBlur(blur))
  factor=1
  if name=='low-resolution':factor=.4;canvas=canvas.resize((480,480),Image.Resampling.LANCZOS)
  sample_id=f'move-{pos["depth"]}-{name}';file=sample_id+'.jpg';canvas.save(out/file,quality=quality)
  corners=[[v*factor for v in mapxy(H,p)] for p in [(lo,lo),(hi,lo),(hi,hi),(lo,hi)]]
  references.append({'id':sample_id,'file':file,'move':pos['depth'],'condition':name,'board':pos['board'],'corners':corners,'sha256':hashlib.sha256((out/file).read_bytes()).hexdigest()})
  inference.append({'id':sample_id,'file':file})
(out/'references.json').write_text(json.dumps({'kind':'synthetic; not a measure of physical-phone or real-photo accuracy','seed':742,'samples':references},indent=2))
(out/'samples.json').write_text(json.dumps(inference,indent=2));print(f'Rendered {len(references)} labelled images from {len(data["positions"])} positions.')
