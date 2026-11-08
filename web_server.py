"""Same-origin web host. Serves an explicit asset list and isolated scoring queues."""
import argparse
import base64
import hmac
import json
import mimetypes
import os
import secrets
import threading
import time
from http import cookies
from pathlib import Path
from urllib.parse import urlsplit
from wsgiref.simple_server import WSGIServer, make_server
from socketserver import ThreadingMixIn

from market_runtime import MarketAPI, BASE, SHANGHAI, normalize_bars
from batch_analysis import BatchAnalysis
from tools.site_files import ASSETS


class SessionData:
    def __init__(self, shared, ident):
        self.shared=shared
        self.data_dir=shared.data_dir/'sessions'/ident
        self.data_dir.mkdir(parents=True,exist_ok=True)
    def __getattr__(self,name):return getattr(self.shared,name)
    def _read(self,name):
        if name.startswith('analysis-'):
            try:return json.loads((self.data_dir/name).read_text(encoding='utf8'))
            except (OSError,ValueError):pass
        return self.shared._read(name)
    def _write(self,name,value):
        if name.startswith('analysis-'):
            target=self.data_dir/name
            temporary=target.with_suffix('.'+secrets.token_hex(6)+'.tmp')
            temporary.write_text(json.dumps(value,ensure_ascii=False),encoding='utf8');temporary.replace(target)
        else:
            with self.shared.lock:self.shared._write(name,value)


class WebApplication:
    def __init__(self, data_dir=None, password=None):
        self.api=MarketAPI(data_dir or os.getenv('LIANGCE_DATA_DIR',str(BASE/'runtime/data')))
        self.password=password if password is not None else os.getenv('LIANGCE_WEB_PASSWORD','')
        self.sessions={};self.lock=threading.Lock()
    def session(self,environ):
        jar=cookies.SimpleCookie()
        try:jar.load(environ.get('HTTP_COOKIE',''))
        except cookies.CookieError:pass
        ident=jar.get('liangce_session');ident=ident.value if ident else ''
        with self.lock:
            for key,(batch,touched) in list(self.sessions.items()):
                if time.monotonic()-touched>1800:batch.close();del self.sessions[key]
            if ident not in self.sessions:
                if len(self.sessions)>=32:raise ValueError('访问会话过多，请稍后重试')
                ident=secrets.token_urlsafe(24)
                batch=BatchAnalysis(SessionData(self.api,ident),normalize_bars,BASE,SHANGHAI)
            else:batch=self.sessions[ident][0]
            self.sessions[ident]=(batch,time.monotonic())
        return ident,batch
    def __call__(self,environ,start_response):
        path=environ.get('PATH_INFO','/');headers=[('X-Content-Type-Options','nosniff'),('Referrer-Policy','same-origin'),('Cache-Control','no-store')]
        def respond(status,value,content_type='application/json; charset=utf-8'):
            raw=value if isinstance(value,bytes) else json.dumps(value,ensure_ascii=False).encode()
            start_response(status,headers+[('Content-Type',content_type),('Content-Length',str(len(raw)))]);return [raw]
        if self.password:
            try:
                auth=environ.get('HTTP_AUTHORIZATION','')
                decoded=base64.b64decode(auth.removeprefix('Basic '),validate=True).decode()
                authenticated=auth.startswith('Basic ') and hmac.compare_digest(decoded.split(':',1)[-1],self.password)
            except (ValueError,UnicodeError):authenticated=False
            if not authenticated:
                headers.append(('WWW-Authenticate','Basic realm="LiangCe", charset="UTF-8"'))
                return respond('401 Unauthorized',{'message':'请登录 LiangCe'})
        if path=='/api/health':return respond('200 OK',{'ok':True,'version':'1.6.0','mode':'api'})
        if path.startswith('/api/'):
            if environ['REQUEST_METHOD']!='POST':return respond('405 Method Not Allowed',{'message':'POST required'})
            origin=environ.get('HTTP_ORIGIN');host=environ.get('HTTP_HOST','')
            if environ.get('HTTP_X_LIANGCE_WEB')!='1' or (origin and urlsplit(origin).netloc!=host):
                return respond('403 Forbidden',{'message':'请求来源无效'})
            try:
                length=int(environ.get('CONTENT_LENGTH','0'))
                if length<2 or length>2_000_000:raise ValueError('请求长度无效')
                args=json.loads(environ['wsgi.input'].read(length))
                if not isinstance(args,list) or len(args)>6:raise ValueError('请求参数无效')
                ident,batch=self.session(environ)
                headers.append(('Set-Cookie',f'liangce_session={ident}; Path=/; HttpOnly; SameSite=Lax'+('; Secure' if environ.get('wsgi.url_scheme')=='https' else '')))
                session_methods={'configure_analysis':batch.configure,'get_analysis_batch':batch.poll,
                    'complete_analysis_batch':batch.acknowledge,'control_analysis':batch.control,'get_analysis_issues':batch.issues}
                read_methods={'start_background','refresh_data','get_state','get_research_report','get_chart_history','list_v2_jobs','get_v2_task_stocks','get_v2_task_result'}
                name=path.removeprefix('/api/')
                if name in session_methods:value=session_methods[name](*args)
                elif name in read_methods:value=getattr(self.api,name)(*args)
                else:return respond('404 Not Found',{'message':'接口不存在'})
                if name=='get_state':value['batch_analysis']=batch.snapshot()
                return respond('200 OK',value)
            except (ValueError,TypeError,KeyError) as error:return respond('400 Bad Request',{'message':str(error)[:160]})
            except Exception:
                self.api.log.exception('web request failed')
                return respond('503 Service Unavailable',{'message':'数据服务暂不可用，请稍后重试'})
        if environ['REQUEST_METHOD'] not in ('GET','HEAD'):return respond('405 Method Not Allowed',{'message':'GET required'})
        name=path.lstrip('/') or 'index.html'
        if name not in ASSETS:return respond('404 Not Found',{'message':'文件不存在'})
        ident,_=self.session(environ)
        if name=='index.html':headers.append(('Set-Cookie',f'liangce_session={ident}; Path=/; HttpOnly; SameSite=Lax'))
        try:raw=(BASE/name).read_bytes()
        except OSError:return respond('404 Not Found',{'message':'资源尚未构建'})
        return respond('200 OK',raw,mimetypes.guess_type(name)[0] or 'application/octet-stream')
    def close(self):
        for batch,_ in self.sessions.values():batch.close()
        self.api.close()


class ThreadedServer(ThreadingMixIn,WSGIServer):
    daemon_threads=True


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--host',default='127.0.0.1');parser.add_argument('--port',type=int,default=8765);parser.add_argument('--data-dir');args=parser.parse_args()
    app=WebApplication(args.data_dir)
    print(f'LiangCe Web: http://{args.host}:{args.port}',flush=True)
    try:
        with make_server(args.host,args.port,app,server_class=ThreadedServer) as server:server.serve_forever()
    finally:app.close()

if __name__=='__main__':main()
