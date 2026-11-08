import json
import tempfile
import unittest
from pathlib import Path
from tools.build_site import export

class ExportTests(unittest.TestCase):
    def test_missing_legacy_short_record_is_empty_and_private_paths_are_not_published(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);data=root/'data';data.mkdir();out=root/'site'
            def save(name,value):(data/name).write_text(json.dumps(value),encoding='utf8')
            save('market.json',dict(securities=[dict(code='600000',name='fixture'),dict(code='688827',name='empty')],rows=[],server='private-endpoint',received_at='2026-11-06'))
            save('analysis-fixture.json',dict(results={'600000':dict(code='600000',origin='private-path')},failures={'688827':dict(kind='short_history',message='only 0 valid daily bars')}))
            save('daily-600000.json',dict(code='600000',origin='private-history-path',first_date='2026-11-06',last_date='2026-11-06',bars=[dict(date='2026-11-06',open=1,high=2,low=1,close=2,volume=1)]))
            result=export(data,out)
            self.assertEqual(next(x for x in result['issues'] if x['code']=='688827')['kind'],'no_history')
            for file in out.glob('data/**/*.json'):self.assertNotIn('private-',file.read_text(encoding='utf8'))
            self.assertFalse((out/'web_server.py').exists())
            self.assertEqual(result['histories'],['600000'])

if __name__=='__main__':unittest.main()
