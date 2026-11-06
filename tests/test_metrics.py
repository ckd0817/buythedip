import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from metrics import drawdowns, drawdown_event_percentiles, drawdown_event_quantiles, ma_deviation, rolling_percentiles, rsi, years_before


class MetricsTests(unittest.TestCase):
    def test_quantiles_interpolate_completed_events_and_exclude_ongoing(self):
        values = drawdown_event_quantiles([0, .1, .05, 0, .2, 0, .5, .3])
        self.assertEqual(len(values), 101)
        for p, expected in [(0, 10), (10, 11), (25, 12.5), (50, 15), (75, 17.5), (90, 19), (99, 19.9), (100, 20)]:
            self.assertAlmostEqual(values[p], expected)
        self.assertEqual(values, sorted(values))

    def test_quantiles_empty_single_and_duplicate_events(self):
        self.assertIsNone(drawdown_event_quantiles([0, .1, .05]))
        self.assertIsNone(drawdown_event_quantiles([]))
        self.assertEqual(drawdown_event_quantiles([0, .1, 0]), [10] * 101)
        self.assertEqual(drawdown_event_quantiles([0, .1, 0, .1, 0]), [10] * 101)

    def test_quantile_samples_are_event_weighted_not_duration_weighted(self):
        short = drawdown_event_quantiles([0, .1, 0, .2, 0])
        long = drawdown_event_quantiles([0] + [.1] * 200 + [0, .2, .05, .1, 0])
        self.assertEqual(short, long)
        self.assertGreater(drawdown_event_quantiles([0, 1e-10, 0])[0], 0)

    def test_events_ignore_ongoing_rebounds_and_count_each_event_once(self):
        depths = [0, .1, .05, .2, 0, .05, 0, .15, .02, .3]
        dates = [f'2020-01-{i + 1:02d}' for i in range(len(depths))]
        ranks, counts = drawdown_event_percentiles(dates, depths)
        self.assertEqual(counts, [0, 0, 0, 0, 1, 1, 2, 2, 2, 2])
        self.assertEqual(ranks, [0, None, None, None, 0, 0, 0, 50, 0, 100])

    def test_events_include_tiny_depths_exclude_ties_and_recover_at_equal_peak(self):
        depths = drawdowns([100, 99.999999, 100, 90, 100, 90])
        dates = [f'2020-01-{i + 1:02d}' for i in range(len(depths))]
        ranks, counts = drawdown_event_percentiles(dates, depths)
        self.assertEqual(counts[-1], 2)
        self.assertEqual(ranks[-1], 50)

    def test_event_history_has_no_future_leakage(self):
        depths = [0, .1, 0, .3, .15, 0, .2]
        dates = [f'2020-01-{i + 1:02d}' for i in range(len(depths))]
        full = drawdown_event_percentiles(dates, depths)
        for n in range(1, len(dates) + 1):
            prefix = drawdown_event_percentiles(dates[:n], depths[:n])
            self.assertEqual(prefix, (full[0][:n], full[1][:n]))

    def test_event_window_uses_recovery_date_and_preserves_full_depth(self):
        dates = ['2018-01-01', '2018-06-01', '2020-01-01', '2020-02-01', '2020-06-01', '2021-01-01']
        depths = [0, .4, 0, .1, 0, .2]
        ranks, counts = drawdown_event_percentiles(dates, depths, 1)
        self.assertEqual((ranks[-1], counts[-1]), (50, 2))
        ranks, counts = drawdown_event_percentiles(dates + ['2021-01-02'], depths + [.2], 1)
        self.assertEqual((ranks[-1], counts[-1]), (100, 1))

    def test_all_history_rank_uses_only_earlier_observations(self):
        dates = ['2020-01-01', '2020-01-02', '2020-01-03', '2020-01-04', '2020-01-05']
        self.assertEqual(rolling_percentiles(dates, [0, .1, .2, .1, .3], None, True), [0, None, 100, 0, 100])
        self.assertEqual(rolling_percentiles(dates, [None, None, 60, 40, 50], None, reverse=True), [None, None, None, 100, 50])
        prefix = rolling_percentiles(dates[:-1], [0, .1, .2, .1], None, True)
        self.assertEqual(prefix, rolling_percentiles(dates, [0, .1, .2, .1, .3], None, True)[:-1])

    def test_all_time_peak_not_window_peak(self):
        self.assertEqual(drawdowns([100, 80, 90, 120, 90]), [0, 1 - .8, 1 - .9, 0, .25])

    def test_drawdown_rank_excludes_zero_current_and_ties(self):
        dates = ['2019-01-01', '2020-01-01', '2020-02-01', '2020-03-01', '2020-04-01', '2020-05-01']
        values = [0, 0, .1, .2, .2, .2]
        ranks = rolling_percentiles(dates, values, 1, positive_only=True)
        self.assertEqual(ranks[-1], 100 / 3)
        self.assertEqual(ranks[-2], 50)

    def test_calendar_cutoff_and_full_depth(self):
        dates = ['2018-01-01', '2020-01-01', '2020-06-01', '2021-01-01']
        ranks = rolling_percentiles(dates, [.9, .1, .2, .3], 1, True)
        self.assertEqual(ranks[-1], 100)

    def test_zero_and_empty_history(self):
        dates = ['2019-01-01', '2020-01-01', '2020-02-01']
        self.assertEqual(rolling_percentiles(dates, [0, 0, .1], 1, True), [0, 0, None])

    def test_no_future_information(self):
        dates = ['2019-01-01', '2020-01-01', '2020-02-01', '2020-03-01']
        values = [.05, .1, .2, .9]
        full = rolling_percentiles(dates, values, 1, True)
        prefix = rolling_percentiles(dates[:-1], values[:-1], 1, True)
        self.assertEqual(full[:-1], prefix)

    def test_insufficient_calendar_history(self):
        self.assertIsNone(rolling_percentiles(['2020-01-01', '2020-02-01'], [.1, .2], 3, True)[-1])

    def test_reverse_rank_counts_strictly_greater_and_excludes_current(self):
        dates = ['2019-01-01', '2020-01-01', '2020-02-01', '2020-03-01', '2020-04-01']
        self.assertAlmostEqual(rolling_percentiles(dates, [50, 30, 40, 60, 40], 1, reverse=True)[-1], 100 / 3)
        self.assertEqual(rolling_percentiles(dates, [50, 30, 40, 60, 20], 1, reverse=True)[-1], 100)
        self.assertEqual(rolling_percentiles(dates, [50, 30, 40, 60, 70], 1, reverse=True)[-1], 0)
        self.assertEqual(rolling_percentiles(dates, [50, 40, 40, 40, 40], 1, reverse=True)[-1], 0)

    def test_reverse_rank_preserves_missing_history(self):
        self.assertIsNone(rolling_percentiles(['2020-01-01', '2020-02-01'], [30, 20], 3, reverse=True)[-1])

    def test_rsi_flat_rising_and_falling(self):
        self.assertEqual(rsi([10] * 20)[-1], 50)
        self.assertEqual(rsi(list(range(1, 30)))[-1], 100)
        self.assertEqual(rsi(list(range(30, 0, -1)))[-1], 0)

    def test_ma_warmup_and_leap_year(self):
        self.assertIsNone(ma_deviation([10] * 199)[-1])
        self.assertAlmostEqual(ma_deviation([10] * 200)[-1], 0)
        self.assertEqual(years_before('2024-02-29', 3), '2021-02-28')


if __name__ == '__main__':
    unittest.main()
