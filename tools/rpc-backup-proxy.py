#!/usr/bin/env python3
"""Local read-only RPC backup. Credentials live outside the website/repository."""
import json
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
CONFIG=Path.home()/'.config/fstswap/rpc-backup.json'
UPSTREAM=json.loads(CONFIG.read_text())['https']
ALLOWED={'eth_chainId','eth_blockNumber','eth_call','eth_estimateGas','eth_gasPrice','eth_maxPriorityFeePerGas','eth_feeHistory','eth_getBalance','eth_getCode','eth_getStorageAt','eth_getTransactionCount','eth_getTransactionReceipt','eth_getTransactionByHash','eth_getBlockByNumber','eth_getBlockByHash','eth_getLogs','net_version','web3_clientVersion'}
ORIGINS={'http://127.0.0.1:8124','http://localhost:8124'}
OPENER=urllib.request.build_opener(urllib.request.ProxyHandler({}))
class Handler(BaseHTTPRequestHandler):
    def log_message(self,*args): pass
    def reply(self,code,payload):
        data=json.dumps(payload).encode();self.send_response(code)
        origin=self.headers.get('Origin')
        if origin in ORIGINS:self.send_header('Access-Control-Allow-Origin',origin)
        self.send_header('Content-Type','application/json');self.send_header('Cache-Control','no-store');self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)
    def do_OPTIONS(self):
        if self.headers.get('Origin') not in ORIGINS:return self.reply(403,{'error':'origin rejected'})
        self.send_response(204);self.send_header('Access-Control-Allow-Origin',self.headers['Origin']);self.send_header('Access-Control-Allow-Methods','POST');self.send_header('Access-Control-Allow-Headers','content-type');self.end_headers()
    def do_POST(self):
        if self.path!='/rpc' or self.headers.get('Origin') not in ORIGINS|{None}:return self.reply(403,{'error':'origin rejected'})
        ident=None
        try:
            length=int(self.headers.get('Content-Length','0'))
            if length<1 or length>1048576:raise ValueError()
            body=json.loads(self.rfile.read(length));ident=body.get('id')
            if body.get('method') not in ALLOWED:return self.reply(403,{'jsonrpc':'2.0','id':ident,'error':{'code':-32601,'message':'Read-only backup RPC'}})
            request=urllib.request.Request(UPSTREAM,data=json.dumps(body).encode(),headers={'content-type':'application/json'})
            with OPENER.open(request,timeout=8) as response:result=json.load(response)
            # Do not forward provider error strings that could contain an authenticated URL.
            if 'error' in result:result={'jsonrpc':'2.0','id':ident,'error':{'code':-32000,'message':'Backup RPC request failed'}}
            return self.reply(200,result)
        except Exception:return self.reply(502,{'jsonrpc':'2.0','id':ident,'error':{'code':-32000,'message':'Backup RPC unavailable'}})
print('FstSwap read-only backup listening on 127.0.0.1:8126',flush=True)
ThreadingHTTPServer(('127.0.0.1',8126),Handler).serve_forever()
