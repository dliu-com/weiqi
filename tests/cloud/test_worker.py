import importlib.util,io,json,os,pathlib,sys,tempfile,types,unittest
from unittest.mock import patch
class WorkerTest(unittest.TestCase):
 def setUp(self):
  self.directory=tempfile.TemporaryDirectory();self.addCleanup(self.directory.cleanup)
  os.environ['LIBRARY_BUCKET']='fictional';os.environ['KATAGO_MODEL_PATH']=str(pathlib.Path(self.directory.name)/'model');os.environ.pop('DOWNLOAD_ENGINE',None);os.environ['KATAGO_MODEL_KEY']='models/kata1-tf3-b11c768-s12252M-d6398M.bin.gz';os.environ['KATAGO_MODEL_URL']='https://media.katagotraining.org/uploaded/networks/models/kata1/kata1-tf3-b11c768-s12252M-d6398M.bin.gz'
  self.files={'games/20261005/01/metadata.json':{'body':json.dumps({'analysis':{'status':'queued','jobId':'job'}}),'etag':'1'}}
  outer=self
  class Store:
   def get_object(self,**args):
    item=outer.files[args['Key']];return {'Body':io.BytesIO(item['body'].encode()),'ETag':item['etag']}
   def download_file(self,bucket,key,target):raise AssertionError('Models must not be downloaded from S3')
   def put_object(self,**args):
    old=outer.files.get(args['Key'],{'etag':'0'})
    if args.get('IfMatch') and old['etag']!=args['IfMatch']:raise RuntimeError('Lost claim')
    outer.files[args['Key']]={'body':args['Body'].decode(),'etag':str(int(old['etag'])+1)}
  self.boto=types.ModuleType('boto3');self.boto.client=lambda _:Store()
  with patch.dict(sys.modules,{'boto3':self.boto}):
   spec=importlib.util.spec_from_file_location('worker',pathlib.Path(__file__).resolve().parents[2]/'cloud/worker/worker.py');self.worker=importlib.util.module_from_spec(spec);spec.loader.exec_module(self.worker)
  self.download=patch.object(self.worker.urllib.request,'urlopen',side_effect=lambda *args,**kwargs:io.BytesIO(b'fictional model')).start();self.addCleanup(patch.stopall)
  self.event={'id':'2026100501','production':True,'query':{'maxVisits':10,'boardXSize':19,'boardYSize':19,'analyzeTurns':[0,1,2],'rules':'japanese','komi':6.5},'nodeIds':[0,1,2],'outputPrefix':'games/20261005/01','sgfSha256':'fictionalhash','requestedAt':'2026-10-05T00:00:00Z'}
 def test_complete_results_and_timing_are_saved_and_ready_job_is_reused(self):
  output='\n'.join(json.dumps({'turnNumber':n,'rootInfo':{'scoreLead':n,'winrate':.5,'visits':10}}) for n in [2,0,1])
  with patch.object(self.worker.subprocess,'run',return_value=types.SimpleNamespace(returncode=0,stdout=output)),patch.object(self.worker.subprocess,'check_output',return_value='KataGo test\n'):
   self.worker.handler(self.event)
   data=json.loads(self.files['games/20261005/01/analysis.json']['body']);self.assertEqual([p['move'] for p in data['positions']],[0,1,2]);self.assertEqual(data['rules'],'japanese')
   self.assertEqual(json.loads(self.files['games/20261005/01/metadata.json']['body'])['analysis']['status'],'ready')
   timing=json.loads(self.files['jobs/2026100501/timings.json']['body'])['timings'];self.assertIn('engineLoadAndAnalysisMs',timing);self.assertIn('saveResultsAndStatusMs',timing)
   self.assertEqual(self.worker.handler(self.event)['status'],'skipped')
 def test_incomplete_results_never_publish_ready(self):
  with patch.object(self.worker.subprocess,'run',return_value=types.SimpleNamespace(returncode=0,stdout='')):
   with self.assertRaisesRegex(RuntimeError,'Incomplete'):self.worker.handler(self.event)
  self.assertNotIn('games/20261005/01/analysis.json',self.files)
  self.assertEqual(json.loads(self.files['games/20261005/01/metadata.json']['body'])['analysis']['status'],'running')
 def test_candidate_moves_and_bounded_continuations_are_saved_in_engine_order(self):
  self.event['query']['moves']=[['B','D16'],['W','Q4']]
  output='\n'.join(json.dumps({'turnNumber':n,'rootInfo':{'scoreLead':n,'winrate':.5,'visits':10},'moveInfos':[{'move':'Q16','order':0,'scoreLead':5,'winrate':.6,'visits':8,'pv':['Q16','D16','pass']},{'move':'D16','order':1,'scoreLead':1,'winrate':.4,'visits':2,'pv':['D16']}]}) for n in [0,1,2])
  with patch.object(self.worker.subprocess,'run',return_value=types.SimpleNamespace(returncode=0,stdout=output)) as run,patch.object(self.worker.subprocess,'check_output',return_value='KataGo test\n'):
   self.worker.handler(self.event)
  saved=json.loads(self.files['games/20261005/01/analysis.json']['body']);self.assertEqual(saved['schemaVersion'],2)
  self.assertEqual(saved['positions'][0]['candidates'][0]['pv'],['Q16','D16','pass']);self.assertEqual(saved['positions'][0]['candidates'][1]['blackLead'],1)
  self.assertEqual(json.loads(run.call_args.kwargs['input'])['analysisPVLen'],11)
  self.assertEqual(self.worker.kata_candidates([{'move':'A1','order':0,'scoreLead':0,'winrate':.5,'visits':10,'pv':['A1','I19','Q4']}])[0]['pv'],['A1'])
 def test_quick_is_available_while_deep_runs_then_replaced(self):
  self.files['games/20261005/01/metadata.json']['body']=json.dumps({'analysis':{'status':'queued','quick':{'status':'queued'},'deep':{'status':'running'}}})
  output='\n'.join(json.dumps({'turnNumber':n,'rootInfo':{'scoreLead':n,'winrate':.5,'visits':1}}) for n in [0,1,2])
  with patch.object(self.worker.subprocess,'run',return_value=types.SimpleNamespace(returncode=0,stdout=output)),patch.object(self.worker.subprocess,'check_output',return_value='KataGo test\n'):
   self.worker.handler({**self.event,'phase':'quick'})
   state=json.loads(self.files['games/20261005/01/metadata.json']['body'])['analysis']
   self.assertEqual(state['available'],'quick');self.assertEqual(state['status'],'running')
   self.assertIn('games/20261005/01/analysis-quick.json',self.files)
   self.worker.handler({**self.event,'phase':'deep'})
   state=json.loads(self.files['games/20261005/01/metadata.json']['body'])['analysis']
   self.assertEqual(state['available'],'deep');self.assertEqual(state['status'],'ready')
   self.assertEqual(json.loads(self.files['games/20261005/01/analysis.json']['body'])['phase'],'deep')
 def test_deep_finishing_first_cannot_be_downgraded_by_quick(self):
  self.files['games/20261005/01/metadata.json']['body']=json.dumps({'analysis':{'status':'running','quick':{'status':'running'},'deep':{'status':'ready','visits':1000},'available':'deep'}})
  self.worker.update_phase('2026100501','quick',{'status':'ready','visits':1})
  state=json.loads(self.files['games/20261005/01/metadata.json']['body'])['analysis']
  self.assertEqual(state['available'],'deep');self.assertEqual(state['visits'],1000)
  self.assertEqual(self.worker.handler({**self.event,'phase':'quick'})['status'],'skipped')
 def test_gpu_batch_setting_is_applied_and_saved_without_changing_the_cpu_default(self):
  output='\n'.join(json.dumps({'turnNumber':n,'rootInfo':{'scoreLead':n,'winrate':.5,'visits':10}}) for n in [0,1,2])
  configs=[]
  def run(args,**kwargs):
   configs.append(pathlib.Path(args[-1]).read_text());return types.SimpleNamespace(returncode=0,stdout=output)
  with patch.dict(os.environ,{'NN_MAX_BATCH_SIZE':'32','ANALYSIS_THREADS':'16'}),patch.object(self.worker.subprocess,'run',side_effect=run),patch.object(self.worker.subprocess,'check_output',return_value='KataGo GPU test\n'):
   self.worker.handler({**self.event,'compute':{'backend':'gpu','vCpu':4,'memoryGB':16,'gpu':'NVIDIA T4','gpuCount':1,'instanceType':'g4dn.xlarge'}})
  self.assertIn('nnMaxBatchSize = 32',configs[0]);self.assertIn('numAnalysisThreads = 16',configs[0])
  saved=json.loads(self.files['games/20261005/01/analysis.json']['body']);self.assertEqual(saved['configuration']['maxBatchSize'],32)
  self.assertEqual(saved['compute']['gpu'],'NVIDIA T4');self.assertEqual(saved['compute']['vCpu'],4);self.assertEqual(saved['compute']['memoryGB'],16)
 def test_actual_gpu_provenance_identifies_the_selected_fallback_instance(self):
  with patch.dict(os.environ,{'BACKEND':'gpu'}),patch.object(self.worker.subprocess,'check_output',return_value='Tesla T4, 15360\n'):
   compute=self.worker.actual_gpu_compute({'backend':'gpu','vCpu':4,'memoryGB':16});self.assertEqual(compute['instanceType'],'g4dn.xlarge');self.assertEqual(compute['gpu'],'NVIDIA T4')
  with patch.dict(os.environ,{'BACKEND':'gpu'}),patch.object(self.worker.subprocess,'check_output',return_value='NVIDIA A10G, 23028\n'):
   self.assertEqual(self.worker.actual_gpu_compute({})['instanceType'],'g5.xlarge')
 def test_pipeline_publishes_quick_before_deep_and_downloads_each_model_pass(self):
  self.files['games/20261005/01/metadata.json']['body']=json.dumps({'analysis':{'status':'queued','token':'owner','quick':{'status':'queued'},'deep':{'status':'queued'}}})
  event={**self.event,'token':'owner','pipeline':True,'compute':{'backend':'gpu','vCpu':4,'memoryGB':16,'gpu':'NVIDIA T4','instanceType':'g4dn.xlarge'},'phases':{'quick':{'visits':32,'estimatedSeconds':10},'deep':{'visits':3000,'estimatedSeconds':30}}}
  calls=[]
  def run(args,**kwargs):
   query=json.loads(kwargs['input']);calls.append(query['maxVisits'])
   if len(calls)==2:
    current=json.loads(self.files['games/20261005/01/metadata.json']['body'])['analysis'];self.assertEqual(current['available'],'quick');self.assertIn('games/20261005/01/analysis-quick.json',self.files)
   return types.SimpleNamespace(returncode=0,stdout='\n'.join(json.dumps({'turnNumber':n,'rootInfo':{'scoreLead':0,'winrate':.5,'visits':query['maxVisits']}}) for n in [0,1,2]))
  with patch.object(self.worker.subprocess,'run',side_effect=run),patch.object(self.worker.subprocess,'check_output',return_value='KataGo test'):self.worker.pipeline(event)
  self.assertEqual(calls,[32,3000]);self.assertEqual(self.download.call_count,2)
  self.assertEqual(json.loads(self.files['games/20261005/01/metadata.json']['body'])['analysis']['available'],'deep')
 def test_pipeline_skips_completed_quick_results_and_preserves_owner(self):
  self.files['games/20261005/01/metadata.json']['body']=json.dumps({'analysis':{'status':'queued','token':'owner','quick':{'status':'ready','visits':32},'deep':{'status':'queued'},'available':'quick'}})
  event={**self.event,'token':'owner','pipeline':True,'compute':{'backend':'gpu','vCpu':4,'memoryGB':16,'gpu':'NVIDIA T4','instanceType':'g4dn.xlarge'},'phases':{'quick':{'visits':32,'estimatedSeconds':10},'deep':{'visits':3000,'estimatedSeconds':30}}}
  output='\n'.join(json.dumps({'turnNumber':n,'rootInfo':{'scoreLead':0,'winrate':.5,'visits':3000}}) for n in [0,1,2])
  with patch.object(self.worker.subprocess,'run',return_value=types.SimpleNamespace(returncode=0,stdout=output)),patch.object(self.worker.subprocess,'check_output',return_value='KataGo test'):
   self.assertEqual(self.worker.pipeline(event)[0]['status'],'skipped')
  self.assertEqual(self.download.call_count,1)
  self.assertEqual(json.loads(self.files['games/20261005/01/analysis.json']['body'])['visits'],3000)
  self.assertEqual(self.worker.handler({**self.event,'phase':'quick','token':'stale'})['status'],'skipped')
  with self.assertRaisesRegex(RuntimeError,'ownership'):self.worker.update_phase(self.event['id'],'quick',{'status':'running'},'stale')
 def test_each_pass_downloads_official_model_with_identified_client_and_never_stores_a_model(self):
  self.files['games/20261005/01/metadata.json']['body']=json.dumps({'analysis':{'status':'queued','quick':{'status':'queued'},'deep':{'status':'queued'}}})
  output='\n'.join(json.dumps({'turnNumber':n,'rootInfo':{'scoreLead':n,'winrate':.5,'visits':10}}) for n in [0,1,2])
  with patch.object(self.worker.subprocess,'run',return_value=types.SimpleNamespace(returncode=0,stdout=output)),patch.object(self.worker.subprocess,'check_output',return_value='KataGo test\n'):
   self.worker.handler({**self.event,'phase':'quick'});self.worker.handler({**self.event,'phase':'deep'})
  self.assertEqual(self.download.call_count,2)
  request=self.download.call_args.args[0];self.assertEqual(request.full_url,os.environ['KATAGO_MODEL_URL']);self.assertIn('KataGo-analysis-library',request.get_header('User-agent'))
  self.assertFalse(any(key.startswith('models/') for key in self.files))
  analysis=json.loads(self.files['games/20261005/01/analysis.json']['body']);self.assertEqual(analysis['modelUrl'],request.full_url);self.assertIn('modelSha256',analysis);self.assertIn('configuration',analysis)
if __name__=='__main__':unittest.main()
