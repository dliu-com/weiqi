"""Automatic corner selection and robust lattice fitting, AGPL-3.0-only.
Uses only detector outputs, never benchmark labels or manual corners.
A lattice score ranks geometry; it is not a stone-accuracy probability.
"""
import heapq,itertools
import numpy as np
from PIL import Image

def homography(src,dst):
 rows=[];values=[]
 for (x,y),(u,v) in zip(src,dst):
  rows.extend([[x,y,1,0,0,0,-u*x,-u*y],[0,0,0,x,y,1,-v*x,-v*y]])
  values.extend([u,v])
 return np.r_[np.linalg.solve(rows,values),1].reshape(3,3)

def ordered(p):
 p=np.asarray(p);c=p.mean(0);p=p[np.argsort(np.arctan2(p[:,1]-c[1],p[:,0]-c[0]))];return np.roll(p,-np.argmin(p.sum(1)),axis=0)
UPRIGHT_CLEAR=30             # Degrees of in-plane board rotation below which a corner order is clearly upright.
# In-plane rotation of a clockwise quad's board, in degrees, from its averaged edge directions.
def rotation(quad):
 p=np.asarray(quad,dtype=float);across=(p[1]-p[0])+(p[2]-p[3]);down=(p[3]-p[0])+(p[2]-p[1])
 d=across/max(np.hypot(*across),1e-9)+np.array([down[1],-down[0]])/max(np.hypot(*down),1e-9);return float(np.degrees(np.arctan2(d[1],d[0])))
# The corner nearest the image's top left is unreliable once a board is turned well past 45°
# (a near-side corner can win by a few pixels). Roll the corners when another order is clearly
# upright; boards turned about 45° either way keep the image-corner order.
def upright(quad):
 q=np.asarray(quad,dtype=float);k=min(range(4),key=lambda k:abs(rotation(np.roll(q,-k,axis=0))))
 return np.roll(q,-k,axis=0) if abs(rotation(np.roll(q,-k,axis=0)))<=UPRIGHT_CLEAR else q
# Weighted least-squares homography; weights per point, or per point and axis as (N, 2).
def fit(src,dst,weights):
 x,y=src.T;u,v=dst.T;one=np.ones(len(x));zero=np.zeros(len(x));a=np.empty((2*len(x),8));a[::2]=np.array([x,y,one,zero,zero,zero,-u*x,-u*y]).T;a[1::2]=np.array([zero,zero,zero,x,y,one,-v*x,-v*y]).T;b=np.empty(2*len(x));b[::2]=u;b[1::2]=v;w=np.sqrt(np.asarray(weights,dtype=float));w=np.repeat(w,2) if w.ndim==1 else w.ravel();return np.r_[np.linalg.lstsq(a*w[:,None],b*w,rcond=None)[0],1].reshape(3,3)
TARGET=np.array([(0,0),(18,0),(18,18),(0,18)])
def stone_points(data,threshold=.035):
 probs=1/(1+np.exp(-np.clip(np.asarray(data['logits']).reshape(-1,3),-80,80)));scores=probs.max(1);labels=probs.argmax(1);sel=(labels<2)&(scores>threshold)
 return np.asarray(data['pred_boxes']).reshape(-1,4)[sel,:2],scores[sel]
# Weighted circular mean of the fractional lattice coordinates, in cells within (-.5, .5].
def lattice_offset(z,weights):
 phase=2*np.pi*np.asarray(z);w=np.asarray(weights)[:,None]
 return np.arctan2((w*np.sin(phase)).sum(0),(w*np.cos(phase)).sum(0))/(2*np.pi)
# Weighted share of stones on distinct intersections. With parallax, one global shift
# of up to that many cells is removed first: on a low camera angle tall stones appear
# displaced from their intersections, which otherwise rejects the correct grid.
def lattice_quality(xy,weights,parallax=0):
 points=np.c_[xy,np.ones(len(xy))]
 def quality(H):
  z=points@H.T;offset=np.zeros(2)
  if not np.isfinite(z).all() or np.any(np.abs(z[:,2])<1e-7):return 0,np.zeros_like(xy),np.ones(len(xy)),np.zeros(len(xy),dtype=bool),offset
  z=z[:,:2]/z[:,2:]
  if parallax:
   inside=(z.min(1)>-.5)&(z.max(1)<18.5)
   if inside.sum()>=6:offset=np.clip(lattice_offset(z[inside],weights[inside]),-parallax,parallax)
   z=z-offset
  rounded=np.rint(z);err=np.max(np.abs(z-rounded),axis=1);good=(rounded.min(1)>=0)&(rounded.max(1)<=18);val=weights*good*np.maximum(0,1-err/.5);keys=(rounded[:,1]*19+rounded[:,0]).astype(int)
  # Best value per intersection, summed in first-seen order so results match a plain loop exactly.
  ids,first,inverse=np.unique(keys,return_index=True,return_inverse=True);best=np.zeros(len(ids));np.maximum.at(best,inverse,val)
  return sum(best[np.argsort(first)].tolist())/weights.sum(),z,err,good,offset
 return quality
# Every 4-peak quad and every 3-peak parallelogram, each refined by a lattice refit. `cache`
# keeps each candidate's outcome for these stones, so re-ranking with a few new peaks is cheap.
def rank_grids(data,parallax=0,cache=None):
 xy,weights=stone_points(data);quality=lattice_quality(xy,weights,parallax)
 peaks=np.asarray(data['corner_points']).reshape(-1,3);qs=peaks[peaks[:,2]>.005,:2]
 candidates=[ordered(qs[list(ids)]) for ids in itertools.combinations(range(len(qs)),4)]
 for ids in itertools.combinations(range(len(qs)),3):
  p=qs[list(ids)]
  for d in range(3):candidates.append(ordered(np.vstack([p,p[(d+1)%3]+p[(d+2)%3]-p[d]])))
 ranked=[];cache={} if cache is None else cache
 for q in candidates:
  key=q.tobytes()
  if key not in cache:cache[key]=refined(q,xy,weights,quality)
  if cache[key] is not None:ranked.append(cache[key])
 return ranked,quality
# One candidate quad refined by lattice refits: (quality, H), or None when it is rejected.
def refined(q,xy,weights,quality):
 target=TARGET;edges=np.roll(q,-1,axis=0)-q;cross=edges[:,0]*np.roll(edges,-1,axis=0)[:,1]-edges[:,1]*np.roll(edges,-1,axis=0)[:,0]
 if np.any(cross<=0) or np.min(np.linalg.norm(edges,axis=1))<.12 or q.min()<-.08 or q.max()>1.08:return None
 try:H=homography(q,target)
 except np.linalg.LinAlgError:return None
 baseline=quality(H)[0]
 if baseline<.25:return None
 for _ in range(6):
  val,z,err,good,offset=quality(H);keep=good&(err<.32)
  if keep.sum()<25:break
  nextH=fit(xy[keep],np.rint(z[keep])+offset,weights[keep]*(1-err[keep]**2));nextval=quality(nextH)[0]
  try:
   invH=np.linalg.inv(nextH);quad=np.c_[target,np.ones(4)]@invH.T;quad=quad[:,:2]/quad[:,2:]
  except np.linalg.LinAlgError:break
  if nextval<=val or np.max(np.linalg.norm(quad-q,axis=1))>.09:break
  H=nextH
 return quality(H)[0],H
def corners_of(H):
 inv=np.linalg.inv(H);q=np.c_[TARGET,np.ones(4)]@inv.T;return q[:,:2]/q[:,2:]
def select_grid(data, original):
 xy,_=stone_points(data)
 if len(xy)<12:
  if original is None:raise ValueError('Too few stones to verify the grid')
  return original,None
 ranked,quality=rank_grids(data)
 if not ranked:raise ValueError('Could not verify a consistent 19 × 19 grid')
 val,H=max(ranked,key=lambda x:x[0])
 if val<.5:raise ValueError('The board grid is uncertain. No position was imported.')
 try:
  if original is None:raise ValueError('No original quad')
  oldH=homography(original,TARGET);oldVal=quality(oldH)[0]
  if oldVal>.60 and val<oldVal+.06:return original,oldVal
 except (ValueError,np.linalg.LinAlgError):pass
 return corners_of(H),val

# Rescue for photos whose grid cannot be verified from the whole-photo pass: the board is
# small, rotated, or seen at a low angle among bowls and hands. Moku finds corners best when
# the board nearly fills its input, so square views are rerun around the densest stone
# detections and then re-framed on the best grid so far. Corner peaks are pooled across views:
# one view often misses a corner that another finds.
PARALLAX=.45                 # Cells of global stone-centre shift tolerated when scoring rescue grids.
# Views tried in order, each one Moku pass, as (scale, in-plane rotation in degrees). A number
# scales the stone-cluster estimate of the board; None frames the best grid found so far
# with RESCUE_MARGIN. Moku finds corners best when the board fills most of the view, and
# rotated views propose different corner peaks, which helps tilted boards.
RESCUE_PLAN=((1.25,0),(1.6,0),(None,15),(None,-15),(1.1,30),(1.1,-30))
RESCUE_MARGIN=1.08
RESCUE_ACCEPT,RESCUE_ENOUGH=.5,.55   # Best rescue quality needed; quality that ends the search early.
RESCUE_MIN_DETECTIONS=12     # Weak (score >= .01) stone detections needed to locate a board.
RESCUE_PEAKS=12              # Most pooled corner peaks ranked together.

def smooth(a,sigma):
 r=int(3*sigma);k=np.exp(-.5*(np.arange(-r,r+1)/sigma)**2);k/=k.sum()
 a=np.apply_along_axis(lambda v:np.convolve(v,k,'same'),0,a);return np.apply_along_axis(lambda v:np.convolve(v,k,'same'),1,a)
# Square (centre x, centre y, side) in pixels around the densest cluster of even weak stone
# detections; a small board in a busy photo still produces many low-score stone boxes.
def board_region(data,w,h,threshold=.01,bins=48,keep=.8):
 xy,weights=stone_points(data,threshold)
 if len(xy)<RESCUE_MIN_DETECTIONS:return None
 xy=xy*[w,h];cell=max(w,h)/bins;nx,ny=int(np.ceil(w/cell)),int(np.ceil(h/cell));hist=np.zeros((ny,nx))
 np.add.at(hist,(np.clip((xy[:,1]/cell).astype(int),0,ny-1),np.clip((xy[:,0]/cell).astype(int),0,nx-1)),weights)
 density=smooth(hist,2.);iy,ix=np.unravel_index(density.argmax(),density.shape);peak=np.array([(ix+.5)*cell,(iy+.5)*cell])
 d=np.hypot(*(xy-peak).T);order=np.argsort(d);total=weights[d<.35*max(w,h)].sum()
 radius=d[order][min(len(d)-1,np.searchsorted(np.cumsum(weights[order]),keep*total))];inside=xy[d<=radius]
 low,high=inside.min(0),inside.max(0);side=max(high-low)
 if side<=0:return None
 return float((low[0]+high[0])/2),float((low[1]+high[1])/2),float(side)
# Square (centre x, centre y, side) just containing a pixel quad.
def frame(quad,margin=RESCUE_MARGIN):
 low,high=np.min(quad,0),np.max(quad,0);return float((low[0]+high[0])/2),float((low[1]+high[1])/2),float(max(high-low)*margin)
# Affine map from pixels of an out × out view to source pixels: a square of `size` source
# pixels centred on (cx, cy) whose content is rotated by `angle` degrees counter-clockwise.
def view_transform(cx,cy,size,angle=0,out=640):
 a=np.deg2rad(angle);s=size/out;c,si=np.cos(a),np.sin(a)
 M=np.array([[s*c,s*si,0],[-s*si,s*c,0],[0,0,1]])@np.array([[1,0,-out/2],[0,1,-out/2],[0,0,1]]);M[0,2]+=cx;M[1,2]+=cy;return M
# Express a Moku result on a view in the source photo's normalised coordinates.
def view_to_source(result,M,w,h,out=640):
 boxes=np.asarray(result['pred_boxes'],dtype=float).reshape(-1,4).copy();p=np.c_[boxes[:,:2]*out,np.ones(len(boxes))]@M.T;scale=np.sqrt(abs(np.linalg.det(M[:2,:2])))
 boxes[:,0]=p[:,0]/w;boxes[:,1]=p[:,1]/h;boxes[:,2]*=out*scale/w;boxes[:,3]*=out*scale/h
 peaks=np.asarray(result['corner_points'],dtype=float).reshape(-1,3).copy();p=np.c_[peaks[:,:2]*out,np.ones(len(peaks))]@M.T;peaks[:,0]=p[:,0]/w;peaks[:,1]=p[:,1]/h
 return {'logits':np.asarray(result['logits']).reshape(-1,3),'pred_boxes':boxes,'corner_points':peaks}
# Corner peaks from several groups, strongest first within each group, with earlier groups
# taking precedence, dropping near-duplicates and keeping at most `limit`.
def pooled_peaks(groups,limit=RESCUE_PEAKS,separation=.03):
 kept=[]
 for group in groups:
  peaks=np.asarray(group,dtype=float).reshape(-1,3)
  for p in peaks[np.argsort(-peaks[:,2])]:
   if len(kept)<limit and p[2]>.005 and all(np.hypot(*(p[:2]-k[:2]))>separation for k in kept):kept.append(p)
 return np.array(kept).reshape(-1,3)
# Best parallax-tolerant grid over view results (source coordinates). Each view's stones are
# ranked with its own corner peaks plus the strongest peaks from the other views.
# Returns (quality, normalised quad, that view's result) or None. Pass the same `cache` dict
# while views are added so earlier views' candidates are not refitted again.
def rescue_grid(results,cache=None):
 best=None;cache={} if cache is None else cache
 for i,result in enumerate(results):
  others=[r['corner_points'] for j,r in enumerate(results) if j!=i]
  peaks=pooled_peaks([result['corner_points'],np.vstack(others).reshape(-1,3) if others else np.zeros((0,3))])
  ranked,_=rank_grids({**result,'corner_points':peaks},PARALLAX,cache.setdefault(i,{}))
  if ranked:
   val,H=max(ranked,key=lambda x:x[0])
   if best is None or val>best[0]:best=(val,corners_of(H),result)
 return best

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

# Line check. Stone centres alone can settle on a grid that is a whole cell out near one edge,
# or skewed on a strongly rotated board. The printed lines, with stones masked out, give an
# independent fit: the stone grid is kept where it agrees, replaced where the lines are clear,
# and the photo is refused where neither is clear. Board edges have no lines beyond them,
# which fixes the whole-cell offset that the line pattern itself cannot.
LINE_CELL,LINE_MARGIN=16,3   # Canonical view: pixels per cell; cells shown beyond each edge.
LINE_BLOCKS=6                # Blocks per side whose line phases are fitted locally.
LINE_PHASES=np.linspace(-.5,.5,41)[:-1]
LINE_ITERATIONS=5
LINE_MIN_CONTRAST=.8         # On-line vs between-line ridge contrast needed to trust the lines.
LINE_MIN_RIDGE=.02           # Mean ridge on the lines needed (blurred photos fall far below).
LINE_SPAN=2                  # Whole-cell offsets tried each way.
LINE_DECISIVE=.5             # Edge cost of the best offset vs the runner-up that settles an axis.
LINE_VETO=1.                 # Stone weight beyond the board edge that rules an offset out.
LINE_KEEP=.5                 # Cells: the stone grid is kept while each corner is this close.
STONE_RADIUS=.62             # Cells masked around each detected stone.

def project(H,p):
 p=np.c_[p,np.ones(len(p))]@H.T;return p[:,:2]/p[:,2:]
# Quad of the 19 x 19 grid whose corners sit `offset` cells from those of `quad`.
def shifted(quad,offset):
 H=homography(quad,TARGET);return project(np.linalg.inv(H),TARGET+np.asarray(offset,dtype=float))
# Square view of the board plus LINE_MARGIN cells each side, LINE_CELL pixels per cell, and a
# mask of the pixels that came from inside the photo.
def canonical(gray,quad):
 n=int(round((18+2*LINE_MARGIN)*LINE_CELL));H=homography((TARGET+LINE_MARGIN)*LINE_CELL,quad);H=(H/H[2,2]).ravel()[:8]
 a=np.asarray(gray.transform((n,n),Image.Transform.PERSPECTIVE,H,Image.Resampling.BILINEAR),dtype=float)
 return a,np.asarray(Image.new('L',gray.size,255).transform((n,n),Image.Transform.PERSPECTIVE,H,Image.Resampling.NEAREST))>0
# Dark thin lines: how much darker each pixel is than both neighbours `k` pixels away, along x
# (vertical lines) and along y (horizontal lines), in log intensity.
def ridges(a,k=2):
 a=np.log(a+8.);return np.clip(np.minimum(np.roll(a,k,1),np.roll(a,-k,1))-a,0,.5),np.clip(np.minimum(np.roll(a,k,0),np.roll(a,-k,0))-a,0,.5)
def stone_mask(n,quad,stones):
 m=np.ones((n,n));z=project(homography(quad,TARGET),stones) if len(stones) else np.zeros((0,2));r=int(np.ceil(STONE_RADIUS*LINE_CELL))+1
 for x,y in z[(z.min(1)>-2)&(z.max(1)<20)] if len(z) else ():
  cx,cy=int((x+LINE_MARGIN)*LINE_CELL),int((y+LINE_MARGIN)*LINE_CELL);x0,x1,y0,y1=max(0,cx-r),min(n,cx+r+1),max(0,cy-r),min(n,cy+r+1)
  if x0<x1 and y0<y1:
   yy,xx=np.mgrid[y0:y1,x0:x1]/LINE_CELL-LINE_MARGIN;m[y0:y1,x0:x1]*=(xx-x)**2+(yy-y)**2>STONE_RADIUS**2
 return m
def profile(p,t):return np.interp(t,np.arange(len(p)),p,left=0,right=0)
# Masked mean ridge on lattice lines vs half-way between them: (contrast, on-line ridge).
def line_contrast(rv,rh,m):
 lo,hi=int((LINE_MARGIN-.5)*LINE_CELL),int((LINE_MARGIN+18.5)*LINE_CELL);on=[];off=[]
 for p in ((rv[lo:hi]*m[lo:hi]).sum(0)/np.maximum(m[lo:hi].sum(0),1),(rh[:,lo:hi]*m[:,lo:hi]).sum(1)/np.maximum(m[:,lo:hi].sum(1),1)):
  on.append(profile(p,(np.arange(19)+LINE_MARGIN)*LINE_CELL).mean());off.append(profile(p,(np.arange(18)+.5+LINE_MARGIN)*LINE_CELL).mean())
 on,off=np.mean(on),np.mean(off);return (on-off)/(on+off+1e-9),on
# Line phase (fraction of a cell) and its confidence per block and axis, with block centres.
def line_phases(rv,rh,m):
 groups=np.array_split(np.arange(19),LINE_BLOCKS);n=LINE_BLOCKS;phase=np.zeros((n,n,2));conf=np.zeros((n,n,2));centre=np.zeros((n,n,2))
 for i,rows in enumerate(groups):
  for j,cols in enumerate(groups):
   r0,r1,c0,c1=rows[0]-.5,rows[-1]+.5,cols[0]-.5,cols[-1]+.5;centre[i,j]=((c0+c1)/2,(r0+r1)/2)
   ys=slice(int((r0+LINE_MARGIN)*LINE_CELL),int((r1+LINE_MARGIN)*LINE_CELL));xs=slice(int((c0+LINE_MARGIN)*LINE_CELL),int((c1+LINE_MARGIN)*LINE_CELL))
   for axis,(p,cover,ks) in enumerate((((rv[ys]*m[ys]).sum(0)/np.maximum(m[ys].sum(0),1),m[ys].sum(0)/(ys.stop-ys.start),cols),((rh[:,xs]*m[:,xs]).sum(1)/np.maximum(m[:,xs].sum(1),1),m[:,xs].sum(1)/(xs.stop-xs.start),rows))):
    c=np.array([profile(p,(ks+s+LINE_MARGIN)*LINE_CELL).mean() for s in LINE_PHASES]);k=c.argmax()
    phase[i,j,axis]=LINE_PHASES[k];conf[i,j,axis]=max(0,c[k]-np.median(c))*min(1,profile(cover,(ks+LINE_MARGIN)*LINE_CELL).mean()/.5)
 return phase,conf,centre
# Phases wrap at whole cells; unwrap them across neighbouring blocks, most confident first.
def unwrap(phase,conf):
 n=len(phase);out=np.full(phase.shape,np.nan);start=np.unravel_index(conf.argmax(),conf.shape);out[start]=phase[start];heap=[]
 def push(i,j):
  for a,b in ((i,j+1),(i+1,j),(i,j-1),(i-1,j)):
   if 0<=a<n and 0<=b<n and np.isnan(out[a,b]):heapq.heappush(heap,(-conf[a,b],a,b,i,j))
 push(*start)
 while heap:
  _,a,b,i,j=heapq.heappop(heap)
  if np.isnan(out[a,b]):out[a,b]=phase[a,b]+np.round(out[i,j]-phase[a,b]);push(a,b)
 return out
# One refinement of `quad` towards the visible lines: (new quad, largest corner move in cells).
def line_step(gray,quad,stones,minimum=.004):
 a,_=canonical(gray,quad);rv,rh=ridges(a);m=stone_mask(len(a),quad,stones);phase,conf,centre=line_phases(rv,rh,m)
 src=centre.reshape(-1,2);dst=src-np.c_[unwrap(phase[...,0],conf[...,0]).ravel(),unwrap(phase[...,1],conf[...,1]).ravel()];w=conf.reshape(-1,2)*(conf.reshape(-1,2)>minimum)
 if (w>0).sum(0).min()<8:return quad,0.
 for _ in range(4):
  G=fit(src,dst,w);w=w/(1+((project(G,src)-dst)/.12)**2)
 H=G@homography(quad,TARGET);H/=H[2,2];return project(np.linalg.inv(H),TARGET),float(np.abs(project(G,TARGET)-TARGET).max())
def fit_lines(gray,quad,stones):
 for _ in range(LINE_ITERATIONS):
  moved,move=line_step(gray,quad,stones)
  if move<.02:break
  quad=moved
 return quad
# Mean ridge on each one-cell line segment of the canonical view: vertical segments as
# (band, column) and horizontal ones as (row, band), for lattice lines -LINE_MARGIN..18+LINE_MARGIN.
def line_segments(rv,rh,m):
 n=len(rv);ks=np.arange(-LINE_MARGIN,19+LINE_MARGIN);V=np.full((len(ks)-1,len(ks)),np.nan);Hh=np.full((len(ks),len(ks)-1),np.nan)
 for a,k in enumerate(ks):
  x=int(round((k+LINE_MARGIN)*LINE_CELL))
  if not 1<=x<n-1:continue
  for b,j in enumerate(ks[:-1]):
   y0,y1=int(round((j+LINE_MARGIN)*LINE_CELL))+2,int(round((j+1+LINE_MARGIN)*LINE_CELL))-2
   if y0<0 or y1>n:continue
   w=m[y0:y1,x];V[b,a]=(rv[y0:y1,x-1:x+2].max(1)*w).sum()/max(w.sum(),1)
   w=m[x,y0:y1];Hh[a,b]=(rh[x-1:x+2,y0:y1].max(0)*w).sum()/max(w.sum(),1)
 return V,Hh
# Edge cost of each whole-cell offset (sx, sy): line strength just beyond the shifted board's
# edges relative to inside it, (x from the left/right edges, y from the top/bottom edges).
def edge_costs(V,Hh):
 o=LINE_MARGIN;costs={}
 with np.errstate(invalid='ignore'):
  for sx in range(-LINE_SPAN,LINE_SPAN+1):
   for sy in range(-LINE_SPAN,LINE_SPAN+1):
    c,r=sx+o,sy+o
    inV,outV=np.nanmean(V[r:r+18,c:c+19]),np.nanmean(np.r_[V[r-1,c:c+19],V[r+18,c:c+19]])
    inH,outH=np.nanmean(Hh[r:r+19,c:c+18]),np.nanmean(np.r_[Hh[r:r+19,c-1],Hh[r:r+19,c+18]])
    costs[sx,sy]=(outH/inH,outV/inV)
 return costs
# Stone weight within two cells beyond either edge across `axis`, were the board offset by k.
def stones_beyond(z,weights,axis,k):
 a,b=z[:,axis],z[:,1-axis];return float(weights[(b>-.5)&(b<18.5)&(((a>=k-2.5)&(a<k-.5))|((a>k+18.5)&(a<=k+20.5)))].sum())
# Check a stone-lattice quad against the printed lines. `stones` are all detected stone centres
# (pixels, masked out of the lines); `xy` and `weights` the confident ones. Returns the quad to
# read and how it was settled: 'agree' or 'unclear' keep `quad`, 'lines' returns the line grid,
# and 'uncertain' returns None when a whole-cell offset is ambiguous and the grids disagree.
def line_check(gray,quad,stones,xy,weights):
 quad=np.asarray(quad,dtype=float);stones=np.asarray(stones,dtype=float).reshape(-1,2);xy=np.asarray(xy,dtype=float).reshape(-1,2);weights=np.asarray(weights,dtype=float)
 # Very large photos are reduced first so one-cell samples do not skip thin lines.
 cell=np.mean([np.hypot(*(quad[(i+1)%4]-quad[i])) for i in range(4)])/18;f=max(1,int(cell//(3*LINE_CELL)))
 if f>1:gray=gray.reduce(f);quad,stones,xy=quad/f,stones/f,xy/f
 q=fit_lines(gray,quad,stones);a,valid=canonical(gray,q);rv,rh=ridges(a);m=stone_mask(len(a),q,stones)*valid
 contrast,on=line_contrast(rv,rh,m)
 if contrast<LINE_MIN_CONTRAST or on<LINE_MIN_RIDGE:return quad*f,'unclear'
 costs=edge_costs(*line_segments(rv,rh,m));H=homography(q,TARGET);n0=np.rint(np.median(project(H,quad)-TARGET,0)).astype(int)
 z=project(H,xy) if len(xy) else np.zeros((0,2));s=list(n0);decisive=[];ks=range(-LINE_SPAN,LINE_SPAN+1)
 for axis in (0,1):
  beyond={k:stones_beyond(z,weights,axis,k) for k in ks};allowed=[k for k in ks if beyond[k]<=min(beyond.values())+LINE_VETO]
  cost={k:costs[(k,n0[1]) if axis==0 else (n0[0],k)][axis] for k in allowed};best=min(cost,key=lambda k:cost[k] if np.isfinite(cost[k]) else np.inf);rest=sorted(v for k,v in cost.items() if k!=best and np.isfinite(v))
  clear=bool(np.isfinite(cost[best]) and (len(cost)==1 or (len(rest)==len(cost)-1 and cost[best]<LINE_DECISIVE*rest[0])));decisive.append(clear)
  if clear:s[axis]=best
 q=shifted(q,s);z=project(homography(q,TARGET),xy) if len(xy) else np.zeros((0,2));inside=(z.min(1)>-.5)&(z.max(1)<18.5) if len(z) else np.zeros(0,dtype=bool)
 # Stones on a low-angle photo stand above their intersections: follow their global offset.
 if inside.sum()>=6:q=shifted(q,np.clip(lattice_offset(z[inside],weights[inside]),-PARALLAX,PARALLAX))
 if np.abs(project(homography(q,TARGET),quad)-TARGET).max()<=LINE_KEEP:return quad*f,'agree'
 return (q*f,'lines') if all(decisive) else (None,'uncertain')
