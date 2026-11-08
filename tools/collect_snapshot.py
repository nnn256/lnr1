"""Refresh a complete real market snapshot before publishing, with a bounded timeout."""
import argparse
import json
import subprocess
import sys
import time
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT))
from market_runtime import MarketAPI

def collect(directory,timeout=900):
    api=MarketAPI(directory)
    worker=subprocess.Popen(['node',str(ROOT/'tools/score-stdio.cjs')],stdin=subprocess.PIPE,stdout=subprocess.PIPE,text=True,encoding='utf8')
    start=time.monotonic()
    try:
        market=api.scan_auto();api._write('market.json',market);api._update(market=market,market_version=1)
        api.batch.params={};last=-1
        while time.monotonic()-start<timeout:
            api.batch._step();state=api.batch.poll();p=state['progress']
            if p['completed']//500!=last:
                print(json.dumps(p,ensure_ascii=True),flush=True);last=p['completed']//500
            if state.get('batch'):
                packet=state['batch'];worker.stdin.write(json.dumps(packet)+'\n');worker.stdin.flush();response=json.loads(worker.stdout.readline())
                assert api.batch.acknowledge(state['run_id'],packet['token'],response['results'],response['errors'])['ok']
            if p['phase']=='complete':
                if p['downloaded']<p['total']*.9:raise RuntimeError('Insufficient real history coverage; previous deployment remains in place')
                print('Snapshot ready',p['downloaded'],p['total'],flush=True);return p
        raise TimeoutError('Snapshot collection did not finish')
    finally:
        api.close();worker.terminate()

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--data-dir',default=str(ROOT/'runtime/data'));a=parser.parse_args();collect(a.data_dir)
