"""Read existing V2 task artifacts inside LiangCe without modifying their database."""
import gzip
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import threading

class V2Results:
    def __init__(self, roots=None):
        configured=os.getenv('LIANGCE_V2_RESULT_ROOTS','')
        self.roots=[Path(p).resolve() for p in (roots if roots is not None else configured.split(';') if configured else [
            Path.home()/'Documents/ChanlunWorkbenchData/project',
            Path.home()/'AppData/Local/ChanlunWorkbench/project',
            Path.home()/'Documents/ChatGPT/缠学习/缠论算法'])]
        self._lock=threading.Lock()
        self._cached_key=None
        self._cached_bundle=None

    def sources(self):
        seen=set();output=[]
        for root in self.roots:
            database=root/'runtime/workbench/workbench.sqlite3'
            if not database.is_file() or root in seen:continue
            seen.add(root)
            output.append(dict(id=hashlib.sha256(str(root).encode()).hexdigest()[:16],
                               label='当前用户任务库' if not output else '其他本地任务库 '+str(len(output)),root=root,database=database))
        return output

    def _source(self, ident):
        sources=self.sources()
        if not sources:raise ValueError('尚未找到本机V2任务结果库')
        source=next((s for s in sources if s['id']==ident),None) if ident else sources[0]
        if source is None:raise ValueError('任务库不存在，请刷新列表')
        return source

    def _connection(self, source):
        db=sqlite3.connect(source['database'].as_uri()+'?mode=ro',uri=True,timeout=8)
        db.row_factory=sqlite3.Row;db.execute('PRAGMA query_only=ON')
        return db

    def jobs(self, source_id=None):
        sources=self.sources()
        if not sources:return dict(ok=True,sources=[],jobs=[],source_id=None,message='尚未找到本机V2任务结果，请先在研究工作台完成计算')
        source=self._source(source_id);db=self._connection(source)
        try:
            rows=[dict(r) for r in db.execute('SELECT id,title,mode,state,created,updated,total,done,success,failed FROM jobs ORDER BY created DESC LIMIT 100')]
            return dict(ok=True,source_id=source['id'],sources=[dict(id=s['id'],label=s['label']) for s in sources],jobs=rows)
        finally:db.close()

    def stocks(self, source_id, job_id, query='',offset=0):
        source=self._source(source_id);db=self._connection(source)
        if not re.fullmatch(r'[A-Za-z0-9-]{1,100}',str(job_id)):raise ValueError('任务编号无效')
        query=str(query)[:80];offset=max(0,int(offset));params=[job_id,'%'+query+'%','%'+query+'%']
        where='FROM items i JOIN universe u USING(symbol) WHERE i.job_id=? AND (u.code LIKE ? OR u.name LIKE ?)'
        try:
            total=db.execute('SELECT count(*) '+where,params).fetchone()[0]
            rows=[]
            for row in db.execute('SELECT i.symbol,u.code,u.name,i.state,i.summary,i.error '+where+" ORDER BY (i.state='success') DESC,i.symbol LIMIT 100 OFFSET ?",params+[offset]):
                item=dict(row);summary=json.loads(item.pop('summary') or '{}')
                item.update(last_date=summary.get('last_date'),price=summary.get('price'),change_pct=summary.get('change_pct'))
                rows.append(item)
            return dict(ok=True,source_id=source['id'],job_id=job_id,total=total,rows=rows,offset=offset,limit=100)
        finally:db.close()

    def result(self, source_id, job_id, symbol, period='day'):
        if not re.fullmatch(r'(sh|sz|bj)\d{6}',str(symbol)):raise ValueError('股票代码无效')
        source=self._source(source_id);db=self._connection(source)
        try:
            row=db.execute('SELECT i.state,i.error,i.artifact,u.name FROM items i JOIN universe u USING(symbol) WHERE job_id=? AND symbol=?',(job_id,symbol)).fetchone()
        finally:db.close()
        if row is None:return dict(ok=True,available=False,symbol=symbol,state='not_in_task',message='这只股票不在所选任务中')
        if row['state']!='success' or not row['artifact']:
            return dict(ok=True,available=False,symbol=symbol,name=row['name'],state=row['state'],message=row['error'] or '该任务尚未完成这只股票')
        state_root=(source['root']/'runtime/workbench').resolve()
        artifact=(state_root/row['artifact']).resolve()
        if not artifact.is_relative_to(state_root):raise ValueError('结果路径超出本地任务目录')
        stat=artifact.stat()
        if stat.st_size>64*1024*1024:raise ValueError('结果文件超过读取上限')
        key=(str(artifact),stat.st_mtime_ns,stat.st_size)
        with self._lock:
            if self._cached_key!=key:
                with gzip.open(artifact,'rb') as stream:raw=stream.read(256*1024*1024+1)
                if len(raw)>256*1024*1024:raise ValueError('解压结果超过读取上限')
                bundle=json.loads(raw)
                if bundle.get('summary',{}).get('symbol')!=symbol:raise ValueError('结果文件股票与任务不一致')
                # Never keep huge recursive reports after parsing: only saved charts and metadata.
                self._cached_bundle=dict(summary=bundle['summary'],chart=bundle['chart'])
                self._cached_key=key
            bundle=self._cached_bundle
            if bundle['summary'].get('symbol')!=symbol:raise ValueError('结果缓存股票不一致')
            panels=bundle['chart'].get('panels',[])
            panel=next((p for p in panels if p.get('period')==period),None)
            if panel is None:return dict(ok=True,available=False,symbol=symbol,state='period_missing',message='所选任务没有该周期结果')
            if not panel.get('bars'):return dict(ok=True,available=False,symbol=symbol,state='empty_period',message='该周期没有有效K线')
            return dict(ok=True,available=True,source_id=source['id'],job_id=job_id,symbol=symbol,
                        summary=bundle['summary'],panel=panel,
                        periods=[dict(period=p.get('period'),count=len(p.get('bars',[]))) for p in panels],
                        definition_mode=bundle['chart'].get('definition_mode'),approximation_loss=bundle['chart'].get('approximation_loss'),
                        input_sha256=bundle['chart'].get('input_sha256',{}),execution_allowed=False,
                        scope='saved_v2_task_result',snapshot_semantics='任务截止时点的结构；端点与可用时点分别记录')
