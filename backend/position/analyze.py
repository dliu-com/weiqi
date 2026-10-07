"""Bounded single-position CPU KataGo. No games or results are persisted."""
import json,os,subprocess,time,uuid
from pathlib import Path
COLUMNS='ABCDEFGHJKLMNOPQRST'
def point(i):return COLUMNS[i%19]+str(19-i//19)
def handler(event,context):
 started=time.perf_counter();initial=event['initialBoard'];moves=event.get('moves',[])
 if len(initial)!=361 or set(initial)-set('.BW') or len(moves)>512:raise ValueError('Invalid position')
 if event['rules'] not in ['japanese','chinese','korean','aga'] or event['side'] not in ['B','W']:raise ValueError('Invalid settings')
 stones=[[c,point(i)] for i,c in enumerate(initial) if c!='.']
 config=Path('/tmp/position-analysis.cfg')
 config.write_text('logToStderr = false\nnumAnalysisThreads = 1\nnumSearchThreadsPerAnalysisThread = 2\nnumEigenThreadsPerModel = 2\nnumNNServerThreadsPerModel = 1\nnnMaxBatchSize = 1\nnnCacheSizePowerOfTwo = 14\nreportAnalysisWinratesAs = BLACK\nanalysisPVLen = 5\n')
 query={'id':str(uuid.uuid4()),'initialStones':stones,'moves':[[m['side'],'pass' if m['index'] is None else point(m['index'])] for m in moves],'initialPlayer':event['initialSide'],'boardXSize':19,'boardYSize':19,'rules':event['rules'],'komi':float(event['komi']),'maxVisits':int(os.environ.get('VISITS','128')),'maxTime':10,'analyzeTurns':[len(moves)],'includeOwnership':False,'includePolicy':False}
 if not moves:query['initialPlayer']=event['side']
 timeout=min(17,max(1,context.get_remaining_time_in_millis()/1000-2))
 env={**os.environ,'APPIMAGE_EXTRACT_AND_RUN':'1'}
 result=subprocess.run(['/var/task/bin/katago','analysis','-model','/var/task/model.bin.gz','-config',str(config)],input=json.dumps(query)+'\n',capture_output=True,text=True,timeout=timeout,env=env)
 rows=[json.loads(s) for s in result.stdout.splitlines() if s.startswith('{')];data=next((r for r in reversed(rows) if 'rootInfo' in r),None)
 if not data:raise ValueError('KataGo could not analyse this position: '+str(next((r.get('error') for r in rows if r.get('error')),result.stderr[-300:])))
 root=data['rootInfo'];top=data['moveInfos'][:3];best=top[0]['scoreLead'] if top else root['scoreLead'];side=event['side'];candidates=[]
 for m in top:
  move=m['move'];x=-1 if move.lower()=='pass' else COLUMNS.index(move[0]);y=-1 if x<0 else 19-int(move[1:]);candidates.append({'x':x,'y':y,'pv':m.get('pv',[])[:5],'scoreLead':m['scoreLead'],'winRate':m['winrate'],'visits':m['visits'],'relativePointsLost':max(0,(best-m['scoreLead'])*(1 if side=='B' else -1))})
 return {'rootScoreLead':root['scoreLead'],'rootWinRate':root['winrate'],'rootVisits':root['visits'],'moves':candidates,'model':'g170-b6c96-s175395328-d26788732','engine':'KataGo Eigen AVX2 1.16.5','elapsedMs':round((time.perf_counter()-started)*1000)}
