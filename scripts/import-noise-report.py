"""Import the reviewed Busan tables from the official 2025 national noise report.

No geocoding or hotel interpolation. PDF bytes are cached locally, SHA-256 pinned.
Install pypdf for this optional import only; ordinary application runs do not need it.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
from urllib.request import urlopen, Request

URL = "https://www.index.go.kr/unity/potal/FileDown.do?seq=17609&id=1471&div=1"
PAGE_URL = "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=1471"
STATIONS = ["주남혁소아과 앞", "구덕운동장 동쪽", "동래우체국 앞", "하나한의원 앞", "대부자동차정비 앞"]
MAX_BYTES = 8 * 1024 * 1024
REVIEWED_SHA256 = "f6d3de069833ade5ba0c6d23336449ffddc1cca9d73b8e8c202f8e4061e98460"


def parse_tables(text):
    """Only the reviewed page/table structure; reject moved, duplicate or missing rows."""
    sections = re.split(r"표\s+부산광역시\s+야간", text)
    if len(sections) != 2 or not all(x in text for x in ["3-7", "3-8", "3-9", "25", "부산광역시"]):
        raise ValueError("Unrecognized Busan 2025 table layout; manual review required")
    output = []
    for name in STATIONS:
        values = []
        for section in sections:
            rows = re.findall(re.escape(name) + r"\s+(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})(?!\d)", section)
            if len(rows) != 1:
                raise ValueError("Expected one row per station per table: " + name)
            row = [int(value) for value in rows[0]]
            if not all(20 <= value <= 140 for value in row):
                raise ValueError("Implausible reported sound level")
            values.append(row[0])  # 2025 column; not previous year or three-year average.
        output.append({"stationName": name, "coordinates": None,
                       "dayDbA": values[0], "nightDbA": values[1], "hotelIds": []})
    return output


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pdf", default=".local/korea-noise-2025.pdf")
    parser.add_argument("--download", action="store_true")
    parser.add_argument("--output", default="data/noise-measurements-busan-2025.json")
    args = parser.parse_args()
    path = Path(args.pdf)
    if args.download:
        with urlopen(Request(URL, headers={"User-Agent": "OPodoydet-open-data/1.0"}), timeout=45) as response:
            payload = response.read(MAX_BYTES + 1)
        if len(payload) > MAX_BYTES or not payload.startswith(b"%PDF-"):
            raise ValueError("Expected a bounded PDF response")
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(payload)
    payload = path.read_bytes()
    if len(payload) > MAX_BYTES or not payload.startswith(b"%PDF-"):
        raise ValueError("Invalid cached PDF")
    if hashlib.sha256(payload).hexdigest() != REVIEWED_SHA256:
        raise ValueError("Source bytes changed; visually review the new report before importing")
    from pypdf import PdfReader
    document = PdfReader(path)
    if len(document.pages) != 66:
        raise ValueError("Report changed; review pages before importing")
    rows = parse_tables(document.pages[32].extract_text())
    result = {
        "schemaVersion": 1, "region": "Пусан", "kind": "annual_station_measurements",
        "year": 2025, "period": {"from": "2025-01-01", "to": "2025-12-31"},
        "unit": "dB(A)", "scope": "named_monitoring_stations", "usableForHotelMatching": False,
        "source": {"url": URL, "publisher": "Korea Environment Corporation / Ministry of Climate, Energy and Environment",
                   "retrievedAt": datetime.fromtimestamp(path.stat().st_mtime, timezone.utc).isoformat(),
                   "sha256": hashlib.sha256(payload).hexdigest(), "pageUrl": PAGE_URL,
                   "publishedAt": "2026-09-15", "pdfPage": 33, "printedPage": 30,
                   "tables": ["3-7", "3-8"], "method": "pypdf extraction; 2025 columns visually checked against PDF page 33"},
        "observations": rows,
        "limitations": [
            "Годовые значения на пяти именованных постах Пусана за 2025 год, не прогноз на поездку.",
            "Координаты постов и пространственная применимость к отелям Хэундэ не установлены.",
            "Эти измерения не участвуют в фильтре тишины и не являются уровнем шума внутри номера.",
            "Нельзя усреднять эти значения и приписывать результат всему городу или ближайшему отелю."]}
    Path(args.output).write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"stations": len(rows), "hotel_matches": 0, "source_sha256": result["source"]["sha256"]}))


if __name__ == "__main__":
    main()
