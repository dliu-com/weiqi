import sys,unittest
from pathlib import Path
import numpy as np
from PIL import Image,ImageDraw
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'backend/position'))
from grid import select_grid,supplement_stones,merge_corner_peaks
import board as reader

def detections(corners):
 grid=np.array([(.1+.8*x/18,.15+.7*y/18) for y in range(19) for x in range(19) if (x+y)%2==0])
 return {'logits':np.tile([4,-7,-7],(len(grid),1)), 'pred_boxes':np.c_[grid,np.full((len(grid),2),.04)],'corner_points':np.array(corners)}
class GridTests(unittest.TestCase):
 def test_interior_peak_cannot_replace_missing_corner(self):
  data=detections([[.1,.15,.95],[.1,.85,.92],[.9,.85,.9],[.4,.15,.89]])
  old=np.array([[.1,.15],[.4,.15],[.9,.85],[.1,.85]])
  found,score=select_grid(data,old)
  np.testing.assert_allclose(found,[[.1,.15],[.9,.15],[.9,.85],[.1,.85]],atol=.02)
  self.assertGreater(score,.8)
 def test_consistent_existing_quad_is_preserved(self):
  quad=np.array([[.1,.15],[.9,.15],[.9,.85],[.1,.85]])
  found,score=select_grid(detections(np.c_[quad,[.95,.9,.9,.9]]),quad)
  np.testing.assert_allclose(found,quad);self.assertGreater(score,.9)
 def test_degenerate_candidates_are_rejected(self):
  with self.assertRaises(ValueError):select_grid(detections([[.1,.15,.95],[.2,.15,.9],[.3,.15,.9],[.4,.15,.9]]),None)
 def test_dark_pixels_without_nearby_detection_do_not_create_stone(self):
  image=Image.new('RGB',(800,800),'black')
  raw={'logits':np.array([[-4,-9,-9]]),'pred_boxes':np.array([[.02,.02,.04,.04]])}
  self.assertEqual(supplement_stones(image,'.'*361,raw),'.'*361)
 def test_matching_low_score_stone_is_recovered_without_overwriting(self):
  image=Image.new('RGB',(800,800),(190,150,90))
  ImageDraw.Draw(image).ellipse((52,52,76,76),fill='black')
  raw={'logits':np.array([[-4,-9,-9]]),'pred_boxes':np.array([[64/800,64/800,.04,.04]])}
  self.assertEqual(supplement_stones(image,'.'*361,raw),'B'+'.'*360)
  self.assertEqual(supplement_stones(image,'W'+'.'*360,raw),'W'+'.'*360)
def stone_scene(extra=()):
 """Synthetic squared-up board: eight black and eight white stones, plus extra (x,y,colour,score,width,dy) detections."""
 image=Image.new('RGB',(reader.SIZE,reader.SIZE),(200,160,100));draw=ImageDraw.Draw(image);rows=[]
 def at(x,y):return reader.MARGIN+x*reader.STEP,reader.MARGIN+y*reader.STEP
 stones=[(x,y,0) for x in (2,4,6,8,10,12) for y in (2,)]+[(2,4,0),(4,4,0)]+[(x,10,1) for x in (2,4,6,8,10,12)]+[(2,12,1),(4,12,1)]
 for x,y,c in stones:
  cx,cy=at(x,y);r=.45*reader.STEP;draw.ellipse((cx-r,cy-r,cx+r,cy+r),fill=(20,20,20) if c==0 else (235,235,230));rows.append((x,y,c,.2,.9,0))
 for x,y,c,score,width,dy,shape in extra:
  cx,cy=at(x,y)
  if shape:draw.ellipse((cx-shape[0]*reader.STEP,cy-shape[1]*reader.STEP,cx+shape[0]*reader.STEP,cy+shape[2]*reader.STEP),fill=(20,20,20) if c==0 else (235,235,230))
  rows.append((x,y,c,score,width,dy))
 logits=np.full((len(rows),3),-9.0);boxes=np.zeros((len(rows),4))
 for k,(x,y,c,score,width,dy) in enumerate(rows):
  cx,cy=at(x,y+dy);logits[k,c]=np.log(score/(1-score));boxes[k]=(cx/reader.SIZE,cy/reader.SIZE,width*reader.STEP/reader.SIZE,width*reader.STEP/reader.SIZE)
 return image,{'logits':logits,'pred_boxes':boxes},[(xy,{'logits':np.zeros((0,3)),'pred_boxes':np.zeros((0,4))}) for xy in reader.crops()]
def point(x,y):return y*19+x
class BoardReadingTests(unittest.TestCase):
 def test_clean_stones_are_read_without_review(self):
  found,review=reader.read(*stone_scene())
  self.assertEqual(found[point(2,2)]+found[point(4,4)]+found[point(12,10)]+found[point(4,12)],'BBWW')
  self.assertEqual(found.count('B'),8);self.assertEqual(found.count('W'),8);self.assertEqual(review,[])
 def test_detection_on_bare_wood_is_rejected_for_review(self):
  found,review=reader.read(*stone_scene([(16,16,0,.2,.9,0,None)]))
  self.assertEqual(found[point(16,16)],'.');self.assertIn(point(16,16),review)
 def test_small_white_marker_is_not_a_stone(self):
  found,_=reader.read(*stone_scene([(16,4,1,.2,.5,0,(.3,.3,.3))]))
  self.assertEqual(found[point(16,4)],'.')
 def test_tall_stone_firing_on_next_point_counts_once(self):
  # An angled view stretches the stone towards the next point, so colour alone cannot reject the echo.
  found,review=reader.read(*stone_scene([(16,6,0,.3,.9,0,(.45,.45,.85)),(16,6,0,.1,.9,.66,None)]))
  self.assertEqual(found[point(16,6)],'B');self.assertEqual(found[point(16,7)],'.');self.assertIn(point(16,7),review)
class CornerPeakTests(unittest.TestCase):
 def test_mirrored_peaks_are_mapped_back_and_deduplicated(self):
  merged=merge_corner_peaks({'corner_points':np.array([[.1,.1,.9],[.9,.9,.8]]),'logits':1},{'corner_points':np.array([[.9,.1,.7],[.1,.1,.6]])})
  np.testing.assert_allclose(merged['corner_points'],[[.1,.1,.9],[.9,.9,.8],[.9,.1,.6]]);self.assertEqual(merged['logits'],1)
if __name__=='__main__':unittest.main()
