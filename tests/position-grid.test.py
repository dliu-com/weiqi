import sys,unittest
from pathlib import Path
import numpy as np
from PIL import Image,ImageDraw
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'backend/position'))
from grid import select_grid,supplement_stones

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
if __name__=='__main__':unittest.main()
