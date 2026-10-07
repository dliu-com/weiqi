"""Build pinned Linux/x86_64 Lambda packages; uploads only executable packages, never photos."""
import argparse,hashlib,json,pathlib,shutil,subprocess,sys,tempfile,urllib.request,zipfile
ROOT=pathlib.Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser();p.add_argument('--upload',action='store_true');p.add_argument('--bucket');p.add_argument('--region',default='eu-west-1');args=p.parse_args()
build=ROOT/'cloud/assets/position';build.mkdir(parents=True,exist_ok=True);sources=json.loads((ROOT/'photo-analysis/SOURCES.json').read_text())
def download(url,path,sha):
 if not path.exists() or hashlib.sha256(path.read_bytes()).hexdigest()!=sha:urllib.request.urlretrieve(url,path)
 if hashlib.sha256(path.read_bytes()).hexdigest()!=sha:raise RuntimeError('Checksum mismatch: '+path.name)
rec=build/'recognition';ai=build/'ai';rec.mkdir(exist_ok=True);(ai/'bin').mkdir(parents=True,exist_ok=True)
subprocess.run([sys.executable,'-m','pip','install','--target',str(rec),'--platform','manylinux2014_x86_64','--python-version','3.12','--implementation','cp','--only-binary=:all:','-r',str(ROOT/'backend/position/requirements.txt')],check=True)
for f in ['moku.py','grid.py','recognize.py']:shutil.copy2(ROOT/'backend/position'/f,rec/f)
for name,target in [('recognitionModel',rec/'model.onnx'),('analysisModel',ai/'model.bin.gz')]:download(sources[name]['url'],target,sources[name]['sha256'])
archive=build/'katago.zip';urllib.request.urlretrieve('https://github.com/lightvector/KataGo/releases/download/v1.16.5/katago-v1.16.5-eigenavx2-linux-x64.zip',archive)
with zipfile.ZipFile(archive) as z:(ai/'bin/katago').write_bytes(z.read('katago'))
if hashlib.sha256((ai/'bin/katago').read_bytes()).hexdigest()!='a911a1b542455614f937ee9e961162eea490c495bc4a053937f6231337346550':raise RuntimeError('KataGo binary checksum mismatch')
(ai/'bin/katago').chmod(0o755);shutil.copy2(ROOT/'backend/position/analyze.py',ai/'analyze.py');release={}
for name,folder in [('recognition',rec),('ai',ai)]:
 target=build/(name+'.zip');files=[f for f in folder.rglob('*') if f.is_file() and '__pycache__' not in f.parts];assert sum(f.stat().st_size for f in files)<250*1024*1024,'Lambda uncompressed package exceeds 250 MB'
 with zipfile.ZipFile(target,'w',zipfile.ZIP_DEFLATED,compresslevel=6) as z:
  for f in files:z.write(f,f.relative_to(folder))
 key='position-runtime/'+hashlib.sha256(target.read_bytes()).hexdigest()+'/'+target.name;release['recognitionKey' if name=='recognition' else 'aiKey']=key
 if args.upload:
  if not args.bucket:raise ValueError('--bucket is required with --upload')
  subprocess.run(['aws','s3','cp',str(target),'s3://'+args.bucket+'/'+key,'--region',args.region,'--only-show-errors'],check=True)
 print(name,target.stat().st_size,'bytes',key)
if args.upload:(ROOT/'cloud/position-release.json').write_text(json.dumps(release,indent=2)+'\n')
else:print('Built locally. Use --upload --bucket <existing library bucket> before deploying the stack.')
