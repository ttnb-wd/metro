"""Controlled, disabled website commerce worker release; never touches Telegram/API.
Run only through pinned strict SSH after restored Neon backup and isolated checks.
"""
import json,sys,os,pathlib,hashlib,subprocess,time,uuid
p=json.load(sys.stdin)
ROOT=pathlib.Path('/opt/metro-website-service')/('workers-'+p['releaseId'])
TAG='metro-website-commerce:strict-'+p['releaseId']
OLD='metro-commerce-worker-before-strict-'+p['releaseId']
CANARY='metro-commerce-worker-canary-'+p['releaseId']
UNIT='metro-website-worker-rollback-'+p['releaseId']
def run(a,stdin=None,timeout=30):
 r=subprocess.run(a,input=stdin,capture_output=True,text=True,timeout=timeout)
 if r.returncode:raise RuntimeError('CONTROLLED_WORKER_COMMAND_FAILED')
 return r.stdout

def inspect(name):return json.loads(run(['docker','inspect',name]))[0]
def digest(raw):return hashlib.sha256(raw).hexdigest()
def private(name,data):
 target=ROOT/name
 with open(target,'x')as f:json.dump(data,f)
 os.chmod(target,0o600)
def read(name):return json.loads((ROOT/name).read_text())
def continuity():
 b=inspect('metro-vpn-bot-1');before=p['baseline']
 assert b['Id']==before['botId'] and b['Image']==before['botImage'] and b['State']['StartedAt']==before['botStarted'] and b['RestartCount']==before['botRestarts'] and b['State']['Running'] and b['State']['Health']['Status']=='healthy'
 for name in ['metro-website-api','metro-notification-worker']:
  c=inspect(name);expected=next(v for v in p['inventory']['containers'] if v['name']==name)
  assert c['Id']==expected['id'] and c['Image']==expected['image'] and c['State']['StartedAt']==expected['started'] and c['RestartCount']==expected['restarts'] and c['State']['Running'] and c['State']['Health']['Status']=='healthy'
 assert digest(open('/etc/caddy/Caddyfile','rb').read())==before['caddyHash']
 items=json.loads(run(['docker','inspect']+run(['docker','ps','-aq']).split()));token=next(v for v in b['Config']['Env'] if v.startswith('BOT_TOKEN='));assert sum(1 for c in items if c['State']['Running'] and token in c['Config'].get('Env',[]))==1
 env=dict(v.split('=',1)for v in inspect('metro-notification-worker')['Config']['Env']);assert env.get('METRO_NOTIFICATION_EMAIL_ENABLED')=='false'

def queue(name):
 code=r'''const {Client}=require('pg');(async()=>{const u=new URL(process.env.METRO_COMMERCE_WORKER_DATABASE_URL);if(!['ep-floral-lab-azihv1v9.c-3.ap-southeast-1.aws.neon.tech','ep-floral-lab-azihv1v9-pooler.c-3.ap-southeast-1.aws.neon.tech'].includes(u.hostname)||u.pathname!=='/neondb'||decodeURIComponent(u.username)!=='metro_commerce_worker')throw Error();const c=new Client({host:u.hostname,port:5432,database:'neondb',user:decodeURIComponent(u.username),password:decodeURIComponent(u.password),ssl:{rejectUnauthorized:true,servername:u.hostname},enableChannelBinding:true,options:'-c default_transaction_read_only=on -c TimeZone=UTC',connectionTimeoutMillis:8000,statement_timeout:8000});try{await c.connect();if(!c.connection.stream.authorized)throw Error();await c.query('BEGIN READ ONLY');const id=(await c.query("SELECT current_setting('neon.project_id',true) AS project,current_setting('neon.branch_id',true) AS branch")).rows[0];if(id.project!=='proud-band-76846516'||id.branch!=='br-gentle-night-azuks958')throw Error();const r=(await c.query(`SELECT (SELECT count(*)::int FROM metro_website_outbox WHERE topic IN ('VPN_FULFILMENT_REQUESTED','VPN_REPLACEMENT_REQUESTED') AND state='LEASED' AND "leaseUntil">clock_timestamp()) AS leased,(SELECT count(*)::int FROM metro_website_operation WHERE state='PROCESSING') AS processing,(SELECT count(*)::int FROM metro_website_operation) AS operations,(SELECT count(*)::int FROM metro_website_outbox WHERE topic IN ('VPN_FULFILMENT_REQUESTED','VPN_REPLACEMENT_REQUESTED')) AS jobs`)).rows[0];await c.query('ROLLBACK');console.log(JSON.stringify(r));}finally{await c.end()}})().catch(()=>process.exit(1));'''
 return json.loads(run(['docker','exec',name,'node','-e',code]))

def safe_queue(q):assert q['leased']==0 and q['processing']==0

def worker_state(name):return json.loads(run(['docker','exec',name,'node','-e',"console.log(require('fs').readFileSync('/tmp/metro-commerce-worker-state.json','utf8'))"]))
def validate_disabled(name):
 x=inspect(name);env=dict(v.split('=',1)for v in x['Config']['Env']);assert env['METRO_FULFILMENT_ENABLED']=='false' and env['METRO_VPN_FULFILMENT_RECEIPTS_VERIFIED']=='false' and env['METRO_VPN_OBSERVATION_ENABLED']=='false'
 assert all(k not in env for k in ['BOT_TOKEN','DATABASE_URL','OUTLINE_API_URL','BETTER_AUTH_SECRET','SMTP_PASSWORD'])
 assert x['State']['Running'] and not x['State']['OOMKilled'] and x['RestartCount']==0 and x['State']['Health']['Status']=='healthy'
 state=worker_state(name);assert state['version']=='metro-website-worker.v2' and state['mode']=='DISABLED' and not state['observationEnabled'] and state['databaseVerified'] and state['poolMaximum']==2 and state['concurrency']==1
 result=json.loads(run(['docker','exec',name,'node','/metro-worker/worker-self-check.mjs']));assert result['actualProductionGateEnforced'] and result['validAccepted'] and result['invalidRejected']==5 and result['externalEffects']==0
 return state

def start(name):
 args=['docker','run','--detach','--name',name,'--label','metro.channel=website','--label','metro.worker=commerce','--label','metro.worker.release='+ROOT.name,'--label','com.centurylinklabs.watchtower.enable=false','--restart','unless-stopped','--user','1000:1000','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges:true','--pids-limit','64','--cpus','0.25','--tmpfs','/tmp:rw,noexec,nosuid,size=16m,mode=1777','--memory','134217728','--memory-swap','134217728','--log-driver','local','--log-opt','max-size=1m','--log-opt','max-file=2','--env-file',str(ROOT/'worker.env'),TAG,'node','/metro-worker/commerce-worker.mjs'];run(args)
 for _ in range(60):
  x=inspect(name)
  if x['State'].get('Health',{}).get('Status')=='healthy':return
  assert x['State']['Running'] and not x['State']['OOMKilled'];time.sleep(1)
 raise RuntimeError('WORKER_HEALTH_TIMEOUT')
try:
 continuity()
 if p['action']=='build':
  assert not ROOT.exists();ROOT.mkdir(mode=0o700);old=inspect('metro-commerce-worker');expected=next(v for v in p['inventory']['containers']if v['name']=='metro-commerce-worker');assert old['Id']==expected['id'] and old['Image']==expected['image'];safe_queue(queue('metro-commerce-worker'))
  assert int(next(l.split()[1]for l in open('/proc/meminfo')if l.startswith('MemAvailable:')))>180000
  private('legacy-worker.private.json',old);private('baseline.private.json',p['baseline']);context=ROOT/'context';context.mkdir();files=context/'worker';files.mkdir()
  for name,text in p['files'].items():
   assert name in ['commerce-worker.mjs','worker-self-check.mjs','worker-health.cjs','manifest.json'];(files/name).write_text(text);assert digest((files/name).read_bytes())==digest(text.encode())
  env=dict(v.split('=',1)for v in old['Config']['Env']);allowed=['NODE_ENV','NODE_OPTIONS','METRO_FULFILMENT_ENABLED','METRO_VPN_EXECUTION_APPROVED','METRO_COMMERCE_WORKER_DATABASE_URL','METRO_COMMERCE_WORKER_HEALTH_FILE','METRO_VPN_SERVICE_ORIGIN','METRO_VPN_SERVICE_KEY_ID','METRO_VPN_SERVICE_SECRET','METRO_NOTIFICATIONS_ENABLED'];env={k:v for k,v in env.items()if k in allowed}
  for k in ['METRO_COMMERCE_WORKER_DATABASE_URL','METRO_VPN_SERVICE_ORIGIN','METRO_VPN_SERVICE_KEY_ID','METRO_VPN_SERVICE_SECRET']:assert env.get(k)
  env.update(NODE_ENV='production',NODE_OPTIONS='--max-old-space-size=64',METRO_FULFILMENT_ENABLED='false',METRO_VPN_FULFILMENT_RECEIPTS_VERIFIED='false',METRO_VPN_OBSERVATION_ENABLED='false',METRO_NOTIFICATIONS_ENABLED='true',METRO_NOTIFICATION_EMAIL_ENABLED='false',METRO_COMMERCE_WORKER_HEALTH_FILE='/tmp/metro-commerce-worker-heartbeat')
  assert all('\n' not in k+v and '\r' not in k+v for k,v in env.items());(ROOT/'worker.env').write_text(''.join(k+'='+v+'\n'for k,v in env.items()));os.chmod(ROOT/'worker.env',0o600)
  rollbacktag='metro-website-commerce:legacy-rollback-'+p['releaseId'];run(['docker','image','tag',old['Image'],rollbacktag]);base='metro-website-commerce:base-'+p['releaseId'];run(['docker','image','tag',p['apiImage'],base]);(context/'Dockerfile').write_text('FROM '+base+'\nUSER root\nCOPY worker /metro-worker\nRUN chown -R node:node /metro-worker\nUSER node\nHEALTHCHECK --interval=15s --timeout=7s --start-period=15s --retries=3 CMD ["node","/metro-worker/worker-health.cjs"]\nCMD ["node","/metro-worker/commerce-worker.mjs"]\n');run(['docker','build','--network=none','--pull=false','-t',TAG,str(context)],timeout=150)
  result=json.loads(run(['docker','run','--rm','--network=none','--no-healthcheck','--read-only','--memory=128m','--memory-swap=128m','--pids-limit=32','--cap-drop=ALL','--security-opt=no-new-privileges','--env','METRO_FULFILMENT_ENABLED=false','--env','METRO_VPN_FULFILMENT_RECEIPTS_VERIFIED=false','--env','NODE_OPTIONS=--max-old-space-size=64','--entrypoint=node',TAG,'/metro-worker/worker-self-check.mjs']));assert result['actualProductionGateEnforced']
  image=json.loads(run(['docker','image','inspect',TAG]))[0]['Id'];private('build.json',{'image':image,'rollbackTag':rollbacktag,'gate':'DISABLED','manifest':p['manifest']})
  rollback='''import subprocess,json,pathlib,sys
root=pathlib.Path(sys.argv[1]);old=sys.argv[2];canary=sys.argv[3]
if (root/'committed').exists():sys.exit(0)
def run(a):return subprocess.run(a,capture_output=True,text=True)
for name in ['metro-commerce-worker',canary]:
 r=run(['docker','inspect',name])
 if r.returncode==0:
  c=json.loads(r.stdout)[0]
  if c['Config'].get('Labels',{}).get('metro.worker.release')==root.name:
   run(['docker','update','--restart=no',name]);run(['docker','stop','--time','20',name]);run(['docker','rm',name])
if run(['docker','inspect',old]).returncode==0:
 run(['docker','update','--restart=no',old]);run(['docker','rename',old,'metro-commerce-worker'])
# Fail-closed rollback: never restart an ungated legacy fulfilment worker.
(root/'rolled-back-paused').write_text('legacy retained stopped; no fulfilment activation')
'''
  (ROOT/'rollback.py').write_text(rollback);os.chmod(ROOT/'rollback.py',0o700);private('rollback.json',{'oldContainer':OLD,'imageTag':rollbacktag,'command':['python3',str(ROOT/'rollback.py'),str(ROOT),OLD,CANARY],'legacyResumption':'requires separately verified operator action; not automatic'})
  continuity();print(json.dumps({'status':'BUILT','image':image,'offlineReceiptSelfCheck':result,'rollbackPrepared':True,'legacyUnchanged':True}))
 elif p['action']=='canary':
  original=read('legacy-worker.private.json');assert inspect('metro-commerce-worker')['Id']==original['Id'];before=queue('metro-commerce-worker');safe_queue(before)
  try:
   start(CANARY);state=validate_disabled(CANARY);after=queue(CANARY);safe_queue(after);assert before==after
   private('canary.json',{'status':'PASS','state':state,'queueUnchanged':True,'noJobClaims':True,'image':inspect(CANARY)['Image']});print(json.dumps({'status':'PASS_CANARY','startupAndIdentityVerified':True,'activationDisabled':True,'receiptAcceptRejectVerified':True,'noJobClaims':True,'concurrency':1,'poolMaximum':2}))
  finally:
   if subprocess.run(['docker','inspect',CANARY],capture_output=True).returncode==0:run(['docker','update','--restart=no',CANARY]);run(['docker','stop','--time','20',CANARY]);run(['docker','rm',CANARY])
  continuity()
 elif p['action']=='deploy':
  assert read('canary.json')['status']=='PASS';original=read('legacy-worker.private.json');assert inspect('metro-commerce-worker')['Id']==original['Id'];before=queue('metro-commerce-worker');safe_queue(before)
  run(['systemd-run','--unit',UNIT,'--on-active=180s','python3',str(ROOT/'rollback.py'),str(ROOT),OLD,CANARY]);run(['docker','stop','--time','25','metro-commerce-worker']);run(['docker','rename','metro-commerce-worker',OLD]);run(['docker','update','--restart=no',OLD]);assert not inspect(OLD)['State']['Running']
  start('metro-commerce-worker');state=validate_disabled('metro-commerce-worker');after=queue('metro-commerce-worker');safe_queue(after);assert before==after
  items=json.loads(run(['docker','inspect']+run(['docker','ps','-aq']).split()));assert sum(1 for c in items if c['State']['Running'] and (c['Name']=='/metro-commerce-worker' or c['Config'].get('Labels',{}).get('metro.worker')=='commerce'))==1
  continuity();private('deployment.json',{'image':inspect('metro-commerce-worker')['Image'],'state':state,'legacyStopped':True,'queueUnchanged':True});print(json.dumps({'status':'DEPLOYED_PENDING_COMMIT','legacyStopped':True,'actualWorkerGate':'FALSE','noJobClaims':True,'restrictedIdentityVerified':True,'telegramAndApiUnchanged':True,'emailDisabled':True,'rollbackTimerActive':True}))
 elif p['action']=='commit':
  assert inspect('metro-commerce-worker')['Image']==read('build.json')['image'];validate_disabled('metro-commerce-worker');safe_queue(queue('metro-commerce-worker'));assert not inspect(OLD)['State']['Running'];continuity();(ROOT/'committed').write_text(time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()));run(['systemctl','stop',UNIT+'.timer']);print(json.dumps({'status':'COMMITTED','workerHealthy':True,'legacyReplaced':True,'activationFlag':False,'observationEnabled':False,'emailEnabled':False,'rollbackRetainedPaused':True}))
 elif p['action']=='rollback':
  assert not (ROOT/'committed').exists();run(['python3',str(ROOT/'rollback.py'),str(ROOT),OLD,CANARY]);print(json.dumps({'status':'ROLLED_BACK_PAUSED'}))
 else:raise RuntimeError('INVALID_RELEASE_ACTION')
except Exception as e:
 rolled=False
 if p['action']=='deploy'and(ROOT/'rollback.py').exists():rolled=subprocess.run(['python3',str(ROOT/'rollback.py'),str(ROOT),OLD,CANARY],capture_output=True).returncode==0
 print(json.dumps({'status':'BLOCKED','action':p.get('action'),'errorType':type(e).__name__,'line':__import__('traceback').extract_tb(sys.exc_info()[2])[-1].lineno,'rolledBackPaused':rolled}));sys.exit(1)
