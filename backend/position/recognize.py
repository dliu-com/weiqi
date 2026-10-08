"""Automatic photo detection, AGPL-3.0-only. Images are never written to S3."""
import base64,io,time
import numpy as np
from PIL import Image,ImageOps
import moku,board
from grid import merge_corner_peaks,upright,line_check,stone_points

def handler(event,context):
 started=time.perf_counter()
 raw=base64.b64decode(event['image'],validate=True)
 if len(raw)>1100000:raise ValueError('Photo is too large')
 Image.MAX_IMAGE_PIXELS=18000000
 opened=Image.open(io.BytesIO(raw))
 if opened.width*opened.height>18000000:raise ValueError('Photo exceeds 18 megapixels')
 source=ImageOps.exif_transpose(opened).convert('RGB')
 if max(source.size)>4096 or min(source.size)<400:raise ValueError('Use a clear photo of the whole 19 × 19 board')
 model,init=moku.session();first=moku.predict(model,source);failure=None;check='default'
 try:grid,score=moku.checked_corners(first,*source.size)
 except ValueError:
  first=merge_corner_peaks(first,moku.predict(model,ImageOps.mirror(source)))
  try:grid,score=moku.checked_corners(first,*source.size)
  except ValueError as error:grid,score,failure=None,None,error
 # A grid that failed or could not be checked gets closer views of the likely board region.
 if score is None:
  rescued=moku.rescue_corners(model,source,first)
  if rescued is not None:grid,score,first=rescued;check='rescue'
  elif failure is not None:raise failure
  else:check='unverified'
 # Grid lines confirm the stone grid, replace it when they clearly disagree, or refuse the photo.
 grid=upright(grid);xy,weights=stone_points(first,.02);xy=xy*np.array(source.size);confident=weights>=.035
 checked,lines=line_check(source.convert('L'),grid,xy,xy[confident],weights[confident])
 if checked is None:raise ValueError('The board grid is uncertain. No position was imported.')
 grid=checked
 target=np.array([(board.MARGIN,board.MARGIN),(board.SIZE-board.MARGIN,board.MARGIN),(board.SIZE-board.MARGIN,board.SIZE-board.MARGIN),(board.MARGIN,board.SIZE-board.MARGIN)])
 H=moku.homography(grid,target);inv=np.linalg.inv(H);inv/=inv[2,2]
 warped=source.transform((board.SIZE,board.SIZE),Image.Transform.PERSPECTIVE,inv.ravel()[:8],Image.Resampling.BILINEAR)
 full=moku.predict(model,warped);tiles=[((x,y),moku.predict(model,warped.crop((x,y,x+board.TILE,y+board.TILE)))) for x,y in board.crops()]
 result,review=board.read(warped,full,tiles)
 # A dense visible board becoming empty is a recognizer failure, not an empty game.
 direct=moku.classify(first,grid,*source.size)
 if sum(c!='.' for c in direct)>15 and sum(c!='.' for c in result)<sum(c!='.' for c in direct)*.5:raise ValueError('Board detection is uncertain. Try a closer, straight-on photo with every grid edge visible.')
 return {'board':result,'review':review,'corners':grid.tolist(),'counts':{c:result.count(c) for c in '.BW'},'model':'moku-v4','pipeline':'lines-loose-20261008','gridCheck':check,'lineCheck':lines,'elapsedMs':round((time.perf_counter()-started)*1000),'initialization':init}
