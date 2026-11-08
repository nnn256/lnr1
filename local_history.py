"""Read existing MiQuant history without mutating the user's databases."""
import json
import os
from pathlib import Path
import sqlite3


DEFAULT_ROOTS = [Path.home()/'AppData/Roaming/miquant-cognitive-finance/MiQuantData',
                 Path('D:/ChiYuQuantData/Merged/MiQuantData')]


def full_code(code):
    code = str(code)
    return ('sh' if code.startswith('6') else 'bj' if code.startswith(('4', '8', '92')) else 'sz') + code


class LocalHistoryStore:
    def __init__(self, roots=None):
        configured = os.getenv('LIANGCE_LOCAL_DATA_ROOTS', '')
        selected = roots if roots is not None else configured.split(';') if configured else DEFAULT_ROOTS
        self.roots = [Path(root) for root in selected]

    def read(self, code, count=1200):
        candidates = []
        for root in self.roots:
            db = root / 'MiQuant.db'
            if db.exists():
                connection = None
                try:
                    connection = sqlite3.connect(db.as_uri() + '?mode=ro', uri=True, timeout=3)
                    connection.execute('PRAGMA query_only=ON')
                    rows = connection.execute(
                        'SELECT trade_date,open,high,low,close,volume FROM daily_kline '
                        'WHERE symbol=? AND source=? ORDER BY trade_date DESC LIMIT ?',
                        (full_code(code), 'tdx_hsjday', int(count))).fetchall()
                    if rows:
                        bars = [dict(date=row[0], open=row[1], high=row[2], low=row[3], close=row[4],
                                     volume=row[5] / 100) for row in reversed(rows)]
                        candidates.append(dict(code=code, bars=bars, source='本地 MiQuant SQLite',
                                               origin=str(db), adjusted=False, adjustment='none',
                                               volume_unit='hands', cached=True))
                except (sqlite3.Error, OSError):
                    pass
                finally:
                    if connection:
                        connection.close()
            for path in [root / 'legacy-daily' / f'{code}-qfq.json', root / 'market-cache' / f'{code}-day.json']:
                if not path.exists():
                    continue
                try:
                    data = json.loads(path.read_text(encoding='utf-8-sig'))
                    if data.get('isReal') is False:
                        continue
                    adjustment = data.get('adjustment') or ('qfq' if path.stem.endswith('-qfq') else None)
                    if adjustment not in ('qfq', 'none'):
                        continue
                    bars = data.get('candles', [])[-count:]
                    normalized = [dict(date=str(bar.get('time') or bar.get('date'))[:10],
                                       **{key: float(bar.get(key, 0)) for key in ('open', 'high', 'low', 'close', 'volume')}) for bar in bars]
                    if normalized and all(len(bar['date']) == 10 and '-' in bar['date'] for bar in normalized):
                        candidates.append(dict(code=code, bars=normalized, source='本地历史缓存', origin=str(path),
                                               adjusted=adjustment == 'qfq', adjustment=adjustment,
                                               volume_unit='source_native', cached=True))
                except (ValueError, TypeError, KeyError, OSError):
                    continue
        if not candidates:
            return None
        # Choose one complete price basis; never splice adjusted JSON into raw TDX bars.
        candidates.sort(key=lambda item: (item['bars'][-1]['date'], len(item['bars'])), reverse=True)
        return candidates[0]
