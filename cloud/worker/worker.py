import datetime, hashlib, json, os, pathlib, subprocess, tempfile, time, shutil
import urllib.request, zipfile, resource, re, math
import boto3
s3=boto3.client('s3')
BUCKET=os.environ['LIBRARY_BUCKET']
os.environ['APPIMAGE_EXTRACT_AND_RUN']='1'
ENGINE=os.environ.get('KATAGO_BIN','/opt/bin/katago')
MODEL_KEY=os.environ.get('KATAGO_MODEL_KEY','models/g170e-b20c256x2-s5303129600-d1228401921.bin.gz')
def kata_candidates(move_infos,played_move=None):
    def valid_move(move):return isinstance(move,str) and re.fullmatch(r'(?:pass|[A-HJ-T](?:[1-9]|1[0-9]))',move,re.I) is not None
    def finite(value):return isinstance(value,(int,float)) and not isinstance(value,bool) and math.isfinite(value)
    candidates=sorted([m for m in (move_infos if isinstance(move_infos,list) else []) if isinstance(m,dict) and valid_move(m.get('move')) and type(m.get('order')) is int and m['order']>=0 and finite(m.get('scoreLead')) and finite(m.get('winrate')) and 0<=m['winrate']<=1 and finite(m.get('visits')) and m['visits']>0],key=lambda m:m['order'])
    retained=candidates[:8]
    played=next((m for m in candidates if m['move'].lower()==(played_move or '').lower()),None)
    if played and played not in retained:retained.append(played)
    result=[]
    for m in retained:
        pv=[]
        for p in (m.get('pv') or [])[:12]:
            if not valid_move(p):break
            pv.append('pass' if p.lower()=='pass' else p.upper())
        result.append({'move':'pass' if m['move'].lower()=='pass' else m['move'].upper(),'order':m['order'],'blackLead':m['scoreLead'],'blackWinrate':m['winrate'],'visits':m['visits'],'pv':pv})
    return result
def update_phase(game_id,phase,patch,token=None):
    key='games/'+game_id+'/metadata.json'
    for attempt in range(6):
        obj=s3.get_object(Bucket=BUCKET,Key=key)
        metadata=json.loads(obj['Body'].read());state=metadata['analysis']
        if token and (state.get('token')!=token or state.get('status') in ['retry_wait','failed']):raise RuntimeError('Analysis ownership changed')
        state[phase]={**state.get(phase,{}),**patch}
        quick=state.get('quick',{}).get('status');deep=state.get('deep',{}).get('status')
        if deep=='ready':
            state.update(status='ready',available='deep',visits=state['deep']['visits'])
            for field in ['error','retryAt','retrySentAt']:state.pop(field,None)
        elif quick=='ready':state.update(status='running' if deep in ['queued','running'] else 'ready',available='quick',visits=state['quick']['visits'])
        else:state['status']='running' if 'running' in [quick,deep] else 'failed' if quick==deep=='failed' else 'queued'
        try:
            s3.put_object(Bucket=BUCKET,Key=key,Body=json.dumps(metadata).encode(),ContentType='application/json',IfMatch=obj['ETag'])
            return metadata
        except Exception as error:
            if getattr(error,'response',{}).get('ResponseMetadata',{}).get('HTTPStatusCode') not in [409,412] or attempt==5:raise

def handler(event,context=None):
    started=time.time()
    timings=json.loads(os.environ.get('BOOT_TIMINGS','{}'))
    worker_started=time.time()
    production=event.get('production',False)
    phase=event.get('phase')
    if phase not in [None,'quick','deep']:raise ValueError('Invalid analysis phase')
    metadata=None
    if production:
        obj=s3.get_object(Bucket=BUCKET,Key='games/'+event['id']+'/metadata.json')
        metadata=json.loads(obj['Body'].read())
        if event.get('token') and metadata['analysis'].get('token')!=event['token']:return {'status':'skipped'}
        if metadata['analysis']['status'] in ['ready','failed','limited'] or phase and metadata['analysis'].get(phase,{}).get('status') in ['ready','failed']: return {'status':'skipped'}
        patch={'status':'running','startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'visits':event['query']['maxVisits'],'estimatedSeconds':event.get('estimatedSeconds',300)}
        if phase:update_phase(event['id'],phase,patch,event.get('token'))
        else:
            metadata['analysis']={**metadata['analysis'],**patch}
            s3.put_object(Bucket=BUCKET,Key='games/'+event['id']+'/metadata.json',Body=json.dumps(metadata).encode(),ContentType='application/json',IfMatch=obj['ETag'])
    engine_download_started=time.time()
    timings['readClaimGameMs']=round((engine_download_started-worker_started)*1000)
    if os.environ.get('DOWNLOAD_ENGINE')=='1' and not pathlib.Path(ENGINE).exists():
        archive=pathlib.Path('/tmp/katago.zip')
        urllib.request.urlretrieve(os.environ.get('KATAGO_DOWNLOAD_URL','https://github.com/lightvector/KataGo/releases/download/v1.16.5/katago-v1.16.5-eigenavx2-linux-x64.zip'),archive)
        expected=os.environ.get('KATAGO_ZIP_SHA256')
        if expected and hashlib.sha256(archive.read_bytes()).hexdigest()!=expected: raise RuntimeError('Engine checksum mismatch')
        with zipfile.ZipFile(archive) as z: z.extractall('/tmp/engine')
        pathlib.Path(ENGINE).chmod(0o755)

    timings['downloadExtractKataGoMs']=round((time.time()-engine_download_started)*1000)
    query={**event['query'],'analysisPVLen':11}; visits=query['maxVisits']
    if query['boardXSize']!=19 or query['boardYSize']!=19 or not 1<=visits<=1000: raise ValueError('Invalid benchmark request')
    prefix=event['outputPrefix']
    if not (prefix.startswith('benchmarks/') or production and prefix=='games/'+event['id']) or '..' in prefix: raise ValueError('Invalid output prefix')
    model=pathlib.Path(os.environ.get('KATAGO_MODEL_PATH','/tmp/katago-model.bin.gz'))
    model_download_started=time.time()
    url=os.environ.get('KATAGO_MODEL_URL','')
    expected_url='https://media.katagotraining.org/uploaded/networks/models/kata1/'+MODEL_KEY.split('/')[-1]
    if url!=expected_url:raise ValueError('Invalid official model URL')
    request=urllib.request.Request(url,headers={'User-Agent':'KataGo-analysis-library/1.0 (+https://weiqi.dliu.com/about.html)'})
    # Each job fetches its own model; no persistent model storage or cache fallback.
    with urllib.request.urlopen(request,timeout=60) as response,model.open('wb') as output:shutil.copyfileobj(response,output)
    downloaded=time.time()
    timings['downloadModelMs']=round((downloaded-model_download_started)*1000)
    with tempfile.TemporaryDirectory() as folder:
        config=pathlib.Path(folder)/'analysis.cfg'
        threads=int(os.environ.get('SEARCH_THREADS','4'))
        max_batch=int(os.environ.get('NN_MAX_BATCH_SIZE','1'))
        config.write_text(f'logToStderr = true\nnumAnalysisThreads = {os.environ.get("ANALYSIS_THREADS","1")}\nnumSearchThreadsPerAnalysisThread = {threads}\nmaxVisits = {visits}\nreportAnalysisWinratesAs = BLACK\nnumNNServerThreadsPerModel = 1\nnumEigenThreadsPerModel = {os.environ.get("NN_THREADS","1")}\nnnMaxBatchSize = {max_batch}\nnnCacheSizePowerOfTwo = 18\n')
        engine_started=time.time()
        timeout=min(840,context.get_remaining_time_in_millis()/1000-15) if context else int(os.environ.get('ANALYSIS_TIMEOUT_SECONDS','3500'))
        result=subprocess.run([ENGINE,'analysis','-model',str(model),'-config',str(config)],input=json.dumps(query)+'\n',text=True,capture_output=True,timeout=timeout)
        if result.returncode: raise RuntimeError(result.stderr[-2000:])
        rows={}
        for line in result.stdout.splitlines():
            item=json.loads(line)
            if 'error' in item: raise RuntimeError(item['error'])
            if not item.get('isDuringSearch',False) and 'rootInfo' in item:
                info=item['rootInfo']; n=item['turnNumber']
                moves=query.get('moves',[])
                played=moves[n][1] if n<len(moves) else None
                rows[n]={'nodeId':event['nodeIds'][n],'move':n,'blackLead':info['scoreLead'],'blackWinrate':info['winrate'],'visits':info['visits'],'candidates':kata_candidates(item.get('moveInfos'),played)}
        if set(rows)!=set(query['analyzeTurns']): raise RuntimeError('Incomplete analysis')
        finished=time.time()
        timings['engineLoadAndAnalysisMs']=round((finished-engine_started)*1000)
        usage=resource.getrusage(resource.RUSAGE_CHILDREN)
        timings['engineCpuSeconds']=round(usage.ru_utime+usage.ru_stime,3)
        timings['enginePeakRssMB']=round(usage.ru_maxrss/1024,1)
        for peak in ['/sys/fs/cgroup/memory.peak','/sys/fs/cgroup/memory/memory.max_usage_in_bytes']:
            try:
                timings['containerPeakMemoryMB']=round(int(pathlib.Path(peak).read_text())/1024/1024,1);break
            except (OSError,ValueError):pass
        provenance_started=time.time()
        version=subprocess.check_output([ENGINE,'version'],text=True).splitlines()[0]
        analysis={'schemaVersion':2,'id':event['id'],'sgfSha256':event['sgfSha256'],'engine':'KataGo','engineVersion':version,'model':MODEL_KEY.split('/')[-1],'modelSha256':hashlib.sha256(model.read_bytes()).hexdigest(),'modelUrl':os.environ.get('KATAGO_MODEL_URL'),'configuration':{'analysisThreads':int(os.environ.get('ANALYSIS_THREADS','1')),'searchThreads':threads,'neuralNetThreads':int(os.environ.get('NN_THREADS','1')),'maxVisits':visits,'maxBatchSize':max_batch,'analysisPVLen':11},'visits':visits,'phase':phase,'reportPerspective':'BLACK','rules':query['rules'],'komi':query['komi'],'completedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'elapsedMs':round((finished-started)*1000),'positions':[rows[n] for n in sorted(rows)],'benchmark':{'backend':os.environ.get('BACKEND','cpu'),'downloadMs':round((downloaded-started)*1000),'engineMs':round((finished-engine_started)*1000),'requestStartedAt':event['requestedAt'],'workerStartedAt':datetime.datetime.fromtimestamp(started,datetime.timezone.utc).isoformat(),'searchThreads':threads}}
        if event.get('compute'):analysis['compute']=event['compute']
        origin=event.get('enqueuedAt') or (metadata or {}).get('analysis',{}).get('enqueuedAt')
        if origin:
            analysis['enqueuedAt']=origin
            analysis['endToEndMs']=max(0,round((time.time()-datetime.datetime.fromisoformat(origin.replace('Z','+00:00')).timestamp())*1000))
        timings['provenanceMs']=round((time.time()-provenance_started)*1000)
        upload_started=time.time()
        result_key=prefix+('/analysis-quick.json' if production and phase=='quick' else '/analysis.json')
        if production:
            if event.get('token'):
                owned=json.loads(s3.get_object(Bucket=BUCKET,Key=prefix+'/metadata.json')['Body'].read())['analysis']
                if owned.get('token')!=event['token'] or owned.get('status') in ['retry_wait','failed']:raise RuntimeError('Analysis ownership changed')
        s3.put_object(Bucket=BUCKET,Key=result_key,Body=json.dumps(analysis).encode(),ContentType='application/json')
        if production:
            if phase:update_phase(event['id'],phase,{'status':'ready','visits':visits,'completedAt':analysis['completedAt']},event.get('token'))
            else:
                latest=s3.get_object(Bucket=BUCKET,Key=prefix+'/metadata.json')
                metadata=json.loads(latest['Body'].read());metadata['analysis']={'status':'ready','visits':visits,'completedAt':analysis['completedAt']}
                s3.put_object(Bucket=BUCKET,Key=prefix+'/metadata.json',Body=json.dumps(metadata).encode(),ContentType='application/json',IfMatch=latest['ETag'])
        timings['saveResultsAndStatusMs']=round((time.time()-upload_started)*1000)
        timings['workerTotalMs']=round((time.time()-worker_started)*1000)
        if os.environ.get('BOOT_STARTED_AT'):timings['containerTotalMs']=round((time.time()-float(os.environ['BOOT_STARTED_AT']))*1000)
        s3.put_object(Bucket=BUCKET,Key=('jobs/'+event['id'] if production else prefix)+('/'+phase+'-timings.json' if production and phase else '/timings.json'),Body=json.dumps({'timings':timings,'requestedAt':event['requestedAt'],'workerStartedAt':datetime.datetime.fromtimestamp(worker_started,datetime.timezone.utc).isoformat(),'completedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'backend':os.environ.get('BACKEND','cpu')}).encode(),ContentType='application/json')
        return {'key':result_key,'elapsedMs':analysis['elapsedMs']}
def pipeline(event):
    # One GPU allocation serves both passes. Each pass still downloads the
    # official model afresh; model files are never persisted in the library.
    results=[]
    for phase in ['quick','deep']:
        settings=event['phases'][phase]
        results.append(handler({**event,'phase':phase,'query':{**event['query'],'maxVisits':settings['visits'],'id':event['id']+'-'+phase},'estimatedSeconds':settings['estimatedSeconds']}))
    return results

if __name__=='__main__':
    request_started=time.time()
    event=json.loads(s3.get_object(Bucket=BUCKET,Key=os.environ['BENCHMARK_REQUEST_KEY'])['Body'].read())
    boot=json.loads(os.environ.get('BOOT_TIMINGS','{}'));boot['downloadJobRequestMs']=round((time.time()-request_started)*1000);os.environ['BOOT_TIMINGS']=json.dumps(boot)
    print(json.dumps(pipeline(event) if event.get('pipeline') else handler(event)))
