#!/usr/bin/env python3
"""Download Cnaes.zip (Receita WebDAV) → Latin-1 CSV → Parquet ZSTD.

Uso:
  .venv/bin/python sample_cnaes_to_parquet.py [--snapshot 2026-08] [--skip-download]

Saída padrão: out/parquet/{snapshot}/cnaes/cnaes.parquet
"""
from __future__ import annotations

import argparse
import io
import zipfile
from pathlib import Path

import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq
import urllib.request

WEBDAV_BASE = "https://arquivos.receitafederal.gov.br/public.php/webdav"
SHARE_USER = "YggdBLfdninEJX9"
# Public share: empty password (not a secret).
SHARE_PASS = ""

CNAE_COLUMNS = ["codigo", "descricao"]


def download_cnaes(snapshot: str, dest_zip: Path) -> Path:
    url = f"{WEBDAV_BASE}/{snapshot}/Cnaes.zip"
    dest_zip.parent.mkdir(parents=True, exist_ok=True)
    password_mgr = urllib.request.HTTPPasswordMgrWithDefaultRealm()
    password_mgr.add_password(None, WEBDAV_BASE, SHARE_USER, SHARE_PASS)
    handler = urllib.request.HTTPBasicAuthHandler(password_mgr)
    opener = urllib.request.build_opener(handler)
    print(f"GET {url}")
    with opener.open(url) as resp, open(dest_zip, "wb") as f:
        while True:
            chunk = resp.read(1024 * 256)
            if not chunk:
                break
            f.write(chunk)
    print(f"saved {dest_zip} ({dest_zip.stat().st_size} bytes)")
    return dest_zip


def csv_bytes_from_zip(zip_path: Path) -> bytes:
    with zipfile.ZipFile(zip_path) as zf:
        names = zf.namelist()
        if not names:
            raise SystemExit(f"empty zip: {zip_path}")
        # Prefer *CNAE* member; else first file.
        member = next((n for n in names if "CNAE" in n.upper()), names[0])
        print(f"extract member {member}")
        return zf.read(member)


def to_parquet(csv_bytes: bytes, out_path: Path) -> Path:
    df = pd.read_csv(
        io.BytesIO(csv_bytes),
        sep=";",
        header=None,
        names=CNAE_COLUMNS,
        dtype=str,
        encoding="latin-1",
        quotechar='"',
    )
    df["codigo"] = df["codigo"].astype(str).str.strip()
    df["descricao"] = df["descricao"].astype(str)
    table = pa.Table.from_pandas(df, preserve_index=False)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    pq.write_table(table, out_path, compression="zstd")
    print(f"wrote {out_path} rows={len(df)} bytes={out_path.stat().st_size}")
    return out_path


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--snapshot", default="2026-08")
    ap.add_argument("--skip-download", action="store_true")
    ap.add_argument(
        "--data-dir",
        type=Path,
        default=Path(__file__).resolve().parent / "data",
    )
    ap.add_argument(
        "--out-dir",
        type=Path,
        default=Path(__file__).resolve().parent / "out",
    )
    args = ap.parse_args()

    zip_path = args.data_dir / "Cnaes.zip"
    if not args.skip_download or not zip_path.exists():
        download_cnaes(args.snapshot, zip_path)
    elif args.skip_download:
        print(f"reuse {zip_path}")

    csv_bytes = csv_bytes_from_zip(zip_path)
    out = args.out_dir / "parquet" / args.snapshot / "cnaes" / "cnaes.parquet"
    to_parquet(csv_bytes, out)


if __name__ == "__main__":
    main()
