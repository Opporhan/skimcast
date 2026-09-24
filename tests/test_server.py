import importlib.util
from pathlib import Path

_path = Path(__file__).parents[1] / "server" / "main.py"
_spec = importlib.util.spec_from_file_location("server_main", _path)
nh = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(nh)


# blocks_with_words(): "videoyla kelime kelime senkron takip" özelliğinin temeli — YouTube'un ham,
# ince taneli altyazı parçalarını (~2-5sn'lik cümle parçaları) hem okunabilir ~30sn'lik bloklara
# birleştiriyor HEM DE her bloğun içine giren ham parçaları (words) ayrıca saklıyor. Bu oturuma kadar
# hiç test edilmemişti (sadece canlı, gerçek bir YouTube videosuyla elle doğrulandı).
def test_combines_into_30s_blocks_and_keeps_raw_words():
    segments = [(i * 5.0, f"cümle {i}.") for i in range(14)]  # 0, 5, 10, ..., 65 saniye
    blocks = nh.blocks_with_words(segments)
    assert len(blocks) >= 2
    assert blocks[0]["sec"] == 0.0
    assert blocks[0]["text"].startswith("cümle 0.")
    # her bloğun "words" listesi, o bloğa giren HAM segmentlerin aynısı (sec + text çifti) olmalı
    assert blocks[0]["words"][0] == [0.0, "cümle 0."]
    # tüm segmentlerin kelime gruplarının toplamı, orijinal segment sayısına eşit olmalı (kayıp yok)
    assert sum(len(b["words"]) for b in blocks) == len(segments)


def test_empty_and_whitespace_only_segments_are_skipped():
    segments = [(0.0, "  "), (1.0, "gerçek metin"), (2.0, "")]
    blocks = nh.blocks_with_words(segments)
    assert len(blocks) == 1
    assert blocks[0]["text"] == "gerçek metin"
    assert blocks[0]["words"] == [[1.0, "gerçek metin"]]


def test_single_short_segment():
    blocks = nh.blocks_with_words([(3.5, "tek cümle.")])
    assert blocks == [{"sec": 3.5, "text": "tek cümle.", "words": [[3.5, "tek cümle."]]}]


def test_no_segments():
    assert nh.blocks_with_words([]) == []
