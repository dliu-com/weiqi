"""Stone reading on the squared-up board, AGPL-3.0-only.
Uses only Moku outputs and the uploaded photo's own pixels, never benchmark labels.
Thresholds were chosen on four real photos checked against an independent
recogniser; see scripts/photo-benchmark/README.md for that benchmark and its limits.
"""
import numpy as np
from grid import fit

SIZE,MARGIN=800,64
STEP=(SIZE-2*MARGIN)/18
TILE=500             # 2 × 2 overlapping crops: one Moku pass returns at most 300 objects.
TILE_EDGE=.7         # Squares; stones cut by an inner crop edge are left to the other passes.
TOLERANCE=.35        # Squares from an intersection after the lattice refit.
MIN_WIDTH=.89        # Of the pass's median confident stone width; rejects small stickers/markers.
FULL_SCORE,TILE_SCORE,MIN_SCORE=.035,.05,.02
REFERENCE_SCORE,NEIGHBOURS=.06,8
COLOUR_SHARE=(.5,.6) # Black, white: share of pixels nearer that stone colour than the alternatives.
DUPLICATE=.7         # Squares; a tall stone seen at an angle can also fire on the next point.
LOW_SCORE,NEAR_SHARE=.05,.2

def crops():
 starts=np.linspace(0,SIZE-TILE,2).astype(int)
 return [(int(x),int(y)) for y in starts for x in starts]

def detections(result,width,height,offset=(0,0)):
 probs=1/(1+np.exp(-np.clip(np.asarray(result['logits']).reshape(-1,3),-80,80)));boxes=np.asarray(result['pred_boxes']).reshape(-1,4)
 labels=probs.argmax(1);scores=probs.max(1);keep=(labels<2)&(scores>=.005)
 return np.c_[boxes[keep,0]*width+offset[0],boxes[keep,1]*height+offset[1],boxes[keep,2]*width,boxes[keep,3]*height,labels[keep],scores[keep]]

def tile_detections(tiles):
 parts=[np.zeros((0,6))]
 for (x0,y0),result in tiles:
  d=detections(result,TILE,TILE,(x0,y0));x1,y1=x0+TILE,y0+TILE
  edge=np.minimum.reduce([np.where(x0>0,d[:,0]-x0,1e9),np.where(x1<SIZE,x1-d[:,0],1e9),np.where(y0>0,d[:,1]-y0,1e9),np.where(y1<SIZE,y1-d[:,1],1e9)])/STEP
  parts.append(d[edge>=TILE_EDGE])
 return np.vstack(parts)

# Stone centres sit above the board plane, so refit the lattice to them.
def lattice(d):
 g=(d[:,:2]-MARGIN)/STEP;H=np.eye(3)
 for _ in range(4):
  z=project(g,H);r=np.rint(z);keep=(np.abs(z-r).max(1)<.4)&(r.min(1)>=0)&(r.max(1)<=18)&(d[:,5]>=FULL_SCORE)
  if keep.sum()<12:break
  H=fit(g[keep],r[keep],d[keep,5])
 return H

def project(g,H):
 z=np.c_[g,np.ones(len(g))]@H.T;return z[:,:2]/z[:,2:]

def evidence(d,H):
 best=np.zeros((361,2));centres=np.zeros((361,2,2));seen=np.zeros(361)
 if not len(d):return best,centres,seen
 strong=d[d[:,5]>=.05,2];width=np.median(strong) if len(strong)>=8 else np.median(d[:,2])
 z=project((d[:,:2]-MARGIN)/STEP,H);r=np.rint(z).astype(int);err=np.abs(z-r).max(1);inside=(r.min(1)>=0)&(r.max(1)<=18);point=r[:,1]*19+r[:,0]
 for k in np.where(inside&(err<=.5))[0]:seen[point[k]]=max(seen[point[k]],d[k,5])
 for k in np.where(inside&(err<=TOLERANCE)&(d[:,5]>=MIN_SCORE)&(d[:,2]>=MIN_WIDTH*width))[0]:
  i,j=point[k],int(d[k,4])
  if d[k,5]>best[i,j]:best[i,j]=d[k,5];centres[i,j]=d[k,:2]
 return best,centres,seen

def disk(pixels,x,y):
 radius=.28*STEP;x0,y0=max(0,int(x-radius)),max(0,int(y-radius));x1,y1=int(x+radius)+1,int(y+radius)+1
 yy,xx=np.mgrid[y0:y1,x0:x1];patch=pixels[y0:y1,x0:x1];mask=((xx-x)**2+(yy-y)**2<=radius*radius)[:patch.shape[0],:patch.shape[1]]
 return patch[mask]

def read(image,full,tiles):
 """Return (board, review). Review lists points whose reading was marginal or overruled."""
 pixels=np.asarray(image,dtype=float)/255;full_d=detections(full,SIZE,SIZE);H=lattice(full_d)
 F,full_at,seen_f=evidence(full_d,H);T,tile_at,seen_t=evidence(tile_detections(tiles),H);S=F+T;seen=np.maximum(seen_f,seen_t)
 def centre(i,j):return full_at[i,j] if F[i,j]>=T[i,j] else tile_at[i,j]
 # Colour references come from nearby confident stones and clearly empty points, so lighting changes across the board are tolerated.
 xy=np.array([(i%19,i//19) for i in range(361)],float);refs=[]
 for j in (0,1):
  idx=np.array([i for i in range(361) if F[i,j]>=REFERENCE_SCORE and F[i,j]>=2*F[i,1-j]],int)
  refs.append((idx,np.array([np.median(disk(pixels,*centre(i,j)),0) for i in idx])))
 idx=np.array([i for i in range(361) if seen[i]<.01],int)
 refs.append((idx,np.array([np.median(disk(pixels,MARGIN+(i%19)*STEP,MARGIN+(i//19)*STEP),0) for i in idx])))
 def share(i,j):
  local=[]
  for idx,colours in refs:
   if len(idx)<3:local.append(None);continue
   near=np.argsort(np.abs(xy[idx]-xy[i]).sum(1))[:NEIGHBOURS];local.append(np.median(colours[near],0))
  if local[j] is None:return 1.0
  px=disk(pixels,*centre(i,j))
  distance=np.stack([np.linalg.norm(px-c,axis=1) if c is not None else np.full(len(px),np.inf) for c in local],1)
  return float((distance.argmin(1)==j).mean())
 board=['.']*361;confidence=np.zeros(361);review=set()
 for i in range(361):
  if F[i].max()<FULL_SCORE and T[i].max()<TILE_SCORE:continue
  j=int(S[i].argmax());fraction=share(i,j)
  if fraction<COLOUR_SHARE[j]:
   review.add(i);other=1-j
   if S[i,other]<=0 or share(i,other)<COLOUR_SHARE[other]:continue
   j=other
  elif fraction<COLOUR_SHARE[j]+NEAR_SHARE or S[i,j]<LOW_SCORE:review.add(i)
  board[i]='BW'[j];confidence[i]=S[i,j]
 for i in sorted(range(361),key=lambda i:-confidence[i]):
  if board[i]=='.':continue
  a=centre(i,'BW'.index(board[i]));x,y=i%19,i//19
  for n in [(y+dy)*19+x+dx for dy in (-1,0,1) for dx in (-1,0,1) if (dx or dy) and 0<=x+dx<19 and 0<=y+dy<19]:
   if board[n]!='.' and confidence[n]<=confidence[i] and np.linalg.norm(centre(n,'BW'.index(board[n]))-a)<DUPLICATE*STEP:board[n]='.';confidence[n]=0;review.add(n)
 return ''.join(board),sorted(int(i) for i in review)
