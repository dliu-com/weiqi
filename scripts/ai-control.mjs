// Administrator-only commands use the operator's AWS credentials, not a public API.
import {spawnSync} from 'node:child_process';import {mkdtempSync,readFileSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
const mode=process.argv[2];if(!['status','resume','dryRun'].includes(mode))throw Error('Use status, resume or dryRun.');
function aws(args){const r=spawnSync('aws',[...args,'--region','eu-west-1','--no-cli-pager'],{encoding:'utf8'});if(r.status!==0)throw Error(r.stderr||'AWS command failed');return r.stdout;}
const name=aws(['cloudformation','describe-stacks','--stack-name','WeiqiBudget','--query',"Stacks[0].Outputs[?OutputKey=='SpendingGuardName'].OutputValue | [0]",'--output','text']).trim();if(!name||name==='None')throw Error('Deploy WeiqiBudget first.');
const directory=mkdtempSync(join(tmpdir(),'weiqi-ai-control-'));
try{const file=join(directory,'response.json'),invoke=JSON.parse(aws(['lambda','invoke','--function-name',name,'--cli-binary-format','raw-in-base64-out','--payload',JSON.stringify({mode}),file]));const result=JSON.parse(readFileSync(file,'utf8'));console.log(JSON.stringify(result,null,2));if(invoke.FunctionError||mode==='resume'&&!result.resumed)process.exitCode=1;}finally{rmSync(directory,{recursive:true,force:true});}
