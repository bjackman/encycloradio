#!/usr/bin/python3
import sys
from argparse import ArgumentParser
from bz2 import BZ2Decompressor
from io import StringIO

import mwxml # Parses the XML so we can get the MediaWiki source out
import mwparserfromhell # Parses the actual MediaWiki source

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

def find_listens(page):
    """
    Take a mwxml.Page and return all the "listen" templates

    Returned as an iterable of mwparserfromhell.Template objects. These should
    have a "filename" parameter.
    """
    # If you iterate over page objects you get each revision. We want the latest
    # revision. I guess that's the first thing yielded by the iterator (my data
    # only has single revisions..)
    mw = mwparserfromhell.parse(next(page).text)
    # Seems like the template names are messy hence .lower and startswith
    return (t for t in mw.filter_templates() if t.name.lower().startswith("listen"))

if __name__ == "__main__":
    parser = ArgumentParser()
    parser.add_argument("xml_bz2_path")

    args = parser.parse_args()

    bz2_file = open(args.xml_bz2_path, "rb")

    #
    # TODO hard-coded seek here!
    # Plan is to use index file from dump to seek to streams to reach pages
    # without decompressing entire XML
    #

    bz2_file.seek(1619327860)

    for page in iter_pages(bz2_file):
        for listen in find_listens(page):
            print("On page '{}', found file '{}'".format(
                page.title, listen.get("filename").value))
