#!/usr/bin/env node
/**
 * Prove the production evidence identity gates fail closed.
 *
 * Release evidence is Rust-only now, so identity checks guard against a
 * mislabelled runtime document, a mismatched nd-core executable, and mixed
 * machine/commit provenance. Historical legacy-vs-Rust bundles remain usable
 * with bench:compare but are no longer a release prerequisite.
 */
import { spawnSync } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { evaluateEvidence } from './lib/budgets.mjs'
import { benchmarkRoot } from './lib/core-rpc.mjs'

const checks=[]
function check(condition,label,detail){checks.push({label,passed:Boolean(condition),...(detail===undefined?{}:{detail})});console.log((condition?'PASS ':'FAIL ')+label+(detail===undefined?'':' - '+detail))}
const HASH='a'.repeat(64)
const environment={os:'win32',osVersion:'10.0.26100',arch:'x64',cpuModel:'synthetic reference cpu',logicalCpuCount:16,physicalMemoryBytes:34359738368,nodeVersion:'v24.0.0'}
const provenance={schemaVersion:1,commit:'b'.repeat(40),buildProfile:'release',fixtureRevision:'prd-0002-v1',environment}
function bundle({runtimeBackend='rust-core',runtimeHash=HASH,runtimeRuns=10}={}){
  return{
    coreSummary:{...provenance,backend:'rust-core',ndCore:{sha256:HASH,source:'binary'},benchmarks:{}},
    rustRuntime:{...provenance,backend:runtimeBackend,measuredRuns:runtimeRuns,ndCore:{sha256:runtimeHash,source:'binary'},summary:{}},
    packagedStartup:{...provenance,backend:'rust-core',measuredRuns:10,records:[],ndCore:{sha256:HASH,source:'release-manifest'}},
  }
}
const byId=(result,id)=>result.checks.find((x)=>x.id===id)
const honest=evaluateEvidence(bundle())
check(byId(honest,'backend-identity')?.passed===true,'correctly labelled production evidence passes backend identity')
check(byId(honest,'core-binary-identity')?.passed===true,'one nd-core executable passes binary identity')
check(byId(honest,'full-provenance')?.passed===true,'matching provenance passes full-provenance identity')

const mislabeled=evaluateEvidence(bundle({runtimeBackend:'legacy'}))
check(byId(mislabeled,'backend-identity')?.passed===false,'a retired/mislabelled runtime fails backend identity')
check(mislabeled.failures.some((x)=>x.startsWith('[identity] ')),'backend mismatch is reported as identity failure')

const stale=evaluateEvidence(bundle({runtimeHash:'c'.repeat(64)}))
check(byId(stale,'core-binary-identity')?.passed===false,'two nd-core executables fail binary identity')
check(stale.failures.some((x)=>x.startsWith('[identity] ')),'binary mismatch is reported as identity failure')

const undersampled=evaluateEvidence(bundle({runtimeRuns:9}))
check(undersampled.failures.some((x)=>x.startsWith('[budget] ')),'undersampling remains a budget failure')
check(!undersampled.failures.some((x)=>x.startsWith('[identity] ')),'undersampling does not masquerade as identity failure')

await checkBundleRejection()
const failed=checks.filter((x)=>!x.passed)
console.log(JSON.stringify({status:failed.length?'fail':'pass',checks},null,2))
if(failed.length)process.exitCode=1

async function checkBundleRejection(){
  const directory=await mkdtemp(join(tmpdir(),'nd-dsh-evidence-identity-'))
  try{
    const data=bundle({runtimeBackend:'legacy'})
    const paths={core:'core/summary.json',rust:'rust/electron-responsiveness.json',packaged:'packaged/app-startup.json'}
    for(const [key,item] of [['core',data.coreSummary],['rust',data.rustRuntime],['packaged',data.packagedStartup]]){
      const path=join(directory,paths[key]);await fs.mkdir(join(path,'..'),{recursive:true});await fs.writeFile(path,JSON.stringify(item,null,2)+'\n','utf8')
    }
    const summaryPath=join(directory,'summary.json')
    await fs.writeFile(summaryPath,JSON.stringify({schemaVersion:1,kind:'nd-performance-evidence',status:'pass',...provenance,paths},null,2)+'\n','utf8')
    const result=spawnSync(process.execPath,[join(benchmarkRoot,'benchmarks','check-budgets.mjs'),summaryPath],{cwd:benchmarkRoot,encoding:'utf8'})
    check(result.status===1,'bench:check exits non-zero for a mislabelled runtime','exit='+String(result.status))
    check(result.stdout.includes('[identity]'),'bench:check names the identity failure on stdout')
  }finally{await fs.rm(directory,{recursive:true,force:true})}
}
