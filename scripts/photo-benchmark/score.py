"""Score intersections, stone errors and exact boards; labels never enter inference."""
import json,sys
from pathlib import Path
refs=json.loads(Path(sys.argv[1]).read_text())['samples'];results=json.loads(Path(sys.argv[2]).read_text())['results'];rows=[]
# A result id may be "<reference id>@<condition>" so one reference scores several upload conditions.
pairs=[(ref,result) for ref in refs for result in ([r for r in results if r['id']==ref['id'] or r['id'].startswith(ref['id']+'@')] or [{'id':ref['id']}])]
for ref,result in pairs:
 truth=ref['board'];pred=result.get('board');row={'id':result['id'],'referenceKind':ref.get('referenceKind','synthetic'),'inferenceError':result.get('error')}
 if not pred:
  row['detectionFailed']=True;rows.append(row);continue
 known=[i for i,v in enumerate(truth) if v in '.BW'];stone=[i for i in known if truth[i]!='.'];empty=[i for i in known if truth[i]=='.'];missed=[i for i in stone if pred[i]=='.'];extra=[i for i in empty if pred[i]!='.'];wrong=[i for i in stone if pred[i] not in (truth[i],'.')];errors=[i for i in known if truth[i]!=pred[i]]
 row.update({'evaluated':len(known),'uncertainExcluded':361-len(known),'correct':len(known)-len(errors),'intersectionAccuracy':(len(known)-len(errors))/len(known),'stoneAccuracy':sum(pred[i]==truth[i] for i in stone)/len(stone) if stone else None,'missedStones':len(missed),'extraStones':len(extra),'wrongColour':len(wrong),'exactBoard':len(known)==361 and not errors,'counts':result.get('counts'),'reviewPoints':len(result.get('review',[])),'errorsHighlighted':len(set(errors)&set(result.get('review',[]))),'errors':[{'row':i//19+1,'col':i%19+1,'expected':truth[i],'detected':pred[i]} for i in errors]});rows.append(row)
scored=[r for r in rows if not r.get('detectionFailed')];summary={'samples':len(rows),'detectionFailures':len(rows)-len(scored),'exactBoards':sum(r['exactBoard'] for r in scored),'evaluatedIntersections':sum(r['evaluated'] for r in scored),'correctIntersections':sum(r['correct'] for r in scored),'missedStones':sum(r['missedStones'] for r in scored),'extraStones':sum(r['extraStones'] for r in scored),'wrongColour':sum(r['wrongColour'] for r in scored),'reviewPoints':sum(r['reviewPoints'] for r in scored),'errorsHighlighted':sum(r['errorsHighlighted'] for r in scored),'accuracyCaveat':'Intersection accuracy excludes uncertain labels and failed detections. Read failures and exact boards alongside it.'}
output={'summary':summary,'samples':rows};Path(sys.argv[3]).write_text(json.dumps(output,indent=2));print(json.dumps(summary,indent=2))
