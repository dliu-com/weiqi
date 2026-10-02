import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import {createState,transition,GameError} from '../backend/game-service.js';

test('simultaneous requests commit once and return the latest game to the loser',async()=>{
 let stored=null;
 class GetItemCommand {constructor(input){this.input=input;}}
 class PutItemCommand {constructor(input){this.input=input;}}
 class DynamoDBClient {
  async send(command) {
   if(command instanceof GetItemCommand) return {Item:stored ? structuredClone(stored):undefined};
   const expected=Number(command.input.ExpressionAttributeValues[':expected'].N);
   if(stored && Number(stored.revision.N)!==expected) {const e=new Error();e.name='ConditionalCheckFailedException';throw e;}
   stored=structuredClone(command.input.Item);return {};
  }
 }
 const exports={};
 vm.runInNewContext(readFileSync(new URL('../backend/handler.cjs',import.meta.url),'utf8'),{
  require:()=>({DynamoDBClient,GetItemCommand,PutItemCommand}),exports,process:{env:{TABLE_NAME:'test',SITE_ORIGIN:'https://test.invalid'}},
  Buffer,console,createState,transition,GameError
 });
 const event=index=>({rawPath:'/api/game',requestContext:{http:{method:'POST'}},headers:{'content-type':'application/json',origin:'https://test.invalid'},body:JSON.stringify({expectedRevision:0,action:{type:'move',index}})});
 const responses=await Promise.all([exports.handler(event(180)),exports.handler(event(181))]);
 assert.deepEqual(responses.map(r=>r.statusCode).sort(),[200,409]);
 assert.equal(JSON.parse(stored.state.S).history.length,1);
 assert.equal(JSON.parse(responses.find(r=>r.statusCode===409).body).state.revision,1);
 const rejected=await exports.handler({...event(182),headers:{'content-type':'application/json',origin:'https://other.invalid'}});
 assert.equal(rejected.statusCode,403);
});
