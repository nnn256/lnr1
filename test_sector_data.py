import unittest
from sector_data import rank_data

def row(code,closes):return dict(code=code,bars=[dict(date=f'2026-10-{i+1:02}',close=c,amount=1) for i,c in enumerate(closes)])

class SectorTests(unittest.TestCase):
    def test_compounded_returns_use_close_ratios_and_missing_period_is_none(self):
        rows=[row('A',[100]*20+[110,121,121,121,121,133.1]),row('B',[100]*26)]
        asof,dates=rank_data(rows)
        self.assertEqual(asof,'2026-10-26');self.assertEqual(len(dates),6)
        self.assertAlmostEqual(rows[0]['return_5d'],21)
        self.assertAlmostEqual(rows[0]['return_20d'],33.1)
        self.assertEqual(rows[0]['rank'],1)
    def test_ties_are_deterministic_and_old_rank_is_not_changed_by_future_prices(self):
        rows=[row('B',[100]*26),row('A',[100]*26)]
        rank_data(rows);self.assertEqual(rows[1]['rank'],1)
        old=rows[0]['rank_history'][0]
        rows[0]['bars'][-1]['close']=200;rank_data(rows)
        self.assertEqual(rows[0]['rank'],1);self.assertEqual(rows[0]['rank_history'][0],old)
    def test_stale_sector_has_no_current_rank_or_return(self):
        rows=[row('A',[100]*26),row('B',[100]*25)];rank_data(rows)
        self.assertIsNone(rows[1]['rank']);self.assertIsNone(rows[1]['return_5d']);self.assertEqual(rows[1]['history_as_of'],'2026-10-25')

if __name__=='__main__':unittest.main()
