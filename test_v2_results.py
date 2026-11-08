import gzip,hashlib,json,sqlite3,tempfile,unittest
from pathlib import Path
from v2_results import V2Results

class V2ResultsTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name)
        self.state=self.root/'runtime/workbench';self.state.mkdir(parents=True)
        self.database=self.state/'workbench.sqlite3'
        db=sqlite3.connect(self.database)
        db.executescript('CREATE TABLE jobs(id,title,mode,state,created,updated,total,done,success,failed);CREATE TABLE universe(symbol,code,name);CREATE TABLE items(job_id,symbol,state,summary,error,artifact);')
        db.execute("INSERT INTO jobs VALUES ('job1','fixture','full','completed','2026-11-08','2026-11-08',2,2,1,1)")
        db.executemany('INSERT INTO universe VALUES (?,?,?)',[('sz002149','002149','西部材料'),('bj920000','920000','安徽凤凰')])
        self.bundle={'summary':{'symbol':'sz002149','name':'西部材料'},'chart':{'panels':[{'period':'day','bars':[{'time':1,'close':10}]},{'period':'5m','bars':[{'time':2,'close':11}]}],'definition_mode':'saved_test','input_sha256':{'day':'fixture-hash'}}}
        (self.state/'result.gz').write_bytes(gzip.compress(json.dumps(self.bundle).encode()))
        db.executemany('INSERT INTO items VALUES (?,?,?,?,?,?)',[('job1','sz002149','success',json.dumps({'last_date':'2026-11-06','price':37.74}),'','result.gz'),('job1','bj920000','failed','{}','data unavailable',None)])
        db.commit();db.close();self.store=V2Results([self.root]);self.source=self.store.sources()[0]['id']
    def tearDown(self):self.tmp.cleanup()
    def test_lists_and_reads_same_task_result_without_modifying_db(self):
        digest=hashlib.sha256(self.database.read_bytes()).hexdigest()
        self.assertEqual(self.store.jobs()['jobs'][0]['success'],1)
        rows=self.store.stocks(self.source,'job1')['rows'];self.assertEqual(rows[0]['symbol'],'sz002149')
        self.assertEqual(self.store.stocks(self.source,'job1','002149')['total'],1)
        result=self.store.result(self.source,'job1','sz002149','5m');self.assertEqual(result['panel']['period'],'5m');self.assertFalse(result['execution_allowed'])
        self.assertEqual(hashlib.sha256(self.database.read_bytes()).hexdigest(),digest)
    def test_wrong_task_failed_stock_or_missing_period_is_not_mislabeled_success(self):
        self.assertFalse(self.store.result(self.source,'other','sz002149')['available'])
        failed=self.store.result(self.source,'job1','bj920000');self.assertEqual(failed['state'],'failed');self.assertIn('unavailable',failed['message'])
        self.assertFalse(self.store.result(self.source,'job1','sz002149','30m')['available'])
    def test_invalid_source_and_path_traversal_rejected(self):
        with self.assertRaises(ValueError):self.store.jobs('invalid')
        db=sqlite3.connect(self.database);db.execute("UPDATE items SET artifact='../../../outside.gz' WHERE symbol='sz002149'");db.commit();db.close()
        with self.assertRaisesRegex(ValueError,'路径'):self.store.result(self.source,'job1','sz002149')
    def test_artifact_cannot_return_a_different_stock(self):
        self.bundle['summary']['symbol']='sh600519';(self.state/'result.gz').write_bytes(gzip.compress(json.dumps(self.bundle).encode()))
        with self.assertRaisesRegex(ValueError,'股票'):self.store.result(self.source,'job1','sz002149')
    def test_empty_result_roots_do_not_create_database(self):
        missing=self.root/'missing';report=V2Results([missing]).jobs();self.assertEqual(report['jobs'],[]);self.assertFalse(missing.exists())

if __name__=='__main__':unittest.main()
