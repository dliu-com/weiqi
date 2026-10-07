"""Automatic corner selection and robust lattice fitting, AGPL-3.0-only.
Uses only detector outputs, never benchmark labels or manual corners.
A lattice score ranks geometry; it is not a stone-accuracy probability.
"""
import itertools
import numpy as np

def homography(src,dst):
 rows=[];values=[]
 for (x,y),(u,v) in zip(src,dst):
  rows.extend([[x,y,1,0,0,0,-u*x,-u*y],[0,0,0,x,y,1,-v*x,-v*y]])
  values.extend([u,v])
 return np.r_[np.linalg.solve(rows,values),1].reshape(3,3)

def ordered(p):
 p=np.asarray(p);c=p.mean(0);p=p[np.argsort(np.arctan2(p[:,1]-c[1],p[:,0]-c[0]))];return np.roll(p,-np.argmin(p.sum(1)),axis=0)
def fit(src,dst,weights):
 x,y=src.T;u,v=dst.T;one=np.ones(len(x));zero=np.zeros(len(x));a=np.empty((2*len(x),8));a[::2]=np.array([x,y,one,zero,zero,zero,-u*x,-u*y]).T;a[1::2]=np.array([zero,zero,zero,x,y,one,-v*x,-v*y]).T;b=np.empty(2*len(x));b[::2]=u;b[1::2]=v;w=np.repeat(np.sqrt(weights),2);return np.r_[np.linalg.lstsq(a*w[:,None],b*w,rcond=None)[0],1].reshape(3,3)
def select_grid(data, original):
 probs=1/(1+np.exp(-np.clip(data['logits'].reshape(-1,3),-80,80)));scores=probs.max(1);labels=probs.argmax(1);sel=(labels<2)&(scores>.035);xy=data['pred_boxes'].reshape(-1,4)[sel,:2];weights=scores[sel]
 if len(xy)<12:
  if original is None:raise ValueError('Too few stones to verify the grid')
  return original,None
 points=np.c_[xy,np.ones(len(xy))];peaks=data['corner_points'].reshape(-1,3);qs=peaks[peaks[:,2]>.005,:2];target=np.array([(0,0),(18,0),(18,18),(0,18)])
 def quality(H):
  z=points@H.T
  if not np.isfinite(z).all() or np.any(np.abs(z[:,2])<1e-7):return 0,np.zeros_like(xy),np.ones(len(xy)),np.zeros(len(xy),dtype=bool)
  z=z[:,:2]/z[:,2:];rounded=np.rint(z);err=np.max(np.abs(z-rounded),axis=1);good=(rounded.min(1)>=0)&(rounded.max(1)<=18);val=weights*good*np.maximum(0,1-err/.5);keys=(rounded[:,1]*19+rounded[:,0]).astype(int);best={}
  for k,v in zip(keys,val):best[k]=max(best.get(k,0),v)
  return sum(best.values())/weights.sum(),z,err,good
 candidates=[ordered(qs[list(ids)]) for ids in itertools.combinations(range(len(qs)),4)]
 for ids in itertools.combinations(range(len(qs)),3):
  p=qs[list(ids)]
  for d in range(3):candidates.append(ordered(np.vstack([p,p[(d+1)%3]+p[(d+2)%3]-p[d]])))
 ranked=[]
 for q in candidates:
  edges=np.roll(q,-1,axis=0)-q;cross=edges[:,0]*np.roll(edges,-1,axis=0)[:,1]-edges[:,1]*np.roll(edges,-1,axis=0)[:,0]
  if np.any(cross<=0) or np.min(np.linalg.norm(edges,axis=1))<.12 or q.min()<-.08 or q.max()>1.08:continue
  try:H=homography(q,target)
  except np.linalg.LinAlgError:continue
  baseline,_,_,_=quality(H)
  if baseline<.25:continue
  for _ in range(6):
   val,z,err,good=quality(H);keep=good&(err<.32)
   if keep.sum()<25:break
   nextH=fit(xy[keep],np.rint(z[keep]),weights[keep]*(1-err[keep]**2));nextval,*_=quality(nextH)
   try:
    invH=np.linalg.inv(nextH);quad=np.c_[target,np.ones(4)]@invH.T;quad=quad[:,:2]/quad[:,2:]
   except np.linalg.LinAlgError:break
   if nextval<=val or np.max(np.linalg.norm(quad-q,axis=1))>.09:break
   H=nextH
  val,*_=quality(H); ranked.append((val,H))
 if not ranked:raise ValueError('Could not verify a consistent 19 × 19 grid')
 val,H=max(ranked,key=lambda x:x[0])
 if val<.5:raise ValueError('The board grid is uncertain. No position was imported.')
 try:
  if original is None:raise ValueError('No original quad')
  oldH=homography(original,target);oldVal,*_=quality(oldH)
  if oldVal>.60 and val<oldVal+.06:return original,oldVal
 except (ValueError,np.linalg.LinAlgError):pass
 inv=np.linalg.inv(H);q=np.c_[target,np.ones(4)]@inv.T;return q[:,:2]/q[:,2:],val

# Moku reports only eight corner peaks; near-duplicates can crowd out a real corner.
# A pass on the mirrored photo proposes a different set, mapped back and merged.
def merge_corner_peaks(result,mirrored):
 extra=np.asarray(mirrored['corner_points'],dtype=float).reshape(-1,3).copy();extra[:,0]=1-extra[:,0]
 peaks=np.vstack([np.asarray(result['corner_points'],dtype=float).reshape(-1,3),extra]);kept=[]
 for p in peaks[np.argsort(-peaks[:,2])]:
  if p[2]>.005 and all(np.hypot(*(p[:2]-k[:2]))>.03 for k in kept):kept.append(p)
 return {**result,'corner_points':np.array(kept).reshape(-1,3)}

# Legacy fallback used by scripts/photo-benchmark/patch_models.py.
# Recover only low-score detections backed by a large, matching colour patch.
# Pixels alone are insufficient: hands and clothing can look like stones.
def supplement_stones(image,board,raw):
 scores=1/(1+np.exp(-np.clip(raw['logits'].reshape(-1,3),-80,80)));boxes=raw['pred_boxes'].reshape(-1,4);labels=scores.argmax(1);best=scores.max(1)
 a=np.asarray(image,dtype=float)/255;step=671/18;changes=[]
 for y in range(19):
  for x in range(19):
   cx,cy=64+x*step,64+y*step;loX,loY=int(cx-10),int(cy-10);hiX,hiY=int(cx+11),int(cy+11);yy,xx=np.mgrid[loY:hiY,loX:hiX];disk=(xx-cx)**2+(yy-cy)**2<(.24*step)**2;p=a[loY:hiY,loX:hiX][disk];v=p.max(1);s=(v-p.min(1))/np.maximum(v,.01);b=(v<.38).mean();w=((v>.5)&(s<.23)).mean();i=y*19+x
   c='B' if b>.82 else 'W' if w>.82 else '.'
   near=np.max(np.abs(boxes[:,:2]*800-np.array([cx,cy])),axis=1)<step*.25;candidate=near&(labels==(0 if c=='B' else 1))&(best>.008)&(boxes[:,2]>.025)&(boxes[:,3]>.025)
   if c!='.' and board[i]=='.' and candidate.any():changes.append((i,c,round(b,2),round(w,2)))
 result=list(board)
 for i,colour,*_ in changes:result[i]=colour
 return ''.join(result)
