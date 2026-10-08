import sys,unittest
from pathlib import Path
import numpy as np
from PIL import Image,ImageDraw
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'backend/position'))
from grid import select_grid,supplement_stones,merge_corner_peaks
import grid
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
 def test_stone_placed_off_its_intersection_is_read_for_review(self):
  found,review=reader.read(*loose_scene(16,16,.45,.3,0))
  self.assertEqual(found[point(16,16)],'B');self.assertIn(point(16,16),review)
 def test_off_intersection_echo_next_to_a_stone_is_ignored(self):
  image,full,tiles=loose_scene(3,4,-.45,0,0);d=reader.detections(full,reader.SIZE,reader.SIZE)
  self.assertEqual(reader.loose(d,reader.lattice(d),[]),[])
  found,_=reader.read(image,full,tiles);self.assertEqual(found[point(3,4)],'.')
 def test_off_intersection_detection_on_bare_wood_is_ignored(self):
  found,_=reader.read(*loose_scene(16,16,.45,.3,1,False))
  self.assertEqual(found[point(16,16)],'.')
def loose_scene(x,y,dx,dy,colour,drawn=True,score=.08):
 """stone_scene plus one full-pass detection (and optionally its stone) displaced (dx,dy) squares from point (x,y)."""
 image,full,tiles=stone_scene();cx,cy=reader.MARGIN+(x+dx)*reader.STEP,reader.MARGIN+(y+dy)*reader.STEP;r=.45*reader.STEP
 if drawn:ImageDraw.Draw(image).ellipse((cx-r,cy-r,cx+r,cy+r),fill=(20,20,20) if colour==0 else (235,235,230))
 logit=np.full(3,-9.0);logit[colour]=np.log(score/(1-score));w=.9*reader.STEP/reader.SIZE
 return image,{'logits':np.r_[full['logits'],[logit]],'pred_boxes':np.r_[full['pred_boxes'],[(cx/reader.SIZE,cy/reader.SIZE,w,w)]]},tiles
class CornerPeakTests(unittest.TestCase):
 def test_mirrored_peaks_are_mapped_back_and_deduplicated(self):
  merged=merge_corner_peaks({'corner_points':np.array([[.1,.1,.9],[.9,.9,.8]]),'logits':1},{'corner_points':np.array([[.9,.1,.7],[.1,.1,.6]])})
  np.testing.assert_allclose(merged['corner_points'],[[.1,.1,.9],[.9,.9,.8],[.9,.1,.6]]);self.assertEqual(merged['logits'],1)
def square(dx=0,dy=0,wide=0,origin=190,cell=40):
 a,b=origin,origin+18*cell;return np.array([(a+dx*cell,a+dy*cell),(b+(dx+wide)*cell,a+dy*cell),(b+(dx+wide)*cell,b+dy*cell),(a+dx*cell,b+dy*cell)],float)
def lined(first=0,last=18,stones=(),origin=190,cell=40):
 """Grey photo of grid lines first..last (18 lines past the first make a board) with optional black stones."""
 image=Image.new('L',(1100,1100),190);draw=ImageDraw.Draw(image);a,b=origin+first*cell,origin+last*cell
 for k in range(first,last+1):
  x=origin+k*cell;draw.line((x,a,x,b),fill=60,width=2);draw.line((a,x,b,x),fill=60,width=2)
 for x,y in stones:draw.ellipse((origin+x*cell-18,origin+y*cell-18,origin+x*cell+18,origin+y*cell+18),fill=25)
 return image
NONE=np.zeros((0,2))
class OrientationTests(unittest.TestCase):
 def turned(self,degrees):
  a=np.deg2rad(degrees);r=np.array([[np.cos(a),-np.sin(a)],[np.sin(a),np.cos(a)]]);return (np.array([(-1,-1),(1,-1),(1,1),(-1,1)],float)*100)@r.T+500
 def test_rotation_measures_in_plane_turn(self):
  for degrees in (0,20,-35):self.assertAlmostEqual(grid.rotation(self.turned(degrees)),degrees,places=6)
 def test_clearly_upright_order_is_restored(self):
  quad=self.turned(22);rolled=np.roll(quad,1,axis=0)
  self.assertAlmostEqual(grid.rotation(rolled),22-90,places=6);np.testing.assert_allclose(grid.upright(rolled),quad)
 def test_board_turned_about_45_degrees_keeps_its_order(self):
  quad=np.roll(self.turned(42),1,axis=0);np.testing.assert_allclose(grid.upright(quad),quad)
class LatticeTests(unittest.TestCase):
 def test_offset_is_circular_mean_of_fractions(self):
  z=np.array([(3.3,4.2),(7.3,1.2),(10.3,15.2)]);np.testing.assert_allclose(grid.lattice_offset(z,np.ones(3)),[.3,.2],atol=1e-9)
  self.assertAlmostEqual(grid.lattice_offset(np.array([(2.45,0),(5.55,0)]),np.ones(2))[0],.5,places=6)
 def test_parallax_tolerance_accepts_displaced_stones(self):
  xy=np.array([(x+.35,y-.3) for x in range(0,19,2) for y in range(0,19,3)]);H=np.eye(3);w=np.ones(len(xy))
  self.assertLess(grid.lattice_quality(xy,w)(H)[0],.4);self.assertGreater(grid.lattice_quality(xy,w,grid.PARALLAX)(H)[0],.95)
 def test_quality_keeps_the_best_stone_on_each_intersection(self):
  rng=np.random.default_rng(3);xy=rng.uniform(-2,21,(300,2));w=rng.uniform(.04,1,300);H=np.eye(3)
  best={}
  for (x,y),v in zip(xy,w):
   c,r=np.rint(x),np.rint(y);e=max(abs(x-c),abs(y-r))
   if 0<=c<=18 and 0<=r<=18:best[(c,r)]=max(best.get((c,r),0),v*max(0,1-e/.5))
  self.assertAlmostEqual(grid.lattice_quality(xy,w)(H)[0],sum(best.values())/w.sum(),places=12)
 def test_cached_rescue_ranking_matches_a_fresh_one(self):
  first=detections([[.1,.15,.95],[.9,.85,.9],[.4,.4,.5]]);second=detections([[.9,.15,.8],[.1,.85,.7],[.6,.3,.4]])
  cache={};grid.rescue_grid([first],cache);cached=grid.rescue_grid([first,second],cache);fresh=grid.rescue_grid([first,second])
  self.assertEqual(cached[0],fresh[0]);np.testing.assert_array_equal(cached[1],fresh[1]);self.assertGreater(fresh[0],.9)
class RescueViewTests(unittest.TestCase):
 def test_view_maps_back_to_source(self):
  M=grid.view_transform(700,500,320,30)
  np.testing.assert_allclose((M@[320,320,1])[:2],[700,500]);np.testing.assert_allclose(np.hypot(*(M@[640,320,1]-M@[320,320,1])[:2]),160)
  view={'logits':np.zeros((1,3)),'pred_boxes':np.array([[.75,.5,.1,.1]]),'corner_points':np.array([[.5,.5,.9]])}
  source=grid.view_to_source(view,M,1400,1000);x,y=(M@[480,320,1])[:2]
  np.testing.assert_allclose(source['pred_boxes'][0],[x/1400,y/1000,.1*320/1400,.1*320/1000]);np.testing.assert_allclose(source['corner_points'][0],[.5,.5,.9])
 def test_frame_contains_quad(self):
  cx,cy,side=grid.frame(np.array([(100,200),(500,180),(520,600),(90,640)]),1.)
  self.assertEqual((cx,cy,side),(305.,410.,460.))
 def test_pooled_peaks_prefer_earlier_groups_and_drop_duplicates(self):
  pooled=grid.pooled_peaks([np.array([[.1,.1,.3],[.9,.9,.8]]),np.array([[.11,.1,.99],[.5,.5,.6],[.2,.2,.001]])],limit=3)
  np.testing.assert_allclose(pooled,[[.9,.9,.8],[.1,.1,.3],[.5,.5,.6]])
 def test_board_region_follows_densest_detections(self):
  grid_xy=np.array([(.6+.2*x/18,.5+.2*y/18) for x in range(0,19,2) for y in range(0,19,2)]);noise=np.array([(.05,.9),(.9,.05)])
  xy=np.r_[grid_xy,noise];data={'logits':np.tile([0.,-9,-9],(len(xy),1)),'pred_boxes':np.c_[xy,np.full((len(xy),2),.01)]}
  cx,cy,side=grid.board_region(data,2000,1000);self.assertAlmostEqual(cx,1400,delta=40);self.assertAlmostEqual(cy,600,delta=40);self.assertLess(side,450)
class LineCheckTests(unittest.TestCase):
 def test_grid_that_matches_the_lines_is_kept(self):
  quad,how=grid.line_check(lined(),square()+.3,NONE,NONE,np.zeros(0))
  self.assertEqual(how,'agree');np.testing.assert_allclose(quad,square()+.3)
 def test_board_edges_fix_a_whole_cell_offset(self):
  for offset in ((1,0),(0,-1),(1,1)):
   quad,how=grid.line_check(lined(),square(*offset),NONE,NONE,np.zeros(0))
   self.assertEqual(how,'lines');np.testing.assert_allclose(quad,square(),atol=.5)
 def test_stones_are_masked_and_rule_out_offsets(self):
  stones=np.array([(190+x*40,190+y*40) for x in range(0,19,3) for y in range(0,19,4)],float)
  quad,how=grid.line_check(lined(stones=[((x-190)/40,(y-190)/40) for x,y in stones]),square(-1),stones,stones,np.full(len(stones),.9))
  self.assertEqual(how,'lines');np.testing.assert_allclose(quad,square(),atol=.5)
 def test_disagreement_without_visible_edges_is_refused(self):
  self.assertEqual(grid.line_check(lined(-5,23),square(wide=1),NONE,NONE,np.zeros(0)),(None,'uncertain'))
 def test_whole_cell_offset_without_visible_edges_keeps_the_stone_grid(self):
  quad,how=grid.line_check(lined(-5,23),square(1),NONE,NONE,np.zeros(0));self.assertEqual(how,'agree');np.testing.assert_allclose(quad,square(1))
 def test_faint_lines_leave_the_grid_unchanged(self):
  quad,how=grid.line_check(Image.new('L',(1100,1100),190),square(),NONE,NONE,np.zeros(0));self.assertEqual(how,'unclear');np.testing.assert_allclose(quad,square())
if __name__=='__main__':unittest.main()
