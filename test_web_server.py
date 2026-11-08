import base64
import io
import json
import tempfile
import unittest
from unittest.mock import patch
from web_server import WebApplication

class WebTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.app=WebApplication(self.tmp.name,password='')
    def tearDown(self):
        self.app.close()
        for h in self.app.api.log.handlers[:]:h.close();self.app.api.log.removeHandler(h)
        self.tmp.cleanup()
    def call(self,path,method='GET',args=None,headers=None):
        raw=json.dumps(args or []).encode();status=[]
        env=dict(PATH_INFO=path,REQUEST_METHOD=method,CONTENT_LENGTH=str(len(raw)),HTTP_HOST='localhost:8765',wsgi_input=None)
        env['wsgi.input']=io.BytesIO(raw);env.update(headers or {})
        body=b''.join(self.app(env,lambda code,h:status.extend([code,dict(h)])))
        return status[0],status[1],body
    def test_only_public_assets_and_explicit_api_are_served(self):
        for path in ['/market_runtime.py','/.env','/runtime/data/market.json','/../market_runtime.py','/verification/data-copy.json']:
            self.assertEqual(self.call(path)[0],'404 Not Found')
        self.assertEqual(self.call('/')[0],'200 OK')
        self.assertEqual(self.call('/api/open_chart_exports','POST',headers={'HTTP_X_LIANGCE_WEB':'1'})[0],'404 Not Found')
    def test_cross_origin_and_missing_client_header_are_rejected(self):
        self.assertEqual(self.call('/api/get_state','POST')[0],'403 Forbidden')
        self.assertEqual(self.call('/api/get_state','POST',headers={'HTTP_X_LIANGCE_WEB':'1','HTTP_ORIGIN':'https://different.test'})[0],'403 Forbidden')
        self.assertEqual(self.call('/api/get_state','POST',headers={'HTTP_X_LIANGCE_WEB':'1','HTTP_ORIGIN':'http://localhost:8765'})[0],'200 OK')
    def test_browser_sessions_have_independent_scoring_controls(self):
        first=self.call('/')[1]['Set-Cookie'].split(';')[0];second=self.call('/')[1]['Set-Cookie'].split(';')[0]
        self.assertNotEqual(first,second)
        self.call('/api/control_analysis','POST',['pause'],{'HTTP_X_LIANGCE_WEB':'1','HTTP_COOKIE':first})
        a=json.loads(self.call('/api/get_analysis_batch','POST',headers={'HTTP_X_LIANGCE_WEB':'1','HTTP_COOKIE':first})[2])
        b=json.loads(self.call('/api/get_analysis_batch','POST',headers={'HTTP_X_LIANGCE_WEB':'1','HTTP_COOKIE':second})[2])
        self.assertEqual(a['progress']['phase'],'paused');self.assertNotEqual(b['progress']['phase'],'paused')
    def test_password_protects_assets_and_api_when_configured(self):
        self.app.password='example-pass'
        self.assertEqual(self.call('/')[0],'401 Unauthorized')
        auth='Basic '+base64.b64encode(b'research:example-pass').decode()
        self.assertEqual(self.call('/api/health',headers={'HTTP_AUTHORIZATION':auth})[0],'200 OK')
    def test_invalid_request_returns_json_without_traceback(self):
        status,_,body=self.call('/api/get_chart_history','POST',['bad'],{'HTTP_X_LIANGCE_WEB':'1'})
        self.assertEqual(status,'200 OK');self.assertFalse(json.loads(body)['ok'])
        status,_,body=self.call('/api/control_analysis','POST',['wrong'],{'HTTP_X_LIANGCE_WEB':'1'})
        self.assertEqual(status,'400 Bad Request');self.assertNotIn('Traceback',body.decode())
    def test_backtest_data_endpoint_uses_history_service_and_sectors_read_saved_data(self):
        with patch.object(self.app.api,'get_chart_history',return_value={'ok':True,'bars':[]}) as history:
            status,_,_=self.call('/api/get_backtest_history','POST',['600519'],{'HTTP_X_LIANGCE_WEB':'1'})
            self.assertEqual(status,'200 OK');history.assert_called_once_with('600519')
        status,_,body=self.call('/api/get_sectors','POST',headers={'HTTP_X_LIANGCE_WEB':'1'})
        self.assertFalse(json.loads(body)['ok'])
        (self.app.api.data_dir/'sectors.json').write_text(json.dumps({'ok':True,'rows':[{'code':'BK0459'}]}),encoding='utf8')
        status,_,body=self.call('/api/get_sectors','POST',headers={'HTTP_X_LIANGCE_WEB':'1'})
        self.assertEqual(json.loads(body)['rows'][0]['code'],'BK0459')

if __name__=='__main__':unittest.main()
