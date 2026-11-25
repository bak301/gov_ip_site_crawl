"""Write only indexed publication pages to stdout; never persist a preview copy."""

import re
import sys

import fitz


def main():
    if len(sys.argv) != 3:
        raise ValueError("Expected source PDF and indexed page list.")
    source_path, page_text = sys.argv[1:]
    pages = [int(value) for value in page_text.split(",") if value.strip().isdigit()]
    if not pages or len(pages) > 100 or not re.fullmatch(r"[0-9, ]+", page_text):
        raise ValueError("Invalid indexed publication pages.")
    with fitz.open(source_path) as source, fitz.open() as output:
        if any(page < 1 or page > source.page_count for page in pages):
            raise ValueError("An indexed page is outside the source publication PDF.")
        for page in pages:
            output.insert_pdf(source, from_page=page - 1, to_page=page - 1)
        sys.stdout.buffer.write(output.tobytes(garbage=3, deflate=True))


if __name__ == "__main__":
    try:
        main()
    except (OSError, RuntimeError, ValueError) as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)
