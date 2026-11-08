# LiangCe · 量策网页工作台

手机、平板和电脑使用同一套网页。保留全市场股票、K线、日线评分、回测、缠论代理结构、V2已保存任务查看与导出。

## 电脑运行完整网页版

需要 Python 3.12+。在项目目录运行：

```powershell
python web_server.py --host 127.0.0.1 --port 8765
```

打开 http://localhost:8765 。PowerShell 也可以运行 `./Start-Web.ps1`。

手机与电脑连接同一网络时：

```powershell
./Start-Web.ps1 -Lan
```

手机访问电脑局域网 IP 的 8765 端口。系统防火墙需允许此端口；项目不会自动修改防火墙。远程公网部署采用下面的 Docker 配置并配置 HTTPS。

完整服务自动从通达信获取行情；用户的评分参数、暂停状态与计算队列按浏览器会话隔离。导出直接下载到当前浏览器。

Windows 本地目录已包含供本次运行使用的 tdx-api-service.exe；该二进制不进入代码仓库。其他机器从源码构建：

```powershell
cd services/tdx-api
go build -o ../../tdx-api-service.exe .
```

Linux 输出文件名用 `../../tdx-api-service`。也可通过 `LIANGCE_TDX_API_URL` 连接已有通达信 HTTP 服务。

## GitHub 备份与 GitHub Pages

源码备份：**https://github.com/nnn256/LiangCe**（私有）。网站发布文件：**https://github.com/nnn256/LiangCe-site**（公开，仅网页资源和行情快照）。

网站地址：https://nnn256.github.io/LiangCe-site/

GitHub Pages 托管网页、完整历史和全市场评分，已接入用户提供的现有 Railway 后台：https://liangce-v3-api-production.up.railway.app 。无需新建服务器或升级套餐。

当前页和所选股票的报价在交易时段每20秒刷新，休市每5分钟检查；翻页或换股立即取数，页面隐藏暂停请求。只刷新正在查看的股票，单批不超过80只，避免反复扫描5580只占用服务额度。每个报价保留行情源时间，失败和缺失会明确标记。

图表默认按需读取云端最新闭合日线，查看期间每分钟检查（休市缓存5分钟）；也可切换“已发布完整历史”。实测云端贵州茅台返回160根日线，长期发布历史有1200根。两种来源分别展示、不拼接；上游复权口径未认证会显示在图表。云端结构接口要求至少3根，1～2根新股显示明确标记的已发布历史，报价仍独立刷新。

盘中报价与闭合K线分开显示，不用报价伪造完整OHLC或历史确认。全市场评分、成交额排序仍基于已发布数据；所选股票取得云端日线后可重新评分。可在浏览器改变策略后基于已发布日线重新评分。V2本地任务文件不上传到 GitHub Pages，在完整网页服务中读取。

工作流 `.github/workflows/pages.yml` 在仓库变量 `ENABLE_PAGES=true` 后启用，在推送、手动触发及北京时间交易日12:20和15:20运行：构建通达信服务 → 获取真实市场数据 → 导出静态站点 → 发布。GitHub调度可能延迟；采集失败时工作流失败，已有部署继续保留。

本账号的私有仓库不支持 Pages，已按用户选择采用“私有源码＋公开网站产物”。私有仓库通过仅限网站仓库的部署密钥 `SITE_DEPLOY_KEY` 同步发布文件。后端Python、Go源码、本机V2任务和个人配置不发布到网站仓库。

本地生成相同的静态站点：

```powershell
python tools/collect_snapshot.py
python tools/build_site.py
python -m http.server 8766 --directory _site
```

代码仓库忽略行情缓存、导出文件、账户配置、EXE、验收数据和工具。`_site`由工作流上传为部署产物，日线不提交到Git历史。

## 完整网页服务部署

```sh
docker build -t liangce-web .
docker run -d --name liangce-web -p 8765:8765 -v liangce-data:/data -e LIANGCE_WEB_PASSWORD='设置访问密码' liangce-web
```

服务端采用一个 Gunicorn worker、多线程，共享行情但隔离浏览器评分队列。在反向代理配置HTTPS。若部署平台支持 Docker，可直接使用 Dockerfile。

可选环境变量：

| 变量 | 用途 |
|---|---|
| LIANGCE_DATA_DIR | 网页自己的日线缓存目录，默认 runtime/data |
| LIANGCE_TDX_API_URL | 通达信 HTTP 服务地址 |
| LIANGCE_TDX_BINARY | 通达信服务可执行文件路径 |
| LIANGCE_TDX_SERVER | 指定通达信服务器，留空自动测速 |
| LIANGCE_LOCAL_DATA_ROOTS | 本地MiQuant历史目录，以分号分隔 |
| LIANGCE_V2_RESULT_ROOTS | V2任务根目录，以分号分隔 |
| LIANGCE_WEB_PASSWORD | 完整网页服务的访问密码；Basic用户名可任填 |

## 验证与数据含义

回测页选择“指定股票”“当前市场页股票”或“已导入CSV”，点击运行后自动获取完整已发布历史，最多50只。样本与日期在本次计算开始时固定，计算使用独立线程，可取消；看图时的云端160根等短历史不会覆盖回测样本。区间表显示实际覆盖日期；当不足5年时，不将短样本标称为完整5年。无成交时说明候选数、风控和涨跌停拦截次数；失败时清除旧曲线和旧成交。

板块轮动采用东方财富行业板块指数；历史随发布采集，当前覆盖496个板块。5日/20日收益来自同一指数日线，排名变化比较5个交易日前与当前的5日收益排名。源站分类可能包含上下级行业、成分有重叠，不作互斥行业合计。页面可搜索、排序、分页和查看排名轨迹；打开页面后直接读取板块最新行情，每分钟核验，历史轮动日期独立显示。行情源失败保留原时间，不用0替代缺失。

本地更新板块历史：`python sector_data.py`。云端发布工作流同样执行这一步，生成 `data/sectors.json`。

```sh
python -m unittest test_batch_analysis test_market_runtime test_local_tdx test_v2_results test_web_server
node --test '*.test.cjs'
```

K线达到1根即可保存和展示；评分需要100根历史。缠论结构是现有代理算法/已保存任务结果，不新增严格理论等价或交易执行功能。

第三方来源见 docs/third-party.md。原桌面版工程保留在原位置，网页版在 D:\LiangCe-Web 独立维护。
