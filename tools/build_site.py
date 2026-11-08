"""Export real OHLCV and compact scores for GitHub Pages; never export local task paths."""
import argparse
import datetime as dt
import json
import hashlib
import re
import shutil
import sys
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from tools.site_files import ASSETS

def write(path,value):
    path.parent.mkdir(parents=True,exist_ok=True)
    path.write_text(json.dumps(value,ensure_ascii=False,separators=(',',':'),allow_nan=False),encoding='utf8')

def versioned_index(assets):
    digest=hashlib.sha256(''.join(name+assets[name] for name in sorted(assets) if name.endswith(('.js','.css'))).encode()).hexdigest()[:16]
    html=re.sub(r'(src|href)="([^"]+)"',lambda match:match[1]+'="'+match[2]+'?v='+digest+'"' if match[2] in assets else match[0],assets['index.html'])
    return html.replace('<script src=',f'<script>window.LIANGCE_ASSET_VERSION="{digest}";</script>\n  <script src=',1)

def export(data_dir, output):
    data_dir=Path(data_dir);output=Path(output)
    market=json.loads((data_dir/'market.json').read_text(encoding='utf8'))
    checkpoints=sorted(data_dir.glob('analysis-*.json'),key=lambda p:p.stat().st_mtime,reverse=True)
    if not checkpoints:raise ValueError('No acknowledged scoring checkpoint; collect data first')
    saved=json.loads(checkpoints[0].read_text(encoding='utf8'))
    market={key:market[key] for key in ('rows','securities','received_at','total_codes','total_quotes','source') if key in market}
    market.update(ok=True,cached=True)
    if not market.get('securities') or not saved.get('results'):raise ValueError('Empty market/scores cannot be published')
    output.mkdir(parents=True,exist_ok=True)
    for name in ASSETS:
        p=output/name;p.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(ROOT/name,p)
    (output/'web-config.js').write_text("window.LIANGCE_WEB_CONFIG={mode:'snapshot',live_api:'https://liangce-v3-api-production.up.railway.app'};\n",encoding='utf8')
    assets={name:(output/name).read_text(encoding='utf-8-sig') for name in ASSETS}
    (output/'index.html').write_text(versioned_index(assets),encoding='utf8')
    (output/'.nojekyll').write_text('',encoding='utf8')
    names={item['code']:item['name'] for item in market['securities']}
    histories=[];issues=[];latest=[];bars_total=0
    for code,name in sorted(names.items()):
        p=data_dir/f'daily-{code}.json'
        if not p.exists():
            error=saved.get('failures',{}).get(code,{})
            kind=error.get('kind','no_history')
            if kind=='short_history':kind='no_history'
            issues.append(dict(code=code,name=name,kind=kind,bar_count=0,message='暂无可发布K线' if kind=='no_history' else error.get('message','数据待重试')));continue
        h=json.loads(p.read_text(encoding='utf8'));bars=h.get('bars',[])
        if not bars:continue
        if len(bars)<100:issues.append(dict(code=code,name=name,kind='short_history',bar_count=len(bars),first_date=bars[0]['date'],last_date=bars[-1]['date'],message=f'已获取 {len(bars)} 根日线，评分需累计100根'))
        result={key:h[key] for key in ('code','name','source','adjusted','volume_unit','first_date','last_date','checked_at') if key in h}
        result['bars']=[[b[k] for k in ('date','open','high','low','close','volume')] for b in bars]
        write(output/f'data/daily/{code}.json',result)
        histories.append(code);latest.append(bars[-1]['date']);bars_total+=len(bars)
    # Never ship stale candle files left by an earlier build for delisted symbols.
    for p in (output/'data/daily').glob('*.json'):
        if p.stem not in names:p.unlink()
    write(output/'data/market.json',market)
    scores=list(saved['results'].values())
    for score in scores:
        for key in ('origin','path','endpoint'):score.pop(key,None)
    write(output/'data/scores.json',scores)
    manifest=dict(version='1.6.0',generated_at=dt.datetime.now(dt.timezone(dt.timedelta(hours=8))).isoformat(timespec='seconds'),
        market_day=max(latest),histories=histories,issues=issues,bars_total=bars_total,stocks=len(names),scores=len(scores))
    write(output/'data/manifest.json',manifest)
    size=sum(p.stat().st_size for p in output.rglob('*') if p.is_file())
    if size>950_000_000:raise ValueError('Published site is too large for GitHub Pages')
    print(json.dumps(dict(stocks=len(names),histories=len(histories),scores=len(scores),bars=bars_total,bytes=size,output=str(output)),ensure_ascii=True))
    return manifest

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--data-dir',default=str(ROOT/'runtime/data'));parser.add_argument('--output',default=str(ROOT/'_site'));a=parser.parse_args();export(a.data_dir,a.output)
