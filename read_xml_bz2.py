#!/usr/bin/python3
import sys
from argparse import ArgumentParser
from bz2 import BZ2Decompressor
from io import StringIO

import mwxml # Parses the XML so we can get the MediaWiki source out

READ_SIZE = 64 * 1024

def iter_xml_bz2_streams(bz2_file):
    """
    Take a MediaWiki .xml.bz2 file and iterate over the streams

    Yields each stream decompressed in its entirety. This is useful because
    Wikipedia XML dumps are enormous .bz2 files but divided into individual
    streams that can be decompressed separately.
    """
    decompressor = BZ2Decompressor()
    unused_data = b""
    decompressed = b""

    while True:
        compressed = unused_data + bz2_file.read(READ_SIZE)
        unused_data = b""
        decompressed += decompressor.decompress(compressed)

        if decompressor.eof: # Reached end of bz2 stream
            yield decompressed

            # The decompressor is dead now, need a new one for the next stream.
            # It will generally have hit the bz2 EOF before the end of the
            # buffer we passed it; the remaining part of the buffer is in
            # .unused_data. We'll pass that on to the new decompressor.
            decompressed = b""
            unused_data = decompressor.unused_data
            decompressor = BZ2Decompressor()

def iter_pages(bz2_file):
    """
    Take a MediaWiki .xml.bz2 file and iterate over wiki pages

    Yields mwxml.Page objects
    """
    for decomp_stream in iter_xml_bz2_streams(bz2_file):
        dump = mwxml.Dump.from_page_xml(StringIO(str(decomp_stream)))
        for page in dump.pages:
            yield page

if __name__ == "__main__":
    parser = ArgumentParser()
    parser.add_argument("xml_bz2_path")

    args = parser.parse_args()

    bz2_file = open(args.xml_bz2_path, "rb")
    bz2_file.seek(1619327860)

    for page in iter_pages(bz2_file):
        if page.title == "Swing Low, Sweet Chariot":
            # If you iterate over page objects you get each revision (we only
            # have one revision)
            revision = next(page)
            print(revision.text)
            sys.exit(0)
