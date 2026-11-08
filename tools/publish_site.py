"""Publish only exported browser assets/data with a repository-scoped deploy key."""
import json
import os
import re
import shlex
import shutil
import subprocess
import tempfile
import urllib.request
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]

def publish():
    repo=os.environ['LIANGCE_SITE_REPOSITORY']
    if not re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+',repo):raise ValueError('Invalid repository')
    source=ROOT/'_site'
    manifest=json.loads((source/'data/manifest.json').read_text(encoding='utf8'))
    if manifest['stocks']<1000:raise ValueError('Refusing incomplete market export')
    with tempfile.TemporaryDirectory(prefix='liangce-publish-') as temp:
        directory=Path(temp);key=directory/'deploy-key';known=directory/'known_hosts'
        key.write_text(os.environ['LIANGCE_SITE_DEPLOY_KEY'].strip()+'\n',encoding='utf8');key.chmod(0o600)
        request=urllib.request.Request('https://api.github.com/meta',headers={'User-Agent':'LiangCe-publisher'})
        meta=json.load(urllib.request.urlopen(request,timeout=30))
        known.write_text(''.join('github.com '+value+'\n' for value in meta['ssh_keys']),encoding='utf8')
        environment=os.environ.copy()
        environment.pop('LIANGCE_SITE_DEPLOY_KEY',None)
        environment['GIT_SSH_COMMAND']='ssh -i '+shlex.quote(str(key))+' -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile='+shlex.quote(str(known))
        checkout=directory/'site'
        def git(*args,check=True):return subprocess.run(['git',*args],cwd=checkout if checkout.exists() else directory,env=environment,check=check)
        git('clone','--depth','1','git@github.com:'+repo+'.git',str(checkout))
        for target in checkout.iterdir():
            if target.name=='.git':continue
            if not target.resolve().is_relative_to(checkout.resolve()):raise ValueError('Unexpected publication path')
            if target.is_dir():shutil.rmtree(target)
            else:target.unlink()
        for item in source.iterdir():
            if item.name=='.git':continue
            if item.is_dir():shutil.copytree(item,checkout/item.name)
            else:shutil.copy2(item,checkout/item.name)
        git('config','user.name','LiangCe Publisher');git('config','user.email','liangce-publisher@users.noreply.github.com')
        git('add','.')
        if git('diff','--cached','--quiet',check=False).returncode==0:
            print('Published data already current');return
        git('commit','-q','-m','Publish market snapshot '+manifest['market_day'])
        git('push','origin','HEAD:main')
        print('Published website files to',repo)

if __name__=='__main__':publish()
