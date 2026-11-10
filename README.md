# lnr1 · 量策 Web 1.6.0

从原项目的 1.6.0 版本恢复，保留全市场股票、日线评分、入场与止损参数、图表复盘、历史回放、多区间回测和板块轮动。页面标题与截图一致。

- 公开源码：https://github.com/nnn256/lnr1 （`main` 分支）
- 网页构建产物与行情快照：https://github.com/nnn256/lnr1/tree/gh-pages
- 网页地址：https://nnn256.github.io/lnr1/
- 原始 1.6.0 提交：`db9fdbea24318ff5a47a7dfeac7f4ad578598422`

选股、评分、回测和图表算法沿用该版本。部署适配只涉及网站地址、GitHub Pages 工作流及历史文件的下载地址。

## 本地运行

安装 Python 3.12+ 和 Node.js 22+。

```powershell
python web_server.py --host 127.0.0.1 --port 8765
```

打开 http://localhost:8765 。完整服务需要通达信 HTTP 服务，可配置 `LIANGCE_TDX_API_URL`，或者编译自带源码：

```powershell
cd services/tdx-api
go build -o ../../tdx-api-service.exe .
cd ../..
```

Linux 将输出文件名改为 `../../tdx-api-service`。配置说明见 `.env.example`；个人配置和本机任务数据库不纳入仓库。

## 构建与发布

```powershell
python tools/collect_snapshot.py
python sector_data.py
python tools/build_site.py
python -m http.server 8766 --directory _site
```

也可指定已有真实行情缓存：`python tools/build_site.py --data-dir PATH --output _site`。

将 `_site` 内的构建文件提交到本仓库 `gh-pages` 分支后，GitHub Actions 自动部署。`main` 分支执行源码测试；没有新增定时采集任务。工作流将网页和市场索引托管到 Pages，完整日线通过本仓库的固定提交地址读取，防止页面与历史数据版本错配。

首次恢复使用原 1.6.0 已保存快照（历史截至 2026-11-06），网页继续连接原有 Railway 接口获取最新报价和闭合日线。页面会区分云端数据与已发布完整历史，不把快照日期当成实时日期。

## 版本语义与核验

本版的缠论图是结构代理，标注“规则触发”，严格缠论确认尚未实现。回放会截断未来 K 线重新计算。评分、信号和回测不构成收益保证。

```powershell
python -m unittest test_batch_analysis test_market_runtime test_local_tdx test_v2_results test_web_server test_site_export test_sector_data
node --test '*.test.cjs'
```

GitHub Pages 是静态网页；本机 V2 任务查看等依赖后端的功能需要运行完整网页服务。行情接口沿用已有服务。
