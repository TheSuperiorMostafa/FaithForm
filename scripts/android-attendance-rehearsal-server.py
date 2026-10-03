#!/usr/bin/env python3
"""Local fixture for BackgroundAttendanceRehearsalTest.

Run only while rehearsing on the Android emulator. Uses a synthetic account,
synthetic location and in-memory attendance; never connects to FaithForm.
Run: python3 scripts/android-attendance-rehearsal-server.py
"""
import json,time,threading
from datetime import datetime,timezone
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
state={'attempts':[],'offline':False,'due':None,'revoked':False}
def iso(t=None):return datetime.fromtimestamp(t or time.time(),timezone.utc).isoformat().replace('+00:00','Z')
def bootstrap():
 return {'profile':{'displayName':'Rehearsal','status':'active','termsVersion':'2026-08-01','privacyVersion':'2026-08-01','autoAttendanceConsent':'revoked' if state['revoked'] else 'granted','communicationPrefs':{},'selectedChurchSlug':'rehearsal','authorizationVersion':1},'relationships':[{'churchSlug':'rehearsal','churchName':'Isolated rehearsal','automaticCheckInEnabled':True,'state':'joined','joinPolicy':'open','updatedAt':iso(),'canReadPublishedContent':True}],'pendingRequests':[],'requiredTermsVersion':'2026-08-01','requiredPrivacyVersion':'2026-08-01','enabledCapabilities':['account','attendance'],'serverTime':iso()}
class Handler(BaseHTTPRequestHandler):
 def log_message(self,*a):pass
 def reply(self,data,status=200):
  body=json.dumps({'ok':True,'data':data,'meta':{'apiVersion':'1.0','apiMajor':1,'requestId':'rehearsal','minimumSupportedClientBuild':1}}).encode();self.send_response(status);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
 def do_GET(self):
  path=self.path.split('?')[0]
  if path=='/status':return self.reply({'detected':sum(a['phase']=='detected' for a in state['attempts']),'confirmed':sum(a['phase']=='confirm' for a in state['attempts']),'keys':[a['key'] for a in state['attempts']]})
  if path.endswith('/bootstrap'):return self.reply(bootstrap())
  if path.endswith('/geofence-config'):
   return self.reply({'configuration':{'churchSlug':'rehearsal','regions':[{'regionId':'faithform.rehearsal','campusName':'Isolated fixture','latitude':60.0,'longitude':60.0,'radiusMeters':100}],'windows':[],'sources':{'geofence':True,'qr':True,'manual':True},'requiresConfirmation':True,'minDwellSeconds':6,'maxLocationAccuracyM':100,'configVersion':1,'expiresAt':iso(time.time()+3600)}})
  if path.endswith('/occurrence'):
   return self.reply({'occurrence':{'occurrenceId':'rehearsal-occurrence','label':'Fixture','churchSlug':'rehearsal','localServiceDate':'2026-09-30','timezone':'UTC','startsAt':iso(),'endsAt':iso(time.time()+3600),'checkinOpensAt':iso(time.time()-3600),'checkinClosesAt':iso(time.time()+3600),'status':'open'}})
  return self.reply({},404)
 def do_POST(self):
  data=json.loads(self.rfile.read(int(self.headers.get('Content-Length',0))) or '{}')
  if self.path=='/control':
   if data.get('reset'):state.update(attempts=[],offline=False,due=None,revoked=False)
   if 'offline' in data:state['offline']=data['offline']
   return self.reply({})
  if self.path.endswith('/consent'):
   if state['offline']:return self.reply({},503)
   state['revoked']=data['autoAttendanceConsent']=='revoked';return self.reply({'autoAttendanceConsent':'revoked' if state['revoked'] else 'granted','authorizationVersion':1})
  if self.path.endswith('/attempt'):
   assert self.headers.get('Authorization')=='Bearer isolated-rehearsal'
   state['attempts'].append({'phase':data['phase'],'key':self.headers.get('Idempotency-Key')})
   if data['phase']=='detected':state['due']=time.time()+6
   if data['phase']=='confirm':assert data.get('detectionId')=='rehearsal-detection' and time.time()>=state['due']
   return self.reply({'outcome':'pending_confirmation' if data['phase']=='detected' else 'counted','message':'Rehearsal only','occurrenceId':'rehearsal-occurrence','confirmationNotBefore':iso(state['due']) if data['phase']=='detected' else None,'detectionId':'rehearsal-detection'})
  return self.reply({},404)
print('Isolated attendance fixture listening on 18765',flush=True)
ThreadingHTTPServer(('127.0.0.1',18765),Handler).serve_forever()
