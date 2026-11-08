# 第三方来源

- TradingView Lightweight Charts：沿用桌面版已包含的发行文件；许可证与 NOTICE 在 vendor/lightweight-charts。
- 通达信 HTTP 服务：现有 LiangCe 的 services/tdx-api，参考 https://github.com/oficcejo/tdx-api。
- 通达信协议模块：vendor/tdx 是原工程本机依赖的源代码副本，module path 为 github.com/injoyai/tdx；原修改包括北交所代码映射与行情日期处理。保留作者代码注释与 module 信息，不声明本项目拥有第三方代码版权。
- Python 后台沿用 LiangCe 1.5.2 的逻辑；网页桥接、响应式样式和发布工具新增于此项目。

构建不再依赖原作者机器上的绝对 Go replace 路径。
