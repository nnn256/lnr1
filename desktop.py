"""Windows WebView host for LiangCe."""
import sys
from market_runtime import BASE, VERSION, MarketAPI, parse_bridge, safe_bridge

if __name__ == '__main__':
    import webview
    api = MarketAPI()
    api.start_background()
    window = webview.create_window(f'量策 LiangCe {VERSION} · 股票研究工作台', str(BASE / 'index.html'),
                                   js_api=api, width=1440, height=960, min_size=(900, 650))
    window.events.closed += api.close
    webview.start(gui='edgechromium', debug='--debug' in sys.argv)
