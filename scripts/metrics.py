"""Indicator calculations. No synthetic data and no future samples."""
from bisect import bisect_left, bisect_right, insort
from datetime import date


def years_before(value, years):
    d = date.fromisoformat(value)
    try:
        return d.replace(year=d.year - years).isoformat()
    except ValueError:
        return d.replace(year=d.year - years, day=28).isoformat()


def drawdowns(prices):
    peak = 0
    result = []
    for price in prices:
        peak = max(peak, price)
        result.append(max(0.0, 1 - price / peak))
    return result


def drawdown_event_percentiles(dates, depths, years=None):
    """Rank current depth against completed peak-to-recovery event maxima.

    Recovering to the previous high closes an event; partial rebounds do not.
    Every positive depth counts, with no event-size filter. Finite windows
    select events by recovery date, retaining their full peak-to-trough depth.
    Historical outputs use only events already recovered by that date.
    """
    samples, completed = [], []
    left = 0
    event_depth = 0.0
    ranks, counts = [], []
    for day, depth in zip(dates, depths):
        if depth > 0:
            event_depth = max(event_depth, depth)
        elif event_depth > 0:
            completed.append((day, event_depth))
            insort(samples, event_depth)
            event_depth = 0.0
        cutoff = dates[0] if years is None else years_before(day, years)
        while left < len(completed) and completed[left][0] < cutoff:
            samples.pop(bisect_left(samples, completed[left][1]))
            left += 1
        counts.append(len(samples))
        if depth == 0:
            ranks.append(0.0)
        elif not samples or (years is not None and dates[0] > cutoff):
            ranks.append(None)
        else:
            ranks.append(100 * bisect_left(samples, depth) / len(samples))
    return ranks, counts


def drawdown_event_quantiles(depths):
    """P0..P100 of completed event maxima, in percent, linearly interpolated.

    Shares the rank's peak-to-recovery event definition. The ongoing event
    never enters the distribution; zero-depth days are not separate events.
    """
    samples = []
    event_depth = 0.0
    for depth in depths:
        if depth > 0:
            event_depth = max(event_depth, depth)
        elif event_depth > 0:
            samples.append(event_depth * 100)
            event_depth = 0.0
    if not samples:
        return None
    samples.sort()
    result = []
    for percentile in range(101):
        position = (len(samples) - 1) * percentile / 100
        lower = int(position)
        upper = min(lower + 1, len(samples) - 1)
        result.append(samples[lower] + (samples[upper] - samples[lower]) * (position - lower))
    return result


def rsi(prices, period=14):
    result = [None] * len(prices)
    if len(prices) <= period:
        return result
    changes = [b - a for a, b in zip(prices, prices[1:])]
    gain = sum(max(c, 0) for c in changes[:period]) / period
    loss = sum(max(-c, 0) for c in changes[:period]) / period
    for i in range(period, len(prices)):
        if i > period:
            change = changes[i - 1]
            gain = (gain * (period - 1) + max(change, 0)) / period
            loss = (loss * (period - 1) + max(-change, 0)) / period
        result[i] = 50.0 if gain == loss == 0 else (100.0 if loss == 0 else 100 - 100 / (1 + gain / loss))
    return result


def ma_deviation(prices, period=200):
    result = []
    total = 0.0
    for i, price in enumerate(prices):
        total += price
        if i >= period:
            total -= prices[i - period]
        result.append(None if i < period - 1 else price / (total / period) - 1)
    return result


def rolling_percentiles(dates, values, years, positive_only=False, reverse=False):
    """Strict rank vs previous N calendar years, excluding current and tied values.

    Positive-only samples implement the drawdown-day denominator. Incomplete
    calendar lookbacks remain null. A current zero drawdown is always zero.
    Reverse ranks count strictly greater samples, excluding ties as well.
    """
    samples = []
    left = 0
    result = []
    def valid(v):
        return v is not None and (not positive_only or v > 1e-12)
    first_valid = next((d for d, v in zip(dates, values) if v is not None), None)
    for i, (day, value) in enumerate(zip(dates, values)):
        if i and valid(values[i - 1]):
            insort(samples, values[i - 1])
        cutoff = dates[0] if years is None else years_before(day, years)
        while left < i and dates[left] < cutoff:
            if valid(values[left]):
                samples.pop(bisect_left(samples, values[left]))
            left += 1
        if positive_only and value is not None and value <= 1e-12:
            result.append(0.0)
        elif value is None or not samples or first_valid is None or (years is not None and first_valid > cutoff):
            result.append(None)
        else:
            count = len(samples) - bisect_right(samples, value) if reverse else bisect_left(samples, value)
            result.append(100 * count / len(samples))
    return result
