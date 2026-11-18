from bench.benchmark import normalize, term_recall
from bench.simulate_queue import simulate


def test_scripture_normalization():
    assert normalize("John chapter six, verse thirty-five") == normalize("John 6:35") == "john 6 35"
    assert normalize("First Corinthians thirteen four") == "1 corinthians 13 4"
    assert normalize("Psalm one hundred twenty one") == "psalm 121"
    r = term_recall("Turn with me to John chapter six verse thirty five. Pastor Okafor prayed.",
                    ["John 6:35", "Pastor Okafor", "Romans 8:28"])
    assert r["found"] == 2 and r["missed"] == ["Romans 8:28"]


def test_queue_simulation_sane():
    r = simulate(n=20, workers=10, window_min=30)
    assert r["drain_min"] >= 30 * 0.8 and r["cold_starts"] >= 10
    assert r["queue_age_p95_min"] >= r["queue_age_p50_min"] >= 0
    more = simulate(n=20, workers=2, window_min=30)
    assert more["queue_age_p95_min"] > r["queue_age_p95_min"]
